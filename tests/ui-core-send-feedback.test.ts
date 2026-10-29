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
  for (const kind of ['session.create', 'session.side.create', 'session.message', 'chat.message', 'session.cancel']) {
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
  ['folder mutation', c => c.folderMutationPending = () => true],
  ['submission', c => c.state.submitting = true],
  ['upload', c => c.state.attachmentUpload = {}],
  ['unresolved receipt', c => c.state.unresolvedSubmission = true],
  ['chat unavailable', c => c.state.capabilities.chat.available = false],
  ['chat loading', c => c.state.capabilities.chat = {}],
  ['session read only', c => c.state.sessions[0].sendAvailable = false],
  ['session selection', c => c.state.sessionSelecting = true],
  ['side creation', c => c.state.sideCreating = true],
  ['offline', c => c.state.online = false],
  ['model missing', c => {c.state.models = []; c.state.modelProfileId = null}],
  ['empty message', () => {}],
];
for (const main of [false, true]) for (const [name, block] of cases) {
  if (main && name === 'session read only') continue;
  test(`FIX-32 ${main ? 'main' : 'session'} send explains ${name} without clearing the draft`, async () => {
    const f = fixture();
    if (main) Object.assign(f.core.state, {personalCapabilities:{chatSend:1},mainChat:{chatId:'main',sendAvailable:true},selectedChatId:'main',activeChatSource:'desktop'});
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

for(const [name,block] of [['chat API unavailable',c=>c.state.personalCapabilities.chatSend=0],['main read only',c=>c.state.mainChat.sendAvailable=false]])test(`FIX-32 main send explains ${name}`,async()=>{
 const f=fixture();Object.assign(f.core.state,{personalCapabilities:{chatSend:1},mainChat:{chatId:'main',sendAvailable:true},selectedChatId:'main',activeChatSource:'desktop'});block(f.core);
 assert.equal(f.core.composerState('保留的草稿').sendDisabled,true);await f.core.sendDraft('保留的草稿');assert.ok(f.paints.some(p=>p.name==='toast'));assert.equal(f.requests.length,0);
});

test('FIX-32 main duplicate during asynchronous acceptance is disabled and explained',async()=>{
 const f=fixture();Object.assign(f.core.state,{personalCapabilities:{chatSend:1},mainChat:{chatId:'main',sendAvailable:true},selectedChatId:'main',activeChatSource:'desktop'});
 let resolve;const gate=new Promise(done=>resolve=done);let sends=0;
 f.core.submitCommand=()=>{sends++;return gate};f.core.refreshHistory=async()=>{};
 const first=f.core.sendDraft('第一句话');assert.equal(f.core.composerState('第一句话').sendDisabled,true);await f.core.sendDraft('第一句话');assert.equal(sends,1);assert.ok(f.paints.some(p=>p.name==='toast'));
 resolve(null);await first;
});

test('FIX-32 thinking write disables send and explains a stale activation',async()=>{
 let resolve;const gate=new Promise(done=>resolve=done);
 const f=fixture(path=>path.endsWith('/thinking')?gate:response({}));f.core.state.models[0].deepThinking={supported:true};
 const save=f.core.setDeepThinking(true);assert.equal(f.core.composerState('保留的草稿').sendDisabled,true);await f.core.sendDraft('保留的草稿');assert.ok(f.paints.some(p=>p.name==='toast'));assert.equal(f.requests.some(r=>r.options.method==='POST'),false);
 resolve(response({session:{sessionId:'session-test',deepThinking:true}}));await save;
});
