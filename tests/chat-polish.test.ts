import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('chat status, overlay scrolling and native composer transitions remain stable',{skip:process.platform!=='win32'||!!process.env.CI,timeout:120000},()=>{
 const result=spawnSync(process.execPath,['tests/integration/chat-polish.mjs'],{encoding:'utf8',env:process.env,windowsHide:true,timeout:110000,maxBuffer:2*1024*1024});
 assert.ifError(result.error);
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
});
