import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('browser works through the production workspace panel in real Electron', { timeout: 165_000, skip: process.platform !== 'win32' }, () => {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(process.execPath, ['tests/integration/desktop-browser-panel.mjs'], {
    env, encoding: 'utf8', windowsHide: true, timeout: 155_000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /PASS UI-01 browser launcher/);
});
