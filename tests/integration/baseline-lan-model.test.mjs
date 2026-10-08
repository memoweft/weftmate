import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLanBaselineBridge } from './baseline-lan-model.mjs';

test('LAN bridge serializes complete bodies and keeps destination/auth out of upstream errors', async () => {
  let active = 0, maxActive = 0;
  const bridge = await createLanBaselineBridge({ baseUrl: 'http://private.invalid/v1', key: 'private-key',
    fetchImpl: async (url, options) => {
      assert.equal(url.href, 'http://private.invalid/v1/chat/completions');
      assert.equal(options.headers.authorization, 'Bearer private-key');
      active++; maxActive = Math.max(maxActive, active);
      return new Response(new ReadableStream({ async start(controller) {
        await new Promise(resolve => setTimeout(resolve, 30));
        active--; controller.enqueue(new TextEncoder().encode('private.invalid private-key')); controller.close();
      } }), { status: 502 });
    } });
  try {
    const results = await Promise.all(Array.from({ length: 3 }, async () => {
      const response = await fetch(bridge.url + '/chat/completions', { method: 'POST',
        headers: { authorization: `Bearer ${bridge.token}` }, body: JSON.stringify({ model: 'local-quality' }) });
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { error: { message: 'LAN_MODEL_UPSTREAM_ERROR' } });
    }));
    assert.equal(results.length, 3);
    assert.equal(maxActive, 1);
    assert.equal(bridge.metrics().maxActive, 1);
    assert.equal(bridge.metrics().requests.length, 3);
    assert.doesNotMatch(JSON.stringify(bridge.metrics()), /private.invalid|private-key/);
  } finally { await bridge.close(); }
});

test('disconnecting a queued request cannot release the serial slot early', async () => {
  let finishFirst, firstStarted;
  const first = new Promise(resolve => { firstStarted = resolve; });
  let count = 0;
  const bridge = await createLanBaselineBridge({ baseUrl: 'http://private.invalid/v1', key: 'private-key',
    fetchImpl: async () => {
      if (++count === 1) { firstStarted(); await new Promise(resolve => { finishFirst = resolve; }); }
      return Response.json({ choices: [] });
    } });
  const send = signal => fetch(bridge.url + '/chat/completions', { method: 'POST', signal,
    headers: { authorization: `Bearer ${bridge.token}` }, body: JSON.stringify({ model: 'local-quality' }) }).then(r => r.json());
  try {
    const one = send(); await first;
    const controller = new AbortController();
    const two = send(controller.signal).catch(() => null);
    await new Promise(resolve => setTimeout(resolve, 20)); controller.abort();
    const three = send();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(count, 1);
    finishFirst(); await Promise.all([one, two, three]);
    assert.equal(count, 2);
    assert.equal(bridge.metrics().maxActive, 1);
  } finally { await bridge.close(); }
});
