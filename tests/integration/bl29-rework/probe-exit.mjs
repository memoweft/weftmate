import { outputPath } from './evidence.mjs';
import {createRequire} from 'node:module';
import {superviseExit, scrub} from './exit-supervisor.mjs';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync,readFileSync,appendFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createPersonalAccessService} from '../../../src/personal-access/index.mjs';
import {PERSONAL_HOST_MARKER,PERSONAL_HOST_MARKER_CONTENT} from '../../../src/host-mode.mjs';
import {localUiSession} from '../../helpers/local-ui-session.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
if (!process.env.BL29_OWNED_ROOT) {
 const result = await superviseExit({args:process.argv.slice(2),outputDir:resolve(outputPath('.'))});
 writeFileSync(outputPath('exit.json'),JSON.stringify(result.rows,null,2));
 console.log(JSON.stringify(result));process.exit(result.status ?? 1);
}
const ownedRoot=resolve(process.env.BL29_OWNED_ROOT);
let currentProfile, currentMethod;
const stage=(name,extra={})=>appendFileSync(join(ownedRoot,'stages.jsonl'),JSON.stringify({at:new Date().toISOString(),stage:name,method:currentMethod,rss:process.memoryUsage().rss,...extra})+'\n');
const {_electron}=await import('playwright');
const files=execFileSync('git',['diff','--name-only','origin/main...HEAD','--','src','apps/mobile-ui/www'],{encoding:'utf8'}).trim().split('\n');
const baseline=Object.fromEntries(files.map(p=>[p,execFileSync('git',['show','origin/main:'+p],{encoding:'utf8'})]));writeFileSync(outputPath('baseline.json'),JSON.stringify(baseline));process.env.BL29_BASELINE_FILE=outputPath('baseline.json');
const report=[];
const methods=process.argv.find(arg=>arg.startsWith('--methods='))?.slice(10).split(',') ?? (process.argv.includes('--orders-only')?['runtime-first','access-first']:['window-tray-exit','tray-exit','update-restart','runtime-first','access-first']);
for(const version of (process.argv.includes('--head-only')?['head']:['main','head']))for(const method of methods){
 const root=mkdtempSync(join(ownedRoot,'weftmate-case-')),profile=join(root,'profile'),credentials={username:'rev-'+randomUUID(),password:'synthetic-'+randomUUID(),deviceName:'synthetic-host'};
 currentProfile=profile;currentMethod=method;stage('prepare',{profile});
 const prep=await createPersonalAccessService({root:join(profile,'personal-access'),port:0,hostName:'synthetic-host',backend:Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(k=>[k,async()=>k==='listModels'?[]:{}]))});
 const info=await prep.start(),grant=await prep.issueSetupGrant();await fetch(info.origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin:info.origin,'content-type':'application/json'},body:JSON.stringify({...credentials,grant:grant.grant})});await prep.close();writeFileSync(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
 const env={...process.env,BL29_EXIT_METHOD:method};for(const k of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_|ELECTRON_RUN_AS_NODE)/.test(k))delete env[k];env.WEFTMATE_TEST_HOST_NAME='synthetic-host';env.REV_BASELINE=version==='main'?'1':'0';
 let app;const row={version,method};report.push(row);console.log('START',version,method);
 try{
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['tests/integration/bl29-rework/exit-entry.mjs',`--user-data-dir=${profile}`,'--personal-host','--access-port=0'],env,timeout:90000});
  const p=await app.firstWindow();stage('first-window');await p.waitForURL('**/personal/v1/ui*');await localUiSession(p,credentials,'synthetic-host',{interceptLegacyStatus:false,mainChat:true});stage('login');
  let pending=0;p.on('request',r=>{if(r.url().includes('waitMs='))pending++;});p.on('requestfinished',r=>{if(r.url().includes('waitMs='))pending--;});p.on('requestfailed',r=>{if(r.url().includes('waitMs='))pending--;});
  await pause(2500);row.pendingWaitRequests=pending;const child=app.process();const closed=new Promise(r=>child.once('close',()=>r()));
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
  stage('quit-requested');const at=Date.now();if(method==='update-restart')await app.evaluate(()=>{setTimeout(()=>void globalThis.revUpdate(),0);});else await app.evaluate(()=>{setTimeout(()=>globalThis.revTray.items.find(i=>i.label==='退出').click(),0);});
  await closed;row.ms=Date.now()-at;row.exitCode=child.exitCode;stage('closed',{exitCode:child.exitCode});app=null;
 }catch(e){row.error=scrub(e.message);process.exitCode=1;}finally{await app?.close();rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});writeFileSync(outputPath(process.argv.includes('--orders-only')?'orders.json':'exit.json'),JSON.stringify(report,null,2));console.log(row);}
}
