/** Real pinned DSH, deterministic HTTP slow stream, synthetic credentials. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DshWebRuntime } from '../../src/dsh-web-runtime.ts';
import { createOfficialDshSettingsClient } from '../../src/dsh-settings-migration.ts';

export async function runNativeStreamTimeout() {
  const root=await mkdtemp(join(tmpdir(),'weftmate-fx14-stream-')), home=join(root,'home'), workspace=join(root,'workspace');
  await mkdir(workspace,{recursive:true}); await mkdir(home,{recursive:true});
  let mode='silent', attempts=0, cancellations=0; const rows: any[]=[];
  const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
  const server=createServer(async(req,res)=>{
    if(req.url==='/v1/models') return res.end(JSON.stringify({data:[{id:'slow',context_window:32768}]}));
    if(req.url==='/props') return res.end(JSON.stringify({n_ctx:32768}));
    if(!req.url?.endsWith('/chat/completions')) return res.writeHead(404).end();
    let raw=''; for await(const bytes of req)raw+=bytes; const input=JSON.parse(raw);
    if(JSON.stringify(input.messages[0]).includes('concise title')) {res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{index:0,delta:{content:'Synthetic title'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');return;}
    const row={mode,attempt:++attempts,started:Date.now(),closed:0,maxTokens:input.max_tokens,messages:input.messages.map(m=>({role:m.role,content:JSON.stringify(m.content).slice(0,160)}))};rows.push(row);
    res.on('close',()=>{row.closed=Date.now();cancellations++;});
    const delta=(content:any)=>res.write('data: '+JSON.stringify({id:'slow',choices:[{index:0,delta:content,finish_reason:null}]})+'\n\n');
    res.writeHead(200,{'content-type':'text/event-stream'}); delta({role:'assistant'});
    if(mode==='cancel'||mode==='silent'&&attempts===1||mode==='override'&&attempts===5) return; // headers + first block, no semantic increment
    if(mode==='progress') for(let n=0;n<10;n++){await pause(80);if(res.destroyed)return;delta({content:'increment '+n+' '});}
    else {await pause(100);if(res.destroyed)return;delta({content:'retried successfully'});}
    res.end('data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110}})+'\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const addr=server.address();assert.ok(addr&&typeof addr!=='string');
  const eventsFile=join(home,'events.jsonl'), observer=join(home,'profiles/weftmate/plugins/slow-observer.mjs');
  await mkdir(join(home,'profiles/weftmate/plugins'),{recursive:true});
  await writeFile(observer,`import {appendFileSync} from 'node:fs'; export const name='slow-observer'; export function apply(ctx){ctx.on('session/event',(session,event)=>appendFileSync(${JSON.stringify(eventsFile)},JSON.stringify({sessionId:session.id,type:event.type,data:event.data})+'\\n'));}`);
  const patch=join(home,'slow.yml');
  await writeFile(patch,`- id: llm-pi-ai
  config:
    providers:
      slow-fixture:
        api: openai-completions
        apiKeyEnv: SLOW_FIXTURE_KEY
        baseURL: http://127.0.0.1:${addr.port}/v1
        models:
          - id: slow
            contextWindow: 32768
            maxTokens: 4096
- id: credentials
  disabled: true
- insert:
    - id: weftmate-safe-credentials
      name: ./plugins/weftmate-credentials.mjs
    - id: slow-observer
      name: ./plugins/slow-observer.mjs
`);
  const phases: string[]=[];
  const scheduler=createServer(async(req,res)=>{
    if(req.url?.startsWith('/lease')){res.writeHead(200,{'content-type':'text/plain'});res.write('granted\n');return;}
    if(req.url==='/progress'){let raw='';for await(const bytes of req)raw+=bytes;phases.push(JSON.parse(raw).phase);return res.writeHead(204).end();}
    res.end(JSON.stringify(req.url?.startsWith('/route')?{provider:'slow-fixture',model:'slow'}:{}));
  });
  await new Promise<void>(resolve=>scheduler.listen(0,'127.0.0.1',resolve));const schedulerAddress=scheduler.address();assert.ok(schedulerAddress&&typeof schedulerAddress!=='string');
  const previousScheduler=process.env.WEFTMATE_MODEL_SCHEDULER_URL;process.env.WEFTMATE_MODEL_SCHEDULER_URL='http://127.0.0.1:'+schedulerAddress.port;
  const previousTimeout=process.env.WEFTMATE_STREAM_IDLE_TIMEOUT_MS; process.env.WEFTMATE_STREAM_IDLE_TIMEOUT_MS='700';
  const runtime=new DshWebRuntime({homeDir:home,workspaceDir:workspace,runtimePath:join(process.cwd(),'vendor/dsh-runtime'),patchFiles:[patch],
    credentialRequestHandler:async({operation})=>operation==='resolve'?{value:'synthetic-key'}:{configured:true,writable:true},log() {}});
  const events=async()=> (await readFile(eventsFile,'utf8').catch(()=> '')).trim().split('\n').filter(Boolean).map(row=>JSON.parse(row));
  async function until(check:()=>Promise<any>){const deadline=Date.now()+12000;while(Date.now()<deadline){const value=await check();if(value)return value;await pause(30);}assert.fail('slow stream condition timed out: '+JSON.stringify({mode,attempts,cancellations,rows,phases,eventTypes:(await events()).map(event=>event.type)}));}
  try {
    const origin=await runtime.start();
    const call=async(path:string,body?:object,method=body?'POST':'GET')=>{const response=await fetch(origin+'/weftmate/api/v1'+path,{method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const result:any=await response.json();assert.equal(response.ok,true,JSON.stringify(result));return result;};
    const session=await call('/sessions',{agentPreset:'minimal'}), id=session.sessionId;
    await call(`/sessions/${id}/models`,{provider:'slow-fixture',model:'slow'},'PUT');
    await call(`/sessions/${id}/messages`,{content:'Silent fixture',mode:'queue'});
    await until(async()=> (await events()).find(row=>row.type==='turn/end'));
    const first=await events(),retry=first.filter(row=>row.type==='llm/retry');
    assert.equal(attempts,2,JSON.stringify(rows));assert.equal(retry.length,1);assert.equal(retry[0].data.failure.code,'TIMEOUT');assert.ok(phases.includes('retrying'),'native retry is published to progress');assert.equal(phases.at(-1),'answering');
    assert.ok(rows[0].closed-rows[0].started<2500,'silent stream aborted promptly');
    assert.equal(first.find(row=>row.type==='turn/end').data.reason.kind,'completed');
    mode='progress';await call(`/sessions/${id}/messages`,{content:'Incremental fixture',mode:'queue'});
    await until(async()=> (await events()).filter(row=>row.type==='turn/end').length===2);
    assert.equal(attempts,3); assert.equal((await events()).filter(row=>row.type==='llm/retry').length,1);
    assert.ok(rows[2].closed-rows[2].started>=750,'total duration exceeds idle timeout when deltas continue');
    mode='cancel';await call(`/sessions/${id}/messages`,{content:'Cancel fixture',mode:'queue'});
    await until(async()=>attempts===4); await call(`/sessions/${id}/cancel`,{});
    await until(async()=>rows[3].closed>0);await pause(800);
    assert.equal(attempts,4,'caller cancellation never retries');assert.ok(cancellations>=4);
    const settings=createOfficialDshSettingsClient({origin}), snapshot=await settings.describeSettings();
    await settings.mutateSettings([{op:'set',path:['providers','slow-fixture'],value:{...snapshot.baseProviders['slow-fixture'],streamIdleTimeoutMs:300}}],snapshot.revision);
    mode='override';await call(`/sessions/${id}/messages`,{content:'Provider timeout override fixture',mode:'queue'});
    await until(async()=> (await events()).filter(row=>row.type==='turn/end').length===4);
    assert.equal(attempts,6);assert.equal((await events()).filter(row=>row.type==='llm/retry').length,2);
    assert.ok(rows[4].closed-rows[4].started<650,'explicit provider timeout overrides the 700ms environment default');
  } finally {if(previousTimeout===undefined) delete process.env.WEFTMATE_STREAM_IDLE_TIMEOUT_MS; else process.env.WEFTMATE_STREAM_IDLE_TIMEOUT_MS=previousTimeout;if(previousScheduler===undefined)delete process.env.WEFTMATE_MODEL_SCHEDULER_URL;else process.env.WEFTMATE_MODEL_SCHEDULER_URL=previousScheduler;await runtime.close();scheduler.closeAllConnections();await new Promise<void>(resolve=>scheduler.close(()=>resolve()));server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
}

if (process.argv[1]?.replaceAll('\\','/').endsWith('/integration/model-stream-timeout.ts'))
  test('native idle timeout retries a silent open stream, preserves incremental progress, and remains cancellable', {timeout:60000}, runNativeStreamTimeout);
