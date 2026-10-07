import test from 'node:test';
import assert from 'node:assert/strict';
import { createInferenceQueue, createModelScheduler } from '../src/model-scheduler.mjs';
import { acquireModelSlot, scheduledModelFetch, isBackgroundPurpose, runWithModelSlot } from '../src/model-scheduler-client.mjs';
const pause = (ms = 15) => new Promise(resolve => setTimeout(resolve, ms));

test('background waits through tool gaps, foreground has FIFO priority and cancellation removes waiting work', async () => {
  let idle = false;
  const queue = createInferenceQueue({ isIdle: async () => idle, pollMs: 5 });
  const order: string[] = [];
  const cancelled = new AbortController();
  try {
    const background = queue.acquire('background').then(release => { order.push('background'); return release; });
    const rejected = queue.acquire('background', cancelled.signal); cancelled.abort();
    await assert.rejects(rejected);
    const first = await queue.acquire('foreground'); order.push('first');
    const second = queue.acquire('foreground').then(release => { order.push('second'); return release; });
    first(); const finishSecond = await second; finishSecond();
    await pause(); assert.deepEqual(order, ['first', 'second'], 'a tool gap is still a running turn');
    idle = true; const finishBackground = await background; finishBackground();
    assert.deepEqual(order, ['first', 'second', 'background']);
    assert.deepEqual(queue.status(), { active: null, foregroundPending: 0, backgroundPending: 0 });
  } finally { queue.close(); }
});

test('native stream socket owns the slot; a cancelled or crashed owner releases it and queued memory uses its selected model', async () => {
  let idle = false;
  const calls: any[] = [];
  const profile = { id: 'background', baseUrl: 'http://127.0.0.1:1/v1', model: 'other-model' };
  const bridge = await createModelScheduler({ isIdle: async () => idle,
    profileFor: id => id === profile.id ? profile : null, credentialFor: () => 'synthetic',
    backgroundRoute: () => ({ provider: 'other-provider', model: 'other-model' }),
    fetchImpl: async (url, options) => { calls.push({ url: String(url), body: JSON.parse(options.body) });
      return Response.json({ choices: [{ message: { content: 'done' } }] }); },
  });
  try {
    const response = await fetch(`${bridge.url}/route?sessionId=one`);
    assert.deepEqual(await response.json(), { provider: 'other-provider', model: 'other-model' });
    assert.equal((await fetch(`${bridge.memoryBaseUrl('background')}/models`)).status, 403);
    const foreground = await acquireModelSlot('foreground', undefined, bridge.url);
    const memory = fetch(`${bridge.memoryBaseUrl('background')}/chat/completions`, { method: 'POST',
      headers: { authorization: 'Bearer synthetic', 'content-type': 'application/json' },
      body: JSON.stringify({ model: '@current', messages: [] }) });
    await pause(); assert.equal(calls.length, 0);
    await foreground(); await pause(); assert.equal(calls.length, 0, 'native tools are still executing');
    idle = true; assert.equal((await memory).status, 200);
    assert.equal(calls[0].body.model, 'other-model');
    assert.equal(calls.length, 1);
    const abort = new AbortController();
    await acquireModelSlot('foreground', abort.signal, bridge.url);
    abort.abort();
    const next = await acquireModelSlot('foreground', undefined, bridge.url); await next();
  } finally { await bridge.close(); }
});

test('background provider begins its own deadline after queueing and nested native streaming uses the same lease', async () => {
  let idle = false, began = false;
  const bridge = await createModelScheduler({ isIdle: async () => idle, profileFor: () => null,
    credentialFor: () => null, backgroundRoute: () => null });
  try {
    const background = runWithModelSlot('background', undefined, async () => {
      began = true;
      const release = await acquireModelSlot('background', undefined, bridge.url);
      assert.equal(bridge.queue.status().active, 'background'); await release();
      return 'title';
    }, bridge.url);
    await pause(); assert.equal(began, false);
    idle = true; assert.equal(await background, 'title');
    await pause(); assert.equal(bridge.queue.status().active, null);
  } finally { await bridge.close(); }
});

test('queued MemoWeft HTTP receives informational keepalive without masking the final error status', async () => {
  let idle = false, information = 0;
  const bridge = await createModelScheduler({ isIdle: async () => idle, heartbeatMs: 10,
    profileFor: () => ({ baseUrl: 'http://127.0.0.1:1/v1', model: 'qwen' }), credentialFor: () => 'synthetic',
    backgroundRoute: () => null, fetchImpl: async () => Response.json({ error: { code: 'unavailable' } }, { status: 503 }) });
  const { request } = await import('node:http');
  try {
    const finished = new Promise<any>((resolve, reject) => {
      const call = request(`${bridge.memoryBaseUrl('qwen')}/chat/completions`, { method: 'POST',
        headers: { authorization: 'Bearer synthetic', 'content-type': 'application/json' } }, response => {
        let raw = ''; response.on('data', data => { raw += data; });
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, value: JSON.parse(raw) }));
      });
      call.on('error', reject); call.on('information', frame => { assert.equal(frame.statusCode, 102); information++; });
      call.end(JSON.stringify({ model: '@current', messages: [] }));
    });
    await pause(40); assert.ok(information >= 1);
    idle = true; const result = await finished;
    assert.equal(result.status, 503); assert.equal(result.headers['x-modelswitcher-model'], 'qwen');
    assert.equal(result.value.error.code, 'unavailable');
  } finally { await bridge.close(); }
});

test('foreground HTTP completion holds its slot through the response body', async () => {
  const bridge = await createModelScheduler({ isIdle: async () => true,
    profileFor: () => null, credentialFor: () => null, backgroundRoute: () => null });
  const upstream = await import('node:http');
  const server = upstream.createServer((_request, response) => { response.writeHead(200); response.write('partial'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as any;
  try {
    const response = await scheduledModelFetch(`http://127.0.0.1:${address.port}`, {}, bridge.url);
    assert.equal(bridge.queue.status().active, 'foreground');
    await response.body!.cancel(); await pause();
    assert.equal(bridge.queue.status().active, null);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await bridge.close(); }
});

test('native compaction remains foreground while titles and companion work are background', () => {
  assert.equal(isBackgroundPurpose('compaction'), false);
  assert.equal(isBackgroundPurpose(undefined), false);
  for (const purpose of ['session-title', 'memory-formation', 'health-summary', 'companion-care']) assert.equal(isBackgroundPurpose(purpose), true);
});
