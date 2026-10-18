import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('credential startup refuses device state and pairing and leaves no records after failure',{skip:process.platform!=='win32',timeout:90000},()=>{
 const result=spawnSync(process.execPath,['tests/integration/credential-startup-security.mjs'],{windowsHide:true,encoding:'utf8',timeout:80000,maxBuffer:1024*1024});
 assert.ifError(result.error);assert.equal(result.status,0,result.stderr||result.stdout);assert.match(result.stdout,/credential startup security passed/);
});
