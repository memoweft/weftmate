import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
const exec = promisify(execFile);
test('UI-P1m named interactions respect reduced motion, long lists, interruption and scroll', async () => {
  const { stdout } = await exec(process.execPath, ['tests/integration/ui-p1m-mobile-motion.mjs', '--verify-only'], {
    cwd: new URL('../../../', import.meta.url), timeout: 90000, maxBuffer: 1024 * 1024,
  });
  const result = JSON.parse(stdout.trim().split('\n').at(-1));
  assert.equal(result.scenarios, 36);
  assert.equal(result.checks.length, 4);
  assert.equal(result.performanceResults.length, 3);
});
