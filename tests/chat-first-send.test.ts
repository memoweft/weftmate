import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('new desktop conversation keeps its first message through creation and acceptance',
  { skip: process.platform !== 'win32', timeout: 120000 }, () => {
    const result = spawnSync(process.execPath, ['tests/integration/chat-first-send.mjs'], {
      encoding: 'utf8', env: process.env, windowsHide: true, timeout: 110000, maxBuffer: 2 * 1024 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  });
