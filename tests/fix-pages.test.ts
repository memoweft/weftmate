import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { managedMkdtempSync, disposeManagedTemp } from './helpers/managed-temp.mjs';

test('auxiliary pages preserve controls, drafts and focus across desktop and phone refreshes', {timeout:220000}, () => {
  const scope=managedMkdtempSync('weftmate-pages-test-',{prune:false});
  try {
    const locks=process.env.WEFTMATE_HEAVY_LOCK_DIR || (process.env.CI ? join(scope,'locks') : null);
    assert.ok(locks,'Set WEFTMATE_HEAVY_LOCK_DIR to the machine heavy-slot directory for local Electron tests');
    mkdirSync(locks,{recursive:true});
    const result=spawnSync(process.execPath,['tests/integration/fix-pages-electron.mjs'],{
      env:{...process.env,TMPDIR:scope,TMP:scope,TEMP:scope,WEFTMATE_TEST_TEMP_SCOPE:scope,
        WEFTMATE_HEAVY_LOCK_DIR:locks,WEFTMATE_EVIDENCE_DIR:process.env.WEFTMATE_EVIDENCE_DIR||join(scope,'evidence')},
      windowsHide:true,encoding:'utf8',timeout:210000,
    });
    assert.ifError(result.error);assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  } finally {disposeManagedTemp(scope,{log(){}});}
});
