import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

// An optional exact historical source is used only by the warehouse compatibility
// probe. CI exercises the current production factory; neither path may show success.
const oldSource = process.env.WEFTMATE_TEST_OLD_MEMORY_UI_SOURCE;
const source = await readFile(oldSource || new URL('../src/ui-core/memory.js', import.meta.url), 'utf8');
test('a withheld page DELETE cannot appear complete or retry a deletion in current and historical consumers', async () => {
  const context: any = { WeftUiCore: { factories: {} }, AbortSignal, URL, setTimeout, clearTimeout };
  runInNewContext(source, context);
  const owner = 'synthetic-owner', storage = new Map(), notices: string[] = [], statuses: string[] = [];
  const chat = ['Original synthetic conversation']; let deletes = 0, receiptReads = 0;
  const preDispatchCodes = new Set(['UNAUTHORIZED', 'FORBIDDEN', 'INVALID_REQUEST', 'NOT_FOUND', 'MEMORY_DISABLED',
    'MEMORY_UNAVAILABLE', 'MEMORY_ACTION_UNSUPPORTED', 'MEMORY_DELETE_UNAVAILABLE', ...oldSource ? [] : ['MEMORY_FORGET_INCOMPLETE']]);
  const core: any = { state: { identityGeneration: 1, account: { ownerId: owner }, device: { id: 'synthetic-device' },
    csrfToken: 'synthetic-csrf', currentView: 'memory', hostId: 'synthetic-host' }, memoryBase: 'http://synthetic/memory',
    memoryKinds: { cognition: '理解' }, memoryPreDispatchCodes: preDispatchCodes, memoryPathId: (id: string) => id,
    memory: { viewGeneration: 0, selectedGeneration: 0, operationGeneration: 0, selected: { kind: 'cognition', id: 'green', worldRevision: 7 },
      mode: 'delete', forgetPreview: { worldRevision: 7 }, drafts: new Map(), activeOperation: null },
    memoryActionAllowed: () => true };
  const effects = new Proxy({ paintMemoryReceipt: (message: string) => notices.push(message),
    detailStatus: (message: string) => statuses.push(message), detailError: (message: string) => statuses.push(message) },
  { get: (value, key) => value[key] ?? (() => {}) });
  const environment = { crypto: { randomUUID: () => 'synthetic-completion' }, storage: {
    getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
    fetch: async (_url: string, options: any) => {
      if (options.method === 'GET') { receiptReads++; return { ok: false, status: 404, json: async () => ({ ownerId: owner, error: { code: 'NOT_FOUND' } }) }; }
      assert.equal(options.method, 'DELETE'); deletes++;
      return { ok: false, status: 409, json: async () => ({ ownerId: owner, state: 'withheld', error: { code: 'MEMORY_FORGET_INCOMPLETE' },
        message: '这次没有执行遗忘，独立记忆和原聊天保留。' }) };
    } };
  Object.assign(core, context.WeftUiCore.factories.memory(core, effects, environment));
  core.memoryActionAllowed = () => true;
  core.submitMemoryCommand = (_selected: any, _operation: string, body: any) => core.memoryRequest('/items/cognition/green', { method: 'DELETE', body });
  await core.submitMemoryAction();
  assert.equal(deletes, 1);
  assert.equal(core.state.account.ownerId, owner); assert.equal(core.state.csrfToken, 'synthetic-csrf');
  assert.deepEqual(chat, ['Original synthetic conversation']);
  assert.doesNotMatch(notices.join('\n'), /已忘掉|已经忘了|已从当前有效记忆与召回移除/);
  assert.doesNotMatch(notices.join('\n') + statuses.join('\n'), /MEMORY_FORGET_INCOMPLETE/);
  if (oldSource) {
    assert.match(notices.join('\n'), /待确认/);
    assert.ok(core.storedMemoryMarker(core.memoryMarkerKey()), 'The historical consumer retains only an honest unknown marker');
  } else {
    assert.match(notices.join('\n'), /没有执行遗忘/);
    assert.equal(core.storedMemoryMarker(core.memoryMarkerKey()), null);
    assert.equal(core.memory.unresolvedMarker, null);
  }
  await core.recoverMemoryReceipt();
  assert.equal(deletes, 1, 'Neither consumer automatically resubmits the withheld DELETE');
  assert.equal(receiptReads, oldSource ? 1 : 0);
  assert.doesNotMatch(notices.join('\n'), /已忘掉|已经忘了|已从当前有效记忆与召回移除/);
});
