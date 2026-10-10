import assert from 'node:assert/strict';
import {_electron,chromium} from 'playwright';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {startTimelineCandidate} from '../../fx-16/runners/candidate.mjs';
import {localUiSession} from '../../../helpers/local-ui-session.mjs';
const before=process.argv.includes('--before'),out=resolve('tests/evidence/fx-20');
const f=await startTimelineCandidate({historyCount:0,interactive:true,riskApproval:true});let app,browser;const report={};
try{
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:['tests/integration/desktop-ui-1.cjs',f.origin+'/personal/v1/ui/'],cwd:resolve('.'),env});
 const desktop=await app.firstWindow();browser=await chromium.launch();const phone=await browser.newPage({viewport:{width:390,height:844}});
 for(const [name,page,url]of [['desktop',desktop,f.origin+'/personal/v1/ui/'],['mobile',phone,f.mobileUrl]]){
  await page.addInitScript(()=>{window.setInterval=()=>0});
  if(before)await page.route('**/*.js',async route=>{const url=new URL(route.request().url());let path=url.pathname.startsWith('/personal/v1/ui/')?'src/personal-access-ui/'+url.pathname.slice('/personal/v1/ui/'.length):'apps/mobile-ui/www/'+url.pathname.slice(1);if(path.includes('/ui-core/'))path='src/ui-core/'+path.split('/ui-core/')[1];if(path.endsWith('/bridge.js')){await route.continue();return;}try{const body=execFileSync('git',['show','8df312ccb25215276287fafdbfd8caa9aa7492d1:'+path],{maxBuffer:10000000,stdio:['ignore','pipe','ignore']});await route.fulfill({body,contentType:'text/javascript'});}catch{await route.continue();}});
  if(name==='desktop'){
   await page.route('**/personal/v1/ui/app.js',async route=>{const response=await route.fetch();const body=before?execFileSync('git',['show','8df312ccb25215276287fafdbfd8caa9aa7492d1:src/personal-access-ui/app.js'],{encoding:'utf8'}):await response.text();await route.fulfill({response,body:body.replace('    ui.loadAttachmentHasher',`    globalThis.fxCore=core;globalThis.fxUi=ui;globalThis.startupApiCounts={};
    const startupRequest=core.requestJson;core.requestJson=(path,...args)=>{const key=new URL(path,location.href).pathname;startupApiCounts[key]=(startupApiCounts[key]||0)+1;return startupRequest(path,...args)};
    const startupEnter=core.enterAssistant;core.enterAssistant=(...args)=>{startupApiCounts={};globalThis.startupStarted=true;globalThis.startupEntrance=startupEnter(...args);return startupEntrance;};
    const startupStart=core.startConnection;core.startConnection=callback=>startupStart(async()=>{globalThis.startupRecovery=callback();await startupRecovery;});
    ui.loadAttachmentHasher`)});});
   await localUiSession(page,f.credentials);await page.waitForFunction(()=>globalThis.startupStarted&&globalThis.fxCore?.state.account&&!fxCore.state.refreshing);
   await page.evaluate(async()=>{await startupEntrance;await globalThis.startupRecovery;fxCore.stopAssistantRefresh();fxCore.stopConnection();await fxCore.conversationTasks.inFlight?.promise;});
   report[name]=await page.evaluate(()=>startupApiCounts);
   if(!before){for(const [path,count]of Object.entries(report[name]))assert.equal(count,1,`desktop ${path}`);await page.evaluate(()=>{const button=document.querySelector('[data-conversation-approval-action="allowed-once"]');if(!button)throw Error('missing real desktop approval');fxCore.state.historyGeneration++;fxUi.renderConversationApprovals();if(document.querySelector('[data-conversation-approval-action="allowed-once"]')!==button)throw Error('unchanged desktop approval replaced');});}
  }else{
   await page.route('**/bridge',async route=>{const request=route.request().postDataJSON();report.mobile??={};const key=request.method+(request.method==='host.business'?':'+request.params.path:'');report.mobile[key]=(report.mobile[key]||0)+1;await route.continue();});
   await page.goto(url);await page.waitForFunction(()=>state.booted&&state.loggedIn);await page.evaluate(()=>{stopSharedPoll();uiCore.stopConnection();clearTimeout(state.homePollTimer)});
   report.mobileToast=await page.locator('#toast').textContent();
   if(!before){assert.doesNotMatch(report.mobileToast,/连接已恢复/);for(const [method,count]of Object.entries(report.mobile))if(method!=='settings.appearance')assert.equal(count,1,`mobile ${method}`);}
  }
  await page.screenshot({path:resolve(out,`${before?'before':'after'}-${name}.png`)});
 }
 console.log(JSON.stringify(report,null,2));await writeFile(resolve(out,`${before?'before':'after'}-startup.json`),JSON.stringify(report,null,2));
}finally{await app?.close();await browser?.close();await f.close();}
