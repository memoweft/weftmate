import test from 'node:test';
import assert from 'node:assert/strict';
import {managedMkdtempSync as mkdtempSync, managedTempRoot as tmpdir, disposeManagedTemp} from './helpers/managed-temp.mjs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {runManagedTestProcess} from './helpers/managed-test-process.mjs';

test('tray-started acceptance opens its window and completes two native approvals', {timeout: 190000, skip: process.platform !== 'win32'}, async () => {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-tray-approvals-'));
  const env = {...process.env, TMP:root, TEMP:root, TMPDIR:root, WEFTMATE_TEST_TEMP_SCOPE:root}; delete env.ELECTRON_RUN_AS_NODE;
  try {
    const result = await runManagedTestProcess(process.execPath, ['tests/integration/second-approval-electron.mjs'], {
      env, commandRoots:[root], executables:[process.execPath, createRequire(import.meta.url)('electron')],
      timeoutMs:180000, maxBuffer:2 * 1024 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.timedOut, false, result.stderr || result.stdout);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally { disposeManagedTemp(root); }
});
