import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('streaming virtual rows follow in the same frame and hold the reader after upward scrolling',{
  skip:process.platform!=='win32'||!!process.env.CI,timeout:90000,
},()=>{
  const result=spawnSync(process.execPath,['tests/integration/perf-stream.mjs'],{env:process.env,encoding:'utf8',windowsHide:true,timeout:85000,maxBuffer:2*1024*1024});
  assert.ifError(result.error);assert.equal(result.status,0,result.stderr||result.stdout);
});
