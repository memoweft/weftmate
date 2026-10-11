import { outputPath } from './evidence.mjs';
import {_electron} from 'playwright';import {createRequire} from 'node:module';import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {pathToFileURL} from 'node:url';
import {startTimelineCandidate} from './fixture.mjs';import {localUiSession} from '../../helpers/local-ui-session.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms)),f=await startTimelineCandidate({daily:true,inlineProgress:true,sidebar:true,historyCount:0,baseTime:Date.now()}),profile=mkdtempSync(join(tmpdir(),'rev-bl29-errors-')),report=[];let app;
try{
 const entry=join(profile,'entry.cjs');writeFileSync(entry,`const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.whenReady().then(async()=>{const {createPersonalDesktop}=await import(${JSON.stringify(pathToFileURL(resolve('src/personal-desktop.mjs')).href)});let quitting=false;app.on('before-quit',()=>quitting=true);const d=createPersonalDesktop({origin:${JSON.stringify(f.origin)},isQuitting:()=>quitting});await d.ready;});`);const env={...process.env,WEFTMATE_TEST_HOST_NAME:'synthetic-host'};delete env.ELECTRON_RUN_AS_NODE;
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[entry],env});const p=await app.firstWindow();let failure=null,count=0,recovering=false,healthyAt;
 await p.route('**/personal/v1/ui/app.js',route=>route.fulfill({contentType:'text/javascript',body:readFileSync('src/personal-access-ui/app.js','utf8').replace('ui.loadAttachmentHasher =','globalThis.__revCore=core;globalThis.__revUi=ui;ui.loadAttachmentHasher =')}));
 await p.route(/\/personal\/v1\/chats\/[^/]+\/changes\?/,route=>{count++;if(!failure){if(recovering)healthyAt??=Date.now();return route.continue();}if(failure==='NETWORK')return route.abort('internetdisconnected');const status=failure==='UNAUTHORIZED'?401:failure==='NOT_FOUND'?404:failure==='CURSOR_RESET_REQUIRED'?409:failure==='HTTP_502'?502:failure==='HTTP_504'?504:503;return route.fulfill({status,contentType:'application/json',body:JSON.stringify({error:{code:failure}})});});
 for(const code of ['NOT_FOUND','SESSION_ARCHIVED','BACKEND_UNAVAILABLE','CURSOR_RESET_REQUIRED','UNAUTHORIZED','NETWORK','HTTP_502','HTTP_504']){
  failure=null;await p.reload();await localUiSession(p,f.credentials,'synthetic-errors',{interceptLegacyStatus:false,mainChat:true});await p.waitForFunction(()=>globalThis.__revCore?.state.mainChat&&!__revCore.state.refreshing);await p.evaluate(()=>__revCore.selectMainChat());
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.restore();w.show();});await p.evaluate(()=>__revCore.connectionVisibility(false));await pause(150);
  await p.evaluate(()=>__revCore.stopAssistantRefresh());await pause(100);failure=code;count=0;recovering=false;healthyAt=null;
  await p.evaluate(()=>{__revCore.presence.success({runtime:'ready'});__revUi.startAssistantRefresh();});const at=Date.now();await pause(4500);
  const row={code,ms:Date.now()-at,count,rps:count/((Date.now()-at)/1000),debug:await p.evaluate(()=>({main:__revCore.inMainChat(),view:__revCore.state.currentView,visible:document.visibilityState,background:__revCore.state.background,csrf:!!__revCore.state.csrfToken}))};report.push(row);
  if(!['NOT_FOUND','UNAUTHORIZED'].includes(code)){
   failure=null;recovering=true;const restored=Date.now();
   while(!healthyAt&&Date.now()-restored<2200)await pause(10);
   row.recoveredWaitMs=healthyAt?healthyAt-restored:null;
  }
  await p.evaluate(()=>__revCore.stopAssistantRefresh());
 }
}catch(e){report.push({failure:e.message});}finally{writeFileSync(outputPath('desktop-errors.json'),JSON.stringify(report,null,2));await app?.close();await f.close();rmSync(f.root,{recursive:true,force:true});rmSync(profile,{recursive:true,force:true});}console.log(report);
