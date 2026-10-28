import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('tray-started acceptance opens its window and completes two native approvals', {timeout: 190000, skip: process.platform !== 'win32'}, () => {
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(process.execPath, ['tests/integration/second-approval-electron.mjs'], {
    env, encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
