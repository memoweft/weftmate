import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {managedMkdtempSync,disposeManagedTemp} from './helpers/managed-temp.mjs';
import {runManagedTestProcess} from './helpers/managed-test-process.mjs';
test('initial conversation data restoration respects user-opened settings but explicit navigation still opens chat',{timeout:180000},async()=>{
 const scope=managedMkdtempSync('weftmate-startup-intent-suite-',{prune:false});
 try{const run=await runManagedTestProcess(process.execPath,['tests/integration/startup-view-intent.mjs'],{env:{...process.env,TMPDIR:scope,TMP:scope,TEMP:scope,WEFTMATE_TEST_TEMP_SCOPE:scope},commandRoots:[scope],executables:[process.execPath,createRequire(import.meta.url)('electron')],timeoutMs:160000});assert.ifError(run.error);assert.equal(run.status,0,run.stderr||run.stdout);}
 finally{disposeManagedTemp(scope,{log(){}});}
});
