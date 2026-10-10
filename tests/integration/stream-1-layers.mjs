import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DshWebRuntime } from '../../src/dsh-web-runtime.ts';
import { routeForProfile, writeModelRoutesPatch } from '../../src/harness-model-routes.ts';

const out=resolve('tests/evidence/stream-1');mkdirSync(out,{recursive:true});
const root=mkdtempSync(join(tmpdir(),'weftmate-stream1-layers-')),home=join(root,'home');mkdirSync(home);
const trace=join(root,'native.jsonl'),timeline=[],started=Date.now();
const pause=ms=>new Promise(done=>setTimeout(done,ms));
const server=createServer(async(req,res)=>{
  if(req.method!=='POST')return res.writeHead(404).end();
  let raw='';for await(const part of req)raw+=part;const input=JSON.parse(raw);
  res.writeHead(200,{'content-type':'text/event-stream'});
  for(const text of ['第一段。','第二段。','第三段。','第四段。']){
    await pause(300);timeline.push({layer:'provider',at:Date.now(),text});
    res.write(`data: ${JSON.stringify({id:'fixture',choices:[{index:0,delta:{content:text},finish_reason:null}]})}\n\n`);
  }
  res.end('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const profiles=[{id:'stream1',name:'Synthetic stream',provider:'openai-compatible',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'synthetic-stream'}];
const patch=join(home,'routes.yml');writeModelRoutesPatch(patch,profiles);
const plugin=join(root,'observe.mjs');writeFileSync(plugin,`import {appendFileSync} from 'node:fs';export default ctx=>ctx.on('session/event',(session,event)=>{if(['assistant/chunk','assistant/message','turn/end'].includes(event.type))appendFileSync(${JSON.stringify(trace)},JSON.stringify({at:Date.now(),seq:event.seq,type:event.type,chunk:event.data?.chunk?.type,length:event.data?.chunk?.text?.length})+'\\n');});`);
const observe=join(home,'observe.yml');writeFileSync(observe,`- insert:\n    - id: stream1-observe\n      name: ${pathToFileURL(plugin).href}\n`);
const security=join(home,'security.yml');writeFileSync(security,'- id: credentials\n  disabled: true\n- id: weftmate-credentials\n  disabled: true\n- insert:\n    - id: weftmate-safe-credentials\n      name: ./plugins/weftmate-credentials.mjs\n');
const runtime=new DshWebRuntime({homeDir:home,workspaceDir:join(root,'workspace'),runtimePath:resolve('vendor/dsh-runtime'),patchFiles:[patch,security,observe],credentialRequestHandler:async({operation})=>operation==='resolve'?{value:'synthetic-key'}:{configured:true,writable:true},readyTimeoutMs:45000});
try{
 const origin=await runtime.start();
 const api=async(path,body,method=body?'POST':'GET')=>{const r=await fetch(origin+'/weftmate/api/v1'+path,{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});assert.ok(r.ok,`${path}: ${r.status}`);return r.json();};
 const session=(await api('/sessions',{})).sessionId;
 await api(`/sessions/${session}/models`,{provider:routeForProfile('stream1').provider,model:'synthetic-stream'},'PUT');
 await api(`/sessions/${session}/messages`,{content:'合成流式测试',mode:'queue'});
 let ended=false;
 for(let n=0;n<150&&!ended;n++){
   const page=await api(`/sessions/${session}/history?limit=100`);
   timeline.push({layer:'gateway',at:Date.now(),events:page.events.map(e=>({type:e.type,seq:e.seq,length:e.data?.text?.length})),liveEvents:page.liveEvents});
   ended=page.events.some(e=>e.type==='turn.ended');await pause(50);
 }
 assert.ok(ended);
 const native=readFileSync(trace,'utf8').trim().split('\n').map(JSON.parse);
 const report={started,timeline,native,synthetic:true,chunkIntervalMs:300};
 const phase=process.argv.includes('--after')?'after':'before';writeFileSync(join(out,`layers-${phase}.json`),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({phase,providerChunks:timeline.filter(x=>x.layer==='provider').length,nativeChunks:native.filter(x=>x.chunk==='text-delta').length,publicMessages:timeline.filter(x=>x.layer==='gateway').at(-1).events.filter(x=>x.type==='assistant.message').length,liveObservations:timeline.filter(x=>x.liveEvents?.length).length}));
}finally{await runtime.close();server.closeAllConnections();await new Promise(done=>server.close(done));rmSync(root,{recursive:true,force:true});}
