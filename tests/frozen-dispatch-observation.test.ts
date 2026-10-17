import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { startTimelineCandidate } from './integration/bl29-rework/fixture.mjs';
import { observeFrozenCommand, waitForFrozenSessionCreate } from './integration/bl29-rework/frozen-command-observation.mjs';

function gate() {
  let release = () => {};
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

test('frozen-create diagnostics distinguish a pending backend receipt from its queued commit', { timeout: 15000 }, async () => {
  const f = await startTimelineCandidate({ daily: true, inlineProgress: true, historyCount: 0 });
  const c = f.debug.service.__reviewContext, observer = observeFrozenCommand(c, 'frozen-create');
  const backend = gate(), serial = gate(), serialEntered = gate();
  const original = f.debug.backend.createSession;
  f.debug.backend.createSession = async function(...args) { await backend.promise; return Reflect.apply(original, this, args); };
  try {
    const host = (await f.request('/status')).hostId;
    const posted = await f.request('/commands', { requestId: 'frozen-create', kind: 'session.create', modelProfileId: 'local', targetDeviceId: host });
    await observer.waitFor('backend.await');
    const waiting = observer.snapshot();
    assert.equal(waiting.events.at(-1).phase, 'backend.await');
    assert.equal(waiting.events.at(-1).state, 'dispatching');
    assert.equal(waiting.scheduled, true); assert.equal(waiting.active, true);
    // Hold the real serial queue before delivering the backend receipt.
    const blocker = c.serial(async () => { serialEntered.release(); await serial.promise; });
    await serialEntered.promise;
    backend.release();
    await observer.waitFor('receipt.commit.start');
    const committing = observer.snapshot();
    assert.equal(committing.events.at(-1).state, 'dispatching');
    assert.equal(committing.events.some(event => event.phase === 'backend.receipt'), true);
    assert.equal(committing.events.some(event => event.phase === 'receipt.commit.done'), false);
    serial.release(); await blocker;
    await observer.waitFor('receipt.commit.done');
    const final = observer.snapshot();
    assert.equal(final.events.at(-1).state, 'accepted_by_dsh');
    assert.deepEqual(final.events.map(event => event.phase), ['schedule', 'dispatch.enter', 'dispatch.commit.start',
      'dispatch.commit.done', 'backend.await', 'backend.receipt', 'receipt.commit.start', 'receipt.commit.done']);
    await waitForFrozenSessionCreate(() => f.request('/commands/' + posted.command.commandId));
  } finally {
    backend.release(); serial.release(); observer.close();
    await f.close(); rmSync(f.root, { recursive: true, force: true });
  }
});

test('the original 100 unsuccessful polls include dispatch diagnostics only on failure', async () => {
  let reads = 0, waits = 0, observations = 0;
  const dispatch = { events: [{ phase: 'backend.await', state: 'dispatching', elapsedMs: 2 }], active: true, scheduled: true };
  await assert.rejects(waitForFrozenSessionCreate(async () => { reads++; return { command: { state: 'dispatching' } }; }, {
    pause: async ms => { assert.equal(ms, 5); waits++; }, now: () => 0,
    observe: () => { observations++; return dispatch; },
  }), error => {
    const details = JSON.parse((error as Error).message.split('diagnostic=')[1]);
    assert.equal(details.polls, 100); assert.deepEqual(details.dispatch, dispatch); return true;
  });
  assert.equal(reads, 100); assert.equal(waits, 100); assert.equal(observations, 1);
  await waitForFrozenSessionCreate(async () => ({ command: { state: 'accepted_by_dsh' } }), {
    observe: () => { throw Error('success must not collect failure diagnostics'); },
  });
});

test('a rejected backend receipt remains uncertain and records its safe error code', { timeout: 15000 }, async () => {
  const f = await startTimelineCandidate({ daily: true, inlineProgress: true, historyCount: 0 });
  const c = f.debug.service.__reviewContext, observer = observeFrozenCommand(c, 'frozen-create');
  f.debug.backend.createSession = async () => { throw Object.assign(Error('private backend detail'), { code: 'BACKEND_UNAVAILABLE' }); };
  try {
    const host = (await f.request('/status')).hostId;
    const posted = await f.request('/commands', { requestId: 'frozen-create', kind: 'session.create', modelProfileId: 'local', targetDeviceId: host });
    await observer.waitFor('backend.error');
    const owner = f.debug.auth.account.ownerId;
    await c.activeByCommand.get(`${owner}|${posted.command.commandId}`);
    const command = (await f.request('/commands/' + posted.command.commandId)).command;
    assert.equal(command.state, 'uncertain'); assert.equal(command.errorCode, 'BACKEND_UNAVAILABLE');
    const snapshot = observer.snapshot();
    assert.equal(snapshot.events.at(-1).phase, 'backend.error');
    assert.equal(snapshot.events.at(-1).errorCode, 'BACKEND_UNAVAILABLE');
    assert.equal(snapshot.active, false); assert.equal(snapshot.scheduled, false);
    assert.equal(JSON.stringify(snapshot).includes('private backend detail'), false);
  } finally { observer.close(); await f.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('dispatch observation filters unrelated commands and unknown phases without exposing identifiers', () => {
  const command = { requestId: 'frozen-create', state: 'dispatching' };
  const c = { accountState: () => ({ commands: { privateCommand: command, other: { requestId: 'unrelated' } } }),
    scheduled: new Set(['privateOwner|privateCommand']), activeByCommand: new Map(), closing: false, storageFault: false,
    __reviewCommandPhase: null as any };
  const observer = observeFrozenCommand(c, 'frozen-create', { now: () => 0 });
  c.__reviewCommandPhase('privateOwner', 'other', 'backend.await');
  c.__reviewCommandPhase('privateOwner', 'privateCommand', 'private-phase');
  c.__reviewCommandPhase('privateOwner', 'privateCommand', 'backend.error', 'private-code');
  const snapshot = observer.snapshot();
  assert.deepEqual(snapshot.events, [{ phase: 'backend.error', state: 'dispatching', elapsedMs: 0, errorCode: 'unknown' }]);
  assert.equal(JSON.stringify(snapshot).includes('private'), false);
  observer.close(); assert.equal(c.__reviewCommandPhase, undefined);
});

function observerContext() {
  return { accountState: () => ({ commands: { command: { requestId: 'frozen-create', state: 'dispatching' } } }),
    scheduled: new Set(), activeByCommand: new Map(), closing: false, storageFault: false, __reviewCommandPhase: null as any };
}

test('a phase clock exception cannot escape the dispatcher hook or leave observation waiters stuck', async () => {
  const c = observerContext(); let clockCalls = 0;
  const observer = observeFrozenCommand(c, 'frozen-create', { now: () => {
    if (++clockCalls > 1) throw Error('synthetic-private-clock-detail'); return 0;
  } });
  try {
    const waiting = assert.rejects(observer.waitFor('backend.await'), error => {
      assert.equal(error.code, 'OBSERVER_EXCEPTION'); return true;
    });
    assert.doesNotThrow(() => c.__reviewCommandPhase('owner', 'command', 'backend.await'));
    await waiting;
    const snapshot = observer.snapshot();
    assert.equal(snapshot.observationFailed, true); assert.equal(snapshot.observationError, 'OBSERVER_EXCEPTION');
    assert.equal(JSON.stringify(snapshot).includes('synthetic-private'), false);
  } finally { observer.close(); }
});

test('initial observation clock failure is retained as fixed metadata', () => {
  const c = observerContext();
  const observer = observeFrozenCommand(c, 'frozen-create', { now: () => { throw Error('synthetic-private-initial-clock'); } });
  try {
    assert.doesNotThrow(() => c.__reviewCommandPhase('owner', 'command', 'schedule'));
    const snapshot = observer.snapshot();
    assert.equal(snapshot.observationFailed, true); assert.equal(snapshot.observationError, 'OBSERVER_EXCEPTION');
    assert.equal(JSON.stringify(snapshot).includes('synthetic-private'), false);
  } finally { observer.close(); }
});

test('snapshot context getter failure preserves previously captured phases and fixed failure metadata', () => {
  const c = observerContext(), observer = observeFrozenCommand(c, 'frozen-create', { now: () => 0 });
  c.__reviewCommandPhase('owner', 'command', 'backend.await');
  Object.defineProperty(c, 'scheduled', { get() { throw Error('synthetic-private-snapshot-detail'); } });
  try {
    const snapshot = observer.snapshot();
    assert.equal(snapshot.events[0].phase, 'backend.await');
    assert.equal(snapshot.observationFailed, true); assert.equal(snapshot.observationError, 'OBSERVER_EXCEPTION');
    assert.equal(JSON.stringify(snapshot).includes('synthetic-private'), false);
  } finally { observer.close(); }
});

test('a real session create still commits acceptance when phase observation fails', { timeout: 15000 }, async () => {
  const f = await startTimelineCandidate({ daily: true, inlineProgress: true, historyCount: 0 });
  const c = f.debug.service.__reviewContext; let clockCalls = 0;
  const observer = observeFrozenCommand(c, 'frozen-create', { now: () => {
    if (++clockCalls === 3) throw Error('synthetic-private-phase-detail'); return clockCalls;
  } });
  try {
    const host = (await f.request('/status')).hostId;
    const posted = await f.request('/commands', { requestId: 'frozen-create', kind: 'session.create', modelProfileId: 'local', targetDeviceId: host });
    await waitForFrozenSessionCreate(() => f.request('/commands/' + posted.command.commandId));
    assert.equal((await f.request('/commands/' + posted.command.commandId)).command.state, 'accepted_by_dsh');
    const snapshot = observer.snapshot();
    assert.equal(snapshot.observationFailed, true); assert.equal(snapshot.observationError, 'OBSERVER_EXCEPTION');
    assert.equal(JSON.stringify(snapshot).includes('synthetic-private'), false);
  } finally { observer.close(); await f.close(); rmSync(f.root, { recursive: true, force: true }); }
});
