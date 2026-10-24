import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

test('production desktop uses shared motion recipes and frame-paced text in both themes', { timeout: 130000 }, () => {
  const result = spawnSync(process.execPath, ['tests/integration/fix-motion-electron.mjs'], {
    env: process.env, encoding: 'utf8', windowsHide: true, timeout: 120000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
