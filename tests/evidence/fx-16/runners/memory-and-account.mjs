import assert from 'node:assert/strict';
import {_electron,chromium} from 'playwright';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {startTimelineCandidate} from './candidate.mjs';
import {localUiSession} from '../../../../tests/helpers/local-ui-session.mjs';
const out=resolve(process.env.FX16_ACCOUNT_OUT||'tests/evidence/fx-16'),report={androidNative:process.env.FX16_MERGE_RECHECK?'Not rerun during merge closeout; Chromium package verification only':'MuMu ADB 127.0.0.1:7555 refused connection; existing MuMu services left untouched',androidPackageChromium:true,phoneSize:{width:390,height:844},checks:[]};
let f,browser,app,profile;
try{
 f=await startTimelineCandidate({daily:true,sidebar:true,logicalMobile:true,inlineProgress:true,interactive:true,historyCount:0});
 await f.request('/auth/profile',{expectedRevision:0,displayName:'合成执行者'},'PATCH');
 const guest={username:'FX16Guest',password:'synthetic-'+randomUUID(),deviceName:'FX16 guest'};
 const registered=await f.request('/auth/register',guest),ownerId=registered.account.ownerId;
 profile=await mkdtemp(join(tmpdir(),'weftmate-fx16-account-'));
 const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['scripts/review-gallery/electron.mjs'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:f.origin,REVIEW_THEME:'light'}});
 const desktop=await app.firstWindow();await localUiSession(desktop,guest,'FX16 guest desktop',{mainChat:true});await desktop.locator('#assistant-view').waitFor({state:'visible'});
 const expected='这台电脑由账号 合成执行者 负责执行；当前账号只能聊天。切回 合成执行者 或在 合成执行者 的设置里移交。';
 await desktop.getByText(expected,{exact:true}).waitFor();await desktop.screenshot({path:join(out,'desktop-second-account.png')});
 if(process.env.FX16_MERGE_RECHECK){for(const theme of ['light','dark']){await desktop.emulateMedia({colorScheme:theme});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(480,800));await desktop.screenshot({path:join(out,'desktop-480-'+theme+'.png')});}}
 const status=await desktop.evaluate(async()=>await(await fetch('/personal/v1/status')).json());assert.equal(status.executionAccount,false);assert.equal(status.executionAccountName,'合成执行者');
 report.checks.push({name:'second-account-real-api-desktop',executionAccount:false,nickname:status.executionAccountName,hint:expected});
 browser=await chromium.launch();const phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await phone.goto(f.origin+'/personal/v1/ui');await localUiSession(phone,guest,'FX16 guest phone',{mainChat:true});await phone.getByText(expected,{exact:true}).waitFor();await phone.screenshot({path:join(out,'phone-second-account.png')});report.checks.push({name:'second-account-real-api-phone-web',hint:expected});
 if(process.env.FX16_MERGE_RECHECK){for(const [width,height] of [[360,780],[390,844]])for(const theme of ['light','dark']){await phone.setViewportSize({width,height});await phone.emulateMedia({colorScheme:theme});await phone.screenshot({path:join(out,`phone-${width}-${theme}.png`)});}}
 const packaged=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const calls=[];
 await packaged.route('**/bridge',async route=>{
  const input=route.request().postDataJSON();let result;
  if(input.method==='host.business'&&input.params.path.startsWith('/personal/v1/memory/')){
   calls.push({path:input.params.path,method:input.params.method});
   if(input.params.path==='/personal/v1/memory/status')result={ownerId,state:'ready',worldRevision:1,capabilities:{list:true,source:true},health:{state:'healthy'},backfill:null};
   else if(input.params.path==='/personal/v1/memory/backfill')result={previewId:'synthetic-preview',sessionCount:0,turnCount:0,estimatedUsage:{inputTokens:0,outputTokens:0}};
   else result={ownerId,worldRevision:1,searchScope:'account_snapshot',items:[],nextCursor:null,hasMore:false};
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({result})});
  }
  if(input.method==='host.status'){result=await f.request('/status');result.executionAccount=false;result.executionAccountName='合成执行者';return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({result})});}
  return route.continue();
 });
 await packaged.goto(f.mobileUrl);await packaged.waitForFunction(()=>typeof memoryIngestionPanel==='function'&&state.loggedIn&&state.booted);
 await packaged.evaluate(()=>page('memory'));await packaged.getByRole('button',{name:'整理过去的对话',exact:true}).click();
 await packaged.getByText('过去的对话已全部整理，没有需要补的回合。',{exact:true}).waitFor();
 assert.ok(calls.some(row=>row.path==='/personal/v1/memory/backfill'&&row.method==='GET'));
 const scope=await packaged.evaluate(()=>({globalBusiness:typeof business,adapterBusiness:typeof uiCore.mobile.business}));assert.equal(scope.globalBusiness,'undefined');assert.equal(scope.adapterBusiness,'function');
 await packaged.screenshot({path:join(out,'android-package-memory-preview.png')});
 if(process.env.FX16_MERGE_RECHECK){await packaged.evaluate(()=>applyTheme('dark'));await packaged.screenshot({path:join(out,'android-package-memory-preview-dark.png')});await packaged.evaluate(()=>applyTheme('light'));}
 await packaged.evaluate(()=>page('chat'));await packaged.getByText(expected,{exact:true}).waitFor();await packaged.screenshot({path:join(out,'android-package-second-account.png')});
 report.checks.push({name:'android-package-memory-preview',emptyCopy:'过去的对话已全部整理，没有需要补的回合。',calls,scope},{name:'android-package-account-hint',hint:expected});
 report.passed=true;
}catch(error){if(browser){report.bodies=await Promise.all(browser.contexts().flatMap(c=>c.pages()).map(async p=>({url:p.url(),text:await p.locator('body').innerText().catch(()=>null),memory:await p.evaluate(()=>typeof state==='object'?state.memory:null).catch(()=>null)})));}report.error=error.stack;throw error;}finally{await app?.close();await browser?.close();await f?.close();if(profile)await rm(profile,{recursive:true,force:true});if(f?.root)await rm(f.root,{recursive:true,force:true});report.cleaned=true;await writeFile(join(out,'memory-and-account.json'),JSON.stringify(report,null,2));}
