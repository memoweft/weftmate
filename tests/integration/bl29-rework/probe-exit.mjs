import { outputPath } from './evidence.mjs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {superviseExit, scrub} from './exit-supervisor.mjs';
import {createBl29Baseline} from './baseline.mjs';
import {mkdtempSync,writeFileSync,rmSync,readFileSync,appendFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createPersonalAccessService} from '../../../src/personal-access/index.mjs';
import {PERSONAL_HOST_MARKER,PERSONAL_HOST_MARKER_CONTENT} from '../../../src/host-mode.mjs';
import {localUiSession} from '../../helpers/local-ui-session.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function nativeReadiness(page) {
 return page.evaluate(()=>{
  const core=globalThis.__revExitCore;
  return {coreReady:!!core,view:core?.state.currentView,visible:document.visibilityState,
   foreground:core?.foreground?.(),modelsKnown:core?.state.modelsKnown,models:core?.state.models.length,
   mainReady:!!core?.state.mainChat,mainSelected:core?.inMainChat?.(),canWait:core?.canWaitForReply?.(),
   refreshing:core?.state.refreshing,selecting:core?.state.sessionSelecting,online:core?.state.online,
   background:core?.state.background,connection:core?.state.connection?.kind,
   refreshTimer:!!core?.state.refreshTimer,liveTimer:!!core?.state.liveRefreshTimer,
   historyKind:core?.state.historyReadResult?.kind,historyWait:!!core?.historyWaitAbort,
   timelineReady:!!core?.state.chatWindow?.syncCursor,
   onboardingVisible:!!document.querySelector('.onboarding:not([hidden])')};
 });
}
function shutdownStages(profile) {
 const logs=join(profile,'logs');
 if(!existsSync(logs))return [];
 return readdirSync(logs).filter(name=>/^host-.*\.jsonl$/.test(name)).flatMap(name=>
  readFileSync(join(logs,name),'utf8').trim().split('\n').flatMap(line=>{
   try {const row=JSON.parse(line);return ['host.shutdown_step','host.exit','host.failure'].includes(row.event)?[row]:[];}
   catch{return [];}
  }));
}
if (!process.env.BL29_OWNED_ROOT) {
 const result = await superviseExit({args:process.argv.slice(2),outputDir:resolve(outputPath('.'))});
 writeFileSync(outputPath('exit.json'),JSON.stringify(result.rows,null,2));
 console.log(JSON.stringify(result));process.exit(result.status ?? 1);
}
const ownedRoot=resolve(process.env.BL29_OWNED_ROOT);
const {_electron}=await import('playwright');
if (!process.argv.includes('--head-only')) {
 const baseline=createBl29Baseline().changedSources(['src','apps/mobile-ui/www']);writeFileSync(outputPath('baseline.json'),JSON.stringify(baseline));process.env.BL29_BASELINE_FILE=outputPath('baseline.json');
}
const report=[];
const methods=process.argv.find(arg=>arg.startsWith('--methods='))?.slice(10).split(',') ?? (process.argv.includes('--orders-only')?['runtime-first','access-first']:['window-tray-exit','tray-exit','update-restart','runtime-first','access-first']);
async function runCase(version,method){
 const stage=(name,extra={})=>appendFileSync(join(ownedRoot,'stages.jsonl'),JSON.stringify({at:new Date().toISOString(),stage:name,method,rss:process.memoryUsage().rss,...extra})+'\n');
 const root=mkdtempSync(join(ownedRoot,'weftmate-case-')),profile=join(root,'profile'),credentials={username:'rev-'+randomUUID(),password:'synthetic-'+randomUUID(),deviceName:'synthetic-host'};
 stage('prepare',{profile});
 const prep=await createPersonalAccessService({root:join(profile,'personal-access'),port:0,hostName:'synthetic-host',backend:Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(k=>[k,async()=>k==='listModels'?[]:{}]))});
 const info=await prep.start(),grant=await prep.issueSetupGrant();await fetch(info.origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin:info.origin,'content-type':'application/json'},body:JSON.stringify({...credentials,grant:grant.grant})});await prep.close();writeFileSync(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
 const env={...process.env,BL29_EXIT_METHOD:method,BL29_EXIT_CASE_ROOT:root};for(const k of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_|ELECTRON_RUN_AS_NODE)/.test(k))delete env[k];env.WEFTMATE_TEST_HOST_NAME='synthetic-host';env.REV_BASELINE=version==='main'?'1':'0';
 let app;const row={version,method};report.push(row);console.log('START',version,method);
 try{
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['tests/integration/bl29-rework/exit-entry.mjs',`--user-data-dir=${profile}`,'--personal-host','--access-port=0'],env,timeout:90000});
  const p=await app.firstWindow(),pending=new Set(),waitCounts={started:0,finished:0,failed:0};
  await app.evaluate(()=>globalThis.revProcessRegistration);
  // Native startup owns login and can start its first wait before /auth/me.
  // Observe real requests from the first window, not only after login; request
  // identity also avoids negative counts when startup is reloaded/cancelled.
  p.on('request',r=>{if(r.url().includes('waitMs=')){pending.add(r);waitCounts.started++;}});
  p.on('requestfinished',r=>{if(r.url().includes('waitMs=')){pending.delete(r);waitCounts.finished++;}});
  p.on('requestfailed',r=>{if(r.url().includes('waitMs=')){pending.delete(r);waitCounts.failed++;}});
  stage('first-window');await p.waitForURL('**/personal/v1/ui*');
  if(version==='main') await localUiSession(p,credentials,'synthetic-host',{interceptLegacyStatus:false,mainChat:true});
  else {
   // The fixture adds the diagnostic projection while serving the first app.js;
   // native bootstrap and its real timers only run once per launch.
   await p.locator('#assistant-view').waitFor({state:'visible'});
   row.nativeSession=await p.evaluate(async()=>{const response=await fetch('/personal/v1/auth/me');const body=await response.json();
    return {status:response.status,authKind:body.device?.authKind,local:body.local};});
   assert.equal(row.nativeSession.status,200);assert.equal(row.nativeSession.authKind,'desktop');assert.equal(row.nativeSession.local,true);
   // The first window may still be hidden. Initial native reads honor the
   // foreground gate, so establish visibility before waiting for those reads.
   await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.restore();w.show();w.focus();});
   await p.waitForFunction(()=>document.visibilityState==='visible'&&globalThis.__revExitCore.foreground());
   await p.waitForFunction(()=>{const core=globalThis.__revExitCore;return core?.state.mainChat&&core.state.modelsKnown&&
    !core.state.refreshing&&!core.state.sessionSelecting;});
   if(!await p.evaluate(()=>__revExitCore.inMainChat())) await p.evaluate(()=>__revExitCore.selectMainChat());
   row.nativeReadiness=await nativeReadiness(p);
  }
  stage('login');
  // Observe the actual pending read, rather than spending the entire setup
  // budget again after native readiness has already been established.
  const waitReadyBy=Date.now()+2500;while(!pending.size&&Date.now()<waitReadyBy)await pause(25);
  row.pendingWaitRequests=pending.size;row.waitRequestCounts={...waitCounts};
  if(version==='head')row.beforeCloseReadiness=await nativeReadiness(p);
  const child=app.process();const closed=new Promise(r=>child.once('close',()=>r()));
  if(['runtime-first','access-first'].includes(method)){
   const origin=await app.evaluate(()=>globalThis.revRuntimeOrigin());if(!origin)throw Error('runtime origin unavailable');
   const created=await fetch(origin+'/weftmate/api/v1/sessions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:'rev-runtime',agentPreset:'personal-remote'})});row.gatewayCreated=created.status;const data=await created.json();const id=data.sessionId||'rev-runtime';
   const snapshot=await(await fetch(origin+`/weftmate/api/v1/sessions/${id}/history?limit=1`)).json();row.waitSeq=snapshot.liveSeq??snapshot.nextSeq;
   const waiting=fetch(origin+`/weftmate/api/v1/sessions/${id}/history?waitMs=30000&waitSeq=${row.waitSeq}&limit=1`).then(async r=>({status:r.status,body:await r.json()})).catch(e=>({error:e.message}));await pause(100);
   if(method==='access-first'){const at=Date.now();await app.evaluate(()=>globalThis.revAccessClose());row.accessCloseMs=Date.now()-at;}
   const at=Date.now();await app.evaluate(()=>globalThis.revRuntimeClose());row.runtimeCloseMs=Date.now()-at;row.gatewayWait=await waiting;
   if(method==='runtime-first'){const at=Date.now();await app.evaluate(()=>globalThis.revAccessClose());row.accessCloseMs=Date.now()-at;}
  }
  if(method==='window-tray-exit'){await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await pause(100);row.hidden=await app.evaluate(({BrowserWindow})=>!BrowserWindow.getAllWindows()[0].isVisible());}
  await app.evaluate(async()=>{for(let i=0;i<70&&!globalThis.revTray;i++)await new Promise(r=>setTimeout(r,100));if(!globalThis.revTray)throw Error('tray missing');});
  if(version==='head'&&method==='update-restart')await app.evaluate(()=>globalThis.revQueueTeardownRequest());
  stage('quit-requested');const at=Date.now();if(method==='update-restart')await app.evaluate(()=>{setTimeout(()=>void globalThis.revUpdate(),0);});else await app.evaluate(()=>{setTimeout(()=>globalThis.revTray.items.find(i=>i.label==='退出').click(),0);});
  await closed;row.ms=Date.now()-at;row.exitCode=child.exitCode;stage('closed',{exitCode:child.exitCode});app=null;
 }catch(e){row.error=scrub(e.message);if(version==='head'&&app)row.failedReadiness=await app.firstWindow().then(nativeReadiness).catch(()=>null);process.exitCode=1;}finally{await app?.close();row.shutdownStages=shutdownStages(profile);if(existsSync(join(root,'teardown-request.json')))row.teardownRequest=JSON.parse(readFileSync(join(root,'teardown-request.json'),'utf8'));rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});writeFileSync(outputPath(process.argv.includes('--orders-only')?'orders.json':'exit.json'),JSON.stringify(report,null,2));console.log(row);}
}
const cases=(process.argv.includes('--head-only')?['head']:['main','head']).flatMap(version=>methods.map(method=>({version,method})));
// Each case has its own profile, cookies and runtime. Two independent launches
// fit the existing total deadline without changing any close/wait assertions.
for(let index=0;index<cases.length;index+=2)await Promise.all(cases.slice(index,index+2).map(({version,method})=>runCase(version,method)));
