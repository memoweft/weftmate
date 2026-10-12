import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createPersonalAccessService } from '../src/personal-access/index.mjs';
import { resolve } from 'node:path';
import { parseChatGPT,parseClaude,parseCodex,parseClaudeCode,readHistory,sourceFiles,importKey } from '../src/personal-access/history-parsers.mjs';
import { createHistoryImport,importChunks,importBoundary,estimateImport } from '../src/personal-access/history-import.mjs';
import { recallQuestions } from '../src/personal-memory/recall-questions.mjs';
const root=resolve('tests/fixtures/mem-1'),file=name=>resolve(root,name);
test('compound import recall keeps actual subquestions within Core batch capacity',()=>{
 assert.deepEqual(recallQuestions('根据我的记忆，我的鹦鹉叫什么，喜欢什么零食？只回答已知内容，不调用工具。'),['我的鹦鹉叫什么','喜欢什么零食']);
 assert.deepEqual(recallQuestions('What is my pet called, and what food does it like?'),['What is my pet called','and what food does it like']);
 assert.deepEqual(recallQuestions('我叫什么？'),[]);
 assert.equal(recallQuestions('谁1，谁2，谁3，谁4，谁5，谁6，谁7，谁8').length,5);
});
test('four read-only adapters retain current branch, final speech, dates and attachment names only',async()=>{
 const [gpt,claude,codex,cc]=await Promise.all([readHistory('chatgpt',file('chatgpt-edge.json')),readHistory('claude',file('claude.json')),readHistory('codex',file('codex/2025/session.jsonl')),readHistory('claude-code',file('claude-code/synthetic-project/session.jsonl'))]);
 assert.equal(gpt.length,3);assert.equal(gpt[1].messages.length,0);assert.ok(importChunks(gpt[2]).length>1);assert.match(gpt[0].messages[0].content,/合成旅行计划.pdf/);assert.equal(gpt[0].at,'2025-03-12T09:00:00.000Z');
 for(const parsed of [gpt,claude,codex,cc])assert.doesNotMatch(JSON.stringify(parsed),/秘密|废弃内容/);
 assert.doesNotMatch(JSON.stringify(parseClaude([{uuid:'synthetic-thinking',chat_messages:[{sender:'assistant',text:'秘密推理',content:[{type:'thinking',thinking:'秘密推理'}]}]}])),/秘密/);
 assert.deepEqual(codex[0].messages.map(m=>m.role),['user','assistant']);assert.equal(cc[0].messages.length,2);
 const historical=importBoundary(gpt[0],{id:'synthetic-import',routeId:'import-synthetic'},importChunks(gpt[0])[0],0);
 assert.equal(historical.source_messages[0].timestamp,Math.floor(Date.parse(gpt[0].at)/1000));
 assert.match(historical.source_messages[0].content,/2025-03-12T09:00:00.000Z/);assert.match(historical.source_messages[0].content,/过去的计划与行程不能当作今天的事实或新任务/);
 const longAssistant=importChunks({...gpt[0],messages:[{role:'user',content:'合成问题',at:gpt[0].at},{role:'assistant',content:'助手上下文'.repeat(9000),at:gpt[0].at}]});assert.ok(longAssistant.length>2);assert.ok(longAssistant.slice(1).every(chunk=>chunk.includes('· 助手]')));
 assert.equal((await sourceFiles('codex',[file('codex')])).length,1);
 assert.equal((await readHistory('chatgpt',file('chatgpt-30.zip'))).length,30);
 const first=(await readHistory('chatgpt',file('chatgpt-30.json')))[0],overlap=(await readHistory('chatgpt',file('chatgpt-overlap.json')))[0];assert.equal(importKey(first),importKey(overlap));
});
test('unknown schemas are explicitly rejected by all adapters',async()=>{
 for(const parse of [parseChatGPT,parseClaude])assert.throws(()=>parse({version:999}),/这个文件的格式认不出/);
 for(const parse of [parseCodex,parseClaudeCode])assert.throws(()=>parse('{"type":"future"}\n'),/这个文件的格式认不出/);
 await assert.rejects(()=>readHistory('chatgpt',file('unknown.json')),/这个文件的格式认不出/);
});
function fixture(){
 let clock=Date.now(),requests=0,fail=false;const state={accounts:{a:{},b:{}}},ledger=[],sources=new Map(),records=[];
 const context={rootState:state,accountState:id=>state.accounts[id],timestamp:()=>clock,serial:async fn=>fn(),mutate:async(id,fn)=>fn(state.accounts[id]),active:new Set(),pendingPreflights:new Set(),
  backend:{listModels:async()=>[{id:'model',model:'mimo-v2.6-flash',name:'MiMo',sourceKind:'cloud'}]},usage:{settings:()=>({prices:{}}),assertAllowed(){},exportAccount:()=>({records})},offline:{invalidate:async()=>{}},
  memoryManager:{query:async(id,method,p)=>{
   if(method==='query_jobs')return{jobs:ledger.filter(j=>j.owner===id)};
   if(method==='query_world')return p.operation==='revision'?{world_revision:1}:{items:[...sources.values()].filter(s=>s.owner===id).map(s=>({provenance:[{evidence_id:s.id}]}))};
   if(method==='preview_forget')return{items:[{object_kind:'cognition',item_id:p.target_id,name:'合成记忆'}]};
   if(method==='retry_formation'){const source=ledger.find(j=>j.job_id===p.job_id),eventId=`reprocess:${p.request_id}`;let retry=ledger.find(j=>j.acceptance.boundary_event_id===eventId);if(!retry){retry={...source,job_id:`retry-${p.request_id}`,acceptance:{...source.acceptance,boundary_event_id:eventId},worker:{state:'applied',attempts:1}};ledger.push(retry);}return{event_id:eventId,job_id:retry.job_id};}
   throw Error(method);
  },ingestImport:async(id,b,routeId)=>{if(fail)throw Object.assign(Error('model fail'),{code:'MODEL_FAILED'});requests++;const evidence_id=`e${requests}`;sources.set(evidence_id,{id:evidence_id,owner:id});ledger.push({owner:id,job_id:`j${requests}`,acceptance:{boundary_event_id:b.event_id,evidence_ids:[evidence_id]},worker:{state:'applied',attempts:1}});records.push({sessionId:routeId,tokens:{inputTokens:10,outputTokens:10},cost:.001});return{evidence_ids:[evidence_id]};},submitCommand:async(id,p)=>{sources.delete(p.targetId);return{receipt:{result_state:'applied',storage_cleanup:{state:'complete'}}};},eraseConversationContext:async()=>{}}};
 state.accounts.a.defaultModelProfileId=state.accounts.b.defaultModelProfileId='model';
 return{context,ledger,records,get requests(){return requests;},set fail(v){fail=v;},advance(){clock+=100000;}};
}
const settle=async(manager,n=80)=>{for(let i=0;i<n;i++)await manager.tick();};
test('large selections fit the import request and reject noncanonical or out-of-range bitmaps',async()=>{
 const f=fixture();f.context.active.add('chat');const source=(await readHistory('chatgpt',file('chatgpt-30.json')))[0],count=20000;
 const m=createHistoryImport(f.context,{read:async()=>Array.from({length:count},(_,i)=>({...source,id:`large-${i}`}))});
 const p=await m.preview('a','chatgpt',[file('chatgpt-30.json')]);const bytes=Buffer.alloc(Math.ceil(count/8),255);
 const input={action:'start',previewId:p.previewId,selected:bytes.toString('base64'),confirm:true};
 assert.ok(Buffer.byteLength(JSON.stringify(input))<12*1024);
 await assert.rejects(()=>m.action('a',{...input,selected:input.selected+'='}),/INVALID_REQUEST/);
 await m.action('a',input);assert.equal(m.list('a').imports[0].total,count);assert.equal(f.requests,0);await m.close();
 const x=fixture(),small=createHistoryImport(x.context),q=await small.preview('a','chatgpt',[file('chatgpt-overlap.json')]);
 await assert.rejects(()=>small.action('a',{action:'start',previewId:q.previewId,selected:Buffer.from([128]).toString('base64'),confirm:true}),/INVALID_REQUEST/);await small.close();
});
test('preview makes zero requests; batching, pause/resume/cancel, restart, dedup and whole-import forgetting',async()=>{
 const f=fixture();let manager=createHistoryImport(f.context),p=await manager.preview('a','chatgpt',[file('chatgpt-30.json')]);assert.equal(p.conversationCount,30);assert.equal(f.requests,0);assert.ok(p.estimate.cost[1]>p.estimate.cost[0]);
 assert.equal(manager.list('b').imports.length,0);await assert.rejects(()=>manager.action('b',{action:'start',previewId:p.previewId,selected:p.items.map(i=>i.key),confirm:true}));
 await manager.action('a',{action:'start',previewId:p.previewId,selected:p.items.map(i=>i.key),confirm:true});await manager.tick();const id=manager.list('a').imports[0].id;
 await manager.action('a',{action:'pause',jobId:id});const before=f.requests;await settle(manager,3);assert.equal(f.requests,before);await manager.close();
 manager=createHistoryImport(f.context);assert.equal(manager.list('a').imports[0].state,'paused');await manager.action('a',{action:'resume',jobId:id});await settle(manager);assert.equal(manager.list('a').imports[0].state,'completed');assert.equal(f.requests,30);
 p=await manager.preview('a','chatgpt',[file('chatgpt-overlap.json')]);assert.equal(p.duplicateCount,1);
 assert.doesNotMatch(JSON.stringify(f.context.rootState),/青瓷|荞麦|安静靠窗|收到/);
 const forget=await manager.action('a',{action:'forget-preview',jobId:id});assert.equal(forget.items.length,30);await manager.action('a',{action:'forget',jobId:id,forgetToken:forget.forgetToken,confirm:true});await settle(manager,3);assert.equal(manager.list('a').imports[0].state,'forgotten');
 p=await manager.preview('a','chatgpt',[file('chatgpt-30.json')]);assert.equal(p.duplicateCount,0);await manager.action('a',{action:'start',previewId:p.previewId,selected:[p.items[0].key],confirm:true});const second=manager.list('a').imports[1];await manager.action('a',{action:'cancel',jobId:second.id});const cancelledRequests=f.requests;await settle(manager,4);assert.equal(f.requests,cancelledRequests);await manager.close();
});
test('crash after Core acceptance reuses durable receipt; chat wins and consecutive failures stop with backoff',async()=>{
 const f=fixture(),m=createHistoryImport(f.context),p=await m.preview('a','chatgpt',[file('chatgpt-30.json')]);f.context.active.add('chat');await m.action('a',{action:'start',previewId:p.previewId,selected:[p.items[0].key],confirm:true});await settle(m,2);assert.equal(f.requests,0);assert.equal(m.list('a').imports[0].waitingForChat,true);f.context.active.clear();await settle(m,1);
 const job=f.context.rootState.accounts.a.historyImports[0];assert.equal(f.requests,1);job.items[0].receipts=[];await m.close();const restored=createHistoryImport(f.context);await settle(restored,5);assert.equal(f.requests,1);assert.equal(restored.list('a').imports[0].state,'completed');await restored.close();
 const x=fixture(),bad=createHistoryImport(x.context),q=await bad.preview('a','chatgpt',[file('chatgpt-30.json')]);x.fail=true;await bad.action('a',{action:'start',previewId:q.previewId,selected:[q.items[0].key],confirm:true});await bad.tick();const attempts=x.context.rootState.accounts.a.historyImports[0].failures;await settle(bad,10);assert.equal(x.context.rootState.accounts.a.historyImports[0].failures,attempts);x.advance();await bad.tick();x.advance();await bad.tick();assert.equal(bad.list('a').imports[0].state,'paused');await bad.close();
});
test('local estimates cost zero and include duration range',()=>{const e=estimateImport([{characters:2000,chunks:2}],{modelTier:'local',name:'本机'});assert.deepEqual(e.cost,[0,0]);assert.ok(e.seconds[1]>e.seconds[0]);});
test('cloud cost range includes discounted repeated instructions and undiscounted upper bound',()=>{
 const e=estimateImport([{characters:2000,chunks:2}],{model:'mimo-v2.6-flash'});
 assert.deepEqual(e.inputTokens,[12800,39000]);assert.deepEqual(e.cost,[.00344,.051]);
});

