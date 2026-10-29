import test from 'node:test';
import assert from 'node:assert/strict';
import { activateWindowsDesktopWindow } from '../src/windows-desktop-activation.mjs';

test('update activation preserves the native handle and process identity, and reports the actual native result', async () => {
  const handle = Buffer.alloc(8); handle.writeBigUInt64LE(0x123456789abcdefn);
  for (const answer of ['True', 'False']) {
    let calls = 0;
    const result = await activateWindowsDesktopWindow({ getNativeWindowHandle: () => handle }, { execute: async (_command, _args, options) => {
      calls++;
      assert.deepEqual(JSON.parse(options.env.WEFTMATE_UPDATED_WINDOW), { handle: '81985529216486895', pid: process.pid });
      assert.equal(options.timeoutMs, 5000);
      assert.equal(options.windowsHide, true);
      return { stdout: answer };
    } });
    assert.equal(result, answer === 'True'); assert.equal(calls, 1);
  }
});

test('a stale native handle cannot activate another process window', { skip: process.platform !== 'win32' }, async () => {
  assert.equal(await activateWindowsDesktopWindow({ getNativeWindowHandle: () => Buffer.alloc(8) }), false);
});
