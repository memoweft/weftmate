import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
for(const scenario of ['ready','failure'])test(`first window prepares while credential readiness is gated (${scenario})`, { skip:process.platform!=='win32', timeout:90000 },()=>{
  const result=spawnSync(process.execPath,['tests/integration/credential-first-window.mjs',scenario],{windowsHide:true,encoding:'utf8',timeout:80000,maxBuffer:1024*1024});
  assert.ifError(result.error);
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.ok(result.stdout.includes(`credential first-window ${scenario} gate passed`),result.stdout);
});
