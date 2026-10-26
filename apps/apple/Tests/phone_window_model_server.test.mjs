import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPhoneWindowModelFixture } from './phone_window_model_server.mjs';

test('controlled SSE keeps slow reply open, releases it, and reports cancellation', { timeout: 10000 }, async () => {
  const fixture = await createPhoneWindowModelFixture();
  try {
    const chat = (marker, signal) => fetch(fixture.origin + '/v1/chat/completions', {
      method: 'POST', signal, headers: { authorization: 'Bearer synthetic-state-key' },
      body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: marker }] }),
    });
    const slow = await chat('WINDOW-SLOW:release');
    const reader = slow.body.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /Started:WINDOW-SLOW:release/);
    assert.equal((await (await fetch(fixture.origin + '/report')).json()).completed, 0);
    assert.equal((await fetch(fixture.origin + '/release?marker=WINDOW-SLOW:release', { method: 'POST' })).status, 200);
    let tail = ''; for (;;) { const next = await reader.read(); if (next.done) break; tail += new TextDecoder().decode(next.value); }
    assert.match(tail, /Done:WINDOW-SLOW:release/);
    const abort = new AbortController();
    const stopped = await chat('WINDOW-SLOW:stop', abort.signal);
    await stopped.body.getReader().read(); abort.abort();
    let report;
    for (let i = 0; i < 100; i++) {
      report = await (await fetch(fixture.origin + '/report')).json();
      if (report.aborted === 1) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(report.aborted, 1); assert.equal(report.completed, 1);
    assert.equal(report.nonStreamRequests, 0);
    assert.deepEqual(report.starts, ['WINDOW-SLOW:release', 'WINDOW-SLOW:stop']);
    assert.equal((await fetch(fixture.origin + '/memory')).status, 404);
  } finally { await fixture.close(); }
});
