// 保护：忙时点击的去向、独立草稿与旧回执，防止消息重复或被送往另一段对话。
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

test('single status: normal chat command receipts update locks without painting a bottom notice', () => {
  for (const kind of ['session.create', 'session.side.create', 'session.message', 'session.cancel']) {
    const f = fixture(); f.core.creatingOptimisticSession = true;
    for (const state of ['pending', 'dispatching', 'accepted_by_dsh']) {
      const requestId = `synthetic-${kind}`;
      f.core.rememberMarker({ kind, requestId });
      f.core.updateFromCommand({ kind, requestId, commandId: 'synthetic-command', sessionId: 'session-test', state });
      assert.equal(f.core.state.unresolvedSubmission, state !== 'accepted_by_dsh');
    }
    assert.deepEqual(f.paints.filter(row => row.name === 'paintOperation'), [], kind);
  }
});

test('single status: an active chat POST is not treated as a missing receipt', async () => {
  let release!: (value: any) => void;
  const post = new Promise(resolve => { release = resolve; });
  const f = fixture((_path, options) => options.method === 'POST' ? post : response({ error: { code: 'NOT_FOUND' } }, 404));
  f.core.creatingOptimisticSession = true; f.core.refreshTasks = async () => {};
  f.core.refreshHistory = async () => f.core.historyReadResult('unchanged');
  const sending = f.core.submitCommand('session.create', { modelProfileId: 'local' }, null, 'synthetic-post');
  await f.core.refreshLiveConversation();
  assert.equal(f.requests.filter(row => row.options.method !== 'POST').length, 0);
  assert.deepEqual(f.paints.filter(row => row.name === 'paintOperation'), []);
  release(response({ command: { kind: 'session.create', requestId: 'synthetic-post', commandId: 'synthetic-command', sessionId: 'session-test', state: 'accepted_by_dsh' } }));
  await sending;
  assert.deepEqual(f.paints.filter(row => row.name === 'paintOperation'), []);
});

test('single status: genuine failure and uncertain receipts retain feedback and recovery clears it', () => {
  for (const state of ['failed', 'rejected', 'uncertain']) {
    const f = fixture(), requestId = 'synthetic-error';
    f.core.rememberMarker({ kind: 'session.message', requestId });
    f.core.updateFromCommand({ kind: 'session.message', requestId, commandId: 'synthetic-command', sessionId: 'session-test', state });
    assert.ok(f.paints.some(row => row.name === 'paintOperation' && row.args[0]));
    if (state === 'uncertain') {
      assert.ok(f.core.state.reviewableRequests.has(requestId));
      f.core.updateFromCommand({ kind: 'session.message', requestId, commandId: 'synthetic-command', sessionId: 'session-test', state: 'accepted_by_dsh' });
      assert.equal(f.core.state.unresolvedSubmission, false);
      assert.equal(f.core.state.reviewRequestId, null);
      assert.ok(f.paints.some(row => row.name === 'clearOperation'));
    }
  }
});

test('single status: a failed POST still reports the uncertain delivery without resending', async () => {
  const f = fixture((_path, options) => { if (options.method === 'POST') throw Error('synthetic disconnect'); return response({ error: { code: 'NOT_FOUND' } }, 404); });
  await f.core.submitCommand('session.message', { text: '合成消息' }, 'session-test', 'synthetic-uncertain');
  assert.equal(f.requests.filter(row => row.options.method === 'POST').length, 1);
  assert.ok(f.paints.some(row => row.name === 'paintOperation' && row.args[0]));
  assert.ok(f.core.state.reviewableRequests.has('synthetic-uncertain'));
});

test('single status: non-chat operations still use their shared feedback outlet', () => {
  const f = fixture();
  f.core.rememberMarker({ kind: 'desktop.open_app', requestId: 'synthetic-desktop' });
  f.core.updateFromCommand({ kind: 'desktop.open_app', requestId: 'synthetic-desktop', commandId: 'synthetic-command', state: 'dispatching' });
  assert.ok(f.paints.some(row=>row.name==='paintOperation' && row.args[0]));
});