test('pause/cancel reconciles already accepted work without starting another request',async()=>{
 for(const state of ['pause','cancel']){
  const f=fixture(),m=createHistoryImport(f.context),p=await m.preview('a','chatgpt',[file('chatgpt-30.json')]);
  await m.action('a',{action:'start',previewId:p.previewId,selected:p.items.map(i=>i.key),confirm:true});await m.tick();
  const id=m.list('a').imports[0].id,before=f.requests;
  const query=f.context.memoryManager.query;let countFailure=true;
  f.context.memoryManager.query=async(...args)=>{if(args[1]==='query_world'&&countFailure){countFailure=false;throw Error('temporary count failure');}return query(...args);};
  await m.action('a',{action:state,jobId:id});await settle(m,3);
  assert.equal(f.requests,before);assert.equal(m.list('a').imports[0].processed,1);assert.ok(m.list('a').imports[0].memoryCount>0);
  assert.equal(m.list('a').imports[0].state,state==='pause'?'paused':'cancelled');await m.close();
 }
});

test('Core applied and durable successor retries advance once; pending final cleanup never unlocks reimport',async()=>{
 const f=fixture(),m=createHistoryImport(f.context),p=await m.preview('a','chatgpt',[file('chatgpt-30.json')]);await m.action('a',{action:'start',previewId:p.previewId,selected:[p.items[0].key],confirm:true});await m.tick();f.ledger[0].worker={state:'dead',attempts:3};await m.tick();const id=m.list('a').imports[0].id;assert.equal(m.list('a').imports[0].state,'paused');await m.action('a',{action:'resume',jobId:id});await settle(m,5);assert.equal(m.list('a').imports[0].state,'completed');assert.equal(f.ledger.length,2);assert.equal(f.ledger[0].worker.state,'dead');assert.equal(f.requests,1);
 f.context.memoryManager.eraseConversationContext=async()=>({storage_cleanup:{state:'pending'}});const forget=await m.action('a',{action:'forget-preview',jobId:id});await m.action('a',{action:'forget',jobId:id,forgetToken:forget.forgetToken,confirm:true});await m.tick();assert.equal(m.list('a').imports[0].state,'forgetting');assert.equal((await m.preview('a','chatgpt',[file('chatgpt-30.json')])).duplicateCount,1);f.context.memoryManager.eraseConversationContext=async()=>({storage_cleanup:{state:'complete'}});f.advance();await m.tick();assert.equal(m.list('a').imports[0].state,'forgotten');await m.close();
});
test('cancel remains final when a delayed read fails; unknown actual prices are never zero',async()=>{
 const f=fixture();let release,started;const waiting=new Promise(resolve=>release=resolve),reading=new Promise(resolve=>started=resolve);let delayed=false;
 const m=createHistoryImport(f.context,{read:async(...args)=>{if(delayed){started();await waiting;throw Object.assign(Error('missing'),{code:'IMPORT_SOURCE_UNAVAILABLE'});}return readHistory(...args);}});
 const p=await m.preview('a','chatgpt',[file('chatgpt-30.json')]);delayed=true;await m.action('a',{action:'start',previewId:p.previewId,selected:[p.items[0].key],confirm:true});await reading;const id=m.list('a').imports[0].id;await m.action('a',{action:'cancel',jobId:id});release();await m.tick();assert.equal(m.list('a').imports[0].state,'cancelled');f.records.push({sessionId:`import-${id}`,tokens:{inputTokens:100,outputTokens:100},cost:null});assert.equal(m.list('a').imports[0].usage.cost,null);assert.equal(m.list('a').imports[0].usage.unpricedRequests,1);await m.close();
});

