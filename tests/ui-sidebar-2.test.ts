import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('sidebar grouping, native geometry, real actions, title motion and update states', {timeout:190000,skip:process.platform!=='win32'}, () => {
  const env={...process.env}; delete env.ELECTRON_RUN_AS_NODE;
  const run=spawnSync(process.execPath,['tests/integration/ui-sidebar-2.mjs'],{env,encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:2*1024*1024});
  assert.ifError(run.error); assert.equal(run.status,0,run.stderr || run.stdout);
  assert.match(run.stdout,/UI-SIDEBAR-2: .* passed/);
});
