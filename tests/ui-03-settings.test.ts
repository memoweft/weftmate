import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {managedMkdtempSync,disposeManagedTemp} from './helpers/managed-temp.mjs';
import {runManagedTestProcess} from './helpers/managed-test-process.mjs';

test('UI-03 real settings save, rollback, reopen, capabilities and devices in desktop and phone web',{timeout:260000},async()=>{
  const scope=managedMkdtempSync('weftmate-ui03-regression-',{prune:false});
  try{
    const result=await runManagedTestProcess(process.execPath,['tests/integration/ui-03-settings.mjs'],{
      env:{...process.env,TMPDIR:scope,TMP:scope,TEMP:scope,WEFTMATE_TEST_TEMP_SCOPE:scope,WEFTMATE_UI03_OUTPUT:process.env.WEFTMATE_UI03_OUTPUT||join(scope,'evidence')},
      commandRoots:[scope],executables:[process.execPath,createRequire(import.meta.url)('electron')],timeoutMs:240000,
    });
    assert.ifError(result.error);assert.equal(result.status,0,result.stderr||result.stdout);
  }finally{disposeManagedTemp(scope,{log(){}});}
});
