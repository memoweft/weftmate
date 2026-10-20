import test from 'node:test';
import assert from 'node:assert/strict';
import {presentAcceptanceWindow} from './present-window.mjs';
function fixture(minimized=false){
 const calls=[],window={webContents:{getURL:()=> 'http://127.0.0.1/personal/v1/ui/'},isMinimized:()=>minimized,restore:()=>{calls.push('restore');minimized=false;},show:()=>calls.push('show'),focus:()=>calls.push('focus')};
 return {calls,api:{BrowserWindow:{getAllWindows:()=>[{webContents:{getURL:()=> 'about:blank'}},window]}}};
}
test('a hidden non-minimized installed window is shown and focused before UI acceptance',()=>{
 const f=fixture();presentAcceptanceWindow(f.api);assert.deepEqual(f.calls,['show','focus']);
});
test('a minimized installed window is restored before showing, without selecting its splash window',()=>{
 const f=fixture(true);presentAcceptanceWindow(f.api);assert.deepEqual(f.calls,['restore','show','focus']);
});
