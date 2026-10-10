import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { readFileSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createSessionMetadata } from '../src/personal-access/session-metadata.mjs';
import { nativeTimelineLog } from '../src/runtime/dsh-adapter/timeline.mjs';

const deferred = () => { let resolve: (v?: any) => void; const promise = new Promise(r => { resolve = r; }); return {promise, resolve: resolve!}; };
function selectionFixture() {
  const waits = new Map<string, ReturnType<typeof deferred>>(); let text = '';
  const noop = () => {};
  const context: any = {WeftUiCore:{factories:{},ChatWindow:{create:()=>({state:{},reset:noop})}}};
  runInNewContext(readFileSync('src/ui-core/main-chat.js','utf8'),context);
  const core: any = {state:{identityGeneration:0,ownerId:'synthetic',historyGeneration:0,selectedSessionId:'s0',sessions:[],chats:[{chatId:'c1',activeSessionId:'s1'},{chatId:'c2',activeSessionId:'s2'}]},
    conversationTasks:{generation:0,entries:new Map()},resetConversationApprovals:noop,resetConversationQuestions:noop,
    selectSession:async(id:string)=>{core.state.selectedSessionId=id;await waits.get(id)!.promise;},composerState:()=>({messageDisabled:false,sendDisabled:false}),
    cancelAttachmentUpload:noop};
  const effects:any=new Proxy({readMessageDraft:()=>text,restoreMainChatDraft:(value:string)=>{text=value;}},{get:(target,key)=>target[key]||noop});
  const actions=context.WeftUiCore.factories.mainChat(core,effects,{});
  return {core,actions,waits,setText:(v:string)=>{text=v;},text:()=>text};
}
test('FX-16 selection locks text and attachments until draft restoration, then first input survives',async()=>{
  const f=selectionFixture(),wait=deferred();f.waits.set('s1',wait);
  const selecting=f.actions.selectLogicalSession('s1');
  const loading=f.actions.mainComposerState('');
  assert.equal(loading.messageDisabled,true);assert.equal(loading.sendDisabled,true);assert.equal(loading.attachmentsDisabled,true);
  wait.resolve();await selecting;f.setText('首次输入');assert.equal(f.text(),'首次输入');assert.equal(f.actions.mainComposerState('首次输入').messageDisabled,false);
});
test('FX-16 later selection wins and account boundary discards old restoration',async()=>{
  const f=selectionFixture(),a=deferred(),b=deferred();f.waits.set('s1',a);f.waits.set('s2',b);
  const first=f.actions.selectLogicalSession('s1'),second=f.actions.selectLogicalSession('s2');
  b.resolve();await second;f.setText('第二会话草稿');a.resolve();await first;
  assert.equal(f.text(),'第二会话草稿');assert.equal(f.core.state.selectedChatId,'c2');
  const c=deferred();f.waits.set('s1',c);const third=f.actions.selectLogicalSession('s1');
  f.core.state.identityGeneration++;f.actions.resetLogicalSession();f.setText('新账号');c.resolve();await third;assert.equal(f.text(),'新账号');
});
test('FX-16 list summaries do not read history per request and update from observed events',async()=>{
  let reads=0;const account:any={sessions:{s1:{attachedAt:'2026-01-01T00:00:00Z',readMessageSeq:-1}}};
  const summaries=createSessionMetadata({accountState:()=>account,callBackend:async(fn:any)=>fn(),backend:{readEvents:async()=>{reads++;return {events:[{seq:3,type:'assistant.message',at:'2026-01-02T00:00:00Z'}]};}}} as any);
  await summaries.initialize('owner');await summaries.summary('owner','s1');await summaries.summary('owner','s1');assert.equal(reads,1);
  assert.equal((await summaries.summary('owner','s1')).unread,true);
  account.sessions.s1.readMessageSeq=3;
  assert.equal((await summaries.summary('owner','s1')).unread,false);
  summaries.observe('owner','s1',[{seq:4,type:'assistant.message',at:'2026-01-03T00:00:00Z'}]);
  assert.equal((await summaries.summary('owner','s1')).unread,true);
  summaries.invalidate('owner','s1');account.sessions.s1.forgottenSeqs=[4];
  summaries.observe('owner','s1',[{seq:4,type:'assistant.message',at:'2026-01-03T00:00:00Z'}]);
  assert.equal((await summaries.summary('owner','s1')).unread,false);
});

