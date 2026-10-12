import assert from 'node:assert/strict';
import test from 'node:test';
import { quoteWindowsLoginArgs, loginItemEnabled, rebaseLoginCommand, repairWindowsLoginItem } from '../src/desktop-autostart.mjs';
test('Windows login item uses its named registry entry and preserves space-containing configuration paths', () => {
  assert.deepEqual(quoteWindowsLoginArgs(['--start-in-tray','--desktop-config=C:\\Users\\Default User\\config.json']),
    ['--start-in-tray','"--desktop-config=C:\\Users\\Default User\\config.json"']);
  const path='C:\\Programs\\WeftMate.exe';
  const value={openAtLogin:false,launchItems:[{name:'WeftMate QA',scope:'user',enabled:true,path}]};
  assert.equal(loginItemEnabled(value,'WeftMate QA',path,'win32'),true);
  assert.equal(loginItemEnabled(value,'WeftMate',path,'win32'),false);
  assert.equal(loginItemEnabled({...value,launchItems:[{...value.launchItems[0],enabled:false}]},'WeftMate QA',path,'win32'),false);
  assert.equal(loginItemEnabled({openAtLogin:true},'WeftMate',path,'darwin'),true);
});
test('startup repairs only a missing old executable, preserving every configuration argument', () => {
  const old = '"C:\\old install\\WeftMate.exe" --start-in-tray "--desktop-config=C:\\QA config\\desktop.json"';
  assert.equal(rebaseLoginCommand(old, 'D:\\new install\\WeftMate.exe', { exists: () => false }), '"D:\\new install\\WeftMate.exe" --start-in-tray "--desktop-config=C:\\QA config\\desktop.json"');
  assert.equal(rebaseLoginCommand(old, 'D:\\new install\\WeftMate.exe', { exists: () => true }), null);
  assert.equal(rebaseLoginCommand('', 'D:\\app.exe'), null);
  assert.equal(rebaseLoginCommand('C:\\old\\app.exe --start-in-tray', 'D:\\app.exe', { exists: () => true, force: true }), '"D:\\app.exe" --start-in-tray');
});
test('registry repair does not enable a disabled startup or block use after a query error', () => {
  let writes = 0;
  const run = (_command, args) => { if (args[0] === 'add') writes++; return { status: 1 }; };
  assert.equal(repairWindowsLoginItem({ name: 'WeftMate synthetic', executable: 'D:\\QA\\app.exe', platform: 'win32', run }), false);
  assert.equal(writes, 0);
  assert.equal(repairWindowsLoginItem({ name: 'WeftMate synthetic', executable: 'D:\\QA\\app.exe', platform: 'win32', run: () => { throw Error('unavailable'); } }), false);
});
