import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { desktopScript, desktopScriptPaths } from './helpers/desktop-ui-source.mjs';
const source=desktopScriptPaths().filter(path=>path.startsWith('ui-core/')).map(desktopScript).join('\n;\n');
function setup(read: (path:string,options:any)=>any) {
  const requests:any[]=[],values=new Map(),draft={text:'合成草稿'};
  const effects=new Proxy({}, {get:(_,name)=> (...args:any[])=>name==='readMessageDraft'?draft.text:name==='clearMessageDraft'?(draft.text=''):undefined});
  const context:any={Intl,Date,URL,URLSearchParams,TextEncoder,Blob,DOMException,AbortSignal,setTimeout,clearTimeout,setInterval,clearInterval};
  runInNewContext(source,context);
  const core=context.WeftUiCore.create({effects,crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000001'},storage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},
    fetch:async(path,options={})=>{requests.push({path,options});const value=await read(path,options);return {ok:value.status!==409,status:value.status||200,json:async()=>value.body||value};}});
  const main={chatId:'chat-main',sendAvailable:true,activeSessionId:null,contentRevision:1};
  Object.assign(core.state,{ownerId:'owner',account:{ownerId:'owner'},device:{id:'device'},hostId:'host',csrfToken:'synthetic',online:true,currentView:'assistant',mainChat:main,selectedChatId:main.chatId,modelProfileId:'local',models:[{id:'local'}],capabilities:{chat:{available:true}},personalCapabilities:{chats:1,chatTimeline:1,chatSearch:1,chatSend:1}});
  return {core,requests,draft,main};
}
test('undispatched main send keeps its original request without a native session and only queries on retry', async()=>{
  let command:any;
  const f=setup((path,options)=>{
    if(path.endsWith('/commands')&&options.method==='POST'){const body=JSON.parse(options.body);command={...body,commandId:'command-1',state:'pending'};return {command};}
    if(path.includes('/commands/by-request/'))return {command};
    if(path.includes('/commands?'))return {commands:[command]};
    if(path.includes('/events?'))return {items:[],contentRevision:1,syncCursor:'live',hasOlder:false,hasNewer:false};
    return {};
  });
  await f.core.sendDraft('合成草稿');
  const row=f.core.optimisticMessages()[0];assert.equal(row.status,'sending');assert.equal(row.command.sessionId,undefined);
  assert.equal(f.core.readMarkers()[0].requestId,row.requestId);assert.equal(f.core.readMarkers()[0].kind,'chat.message');
  await f.core.retryMainRequest(row.requestId);
  const posts=f.requests.filter(row=>row.options.method==='POST');assert.equal(posts.length,1);
  assert.equal(JSON.parse(posts[0].options.body).kind,'chat.message');assert.equal(f.draft.text,'合成草稿');
  assert.ok(f.requests.some(request=>request.path.endsWith('/commands/by-request/'+row.requestId)));
});
test('unknown capability versions keep main history readable and disable logical sending',()=>{
  const f=setup(()=>({}));f.core.state.personalCapabilities.chatSend=2;
  assert.equal(f.core.composerState('文字').messageDisabled,true);assert.equal(f.core.supportsChat('chatSend'),false);
  f.core.state.personalCapabilities.chatSend=1;assert.equal(f.core.composerState('文字').messageDisabled,false);
});

test('temporary composer leaves logical main and sends a private side creation without changing main policy', async()=>{
  const f=setup((path,options)=>path.endsWith('/commands')&&options.method==='POST'
    ? {command:{...JSON.parse(options.body),commandId:'private-create',state:'pending'}} : {});
  f.core.startNewConversation(false,true);
  assert.equal(f.core.state.selectedChatId,null);
  assert.equal(f.core.state.newConversationTemporary,true);
  await f.core.sendDraft('临时合成问题');
  const posts=f.requests.filter(row=>row.options.method==='POST').map(row=>JSON.parse(row.options.body));
  assert.equal(posts.length,1);assert.equal(posts[0].kind,'session.create');assert.equal(posts[0].temporary,true);
  assert.equal(f.main.chatId,'chat-main');
});
test('search cursor reset clears old bodies, hits and resource cache before a fresh tail is fetched',async()=>{
  let freshRead=false,f:any;
  f=setup(path=>{
    if(path.includes('/search?'))return {status:409,body:{error:{code:'CURSOR_RESET_REQUIRED'}}};
    if(path.includes('/events?')){assert.equal(f.core.state.chatWindow.events.size,0);assert.equal(f.core.state.chatWindow.search.hits.length,0);assert.equal(f.core.resourceCache,null);assert.equal(f.core.conversationApprovals.entries.size,0);assert.equal(f.core.conversationQuestions.entries.size,0);assert.equal(f.core.conversationTasks.entries.size,0);freshRead=true;return {items:[],contentRevision:2,syncCursor:'new',timeZone:'UTC',indexState:'ready'};}
    return {};
  });
  f.core.state.chatWindow.contentRevision=1;f.core.state.chatWindow.events.set('old',{eventId:'old',data:{text:'已清除正文'}});f.core.state.chatWindow.search.hits=[{snippet:'已清除正文'}];f.core.resourceCache={sources:['已清除正文']};
  f.core.conversationApprovals.entries.set('old',{row:{reason:'已清除正文'}});f.core.conversationQuestions.entries.set('old',{row:{questions:['已清除正文']}});f.core.conversationTasks.entries.set('old',{payload:{text:'已清除正文'}});
  await f.core.searchMainChat('旧内容');assert.equal(freshRead,true);assert.equal(f.core.state.chatWindow.syncCursor,'new');
});
test('main approval and question source accepts the bound chat command and rejects another receipt',()=>{
  const f=setup(()=>({})),source={kind:'chat.message',commandId:'command-main',sessionId:'session-main',receiptId:'receipt-main',dshTurn:1};
  f.core.conversationTasks.entries.set('command-main',{payload:{taskId:'command-main',sessionId:'session-main',source}});
  const row={taskId:'command-main',sessionId:'session-main',sourceCommandId:'command-main',sourceReceiptId:'receipt-main',turn:1};
  assert.equal(f.core.approvalSource(row),source);assert.equal(f.core.approvalSource({...row,sourceReceiptId:'receipt-other'}),null);
});
