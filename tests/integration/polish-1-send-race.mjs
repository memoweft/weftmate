import { evidencePath } from '../helpers/evidence-path.mjs';
/** Actual Electron rendering when native history beats the send acknowledgement. */
process.env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
import assert from 'node:assert/strict';
import {_electron} from 'playwright';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {managedMkdtemp,managedTempRoot} from '../helpers/managed-temp.mjs';
import {startTimelineCandidate} from './timeline-ui-candidate.mjs';
const old={WeftUiCore:{factories:{}}};
runInNewContext(execFileSync('git',['show','814031a7:src/ui-core/composer.js'],{encoding:'utf8'}),old);
const oldFactory=old.WeftUiCore.factories.composer.toString(),out=evidencePath('polish-1/race');await mkdir(out,{recursive:true});
const report={synthetic:true,realModelRequests:0,checks:[]};
for(const before of [true,false])for(const width of [1200,480])for(const theme of ['light','dark']){
 const f=await startTimelineCandidate({interactive:true,historyCount:0,inlineProgress:true});f.progress.finish();
 const profile=await managedMkdtemp(join(managedTempRoot(),'weftmate-polish-race-'));let app;
 try{
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['scripts/review-gallery/electron.mjs','--force-device-scale-factor=1'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:f.origin,REVIEW_LIBRARY_TOKEN:f.libraryDesktopToken,REVIEW_THEME:theme}});
  const p=await app.firstWindow();p.setDefaultTimeout(15000);p.on('pageerror',error=>console.log('Page error',error.message));
  await p.addInitScript({content:`
   const beforeComposer=(${oldFactory});let api;
   Object.defineProperty(globalThis,'WeftUiCore',{configurable:true,get:()=>api,set:value=>{
    api=value;const create=value.create;
    value.create=(...args)=>{if(${before})value.factories.composer=beforeComposer;return create(...args);};
   }});
  `});
  await p.route('**/personal/v1/ui/app.js',route=>route.fulfill({contentType:'text/javascript',body:readFileSync('src/personal-access-ui/app.js','utf8').replace('ui.loadAttachmentHasher =','globalThis.raceCore=core;ui.loadAttachmentHasher =')}));
  await p.waitForURL(f.origin+'/personal/v1/ui',{waitUntil:'load'});await p.goto(f.origin+'/personal/v1/ui');await p.waitForFunction(()=>globalThis.raceCore?.state.account&&raceCore.state.modelsKnown&&raceCore.state.sessions.length);await p.evaluate(id=>raceCore.selectSession(id),f.sessionId);await p.waitForFunction(()=>!raceCore.state.sessionSelecting);
  await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,800),width);
  await p.evaluate(theme=>WeftDesktop.setAppearance({theme}),theme);
  await p.evaluate(()=>{
   raceCore.stopAssistantRefresh();globalThis.raceHeld=false;globalThis.raceReceipt=null;
   const reconcile=raceCore.reconcileOptimistic,submit=raceCore.submitCommand;
   raceCore.reconcileOptimistic=command=>{if(command?.requestId===globalThis.raceRequest){globalThis.raceReceipt=command;return;}reconcile(command);};
   raceCore.submitCommand=async(...args)=>{if(args[0]!=='session.message')return submit(...args);globalThis.raceRequest=args[3];const result=await submit(...args);globalThis.raceHeld=true;await new Promise(done=>globalThis.raceRelease=done);return result;};
   document.querySelector('#message-text').value='请整理纸船计划的进展。';globalThis.raceSend=raceCore.sendDraft(undefined,undefined,true);
  });
  await p.waitForFunction(()=>raceHeld);
  await p.evaluate(()=>raceCore.refreshHistory(false,true));
  await p.waitForFunction(()=>[...raceCore.state.historyEvents.values()].some(e=>e.type==='user.message'&&e.data?.text==='请整理纸船计划的进展。'));
  await p.evaluate(()=>{
   const refresh=raceCore.refreshHistory;
   raceCore.refreshHistory=async(...args)=>{globalThis.raceHistoryHeld=true;await new Promise(done=>globalThis.raceHistoryRelease=done);return refresh(...args);};
   raceRelease();
  });
  await p.waitForFunction(()=>raceHistoryHeld);
  const count=await p.locator('#transcript .message').evaluateAll(rows=>rows.filter(row=>row.querySelector('.message-text')?.textContent.trim()==='请整理纸船计划的进展。').length);
  assert.equal(count,before?2:1);
  const file=`${before?'before':'after'}-electron-${width}-${theme}-o-history-before-ack.png`;await p.screenshot({path:join(out,file)});
  report.checks.push({file,visibleCopies:count,historyBeforeAcknowledgement:true,acknowledgementBeforeNextHistoryRead:true});
  await p.evaluate(async()=>{raceHistoryRelease();await raceSend;});console.log(file,count);
 }finally{await app?.close().catch(()=>{});await f.close();await rm(profile,{recursive:true,force:true});await rm(f.root,{recursive:true,force:true});}
}
await writeFile(join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');
