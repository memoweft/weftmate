import { outputPath } from './evidence.mjs';
import {_electron} from 'playwright';import {createRequire} from 'node:module';import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {pathToFileURL} from 'node:url';
import {startTimelineCandidate} from './fixture.mjs';import {initializeDesktopSession} from './auth.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms)),f=await startTimelineCandidate({daily:true,inlineProgress:true,sidebar:true,historyCount:0,baseTime:Date.now()}),profile=mkdtempSync(join(tmpdir(),'weftmate-bl29-errors-')),report=[];let app;
try{
 const entry=join(profile,'entry.cjs');writeFileSync(entry,`const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.whenReady().then(async()=>{const {createPersonalDesktop}=await import(${JSON.stringify(pathToFileURL(resolve('src/personal-desktop.mjs')).href)});let quitting=false;app.on('before-quit',()=>quitting=true);const d=createPersonalDesktop({origin:${JSON.stringify(f.origin)},libraryDesktopToken:${JSON.stringify(f.libraryDesktopToken)},isQuitting:()=>quitting});globalThis.__bl29ErrorsDesktop=d;await d.ready;});`);const env={...process.env,WEFTMATE_TEST_HOST_NAME:'synthetic-host'};delete env.ELECTRON_RUN_AS_NODE;
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[entry],env});const p=await app.firstWindow();let failure=null,count=0,recovering=false,healthyAt;
 // This probe measures foreground recovery, not minimize behavior. Keep its
 // own synthetic window out of taskbar-wide minimize operations while other
 // packages use the shared desktop; production visibility events remain real.
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setMinimizable(false);w.setSkipTaskbar(true);});
 await p.route('**/personal/v1/ui/app.js',route=>route.fulfill({contentType:'text/javascript',body:readFileSync('src/personal-access-ui/app.js','utf8').replace('ui.loadAttachmentHasher =','globalThis.__revCore=core;globalThis.__revUi=ui;ui.loadAttachmentHasher =')}));
 // UNAUTHORIZED models persistent authorization loss, including recovery.
 // A 200 native bootstrap would instead create a valid new identity after
 // every injected 401, which is the intended local-session recovery behavior.
 await p.route(/\/personal\/v1\/auth\/(?:desktop|me)(?:\?|$)/,route=>failure==='UNAUTHORIZED'
  ?route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:{code:'UNAUTHORIZED'}})})
  :route.continue());
 await p.route(/\/personal\/v1\/chats\/[^/]+\/changes\?/,route=>{count++;if(!failure){if(recovering)healthyAt??=Date.now();return route.continue();}if(failure==='NETWORK')return route.abort('internetdisconnected');const status=failure==='UNAUTHORIZED'?401:failure==='NOT_FOUND'?404:failure==='CURSOR_RESET_REQUIRED'?409:failure==='HTTP_502'?502:failure==='HTTP_504'?504:503;return route.fulfill({status,contentType:'application/json',body:JSON.stringify({error:{code:failure}})});});
 for(const code of ['NOT_FOUND','SESSION_ARCHIVED','BACKEND_UNAVAILABLE','CURSOR_RESET_REQUIRED','UNAUTHORIZED','NETWORK','HTTP_502','HTTP_504']){
  failure=null;await initializeDesktopSession(p,f);await p.waitForFunction(()=>globalThis.__revCore?.state.mainChat&&!__revCore.state.refreshing);await p.evaluate(()=>__revCore.selectMainChat());
  // A reload can deliver the previous native hidden frame after a direct core
  // override. Publish the actual window state and await the production bridge
  // before starting a foreground recovery measurement.
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.restore();w.show();w.webContents.send('wm:desktop:visibility',w.isMinimized()||!w.isVisible());});
  await p.waitForFunction(()=>__revCore.foreground()&&document.visibilityState==='visible');
  await p.evaluate(()=>__revCore.stopAssistantRefresh());
  await p.waitForFunction(()=>!__revCore.state.liveRefreshing&&!__revCore.state.refreshing&&!__revCore.state.sessionSelecting);
  failure=code;count=0;recovering=false;healthyAt=null;
  await p.evaluate(()=>{__revCore.presence.success({runtime:'ready'});__revUi.startAssistantRefresh();});const at=Date.now();await pause(4500);
  const row={code,ms:Date.now()-at,count,rps:count/((Date.now()-at)/1000),debug:await p.evaluate(()=>({main:__revCore.inMainChat(),view:__revCore.state.currentView,visible:document.visibilityState,background:__revCore.state.background,csrf:!!__revCore.state.csrfToken})),nativeWindow:await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];return{visible:w.isVisible(),minimized:w.isMinimized()};})};report.push(row);
  if(!['NOT_FOUND','UNAUTHORIZED'].includes(code)){
   failure=null;recovering=true;const restored=Date.now();
   while(!healthyAt&&Date.now()-restored<2200)await pause(10);
   row.recoveredWaitMs=healthyAt?healthyAt-restored:null;
  }
  await p.evaluate(()=>__revCore.stopAssistantRefresh());
 }
}catch(e){report.push({failure:e.message});}finally{
 writeFileSync(outputPath('desktop-errors.json'),JSON.stringify(report,null,2));
 if(app) {
  // This probe measures request/recovery budgets, not quit interception. The
  // synthetic shell must not leave SIGTERM or close-to-tray handling alive.
  await app.evaluate(async()=>{await globalThis.__bl29ErrorsDesktop.close();});
  const child=app.process(),exited=child.exitCode!==null||child.signalCode!==null?Promise.resolve({code:child.exitCode,signal:child.signalCode}):new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  const closed=app.waitForEvent('close',{timeout:30000});
  const requestExit=app.evaluate(({app})=>app.exit(0)).catch(error=>{if(!/closed|destroyed/i.test(error.message))throw error;});
  const [,,exit]=await Promise.all([requestExit,closed,exited]);
  if(exit.code!==0||exit.signal)throw Error('Synthetic desktop exit failed: '+JSON.stringify(exit));
  console.log('Desktop error probe exit:',JSON.stringify(exit));
 }
 await f.close();rmSync(f.root,{recursive:true,force:true});rmSync(profile,{recursive:true,force:true});
}console.log(report);
