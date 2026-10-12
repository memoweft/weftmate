import test from 'node:test';
import assert from 'node:assert/strict';
import { installationScope } from '../src/desktop-installation.mjs';
test('installation scope follows fresh install metadata and exact historical HKLM folder', () => {
  for (const scope of ['all', 'CurrentUser']) assert.equal(installationScope({ platform: 'win32', read: () => JSON.stringify({ scope }) }), scope);
  const options = { platform: 'win32', executable: 'D:\\QA Folder\\WeftMate.exe', read: () => { throw Error('legacy'); } };
  assert.equal(installationScope({ ...options, run: () => ({ status: 0, stdout: '    UninstallString    REG_SZ    "D:\\QA Folder\\Uninstall WeftMate.exe" /allusers' }) }), 'all');
  assert.equal(installationScope({ ...options, run: () => ({ status: 0, stdout: '    UninstallString    REG_SZ    "D:\\Other Folder\\Uninstall WeftMate.exe" /allusers' }) }), 'CurrentUser');
});
