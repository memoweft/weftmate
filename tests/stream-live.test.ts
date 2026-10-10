import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { liveMessages } from '../src/runtime/dsh-adapter/live-messages.mjs';
import { createDshSessionAdapter } from '../src/runtime/dsh-adapter/sessions.mjs';
import { createSessionOperations } from '../src/personal-access/sessions.mjs';
import { completionStream, parseCompletion } from '../src/personal-access/next-suggestions.mjs';
import { eraseSessionMemoryArtifact } from '../src/runtime/dsh-adapter/memory-erasure.mjs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const entry=(seq,type,data={})=>({seq,time:1700000000000+seq,type,data});
const chunk=(seq,text,step=1)=>entry(seq,'assistant/chunk',{turn:1,step,chunk:{type:'text-delta',text}});
const start=()=>[entry(0,'turn/start',{turn:1}),entry(1,'user/message',{source:{kind:'user'},content:[{type:'text',text:'hello'}]})];
const message=(seq,step,text,sourceEventSeqs)=>({...entry(seq,'assistant/message',{turn:1,step,message:{content:[{type:'text',text}]}}),sourceEventSeqs});

test('live snapshots keep native anchors, cumulative text, reasoning private and final text authoritative across tool steps',async()=>{
 const events:any[]=start();events.push(entry(2,'assistant/chunk',{turn:1,step:1,chunk:{type:'reasoning-delta',text:'PRIVATE'}}),chunk(3,'第一'),chunk(4,'段'));
 let snapshot=liveMessages(events,text=>text);assert.equal(snapshot[0].seq,2);assert.equal(snapshot[0].data.text,'第一段');assert.equal(snapshot[0].data.cursor,4);assert.doesNotMatch(JSON.stringify(snapshot),/PRIVATE/);
 events.push(message(5,1,'第一段',[2,3,4]),entry(6,'tool/call',{turn:1,name:'read_file',callId:'c',arguments:{path:'synthetic'}}),entry(7,'tool/result',{turn:1,message:{source:{callId:'c'},content:[]}}),chunk(8,'工具后',2),chunk(9,'回复',2));
 snapshot=liveMessages(events,text=>text);assert.equal(snapshot.length,1);assert.equal(snapshot[0].seq,8);assert.equal(snapshot[0].data.text,'工具后回复');
 const read:any=async()=>events;
 const adapter=createDshSessionAdapter({sessions:{list:async()=>({result:{ok:true,value:{items:[{sessionId:'s'}]}}})},events:{}},{readLog:read});
 const page=await adapter.historyPage('s',{afterSeq:7});assert.equal(page.liveEvents[0].seq,8);assert.equal(page.nextSeq,9);assert.equal((await adapter.historyPage('s',{beforeSeq:7})).liveEvents,undefined);
 events.push(message(10,2,'最终完整正文',[8,9]),entry(11,'turn/end',{turn:1,reason:{kind:'completed'}}));
 const final=await adapter.historyPage('s',{afterSeq:9});assert.equal(final.liveEvents.length,0);assert.equal(final.events.find(e=>e.type==='assistant.message').data.streamSeq,8);assert.equal(final.events.find(e=>e.type==='assistant.message').data.text,'最终完整正文');
});

test('stop/error snapshots settle without a live indicator, reconnect rebuilds exact text, retry replaces failed attempt',()=>{
 for(const reason of ['aborted','error']){
  const events:any[]=[...start(),chunk(2,'已生成'),chunk(3,'内容'),entry(4,'turn/end',{turn:1,reason:{kind:reason}})];
  assert.deepEqual(liveMessages(JSON.parse(JSON.stringify(events)),text=>text),liveMessages(events,text=>text));
  assert.equal(liveMessages(events,text=>text)[0].data.streaming,false);
 }
 const events:any[]=[...start(),chunk(2,'失败尝试'),entry(3,'assistant/chunk',{turn:1,step:1,chunk:{type:'finish',reason:{kind:'error'}}}),chunk(4,'重试正文')];
 assert.equal(liveMessages(events,text=>text)[0].data.text,'重试正文');assert.equal(liveMessages(events,text=>text)[0].seq,4);
});

