import assert from 'node:assert/strict';
import { channel } from 'node:diagnostics_channel';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Writable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDataControls } from '../../src/personal-data/index.mjs';
import * as observation from '../../src/personal-data/diagnostics.mjs';
const { traceErasure, erasurePhase, erasureCheck } = observation;

const mode = process.argv[2];
const root = await mkdtemp(path.join(tmpdir(), 'weftmate-erasure-observer-fault-'));
const originalWrite = process.stderr.write;
const stderrDescriptor = Object.getOwnPropertyDescriptor(process, 'stderr');
const originalNow = performance.now, originalStringify = JSON.stringify;
const originalRun = AsyncLocalStorage.prototype.run;
const originalFailure = Object.assign(new Error('synthetic original failure'), { code: 'SYNTHETIC_FAILURE' });
const observationFailure = Object.assign(new Error('synthetic observation failure'), { code: 'EIO' });
let drains = 0, injected = 0;
const settled = Promise.withResolvers();
const subscriber = () => { injected++; throw observationFailure; };
const diagnostics = channel('weftmate.data-erasure');
let unsubscribe = () => {}, healthyEvents = 0;
const unsubscribeHealthy = observation.subscribeErasure?.(() => { healthyEvents++; }) ?? (() => {});
if (mode === 'subscriber') diagnostics.subscribe(subscriber);
else if (mode === 'safe-subscriber' || mode === 'async-subscriber') {
  unsubscribe = observation.subscribeErasure(() => {
    injected++;
    if (mode === 'async-subscriber') return Promise.reject(observationFailure);
    throw observationFailure;
  });
} else if (mode === 'clock-start') {
  performance.now = () => { injected++; throw observationFailure; };
} else if (mode === 'serialize') {
  JSON.stringify = function (value, ...args) {
    if (value?.phase) { injected++; throw observationFailure; }
    return originalStringify.call(this, value, ...args);
  };
} else if (mode === 'stderr-async') {
  const stream = new Writable({ write(_chunk, _encoding, callback) { injected++; callback(observationFailure); } });
  Object.defineProperty(process, 'stderr', { configurable: true, get: () => stream });
} else if (mode === 'scope-before' || mode === 'scope-after') {
  AsyncLocalStorage.prototype.run = function (store, ...args) {
    if (!store?.operationId) return originalRun.call(this, store, ...args);
    injected++;
    if (mode === 'scope-before') throw observationFailure;
    originalRun.call(this, store, ...args);
    throw observationFailure;
  };
} else if (mode === 'start-write' || mode === 'end-write') process.stderr.write = function (chunk, ...args) {
  const text = String(chunk);
  if (text.includes('"phase":"health_drain"') &&
      text.includes(`"event":"${mode === 'start-write' ? 'start' : 'end'}"`)) {
    injected++; throw observationFailure;
  }
  return originalWrite.call(this, chunk, ...args);
};
const state = { account: { username: 'Synthetic' }, sessions: {}, commands: {}, devices: {} };
const context = {
  root, timestamp: Date.now, rootState: { accounts: { A: state } },
  accountState: () => state, syncRoot: () => path.join(root, 'accounts', 'A', 'sync'),
  backend: {}, usage: { exportAccount: () => ({}) },
  healthInsights: { drain: async () => {
    drains++;
    if (mode === 'clock-end') performance.now = () => { injected++; throw observationFailure; };
    if (mode !== 'start-write') throw originalFailure;
  } },
  memoryManager: { eraseAccount: async () => { throw originalFailure; } },
  activity: { record: async (_owner, row) => { if (row.title === '数据操作未完成') settled.resolve(); } }, offline: { invalidate: async () => {} },
  serial: async work => work(), mutate: async (_owner, work) => work(state),
  activeByCommand: new Map(), activeModelOperations: new Map(), syncStores: new Map(),
  hostOwner: () => true, libraryDesktopToken: 'synthetic-desktop',
  authenticate: () => ({ via: 'cookie', deviceId: 'desktop', device: { scopes: ['account:manage'] } }),
  readJson: async () => ({ accountName: 'Synthetic', confirm: true }), json: () => {},
};
const data = createDataControls(context);
try {
  await data.handle({ method: 'POST', headers: { 'x-weftmate-desktop': 'synthetic-desktop' } }, {},
    new URL('http://localhost/personal/v1/data/delete'), 'A');
  await settled.promise;
  await data.close();
  assert.equal(drains, 1, 'observation failure must not prevent health drain');
  assert.equal(data.nativeOperation('A').state, 'failed');
  assert.equal(data.nativeOperation('A').error.code, 'SYNTHETIC_FAILURE');
  // Preserve the exact business return/error objects as well as controller state.
  await traceErasure('synthetic-identity', async () => {
    const value = {};
    assert.equal(await erasurePhase('health_drain', () => value), value);
    assert.equal(erasureCheck('health_drain', () => value), value);
    await assert.rejects(erasurePhase('health_drain', () => { throw originalFailure; }), error => error === originalFailure);
    assert.throws(() => erasureCheck('health_drain', () => { throw originalFailure; }), error => error === originalFailure);
  });
  if (mode === 'snapshot') {
    const { observeErasure } = await import('./data-delete-diagnostics.mjs');
    const collector = observeErasure();
    try {
      await traceErasure('synthetic-snapshot', () => erasurePhase('snapshot_pending', () => {
        performance.now = () => { injected++; throw observationFailure; };
        assert.deepEqual(collector.snapshot('synthetic-snapshot'), { observationFailed: true });
        performance.now = originalNow;
      }));
    } finally { collector.close(); }
  }
  if (mode === 'message') {
    const { erasureFailureMessage } = await import('./data-delete-diagnostics.mjs');
    const value = { toJSON() { injected++; throw observationFailure; } };
    assert.equal(erasureFailureMessage(value, null), 'observationFailed=true');
  }
  if (mode === 'error-code') {
    const failure = Object.defineProperty(new Error('original error'), 'code', {
      get() { injected++; throw observationFailure; },
    });
    await traceErasure('synthetic-error-code', () =>
      assert.rejects(erasurePhase('health_drain', () => { throw failure; }), error => error === failure));
  }
  // diagnostics_channel schedules throwing subscribers on nextTick. Do not
  // install an uncaughtException handler: a process-level failure must stay red.
  await new Promise(resolve => setImmediate(resolve));
  if (mode !== 'subscriber') {
    assert.ok(injected > 0, 'the observation fault must be exercised');
    assert.equal(observation.erasureObservationFailed(), true);
  }
  if (mode === 'start-write' || mode === 'serialize' || mode === 'safe-subscriber' || mode === 'async-subscriber') {
    assert.ok(healthyEvents > 0, 'a failed writer or subscriber must not prevent other observers');
  }
} finally {
  performance.now = originalNow; JSON.stringify = originalStringify;
  AsyncLocalStorage.prototype.run = originalRun;
  Object.defineProperty(process, 'stderr', stderrDescriptor);
  process.stderr.write = originalWrite;
  unsubscribe(); unsubscribeHealthy();
  diagnostics.unsubscribe(subscriber);
  await data.close();
  await rm(root, { recursive: true, force: true });
}
process.stdout.write('OBSERVATION_TEST_RESULT passed\n');
