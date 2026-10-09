/** MF-1: synthetic accounts, real Core, timestamped formation and immediate recall. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, openSync, closeSync, readFileSync, rmSync, utimesSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPersonalMemoryManager } from '../../src/personal-memory/index.mjs';
import { MemoWeftRpc } from '../../src/personal-memory/rpc.mjs';
import { boundaryForCompletedTurn } from '../../src/plugins/weftmate-personal-memory.mjs';
import { createModelScheduler } from '../../src/model-scheduler.mjs';
const arg = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name)+1] : fallback;
const model = arg('--model','mimo'), single = process.argv.includes('--single-slot');
const out = resolve(arg('--out',`tests/evidence/mf-1/before-${model}${single?'-single':''}`));
const core = resolve(arg('--core-source','D:/AIProjects/MemoWeft/Worktrees/mf-1-memory-freshness/py/src'));
const env = (name, scope) => execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`[Console]::Out.Write([Environment]::GetEnvironmentVariable('${name}','${scope}'))`],{encoding:'utf8',windowsHide:true}).trim();
const key = model==='synthetic'?'synthetic-key':env(model==='mimo'?'MIMO_API_KEY':'WEFTMATE_LAN_MODEL_KEY',model==='mimo'?'Machine':'User');
const base = model==='mimo'?'https://api.xiaomimimo.com/v1':model==='lan'?env('WEFTMATE_LAN_MODEL_BASE_URL','User'):null;
assert.ok(key); assert.ok(['mimo','lan','synthetic'].includes(model));
const privateValues = [key,...(model==='lan'?[base,new URL(base).host]:[])];
const safe = text => privateValues.reduce((value, secret)=>value.replaceAll(secret,'[private]'),text);
mkdirSync(out,{recursive:true});
const root = mkdtempSync(join(tmpdir(),'weftmate-mf1-'));
const instrumentation = join(root, 'instrumentation'); mkdirSync(instrumentation);
copyFileSync(new URL('./mf1-core-phases.py', import.meta.url), join(instrumentation, 'sitecustomize.py'));
const owner = `owner-${randomUUID()}`, start = performance.now(), events = [], requests = [];
const save = () => writeFileSync(join(out,'timeline.json'),safe(JSON.stringify({model,single,root,core,startedAt:Date.now()-Math.round(performance.now()-start),events,requests},null,2))+'\n');
const stamp = (phase,data={}) => {const row={ms:Math.round(performance.now()-start),phase,...data};events.push(row);save();return row;};
const pause = ms=>new Promise(resolve=>setTimeout(resolve,ms));
const lock='D:/AIProjects/WeftMate/Runtime/Orchestrator/lan.lock', lockToken=`MF-1 timeline ${randomUUID()}`;
let lockTimer, locked=false, manager, scheduler, interrupted=false, chatComplete;
if(model==='lan') {const fd=openSync(lock,'wx');try{writeFileSync(fd,lockToken+' '+new Date().toISOString());}finally{closeSync(fd);}locked=true;lockTimer=setInterval(()=>{if(readFileSync(lock,'utf8').startsWith(lockToken))utimesSync(lock,new Date(),new Date());},60000);}
const server = createServer(async(req,res)=>{
  if(req.url==='/props'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({total_slots:single?1:8}));return;}
  let raw='';for await(const part of req)raw+=part;
  const input=JSON.parse(raw), record={id:requests.length+1,startMs:Math.round(performance.now()-start),input};requests.push(record);stamp('model-start',{id:record.id});
  if(single && process.argv.includes('--interrupt-formation') && !interrupted) {
    interrupted=true;
    chatComplete=(async()=>{await pause(100);stamp('greeting-arrived');const lease=await fetch(`${scheduler.url}/lease?priority=foreground&profileId=mf1`,{method:'POST'});stamp('greeting-slot-granted');await pause(400);await lease.body.cancel();stamp('greeting-finished');})();
  }
  try {
    if(model==='synthetic') {
      await new Promise(resolve=>{const timer=setTimeout(resolve,process.argv.includes('--interrupt-formation')?1500:400);res.once('close',()=>{clearTimeout(timer);resolve();});});
      if(res.destroyed){record.cancelled=true;stamp('model-cancelled',{id:record.id});return;}
      const payload=JSON.parse(input.messages.at(-1).content),e=payload.evidence[0];
      record.response={choices:[{message:{content:JSON.stringify({schema_version:8,result:'cognitions',cognitions:[{action:'form',target:'owner_self',statement_kind:'preference',formed_by:'stated',proposition:e.text,supports:e.segments.map(s=>({evidence_id:e.id,segment_id:s.id}))}]})},finish_reason:'stop'}],usage:{prompt_tokens:0,completion_tokens:0}};
    } else {
      const response=await fetch(`${base.replace(/\/$/,'')}/chat/completions`,{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify({...input,stream:false,stream_options:undefined,model:model==='mimo'?'mimo-v2.6-flash':'local-quality'}),signal:AbortSignal.timeout(300000)});
      record.status=response.status;record.raw=await response.text();record.response=JSON.parse(record.raw);
    }
    record.endMs=Math.round(performance.now()-start);stamp('model-end',{id:record.id,status:record.status??200});
    res.writeHead(record.status??200,{'content-type':'application/json'});res.end(JSON.stringify(record.response));
  } catch(error){record.error=safe(String(error));stamp('model-error',{id:record.id});res.writeHead(503);res.end('{}');}
});
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const endpoint=`http://127.0.0.1:${server.address().port}/v1`;
  const profile={id:'mf1',baseUrl:endpoint,model:model==='synthetic'?'synthetic':'measured-model'};
  scheduler=await createModelScheduler({isIdle:async()=>true,profileFor:()=>profile,backgroundRoute:async()=>profile,credentialFor:()=>key});
  manager=createPersonalMemoryManager({root,enabled:true,python:'D:/AIProjects/MemoWeft/Core/py/.venv/Scripts/python.exe',pythonPath:core,
    baseUrl:endpoint,model:'@current',credential:()=>key,
    processingRoute:(_owner,session)=>({profileId:'mf1',baseUrl:scheduler.memoryBaseUrl('mf1',owner,session),model:profile.model,credential:key,routeFingerprint:null,modelTier:model==='lan'?'local':'cloud'}),
    rpcFactory:options=>{const rpc=new MemoWeftRpc({...options,pythonPath:`${instrumentation}${process.platform==='win32'?';':':'}${core}`,env:{...options.env,MF1_CORE_PHASES:join(root,'core-phases.jsonl')}});const request=rpc.request.bind(rpc);rpc.request=async(method,params,...rest)=>{const t=performance.now();const result=await request(method,params,...rest);if(!['query_jobs','query_world','preview_recall','query_interactions'].includes(method))stamp(`rpc-${method}`,{durationMs:Math.round(performance.now()-t),result});return result;};return rpc;}});
  const cases=model==='synthetic'?[['我喝咖啡时偏好加一小撮肉桂粉。','我喝咖啡喜欢加什么？']]:[
    ['以后请用中文解释，少用术语，多举日常例子。','帮我解释一下缓存和数据库的区别。'],
    ['我最近只能周三晚上锻炼，安排运动时帮我记着。','下周给我安排一次锻炼，放在哪天比较合适？'],
    ['不对，是周五晚上。','下周给我安排一次锻炼，放在哪天比较合适？'],
    ['以后叫我小禾就好。','你平时怎么称呼我？'],
    ['王小明是我的表弟。','王小明和我是什么关系？']];
  for(const [index,[text,query]] of cases.slice(0,Number(arg('--count',cases.length))).entries()) {
    const session=`mf1-source-${index}`;
    const stream=[{seq:1,type:'turn/start',data:{turn:1}},{seq:2,type:'user/message',data:{id:`user-${index}`,source:{kind:'user'},content:[{type:'text',text}]}},{seq:3,type:'assistant/message',data:{message:{id:`assistant-${index}`,content:[{type:'text',text:'收到'}]}}},{seq:4,type:'turn/end',data:{turn:1,reason:{kind:'stop'}}}];
    let lease;
    if(single && !process.argv.includes('--interrupt-formation')){lease=await fetch(`${scheduler.url}/lease?priority=foreground&profileId=mf1`,{method:'POST'});assert.equal(lease.status,200);stamp('chat-slot-granted',{queue:scheduler.queue.status()});setTimeout(()=>{void lease.body.cancel();stamp('chat-slot-released');},4000);}
    stamp('turn-complete',{index,text});await manager.ingest(owner,boundaryForCompletedTurn({id:session,header:{agentPreset:'personal-shared-chat'},events:stream},stream.at(-1)));stamp('ingest-return',{index});
    stamp('immediate-recall',{index,result:await manager.recall(owner,{query,sessionId:`new-${index}`,modelTier:'cloud'})});
    let last='',settled=false;const deadline=Date.now()+180000;
    while(Date.now()<deadline){const jobs=await manager.query(owner,'query_jobs',{operation:'list'});const summary=JSON.stringify(jobs);if(summary!==last){stamp('jobs',{index,result:jobs});last=summary;}
      if(jobs.jobs?.length&&!jobs.jobs.some(j=>['pending','processing','retry'].includes(j.worker?.state))){settled=true;break;}await pause(100);}
    stamp('settled',{index,settled,world:await manager.query(owner,'query_world',{operation:'list',object_kind:'cognition',include_history:true}),recall:await manager.recall(owner,{query,sessionId:`settled-${index}`,modelTier:'cloud'})});
  }
} finally {await chatComplete;await manager?.close();await scheduler?.close();await new Promise(resolve=>server.close(resolve));clearInterval(lockTimer);if(locked&&readFileSync(lock,'utf8').startsWith(lockToken))rmSync(lock);if(existsSync(join(root,'core-phases.jsonl')))copyFileSync(join(root,'core-phases.jsonl'),join(out,'core-phases.jsonl'));save();}
console.log(`MF-1 ${model} timeline: ${out}; ${requests.length} model calls.`);
