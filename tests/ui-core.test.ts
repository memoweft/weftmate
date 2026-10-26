import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { contextUsage, createDshSessionAdapter } from '../src/runtime/dsh-adapter/sessions.mjs'
import { desktopScript, desktopScriptPaths } from './helpers/desktop-ui-source.mjs'
import {uiCoreAssets,uiCorePresentationAssets} from '../src/ui-core/manifest.mjs'
const featurePaths=new Set(uiCoreAssets.map(name=>`ui-core/${name}`))
const browserPaths=desktopScriptPaths().filter(path=>path.startsWith('ui-core/'))
assert.deepEqual(browserPaths.filter(path=>!featurePaths.has(path)),uiCorePresentationAssets.map(name=>`ui-core/${name}`),
  'only the explicit shared presentation assets may sit outside the DOM-free feature layer')
const paths = browserPaths.filter(path => featurePaths.has(path))
const source = paths.map(desktopScript).join('\n;\n')
const response = (body: object, status = 200) => ({ ok: status < 400, status, json: async () => body })
function fixture(read: (path: string, options: any) => any = () => response({})) {
  const values = new Map<string, string>(), requests: Array<{ path: string; options: any }> = [], paints: Array<{ name: string; args: any[] }> = []
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
  const effects = new Proxy({}, { get: (_target, name: string) => (...args: any[]) => { paints.push({ name, args }); return name === 'readMessageDraft' ? '' : name === 'acceptApprovalRisk' ? true : undefined } })
  let counter = 0
  const environment = { fetch: async (path: string, options: any = {}) => { requests.push({ path, options }); return read(path, options) }, storage,
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}` } }
  const context = { AbortController, AbortSignal, URL, URLSearchParams, TextEncoder, Blob, DOMException, Intl, setTimeout, clearTimeout, setInterval, clearInterval }
  runInNewContext(source, context)
  const api = (context as any).WeftUiCore, core = api.create({ effects, ...environment })
  Object.assign(core.state, { csrfToken: 'synthetic-csrf', account: { ownerId: 'owner-test', username: 'Synthetic' }, ownerId: 'owner-test', device: { id: 'device-test' }, hostId: 'host-test', online: true,
    currentView: 'assistant', selectedSessionId: 'session-test', models: [{ id: 'local', name: '合成模型', configured: true }], modelProfileId: 'local', sessions: [{ sessionId: 'session-test', running: false, sendAvailable: true }], capabilities: { chat: { available: true } } })
  return { core, api, effects, environment, requests, paints, values }
}
const plain = (value: any) => JSON.parse(JSON.stringify(value))
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

test('FIX-44 fix-1 oversized message detail leaves only that message partial and advances every history page', async () => {
  const f=fixture(path=>{
    if(path.endsWith('/10/detail'))return response({type:'assistant.message',text:'第一条全文'});
    if(path.endsWith('/11/detail'))return response({error:{code:'RESPONSE_TOO_LARGE'}},413);
    if(path.includes('afterSeq=12'))return response({events:[{seq:13,type:'assistant.message',data:{text:'后页正常回复'}}],nextSeq:13,hasMore:false});
    return response({events:[{seq:10,type:'assistant.message',data:{text:'第一条摘要',truncated:true}},
      {seq:11,type:'assistant.message',data:{text:'超长消息摘要',truncated:true}},
      {seq:12,type:'assistant.message',data:{text:'同页正常回复'}}],nextSeq:12,hasMore:true});
  });
  await f.core.refreshHistory(true,true);
  assert.deepEqual([...f.core.state.historyEvents.keys()],[10,11,12,13]);
  assert.equal(f.core.state.historyEvents.get(10).data.text,'第一条全文');
  assert.equal(f.core.state.historyEvents.get(11).data.text,'超长消息摘要');
  assert.equal(f.core.state.historyEvents.get(11).data.truncated,true);
  assert.equal(f.core.state.historyEvents.get(11).data.fullTextReadFailed,true);
  assert.equal(f.core.state.historyEvents.get(12).data.text,'同页正常回复');
  assert.equal(f.core.state.historyEvents.get(13).data.text,'后页正常回复');
  assert.equal(f.core.state.afterSeq,13);
});

test('FIX-44 fix-1 message detail 404 during logical changes preserves the chat, old messages and next cursor', async () => {
  let available=false;
  const f=fixture(path=>path.endsWith('/11/detail')?(available?response({type:'assistant.message',text:'重试后的全文'}):response({error:{code:'SOURCE_UNAVAILABLE'}},404)):response({}));
  Object.assign(f.core.state,{personalCapabilities:{chatTimeline:1},selectedChatId:'main',mainChat:{chatId:'main',activeSessionId:'session-test'}});
  const event=(id,seq,data)=>({eventId:id,revision:1,seq,orderKey:String(seq).padStart(3,'0'),at:new Date().toISOString(),type:'assistant.message',sourceRef:{sessionId:'session-test',seq},data});
  f.core.readChatEvents=async()=>({items:[event('old',1,{text:'已有完整回复'})],syncCursor:'one',contentRevision:1});
  f.core.readChatDates=async()=>({days:[],contentRevision:1});
  f.core.readChatChanges=async()=>({upserts:[event('forgotten',11,{text:'刚被忘掉的消息摘要',truncated:true}),event('new',12,{text:'其他正常回复'})],nextCursor:'two',contentRevision:1});
  f.core.readMainChat=async()=>({chat:f.core.state.mainChat});
  await f.core.refreshLogicalHistory(true);await f.core.refreshLogicalHistory();
  assert.equal(f.core.state.selectedChatId,'main');assert.equal(f.core.state.selectedSessionId,'session-test');
  assert.equal(f.core.state.chatWindow.events.get('old').data.text,'已有完整回复');
  assert.equal(f.core.state.chatWindow.events.get('forgotten').data.fullTextReadFailed,true);
  assert.equal(f.core.state.chatWindow.events.get('new').data.text,'其他正常回复');
  assert.equal(f.core.state.chatWindow.syncCursor,'two');
  available=true;
  const presentationEvent={...f.core.state.chatWindow.events.get('forgotten'),presentationKey:'stream:session-test:10'};
  await f.core.retryHistoryMessage(presentationEvent);
  assert.equal(f.core.state.chatWindow.events.get('forgotten').data.text,'重试后的全文');
  assert.equal(f.core.state.chatWindow.events.get('forgotten').data.fullTextReadFailed,undefined);
  assert.equal(f.core.state.chatWindow.syncCursor,'two');
});

test('FIX-44 native history keeps a complete streamed reply when its terminal summary is truncated', () => {
  const f = fixture(), text = '完整中文回复'.repeat(1200) + '全文终点';
  f.core.appendHistory([], [{seq: 10, sessionId:'session-test', data:{text, streaming:false}}], 10);
  f.core.appendHistory([{seq:11, sessionId:'session-test', type:'assistant.message', data:{text:text.slice(0,4000),truncated:true,streamSeq:10}}], [], 11);
  assert.equal(f.core.state.historyEvents.get(11).data.text, text);
});

test('FIX-44 native history loads full text before painting a truncated summary after reopening', async () => {
  const text = '重开后的完整回复'.repeat(900) + '全文终点';
  const f = fixture(path => path.endsWith('/detail') ? response({type:'assistant.message',text,truncated:false}) :
    response({events:[{seq:11,sessionId:'session-test',type:'assistant.message',data:{text:text.slice(0,4000),truncated:true}}],nextSeq:11,hasMore:false}));
  await f.core.refreshHistory(true,true);
  assert.equal(f.core.state.historyEvents.get(11).data.text,text);
  assert.equal(f.requests.filter(row=>row.path.endsWith('/11/detail')).length,1);
  assert.equal(f.paints.filter(row=>row.name==='paintHistoryMessages').at(-1).args[0][0].data.truncated,false);
});

test('FIX-44 logical history preserves full text on repeated summaries of the same revision', () => {
  const f=fixture(), window=f.api.ChatWindow.create(), text='完整正文'.repeat(1800)+'全文终点';
  const event={eventId:'reply',revision:1,seq:11,orderKey:'01',type:'assistant.message',sourceRef:{sessionId:'session-test',seq:11},data:{text,truncated:false}};
  window.merge({items:[event]});
  window.merge({upserts:[{...event,data:{text:text.slice(0,4000),truncated:true}}]},'changes');
  assert.equal(window.ordered()[0].data.text,text);
  assert.equal(window.ordered()[0].data.truncated,false);
});

test('FIX-44 full-text read finishing after a session switch cannot paint into the new conversation', async () => {
  const detail=deferred(); const f=fixture(path=>path.endsWith('/detail')?detail.promise:
    response({events:[{seq:11,sessionId:'session-test',type:'assistant.message',data:{text:'摘要',truncated:true}}],nextSeq:11,hasMore:false}));
  const reading=f.core.refreshHistory(true,true);
  await new Promise(resolve=>setTimeout(resolve,0));
  f.core.state.selectedSessionId='other'; f.core.state.historyGeneration++;
  detail.resolve(response({type:'assistant.message',text:'全文',truncated:false}));
  await reading;
  assert.equal(f.core.state.historyEvents.size,0);
  assert.equal(f.paints.filter(row=>row.name==='paintHistoryMessages').length,0);
});

test('FIX-44 main-chat tail and changes hydrate summaries into state and reuse complete bodies', async () => {
  const text='主对话完整回复'.repeat(1000)+'全文终点', f=fixture(path=>path.endsWith('/11/detail')?
    response({type:'assistant.message',text,truncated:false}):response({}));
  Object.assign(f.core.state,{personalCapabilities:{chatTimeline:1},selectedChatId:'main',mainChat:{chatId:'main',activeSessionId:'session-test'}});
  const event={eventId:'reply',revision:1,seq:11,orderKey:'01',at:new Date().toISOString(),type:'assistant.message',
    sourceRef:{sessionId:'session-test',seq:11},data:{text:text.slice(0,4000),truncated:true}};
  f.core.readChatEvents=async()=>({items:[event],syncCursor:'one',contentRevision:1});
  f.core.readChatDates=async()=>({days:[],contentRevision:1});
  f.core.readChatChanges=async()=>({upserts:[event],nextCursor:'two',contentRevision:1});
  f.core.readMainChat=async()=>({chat:f.core.state.mainChat});
  await f.core.refreshLogicalHistory(true);
  assert.equal(f.core.state.chatWindow.events.get('reply').data.text,text);
  await f.core.refreshLogicalHistory();
  assert.equal(f.core.state.chatWindow.events.get('reply').data.text,text);
  assert.equal(f.requests.filter(row=>row.path.endsWith('/11/detail')).length,1,'the existing complete body avoids another detail read');
});

test('FIX-44 a failed full-text read keeps its marked summary and a manual retry stores the full body', async () => {
  let available=false;const text='恢复连接后的全文'.repeat(1000)+'全文终点';
  const f=fixture(path=>path.endsWith('/detail')?(available?response({type:'assistant.message',text}):response({error:{code:'NETWORK'}},503)):
    response({events:[{seq:11,sessionId:'session-test',type:'assistant.message',data:{text:text.slice(0,4000),truncated:true}}],nextSeq:11,hasMore:false}));
  await f.core.refreshHistory(true,true);assert.equal(f.core.state.historyEvents.size,1);assert.equal(f.core.state.afterSeq,11);
  assert.equal(f.core.state.historyEvents.get(11).data.fullTextReadFailed,true);
  available=true;f.core.state.online=true;await f.core.retryHistoryMessage(f.core.state.historyEvents.get(11));
  assert.equal(f.core.state.historyEvents.get(11).data.text,text);
  assert.equal(f.core.state.historyEvents.get(11).data.truncated,false);
  assert.equal(f.core.state.historyEvents.get(11).data.fullTextReadFailed,undefined);
});

test('MODE-1 a late computer status cannot replace the account or computer selected while it was in flight', async () => {
  const pending = deferred(), f = fixture(() => pending.promise);
  const before = f.core.state.identityGeneration, reading = f.core.refreshStatus();
  Object.assign(f.core.state,{identityGeneration:before+1,ownerId:'owner-next',hostId:'host-next'});
  pending.resolve(response({ownerId:'owner-test',hostId:'host-test',presence:{authorization:'active'}}));
  assert.equal(await reading,false);assert.equal(f.core.state.ownerId,'owner-next');assert.equal(f.core.state.hostId,'host-next');
});

test('MODE-1 explicitly choosing a folder in a fresh draft selects work and keeps that folder before the first send', async () => {
  const f=fixture();Object.assign(f.core.state,{personalCapabilities:{workAndChat:1},newConversation:true,selectedSessionId:null,newConversationMode:'chat'});
  const project={projectId:'project-synthetic',name:'Synthetic folder'};await f.core.chooseFolderProject(project);
  assert.equal(f.core.state.newConversationProjectId,project.projectId);assert.equal(f.core.currentConversationMode(),'work');assert.equal(f.core.sidebarConversationMode(),'work');
  assert.equal(f.requests.length,0,'the explicit choice changes only the unsent draft');
});

test('MODE-1 history authorization resumes only after the current owner status verifies active authority', async () => {
  let active = false; const f=fixture(()=>response({ownerId:'owner-test',hostId:'host-test',presence:{authorization:active?'active':'pending'}}));
  f.core.historyReadResult('failed',{terminal:true,error:{code:'UNAUTHORIZED'}});assert.equal(f.core.historyReadAllowed(),false);
  await f.core.refreshStatus();assert.equal(f.core.historyReadAllowed(),false);
  active=true;await f.core.refreshStatus();assert.equal(f.core.historyReadAllowed(),true);
});

test('MODEL-1 combined service read supplies models and default/background settings without legacy requests',async()=>{
  const f=fixture(path=>{
    assert.equal(path,'/personal/v1/model-services');
    return response({services:[],models:[{id:'cloud',name:'Synthetic cloud',configured:true}],canManage:true,
      modelSettings:{defaultModelProfileId:'cloud',backgroundModelProfileId:'background',currentChatModelProfileId:'local'}});
  });
  f.core.state.personalCapabilities={modelServices:1};
  f.core.state.modelProfileId=null;await f.core.refreshModels();
  assert.deepEqual(f.requests.map(row=>row.path),['/personal/v1/model-services']);
  assert.equal(f.core.state.modelProfileId,'cloud');assert.equal(f.core.state.modelSettings.backgroundModelProfileId,'background');
  assert.equal(f.core.state.models[0].id,'cloud');assert.equal(f.core.state.modelsKnown,true);
});

test('MODEL-1 failed combined read keeps usable models and does not start immediate legacy retries',async()=>{
  const f=fixture(()=>response({error:{code:'BACKEND_UNAVAILABLE'}},503));
  f.core.state.personalCapabilities={modelServices:1};
  await assert.rejects(f.core.refreshModels(),error=>error.code==='BACKEND_UNAVAILABLE');
  await f.core.refreshModels();await f.core.refreshModels();
  assert.deepEqual(f.requests.map(row=>row.path),['/personal/v1/model-services']);
  assert.equal(f.core.state.models[0].id,'local');assert.equal(f.core.state.modelProfileId,'local');
});

function sideFixture() {
  const f=fixture();Object.assign(f.core.state,{personalCapabilities:{chats:1,sideChats:1,chatSend:1,creationReceipt:1},
    mainChat:{chatId:'main',activeSessionId:'session-test',sendAvailable:true},selectedChatId:'main',chats:[]});
  for(const name of ['refreshHistory','refreshConversationTasks','refreshApprovalMode','updateSession'])f.core[name]=async()=>{};
  return f;
}
test('FX-19 creation stays locked through the durable receipt and entity read, then preserves the first draft',async()=>{
  const f=sideFixture(),receipt=deferred(),entity=deferred();let posted;
  f.core.accessApi=async(path,options)=>{if(path.startsWith('/commands/by-request/'))throw {code:'NOT_FOUND'};
    if(path==='/commands'){posted=options;return receipt.promise}if(path==='/chats/side')return entity.promise;return {}};
  const work=f.core.openSideChat();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(posted.body.waitForReceipt,true);assert.equal(posted.timeoutMs,45000);
  assert.equal(f.core.composerState('first').messageDisabled,true);assert.equal(f.core.composerState('first').sendDisabled,true);
  receipt.resolve({command:{kind:'session.side.create',requestId:posted.body.requestId,state:'accepted_by_dsh',sessionId:'session-new',chatId:'side'}});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.core.composerState('first').messageDisabled,true,'accepted receipt alone cannot unlock the unfinished selection');
  entity.resolve({chat:{chatId:'side',activeSessionId:'session-new',kind:'side',sendAvailable:true,modelProfileId:'local'}});await work;
  assert.equal(f.core.state.selectedSessionId,'session-new');assert.equal(f.core.composerState('首条草稿').messageDisabled,false);assert.equal(f.core.composerState('首条草稿').sendDisabled,false);
  const restored=f.paints.filter(row=>row.name==='restoreMainChatDraft').length;await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.paints.filter(row=>row.name==='restoreMainChatDraft').length,restored,'no late restoration can erase the first input');
});
test('FX-19 a timed out/disconnected creation releases the input lock and retries the original receipt without duplicating POST',async()=>{
  for(const error of [{code:'NETWORK'},{code:'TIMEOUT'}]){
    const f=sideFixture();let posts=0,requestId,accepted=false;
    f.core.accessApi=async(path,options)=>{if(path.startsWith('/commands/by-request/')){if(!accepted)throw {code:'NOT_FOUND'};return {command:{kind:'session.side.create',requestId,state:'accepted_by_dsh',sessionId:'session-new',chatId:'side'}}}
      if(path==='/commands'){posts++;requestId=options.body.requestId;throw error}if(path==='/chats/side')return {chat:{chatId:'side',activeSessionId:'session-new',sendAvailable:true,modelProfileId:'local'}};return {}};
    await assert.rejects(f.core.openSideChat(),e=>e.code===error.code);
    assert.equal(f.core.state.sideCreating,null);assert.equal(f.core.composerState('草稿').messageDisabled,false);assert.equal(f.core.composerState('草稿').sendDisabled,true);
    assert.equal(f.core.sideCreateIntent.requestId,requestId);accepted=true;await f.core.openSideChat();assert.equal(posts,1);assert.equal(f.core.composerState('草稿').sendDisabled,false);
  }
});
test('FX-19 definite HTTP or terminal creation rejection clears only its own send lock',async()=>{
  for(const failure of ['http','rejected','failed']){
    const f=sideFixture();f.core.accessApi=async(path,options)=>{if(path.startsWith('/commands/by-request/'))throw {code:'NOT_FOUND'};
      if(failure==='http')throw {code:'MODEL_UNAVAILABLE',status:409};return {command:{requestId:options.body.requestId,state:failure,errorCode:'MODEL_UNAVAILABLE'}}};
    await assert.rejects(f.core.openSideChat(),e=>e.code==='MODEL_UNAVAILABLE');
    assert.equal(f.core.state.sideCreating,null);assert.equal(f.core.sideCreateIntent,null);assert.equal(f.core.state.unresolvedSubmission,false);
    assert.equal(f.core.composerState('保留草稿').messageDisabled,false);assert.equal(f.core.composerState('保留草稿').sendDisabled,false);assert.equal(f.core.state.selectedSessionId,'session-test');
  }
});

test('D35 progress uses real kinds/objects and prioritizes failure and stopped states', () => {
  const { api } = fixture();
  const steps = [
    {toolName:'pwsh',state:'completed',summary:'运行命令 npm test'},
    {toolName:'read',state:'completed',summary:'读取 2 个文件',arguments:{paths:['a.md','b.md']}},
    {toolName:'grep',state:'running',summary:'搜索 approval'},
  ];
  assert.equal(api.progressText(steps).text, '正在搜索 approval…');
  assert.equal(api.progressText(steps, true).text, '已运行 1 个命令、读取了 2 个文件、搜索了 1 次');
  assert.equal(api.progressText([...steps, {state:'failed',ordinal:4}]).text, '第 4 步遇到问题，正在继续');
  assert.equal(api.progressText([{state:'cancelled'}]).text, '已中断');
  assert.equal(api.progressText([{state:'completed',jobState:'running',summary:'运行命令 npm test'}]).text,'正在运行命令 npm test…');
  assert.equal(api.progressText([{state:'completed',jobState:'killed'}]).text,'已中断');
  assert.equal(api.progressText([{state:'completed',jobState:'failed',ordinal:2}]).text,'第 2 步遇到问题，正在继续');
  assert.equal(api.progressText([]).text, '');
  const raw = JSON.stringify({arguments: JSON.stringify({command:'npm test'}),output:[{type:'tool-result',content:[{type:'text',text:'42 passed'}]}]});
  assert.match(api.executionDetailText(raw), /参数\n.*\n.*npm test[\s\S]*输出\n42 passed/);
  assert.equal(api.executionDetailText('plain output'), 'plain output');
});

test('FX-10 native turn history makes stop usable before the session list catches up and removes it on terminal evidence', async () => {
  const f = fixture()
  f.core.state.sessionSnapshotAt='2026-10-09T00:00:00.000Z'
  f.core.appendHistory([{sessionId:'session-test',seq:1,at:'2026-10-09T00:00:01.000Z',type:'turn.started',data:{}}])
  assert.equal(f.core.state.sessions[0].running, false)
  assert.equal(f.core.composerState('').running, true)
  assert.equal(f.core.composerState('').cancelDisabled, false)
  assert.ok(f.paints.some(row => row.name === 'updateAvailability'))
  let stopped = false
  f.core.submitCommand = async (kind: string) => { stopped = kind === 'session.cancel'; return {state:'accepted_by_dsh'} }
  await f.core.stopCurrentTurn()
  assert.equal(stopped, true)
  f.core.state.sessions[0].running = true
  f.core.appendHistory([{sessionId:'session-test',seq:2,at:'2026-10-09T00:00:02.000Z',type:'turn.ended',data:{reason:'completed'}}])
  assert.equal(f.core.composerState('').running, false)
  assert.equal(f.core.composerState('').cancelHidden, true)
  f.core.beginOptimistic({sessionId:'session-test',requestId:'queued',status:'accepted'})
  assert.equal(f.core.composerState('').running, false, 'accepted/queued receipt is not running evidence')
})

test('FX-10 live conversation reads remain independent of slow host/model refresh and coalesce overlapping ticks', async () => {
  const f = fixture(), host = deferred(), history = deferred()
  f.core.refreshStatus = () => host.promise
  let histories = 0, receipts = 0
  f.core.refreshHistory = async () => { histories++; await history.promise }
  f.core.readMarkers = () => [{kind:'session.message',requestId:'pending-receipt'}]
  f.core.lookupRequest = async () => { receipts++ }
  f.core.refreshTasks = async () => { throw Error('live reads must not request the account task list') }
  f.core.refreshConversationTasks = async () => {}
  const background = f.core.refreshAssistant()
  const live = f.core.refreshLiveConversation()
  await f.core.refreshLiveConversation()
  assert.equal(histories, 1)
  assert.equal(receipts, 1)
  history.resolve(undefined); await live
  f.core.refreshModels = f.core.refreshSessions = f.core.refreshTasks = f.core.restoreRequests = async () => {}
  host.resolve(undefined); await background
  assert.equal(f.core.state.liveRefreshing, false)
})

test('FX-10 a newer idle snapshot overrides an old unended start without inventing an ending', () => {
  const f=fixture()
  f.core.state.sessionSnapshotAt='2026-10-09T00:00:00.000Z'
  f.core.appendHistory([{sessionId:'session-test',seq:1,at:'2026-10-09T00:00:01.000Z',type:'turn.started',data:{}}])
  assert.equal(f.core.composerState('').running,true)
  f.core.state.sessionSnapshotAt='2026-10-09T00:00:02.000Z'
  assert.equal(f.core.composerState('').running,false)
  assert.match(f.core.turnStatusViewModel().message,/尚无结束记录/)
  assert.equal(f.core.state.turnStatus,'running','no terminal record was fabricated')
})

test('FX-10 an accepted new session delivers its first message while an older session list is still loading', async () => {
  const sessions = deferred()
  const f = fixture((_url, options) => {
    const body = JSON.parse(options.body)
    return response({command:{...body, sessionId:'session-new',state:'accepted_by_dsh',receiptId:'native-new'}})
  })
  f.core.refreshSessions = () => sessions.promise
  f.core.refreshTasks = f.core.refreshHistory = async () => {}
  f.core.selectSession = async (id: string) => { f.core.state.selectedSessionId=id; f.core.state.newConversation=false }
  f.core.startNewConversation()
  const sent = f.core.sendDraft('first message')
  try {
    await Promise.race([sent,new Promise(resolve=>setTimeout(resolve,100))])
    assert.deepEqual(f.requests.filter(r=>r.options.method==='POST').map(r=>JSON.parse(r.options.body).kind), ['session.create','session.message'])
    assert.equal(f.core.state.selectedSessionId,'session-new')
  } finally { sessions.resolve(undefined); await sent }
})

test('FX-10 receipt lookup replaces a pending command snapshot before optimistic delivery reads it', async () => {
  const command={commandId:'cmd-confirmed',requestId:'request-confirmed',sessionId:'session-test',kind:'session.message',state:'accepted_by_dsh',receiptId:'native-confirmed'}
  const f=fixture(()=>response({command}))
  f.core.state.tasks=[{...command,state:'pending',receiptId:undefined}]
  const marker={requestId:command.requestId,kind:command.kind,sessionId:command.sessionId}
  f.core.rememberMarker(marker)
  f.core.beginOptimistic({sessionId:command.sessionId,requestId:command.requestId,text:'accepted message'})
  await f.core.lookupRequest(marker)
  assert.equal(f.core.state.tasks[0].state,'accepted_by_dsh')
  assert.equal(f.core.state.tasks[0].receiptId,'native-confirmed')
  assert.equal(f.core.optimisticMessages()[0].status,'accepted')
})

test('D35 chronology splits only at visible conversation boundaries and approvals stay on their own step', () => {
  const { api } = fixture();
  const events = [
    {seq:1,type:'step.started',data:{taskId:'turn-1',stepId:'command',toolName:'pwsh',state:'running'}},
    {seq:2,type:'approval.requested',data:{taskId:'turn-1',callId:'command',approvalId:'approval-a'}},
    {seq:3,type:'step.completed',data:{taskId:'turn-1',stepId:'command',state:'completed'}},
    {seq:4,type:'step.completed',data:{taskId:'turn-1',stepId:'read',toolName:'read',state:'completed'}},
    {seq:5,type:'assistant.message',data:{text:'已读完，接着检查。'}},
    {seq:6,type:'step.completed',data:{taskId:'turn-1',stepId:'failure',state:'failed'}},
    {seq:7,type:'approval.requested',data:{approvalId:'missing-call-id'}},
  ];
  const copy = JSON.stringify(events), result = api.projectTimeline(events,[{callId:'command',turn:1,status:'answered',decisionOutcome:'allowed-once'}]);
  assert.equal(result.groups.length,2);
  assert.equal(result.groups[0].steps[0].approvalText,'已批准');
  assert.equal(result.groups[0].steps[1].approvalText,'');
  assert.equal(api.progressText(result.groups[1].steps).text,'第 3 步遇到问题，正在继续');
  assert.equal(JSON.stringify(events),copy);
});

test('FX-11 progress counts actual activities and keeps internal names out of running and historical summaries', () => {
  const { api } = fixture();
  const completed = ['load_tools', 'write', 'web_fetch', 'todo_write', 'subagent', 'schedule_create',
    'job_output', 'run_code', 'get_goal', 'weftmod_script', 'memory_lookup', 'custom_mcp_service']
    .map(toolName => ({toolName, state:'completed'}));
  const text = api.progressText(completed, true).text;
  assert.equal(text, '修改了 1 个文件、访问了 1 次网页、整理了 1 次执行计划、处理了 1 个子任务、处理了 1 次定时安排、查看或管理了 1 次后台命令、运行了 1 次脚本、查看了 1 次任务目标、操作了 1 次电脑应用、查询或更新了 1 次记忆、用了一个扩展工具');
  assert.equal(api.progressText([{toolName:'load_tools',state:'completed'}],true).text,'工具已就绪');
  assert.equal(api.progressText([{toolName:'load_tools',state:'running',summary:'执行工具 load_tools'}]).text,'正在准备可用工具…');
  const old = api.projectTimeline([{seq:1,type:'step.completed',data:{taskId:'turn-1',stepId:'load',toolName:'load_tools',summary:'执行工具 load_tools',state:'failed'}}]);
  assert.equal(old.groups[0].steps[0].summary,'准备可用工具');
  assert.equal(api.progressText(old.groups[0].steps,{terminal:true,reason:'error'}).text,'未能完成：准备可用工具遇到问题，可以让我重试或补充说明。','failed internal setup remains inspectable');
  assert.doesNotMatch(text,/load_tools|todo_write|web_fetch|工具步骤|执行工具/);
});

test('observed phases remain available to the message process without a duplicate composer hint or changing stop availability', () => {
  const f = fixture(), session: any = f.core.state.sessions[0];f.core.presence.success()
  session.running = true
  for (const [processing, label] of [
    [{ phase: 'memory' }, '正在读取记忆…'],
    [{ phase: 'loading', modelName: 'Synthetic Muse' }, '正在加载模型 Synthetic Muse…'],
    [{ phase: 'queued', ahead: 2 }, '模型排队中，前面还有 2 个请求'],
    [{ phase: 'reasoning' }, '正在思考…'],
    [{ phase: 'answering' }, '正在回复…'],
    [null, '等待模型回复…'],
  ]) {
    session.processing = processing
    const view = f.core.composerState('')
    assert.equal(f.core.processingStageLabel(processing).replace(/ \d+ 秒$/, ''), label)
    assert.equal(view.hint, '')
    assert.equal(view.cancelHidden, false)
    assert.equal(view.cancelDisabled, false)
  }
  session.running = false
  assert.equal(f.core.composerState('').hint, '')
})

test('core registers distinct actions, constructs independent stores and has no DOM dependency', () => {
  assert.doesNotMatch(source, /\b(?:document|window)\.|\bbyId\(|\.textContent\b|\.hidden\b|\.querySelector\b/)
  const f = fixture(), seen = new Set<string>()
  for (const factory of Object.values(f.api.factories) as any[]) for (const key of Object.keys(factory(f.core, f.effects, f.environment))) {
    assert.ok(!seen.has(key), `duplicate action ${key}`); seen.add(key)
  }
  const other = f.api.create({ effects: f.effects, ...f.environment })
  f.core.state.sessions.push({ sessionId: 'independent' })
  assert.equal(other.state.sessions.length, 0)
  assert.notEqual(f.core.memory.drafts, other.memory.drafts)
})

test('composed health settings keep serialized writes and reject queued work after an account change', async () => {
  const f = fixture(), first = deferred(), calls: any[] = []
  f.core.accessApi = async (_path: string, options: any) => {
    calls.push(options)
    return calls.length === 1 ? first.promise : { settings: options.body }
  }
  const active = f.core.saveHealthViewSettings({ itemAnalysisEnabled: true })
  const queued = f.core.saveHealthViewSettings({ modelInsightsEnabled: false })
  const rejected = assert.rejects(queued, /ACCOUNT_CHANGED/)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].protectedWrite, true)
  f.core.state.identityGeneration++
  f.core.state.ownerId = 'other-owner'
  first.resolve({ settings: { itemAnalysisEnabled: true } })
  await active
  await rejected
  assert.equal(calls.length, 1, 'the old account queued write must never reach the API')
})

test('QA-8 review and health controls use the composed writer for toggles and clearing', async () => {
  const f = fixture(), nodes: any[] = [], writes: any[] = []
  let settings = { modelInsightsEnabled: true, itemAnalysisEnabled: false, sleepTargetMinutes: 450, retentionDays: 400 }
  f.core.accessApi = async (path: string, options: any) => {
    if (path === '/settings/health') {
      if (options?.method === 'PATCH') { writes.push(options); settings = { ...settings, ...options.body } }
      return { settings }
    }
    return { settings: { reviewEnabled: true, reviewRetentionDays: 90, computerUsageEnabled: true }, timeZone: 'UTC' }
  }
  const make = (tag: string) => {
    const n: any = { tag, dataset: {}, children: [], options: [], isConnected: true, listeners: {},
      append(...children: any[]) { this.children.push(...children); if (tag === 'select') this.options.push(...children) },
      replaceChildren(...children: any[]) { this.children = children }, setAttribute(k: string, v: string) { this[k] = v },
      addEventListener(k: string, fn: any) { this.listeners[k] = fn }, dispatchEvent() {}, reportValidity: () => true,
      querySelectorAll: () => nodes.filter(n => ['input', 'select', 'button'].includes(n.tag)),
      close() {}, showModal() {}, focus() {}, remove() {} }
    nodes.push(n); return n
  }
  const ctx: any = { document: { createElement: make, body: make('body') }, Event: class {},
    Option: class { text: string; value: string; constructor(text: string, value: string) { this.text = text; this.value = value } },
    WeftSettingsControls: { toggle() {}, row(...args: any[]) { const n = make('div'); n.append(args.at(-1)); return n } } }
  runInNewContext(desktopScript('ui-core/controls.js')+'\n;\n'+desktopScript('components/notifications.js'), ctx)
  ctx.WeftNotificationsView(f.core, make('section'), { section: 'reviewHealth' })
  await new Promise(resolve => setImmediate(resolve))
  const toggle = nodes.find(n => n.id === 'health-modelInsightsEnabled')
  assert.equal(toggle.disabled, false); toggle.checked = false; toggle.listeners.change()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(toggle.checked, false); assert.equal(settings.modelInsightsEnabled, false)
  nodes.find(n => n.textContent === '清空健康数据').onclick()
  await nodes.filter(n => n.textContent === '确认清空').at(-1).onclick()
  assert.deepEqual(plain(writes.map(r => r.body)), [{ modelInsightsEnabled: false }, { clear: true }])
  assert.ok(writes.every(r => r.protectedWrite && r.method === 'PATCH'))
})

test('history accepts gaps, sorts by event sequence, rejects duplicates/foreign sessions and keeps the latest terminal', () => {
  const f = fixture()
  f.core.appendHistory([
    { seq: 15, sessionId: 'session-test', type: 'turn.ended', data: { reason: 'error', endReasonKind: 'max-tokens' } },
    { seq: 7, sessionId: 'session-test', type: 'turn.started', data: { turn: 1 } },
    { seq: 7, type: 'assistant.message', data: { text: 'duplicate' } },
    { seq: 22, sessionId: 'other', type: 'turn.started', data: {} },
  ])
  assert.equal(f.core.state.historyEvents.size, 2)
  assert.equal(f.core.state.turnStatus, 'error')
  assert.equal(f.core.state.turnEndReasonKind, 'max-tokens')
  assert.deepEqual(plain(f.paints.find(p => p.name === 'paintHistoryMessages')?.args[0]).map((e: any) => e.seq), [15, 7])
  f.core.appendHistory([{ seq: 3, type: 'turn.started', data: {} }])
  assert.equal(f.core.state.turnStatus, 'error', 'loading an older page must not revive a completed turn')
})

test('timeline merges a completed step/artifact into its existing step and never mutates event input', () => {
  const f = fixture(), events = [
    { seq: 7, at: '2026-10-08T08:00:02Z', type: 'artifact.created', data: { completedStep: { taskId: 'task-1', stepId: 'write-1', state: 'completed', summary: '写入报告' }, artifacts: [{ artifactId: 'file-1', fileName: '报告.md' }] } },
    { seq: 3, at: '2026-10-08T08:00:01Z', type: 'step.started', data: { taskId: 'task-1', stepId: 'write-1', state: 'running', summary: '写入报告' } },
  ]
  const saved = JSON.stringify(events), result = f.core.projectTimeline(events)
  assert.equal(result.groups.length, 1)
  assert.equal(result.groups[0].seq, 3)
  assert.equal(result.groups[0].steps.length, 1)
  assert.equal(result.groups[0].steps[0].state, 'completed')
  assert.equal(result.groups[0].steps[0].endAt, events[0].at)
  assert.equal(result.cards.at(-1).data.artifacts[0].artifactId, 'file-1')
  assert.equal(JSON.stringify(events), saved)
})

test('history pages use host watermarks/cursors and keep stale reads out after a session switch', async () => {
  const pending = deferred(), f = fixture((path) => path.includes('beforeSeq=') ? response({ events: [{ seq: 20, type: 'assistant.message', data: { text: 'older' } }], nextBeforeSeq: null, hasOlder: false }) : pending.promise)
  const read = f.core.refreshHistory(true)
  pending.resolve(response({ events: [{ seq: 95, type: 'assistant.message', data: { text: 'recent' } }], nextSeq: 120, hasMore: false, nextBeforeSeq: 95, hasOlder: true }))
  f.core.refreshConversationTasks = async () => {}
  await read; assert.equal(f.core.state.afterSeq, 120)
  await f.core.loadOlderHistory(); assert.match(f.requests.at(-1)!.path, /beforeSeq=95&limit=100$/)
  assert.equal(f.core.state.afterSeq, 120, 'an older page must not change the forward watermark')
  const late = deferred()
  // Each instance uses its injected environment, so create a new in-flight fixture for the stale response.
  const g = fixture(() => late.promise), inFlight = g.core.refreshHistory(true)
  g.core.state.historyGeneration++; g.core.state.selectedSessionId = 'another-session'
  late.resolve(response({ events: [{ seq: 1, type: 'assistant.message', data: { text: 'wrong conversation' } }], nextSeq: 1, hasMore: false }))
  await inFlight; assert.equal(g.core.state.historyEvents.size, 0)
})

test('FIX-31 a side-chat wait baseline catches up messages and approvals already inside its cursor', async () => {
  const f = fixture(), wait = deferred(); let reads = 0, waits = 0;
  Object.assign(f.core.state, {personalCapabilities:{chats:1,replyWait:1,replyStreaming:1},
    mainChat:{chatId:'main',activeSessionId:'main-session'},selectedChatId:'side',
    chats:[{chatId:'side',activeSessionId:'session-test'}]});
  f.core.refreshConversationFacts = async () => {};
  f.core.refreshConversationApprovals = async () => {};
  f.core.refreshConversationQuestions = async () => {};
  f.core.accessApi = async path => {
    assert.match(path,/^\/sessions\/session-test\/events\?/);
    if (++reads === 1) return {events:[],nextSeq:3,hasMore:false};
    return {events:[{seq:8,type:'user.message',data:{text:'read brief.md',receiptId:'receipt-test'}},
      {seq:39,type:'approval.requested',data:{approvalId:'approval-test',turn:1}}],nextSeq:39,hasMore:false};
  };
  // The selection's first read finishes before the native turn starts.
  await f.core.refreshHistory(true);
  f.core.readChatEvents = async () => ({syncCursor:'cursor-including-approval',liveRevision:0});
  f.core.readChatChanges = async () => { waits++; return wait.promise; };
  const read = f.core.refreshLiveConversation();
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reads,2,'snapshot establishment must catch up native history without waiting for another change');
    assert.equal(waits,0,'the already-present approval must not be gated by a 30-second idle wait');
    assert.equal(f.core.state.historyEvents.get(8)?.data.receiptId,'receipt-test');
    assert.equal(f.core.state.historyEvents.get(39)?.type,'approval.requested');
    assert.equal(f.core.state.afterSeq,39);
    const result = await read;
    assert.equal(result.kind,'changed');assert.equal(result.immediateRenew,true);
    const renewal = f.core.refreshLiveConversation();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(waits,1,'subsequent reads retain the normal long wait');
    wait.resolve({nextCursor:'next',liveRevision:0,upserts:[],removals:[],waitOutcome:'timeout'});
    assert.equal((await renewal).kind,'unchanged');
  } finally {
    wait.resolve({nextCursor:'next',liveRevision:0,upserts:[],removals:[],waitOutcome:'timeout'});
    await read;
  }
});

test('FIX-31 baseline catch-up does not reuse an older in-flight native history snapshot', async () => {
  const f=fixture(), initial=deferred(); let reads=0;
  Object.assign(f.core.state,{personalCapabilities:{replyWait:1},selectedChatId:'side'});
  f.core.accessApi=async()=>++reads===1 ? initial.promise : {events:[{seq:8,type:'user.message',data:{text:'new message'}}],nextSeq:8,hasMore:false};
  f.core.readChatEvents=async()=>({syncCursor:'cursor-including-new-message',liveRevision:0});
  f.core.readChatChanges=async()=>{throw Error('must catch up before waiting')};
  const old=f.core.refreshHistory(true), catchUp=f.core.refreshLiveConversation();
  await new Promise(resolve=>setImmediate(resolve));
  initial.resolve({events:[],nextSeq:3,hasMore:false});
  await old;const result=await catchUp;
  assert.equal(reads,2,'a pre-baseline response cannot substitute for a fresh catch-up read');
  assert.equal(f.core.state.historyEvents.get(8)?.data.text,'new message');
  assert.equal(result.kind,'changed');
});

test('shared send/stop actions choose steer or queue and block unresolved submissions', async () => {
  const f = fixture(), commands: any[] = []
  f.core.submitCommand = async (...args: any[]) => { commands.push(args); return { state: 'accepted_by_dsh' } }
  await f.core.sendDraft('普通消息'); assert.equal(commands.at(-1)[1].intent, 'queue')
  f.core.state.sessions[0].running = true
  await f.core.sendDraft('调整目标'); assert.equal(commands.at(-1)[1].intent, 'queue')
  f.core.setMessageMode('steer'); await f.core.sendDraft('引导调整'); assert.equal(commands.at(-1)[1].intent, 'steer')
  f.core.setMessageMode('queue'); await f.core.sendDraft('下一件事'); assert.equal(commands.at(-1)[1].intent, 'queue')
  f.core.state.unresolvedSubmission = true; await f.core.sendDraft('送达未确认时'); assert.equal(commands.length, 4)
  await f.core.stopCurrentTurn(); assert.equal(commands.at(-1)[0], 'session.cancel')
  const view = f.core.composerState('未发送的草稿')
  assert.equal(view.running, true); assert.equal(view.sendDisabled, true)
  f.core.state.unresolvedSubmission = false; assert.equal(f.core.composerState('草稿').sendDisabled, false)
  f.core.state.online = false; assert.equal(f.core.composerState('草稿').sendDisabled, true)
})

test('question drafts keep native option order, exact labels and one single-choice answer', () => {
  const f = fixture(), context = f.core.approvalContext(), row = { questionRpcId: '00000000-0000-4000-8000-000000000021', questions: [{ id: 'q1', question: '采用哪种格式？', multiSelect: true, options: [{ label: '简要' }, { label: '完整' }] }] }
  f.core.chooseQuestionOption(context, row, 0, '完整', true)
  assert.deepEqual(plain(f.core.chooseQuestionOption(context, row, 0, '简要', true).selected), ['简要', '完整'])
  row.questions[0].multiSelect = false
  f.core.chooseQuestionOption(context, row, 0, '完整', true)
  const custom = f.core.setQuestionCustom(context, row, 0, '自己的回答')
  assert.deepEqual(plain(custom.selected), []); assert.equal(custom.custom, '自己的回答')
  assert.equal(f.core.validQuestionAnswer({ answers: [{ id: 'q1', selected: ['未知'] }] }, row.questions), false)
  assert.equal(f.core.sameQuestion({ ...row, createdAt: 'first' }, { ...row, createdAt: 'changed' }), false)
})

test('approval identity and terminal merges prevent a stale pending row from reopening a decision', () => {
  const f = fixture(), row = { approvalId: 'approval-test', sessionId: 'session-test', taskId: 'task-test', sourceCommandId: 'source-test', sourceReceiptId: 'rpc:test', callId: 'write', rootCallId: 'write', toolName: 'write', argumentsHash: 'a', createdAt: '2026-10-08T08:00:00Z', turn: 1, status: 'resolved' }
  assert.equal(f.core.sameApproval(row, { ...row, sourceReceiptId: 'rpc:other' }), false)
  assert.equal(f.core.mergeApproval({ row }, { ...row, status: 'pending' }).row.status, 'resolved')
  assert.equal(f.core.mergeApproval({ row }, { ...row, sourceReceiptId: 'rpc:different' }).authoritative, false)
})

test('resource pagination deduplicates calls, prefers captured snapshots and replaces old output versions', async () => {
  let reads = 0
  const f = fixture(() => response(++reads === 1 ? { outputs: [{ artifactId: 'old', fileName: '报告.md' }], sources: [{ key: 'file:README.md', kind: 'file', name: 'README.md', uses: [{ callId: 'read-1', path: '/tasks/task-1/sources/read-1' }] }], hasMore: true, nextSeq: 5 }
    : { outputs: [{ artifactId: 'new', fileName: '报告.md' }], sources: [{ key: 'file:README.md', kind: 'file', name: 'README.md', uses: [{ callId: 'read-1', path: '/sessions/session-test/events/5/detail' }, { callId: 'read-2', path: '/sessions/session-test/events/6/detail' }] }], hasMore: false, nextSeq: 7 }))
  const resources = await f.core.loadConversationResources()
  assert.equal(resources.outputs.length, 1); assert.equal(resources.outputs[0].artifact.artifactId, 'new')
  assert.equal(resources.sources[0].uses.length, 2)
  assert.equal(resources.sources[0].uses[0].path, '/tasks/task-1/sources/read-1')
  assert.match(f.requests[1].path, /afterSeq=5$/)
})

test('memory reads discard a response for another account and reset authenticated state', async () => {
  const f = fixture(() => response({ ownerId: 'owner-other', sources: [] }))
  await assert.rejects(f.core.readMemorySources('cognition', 'memory-test'), (error: any) => error.code === 'MEMORY_OWNER_MISMATCH')
  assert.equal(f.core.state.csrfToken, null); assert.equal(f.core.state.currentView, 'login')
  assert.equal(f.core.state.historyEvents.size, 0)
})

const expectedAppearanceDefaults = {
  theme:'system',accent:'neutral',fontSize:'14',accentLight:'neutral',accentDark:'neutral',codeFontSize:'12',
  uiFontSize:'13',themePreset:'default',themePresetLight:'default',themePresetDark:'default',
  font:'system',fontLight:'system',fontDark:'system',backgroundLight:'',backgroundDark:'',foregroundLight:'',foregroundDark:'',
  separateModes:true,contrast:'60',translucentSidebar:false,fullWidth:false,
}
test('appearance persistence and session sorting work without a window or DOM', () => {
  const f = fixture(), prefs = f.core.appearance
  assert.equal(prefs.value.theme, 'system')
  prefs.set({ theme: 'dark', accent: 'purple', fontSize: '19', accentLight: 'purple', accentDark: 'purple', codeFontSize: '13' })
  assert.deepEqual(plain(f.api.createAppearance(f.environment.storage).value), { ...expectedAppearanceDefaults, theme: 'dark', accent: 'purple', fontSize: '19', accentLight: 'purple', accentDark: 'purple', codeFontSize: '13' })
  const sessions = [{ sessionId: 'old', updatedAt: '2026-10-07T08:00:00Z' }, { sessionId: 'new', updatedAt: '2026-10-08T08:00:00Z' }]
  assert.deepEqual(plain(f.core.sortSessions(sessions)).map((s: any) => s.sessionId), ['new', 'old'])
  assert.equal(sessions[0].sessionId, 'old')
})

test('system settings are read once as data and sent through the existing protected routes', async () => {
  const f = fixture(path => response(path.endsWith('/system') ? { model: { state: 'ready' }, queue: { backgroundPending: 0 } } : path.endsWith('/models') ? { models: [] } : { mode: 'ask', backgroundModelProfileId: null }))
  f.core.state.currentView = 'account'; await f.core.refreshSystem()
  assert.equal(f.core.state.system.model.state, 'ready')
  assert.ok(f.paints.some(p => p.name === 'paintSystem'))
  await f.core.saveBackgroundModel('local')
  assert.equal(f.requests.at(-1)!.options.headers['X-WeftMate-CSRF'], 'synthetic-csrf')
  assert.deepEqual(JSON.parse(f.requests.at(-1)!.options.body), { backgroundModelProfileId: 'local' })
})

test('source references parse nested native arguments, deduplicate values and tolerate unavailable details', () => {
  const f = fixture()
  const refs = f.core.resourceReferences(JSON.stringify({ arguments: JSON.stringify({ paths: ['README.md', 'README.md'], url: 'https://example.test/', urls: ['https://example.test/'] }) }))
  assert.deepEqual(plain(refs), [{ kind: 'file', value: 'README.md', key: 'file:README.md' }, { kind: 'webpage', value: 'https://example.test/', key: 'webpage:https://example.test/' }])
  assert.deepEqual(plain(f.core.resourceReferences('unavailable')), [])
})

test('login input validation and protected transport do not need form elements', async () => {
  const f = fixture()
  await f.core.loginAccount({ username: '', password: 'synthetic-password', deviceName: 'Synthetic' })
  assert.equal(f.requests.length, 0)
  assert.ok(f.paints.some(p => p.name === 'loginError' && p.args[0].includes('请填写')))
  await f.core.requestJson('/personal/v1/commands', { method: 'POST', protectedWrite: true, body: { requestId: 'synthetic-id' } })
  assert.equal(f.requests[0].options.headers['X-WeftMate-CSRF'], 'synthetic-csrf')
  f.core.state.csrfToken = null
  await assert.rejects(f.core.requestJson('/personal/v1/commands', { method: 'POST', protectedWrite: true, body: {} }), (error: any) => error.code === 'UNAUTHORIZED')
})

test('model form validation and durable request recovery stay in core and never persist a credential', async () => {
  const f = fixture(); f.core.state.currentView = 'account'; f.core.state.accountModelsCanManage = true
  const input = { name: 'Synthetic', baseUrl: 'invalid-provider', modelId: 'synthetic', modelTier: 'auto', apiKey: 'synthetic-not-a-real-key' }
  await f.core.saveAccountModelDraft(input)
  assert.equal(f.requests.length, 0)
  assert.ok(f.paints.some(p => p.name === 'accountModelFormNotice' && p.args[0].includes('完整的模型服务地址')))
  f.core.accountModelReceipt = async () => ({ operation: { status: 'succeeded' } })
  await f.core.saveAccountModelDraft({ ...input, baseUrl: 'https://example.test/v1' })
  assert.ok(f.values.size > 0)
  assert.ok([...f.values.values()].every(value => !value.includes(input.apiKey)))
})

test('model storage readiness failure keeps the original request and draft available for retry without persisting secrets', async () => {
  const f=fixture(); f.core.state.currentView='account'; f.core.state.accountModelsCanManage=true;
  const input={name:'Synthetic',baseUrl:'https://example.test/v1',modelId:'synthetic',modelTier:'auto',apiKey:'synthetic-not-a-real-key'};
  f.core.accountModelReceipt=async()=>null;
  f.core.saveAccountModel=async()=>{throw {code:'CREDENTIAL_STORAGE_NOT_READY'};};
  await f.core.saveAccountModelDraft(input);
  assert.ok(f.paints.some(p=>p.name==='accountModelFormNotice'&&p.args[0].includes('请稍后重新保存')));
  assert.equal(f.core.state.accountModelBusy,false); assert.ok(f.core.savedAccountModelMarker());
  assert.ok(!f.paints.some(p=>p.name==='resetAccountModelForm'));
  assert.ok([...f.values.values()].every(value=>!value.includes(input.apiKey)));
});

test('appearance keeps unknown saved fields while the control defaults stay stable', () => {
  const f = fixture()
  f.core.appearance.set({ theme: 'dark', accent: 'blue', fontSize: '17', legacyField: true })
  assert.equal(f.api.createAppearance(f.environment.storage).value.legacyField, true)
  assert.deepEqual(plain(f.api.appearanceDefaults), expectedAppearanceDefaults)
})


test('UI-3 intent overrides do not change the composer selection and empty running drafts cannot send', async () => {
  const f = fixture(), sent: any[] = []
  f.core.state.sessions[0].running = true
  f.core.submitCommand = async (...args: any[]) => { sent.push(args); return {} }
  assert.equal(f.core.composerInputMode('session-test'), 'queue')
  await f.core.sendDraft('快捷键排队', 'queue')
  assert.equal(sent[0][1].intent, 'queue'); assert.equal(f.core.composerInputMode('session-test'), 'queue')
  f.core.setMessageMode('invalid'); assert.equal(f.core.composerInputMode('session-test'), 'queue')
  assert.equal(f.core.composerState('').sendDisabled, true)
  assert.equal(f.core.composerState('补充').sendText, '发送')
})

test('UI-3 queue projection follows sequence, batches, receipt reconciliation and terminal reasons', () => {
  const f = fixture()
  const queued = { seq: 2, type: 'task.queued', data: { tasks: [{ taskId: 'receipt-one', receiptId: 'receipt-one', text: '一' }, { taskId: 'task-two', text: '二' }] } }
  const started = { seq: 3, type: 'task.started', data: { taskId: 'task-one', receiptId: 'receipt-one' } }
  const commands = [{ kind: 'session.message', sessionId: 'session-test', commandId: 'task-one', receiptId: 'receipt-one' }]
  let rows = f.core.taskQueue([started, queued], commands)
  assert.deepEqual(plain(rows).map((r: any) => [r.taskId, r.state, r.text]), [['task-one', 'running', '一'], ['task-two', 'queued', '二']])
  rows = f.core.taskQueue([queued, started, { seq: 4, type: 'task.ended', data: { taskId: 'task-one', reason: 'completed' } },
    { seq: 5, type: 'task.ended', data: { taskId: 'task-two', reason: 'canceled' } }], commands)
  assert.deepEqual(plain(rows).map((r: any) => r.state), ['ended', 'cancelled'])
})

test('UI-3 cancel/edit retains request identity, handles 409 and never stops a running task', async () => {
  let status = 409
  const f = fixture(() => response(status === 409 ? { error: { code: 'TASK_NOT_READY' } } : { task: {} }, status))
  f.core.state.historyEvents.set(1, { seq: 1, type: 'task.queued', data: { taskId: 'task-one', text: '原目标' } })
  assert.equal(await f.core.cancelQueuedTask('task-one'), false)
  assert.equal(f.core.taskQueue()[0].notice, '已经开始，可以用停止')
  const original = JSON.parse(f.requests[0].options.body).requestId
  status = 202
  assert.equal(await f.core.editQueuedTask('task-one'), '原目标')
  assert.equal(JSON.parse(f.requests[1].options.body).requestId, original)
  assert.equal(f.core.taskQueue()[0].state, 'cancelled')
  assert.ok(f.requests.every(r => r.path.endsWith('/tasks/task-one/cancel')))
  f.core.state.historyEvents.set(2, { seq: 2, type: 'task.started', data: { taskId: 'task-one' } })
  assert.equal(await f.core.cancelQueuedTask('task-one'), false)
})

test('UI-3 stale cancellation cannot populate another account or conversation', async () => {
  const wait = deferred(), f = fixture(() => wait.promise)
  f.core.state.historyEvents.set(1, { seq: 1, type: 'task.queued', data: { taskId: 'task-one', text: '原目标' } })
  const pending = f.core.cancelQueuedTask('task-one')
  f.core.state.identityGeneration++; f.core.state.ownerId = 'other-owner'
  wait.resolve(response({ task: {} }, 202))
  assert.equal(await pending, false); assert.equal(f.core.taskQueue()[0].state, 'queued')
})

test('UI-3 stop targets the current root and leaves the later queue untouched', async () => {
  const f = fixture(() => response({ task: {} }, 202))
  f.core.state.sessions[0].running = true
  f.core.state.historyEvents.set(1, { seq: 1, type: 'task.started', data: { taskId: 'current-root' } })
  f.core.state.historyEvents.set(2, { seq: 2, type: 'task.queued', data: { taskId: 'next-root', text: '下一件事' } })
  await f.core.stopCurrentTurn()
  assert.ok(f.requests[0].path.endsWith('/tasks/current-root/stop'))
  assert.equal(f.core.taskQueue()[1].state, 'queued')
})

test('UI-3 approvals and sources share summaries for shell/files/web/subtask and unknown tools', () => {
  const f = fixture()
  for (const [tool, args, summary] of [
    ['shell', { command: 'npm test', cwd: 'D:/project' }, '运行命令：npm test（在 D:/project）'],
    ['delete_files', { paths: ['a.txt', 'b.txt', 'c.txt', 'd.txt'] }, '删除 4 个文件：a.txt、b.txt、c.txt…'],
    ['write', { file_path: 'out/report.md' }, '写入 1 个文件：report.md'],
    ['edit', { path: 'out/report.md' }, '修改 1 个文件：report.md'],
    ['web_fetch', { url: 'https://example.com/a' }, '访问网页 example.com'],
    ['subagent', { prompt: '核对结果' }, '交给子任务：核对结果'],
    ['custom_tool', { a: 1, b: 'two', c: true, d: 'omitted' }, '使用扩展工具'],
  ] as any[]) {
    const text = JSON.stringify({ arguments: JSON.stringify(args) })
    assert.equal(f.core.toolSummary(tool, args), summary)
    assert.equal(f.core.sourcePresentation(tool, text).summary, summary)
    assert.equal(f.core.approvalPresentation({ toolName: tool, reason: JSON.stringify(args) }).summary, tool === 'shell' ? '运行一条命令' : summary)
  }
  assert.equal(f.core.toolSummary('unknown', 'invalid json'), '使用扩展工具')
  assert.equal(f.core.approvalPresentation({ toolName: 'write', reason: '[weftmate:overwrite] 覆盖报告，可从 Git 恢复。' }).summary, '覆盖报告，可从 Git 恢复。')
})

test('UI-3 outputs group by path, keep creation order and expose older versions', () => {
  const f = fixture()
  const rows = f.core.deduplicateOutputs([
    { artifactId: 'old', fileName: 'report.md', path: 'out/report.md', createdAt: '2026-10-01' },
    { artifactId: 'other', fileName: 'report.md', path: 'other/report.md', createdAt: '2026-10-03' },
    { artifactId: 'new', fileName: 'report.md', path: 'out/report.md', createdAt: '2026-10-02', updatedAt: '2026-10-02' },
  ])
  assert.equal(rows.length, 2); assert.equal(rows[0].artifact.artifactId, 'new'); assert.equal(rows[0].versions[0].artifactId, 'old')
})


test('UI-3 native approval reasons keep human risk prose and fold embedded raw parameters', () => {
  const f = fixture(), row = { toolName: 'pwsh', reason: '[weftmate:delete] 删除用户文件。操作：pwsh\n{"command":"Remove-Item a.txt"}' }
  const presentation = f.core.approvalPresentation(row)
  assert.equal(presentation.summary, '运行一条命令')
  assert.equal(presentation.reason, '删除用户文件。')
  assert.ok(presentation.raw.includes('{"command"'))
})

test('ST-7b approvals keep mailbox and calendar facts readable when native Code Mode owns the call', () => {
  const f=fixture();
  for(const summary of ['邮箱 · owner@synthetic.invalid · 回复邮件 · 收件人：friend@synthetic.invalid · 主题：合成主题 · 正文：批准的正文',
    '日历 · calendar-user · 新建日程 · 合成会议 · 10月15日 13:00 至 10月15日 14:00 · 日历：工作日历']){
    const row={toolName:'execute',reason:'[weftmate:external] 需要你批准。操作：'+summary+'\n{"calendarId":"opaque","body":"raw-detail"}'};
    const presentation=f.core.approvalPresentation(row);assert.equal(presentation.summary,summary);assert.equal(presentation.reason,'');assert.ok(presentation.raw.includes('raw-detail'));assert.ok(!presentation.summary.includes('calendarId'));
  }
})


test('UI-3 attachment shortcuts respect unresolved submissions and restore the selected intent', async () => {
  const f = fixture(), intents: string[] = []
  f.core.state.sessions[0].running = true
  f.core.currentAttachmentDrafts = () => [{ attachmentId: 'fixture', file: {name:'fixture.txt',size:1,lastModified:1}, contentType:'text/plain' }]
  f.core.sendDesktopMessageWithAttachments = async () => { intents.push(f.core.composerInputMode('session-test')); return {} }
  f.core.state.unresolvedSubmission = true; await f.core.sendDraft('带附件排队', 'queue'); assert.equal(intents.length, 0)
  f.core.state.unresolvedSubmission = false; await f.core.sendDraft('带附件排队', 'queue')
  assert.deepEqual(intents, ['queue']); assert.equal(f.core.composerInputMode('session-test'), 'queue')
})

test('D36 switching conversations preserves the account running-input preference', async () => {
  const f = fixture()
  f.core.state.sessions.push({ sessionId: 'next-session', sendAvailable: true, running: true })
  f.core.refreshHistory = async () => {}; f.core.refreshApprovalMode = async () => {}; f.core.refreshConversationTasks = async () => {}
  f.core.setMessageMode('steer'); await f.core.selectSession('next-session')
  assert.equal(f.core.composerInputMode('next-session'), 'steer')
})

test('D36 account preferences survive recreation, isolate accounts and preserve temporary send overrides', async () => {
  const f = fixture(); f.core.state.sessions[0].running = true;
  assert.equal(f.core.composerInputMode('session-test'), 'queue');
  f.core.setMessageMode('steer');
  const reloaded = f.api.create({ effects: f.effects, ...f.environment });
  Object.assign(reloaded.state, { ownerId: 'owner-test', sessions: f.core.state.sessions });
  assert.equal(reloaded.composerInputMode('session-test'), 'steer');
  reloaded.state.ownerId = 'another-account';
  assert.equal(reloaded.composerInputMode('session-test'), 'queue');
  reloaded.setMessageMode('queue'); reloaded.state.ownerId = 'owner-test';
  assert.equal(reloaded.composerInputMode('session-test'), 'steer');
  f.core.submitCommand = async () => ({});
  await f.core.sendDraft('临时排队', 'queue');
  assert.equal(f.values.get('weftmate:message-mode:owner-test'), 'steer');
  f.core.state.sessions[0].running = false;
  assert.equal(f.core.composerInputMode('session-test'), 'queue');
})

test('D36 stage timer uses the latest persisted turn and omits unknown or future timestamps', () => {
  const f = fixture(), now = Date.parse('2026-10-09T00:01:16Z');f.core.presence.success();
  const events = [{seq:1,type:'turn.started',at:'2026-10-09T00:00:00Z'}, {seq:4,type:'turn.started',at:'2026-10-09T00:01:00Z'}];
  assert.equal(f.core.processingStageLabel({phase:'loading',modelName:'Muse Q5'}, events, now),'正在加载模型 Muse Q5… 16 秒');
  assert.equal(f.core.processingStageLabel({phase:'reasoning'}, [], now),'正在思考…');
  assert.equal(f.core.processingStageLabel({phase:'reasoning'}, events, now-20000),'正在思考…');
})

test('D36 native account storage survives an origin change and rejects a late previous account read', async () => {
  const f = fixture(), nativeValues = new Map<string,string>();
  const messageModeStorage = async (key: string, value?: string) => {
    if (value !== undefined) nativeValues.set(key, value);
    return nativeValues.get(key);
  };
  const first = f.api.create({ effects:f.effects, ...f.environment, messageModeStorage });
  first.state.account = {ownerId:'owner-test'}; first.setMessageMode('steer'); await Promise.resolve();
  const second = f.api.create({ effects:f.effects, ...f.environment, storage:{getItem:()=>null,setItem(){}}, messageModeStorage });
  second.state.account = {ownerId:'owner-test'};
  await second.loadMessageModePreference(); assert.equal(second.messageModePreference(),'steer');
  const delayed = deferred();
  const switching = f.api.create({ effects:f.effects, ...f.environment, messageModeStorage:()=>delayed.promise });
  switching.state.account = {ownerId:'owner-test'}; const loading=switching.loadMessageModePreference();
  switching.state.identityGeneration++; switching.state.account={ownerId:'another-account'};switching.messageModePreference();
  delayed.resolve('steer');await loading;assert.equal(switching.messageModePreference(),'queue');
})
test('session lifecycle actions use protected writes and never enable an archived/read-only session by inference',async()=>{
  const f=fixture((url:string)=>({ok:true,json:async()=>url.endsWith('archived=all')?{sessions:[{sessionId:'session-test',archived:true,sendAvailable:false}]}:{archived:true}}));
  await f.core.archiveSession('session-test');assert.equal(f.core.composerState('hello').messageDisabled,true);assert.equal(f.core.sessionList().length,0);assert.equal(f.core.sessionList(true).length,1);
  const write=f.requests.find(r=>r.options.method==='POST')!;assert.equal(write.options.headers['X-WeftMate-CSRF'],'synthetic-csrf');assert.match(write.path,/\/archive$/);
});

test('UI-P4 native occupancy uses the projected current surface, never cumulative billing tokens', async()=>{
  assert.deepEqual(contextUsage({projectedTokens:713000,pressureTokens:800000,contextWindow:828000}),{usedTokens:713000,contextWindow:828000});
  assert.deepEqual(contextUsage({pressureTokens:12000}),{usedTokens:12000,contextWindow:null});
  assert.equal(contextUsage({projectedTokens:-1,contextWindow:828000}),null);
  const adapter=createDshSessionAdapter({events:{},sessions:{list:async()=>({result:{ok:true,value:{items:[
    {sessionId:'session-test',projections:{values:{contextPressure:{projectedTokens:7000,contextWindow:10000}}}},
    {sessionId:'subagent',origin:'subagent',projections:{values:{contextPressure:{projectedTokens:9}}}},
  ]}}})}});
  assert.deepEqual(await adapter.list(),[{sessionId:'session-test',title:'新对话',running:false,contextUsage:{usedTokens:7000,contextWindow:10000}}]);
  const {api}=fixture();
  assert.equal(api.contextUsageView({usedTokens:713000,contextWindow:828000}).label,'背景信息窗口：86% 已用');
  assert.equal(api.contextUsageView({usedTokens:12000}).detail,'已用 12k 标记，上限未知');
  assert.equal(api.contextUsageView({usedTokens:1200000,contextWindow:1500000}).detail,'已用 1.2M 标记，共 1.5M');
  assert.equal(api.contextUsageView(null).ratio,null);
});

test('UI-P4 shows an optimistic message before the host answers and blocks a duplicate click',async()=>{
  const pending=deferred(),f=fixture(()=>pending.promise);f.core.refreshTasks=async()=>{};f.core.refreshHistory=async()=>{};
  const send=f.core.sendDraft('立即出现');
  assert.equal(f.core.optimisticMessages()[0].text,'立即出现');assert.equal(f.core.optimisticMessages()[0].status,'sending');
  await f.core.sendDraft('立即出现');assert.equal(f.requests.filter(row=>row.options.method==='POST').length,1);
  const requestId=JSON.parse(f.requests[0].options.body).requestId;
  pending.resolve(response({command:{requestId,kind:'session.message',sessionId:'session-test',state:'accepted_by_dsh',receiptId:'native-rpc'}}));await send;
  assert.equal(f.core.optimisticMessages()[0].status,'accepted');
  f.core.observeOptimistic([{type:'user.message',data:{text:'立即出现',receiptId:'other-rpc'}}]);assert.equal(f.core.optimisticMessages().length,1);
  f.core.observeOptimistic([{type:'user.message',data:{text:'立即出现',receiptId:'native-rpc'}}]);assert.equal(f.core.optimisticMessages().length,0);
});

test('UI-P4 unconfirmed delivery retries the original request ID after checking the receipt',async()=>{
  let writes=0;const f=fixture((url,options)=>{
    if(options.method==='POST'){writes++;if(writes===1)throw Error('connection lost');const body=JSON.parse(options.body);return response({command:{requestId:body.requestId,sessionId:'session-test',state:'accepted_by_dsh',receiptId:'retry-rpc'}});}
    return response({error:{code:'NOT_FOUND'}},404);
  });f.core.refreshTasks=async()=>{};f.core.refreshHistory=async()=>{};
  await f.core.sendDraft('保留并重试');const row=f.core.optimisticMessages()[0];assert.equal(row.status,'failed');
  await f.core.retryOptimistic(row.requestId);
  const posted=f.requests.filter(row=>row.options.method==='POST').map(row=>JSON.parse(row.options.body));
  assert.equal(posted.length,2);assert.equal(posted[0].requestId,posted[1].requestId);assert.equal(row.status,'accepted');
});

test('UI-P4 a later confirmed task supersedes the original pending POST snapshot',async()=>{
  const f=fixture((_url,options)=>response({command:{requestId:JSON.parse(options.body).requestId,sessionId:'session-test',kind:'session.message',state:'pending'}}));
  f.core.refreshTasks=async()=>{const body=JSON.parse(f.requests[0].options.body);f.core.state.tasks=[{requestId:body.requestId,kind:'session.message',sessionId:'session-test',state:'accepted_by_dsh',receiptId:'confirmed-rpc'}];f.core.updateFromCommand(f.core.state.tasks[0]);};
  f.core.refreshHistory=async()=>{};await f.core.sendDraft('正式消息');assert.equal(f.core.optimisticMessages()[0].status,'accepted');
  f.core.observeOptimistic([{type:'user.message',data:{receiptId:'confirmed-rpc'}}]);assert.equal(f.core.optimisticMessages().length,0);
});

test('UI-P4 first message appears before session creation and survives an account boundary safely',async()=>{
  const pending=deferred(),f=fixture(()=>pending.promise);f.core.refreshTasks=async()=>{};
  f.core.startNewConversation();assert.equal(f.core.state.selectedSessionId,null);assert.equal(f.core.composerState('首条消息').sendDisabled,false);
  const send=f.core.sendDraft('首条消息');assert.equal(f.core.optimisticMessages()[0].sessionId,null);
  assert.equal(JSON.parse(f.requests.find(row=>row.options.method==='POST')!.options.body).kind,'session.create');
  f.core.state.identityGeneration++;f.core.state.ownerId='other-owner';
  pending.resolve(response({command:{requestId:'old-create',kind:'session.create',sessionId:'old-session',state:'accepted_by_dsh'}}));await send;
  assert.equal(f.core.optimisticMessages().length,0);assert.equal(f.core.state.selectedSessionId,null);
});

test('UI-P4 switching accounts during receipt lookup never retries the old account text',async()=>{
  const lookup=deferred(),f=fixture();f.core.accessApi=()=>lookup.promise;
  const row=f.core.beginOptimistic({sessionId:'session-test',requestId:'old-id',text:'原账户草稿',status:'failed'});
  const retry=f.core.retryOptimistic(row.requestId);f.core.state.identityGeneration++;f.core.state.ownerId='other-owner';
  lookup.resolve({command:null});await retry;
  assert.equal(f.requests.length,0);assert.equal(f.core.optimisticMessages().length,0);
});

test('UI-P4 a new draft reads the account approval mode and applies its chosen mode before sending',async()=>{
  const f=fixture(url=>response(url.endsWith('/settings/approvals')?{mode:'ask'}:{}));
  f.core.startNewConversation();await new Promise(done=>setTimeout(done,0));assert.equal(f.core.state.newConversationApprovalMode,'ask');
  await f.core.saveApprovalMode('plan');assert.equal(f.core.state.newConversationApprovalMode,'plan');
  const operations:string[]=[];
  f.core.submitCommand=async(kind,fields,_session,id)=>{operations.push(kind);return {requestId:id,kind,sessionId:'new-session',state:'accepted_by_dsh',receiptId:kind==='session.message'?'new-rpc':undefined};};
  f.core.refreshSessions=async()=>{};f.core.refreshHistory=async()=>{};f.core.refreshApprovalMode=async()=>{};
  f.core.selectSession=async id=>{f.core.state.selectedSessionId=id;f.core.state.newConversation=false;};
  f.core.accessApi=async(_path,options)=>{operations.push('approval-mode:'+options.body.mode);return {mode:options.body.mode};};
  await f.core.sendDraft('先出计划');assert.deepEqual(operations,['session.create','approval-mode:plan','session.message']);
});

test('FIX-40 side selection accepts its approval read after binding the logical chat identity',async()=>{
  const pending=deferred(), f=fixture();
  Object.assign(f.core.state,{selectedChatId:'previous-chat',activeChatSource:'desktop',chats:[{chatId:'side-chat',activeSessionId:'side-session'}]});
  f.core.state.sessions.push({sessionId:'side-session',running:false,sendAvailable:true});
  f.core.refreshHistory=async()=>{};f.core.refreshConversationTasks=async()=>{};
  f.core.accessApi=async(path:string)=>{assert.match(path,/\/sessions\/side-session\/approval-mode$/);return pending.promise;};
  let reading!:Promise<void>;const refresh=f.core.refreshApprovalMode;
  f.core.refreshApprovalMode=(id:string)=>{reading=refresh(id);return reading;};
  await f.core.selectSession('side-session');
  assert.equal(f.core.state.selectedChatId,'side-chat');assert.equal(f.core.state.approvalModeLoading,true);
  pending.resolve({mode:'ask'});await reading;
  assert.equal(f.core.currentApprovalMode,'ask');assert.equal(f.core.state.approvalModeLoading,false);
  assert.deepEqual(f.paints.filter(row=>row.name==='setApprovalModeBusy').at(-1)?.args,[false]);
});

test('FIX-40 an old approval read cannot unlock or replace a newer conversation read',async()=>{
  const old=deferred(), next=deferred(), f=fixture();
  Object.assign(f.core.state,{selectedChatId:'old-chat',activeChatSource:'desktop'});
  f.core.accessApi=async(path:string)=>path.includes('/session-test/')?old.promise:next.promise;
  const first=f.core.refreshApprovalMode('session-test');
  Object.assign(f.core.state,{selectedSessionId:'next-session',selectedChatId:'next-chat'});
  const second=f.core.refreshApprovalMode('next-session');
  old.resolve({mode:'allow-all'});await first;
  assert.equal(f.core.state.approvalModeLoading,true);assert.equal(f.core.currentApprovalMode,'auto');
  next.resolve({mode:'ask'});await second;
  assert.equal(f.core.state.approvalModeLoading,false);assert.equal(f.core.currentApprovalMode,'ask');
});

test('FIX-40 a main chat without a session saves ask to that chat and validates the receipt',async()=>{
  const f=fixture();f.core.state.selectedSessionId=null;f.core.state.selectedChatId='chat-main';
  f.core.accessApi=async(path,options)=>{
    assert.equal(path,'/chats/chat-main');assert.equal(options.method,'PATCH');
    assert.equal(options.body.approvalMode,'ask');return {chat:{approvalMode:'ask'}};
  };
  await f.core.saveApprovalMode('ask');assert.equal(f.core.currentApprovalMode,'ask');
  f.core.accessApi=async()=>({chat:{approvalMode:'auto'}});
  await f.core.saveApprovalMode('plan');assert.equal(f.core.currentApprovalMode,'ask');
  assert.ok(f.paints.some(row=>row.name==='historyNotice'&&row.args[0].includes('未保存')));
});

test('FIX-40 a mismatched first-message approval receipt prevents session.message',async()=>{
  const f=fixture();f.core.refreshNewConversationApprovalMode=async()=>{};f.core.startNewConversation();
  f.core.state.newConversationApprovalMode='ask';const operations:string[]=[];
  f.core.submitCommand=async(kind,fields,_session,id)=>{operations.push(kind);return {requestId:id,kind,sessionId:'new-session',state:'accepted_by_dsh'};};
  f.core.refreshSessions=async()=>{};f.core.selectSession=async id=>{f.core.state.selectedSessionId=id;f.core.state.newConversation=false;};
  f.core.accessApi=async()=>({mode:'auto'});
  await f.core.sendDraft('必须先问');assert.deepEqual(operations,['session.create']);
  assert.equal(f.core.optimisticMessages()[0].status,'failed');
});

test('FIX-40 a message waits for the selected approval mode write to finish',async()=>{
  const f=fixture(),writing=deferred();f.core.accessApi=()=>writing.promise;
  const saved=f.core.saveApprovalMode('ask');await new Promise(done=>setImmediate(done));
  assert.match(f.core.sendBlocker('在保存后发送'),/审批方式/);
  writing.resolve({mode:'ask'});await saved;assert.equal(f.core.state.approvalModeSaving,null);
});

test('UI-P4 starting another new conversation does not display an earlier uncreated failed message',async()=>{
  const f=fixture();f.core.refreshNewConversationApprovalMode=async()=>{};
  f.core.startNewConversation();f.core.beginOptimistic({sessionId:null,draftId:f.core.state.newConversationId,requestId:'failed-first',text:'旧草稿',status:'failed'});
  assert.equal(f.core.optimisticMessages().length,1);f.core.startNewConversation();assert.equal(f.core.optimisticMessages().length,0);
});

test('FIX-8 new desktop drafts clear phone selection, pagination and late handoff callbacks', async () => {
  const waiting = deferred(), f = fixture(path => path.includes('/shared') ? waiting.promise : response({mode:'auto'}));
  const conversationId = 'conversation-00000000-0000-4000-8000-000000000099';
  Object.assign(f.core.state,{syncAvailable:true,activeChatSource:'phone',selectedPhoneConversationId:conversationId,
    hasOlder:true,nextBeforeSeq:12,olderLoading:true,historyHasMore:true,turnEndReasonKind:'aborted'});
  f.core.state.phoneEvents=[{seq:1,conversationId,sourceDeviceId:'device-phone',kind:'conversation.created',payload:{title:'Phone'}}];
  const binding=f.core.refreshPhoneBinding(conversationId);
  f.core.startNewConversation();
  const draftId=f.core.state.newConversationId;
  waiting.resolve(response({source:'host',hostId:'host-test',conversationId,status:'active',binding:{sessionId:'session-test'}}));
  await binding;
  assert.equal(f.core.state.activeChatSource,'desktop');assert.equal(f.core.state.selectedPhoneConversationId,null);
  assert.equal(f.core.state.selectedSessionId,null);assert.equal(f.core.state.newConversation,true);
  assert.equal(f.core.state.hasOlder,false);assert.equal(f.core.state.nextBeforeSeq,null);assert.equal(f.core.state.olderLoading,false);
  assert.equal(f.core.state.historyHasMore,false);assert.equal(f.core.state.turnEndReasonKind,null);
  assert.equal(f.core.composerState('').phoneChat,false);assert.ok(f.paints.some(p=>p.name==='paintDesktopComposer'));
  f.core.startNewConversation();assert.notEqual(f.core.state.newConversationId,draftId);
});

test('FIX-8 stop notices count only the current conversation queued messages and confirm fallback receipts', async () => {
  for(const count of [0,2]){
    const f=fixture();f.core.state.sessions[0].running=true;
    f.core.state.historyEvents.set(1,{seq:1,type:'task.started',data:{taskId:'current-root'}});
    for(let n=0;n<count;n++)f.core.state.historyEvents.set(n+2,{seq:n+2,type:'task.queued',data:{taskId:`queue-${n}`}});
    f.core.state.historyEvents.set(9,{seq:9,type:'task.queued',data:{taskId:'cancelled-root'}});
    f.core.state.historyEvents.set(10,{seq:10,type:'task.ended',data:{taskId:'cancelled-root',reason:'cancelled'}});
    await f.core.stopCurrentTurn();
    assert.equal(f.paints.filter(p=>p.name==='toast').at(-1)?.args[0],count?'已停止当前回复，还有 2 条排队消息会继续':'已停止');
  }
  for(const state of ['pending','accepted_by_dsh']){
    const f=fixture();f.core.state.sessions[0].running=true;f.core.submitCommand=async()=>({state});
    await f.core.stopCurrentTurn();
    assert.equal(f.paints.filter(p=>p.name==='toast').length,state==='accepted_by_dsh'?1:0);
  }
});

test('FIX-8 refreshed session titles repaint the selected header after a local account is bound', async () => {
  const f=fixture(path=>response(path.includes('/sessions')?{sessions:[{sessionId:'session-test',title:'你好',sendAvailable:true}]}:{devices:[]}));
  f.core.acceptSession({account:{ownerId:'owner-test',username:'Synthetic'},device:{id:'device-test'},csrfToken:'renewed-after-binding'});
  await f.core.refreshSessions();
  assert.equal(f.core.state.selectedSessionId,'session-test');assert.equal(f.core.state.activeChatSource,'desktop');
  assert.equal(f.core.state.sessions[0].title,'你好');
  assert.deepEqual(plain(f.paints.filter(p=>p.name==='paintSelectedSession').at(-1)?.args),['session-test']);
});

test('FIX-8 an accepted creation observed before the pending POST snapshot still sends the first draft once', async () => {
  const f=fixture();f.core.startNewConversation();f.core.state.newConversationApprovalMode=null;
  const sends:string[]=[];
  f.core.refreshSessions=async()=>{};f.core.refreshHistory=async()=>{};
  f.core.selectSession=async id=>{f.core.state.selectedSessionId=id;f.core.state.newConversation=false;};
  f.core.submitCommand=async(kind,_fields,_session,requestId)=>{
    sends.push(kind);
    if(kind==='session.create'){
      f.core.updateFromCommand({kind,requestId,sessionId:'created-session',state:'accepted_by_dsh'});
      return {kind,requestId,sessionId:'created-session',state:'pending'};
    }
    return {kind,requestId,state:'accepted_by_dsh',receiptId:'first-rpc'};
  };
  await f.core.sendDraft('首条目标');
  assert.deepEqual(sends,['session.create','session.message']);
  assert.equal(f.core.state.selectedSessionId,'created-session');
  assert.equal(f.core.optimisticMessages()[0].status,'accepted');
});
test('a delayed lifecycle response cannot replace another account session list',async()=>{
  const pending=deferred(),f=fixture(()=>pending.promise);
  const work=f.core.archiveSession('session-test');f.core.state.identityGeneration++;f.core.state.sessions=[{sessionId:'other-account'}];pending.resolve({ok:true,json:async()=>({archived:true})});
  assert.equal(await work,false);assert.equal(f.core.state.sessions[0].sessionId,'other-account');
});


test('reminder reads work in the mobile settings category and discard a late account response', async () => {
  const pending = deferred();
  const f = fixture(path => path === '/personal/v1/schedules' ? pending.promise : response({}));
  f.core.state.currentView = 'schedules';
  const read = f.core.loadSchedules(); pending.resolve(response({ items: [{ id: 'fixture-reminder' }] }));
  assert.deepEqual(plain(await read), { items: [{ id: 'fixture-reminder' }] });
  const late = deferred(), switched = fixture(() => late.promise);
  switched.core.state.currentView = 'schedules'; const oldRead = switched.core.loadSchedules();
  switched.core.state.identityGeneration++; switched.core.state.account = { ownerId: 'other-owner' };
  late.resolve(response({ items: [{ id: 'old-owner-reminder' }] }));
  assert.equal(await oldRead, null);
});


test('MS-1 saved default selects the next new conversation without rebinding the existing session', async () => {
  const f = fixture(() => response({ defaultModelProfileId: 'cloud', backgroundModelProfileId: null }));
  f.core.state.models.push({ id: 'cloud', name: 'Synthetic cloud', configured: true });
  f.core.state.sessions[0].modelProfileId = 'local';
  await f.core.saveDefaultModel('cloud');
  assert.equal(f.core.state.modelProfileId, 'local');
  f.core.startNewConversation();
  assert.equal(f.core.state.modelProfileId, 'cloud');
  assert.equal(f.core.state.sessions[0].modelProfileId, 'local');
});

test('UX-9 folder registration keeps editing available but blocks a send until project selection is ready',async()=>{
 const f=fixture(),reply=deferred();f.core.refreshSessionProjects=async()=>{};
 const registration=f.core.registerFolderChoice(()=>reply.promise,{});
 assert.equal(f.core.composerState('合成草稿').messageDisabled,false);assert.equal(f.core.composerState('合成草稿').sendDisabled,true);
 await f.core.sendDraft('合成草稿');assert.equal(f.requests.length,0);
 reply.resolve({project:{projectId:'project-synthetic'}});await registration;assert.equal(f.core.composerState('合成草稿').sendDisabled,false);
});


test('STREAM-1b a new main-chat user message enables live reads until native terminal evidence',()=>{
 const f=fixture();Object.assign(f.core.state,{mainChat:{chatId:'main',running:false},selectedChatId:'main',activeChatSource:'desktop'});
 assert.equal(f.core.mainReplyActive(),false);
 f.core.state.chatWindow.events.set('user',{eventId:'user',orderKey:'1',type:'user.message',data:{text:'继续'}});
 assert.equal(f.core.mainReplyActive(),true);
 f.core.state.chatWindow.events.set('end',{eventId:'end',orderKey:'2',type:'turn.ended',data:{reason:'aborted'}});
 assert.equal(f.core.mainReplyActive(),false,'aborted replies return to idle reads');
});
