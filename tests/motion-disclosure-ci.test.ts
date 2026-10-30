import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('height disclosure stays continuous at controlled 60/30Hz with a delayed first frame',{timeout:90000,skip:process.platform!=='win32'},()=>{
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const run=spawnSync(process.execPath,['tests/integration/motion-disclosure-ci.mjs'],{env,encoding:'utf8',windowsHide:true,timeout:80000,maxBuffer:2*1024*1024});
  assert.ifError(run.error);assert.equal(run.status,0,run.stderr||run.stdout);
});
