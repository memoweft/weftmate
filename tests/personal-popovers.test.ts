import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('desktop and phone menus stay within the viewport, flip at edges and scroll long content', { timeout: 240000 }, () => {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(process.execPath, ['tests/integration/fix-5-popovers.mjs', '--fixture', '--verify-only'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), env, encoding: 'utf8', windowsHide: true, timeout: 230000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /menu measurements passed; no page errors/);
});
