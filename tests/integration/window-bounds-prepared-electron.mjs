/** The preparation shell and authenticated desktop share the real native restore. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import executablePath from 'electron';
import { launchWindowElectron, closeWindowElectron, stopWindowElectron } from '../helpers/bounded-window-electron.mjs';
const root=mkdtempSync(join(tmpdir(),'weftmate-window-prepared-')), expected={x:80,y:80,width:1000,height:600};
const server=createServer((_request,response)=>{response.writeHead(200,{'Content-Type':'text/html'});response.end('<!doctype html><title>WeftMate</title>Isolated handoff');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const rows=[];let app;
try{
 for(const [scale,fault] of [[1.25,'none'],[1.5,'none'],[1.75,'none'],[1.5,'hung']]){
  const profile=join(root,`${scale}-${fault}`);mkdirSync(profile);const stateFile=join(profile,'desktop-window.json');
  const original=JSON.stringify({bounds:expected,maximized:true});writeFileSync(stateFile,original);
  const env={...process.env,WINDOW_BOUNDS_PROFILE:profile,WINDOW_BOUNDS_PREPARED:'true',WINDOW_BOUNDS_FAULT:fault,
   WINDOW_BOUNDS_ORIGIN:`http://127.0.0.1:${server.address().port}`,WEFTMATE_TEST_HOST_NAME:'synthetic-host'};delete env.ELECTRON_RUN_AS_NODE;
  app=await launchWindowElectron({executablePath,cwd:fileURLToPath(new URL('../../',import.meta.url)),env,
   args:['tests/helpers/window-bounds-electron.mjs',`--force-device-scale-factor=${scale}`]},join(profile,'process.log'));
  const page=await app.firstWindow();await page.getByRole('status').filter({hasText:'准备中'}).waitFor();
  if(fault==='hung'){
   const cancelled=await app.evaluate(async()=>{
    const desktop=globalThis.windowBoundsDesktop,start=performance.now();await desktop.close();await desktop.ready;
    return {milliseconds:performance.now()-start,visible:desktop.window.isVisible(),maximized:desktop.window.isMaximized(),pid:globalThis.windowBoundsBridgePid};
   });
   assert.equal(cancelled.visible,false);assert.equal(cancelled.maximized,false);assert.ok(cancelled.milliseconds<1000);
   assert.equal(readFileSync(stateFile,'utf8'),original);
   assert.throws(()=>process.kill(cancelled.pid,0),{code:'ESRCH'});rows.push({scale,fault,...cancelled,pid:undefined});
  }else{
   const observed=await app.evaluate(async()=>{
    const desktop=globalThis.windowBoundsDesktop;await desktop.ready;const win=desktop.window;
    const before={id:win.id,bounds:win.getNormalBounds(),maximized:win.isMaximized(),url:win.webContents.getURL(),early:globalThis.windowBoundsEarlyShow};
    await new Promise(resolve=>{win.once('unmaximize',resolve);win.unmaximize();});
    await globalThis.adoptPreparedDesktop();globalThis.windowBoundsDesktop.show();
    return {before,after:{id:win.id,bounds:win.getNormalBounds(),maximized:win.isMaximized()}};
   });
   assert.deepEqual(observed.before.early,{visible:false,maximized:false});assert.deepEqual(observed.before.bounds,expected);
   assert.equal(observed.before.maximized,true);assert.ok(observed.before.url.endsWith('/desktop-startup.html'));
   assert.equal(observed.after.id,observed.before.id);assert.equal(observed.after.maximized,false);
   assert.deepEqual(observed.after.bounds,expected);rows.push({scale,fault,bounds:observed.after.bounds});
  }
  await closeWindowElectron(app);app=null;
  if(fault==='none')assert.deepEqual(JSON.parse(readFileSync(stateFile,'utf8')),{bounds:expected,maximized:false});
 }
}finally{await stopWindowElectron(app);await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify({passed:rows.length,rows}));assert.equal(rows.length,4);
