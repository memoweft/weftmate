import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('UI01B Windows workspace aligns typography, grouped navigation and native chrome', {skip:process.platform!=='win32',timeout:170000},()=>{
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const result=spawnSync(process.execPath,['tests/integration/ui-01b-visual.mjs'],{env,encoding:'utf8',windowsHide:true,timeout:160000,maxBuffer:2*1024*1024});
  assert.ifError(result.error);assert.equal(result.status,0,result.stderr||result.stdout);
  assert.match(result.stdout,/UI-01B visual shell: .* passed/);
});
