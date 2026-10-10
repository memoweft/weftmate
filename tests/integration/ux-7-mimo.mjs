// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER,PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
async function until(read,timeout=120000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const value=await read();if(value)return value;await new Promise(done=>setTimeout(done,200));}throw new Error('isolated runtime condition timed out');}
assert.ok(process.env.UX3_MIMO_KEY,'MiMo credential must be supplied in process memory');
const root=mkdtempSync(join(tmpdir(),'weftmate-ux7-mimo-')),profile=join(root,'profile');mkdirSync(profile);
writeFileSync(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const credentials={username:'ThinkingFixture',password:`synthetic-${randomUUID()}-password`,deviceName:'隔离推理验收'};
const backend=Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(method=>[method,async()=>method==='listModels'?[]:{}]));
const preparation=await createPersonalAccessService({root:join(profile,'personal-access'),port:0,backend});
const prepared=await preparation.start(),grant=await preparation.issueSetupGrant();
const response=await fetch(prepared.origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin:prepared.origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,...credentials})});assert.equal(response.status,201);await preparation.close();
const wireFile=join(root,'wire.jsonl');
const hook=join(root,'wire-hook.mjs');writeFileSync(hook,`process.env.UX3_WIRE_FILE=${JSON.stringify(wireFile)};await import(${JSON.stringify(new URL('./ux-3-wire-hook.mjs',import.meta.url).href)});`);
const env={...process.env,UX3_WIRE_FILE:wireFile,UX3_HOOK_MODULE:new URL("file:///"+hook.replaceAll("\\","/")).href};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
let app,attemptUsage=null;const evidence=resolve('tests/evidence/ux-7');mkdirSync(evidence,{recursive:true});
try{
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['tests/integration/ux-3-runtime-electron.mjs',`--user-data-dir=${profile}`,'--personal-host','--access-port=0'],env,timeout:90000});
 app.process().stderr?.on('data',data=>process.stderr.write(data));
 const page=await app.firstWindow();page.setDefaultTimeout(60000);await page.waitForURL('**/personal/v1/ui');await localUiSession(page,credentials);
 const api=async(path,body,method)=>page.evaluate(async({path,body,method})=>{const me=body?await(await fetch('/personal/v1/auth/me')).json():{};const response=await fetch('/personal/v1'+path,{method:method||(body?'POST':'GET'),headers:body?{'content-type':'application/json','x-weftmate-csrf':me.csrfToken}:{},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json()};},{path,body,method});

 assert.equal((await api('/account/models',{requestId:'ux7-mimo-model',name:'合成账号 MiMo',baseUrl:'https://api.xiaomimimo.com/v1',modelId:'mimo-v2.6-flash',apiKey:'synthetic-not-provider-key'})).status,202);
 await until(async()=> (await api('/account/models/by-request/ux7-mimo-model')).body.operation?.status==='succeeded');
 const models=(await api('/models')).body.models,modelProfileId=models.find(row=>row.model==='mimo-v2.6-flash').id;
 const hostId=(await api('/status')).body.hostId;
 const command=async body=>{const response=await api('/commands',{requestId:'ux7-'+randomUUID(),targetDeviceId:hostId,...body});assert.equal(response.status,202,JSON.stringify(response.body));return until(async()=>{const row=(await api('/commands/'+response.body.command.commandId)).body.command;assert.notEqual(row.state,'rejected',JSON.stringify(row));return row.state==='accepted_by_dsh'&&row;});};
 const sessionId=(await command({kind:'session.create',modelProfileId})).sessionId;
 const prompts=[
  '我要做一个十分钟的项目周报，主题是网站上线。请给三点提纲，每点一句，不调用工具。',
  '请继续展开第二点“上线检查”，列出三个具体检查项。不调用工具。',
  '把刚才的上线检查整理成一小段可复制的待办清单，保留三个要点。不调用工具。',
  '我准备明天上午九点执行这份清单，请给我一句适合写在提醒里的短句。先不要真的设提醒，不调用工具。',
  '工作结束后想向同事汇报，请把这次安排写成两句自然的消息。不调用工具。'
 ];
 const turns=[];let ended=0;
 for(const prompt of prompts){
  const started=Date.now();await command({kind:'session.message',sessionId,text:prompt});
  const events=await until(async()=>{const events=(await api(`/sessions/${sessionId}/events?limit=100`)).body.events||[];return events.filter(e=>e.type==='turn.ended').length>ended&&events;});ended++;
  const reply=events.filter(e=>e.type==='assistant.message').at(-1)?.data.text||'';
  const before=(await api('/usage')).body.total;
  const suggestionStarted=Date.now(),suggestions=await api(`/sessions/${sessionId}/suggestions`,{kind:'replies',requestId:'quality-'+ended});
  assert.equal(suggestions.status,200,JSON.stringify(suggestions.body));
  const after=(await api('/usage')).body.total;
  turns.push({round:ended,prompt,reply,replyMs:suggestionStarted-started,suggestions:suggestions.body.suggestions,suggestionMs:Date.now()-suggestionStarted,
    usage:{requests:after.requests-before.requests,inputTokens:after.inputTokens-before.inputTokens,cachedInputTokens:after.cachedInputTokens-before.cachedInputTokens,outputTokens:after.outputTokens-before.outputTokens,cost:after.cost-before.cost}});
  console.log('UX-7 MiMo round',ended,JSON.stringify(turns.at(-1)));
 }
 const completionStarted=Date.now(),completion=await api(`/sessions/${sessionId}/suggestions`,{kind:'completion',draft:'请把刚才的安排',requestId:'quality-completion'});
 const usage=(await api('/usage')).body;attemptUsage=usage;
 const wire=existsSync(wireFile)?readFileSync(wireFile,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
 writeFileSync(join(evidence,'mimo-quality.json'),JSON.stringify({realElectron:true,realPinnedDsh:true,turns,completion:{draft:'请把刚才的安排',...completion.body,durationMs:Date.now()-completionStarted},usage,wire},null,2)+'\n');
 assert.equal(turns.length,5);assert.ok(turns.some(row=>row.suggestions.length>0),'contextual suggestions should be produced in the coherent conversation');for(const row of turns)assert.ok(row.suggestions.every(text=>[...text].length<=24));
 console.log('UX-7 MiMo five-round quality passed');
}catch(error){const page=(await app?.windows())?.find(p=>p.url().includes('/personal/v1/ui'));if(page)await page.screenshot({path:join(evidence,'mimo-failure.png')});throw error;}
finally{if(existsSync(wireFile)){const file=join(evidence,'mimo-attempts.json');const attempts=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):[];attempts.push({at:new Date().toISOString(),usage:attemptUsage,wire:readFileSync(wireFile,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)});writeFileSync(file,JSON.stringify(attempts,null,2)+'\n');}await app?.close();rmSync(root,{recursive:true,force:true});}