test('live snapshots have no separate erasure cache and D33 rejects forgotten provenance and deleting/cleanup accounts',()=>{
 const events:any[]=[...start(),chunk(2,'ERASED_SECRET')];
 const account:any={sessions:{s:{forgottenSeqs:[]}}};
 const service=createSessionOperations({accountState:()=>account} as any);
 assert.equal(service.publicLiveEvents('owner','s',liveMessages(events,x=>x)).length,1);
 account.sessions.s.forgottenSeqs=[1];assert.equal(service.publicLiveEvents('owner','s',liveMessages(events,x=>x)).length,0);
 account.sessions.s.forgottenSeqs=[];account.memoryCleanupPending=true;assert.equal(service.publicLiveEvents('owner','s',liveMessages(events,x=>x)).length,0);
 account.memoryCleanupPending=false;account.sessions.s.deleting=true;assert.equal(service.publicLiveEvents('owner','s',liveMessages(events,x=>x)).length,0);
 assert.equal(liveMessages([],x=>x).length,0);
});

test('logical client snapshot updates deduplicate, retain presentation identity, remove on final and reset on erasure',()=>{
 const context:any={Intl};runInNewContext('globalThis.WeftUiCore={};'+readFileSync('src/ui-core/chat-window.js','utf8'),context);
 const window=context.WeftUiCore.ChatWindow.create(),ref={sessionId:'s',seq:2};
 const live=(text,cursor)=>({seq:2,eventId:'live',orderKey:'002',revision:cursor,at:'2026-10-11T00:00:00Z',sourceRef:ref,type:'assistant.delta',data:{text,cursor,streaming:true}});
 window.merge({liveEvents:[live('一',2)]});const key=window.ordered()[0].presentationKey;
 window.merge({liveEvents:[live('一二三',4)]});assert.equal(window.ordered().length,1);assert.equal(window.ordered()[0].data.text,'一二三');assert.equal(window.ordered()[0].presentationKey,key);
 const final={eventId:'final',orderKey:'005',revision:1,at:'2026-10-11T00:00:00Z',sourceRef:{sessionId:'s',seq:5},type:'assistant.message',data:{text:'完整',streamSeq:2}};
 window.merge({upserts:[final],liveEvents:[live('一',2)]});assert.equal(window.ordered().length,1);assert.equal(window.ordered()[0].data.text,'完整');assert.equal(window.ordered()[0].presentationKey,key);
 window.merge({upserts:[final],liveEvents:[]});assert.equal(window.ordered().length,1);
  window.merge({contentRevision:1});window.merge({contentRevision:2,items:[],liveEvents:[]});assert.equal(window.ordered().length,0);
});

test('late logical/legacy snapshots cannot roll back a newer body or revive a finalized message',()=>{
 const context:any={Intl};runInNewContext('globalThis.WeftUiCore={factories:{}};'+readFileSync('src/ui-core/chat-window.js','utf8')+'\n'+readFileSync('src/ui-core/messages.js','utf8'),context);
 const window=context.WeftUiCore.ChatWindow.create();
 const snapshot=text=>({seq:2,eventId:'live',orderKey:'002',revision:2,at:'2026-10-11T00:00:00Z',sourceRef:{sessionId:'s',seq:2},type:'assistant.delta',data:{text,cursor:2,streaming:true}});
 window.merge({liveRevision:2,liveEvents:[snapshot('新正文')]});window.merge({liveRevision:1,liveEvents:[snapshot('旧正文')]});assert.equal(window.ordered()[0].data.text,'新正文');
 const core:any={state:{selectedSessionId:'s',seenSeq:new Set(),historyEvents:new Map()},observeOptimistic:()=>{}},paints=[];
 const actions=context.WeftUiCore.factories.messages(core,{paintHistoryMessages:events=>paints.push(events),updateAvailability:()=>{}},{});
 actions.appendHistory([],[snapshot('新正文')],4);actions.appendHistory([],[snapshot('旧正文')],3);assert.equal(core.state.historyEvents.get(2).data.text,'新正文');
 actions.appendHistory([{seq:5,type:'assistant.message',data:{text:'最终',streamSeq:2}}],[],5);actions.appendHistory([],[snapshot('旧正文')],6);
 assert.equal(core.state.historyEvents.size,1);assert.equal(core.state.historyEvents.get(5).data.text,'最终');
});