test('FX-16 Android session paging preserves the complete query through its business adapter',async()=>{
  const context:any={URL,URLSearchParams,setTimeout,clearTimeout,WeftUiCore:{}};
  runInNewContext(readFileSync('src/ui-core/adapters/android-bridge.js','utf8'),context);
  let bridge:any;const calls:any[]=[];
  bridge=context.WeftUiCore.createAndroidBridge({postMessage:(raw:string)=>{
    const request=JSON.parse(raw);calls.push(request);bridge.receive({id:request.id,ok:true,result:{sessions:[],hasMore:true,nextCursor:'session-next'}});
  }});
  const path='/personal/v1/sessions?archived=all&limit=100&cursor=session-old&q=%E7%BA%B8';
  const reply=await bridge.fetch(path);assert.equal(reply.ok,true);
  assert.equal(calls[0].method,'host.business');assert.equal(calls[0].params.path,path);
  const result=await reply.json();assert.equal(result.hasMore,true);assert.equal(result.nextCursor,'session-next');assert.equal(result.source,'host');
});

test('FX-16 native sidebar index builds once and follows live creation, status and deletion',async()=>{
  const handlers=new Map<string,Function>(),live=new Map<string,any>(),agents=new Map<string,any>();let loads=0,lookups=0;
  const ctx:any={get:(name:string)=>name==='sessions'?{get:(id:string)=>{lookups++;return live.get(id);}}:name==='agents'?{get:(id:string)=>agents.get(id)}:undefined,on:(name:string,fn:Function)=>handlers.set(name,fn)};
  const read=nativeTimelineLog(ctx,{cache:false});
  const load=async()=>{loads++;return {items:Array.from({length:500},(_,i)=>({sessionId:'session-'+i,agentPreset:'personal-remote',running:false}))};};
  assert.equal((await read.listSessions(load)).items.length,500);await read.listSessions(load);assert.equal(loads,1);
  lookups=0;assert.equal((await read.sessionSummary('session-250',load)).sessionId,'session-250');assert.equal(lookups,1);
  const session={id:'session-new',header:{agentPreset:'personal-remote'},events:[]};live.set(session.id,session);handlers.get('session/created')!(session);agents.set(session.id,{status:'running'});
  const next=(await read.listSessions(load)).items.find((row:any)=>row.sessionId===session.id);assert.equal(next.running,true);assert.equal(next.agentPreset,'personal-remote');
  read.removeSession(session.id);assert.equal((await read.listSessions(load)).items.length,500);assert.equal(loads,1);
});

test('FX-16 mobile components use defined script globals or exported browser globals',()=>{
  const root='apps/mobile-ui/www/';
  const files=readdirSync(root,{recursive:true}).map(String).filter(x=>x.endsWith('.js')&&!x.startsWith('licenses')).map(x=>root+x.replaceAll('\\','/'));
  const exported=new Set<string>();
  for(const file of files)for(const match of readFileSync(file,'utf8').matchAll(/(?:globalThis|window)\.(\w+)\s*=/g))exported.add(match[1]);
  // BarcodeDetector is an optional browser API guarded by globalThis.BarcodeDetector.
  const browserApi=/globalThis\.(\w+)\s*\?\s*new\s+\1\(/g;
  for(const file of files)for(const match of readFileSync(file,'utf8').matchAll(browserApi))exported.add(match[1]);
  const program=ts.createProgram(files,{allowJs:true,checkJs:true,noEmit:true,target:ts.ScriptTarget.ESNext,lib:['lib.esnext.d.ts','lib.dom.d.ts']});
  const missing=program.getSemanticDiagnostics().filter(d=>d.code===2304&&d.file?.fileName.replaceAll('\\','/').includes('/components/')&&!exported.has(ts.flattenDiagnosticMessageText(d.messageText,' ').match(/Cannot find name '(.*?)'/)?.[1]||''));
  assert.deepEqual(missing.map(d=>({file:d.file!.fileName,message:ts.flattenDiagnosticMessageText(d.messageText,' ')})),[]);
});
