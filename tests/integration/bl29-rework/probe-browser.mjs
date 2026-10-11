import { outputPath } from './evidence.mjs';
import {chromium} from 'playwright';
import {writeFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {localUiSession} from '../../helpers/local-ui-session.mjs';
process.argv.push('--export-only');
const {startTimelineCandidate}=await import('./probe-server.mjs');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const f=await startTimelineCandidate({daily:true,inlineProgress:true,logicalMobile:true,sidebar:true,historyCount:0});let browser;
const report={errors:[],cases:[]};
try{
 const chat=(await f.request('/chats/main')).chat,host=(await f.request('/status')).hostId;
 if(!process.argv.includes('--empty-main')){
  const sent=await f.request('/commands',{requestId:'rev-browser',kind:'chat.message',chatId:chat.chatId,text:'synthetic browser',modelProfileId:'local',targetDeviceId:host});
  for(let i=0;i<100;i++){if((await f.request('/commands/'+sent.command.commandId)).command.state==='accepted_by_dsh')break;await pause(10);}
  f.progress.text('synthetic finished');f.progress.finish();
 }
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});
 page.on('pageerror',e=>report.errors.push(e.message));
 let failure=null,requests=[],delay=0,clientVersion='new',recovering=false,healthyAt=null;
 const oldFiles=execFileSync('git',['diff','--name-only','origin/main...HEAD','--','apps/mobile-ui/www'],{encoding:'utf8'}).trim().split('\n').filter(p=>p.endsWith('.js'));
 const oldSources=Object.fromEntries(oldFiles.map(p=>[p.replace('apps/mobile-ui/www/',''),execFileSync('git',['show','origin/main:'+p],{encoding:'utf8'})]));
 await page.route('**/*.js',route=>{const source=oldSources[new URL(route.request().url()).pathname.slice(1)];return clientVersion==='old'&&source!==undefined?route.fulfill({contentType:'text/javascript',body:source}):route.continue();});
 await page.route('**/bridge',async route=>{const m=JSON.parse(route.request().postData());
  if(m.method==='host.business'&&/\/changes\?/.test(m.params?.path||'')){requests.push({at:Date.now(),path:m.params.path});if(!failure&&recovering)healthyAt??=Date.now();if(failure)return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({error:{code:failure}})});}
  if(delay)await pause(delay);return route.continue();});
 await page.goto(f.mobileUrl);await page.waitForFunction(()=>state.booted&&state.loggedIn&&uiCore.state.mainChat);await page.evaluate(()=>uiCore.selectMainChat());await pause(1000);
 report.initial=await page.evaluate(()=>({main:uiCore.inMainChat(),wait:uiCore.canWaitForReply(),caps:uiCore.state.personalCapabilities,loading:state.sharedLoading}));
 for(const code of ['NOT_FOUND','CHAT_ARCHIVED','BACKEND_UNAVAILABLE','CURSOR_RESET_REQUIRED','UNAUTHORIZED','NETWORK','HTTP_502','HTTP_504']){
  recovering=false;healthyAt=null;failure=code;await page.reload();await page.waitForFunction(()=>state.booted&&state.loggedIn&&uiCore.state.mainChat);await page.evaluate(()=>uiCore.selectMainChat());requests=[];
  await page.evaluate(()=>{state.sharedLoading=false;state.sharedRunning=false;uiCore.state.submitting=false;uiCore.state.unresolvedSubmission=false;uiCore.presence.success({runtime:'ready'});scheduleSharedPoll();});
  const start=Date.now();await pause(3000);
  report.cases.push({client:'new',code,ms:Date.now()-start,requests:requests.length,rps:requests.length/((Date.now()-start)/1000),state:await page.evaluate(()=>({connection:uiCore.connectionView().kind,loading:state.sharedLoading,poll:!!state.sharedPollTimer})),intervals:requests.slice(1,10).map((r,i)=>r.at-requests[i].at)});
  if(!['NOT_FOUND','UNAUTHORIZED'].includes(code)){
   failure=null;recovering=true;const restored=Date.now();while(!healthyAt&&Date.now()-restored<2200)await pause(10);
   report.cases.at(-1).recoveredWaitMs=healthyAt?healthyAt-restored:null;
  }
  await page.evaluate(()=>stopSharedPoll());failure=null;recovering=false;await pause(150);
 }
 failure=null;await page.reload();await page.waitForFunction(()=>state.booted&&state.loggedIn&&uiCore.state.mainChat);await page.evaluate(()=>uiCore.selectMainChat());
 // Model/settings reads during healthy idle: capture all bridge methods for 31s.
 const all=[];page.on('request',r=>{if(r.url().endsWith('/bridge')){const m=JSON.parse(r.postData());all.push({method:m.method,path:m.params?.path});}});
 await page.evaluate(()=>{uiCore.presence.success({runtime:'ready'});state.sharedLoading=false;scheduleSharedPoll();});await pause(31000);await page.evaluate(()=>stopSharedPoll());
 report.idleMethods=Object.fromEntries([...new Set(all.map(r=>r.method+' '+(r.path||'')))].map(k=>[k,all.filter(r=>r.method+' '+(r.path||'')===k).length]));
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});const hiddenAt=all.length;await pause(10000);report.background10s=all.slice(hiddenAt);await page.evaluate(()=>{delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));});await pause(300);
 // Latency uses probe-latency.mjs: a new user turn and visible final reply.
 delay=0;
 if(!process.argv.includes('--budget-only')){
 clientVersion='old';await page.reload();await page.waitForFunction(()=>state.booted&&state.loggedIn&&uiCore.state.mainChat);await page.evaluate(()=>uiCore.selectMainChat());await pause(500);
 for(const code of ['NOT_FOUND','CHAT_ARCHIVED','BACKEND_UNAVAILABLE','CURSOR_RESET_REQUIRED','UNAUTHORIZED','NETWORK','HTTP_502','HTTP_504']){
  failure=code;await page.reload();await page.waitForFunction(()=>state.booted&&state.loggedIn&&uiCore.state.mainChat);await page.evaluate(()=>uiCore.selectMainChat());requests=[];
  await page.evaluate(()=>{state.sharedLoading=false;state.sharedRunning=false;uiCore.state.submitting=false;uiCore.state.unresolvedSubmission=false;uiCore.presence.success({runtime:'ready'});scheduleSharedPoll();});
  const start=Date.now();await pause(3000);await page.evaluate(()=>stopSharedPoll());report.cases.push({client:'old',code,ms:Date.now()-start,requests:requests.length,rps:requests.length/((Date.now()-start)/1000)});failure=null;await pause(150);
 }
 await page.close();report.config=[];
 const originalModels=f.debug.backend.listModels;
 for(const version of ['main','head']){
  f.debug.backend.listModels=originalModels;await f.request('/settings/personalization',{nextSuggestionsEnabled:true},'PATCH');
  const desktop=await browser.newPage();const reads=[];
  desktop.on('request',r=>{if(/\/models|\/settings\/personalization/.test(r.url()))reads.push(new URL(r.url()).pathname);});
  await desktop.route('**/personal/v1/ui/**/*.js',route=>{const p=new URL(route.request().url()).pathname.split('/ui/')[1],file=p.startsWith('ui-core/')?'src/'+p:'src/personal-access-ui/'+p;
   let source=version==='main'?execFileSync('git',['show','origin/main:'+file],{encoding:'utf8'}):readFileSync(file,'utf8');source=source.replace('ui.loadAttachmentHasher =','globalThis.__revCore=core;ui.loadAttachmentHasher =');return route.fulfill({contentType:'text/javascript',body:source});});
  await desktop.goto(f.origin+'/personal/v1/ui');await localUiSession(desktop,f.credentials,'synthetic-config',{interceptLegacyStatus:false,mainChat:true});
  await desktop.waitForFunction(()=>globalThis.__revCore?.state.models.length&&!__revCore.state.refreshing);
  reads.length=0;f.debug.backend.listModels=async()=>[...await originalModels(),{id:'added-model',name:'synthetic added model',model:'synthetic',configured:true}];await f.request('/settings/personalization',{nextSuggestionsEnabled:false},'PATCH');
 await pause(7100);report.config.push({version,reads,state:await desktop.evaluate(()=>({models:__revCore.state.models.map(m=>m.id),suggestions:__revCore.state.personalization.nextSuggestionsEnabled}))});await desktop.close();
 }
 }
}catch(e){report.failure=e.stack;throw e;}finally{writeFileSync(outputPath('browser.json'),JSON.stringify(report,null,2));await browser?.close();await f.close();rmSync(f.root,{recursive:true,force:true});}
console.log(JSON.stringify(report,null,2));
