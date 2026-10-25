import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('FE-SHELL keeps sidebar navigation and accessibility across the narrow breakpoint', {timeout:90000}, () => {
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const run=spawnSync(process.execPath,['tests/integration/fe-shell-electron.mjs','--narrow'],{env,encoding:'utf8',windowsHide:true,timeout:80000});
  assert.ifError(run.error);assert.equal(run.status,0,run.stdout+'\n'+run.stderr);
});
