import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createInferenceQueue, createModelScheduler } from '../src/model-scheduler.mjs';
import { acquireModelSlot, scheduledModelFetch } from '../src/model-scheduler-client.mjs';

const pause = () => new Promise(resolve => setTimeout(resolve, 10));
async function until(check: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!check() && Date.now() < deadline) await pause();
  assert.ok(check(), 'condition completes within the isolated test deadline');
}

async function fixture(slots = 1) {
  let calls = 0, aborted = 0, idle = true, ready = true, holdProps = false;
  const heldProps = new Set<any>(), inferenceResponses = new Set<any>();
  const props = response => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ total_slots: slots })); };
  const server = createServer((request, response) => {
    if (request.url === '/props') { if (holdProps) heldProps.add(response); else props(response); return; }
    calls++;
    inferenceResponses.add(response);
    response.once('close', () => { inferenceResponses.delete(response); if (!response.writableEnded) aborted++; });
    response.writeHead(200, { 'content-type': 'text/plain' }); response.write('partial suggestion');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const profile = { id: 'local', baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'synthetic' };
  const bridge = await createModelScheduler({ isIdle: async () => idle, backgroundReady: async () => ready,
    profileFor: id => id === profile.id || id === profile.baseUrl ? profile : undefined,
    credentialFor: () => 'synthetic', backgroundRoute: () => null });
  return { bridge, profile, setIdle: value => { idle = value; }, setReady: value => { ready = value; },
    holdProps: value => { holdProps = value; if (!value) { for (const response of heldProps) props(response); heldProps.clear(); } },
    finish: () => { for (const response of inferenceResponses) response.end(' completed'); },
    calls: () => calls, aborted: () => aborted,
    suggest: signal => scheduledModelFetch(`${profile.baseUrl}/chat/completions`, { method: 'POST', body: '{}', priority: 'suggestion', signal }, bridge.url),
    async close() { await bridge.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

test('suggestions reserve atomically during native idle probes and never enter pending work', async () => {
  let probe!: (value: boolean) => void;
  const queue = createInferenceQueue({ isIdle: () => new Promise<boolean>(resolve => { probe = resolve; }) });
  const abort = new AbortController();
  try {
    const first = queue.acquire('suggestion', abort.signal, null, () => abort.abort());
    assert.deepEqual(queue.status(), { active: 'suggestion', foregroundPending: 0, backgroundPending: 0 });
    await assert.rejects(queue.acquire('suggestion'), { message: 'MODEL_SUGGESTION_BUSY' });
    const foreground = queue.acquire('foreground');
    probe(true);
    await assert.rejects(first);
    const release = await foreground; release();
    assert.deepEqual(queue.status(), { active: null, foregroundPending: 0, backgroundPending: 0 });
  } finally { abort.abort(); queue.close(); }
});

test('single-slot suggestions refuse foreground, queued background, native tool gaps and model switching without upstream calls', async () => {
  const f = await fixture();
  let foreground, background;
  const backgroundAbort = new AbortController();
  try {
    foreground = await acquireModelSlot('foreground', undefined, f.bridge.url, { profileId: f.profile.id });
    await assert.rejects(f.suggest(undefined), { code: 'MODEL_SUGGESTION_BUSY' });
    assert.equal(f.calls(), 0);
    assert.deepEqual(f.bridge.queue.status(), { active: 'foreground', foregroundPending: 0, backgroundPending: 0 });
    await foreground(); foreground = null; await until(() => f.bridge.queue.status().active === null);
    f.setIdle(false);
    await assert.rejects(f.suggest(undefined), { code: 'MODEL_SUGGESTION_BUSY' });
    background = acquireModelSlot('background', backgroundAbort.signal, f.bridge.url, { profileId: f.profile.id });
    const backgroundRejected = assert.rejects(background);
    await until(() => f.bridge.queue.status().backgroundPending === 1);
    await assert.rejects(f.suggest(undefined), { code: 'MODEL_SUGGESTION_BUSY' });
    assert.equal(f.bridge.queue.status().backgroundPending, 1, 'suggestion added no pending row');
    backgroundAbort.abort(); await backgroundRejected;
    await until(() => f.bridge.queue.status().backgroundPending === 0);
    f.setIdle(true); f.setReady(false);
    await assert.rejects(f.suggest(undefined), { code: 'MODEL_SUGGESTION_BUSY' });
    assert.deepEqual(f.bridge.queue.status(), { active: null, foregroundPending: 0, backgroundPending: 0 });
    assert.equal(f.calls(), 0, 'all abandoned generations stop before actual inference');
  } finally { backgroundAbort.abort(); await foreground?.(); await f.close(); }
});

test('foreground preempts a suggestion through its actual streamed response body and never retries it', async () => {
  const f = await fixture();
  let foreground;
  try {
    const response = await f.suggest(undefined);
    assert.equal(f.bridge.queue.status().active, 'suggestion');
    const rejected = assert.rejects(response.text());
    foreground = await acquireModelSlot('foreground', undefined, f.bridge.url, { profileId: f.profile.id });
    await rejected;
    await until(() => f.aborted() === 1);
    assert.equal(f.bridge.queue.status().active, 'foreground');
    assert.equal(f.calls(), 1);
    await foreground(); foreground = null;
    await until(() => f.bridge.queue.status().active === null);
    await pause(); assert.equal(f.calls(), 1, 'yielded suggestion has no retry');
  } finally { await foreground?.(); await f.close(); }
});

test('foreground arrival cancels actual suggestion inference before a slow capacity probe completes', async () => {
  const f = await fixture();
  let foreground, acquiring;
  try {
    const response = await f.suggest(undefined);
    const rejected = assert.rejects(response.text());
    f.holdProps(true);
    acquiring = acquireModelSlot('foreground', undefined, f.bridge.url, { profileId: f.profile.id });
    await rejected;
    await until(() => f.aborted() === 1);
    assert.equal(f.bridge.queue.status().active, null, 'preemption does not await the foreground capacity probe');
    f.holdProps(false); foreground = await acquiring;
    assert.equal(f.bridge.queue.status().active, 'foreground');
  } finally { f.holdProps(false); await foreground?.(); await f.close(); }
});

test('suggestion lease remains held until its complete response body is consumed', async () => {
  const f = await fixture();
  try {
    const response = await f.suggest(undefined);
    assert.equal(f.bridge.queue.status().active, 'suggestion');
    f.finish();
    assert.equal(await response.text(), 'partial suggestion completed');
    await until(() => f.bridge.queue.status().active === null);
    assert.equal(f.aborted(), 0); assert.equal(f.calls(), 1);
  } finally { await f.close(); }
});

test('typing or changing sessions aborts actual suggestion inference and releases its lease', async () => {
  const f = await fixture();
  const controller = new AbortController();
  try {
    const response = await f.suggest(controller.signal);
    const rejected = assert.rejects(response.text());
    controller.abort(new Error('USER_INPUT_CHANGED'));
    await rejected;
    await until(() => f.aborted() === 1 && f.bridge.queue.status().active === null);
    assert.equal(f.calls(), 1);
  } finally { controller.abort(); await f.close(); }
});

test('cancelling suggestion response consumption releases the slot and aborts upstream', async () => {
  const f = await fixture();
  try {
    const response = await f.suggest(undefined);
    await response.body!.cancel();
    await until(() => f.aborted() === 1 && f.bridge.queue.status().active === null);
    assert.equal(f.calls(), 1);
  } finally { await f.close(); }
});

test('a multi-slot suggestion never holds foreground access but is still cancelled when foreground starts', async () => {
  const f = await fixture(2);
  let foreground;
  try {
    const response = await f.suggest(undefined);
    assert.equal(f.bridge.queue.status().active, null);
    const rejected = assert.rejects(response.text());
    foreground = await acquireModelSlot('foreground', undefined, f.bridge.url, { profileId: f.profile.id });
    await rejected;
    await until(() => f.aborted() === 1);
    assert.equal(f.calls(), 1);
  } finally { await foreground?.(); await f.close(); }
});

test('cloud suggestion leases add no queue slot and yield without delaying a foreground lease', async () => {
  const profile = { id: 'cloud', baseUrl: 'https://synthetic.invalid/v1' };
  const bridge = await createModelScheduler({ isIdle: async () => true,
    profileFor: () => profile, credentialFor: () => null, backgroundRoute: () => null,
    fetchImpl: async () => { assert.fail('cloud capacity is never probed'); } });
  let suggestion, foreground, preempted = false;
  try {
    suggestion = await acquireModelSlot('suggestion', undefined, bridge.url, { profileId: profile.id }, { onPreempt: () => { preempted = true; } });
    assert.deepEqual(bridge.queue.status(), { active: null, foregroundPending: 0, backgroundPending: 0 });
    foreground = await acquireModelSlot('foreground', undefined, bridge.url, { profileId: profile.id });
    await until(() => preempted);
  } finally { await suggestion?.(); await foreground?.(); await bridge.close(); }
});

test('usage begins only after a granted suggestion lease and callback failures release the slot before inference', async () => {
  const f = await fixture();
  let foreground, starts = 0;
  const send = () => scheduledModelFetch(`${f.profile.baseUrl}/chat/completions`, {
    priority: 'suggestion', onStart: async () => { starts++; throw new Error('USAGE_START_FAILED'); },
  }, f.bridge.url);
  try {
    foreground = await acquireModelSlot('foreground', undefined, f.bridge.url, { profileId: f.profile.id });
    await assert.rejects(send(), { code: 'MODEL_SUGGESTION_BUSY' });
    assert.equal(starts, 0);
    await foreground(); foreground = null; await until(() => f.bridge.queue.status().active === null);
    await assert.rejects(send(), { message: 'USAGE_START_FAILED' });
    await until(() => f.bridge.queue.status().active === null);
    assert.equal(starts, 1); assert.equal(f.calls(), 0);
  } finally { await foreground?.(); await f.close(); }
});

test('without a scheduler usage begins before inference and cancellation during its callback prevents upstream', async () => {
  const f = await fixture();
  const abort = new AbortController();
  let starts = 0;
  try {
    await assert.rejects(scheduledModelFetch(`${f.profile.baseUrl}/chat/completions`, {
      priority: 'suggestion', signal: abort.signal,
      onStart: async () => { starts++; abort.abort(new Error('INPUT_CHANGED')); },
    }, ''), { message: 'INPUT_CHANGED' });
    assert.equal(starts, 1); assert.equal(f.calls(), 0);
  } finally { abort.abort(); await f.close(); }
});