test('single status: a cancel POST keeps earlier uncertainty locked until its real receipt', async () => {
  let release!: (value: any) => void;
  const post = new Promise(resolve => { release = resolve; });
  const f = fixture(() => post); f.core.refreshTasks = async () => {};
  f.core.operation('合成停止结果尚未确认', true, 'synthetic-cancel');
  const sending = f.core.submitCommand('session.cancel', { sessionId: 'session-test' }, 'session-test', 'synthetic-cancel');
  assert.equal(f.core.state.unresolvedSubmission, true);
  assert.ok(f.core.state.reviewableRequests.has('synthetic-cancel'));
  release(response({ command: { kind: 'session.cancel', requestId: 'synthetic-cancel', commandId: 'synthetic-command', sessionId: 'session-test', state: 'accepted_by_dsh' } }));
  await sending;
  assert.equal(f.core.state.unresolvedSubmission, false);
});

const cases = [
  ['chat unavailable', c => c.state.capabilities.chat.available = false],
  ['chat loading', c => c.state.capabilities.chat = {}],
  ['session read only', c => c.state.sessions[0].sendAvailable = false],
  ['offline', c => c.state.online = false],
  ['model missing', c => {c.state.models = []; c.state.modelProfileId = null}],
  ['empty message', () => {}],
];
for (const [name, block] of cases) {
  test(`FIX-32 session send explains ${name} without clearing the draft`, async () => {
    const f = fixture();
    block(f.core);
    const text = name === 'empty message' ? '' : '合成草稿';
    const view = f.core.composerState(text);
    await f.core.sendDraft(text);
    assert.equal(f.requests.filter(r=>r.options.method==='POST').length,0);
    assert.ok(view.sendDisabled || f.paints.some(p=>p.name==='toast'&&typeof p.args[0]==='string'&&p.args[0]), 'disabled or visible feedback');
    assert.ok(f.paints.some(p=>p.name==='toast'&&typeof p.args[0]==='string'&&p.args[0]), 'stale enabled click and keyboard entry both receive a reason');
    assert.equal(f.paints.some(p=>p.name==='clearMessageDraft'),false);
  });
}

test('FIX-32 repeated pending text is visible and disabled',async()=>{
  const f=fixture();f.core.beginOptimistic({sessionId:'session-test',requestId:'pending',text:'合成草稿'});
  assert.equal(f.core.composerState('合成草稿').sendDisabled,true);await f.core.sendDraft('合成草稿');
  assert.ok(f.paints.some(p=>p.name==='toast'));assert.equal(f.requests.length,0);
});

test('FIX-32 the old main chat explains it is read-only without sending',async()=>{
 const f=fixture();Object.assign(f.core.state,{mainChat:{chatId:'main'},selectedChatId:'main',activeChatSource:'desktop'});
 assert.equal(f.core.composerState('保留的草稿').sendDisabled,true);await f.core.sendDraft('保留的草稿');
 assert.ok(f.paints.some(p=>p.name==='toast'&&/旧主对话只能查看/.test(p.args[0])));assert.equal(f.requests.length,0);
});

