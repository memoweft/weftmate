import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('a second native turn reaches the UI after an idle change wait', { skip: process.platform !== 'win32', timeout: 120000 }, () => {
  const result = spawnSync(process.execPath, ['tests/integration/chat-terminal-handoff.mjs'], {
    env: process.env, encoding: 'utf8', windowsHide: true, timeout: 110000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
});
