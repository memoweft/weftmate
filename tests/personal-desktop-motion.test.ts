import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('desktop motion respects live reduced-motion changes, keyboard, immediate layout and long lists', { timeout: 240000 }, () => {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(process.execPath, ['tests/integration/ui-p1-desktop-motion.mjs', '--fixture', '--verify-only'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), env, encoding: 'utf8', windowsHide: true, timeout: 230000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /UI-P1 desktop motion and reduced-motion behavior passed/);
});
