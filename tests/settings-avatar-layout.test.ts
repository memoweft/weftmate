import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {evidencePath} from './helpers/evidence-path.mjs';
import {managedMkdtempSync,disposeManagedTemp} from './helpers/managed-temp.mjs';
import {runManagedTestProcess} from './helpers/managed-test-process.mjs';

test('settings normalize actual large images, preserve profile and align all registered pages',{timeout:300000},async()=>{
  const scope=managedMkdtempSync('weftmate-settings-avatar-suite-',{prune:false});
  try{
    const result=await runManagedTestProcess(process.execPath,['tests/integration/settings-avatar-layout.mjs'],{
      env:{...process.env,TMPDIR:scope,TMP:scope,TEMP:scope,WEFTMATE_TEST_TEMP_SCOPE:scope,WEFTMATE_SETTINGS2_OUTPUT:process.env.WEFTMATE_SETTINGS2_OUTPUT||evidencePath('settings-avatar-layout')},
      commandRoots:[scope],executables:[process.execPath,createRequire(import.meta.url)('electron')],timeoutMs:280000,
    });
    assert.ifError(result.error);assert.equal(result.status,0,result.stderr||result.stdout);
  }finally{disposeManagedTemp(scope,{log(){}});}
});
