import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const mode of ['start-write', 'end-write', 'subscriber', 'safe-subscriber', 'async-subscriber',
  'clock-start', 'clock-end', 'serialize', 'stderr-async', 'scope-before', 'scope-after', 'snapshot', 'message', 'error-code']) {
  test(`erasure preserves behavior when observation fails: ${mode}`, () => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./helpers/data-delete-observation-faults.mjs', import.meta.url)), mode],
      { encoding: 'utf8', windowsHide: true, timeout: 10000, env });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /OBSERVATION_TEST_RESULT passed/);
  });
}
