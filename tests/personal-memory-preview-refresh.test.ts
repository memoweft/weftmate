import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

for (const responseKind of ['preflight', 'scope-receipt'] as const) test(`stale preview (${responseKind}) is replaced read-only and needs a second confirmation`, async () => {
  const context: any = { WeftUiCore: { factories: {} }, AbortSignal, URL, setTimeout, clearTimeout };
  runInNewContext(await readFile(new URL('../src/ui-core/memory.js', import.meta.url), 'utf8'), context);
  const storage = new Map(), notices: string[] = [], writes: any[] = []; let sequence = 0, previewReads = 0;
  const core: any = { state: { identityGeneration: 1, account: { ownerId: 'owner' }, device: { id: 'device' },
    csrfToken: 'csrf', currentView: 'memory', hostId: 'host' }, memoryBase: 'http://synthetic/memory',
    memoryKinds: { cognition: '理解' }, memoryPreDispatchCodes: new Set(), memoryPathId: (id: string) => id,
    memory: { viewGeneration: 0, selectedGeneration: 0, operationGeneration: 0,
      selected: { kind: 'cognition', id: 'tea', worldRevision: 1 }, mode: 'delete',
      forgetPreview: { worldRevision: 1, forgetScope: 'old-scope' }, drafts: new Map(), activeOperation: null },
  };
  const effects = new Proxy({ paintMemoryReceipt: (message: string) => notices.push(message),
    detailError: (message: string) => notices.push(message) }, { get: (value, key) => value[key] ?? (() => {}) });
  const environment = { crypto: { randomUUID: () => `request-${++sequence}` }, storage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key),
  } };
  Object.assign(core, context.WeftUiCore.factories.memory(core, effects, environment));
  core.memoryActionAllowed = () => true;
  core.readMemoryItem = async () => ({ item: { kind: 'cognition', id: 'tea', text: '用户更喜欢绿茶' }, worldRevision: 2 });
  core.readMemorySources = async () => ({ sources: [], worldRevision: 2 });
  core.readForgetPreview = async () => { previewReads++; return { worldRevision: 2, forgetScope: 'new-scope', items: [{ id: 'green' }] }; };
  core.submitMemoryCommand = async (_selected: any, _operation: string, body: any) => {
    writes.push(body);
    if (writes.length === 1) {
      if (responseKind === 'scope-receipt') return { receipt: { state: 'rejected', requestId: body.requestId, reasonCode: 'MEMORY_REVISION_CHANGED' } };
      throw { code: 'MEMORY_REVISION_CHANGED', status: 409, payload: { state: 'withheld' } };
    }
    return { receipt: { state: 'applied', requestId: body.requestId, storageCleanup: { state: 'complete' } } };
  };
  core.refreshMemoryStatus = async () => false;
  await core.submitMemoryAction();
  assert.equal(writes.length, 1, 'no automatic resubmission with a freshly obtained credential');
  assert.equal(core.memory.unresolvedMarker, null, 'the server explicitly said no submission occurred');
  assert.equal(previewReads, 1);
  assert.equal(core.memory.selected.worldRevision, 2);
  assert.equal(core.memory.forgetPreview.forgetScope, 'new-scope');
  assert.match(notices.join('\n'), /重新确认|再确认/);
  assert.doesNotMatch(notices.join('\n'), /已移除|待确认|稍后.*重试/);
  await core.submitMemoryAction();
  assert.equal(writes.length, 2);
  assert.equal(writes[1].expectedWorldRevision, 2);
  assert.equal(writes[1].forgetScope, 'new-scope');
  assert.notEqual(writes[0].requestId, writes[1].requestId);
  assert.match(notices.join('\n'), /已移除/);
});
