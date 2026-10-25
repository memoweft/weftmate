import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {managedMkdtempSync,disposeManagedTemp} from './helpers/managed-temp.mjs';
import {runManagedTestProcess} from './helpers/managed-test-process.mjs';

test('FE-SETTINGS retains update snapshots, live forms and accessible motion in the Windows shell', {timeout:240000,skip:process.platform!=='win32'},async()=>{
  const scope=managedMkdtempSync('weftmate-fe-settings-regression-',{prune:false});
  try {
    const locks=process.env.WEFTMATE_TEST_LOCKS||join(scope,'locks');mkdirSync(locks,{recursive:true});
    const result=await runManagedTestProcess(process.execPath,['tests/integration/fe-settings-electron.mjs','--updates-only'],{
      env:{...process.env,TMPDIR:scope,TMP:scope,TEMP:scope,WEFTMATE_TEST_TEMP_SCOPE:scope,
        WEFTMATE_TEST_LOCKS:locks,WEFTMATE_FE_SETTINGS_OUTPUT:join(scope,'evidence'),WEFTMATE_FE_SETTINGS_CAPTURE:'0'},
      commandRoots:[scope],executables:[process.execPath,createRequire(import.meta.url)('electron')],timeoutMs:220000,
    });
    assert.ifError(result.error);assert.equal(result.status,0,result.stderr||result.stdout);
  } finally {disposeManagedTemp(scope,{log(){}});}
});
