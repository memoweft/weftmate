import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('FE-SHELL keeps the Windows workspace and its interactions continuous', {timeout:180000}, () => {
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const run=spawnSync(process.execPath,['tests/integration/fe-shell-electron.mjs'],{env,encoding:'utf8',windowsHide:true,timeout:170000});
  assert.ifError(run.error);assert.equal(run.status,0,run.stdout+'\n'+run.stderr);
});
