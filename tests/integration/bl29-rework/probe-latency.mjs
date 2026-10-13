import { outputPath } from './evidence.mjs';
import { cleanupOwnedProcesses } from '../../helpers/process-evidence.mjs';
import {_electron,chromium} from 'playwright';import {createRequire} from 'node:module';import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {pathToFileURL} from 'node:url';import {randomUUID} from 'node:crypto';
import {startTimelineCandidate} from './fixture.mjs';import {initializeDesktopSession} from './auth.mjs';
const diagnosticStarted=Date.now(),phased=process.argv.includes('--phased');
const checkpoint=stage=>console.log(`[probe-latency] ${stage} (${Date.now()-diagnosticStarted}ms)`);
checkpoint('synthetic identity preparation started');
const pause=ms=>new Promise(r=>setTimeout(r,ms)),f=await startTimelineCandidate({daily:true,inlineProgress:true,logicalMobile:true,cloudMobile:true,sidebar:true,historyCount:0,baseTime:Date.now()});let app,browser,measuring=false;const report={rows:[],errors:[]};const profile=mkdtempSync(join(tmpdir(),'weftmate-bl29-latency-')),startedAt=Date.now();
try{
 checkpoint('fixture ready');
 const main=(await f.request('/chats/main')).chat,host=(await f.request('/status')).hostId;
 const send=async text=>{const c=await f.request('/commands',{requestId:randomUUID(),kind:'chat.message',chatId:main.chatId,modelProfileId:'local',targetDeviceId:host,text});for(let i=0;i<100;i++){if((await f.request('/commands/'+c.command.commandId)).command.state==='accepted_by_dsh')return;await pause(10);}};
 await send('synthetic start');f.progress.text('initial done');f.progress.finish();
 const entry=join(profile,'entry.cjs');writeFileSync(entry,`const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.whenReady().then(async()=>{const {createPersonalDesktop}=await import(${JSON.stringify(pathToFileURL(resolve('src/personal-desktop.mjs')).href)});let quitting=false;app.on('before-quit',()=>quitting=true);const d=createPersonalDesktop({origin:${JSON.stringify(f.origin)},libraryDesktopToken:${JSON.stringify(f.libraryDesktopToken)},isQuitting:()=>quitting});globalThis.__bl29LatencyDesktop=d;await d.ready;});`);
 const env={...process.env,WEFTMATE_TEST_HOST_NAME:'synthetic-host'};delete env.ELECTRON_RUN_AS_NODE;
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[entry],env});const desktop=await app.firstWindow();let delay=0;
 checkpoint('desktop ready');
 await desktop.route('**/personal/v1/**',async route=>{const path=new URL(route.request().url()).pathname;if(path.endsWith('/ui/app.js'))return route.fulfill({contentType:'text/javascript',body:readFileSync('src/personal-access-ui/app.js','utf8').replace('ui.loadAttachmentHasher =','globalThis.__revCore=core;globalThis.__revUi=ui;ui.loadAttachmentHasher =')});if(!path.includes('/ui/'))await pause(delay);return route.continue();});
 await initializeDesktopSession(desktop,f);await desktop.waitForFunction(()=>globalThis.__revCore?.state.mainChat&&!__revCore.state.refreshing);await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.restore();w.show();});await desktop.evaluate(()=>__revCore.connectionVisibility(false));await desktop.waitForFunction(()=>__revCore.foreground());
 checkpoint('desktop authenticated');
 browser=await chromium.launch({headless:true});const mobile=await browser.newPage({viewport:{width:390,height:844}});await mobile.route('**/bridge',async route=>{await pause(delay);return route.continue();});await mobile.goto(f.mobileUrl);await mobile.waitForFunction(()=>state.booted&&state.loggedIn&&uiCore.state.mainChat);await mobile.evaluate(()=>uiCore.selectMainChat());await pause(2000);
 checkpoint('mobile authenticated');
 if(phased){const start=new Promise(resolve=>process.once('message',resolve));process.send({phase:'ready'});await start;measuring=true;checkpoint('measurement started');}
 for(const ms of [50,200]){
  delay=ms;
  // Reset the actual production overview timer, after its previous read is settled.
  await desktop.evaluate(async()=>{await __revCore.refreshAssistantOverview();__revUi.startAssistantRefresh();});await mobile.evaluate(async()=>{await listSharedSessions();mountMobileTabs();});
  const title='rename latency '+ms,at=Date.now();await f.request(`/sessions/${f.sessionId}/metadata`,{title},'PATCH');
  const times=await Promise.all([desktop.waitForFunction(title=>document.querySelector('#session-list')?.textContent.includes(title)||document.querySelector('#session-drawer')?.textContent.includes(title)||[...document.querySelectorAll('[data-session-id]')].some(n=>n.textContent.includes(title)),title,{timeout:10000}).then(()=>Date.now()-at).catch(e=>e.message),mobile.waitForFunction(title=>document.querySelector('#drawer').textContent.includes(title),title,{timeout:10000}).then(()=>Date.now()-at).catch(e=>e.message)]);
  report.rows.push({kind:'rename',delayMs:ms,desktop:times[0],mobile:times[1]});
  checkpoint(`rename ${ms}ms`);
  for(const [surface,p]of [['desktop',desktop],['mobile',mobile]]){
   await p.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
   await send('hidden message '+surface+ms);f.progress.text('fresh response '+surface+ms);f.progress.finish();await pause(150);const at=Date.now();await p.evaluate(()=>{delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));});
   let error;try{await p.getByText('fresh response '+surface+ms,{exact:false}).last().waitFor({state:'visible',timeout:10000});}catch(e){error=e.message;}
   report.rows.push({kind:'foreground',surface,delayMs:ms,ms:Date.now()-at,error});
   checkpoint(`foreground ${surface} ${ms}ms`);
  }
 }
 delay=0;const models=f.debug.backend.listModels;await f.request('/settings/personalization',{nextSuggestionsEnabled:true},'PATCH');await desktop.evaluate(()=>__revCore.loadPersonalization());
 f.debug.backend.listModels=async()=>[...await models(),{id:'added-electron',name:'synthetic added model',model:'synthetic',configured:true}];
 const changedAt=Date.now();await f.request('/settings/personalization',{nextSuggestionsEnabled:false},'PATCH');
 report.configurationTimes=await Promise.all([
  desktop.waitForFunction(()=>__revCore.state.models.some(m=>m.id==='added-electron')&&__revCore.state.personalization.nextSuggestionsEnabled===false,{},{timeout:7000}).then(()=>({surface:'desktop',ms:Date.now()-changedAt})),
  mobile.waitForFunction(()=>uiCore.state.models.some(m=>m.id==='added-electron')&&uiCore.state.personalization.nextSuggestionsEnabled===false,{},{timeout:7000}).then(()=>({surface:'mobile',ms:Date.now()-changedAt})),
 ]);
 report.electronConfig=await desktop.evaluate(()=>({models:__revCore.state.models.map(m=>m.id),suggestions:__revCore.state.personalization.nextSuggestionsEnabled}));
 report.mobileConfig=await mobile.evaluate(()=>({models:uiCore.state.models.map(m=>m.id),suggestions:uiCore.state.personalization.nextSuggestionsEnabled}));
 checkpoint('configuration complete');
 if(phased)process.send({phase:'measured',report});
}catch(e){report.failure=e.message;if(phased&&measuring)process.send({phase:'measured',report});if(app){const p=await app.firstWindow();report.desktopDebug=await p.evaluate(()=>({models:__revCore.state.models.map(m=>m.id),personalization:__revCore.state.personalization,revision:__revCore.state.accountRevision,result:__revCore.state.historyReadResult}));}if(browser){const p=browser.contexts()[0]?.pages()[0];report.mobileDebug=await p?.evaluate(()=>({models:uiCore.state.models.map(m=>m.id),personalization:uiCore.state.personalization,revision:uiCore.state.accountRevision,result:uiCore.state.historyReadResult,connection:uiCore.connectionView(),main:uiCore.inMainChat()}));}}finally{
 writeFileSync(outputPath('latency.json'),JSON.stringify(report,null,2));
 checkpoint('closing browser');await browser?.close();checkpoint('browser closed');
 checkpoint('closing desktop');
 // This probe measures live synchronization, not application shutdown. Exit
 // the synthetic shell explicitly after the measurements; close-to-tray and
 // quit interception must not keep its controller alive past the probe budget.
 if(app) {
  await app.evaluate(async()=>{await globalThis.__bl29LatencyDesktop.close();});
  const child=app.process(),exited=child.exitCode!==null||child.signalCode!==null?Promise.resolve({code:child.exitCode,signal:child.signalCode}):new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  const closed=app.waitForEvent('close',{timeout:30000});
  const requestExit=app.evaluate(({app})=>app.exit(0)).catch(error=>{if(!/closed|destroyed/i.test(error.message))throw error;});
  const [,,exit]=await Promise.all([requestExit,closed,exited]);
  if(exit.code!==0||exit.signal)throw Error('Synthetic desktop exit failed: '+JSON.stringify(exit));
 }
 checkpoint('desktop closed with exit 0');
 checkpoint('closing fixture');await f.close();checkpoint('fixture closed');
 rmSync(f.root,{recursive:true,force:true});rmSync(profile,{recursive:true,force:true});if(phased)process.disconnect();
}console.log(report);
