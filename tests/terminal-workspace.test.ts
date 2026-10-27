import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

test('real Electron workspace opens and disposes interactive terminal tabs', {timeout:120000,skip:process.platform!=='win32'},()=>{
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const result=spawnSync(process.execPath,['tests/integration/terminal-workspace.mjs'],{env,encoding:'utf8',windowsHide:true,timeout:110000,maxBuffer:2*1024*1024});
  assert.ifError(result.error);assert.equal(result.status,0,result.stderr||result.stdout);
  assert.match(result.stdout,/UI05 real workspace terminal passed/);
});