test('a busy conversation accepts only its first click and sends the captured text once after release',async()=>{
 for(const flag of ['approvalModeSaving','sessionSelecting','folderRegistering','submitting','attachmentUpload','unresolvedSubmission']){
   const {core}=fixture(), sent:any[]=[];
   core.submitCommand=async(kind,fields,session,id)=>{sent.push({kind,fields,session,id});return {requestId:id,state:'accepted_by_dsh'}};
   core.refreshHistory=async()=>{};
   if(flag==='folderRegistering')core.folderMutationPending=()=>core.state[flag];
   core.state[flag]={};const first=await core.sendDraft('先发这条');
   assert.equal(first.waiting,true,flag);assert.equal(core.composerState('下一条草稿').sendDisabled,true);
   await core.sendDraft('下一条草稿');assert.equal(sent.length,0);
   core.state[flag]=null;core.composerState('下一条草稿');core.composerState('下一条草稿');
   await new Promise(done=>setImmediate(done));
   assert.deepEqual(sent.map(r=>[r.fields.text,r.session,r.id]),[['先发这条','session-test',first.requestId]],flag);
 }
});
test('a delayed model save that fails, or a changed account, device, session or network cannot release the original message',async()=>{
 for (const change of ['save failed','owner','device','host','session','offline']){
   let finish;const gate=new Promise(done=>finish=done);
   const f=fixture(path=>path.endsWith('/thinking')?gate:response({})),c=f.core;
   c.state.models[0].deepThinking={supported:true};
   const save=c.setDeepThinking(true);const first=await c.sendDraft('可取回');assert.equal(first.waiting,true);
   if(change==='owner') {c.state.ownerId='different';c.state.identityGeneration++;}
   if(change==='device')c.state.device={id:'different'};
   if(change==='host')c.state.hostId='other-host';
   if(change==='session'){c.state.selectedSessionId='other-session';c.state.sessions=[];}
   if(change==='offline')c.state.online=false;
   c.composerState('');finish(change==='save failed'?response({},500):response({enabled:true}));await save;
   let slot=c.heldDraft();if(change==='owner'){assert.equal(slot,undefined);c.state.ownerId='owner-test';slot=c.heldDraft();}
   assert.equal(slot.waiting,false,change);assert.equal(slot.text,'可取回');
   assert.equal(f.requests.some(r=>r.options.method==='POST'),false);
   c.reclaimDraft(first.requestId);assert.ok(f.paints.some(p=>p.name==='restoreMainChatDraft'&&p.args[0]==='可取回'));assert.equal(c.heldDraft(),undefined);
 }
});
test('a held click looks up the old receipt and never posts while its outcome is unknown',async()=>{
 let settle;const gate=new Promise(done=>settle=done);const f=fixture(path=>path.includes('/by-request/')?gate:response({})),c=f.core;
 c.rememberMarker({requestId:'previous',kind:'session.message',sessionId:'session-test'});c.trackRequestState(true,'previous');
 const sent:any[]=[];c.submitCommand=async(...args)=>{sent.push(args);};const first=await c.sendDraft('等核对');
 assert.ok(f.requests.some(r=>r.path.endsWith('/commands/by-request/previous')));assert.equal(c.heldDraft().waiting,true);assert.equal(sent.length,0);
 settle(response({command:{kind:'session.message',requestId:'previous',commandId:'old',state:'accepted_by_dsh',sessionId:'session-test'}}));
 await new Promise(done=>setImmediate(done));c.composerState('');await new Promise(done=>setImmediate(done));
 assert.equal(sent.length,1);assert.equal(sent[0][3],first.requestId);
});

test('two open conversations keep separate slots and release only to their original sessions',async()=>{
 const {core:c}=fixture();c.state.sessions.push({sessionId:'second',sendAvailable:true});
 const sent:any[]=[];c.submitCommand=async(_kind,fields,_session,id)=>{sent.push([fields.sessionId,fields.text,id]);};
 c.state.submitting=true;const a=await c.sendDraft('第一段');c.state.selectedSessionId='second';
 assert.equal(c.heldDraft(),undefined);const b=await c.sendDraft('第二段');
 c.state.submitting=false;c.composerState('');await new Promise(done=>setImmediate(done));
 assert.deepEqual(sent,[['second','第二段',b.requestId]]);
 c.state.selectedSessionId='session-test';c.composerState('');await new Promise(done=>setImmediate(done));
 assert.deepEqual(sent,[['second','第二段',b.requestId],['session-test','第一段',a.requestId]]);
});
