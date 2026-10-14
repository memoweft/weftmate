import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { X509Certificate } from 'node:crypto';
import { settledApprovalGeometry } from './helpers/settled-approval-geometry.mjs';
import { calendarTlsFixture } from './fixtures/st-7b/calendar-server.mjs';

test('approval measurement waits for scrolling but returns stationary invalid geometry without hiding it', async () => {
  for (const finalTop of [100, 800]) {
    let frame = 0;
    const node = { getBoundingClientRect: () => ({ x: 0, width: 44, top: frame < 4 ? 900 - frame * 10 : finalTop,
      bottom: (frame < 4 ? 900 - frame * 10 : finalTop) + 44, height: 44 }),
      closest: () => ({ getBoundingClientRect: () => ({ top: 0, bottom: 700 }) }), contains: () => false };
    const measured = await runInNewContext(`(${settledApprovalGeometry.toString()})(node)`, { node,
      requestAnimationFrame: callback => { frame++; queueMicrotask(callback); },
      document: { getElementById: () => ({ getBoundingClientRect: () => ({ top: 700 }) }), elementFromPoint: () => node } });
    assert.equal(frame, 6); assert.equal(measured.top, finalTop);
    assert.equal(measured.bottom <= measured.composerTop, finalTop === 100);
  }
});

test('generated TLS fixtures have independent trusted issuers and verify their real loopback names', async () => {
  const first = await calendarTlsFixture(), second = await calendarTlsFixture();
  try {
    const a = new X509Certificate(first.cert), b = new X509Certificate(second.cert);
    assert.notEqual(a.subject, b.subject); assert.notEqual(a.fingerprint256, b.fingerprint256);
    assert.equal(a.checkHost('localhost'), 'localhost'); assert.equal(a.checkIP('127.0.0.1'), '127.0.0.1');
    assert.equal(a.checkHost('other.invalid'), undefined); assert.equal(a.ca, true);
    assert.equal(a.verify(a.publicKey), true); assert.equal(a.verify(b.publicKey), false);
  } finally { await first.close(); await second.close(); }
});
