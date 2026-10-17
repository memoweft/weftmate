import test from 'node:test';
import assert from 'node:assert/strict';
import { channel } from 'node:diagnostics_channel';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDataControls } from '../src/personal-data/index.mjs';
import { observeErasure } from './helpers/data-delete-diagnostics.mjs';
import { traceErasure, erasurePhase } from '../src/personal-data/diagnostics.mjs';
import { ensurePrivateDirectory } from '../src/private-host-storage.mjs';
import { durableWrite } from '../src/personal-access/store.mjs';
import { readFile } from 'node:fs/promises';

function deferred() {
  let resolve!: (value?: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Exercise the real operation controller with a blocked dependency. This is an
// observation test, not a reproduction of the unknown CI blocking dependency.
for (const [phase, dependency] of [
  ['health_drain', 'drain'], ['memory_core', 'core'],
  ['usage_erase', 'usage'], ['state_reset', 'reset'],
] as const) {
  test(`erasure identifies an unfinished ${phase} and preserves the dependency error`, { timeout: 5000 }, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'weftmate-erasure-observation-'));
    const entered = deferred(), blocked = deferred();
    const records: any[] = [];
    const diagnostics = channel('weftmate.data-erasure');
    const observe = (row: unknown) => records.push(row);
    diagnostics.subscribe(observe);
    const observation = observeErasure();
    const error = Object.assign(new Error('PRIVATE_CONTENT synthetic account secret path'), { code: 'SYNTHETIC_FAILURE' });
    const wait = async (name: string) => { if (name === dependency) { entered.resolve(); await blocked.promise; } };
    let state: any = { account: { username: 'Synthetic' }, sessions: {}, commands: {}, devices: {} };
    const context: any = {
      root, timestamp: Date.now, rootState: { accounts: { A: state } },
      accountState: () => state, syncRoot: () => path.join(root, 'accounts', 'A', 'sync'),
      backend: {}, usage: { exportAccount: () => ({}), eraseAccount: () => wait('usage') },
      healthInsights: { drain: () => wait('drain') },
      memoryManager: { eraseAccount: () => wait('core'), markAccountErased: async () => {} },
      activity: { record: async () => {} }, offline: { invalidate: async () => {} },
      serial: async (work: () => unknown) => work(),
      mutate: async (_owner: string, work: (next: any) => void) => work(state),
      mutateRoot: async (work: (next: any) => void) => {
        await wait('reset'); work(context.rootState); state = context.rootState.accounts.A;
      },
      activeByCommand: new Map(), activeModelOperations: new Map(), syncStores: new Map(),
      clearRestoredCloudOwner: async () => {}, hostOwner: () => true,
      libraryDesktopToken: 'synthetic-desktop',
      authenticate: () => ({ via: 'cookie', deviceId: 'desktop', device: { scopes: ['account:manage'] } }),
      readJson: async () => ({ accountName: 'Synthetic', confirm: true }),
      json: () => {},
    };
    const data = createDataControls(context);
    try {
      await data.handle({ method: 'POST', headers: { 'x-weftmate-desktop': 'synthetic-desktop' } }, {}, new URL('http://localhost/personal/v1/data/delete'), 'A');
      await entered.promise;
      assert.equal(data.nativeOperation('A').state, 'running');
      const starts = records.filter(row => row.phase === phase && row.event === 'start');
      assert.equal(starts.length, 1, `last reached phase missing: ${JSON.stringify(records)}`);
      assert.equal(records.some(row => row.phase === phase && row.event === 'end'), false);
      const snapshot = observation.snapshot(data.nativeOperation('A').id);
      assert.equal(snapshot.lastReached.phase, phase);
      assert.equal(snapshot.waiting.at(-1).phase, phase);
      blocked.reject(error);
      await data.close();
      assert.equal(data.nativeOperation('A').state, 'failed');
      assert.equal(data.nativeOperation('A').error.code, 'SYNTHETIC_FAILURE');
      const end = records.find(row => row.phase === phase && row.event === 'end');
      assert.equal(end.result, 'error');
      assert.equal(end.errorCode, 'SYNTHETIC_FAILURE');
      assert.ok(end.durationMs >= 0);
      assert.equal(snapshot.waiting.at(-1).phase, phase, 'cleanup must not overwrite the original waiting snapshot');
      for (const row of records) {
        assert.deepEqual(Object.keys(row).sort(), ['durationMs','errorCode','event','operationId','parentStep','phase','result','step']);
      }
      assert.equal(JSON.stringify(records).includes('PRIVATE_CONTENT'), false);
      assert.equal(JSON.stringify(records).includes(root), false);
    } finally {
      blocked.reject(error);
      await data.close();
      diagnostics.unsubscribe(observe);
      observation.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}

test('erasure correlates actual ACL and durable writes without logging storage paths', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'weftmate-erasure-storage-'));
  const observation = observeErasure();
  try {
    await traceErasure('synthetic-operation', () => erasurePhase('state_reset', async () => {
      await ensurePrivateDirectory(root);
      await durableWrite(path.join(root, 'store.json'), { secret: 'PRIVATE_CONTENT' });
    }));
    assert.deepEqual(JSON.parse(await readFile(path.join(root, 'store.json'), 'utf8')), { secret: 'PRIVATE_CONTENT' });
    const snapshot = observation.snapshot('synthetic-operation');
    assert.deepEqual(snapshot.waiting, []);
    const write = snapshot.events.find(row => row.phase === 'state_write' && row.event === 'start');
    const reset = snapshot.events.find(row => row.phase === 'state_reset' && row.event === 'start');
    assert.equal(write.parentStep, reset.step);
    if (process.platform === 'win32') {
      const acl = snapshot.events.filter(row => row.phase === 'acl_directory');
      assert.equal(acl.length, 2);
      assert.equal(acl[0].parentStep, reset.step);
      assert.equal(acl[1].result, 'ok');
    }
    assert.equal(JSON.stringify(snapshot).includes('PRIVATE_CONTENT'), false);
    assert.equal(JSON.stringify(snapshot).includes(root), false);
  } finally { observation.close(); await rm(root, { recursive: true, force: true }); }
});
