import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {managedMkdtempSync,disposeManagedTemp} from './helpers/managed-temp.mjs';

test('#661/#656 settings retain drafts, search controls, and show a compact account submenu', {timeout:180000},()=>{
  const scope=managedMkdtempSync('weftmate-settings2-', {prune:false});
  try {
    const result=spawnSync(process.execPath,['tests/integration/fix-settings2-electron.mjs'],{
      env:{...process.env,TMPDIR:scope,TMP:scope,TEMP:scope,WEFTMATE_TEST_TEMP_SCOPE:scope},
      encoding:'utf8',windowsHide:true,timeout:170000,
    });
    assert.ifError(result.error);assert.equal(result.status,0,result.stderr||result.stdout);
  } finally {disposeManagedTemp(scope,{log(){}});}
});
