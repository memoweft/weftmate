import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { managedMkdtempSync, disposeManagedTemp } from './helpers/managed-temp.mjs';

test('production desktop uses shared motion recipes and frame-paced text in both themes', { timeout: 130000 }, () => {
  // Exercise the same inherited temp boundary as the per-file CI runner.
  const scope = managedMkdtempSync('weftmate-motion-test-', { prune: false });
  try {
    const result = spawnSync(process.execPath, ['tests/integration/fix-motion-electron.mjs'], {
      env: { ...process.env, TMPDIR: scope, TMP: scope, TEMP: scope, WEFTMATE_TEST_TEMP_SCOPE: scope },
      encoding: 'utf8', windowsHide: true, timeout: 120000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally { disposeManagedTemp(scope, { log() {} }); }
});
