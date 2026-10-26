import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash,webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { createHistoryImport,phoneNeedsConfirmation,estimateImport,importBoundary,importChunks } from '../src/personal-access/history-import.mjs';
import { createPhoneHistory } from '../src/personal-access/phone-history.mjs';
import { reconcileChatIdentity } from '../src/personal-access/chat-identity.mjs';
import { createOfflineService } from '../src/personal-offline/index.mjs';
import { recallEntries } from '../src/personal-memory/recall-questions.mjs';
import { recallDateCases } from './fixtures/recall-date-contract.ts';
import legacyRecall from './fixtures/legacy-recall-output.json' with { type: 'json' };
import unheadedRecall from './fixtures/legacy-unheaded-output.json' with { type: 'json' };
import escapeCases from './fixtures/recall-escape-contract.json' with { type: 'json' };
import { renderRecallReference } from './fixtures/recall-escape-reference.mjs';
import { ACTIVITY_TYPES } from '../src/personal-access/activity-store.mjs';
import '../src/ui-core/offline.js';
const W=(globalThis as any).WeftOffline;
const turn=(id:string,c=id,text='我喜欢茉莉花茶')=>({id,conversationId:c,timestamp:Date.UTC(2025,4,1),messages:[{role:'user',text},{role:'assistant',text:'知道了。'}],memoryRefs:[],dependencyComplete:true});
const modelGate=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>resolve=done);return{promise,resolve};};

test('MODEL-1 and MEM-7 keep the submitted chat model during authorization and use a new selection on the next turn',async t=>{
 const authorization=modelGate(),started=modelGate(),used:any[]=[];let first=true;
 let selected={modelId:'synthetic-chat-a',interfaceType:'openai-compatible'};
 const vault={load:async()=>({snapshot:null,turns:[],conversations:[],tasks:[],forgetConversations:[]}),save:async()=>{},close(){},
  complete:async(body:any,snapshot:any)=>{used.push({modelId:body.model,interfaceType:snapshot.model.interfaceType});return{choices:[{message:{content:'合成回答'}}]};}};
 const engine=await W.create({vault,identity:{ownerId:'synthetic',hostId:'host',deviceId:'phone'},crypto:webcrypto,phoneModel:()=>selected,
  accountCheck:async()=>{if(first){first=false;started.resolve();await authorization.promise;}return{};}});t.after(()=>engine.close());
 const sending=engine.send('第一条');await started.promise;selected={modelId:'synthetic-chat-b',interfaceType:'anthropic'};authorization.resolve();
 const sent=await sending;await engine.send('下一条',sent.conversationId);
 assert.deepEqual(used,[{modelId:'synthetic-chat-a',interfaceType:'openai-compatible'},{modelId:'synthetic-chat-b',interfaceType:'anthropic'}]);
 assert.equal(engine.view().conversations[0].turns.length,2);
});

