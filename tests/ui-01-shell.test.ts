import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('workspace panels and native project actions operate in the Windows Electron shell', { timeout:190000, skip:process.platform!=='win32' }, () => {
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const result=spawnSync(process.execPath,['tests/integration/ui-01-shell.mjs'],{env,encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:2*1024*1024});
  assert.ifError(result.error);assert.equal(result.status,0,result.stderr||result.stdout);
  assert.match(result.stdout,/UI-01 shell: .* passed/);
});

test('touch webpage returns from panels with its draft and keeps retention menus anchored', { timeout:50000 }, () => {
  const result=spawnSync(process.execPath,['tests/integration/ui-01-phone.mjs'],{env:{...process.env},encoding:'utf8',windowsHide:true,timeout:45000,maxBuffer:2*1024*1024});
  assert.ifError(result.error);assert.equal(result.status,0,result.stderr||result.stdout);
  assert.match(result.stdout,/UI-01 touch phone: .* passed/);
});
