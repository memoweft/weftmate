import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { EventEmitter, once, getEventListeners } from 'node:events';
import { createGatewayV1 } from '../src/runtime/gateway/routes/v1.mjs';
import { nativeTimelineLog } from '../src/runtime/dsh-adapter/timeline.mjs';

const sessionId = 'synthetic-backup-read';
const ok = value => ({ result: { ok: true, value } });
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

/** Real gateway, native timeline waiter and HTTP, with synthetic persistence/RPC. */
async function fixture(t, options: any = {}) {
  const events: any[] = [], source = new EventEmitter(), enteredWait = deferred(), endedWait = deferred();
  const enteredRead = deferred(), enteredWrite = deferred(), routeSeen = new Map(), readStarts = new Map();
  const writeGate = options.writeGate, readGates = options.readGates ?? {};
  let reads = 0, flushed = 0, writes = 0, activeWaits = 0, activeReads = 0, settledReads = 0, lastSignal;
  const readStarted = index => { if (!readStarts.has(index)) readStarts.set(index, deferred()); return readStarts.get(index); };
  const native = nativeTimelineLog({
    on: source.on.bind(source), effect() {},
    get(key) {
      if (key === 'sessionPersistence') return { async inspect() {
        const index = ++reads; activeReads++; enteredRead.resolve(); readStarted(index).resolve();
        try {
          const gate = readGates[index] ?? (options.readGateAt === index ? options.readGate : null);
          if (gate) await gate.promise;
          if (options.readErrorAt === index) throw Object.assign(new Error('Synthetic native read failed'), { code: 'STORAGE_UNAVAILABLE' });
          return { events };
        } finally { activeReads--; settledReads++; }
      } };
      return undefined;
    },
  }, { cache: false });
  const wait = native.waitForChange;
  native.waitForChange = (id, seq, ms, signal, admission) => {
    activeWaits++; lastSignal = signal;
    const pending = wait(id, seq, ms, signal, admission);
    enteredWait.resolve();
    return pending.finally(() => { activeWaits--; endedWait.resolve(); });
  };
  const client = {
    sessions: {
      list: async () => ok({ items: [{ sessionId, agentPreset: 'personal-remote' }] }),
      create: async () => ok({ sessionId }),
      prompt: async () => { writes++; enteredWrite.resolve(); if (writeGate) await writeGate.promise; return ok({ accepted: true, receiptId: 'synthetic-receipt' }); },
    },
    events: {}, llm: {}, workspace: {}, settings: {},
  };
  const gateway = createGatewayV1({ client, readLog: native, lifecycle: { flushIdle: async () => { flushed++; } } });
  const responses = new Set();
  const server = createServer((req, res) => {
    responses.add(res);
    const finished = () => { responses.delete(res); res.off('finish', finished); res.off('close', finished); };
    res.once('finish', finished); res.once('close', finished);
    const key = `${req.method} ${new URL(req.url, 'http://fixture').pathname}`;
    routeSeen.get(key)?.resolve();
    void gateway.handle(req, res);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as any).port}/weftmate/api/v1`;
  const controllers = new Set<AbortController>(), pending = new Set<Promise<any>>();
  const abortFixture = () => {
    options.readGate?.resolve(); writeGate?.resolve();
    for (const gate of Object.values(readGates) as any[]) gate.resolve();
    for (const controller of controllers) controller.abort();
    server.closeAllConnections();
  };
  t.signal.addEventListener('abort', abortFixture, { once: true });
  const request = (route, init: any = {}) => {
    const controller = new AbortController(); controllers.add(controller);
    const done = fetch(base + route, { ...init, signal: controller.signal }).then(async response => ({ status: response.status, body: await response.json() }));
    pending.add(done); void done.catch(() => {});
    void done.finally(() => { pending.delete(done); controllers.delete(controller); }).catch(() => {});
    return { done, abort: () => controller.abort() };
  };
  const post = (route, body) => request('/' + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).done;
  const pause = (id = 'synthetic-capture', deadline = Date.now() + 2000) => post('backup-pause', { id, deadline });
  const resume = id => post('backup-resume', { id });
  const seen = (method, route) => { const item = deferred(); routeSeen.set(`${method} /weftmate/api/v1${route}`, item); return item.promise; };
  t.after(async () => {
    t.signal.removeEventListener('abort', abortFixture); abortFixture();
    await gateway.close(); await native.close();
    await Promise.allSettled([...pending]);
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  return {
    request, post, pause, resume, seen, gateway, native,
    enteredRead: enteredRead.promise, enteredWrite: enteredWrite.promise,
    enteredWait: enteredWait.promise, endedWait: endedWait.promise,
    readStarted: index => readStarted(index).promise,
    counts: () => ({ reads, flushed, writes, activeWaits, activeReads, settledReads }),
    openResponses: () => responses.size,
    signalListeners: () => lastSignal ? getEventListeners(lastSignal, 'abort').length : 0,
    wake() {
      const seq = events.length;
      events.push({ seq, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
      source.emit('session/event', { id: sessionId }, { seq });
    },
  };
}

const waitRoute = `/sessions/${sessionId}/history?waitMs=30000&waitSeq=-1`;

test('idle native history wait does not block backup, and a wake cannot requery before matching resume', { timeout: 8000 }, async t => {
  const f = await fixture(t), history = f.request(waitRoute); let finished = false;
  void history.done.then(() => { finished = true; }).catch(() => {});
  await Promise.race([f.enteredWait, history.done.then(value => assert.fail(`did not enter wait: ${JSON.stringify(value)}`))]);
  assert.equal(f.counts().activeWaits, 1);
  assert.deepEqual(await f.pause(), { status: 200, body: { id: 'synthetic-capture' } });
  assert.equal(f.counts().flushed, 1); assert.equal(finished, false);
  const before = f.counts().reads;
  f.wake(); await f.endedWait;
  assert.equal(f.counts().reads, before, 'native requery stays behind capture');
  assert.equal((await f.pause('second-capture')).status, 409);
  assert.equal((await f.resume('stale-capture')).status, 200);
  assert.equal(f.counts().reads, before); assert.equal(finished, false);
  assert.equal((await f.resume('synthetic-capture')).status, 200);
  assert.equal((await history.done).status, 200);
  assert.ok(f.counts().reads > before);
  assert.equal(f.signalListeners(), 0);
  assert.equal((await f.pause('following-capture')).status, 200, 'no operation ticket remains after the response');
  await f.resume('following-capture');
});

test('the initial native query remains admitted until it finishes', { timeout: 8000 }, async t => {
  const gate = deferred(), f = await fixture(t, { readGateAt: 1, readGate: gate });
  const history = f.request(`/sessions/${sessionId}/history`); await f.enteredRead;
  const enteredPause = f.seen('POST', '/backup-pause'), paused = f.pause(); await enteredPause;
  assert.equal((await f.pause('initial-query-probe')).status, 409, 'the first control request owns capture while its admitted read drains');
  assert.equal(f.counts().flushed, 0);
  gate.resolve();
  assert.equal((await history.done).status, 200);
  assert.equal((await paused).status, 200); assert.equal(f.counts().flushed, 1);
  await f.resume('synthetic-capture');
});

test('the native registration recheck remains admitted until its physical read finishes', { timeout: 8000 }, async t => {
  const gate = deferred(), f = await fixture(t, { readGateAt: 2, readGate: gate });
  const history = f.request(waitRoute); await f.enteredWait;
  assert.equal(f.counts().reads, 2);
  const enteredPause = f.seen('POST', '/backup-pause'), paused = f.pause(); await enteredPause;
  assert.equal((await f.pause('recheck-probe')).status, 409);
  assert.equal(f.counts().flushed, 0, 'registration is not yet a pure listener');
  gate.resolve();
  assert.equal((await paused).status, 200); assert.equal(f.counts().flushed, 1);
  f.wake(); await f.endedWait;
  assert.equal(f.counts().reads, 2, 'wake requery still waits for matching resume');
  await f.resume('synthetic-capture');
  assert.equal((await history.done).status, 200);
});

for (const readErrorAt of [undefined, 2]) test(`disconnect during registration recheck keeps its physical read admitted${readErrorAt ? ' through a late read failure' : ''}`, { timeout: 8000 }, async t => {
  const gate = deferred(), f = await fixture(t, { readGateAt: 2, readGate: gate, readErrorAt });
  const history = f.request(waitRoute); await f.readStarted(2);
  history.abort(); await assert.rejects(history.done, { name: 'AbortError' }); await f.endedWait;
  assert.equal(f.counts().activeWaits, 0, 'the cancelled response view returns promptly');
  assert.equal(f.signalListeners(), 0, 'cancellation removes the native waiter listener');
  assert.equal(f.counts().activeReads, 1, 'cancellation cannot stop the physical persistence read');
  const enteredPause = f.seen('POST', '/backup-pause'), paused = f.pause(); await enteredPause;
  assert.equal((await f.pause('cancelled-recheck-probe')).status, 409);
  assert.equal(f.counts().flushed, 0, 'the detached physical read still blocks capture');
  gate.resolve();
  assert.equal((await paused).status, 200); assert.equal(f.counts().activeReads, 0);
  assert.equal(f.counts().settledReads, 2); assert.equal(f.counts().flushed, 1);
  await f.resume('synthetic-capture');
  assert.equal((await f.pause('after-cancelled-recheck')).status, 200, 'settled success or failure releases exactly its own read ticket');
  await f.resume('after-cancelled-recheck');
});

for (const cause of ['event', 'timeout']) test(`${cause} during registration recheck cannot flush or requery before the physical read settles and capture resumes`, { timeout: 8000 }, async t => {
  const gate = deferred(), f = await fixture(t, { readGateAt: 2, readGate: gate });
  const route = cause === 'timeout' ? `/sessions/${sessionId}/history?waitMs=500&waitSeq=-1` : waitRoute;
  const history = f.request(route); await f.readStarted(2);
  const enteredPause = f.seen('POST', '/backup-pause'), paused = f.pause(); await enteredPause;
  assert.equal((await f.pause('capture-established-probe')).status, 409, 'capture owns admission before event or timer wakes the view');
  if (cause === 'event') f.wake();
  await f.endedWait;
  assert.equal(f.signalListeners(), 0); assert.equal(f.counts().activeWaits, 0);
  assert.equal((await f.pause('woken-recheck-probe')).status, 409);
  assert.equal(f.counts().activeReads, 1); assert.equal(f.counts().reads, 2);
  assert.equal(f.counts().flushed, 0, 'a settled wait view cannot release its outstanding physical read');
  gate.resolve();
  assert.equal((await paused).status, 200); assert.equal(f.counts().flushed, 1);
  assert.equal(f.counts().activeReads, 0); assert.equal(f.counts().reads, 2, 'the final response query remains behind capture');
  await f.resume('stale-recheck-capture'); assert.equal(f.counts().reads, 2);
  await f.resume('synthetic-capture');
  const answer = await history.done; assert.equal(answer.status, 200);
  if (cause === 'event') assert.ok((answer.body.liveSeq ?? answer.body.nextSeq) >= 0, 'an event during registration is not lost');
  assert.equal(f.counts().reads, 3); assert.equal(f.counts().activeReads, 0);
  assert.equal((await f.pause('after-woken-recheck')).status, 200); await f.resume('after-woken-recheck');
});

test('native close waits for a detached registration read before completing or allowing capture', { timeout: 8000 }, async t => {
  const gate = deferred(), f = await fixture(t, { readGateAt: 2, readGate: gate });
  const history = f.request(waitRoute); await f.readStarted(2);
  const enteredPause = f.seen('POST', '/backup-pause'), paused = f.pause(); await enteredPause;
  assert.equal((await f.pause('native-close-capture-established')).status, 409);
  let closed = false; const closing = f.native.close().then(() => { closed = true; });
  const answer = await history.done;
  assert.equal(answer.status, 503); assert.equal(answer.body.error.code, 'SERVICE_CLOSING');
  await f.endedWait;
  assert.equal(closed, false, 'native close must drain the physical read after its response view settles');
  assert.equal(f.signalListeners(), 0); assert.equal(f.counts().activeReads, 1);
  assert.equal((await f.pause('closed-native-recheck-probe')).status, 409);
  assert.equal(f.counts().flushed, 0); assert.equal(f.counts().reads, 2);
  gate.resolve(); await closing;
  assert.equal((await paused).status, 200); assert.equal(f.counts().flushed, 1);
  assert.equal(closed, true); assert.equal(f.counts().activeReads, 0); assert.equal(f.openResponses(), 0);
  await f.resume('synthetic-capture');
});

test('gateway close drains a detached registration read and never flushes an aborted capture', { timeout: 8000 }, async t => {
  const gate = deferred(), f = await fixture(t, { readGateAt: 2, readGate: gate });
  const history = f.request(waitRoute); await f.readStarted(2);
  const enteredPause = f.seen('POST', '/backup-pause'), paused = f.pause(); await enteredPause;
  assert.equal((await f.pause('closing-gateway-recheck-probe')).status, 409);
  assert.equal(f.counts().flushed, 0);
  let closed = false; const closing = f.gateway.close().then(() => { closed = true; });
  const answer = await history.done;
  assert.equal(answer.status, 503); assert.equal(answer.body.error.code, 'SERVICE_CLOSING');
  assert.equal((await paused).status, 409, 'shutdown revokes capture instead of flushing native storage');
  await f.endedWait;
  assert.equal(closed, false, 'gateway close must retain the detached read operation');
  assert.equal(f.counts().activeReads, 1); assert.equal(f.counts().reads, 2);
  assert.equal(f.counts().flushed, 0); assert.equal(f.signalListeners(), 0);
  gate.resolve(); await closing;
  assert.equal(closed, true); assert.equal(f.counts().activeReads, 0);
  assert.equal(f.counts().flushed, 0); assert.equal(f.openResponses(), 0);
});

test('registration recheck failure releases admission only after the physical read rejects', { timeout: 8000 }, async t => {
  const gate = deferred(), f = await fixture(t, { readGateAt: 2, readGate: gate, readErrorAt: 2 });
  const history = f.request(waitRoute); await f.readStarted(2);
  const enteredPause = f.seen('POST', '/backup-pause'), paused = f.pause(); await enteredPause;
  assert.equal((await f.pause('failing-recheck-probe')).status, 409);
  assert.equal(f.counts().activeReads, 1); assert.equal(f.counts().flushed, 0);
  gate.resolve();
  assert.equal((await history.done).status, 400); assert.equal((await paused).status, 200);
  assert.equal(f.counts().activeReads, 0); assert.equal(f.counts().activeWaits, 0);
  assert.equal(f.counts().flushed, 1); assert.equal(f.signalListeners(), 0);
  await f.resume('synthetic-capture');
  assert.equal((await f.pause('after-failing-recheck')).status, 200); await f.resume('after-failing-recheck');
});

for (const cause of ['event', 'timeout', 'abort']) test(`a ${cause} view cannot drain a recheck derived after capture took its operation snapshot`, { timeout: 8000 }, async t => {
  const first = deferred(), second = deferred(), f = await fixture(t, { readGates: { 1: first, 2: second } });
  const route = cause === 'timeout' ? `/sessions/${sessionId}/history?waitMs=500&waitSeq=-1` : waitRoute;
  const history = f.request(route); await f.readStarted(1);
  const enteredPause = f.seen('POST', '/backup-pause'), paused = f.pause(); await enteredPause;
  assert.equal((await f.pause('late-derived-capture-established')).status, 409);
  assert.equal(f.counts().reads, 1); assert.equal(f.counts().flushed, 0);
  first.resolve(); await f.readStarted(2);
  assert.equal(f.counts().activeReads, 1); assert.equal(f.counts().settledReads, 1);
  if (cause === 'event') f.wake();
  if (cause === 'abort') { history.abort(); await assert.rejects(history.done, { name: 'AbortError' }); }
  await f.endedWait;
  assert.equal((await f.pause('late-derived-still-owned')).status, 409);
  assert.equal(f.signalListeners(), 0); assert.equal(f.counts().activeWaits, 0);
  assert.equal(f.counts().reads, 2); assert.equal(f.counts().activeReads, 1);
  assert.equal(f.counts().flushed, 0, 'the original capture snapshot also owns reads derived from its admitted request');
  second.resolve();
  assert.equal((await paused).status, 200); assert.equal(f.counts().flushed, 1);
  assert.equal(f.counts().activeReads, 0); assert.equal(f.counts().reads, 2);
  await f.resume('stale-late-derived'); assert.equal(f.counts().reads, 2);
  await f.resume('synthetic-capture');
  if (cause !== 'abort') {
    const answer = await history.done; assert.equal(answer.status, 200);
    if (cause === 'event') assert.ok((answer.body.liveSeq ?? answer.body.nextSeq) >= 0, 'the event during derived registration is not lost');
    assert.equal(f.counts().reads, 3);
  }
  assert.equal((await f.pause('after-late-derived')).status, 200); await f.resume('after-late-derived');
});

test('a read derived after capture admission still consumes the original absolute two-second deadline', { timeout: 8000 }, async t => {
  const first = deferred(), second = deferred(), f = await fixture(t, { readGates: { 1: first, 2: second } });
  const history = f.request(waitRoute); await f.readStarted(1);
  const started = Date.now(), deadline = started + 2000;
  const enteredPause = f.seen('POST', '/backup-pause'), paused = f.pause('late-derived-deadline', deadline); await enteredPause;
  assert.equal((await f.pause('late-derived-deadline-established')).status, 409);
  first.resolve(); await f.readStarted(2); f.wake(); await f.endedWait;
  const answer = await paused;
  assert.equal(answer.status, 409); assert.equal(answer.body.error.code, 'BACKUP_PAUSE_TIMEOUT');
  assert.ok(Date.now() - started >= 1900, 'the configured two-second protection remains in force');
  assert.equal(f.counts().flushed, 0, 'expiry cannot flush while the derived physical read is unfinished');
  assert.ok(f.counts().activeReads >= 1);
  second.resolve(); assert.equal((await history.done).status, 200);
  assert.equal((await f.pause('after-late-derived-expiry')).status, 200); await f.resume('after-late-derived-expiry');
});

for (const owner of ['native', 'gateway']) test(`${owner} close during the initial read prevents a later registration recheck`, { timeout: 8000 }, async t => {
  const first = deferred(), second = deferred(), f = await fixture(t, { readGates: { 1: first, 2: second } });
  const history = f.request(waitRoute); await f.readStarted(1);
  let closed = false; const closing = f[owner].close().then(() => { closed = true; });
  if (owner === 'gateway') {
    assert.equal((await f.request('/sessions').done).status, 503, 'gateway shutdown has started');
    assert.equal(closed, false, 'the initial admitted read still drains before gateway close completes');
  } else assert.equal(f.native.closed, true);
  assert.equal(f.counts().reads, 1); assert.equal(f.counts().activeReads, 1);
  first.resolve();
  const answer = await history.done; await closing;
  assert.equal(answer.status, 503); assert.equal(answer.body.error.code, 'SERVICE_CLOSING');
  assert.equal(f.counts().reads, 1, 'shutdown cannot derive a new native storage read');
  assert.equal(f.counts().activeReads, 0); assert.equal(f.counts().activeWaits, 0);
  assert.equal(f.counts().flushed, 0); assert.equal(f.openResponses(), 0);
});

for (const owner of ['native', 'gateway']) test(`${owner} close retains an already-started read derived after capture admission`, { timeout: 8000 }, async t => {
  const first = deferred(), second = deferred(), f = await fixture(t, { readGates: { 1: first, 2: second } });
  const history = f.request(waitRoute); await f.readStarted(1);
  const enteredPause = f.seen('POST', '/backup-pause'), paused = f.pause(); await enteredPause;
  assert.equal((await f.pause('late-derived-close-established')).status, 409);
  first.resolve(); await f.readStarted(2);
  let closed = false; const closing = f[owner].close().then(() => { closed = true; });
  const answer = await history.done; await f.endedWait;
  assert.equal(answer.status, 503); assert.equal(answer.body.error.code, 'SERVICE_CLOSING');
  if (owner === 'native') assert.equal((await f.pause('late-derived-native-close-probe')).status, 409);
  else assert.equal((await paused).status, 409, 'gateway shutdown revokes capture');
  assert.equal(closed, false, 'close still owns the physical read after its response view settles');
  assert.equal(f.counts().reads, 2); assert.equal(f.counts().activeReads, 1);
  assert.equal(f.counts().flushed, 0); assert.equal(f.signalListeners(), 0);
  second.resolve(); await closing;
  if (owner === 'native') { assert.equal((await paused).status, 200); await f.resume('synthetic-capture'); }
  assert.equal(f.counts().activeReads, 0); assert.equal(f.openResponses(), 0);
});

test('an admitted write still consumes the unchanged two-second pause deadline', { timeout: 8000 }, async t => {
  const writeGate = deferred(), f = await fixture(t, { writeGate });
  assert.equal((await f.post('sessions', {})).status, 201);
  const writing = f.post(`sessions/${sessionId}/messages`, { content: 'synthetic backup mutation' }); await f.enteredWrite;
  const paused = await f.pause();
  assert.equal(paused.status, 409); assert.equal(paused.body.error.code, 'BACKUP_PAUSE_TIMEOUT');
  assert.equal(f.counts().flushed, 0); assert.equal(f.counts().writes, 1);
  writeGate.resolve(); assert.equal((await writing).status, 202);
  assert.equal((await f.pause('after-write')).status, 200); await f.resume('after-write');
});

test('disconnecting an idle wait releases its native listener and does not leave an operation ticket', { timeout: 8000 }, async t => {
  const f = await fixture(t), history = f.request(waitRoute); await f.enteredWait;
  history.abort(); await assert.rejects(history.done, { name: 'AbortError' }); await f.endedWait;
  assert.equal(f.counts().activeWaits, 0); assert.equal(f.signalListeners(), 0);
  assert.equal((await f.pause()).status, 200); await f.resume('synthetic-capture');
});

test('disconnect during a real initial query does not prematurely release its operation', { timeout: 8000 }, async t => {
  const gate = deferred(), f = await fixture(t, { readGateAt: 1, readGate: gate });
  const history = f.request(`/sessions/${sessionId}/history`); await f.enteredRead;
  history.abort(); await assert.rejects(history.done, { name: 'AbortError' });
  const enteredPause = f.seen('POST', '/backup-pause'), paused = f.pause(); await enteredPause;
  assert.equal((await f.pause('disconnected-query-probe')).status, 409);
  assert.equal(f.counts().flushed, 0);
  gate.resolve(); assert.equal((await paused).status, 200); await f.resume('synthetic-capture');
});

for (const readErrorAt of [1, 2, 3]) test(`native read failure at phase ${readErrorAt} releases the request owner`, { timeout: 8000 }, async t => {
  const f = await fixture(t, { readErrorAt }), history = f.request(waitRoute);
  if (readErrorAt === 3) { await f.enteredWait; f.wake(); }
  assert.equal((await history.done).status, 400);
  assert.equal(f.counts().activeWaits, 0); assert.equal(f.signalListeners(), 0);
  assert.equal((await f.pause()).status, 200); await f.resume('synthetic-capture');
});

test('concurrent pause admits one owner, and stale resume cannot release it', { timeout: 8000 }, async t => {
  const f = await fixture(t), results = await Promise.all([f.pause('capture-a'), f.pause('capture-b')]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(f.counts().flushed, 1);
  const winner = results.find(r => r.status === 200); assert.ok(winner);
  const owner = winner.body.id, stale = owner === 'capture-a' ? 'capture-b' : 'capture-a';
  let finished = false; const entered = f.seen('GET', '/sessions'), queued = f.request('/sessions');
  void queued.done.then(() => { finished = true; }).catch(() => {}); await entered;
  await f.resume(stale); assert.equal(finished, false);
  await f.resume(owner); assert.equal((await queued.done).status, 200);
});

test('lease expiry releases a woken history requery without a manual resume', { timeout: 8000 }, async t => {
  const f = await fixture(t), history = f.request(waitRoute); await f.enteredWait;
  const deadline = Date.now() + 500;
  assert.equal((await f.pause('expiring-capture', deadline)).status, 200);
  f.wake();
  assert.equal((await history.done).status, 200);
  assert.ok(Date.now() >= deadline, 'the woken read waits for the capture lease to end');
  assert.equal(f.counts().activeWaits, 0); assert.equal(f.signalListeners(), 0);
  assert.equal((await f.pause('next-capture')).status, 200); await f.resume('next-capture');
});

test('gateway close releases capture and answers a parked/woken read without another native query', { timeout: 8000 }, async t => {
  const f = await fixture(t), history = f.request(waitRoute); await f.enteredWait;
  assert.equal((await f.pause()).status, 200);
  const before = f.counts().reads; f.wake(); await f.endedWait;
  await f.gateway.close();
  assert.equal(f.openResponses(), 0, 'close waits for the owned HTTP response to finish');
  const answer = await history.done;
  assert.equal(answer.status, 503); assert.equal(answer.body.error.code, 'SERVICE_CLOSING');
  assert.equal(f.counts().reads, before); assert.equal(f.counts().activeWaits, 0); assert.equal(f.signalListeners(), 0);
});

test('native reader close settles a parked response without querying its closed source', { timeout: 8000 }, async t => {
  const f = await fixture(t), history = f.request(waitRoute); await f.enteredWait;
  assert.equal((await f.pause()).status, 200);
  const before = f.counts().reads;
  await f.native.close();
  const answer = await history.done;
  assert.equal(answer.status, 503); assert.equal(answer.body.error.code, 'SERVICE_CLOSING');
  assert.equal(f.counts().reads, before); assert.equal(f.counts().activeWaits, 0);
  assert.equal(f.signalListeners(), 0); assert.equal(f.openResponses(), 0);
  await f.resume('synthetic-capture');
});
