import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { uiCoreAssets } from '../src/ui-core/manifest.mjs';
const source = uiCoreAssets.map(file => readFileSync(new URL('../src/ui-core/' + file, import.meta.url), 'utf8')).join('\n;\n');
const sessionId = 'session-12345678-1234-4234-8234-123456789abc';
const command = { requestId: 'original-request', commandId: 'command-one', sessionId,
  kind: 'session.message', state: 'accepted_by_dsh', receiptId: 'receipt-one' };
function fixture(read: any = async () => command) {
  const scope: any = { URL, URLSearchParams, AbortSignal, setTimeout, clearTimeout, setInterval, clearInterval };
  runInNewContext(source, scope);
  const values = new Map<string, string>(), calls: string[] = [], notices: string[] = [];
  const state: any = { owner: 'owner-one', authEpoch: 1, sharedGeneration: 1, loggedIn: true,
    page: 'chat', chatSource: 'host', sharedSessionId: sessionId, sharedNextSeq: 10,
    sharedSessions: [{sessionId, sendAvailable: true}], sharedEvents: [], linkedEvents: new Map(),
    handoffViews: new Map(), conversations: [], deviceId: 'phone-one', sharedHostAvailable: true };
  let draft = 'synthetic request';
  const effects: any = new Proxy({}, { get: (_: any, name: string) => name === 'readMessageDraft' ? () => draft
    : name === 'clearMessageDraft' ? () => {draft = ''; state.draft = '';}
    : name === 'readChatStatus' ? () => notices.at(-1) || ''
    : name === 'status' ? (text: string) => notices.push(text) : () => {} });
  const core = scope.WeftUiCore.create({mobileState: state, effects,
    storage: {getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key)},
    fetch: async (path: string) => {calls.push(path); return {ok: true, json: async () => ({command: await read(path)})};},
    crypto: {randomUUID: () => 'test-id'}, attachmentDrafts: new Map() });
  core.syncMobileIdentity();
  const row = core.beginOptimistic({sessionId, requestId: command.requestId, text: draft, attachmentIds: [], afterSeq: 10});
  row.status = 'failed';
  state.sharedPending = {requestId: command.requestId, state: 'uncertain', text: draft, afterSeq: 10, attachmentIds: []};
  values.set(core.mobile.sharedDraftKey(), draft);
  return {core, state, row, values, calls, notices, effects, draft: () => draft, edit: (text: string) => {draft = text; values.set(core.mobile.sharedDraftKey(), text);} };
}
test('FX-9 original accepted receipt settles mobile send even when task detail is unavailable', async () => {
  const f = fixture();
  f.state.sharedEvents = [{seq: 11, type: 'user.message', data: {text: 'synthetic request', receiptId: 'receipt-one'}},
    {seq: 12, type: 'assistant.message', data: {text: 'complete response'}},
    {seq: 13, type: 'turn.ended', data: {reason: 'completed'}}];
  await f.core.mobile.reconcileSharedDelivery();
  assert.equal(f.state.sharedPending, null);
  assert.equal(f.draft(), '');
  assert.equal(f.values.has(f.core.mobile.sharedDraftKey()), false);
  assert.equal(f.core.optimisticMessages().length, 0);
  assert.equal(f.notices.at(-1), '');
  assert.deepEqual(f.calls, ['/personal/v1/commands/by-request/original-request']);
});
test('FX-9 unrelated receipt or reply cannot confirm the original send', async () => {
  const f = fixture(async () => ({...command, requestId: 'other-request'}));
  f.state.sharedEvents = [{seq: 12, type: 'assistant.message', data: {text: 'older reply'}}];
  await f.core.mobile.reconcileSharedDelivery();
  assert.equal(f.state.sharedPending.state, 'uncertain');
  assert.equal(f.draft(), 'synthetic request');
  assert.equal(f.core.optimisticMessages()[0].status, 'failed');
});
test('FX-9 accepted old send preserves a newly edited draft', async () => {
  const f = fixture(); f.edit('next request');
  await f.core.mobile.reconcileSharedDelivery();
  assert.equal(f.state.sharedPending, null);
  assert.equal(f.draft(), 'next request');
  assert.equal(f.values.get(f.core.mobile.sharedDraftKey()), 'next request');
  assert.equal(f.row.status, 'accepted');
});
test('FX-9 late receipt after account or session change does not clear current draft', async () => {
  for (const boundary of ['account', 'session']) {
    let finish: any;
    const f = fixture(() => new Promise(resolve => {finish = resolve;}));
    const pending = f.core.mobile.reconcileSharedDelivery();
    await new Promise(resolve => setImmediate(resolve));
    if (boundary === 'account') {f.state.owner = 'owner-two'; f.state.authEpoch++;}
    else {f.state.sharedSessionId = 'session-other'; f.state.sharedGeneration++;}
    finish(command); await pending;
    assert.equal(f.draft(), 'synthetic request');
    assert.equal(f.state.sharedPending.state, 'uncertain');
  }
});
test('FX-9 history receipt confirms a desktop optimistic message without accepting an unrelated assistant message', () => {
  const f = fixture(); f.row.receiptId = command.receiptId;
  f.core.observeOptimistic([{type: 'assistant.message', data: {text: 'old'}}]);
  assert.equal(f.core.optimisticMessages().length, 1);
  f.core.observeOptimistic([{type: 'user.message', data: {receiptId: command.receiptId}}]);
  assert.equal(f.draft(), ''); assert.equal(f.row.status, 'accepted');
  assert.equal(f.core.optimisticMessages().length, 0);
});
test('FX-9 a chat-only session does not query nonexistent execution tasks', async () => {
  const f = fixture(); f.core.state.sessions[0].taskAvailable = false;
  f.core.state.tasks = [{...command}];
  await f.core.refreshConversationTasks();
  assert.deepEqual(f.calls, []);
});
