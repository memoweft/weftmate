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
  const enteredRead = deferred(), enteredWrite = deferred(), routeSeen = new Map();
  const writeGate = options.writeGate;
  let reads = 0, flushed = 0, writes = 0, activeWaits = 0, lastSignal;
  const native = nativeTimelineLog({
    on: source.on.bind(source), effect() {},
    get(key) {
      if (key === 'sessionPersistence') return { async inspect() {
        reads++; enteredRead.resolve();
        if (options.readGateAt === reads) await options.readGate.promise;
        if (options.readErrorAt === reads) throw Object.assign(new Error('Synthetic native read failed'), { code: 'STORAGE_UNAVAILABLE' });
        return { events };
      } };
      return undefined;
    },
  }, { cache: false });
  const wait = native.waitForChange;
  native.waitForChange = (id, seq, ms, signal) => {
    activeWaits++; lastSignal = signal;
    const pending = wait(id, seq, ms, signal);
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
    options.readGate?.resolve(); writeGate?.resolve();
    for (const controller of controllers) controller.abort();
    server.closeAllConnections();
    await gateway.close(); await native.close();
    await Promise.allSettled([...pending]);
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  return {
    request, post, pause, resume, seen, gateway, native,
    enteredRead: enteredRead.promise, enteredWrite: enteredWrite.promise,
    enteredWait: enteredWait.promise, endedWait: endedWait.promise,
    counts: () => ({ reads, flushed, writes, activeWaits }),
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