test('MEM-7 compound recall keeps each filtered topic before extra claims and retains exact Core references',()=>{
 const snapshots=[{preview:{rendered_recall:'记忆：主题甲\n记忆：甲的补充',selected_item_ids:[['cognition','a'],['entity','a-extra']]}},{preview:{rendered_recall:'记忆：姓名',selected_item_ids:[['cognition','name']]}}];
 const entries=recallEntries(snapshots);assert.deepEqual(entries.slice(0,2).map(e=>e.pair),[['cognition','a'],['cognition','name']]);
 assert.equal(entries[1].claim,'记忆：姓名');assert.equal(entries[2].claim,'记忆：甲的补充');assert.equal(entries[1].snapshot,snapshots[1]);
});
for (const lang of ['en', 'zh'] as const) for (const dated of [false, true]) {
 test(`G9 recall entries retain ${lang} current/past ID order, exact dates and multiline bodies (${dated ? 'dated' : 'undated'})`,()=>{
  const headers=lang==='en'?['Memory:', 'Memory (past):']:['记忆：', '记忆（过往）：'];
  const claims=recallDateCases.map((item,index)=>`${headers[index%2]}${dated?` [${item.date}] `:''}${item[lang]}\n${lang==='en'?'Continuation kept verbatim.':'逐字保留的下一行。'}`);
  const pairs=[['cognition','pet'],['event','games'],['cognition','travel']];
  const snapshots=[{preview:{selected_item_ids:pairs,rendered_recall:claims.join(lang==='en'?'\n':'\r\n')}},
   {preview:{selected_item_ids:[['entity','second-topic']],rendered_recall:`${headers[0]}second topic`}}];
  const entries=recallEntries(snapshots);
  assert.deepEqual(entries.map(e=>e.pair),[pairs[0],['entity','second-topic'],pairs[1],pairs[2]]);
  assert.deepEqual(entries.map(e=>e.claim),[claims[0],`${headers[0]}second topic`,claims[1],claims[2]]);
  assert.equal(entries[2].snapshot,snapshots[0]);
 });
}
for (const fixture of legacyRecall.cases.filter(item=>!item.pending&&item.budget===1200)) test(`G9 legacy parser matches main output: ${fixture.name}`,()=>{
 const snapshot={preview:{selected_item_ids:[['cognition','first'],['event','second']],rendered_recall:fixture.renderedRecall}};
 assert.deepEqual(recallEntries([snapshot]).map(({pair,claim})=>({pair,claim})),fixture.entries);
});
for(const fixture of unheadedRecall.cases.filter(item=>!item.pending&&item.budget===1200)) test(`G9 all non-English parser inputs match main: ${fixture.name}`,()=>{
 const snapshot={preview:{selected_item_ids:fixture.pairs,rendered_recall:fixture.renderedRecall}};
 assert.deepEqual(recallEntries([snapshot]).map(({pair,claim})=>({pair,claim})),
  fixture.entries.map(({pair,claim})=>({pair,claim:claim===null?undefined:claim})));
});
test('G9 first-line format never crosses languages and malformed new headers retain unpaired original text',()=>{
 const claims=['Memory: [2026-01-06] A literal Memory: is part of this sentence.\n  Memory (past): quoted continuation.\n记忆力是另一个词。',
  '记忆（过往）：[2026-07-14] 下一条\n  记忆：缩进的原话。'];
 const snapshot={preview:{selected_item_ids:[['cognition','first'],['event','second']],rendered_recall:claims.join('\n')}};
 assert.deepEqual(recallEntries([snapshot]).map(({pair,claim})=>({pair,claim})),[{pair:null,claim:claims.join('\n')}]);
 for(const header of ['Memory:', 'Memory (past):', '记忆：', '记忆（过往）：']) {
  const ambiguous={preview:{selected_item_ids:snapshot.preview.selected_item_ids,
   rendered_recall:`Memory: first body\n${header}literal body line\nMemory: second body`}};
  const rendered=ambiguous.preview.rendered_recall;
  assert.deepEqual(recallEntries([ambiguous]).map(({pair,claim})=>({pair,claim})),[{pair:null,claim:rendered}],
   'new format rejects unescaped Chinese body headers and never falls back to Chinese pairing');
 }
});
for(const fixture of escapeCases) {
 if(fixture.unescaped) test(`G9 review red case stays unpaired: ${fixture.name}`,()=>{
  const snapshot={preview:{selected_item_ids:fixture.items.map(item=>[item.kind,item.id]),rendered_recall:fixture.unescaped}};
  assert.deepEqual(recallEntries([snapshot]).map(({pair,claim})=>({pair,claim})),[{pair:null,claim:fixture.unescaped}]);
 });
 test(`G9 producer reference round trip preserves exact bodies and IDs: ${fixture.name}`,()=>{
  const rendered=renderRecallReference(fixture.items);
  assert.equal(rendered,fixture.rendered,'the shared JSON fixes the exact wire output for the Python producer');
  const snapshot={preview:{selected_item_ids:fixture.items.map(item=>[item.kind,item.id]),rendered_recall:rendered}};
  const entries=recallEntries([snapshot]);
  assert.deepEqual(entries.map(entry=>entry.pair),fixture.items.map(item=>[item.kind,item.id]));
  assert.deepEqual(entries.map(entry=>entry.claim),fixture.items.map(item=>`${item.past?'Memory (past):':'Memory:'}${item.body}`));
 });
}
test('MEM-7 ordinary backend replacements and receiver binding remain live through phone history',async()=>{
 const native={label:'old',async listModels(){return [this.label];}},context:any={accountState:()=>({phoneHistory:{}})};
 const backend=createPhoneHistory(context,native).backend;assert.deepEqual(await backend.listModels(),['old']);
 native.label='new';native.listModels=async function(){return ['replacement:'+this.label];};
 assert.deepEqual(await backend.listModels(),['replacement:new']);
});
async function fixed(t:any){
 const root=await mkdtemp(join(tmpdir(),'weftmate-mem7-unit-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const accounts:any={a:{sessions:{},commands:{},defaultModelProfileId:'local'},b:{sessions:{},commands:{},defaultModelProfileId:'local'}},ledger:any[]=[],sources=new Set(),activity:any[]=[];let requests=0,device='phone-a';
 const ctx:any={root,rootState:{hostId:'synthetic-host',accounts},timestamp:Date.now,accountState:(id:string)=>accounts[id],serial:async(fn:any)=>fn(),mutate:async(id:string,fn:any)=>{fn(accounts[id]);reconcileChatIdentity(accounts[id],'synthetic-host',new Date().toISOString());},active:new Set(),pendingPreflights:new Set(),
  authenticate:()=>({ownerId:'a',deviceId:device,via:'cookie',device:{authKind:'cloud',name:device,scopes:['account:manage','sessions:read']}}),readJson:(r:any)=>r.body,json:(_r:any,_status:any,v:any)=>v,
  modelSelectable:()=>true,service:{currentChatModelProfile:()=>null},backend:{listModels:async()=>[{id:'local',sourceKind:'local',configured:true,name:'本机模型'}],describeSession:async()=>null,readEvents:async()=>({events:[]})},
  usage:{settings:()=>({prices:{}}),assertAllowed(){},exportAccount:()=>({records:[]})},activity:{record:async(_id:string,row:any)=>{assert.ok(ACTIVITY_TYPES.includes(row.type),'real activity contract accepts the import notification');activity.push(row);}},
  cloudIdentity:{publishOffline:async(_id:string,generation:number)=>({hostId:'synthetic-host',accountId:'synthetic-account',generation})},
  memoryManager:{enabled:true,peek:()=> 'connected',query:async(_id:string,m:string,p:any)=>m==='query_jobs'?{jobs:ledger}:m==='query_world'?p.operation==='revision'?{world_revision:1}:{world_revision:1,items:[...sources].map(id=>({provenance:[{evidence_id:id}]}))}:{items:[]},
   ingestImport:async(_id:string,b:any)=>{requests++;const id='e'+requests;sources.add(id);ledger.push({acceptance:{boundary_event_id:b.event_id,evidence_ids:[id]},worker:{state:'applied'}});},
   submitCommand:async(_id:string,p:any)=>{sources.delete(p.targetId);return{receipt:{result_state:'applied',storage_cleanup:{state:'complete'}}};},eraseConversationContext:async()=>({storage_cleanup:{state:'complete'}}),discardOfflinePending:async()=>{}}};
 ctx.phoneHistory=createPhoneHistory(ctx,ctx.backend);ctx.backend=ctx.phoneHistory.backend;ctx.historyImport=createHistoryImport(ctx);ctx.offline=await createOfflineService(ctx);
 t.after(async()=>{await ctx.historyImport.close();await ctx.offline.close();});
 const vault=await W.browserVault('unit',{indexedDB:new IDBFactory(),crypto:webcrypto});t.after(()=>vault.close());
 const identity=()=>({ownerId:'a',hostId:'synthetic-host',deviceId:device});
 const call=(p:string,body:any)=>ctx.offline.handle({method:'POST',body},{},new URL('http://127.0.0.1/personal/v1/offline'+p),'a');
 const sync=async(phoneFirst=true)=>vault.open(await call('/sync',{publicJwk:await vault.key(),generation:0,hashes:{},...(phoneFirst?{phoneFirst:true}:{})}),identity());
 const settle=async(n=100)=>{for(let i=0;i<n;i++)await ctx.historyImport.tick();};
 return {ctx,call,sync,settle,ledger,sources,activity,get requests(){return requests;},set device(v){device=v;},vault};
}
test('MEM-7 phone sync with no cloud model registers receiver, projects ready authority, and preserves legacy model-required response',async t=>{
 const f=await fixed(t),s=await f.sync();assert.equal(s.model,null);assert.equal(s.memoryAuthority.ready,true);assert.ok(s.taskRecipient.n);
 await assert.rejects(f.sync(false),{code:'OFFLINE_MODEL_REQUIRED'});
 f.ctx.memoryManager.peek=()=> 'starting';assert.equal((await f.sync()).memoryAuthority.ready,false);
 f.ctx.memoryManager.enabled=false;await assert.rejects(f.sync(),{code:'MEMORY_UNAVAILABLE'});
});
test('MEM-7 stable receipts, split batches and two phones ingest exactly once through MEM-1 with original dates and visible searchable history',async t=>{
 const f=await fixed(t),s=await f.sync(),handover={id:'batch-a',totalTurns:2,conversationCount:1,complete:false};
 const a=turn('turn-a','conversation-a'),b=turn('turn-b','conversation-a','改口：我现在喜欢乌龙茶');
 const first=await f.call('/turns',{generation:s.generation,turns:[a],handover});assert.ok(first.receipts[0].sessionId);assert.ok(first.receipts[0].chatId);
 assert.equal(f.ctx.historyImport.list('a').imports[0].state,'receiving');await f.settle(2);assert.equal(f.requests,0);
 const retry=await f.call('/turns',{generation:s.generation,turns:[a],handover});assert.equal(retry.receipts[0].sessionId,first.receipts[0].sessionId);
 const otherAccount=await f.ctx.phoneHistory.receive('b','other-account-phone',[a]);assert.notEqual(otherAccount[0].sessionId,first.receipts[0].sessionId,
   'the same original ID cannot alias another account native history or execution ownership');
 await f.call('/turns',{generation:s.generation,turns:[b],handover:{...handover,complete:true}});await f.settle();assert.equal(f.requests,2);
 assert.equal(f.ctx.historyImport.list('a').imports[0].state,'completed');assert.equal(f.activity.at(-1).title,'已把手机上的 1 段对话整理进记忆');
 f.device='phone-b';await f.sync();await f.call('/turns',{generation:s.generation,turns:[a,b],handover:{id:'batch-b',totalTurns:2,conversationCount:1,complete:true}});await f.settle();assert.equal(f.requests,2);
 await assert.rejects(f.call('/turns',{generation:s.generation,turns:[{...a,messages:[{role:'user',text:'改了正文'}]}]}),{code:'REQUEST_CONFLICT'});
 assert.equal(f.ctx.historyImport.list('b').imports.length,0);
 const history=await f.ctx.backend.readEvents({ownerId:'a',sessionId:first.receipts[0].sessionId,afterSeq:-1,limit:100});assert.equal(history.events.length,4);assert.match(history.events[2].data.text,/乌龙茶/);
 const source=f.ctx.historyImport.source('a',f.ledger[0].acceptance.evidence_ids[0]);assert.equal(source.app,'phone');assert.equal(source.originalAt,'2025-05-01T00:00:00.000Z');
 const c=f.ctx.phoneHistory.read('a',createHash('sha256').update('phone-turn-v1:turn-a').digest('hex')),boundary=importBoundary(c,{id:'test-import',routeId:'import-test'},importChunks(c)[0],0);
 assert.deepEqual(boundary.source_messages.map((m:any)=>m.role),['user','assistant']);assert.equal(boundary.source_messages[0].content,a.messages[0].text);
 assert.equal(boundary.source_messages[1].model_context_dependencies.capture_status,'complete_empty');
});
test('MEM-7 thresholds, confirmation, pause/resume and whole-batch forgetting reuse import controls',async t=>{
 const f=await fixed(t),s=await f.sync(),turns=Array.from({length:100},(_,i)=>turn('large-'+i));
 const input={generation:s.generation,turns:turns.slice(0,50),handover:{id:'large',totalTurns:100,conversationCount:100,complete:true}};
 await f.call('/turns',{...input,handover:{...input.handover,complete:false}});await f.call('/turns',{...input,turns:turns.slice(50)});const job=f.ctx.historyImport.list('a').imports[0];assert.equal(job.state,'awaiting_confirmation');await f.settle();assert.equal(f.requests,0);
 await assert.rejects(f.ctx.historyImport.action('a',{action:'confirm',jobId:job.id}),{code:'MEMORY_PREVIEW_REQUIRED'});
 await f.ctx.historyImport.action('a',{action:'confirm',jobId:job.id,confirm:true});await f.ctx.historyImport.tick();
 await f.ctx.historyImport.action('a',{action:'pause',jobId:job.id});const before=f.requests;await f.settle(3);assert.equal(f.requests,before);
 await f.ctx.historyImport.action('a',{action:'resume',jobId:job.id});await f.settle(350);assert.equal(f.ctx.historyImport.list('a').imports[0].state,'completed');
 const p=await f.ctx.historyImport.action('a',{action:'forget-preview',jobId:job.id});await f.ctx.historyImport.action('a',{action:'forget',jobId:job.id,forgetToken:p.forgetToken,confirm:true});await f.settle();assert.equal(f.sources.size,0);assert.equal(f.ctx.historyImport.list('a').imports[0].state,'forgotten');
 assert.equal(Object.keys(f.ctx.accountState('a').phoneHistory).length,100,'forget memory retains original phone history');
 assert.equal(phoneNeedsConfirmation(99,256*1024-1),false);
 assert.equal(phoneNeedsConfirmation(1,256*1024),true);
 const long=Array.from({length:9},(_,i)=>turn('bytes-'+i,'bytes-'+i,'合成背景'.repeat(2500)));
 const current=await f.sync();
 const split={id:'bytes-batch',totalTurns:9,conversationCount:9,bytes:1,complete:false};
 await f.call('/turns',{generation:current.generation,turns:long.slice(0,4),handover:split});
 await f.call('/turns',{generation:current.generation,turns:long.slice(4),handover:{...split,complete:true}});
 assert.equal(f.ctx.historyImport.list('a').imports.find((j:any)=>j.handoverId==='bytes-batch').state,'awaiting_confirmation',
   'threshold includes all persisted packets even when a phone underreports bytes');
});
test('MEM-7 phone initiated deletion erases submitted sources, rejects resurrection and cannot delete another phone source',async t=>{
 const f=await fixed(t),s=await f.sync();await f.call('/turns',{generation:s.generation,turns:[turn('delete-a')]});await f.settle();assert.ok(f.sources.size);
 f.device='other-phone';await f.sync();await assert.rejects(f.call('/turns',{generation:s.generation,turns:[],forgetConversations:['delete-a']}),{code:'FORBIDDEN'});
 f.device='phone-a';const result=await f.call('/turns',{generation:s.generation,turns:[],forgetConversations:['delete-a']});await f.settle();assert.equal(f.sources.size,0);assert.ok(result.generation>s.generation);
 await f.sync();const replay=await f.call('/turns',{generation:result.generation,turns:[turn('delete-a')]});assert.equal(replay.receipts[0].state,'forgotten');assert.equal(Object.keys(f.ctx.accountState('a').phoneHistory).length,0);
});
test('MEM-7 long histories reassemble durably without clipping; partial acknowledgments never confirm a turn',async t=>{
 const f=await fixed(t),s=await f.sync(),original=turn('long','long-conversation','合成事实：'.repeat(4000)),raw=Buffer.from(JSON.stringify(original)),sha256=createHash('sha256').update(raw).digest('hex'),size=48000,count=Math.ceil(raw.length/size);
 const make=(index:number)=>({id:original.id,conversationId:original.conversationId,timestamp:original.timestamp,index,count,encoding:'json-utf8-base64',sha256,data:raw.subarray(index*size,(index+1)*size).toString('base64')});
 await assert.rejects(f.call('/turns',{generation:s.generation,turns:[original]}),{code:'INVALID_REQUEST'});
 const one=await f.call('/turns',{generation:s.generation,turns:[],turnFragments:[make(0)]});assert.equal(one.receipts.length,0);assert.equal(one.fragmentReceipts[0].state,'received');
 await f.ctx.offline.close();f.ctx.offline=await createOfflineService(f.ctx);await f.call('/turns',{generation:s.generation,turns:[],turnFragments:[make(0)]});
 let result;for(let index=1;index<count;index++)result=await f.call('/turns',{generation:s.generation,turns:[],turnFragments:[make(index)]});assert.equal(result.receipts[0].state,'synced');assert.ok(result.receipts[0].importId);
 assert.equal(f.ctx.phoneHistory.read('a',createHash('sha256').update('phone-turn-v1:long').digest('hex')).messages[0].content,original.messages[0].text);
 await f.settle(30);assert.equal(f.ctx.historyImport.list('a').imports[0].state,'completed');assert.ok(f.requests>1);
});

test('MEM-7 account-wide derived replica erasure rotates phone ciphertext while retaining standalone originals',async()=>{
 const db=new IDBFactory(),phone=await W.browserVault('phone:synthetic-source',{indexedDB:db,crypto:webcrypto}),replica=await W.browserVault('replica:synthetic-source',{indexedDB:db,crypto:webcrypto});
 const snapshot={generation:1,control:{accountId:'synthetic-account',hostId:'host'},items:[{text:'正式理解'}],model:{apiKey:'synthetic-copy'}};
 await phone.save({snapshot,conversations:[{id:'original',turns:[turn('original')]}],turns:[turn('pending')]});await replica.save({snapshot,conversations:[],turns:[]});
 await replica.clearAccount('synthetic-account','host',2);phone.close();replica.close();
 const reopened=await W.browserVault('phone:synthetic-source',{indexedDB:db,crypto:webcrypto}),copy=await W.browserVault('replica:synthetic-source',{indexedDB:db,crypto:webcrypto});
 const saved=await reopened.load();assert.equal(saved.snapshot,null);assert.equal(saved.conversations[0].turns[0].messages[0].text,'我喜欢茉莉花茶');assert.equal(saved.turns[0].id,'pending');assert.equal((await copy.load()).snapshot,null);reopened.close();copy.close();
});