test('authenticated import contract persists refs across service restart, rejects browser paths and isolates accounts',async()=>{
 const root=await mkdtemp(resolve(tmpdir(),'weftmate-mem1-unit-')),f=fixture();let service,origin;
 const backend={...f.context.backend,getStatus:async()=>({runtime:'ready'}),listModels:async()=>[{id:'model',model:'mimo-v2.6-flash',name:'合成模型',configured:true,source:'host',sourceKind:'cloud'}],preflight:async()=>({ok:true}),createSession:async()=>({}),sendMessage:async()=>({}),cancelSession:async()=>({}),readEvents:async()=>({events:[],hasMore:false,nextSeq:-1}),describeSession:async()=>null};
 const memory={...f.context.memoryManager,status:async()=>({state:'ready',capabilities:{list:true}}),peek:()=> 'ready',receiptByRequest:async()=>({}),retryCleanupByRequest:async()=>({})};
 const start=async()=>{service=await createPersonalAccessService({root,port:0,backend,memoryManager:memory,sharedProfileIsFormal:()=>true});origin=(await service.start()).origin;};
 async function api(path,body,auth,token=false,method=body?'POST':'GET'){
  const r=await fetch(origin+'/personal/v1'+path,{method,headers:{origin,...(body?{'content-type':'application/json'}:{}),...(auth?{cookie:auth.cookie,'x-weftmate-csrf':auth.csrf}:{}),...(token?{'x-weftmate-desktop':service.libraryDesktopToken}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
 }
 try{await start();const register=async username=>{const primary=username==='ImportAccountA';const grant=primary?(await service.issueSetupGrant()).grant:null;const r=await api(primary?'/auth/setup':'/auth/register',{username,password:'synthetic password for imports',deviceName:'synthetic-host',...(primary?{grant}:{})},null);assert.equal(r.status,201);return{cookie:r.cookie,csrf:r.body.csrfToken,owner:r.body.account.ownerId};};const a=await register('ImportAccountA'),b=await register('ImportAccountB');
  const setting=await api('/settings/models',{defaultModelProfileId:'model'},a,false,'PATCH');assert.equal(setting.status,200,JSON.stringify(setting.body));
  const body={action:'import-preview',app:'chatgpt',paths:[file('chatgpt-30.json')]};const rejected=await api('/memory/backfill',body,a);assert.equal(rejected.status,403,JSON.stringify(rejected.body));
  const preview=await api('/memory/backfill',body,a,true);assert.equal(preview.status,200);assert.equal(f.requests,0);assert.doesNotMatch(JSON.stringify(preview.body),/"file"|"locator"|青瓷|荞麦/);
  assert.equal((await api('/memory/backfill',{action:'import-start',previewId:preview.body.previewId,selected:[preview.body.items[0].key],confirm:true},b)).status,409);
  const started=await api('/memory/backfill',{action:'import-start',previewId:preview.body.previewId,selected:[preview.body.items[0].key],confirm:true},a);assert.equal(started.status,202,JSON.stringify(started.body));const id=started.body.imports[0].id;await api('/memory/backfill',{action:'import-pause',jobId:id},a);
  assert.deepEqual((await api('/memory/status',null,b)).body.imports,[]);await service.close();await start();
  assert.equal((await api('/memory/status',null,a)).body.imports[0].state,'paused');await api('/memory/backfill',{action:'import-resume',jobId:id},a);
  const end=Date.now()+10000;let job;do{job=(await api('/memory/status',null,a)).body.imports[0];if(job.state==='completed')break;await new Promise(r=>setTimeout(r,100));}while(Date.now()<end);
  assert.equal(job.state,'completed');assert.equal(f.requests,1);const stored=await readFile(resolve(root,'store.json'),'utf8');assert.doesNotMatch(stored,/青瓷|荞麦|安静靠窗/);
 }finally{await service?.close();await rm(root,{recursive:true,force:true});}
});
