import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {managedMkdtempSync,disposeManagedTemp} from './helpers/managed-temp.mjs';
import {runManagedTestProcess} from './helpers/managed-test-process.mjs';
test('update feedback stays visible across native results, polls, reopen and context changes',{timeout:200000},async()=>{
  const scope=managedMkdtempSync('weftmate-update-feedback-suite-',{prune:false});
  try{
    const run=await runManagedTestProcess(process.execPath,['tests/integration/update-feedback.mjs'],{env:{...process.env,TMPDIR:scope,TMP:scope,TEMP:scope,WEFTMATE_TEST_TEMP_SCOPE:scope},commandRoots:[scope],executables:[process.execPath,createRequire(import.meta.url)('electron')],timeoutMs:180000});
    assert.ifError(run.error);assert.equal(run.status,0,run.stderr||run.stdout);
  }finally{disposeManagedTemp(scope,{log(){}});}
});
