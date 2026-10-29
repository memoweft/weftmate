import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('native desktop disclosure, section states and switch inventory use interruptible shared motion', {timeout:240000,skip:process.platform!=='win32'},()=>{
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const run=spawnSync(process.execPath,['tests/integration/ui-motion-2.mjs'],{env,encoding:'utf8',windowsHide:true,timeout:230000,maxBuffer:2*1024*1024});
  assert.ifError(run.error);assert.equal(run.status,0,run.stderr||run.stdout);
});
