import test from 'node:test';
import assert from 'node:assert/strict';
import { requestDesktopQuit, desktopQuitReply, QUIT_TIMEOUT_MS, QUIT_TIMEOUT_EXIT } from '../src/desktop-quit.mjs';

test('external quit succeeds without starting a host when no instance exists', async () => {
  let released = false;
  assert.equal(await requestDesktopQuit({ requestSingleInstanceLock: () => true, releaseSingleInstanceLock: () => { released = true; } }), 0);
  assert.equal(released, true);
});
test('external quit waits for durable shutdown, returning its result', async () => {
  for (const [response, expected] of [[0, 0], [4, 4]]) {
    let finished = false;
    const result = requestDesktopQuit({ requestSingleInstanceLock(data) {
      setTimeout(async () => { finished = true; await desktopQuitReply(data)(response); }, 25);
      return false;
    } }, { timeoutMs: 1000 });
    assert.equal(finished, false);
    assert.equal(await result, expected);
    assert.equal(finished, true);
  }
});
test('external quit times out with a nonzero result and never kills the running app', async () => {
  assert.equal(QUIT_TIMEOUT_MS, 20000);
  assert.equal(await requestDesktopQuit({ requestSingleInstanceLock: () => false }, { timeoutMs: 20 }), QUIT_TIMEOUT_EXIT);
  assert.equal(desktopQuitReply({ weftmateQuitPipe: 'arbitrary-file' }), null);
});