test('completion SSE decodes split Unicode frames, observes usage, parses short text/old JSON and aborts while reading',async()=>{
 const encoder=new TextEncoder(),raw='data: '+JSON.stringify({choices:[{delta:{content:'整理成清单。'}}]})+'\r\n\r\ndata: '+JSON.stringify({usage:{completion_tokens:4}})+'\n\ndata: [DONE]\n\n';
 const bytes=encoder.encode(raw);let usage;
 const response=new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=3)controller.enqueue(bytes.slice(i,i+3));controller.close();}}));
 const text=await completionStream(response,new AbortController().signal,value=>{usage=value;});assert.equal(text,'整理成清单。');assert.equal(usage.completion_tokens,4);
 assert.equal(parseCompletion(text,'请把建议'),'整理成清单。');assert.equal(parseCompletion('{"completion":"请把建议整理成清单。"}','请把建议'),'整理成清单。');assert.equal(parseCompletion('解释\n另一行','草稿'),'');
 const controller=new AbortController();controller.abort();await assert.rejects(completionStream(new Response('data: {}\n'),controller.signal,()=>{}),{name:'AbortError'});
});

test('D33 snippet erasure removes packed native text/reasoning/tool deltas even when the phrase crosses chunk boundaries',async()=>{
 const root=await mkdtemp(join(tmpdir(),'weftmate-stream1-erase-')),file=join(root,'transcript.jsonl');
 const rows=[{type:'session',id:'s',version:1},entry(0,'turn/start',{turn:1}),entry(1,'user/message',{content:[{type:'text',text:'ERASE_THIS_PHRASE'}]}),
  {type:'text-chunks',seq0:2,time0:1,data:{turn:1,step:1,index:0,dt:[1,1],texts:['ERASE_','THIS_','PHRASE']}},
  {type:'reasoning-chunks',seq0:5,time0:4,data:{turn:1,step:1,index:1,dt:[1,1],texts:['ERASE_','THIS_','PHRASE']}},
  {type:'tool-call-chunks',seq0:8,time0:7,data:{turn:1,step:1,index:2,id:'tool',dt:[1,1],args:['ERASE_','THIS_','PHRASE']}},entry(11,'turn/end',{turn:1,reason:{kind:'aborted'}})];
 const content=rows.map(row=>JSON.stringify(row)).join('\n')+'\n';await writeFile(file,content);
 const persistence={readRaw:async()=>({meta:{id:'s'},content}),locate:()=>({path:file}),config:{root}};
 try{await eraseSessionMemoryArtifact(persistence,'s',{sourceTexts:['ERASE_THIS_PHRASE'],deleteConversationSnippets:true});
  const clean=await readFile(file,'utf8');assert.doesNotMatch(clean,/ERASE_|THIS_|PHRASE/);
  const packed=clean.trim().split('\n').map(JSON.parse).filter(row=>row.type.endsWith('-chunks'));
  assert.deepEqual(packed[0].data.texts,['','','']);assert.deepEqual(packed[2].data.args,['','','']);
 }finally{await rm(root,{recursive:true,force:true});}
});


test('STREAM-1b unchanged snapshots do not repaint; growth only paints the reply body',()=>{
 const context:any={WeftUiCore:{factories:{}}};runInNewContext(readFileSync('src/ui-core/messages.js','utf8'),context);
 let paints=0,composer=0;const core:any={state:{selectedSessionId:'s',historyEvents:new Map(),seenSeq:new Set()},observeOptimistic(){}};
 const actions=context.WeftUiCore.factories.messages(core,{paintHistoryMessages(){paints++},updateAvailability(){composer++}},{});Object.assign(core,actions);
 const snapshot=(text:string)=>({seq:2,data:{text,streaming:true,cursor:1}});
 actions.appendHistory([],[snapshot('初字')],1);assert.equal(paints,1);assert.equal(composer,1);
 for(let n=0;n<12;n++)actions.appendHistory([],[snapshot('初字')],1);
 assert.equal(paints,1);assert.equal(composer,1);
 actions.appendHistory([],[{seq:2,data:{text:'初字增字',streaming:true,cursor:2}}],2);
 assert.equal(paints,2);assert.equal(composer,1);
});
