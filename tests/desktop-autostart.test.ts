import assert from 'node:assert/strict';
import test from 'node:test';
import { quoteWindowsLoginArgs, loginItemEnabled } from '../src/desktop-autostart.mjs';
test('Windows login item uses its named registry entry and preserves space-containing configuration paths', () => {
  assert.deepEqual(quoteWindowsLoginArgs(['--start-in-tray','--desktop-config=C:\\Users\\Test User\\config.json']),
    ['--start-in-tray','"--desktop-config=C:\\Users\\Test User\\config.json"']);
  const path='C:\\Programs\\WeftMate.exe';
  const value={openAtLogin:false,launchItems:[{name:'WeftMate QA',scope:'user',enabled:true,path}]};
  assert.equal(loginItemEnabled(value,'WeftMate QA',path,'win32'),true);
  assert.equal(loginItemEnabled(value,'WeftMate',path,'win32'),false);
  assert.equal(loginItemEnabled({...value,launchItems:[{...value.launchItems[0],enabled:false}]},'WeftMate QA',path,'win32'),false);
  assert.equal(loginItemEnabled({openAtLogin:true},'WeftMate',path,'darwin'),true);
});
