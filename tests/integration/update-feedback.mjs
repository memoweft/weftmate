// Production renderer/preload, independent Electron identity, synthetic update IPC.
import assert from 'node:assert/strict';
import {_electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {managedMkdtempSync,disposeManagedTemp} from '../helpers/managed-temp.mjs';
import {evidencePath} from '../helpers/evidence-path.mjs';
import {startFixture} from './ux-4-fixture.mjs';
import {feedbackUiSession} from '../helpers/feedback-ui-session.mjs';
const output=process.env.WEFTMATE_UPDATE_FEEDBACK_OUTPUT||evidencePath('update-feedback');
await mkdir(output,{recursive:true});
const profile=managedMkdtempSync('weftmate-update-feedback-',{prune:false});
const bootstrap=join(profile,'update-feedback-shell.mjs');
await writeFile(bootstrap,`import{createRequire}from'node:module';const{app}=createRequire(${JSON.stringify(new URL('../../package.json',import.meta.url).href)})('electron');app.setName('WeftMate Update Feedback Test');app.setAppUserModelId('com.memoweft.weftmate.test.updatefeedback');app.disableHardwareAcceleration();await import(${JSON.stringify(new URL('../../scripts/review-gallery/electron.mjs',import.meta.url).href)});`);
let app,page,fixture;
const legacyReason='更新尚未就绪、任务仍在运行或更新前备份未完成，请稍后重试';
const backupReason='更新前备份未完成，暂未开始安装。当前程序继续运行，请稍后重试。';
const report={scope:'synthetic preload/IPC only; no actual backup, installer or daily data',checks:[],samples:[],errors:[]};
const capture=async name=>{
  await page.evaluate(async()=>{for(let n=0;n<2;n++){for(const a of document.getAnimations())if(Number.isFinite(a.effect.getTiming().iterations))a.finish();await new Promise(requestAnimationFrame);}});
  const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'));
  await writeFile(join(output,name+'.png'),Buffer.from(png,'base64'));
};
const open=async()=>{await page.evaluate(()=>WeftSettingsNavigation.open('about'));await page.locator('.settings-category[data-category=about]').waitFor();};
const button=()=>page.locator('.settings-update-actions > button');
const status=()=>page.locator('#settings-update-attempt');
const calls=()=>app.evaluate(()=>__feedbackProbe.calls);
const mode=(mode,result)=>app.evaluate((_electron,{mode,result})=>{__feedbackProbe.mode=mode;if(result)__feedbackProbe.result=result;},{mode,result});
const release=result=>app.evaluate((_electron,result)=>__feedbackProbe.pending.resolve(result),result);
const refresh=()=>page.getByRole('button',{name:'检查更新',exact:true}).click();
async function poll(){const before=await app.evaluate(()=>__feedbackProbe.reads);await app.evaluate(async(_electron,before)=>{const deadline=Date.now()+6000;while(__feedbackProbe.reads<=before){if(Date.now()>deadline)throw Error('No update-state poll');await new Promise(r=>setTimeout(r,20));}},before);}
async function visible(text){
  await page.waitForFunction(text=>{const e=document.querySelector('#settings-update-attempt');if(!e||e.hidden||!e.textContent.includes(text))return false;const r=e.getBoundingClientRect(),p=e.closest('.settings-category').getBoundingClientRect();return r.height>0&&r.top>=p.top-1&&r.bottom<=Math.min(p.bottom,innerHeight)+1;},text);
}
async function sample(name){
  await capture(name);
  const data=await page.evaluate(()=>{const e=document.querySelector('#settings-update-attempt'),b=document.querySelector('.settings-update-actions > button'),p=b.closest('.settings-category'),box=n=>{const r=n.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height};};return {text:e?.textContent,role:e?.getAttribute('role'),status:e?box(e):null,button:box(b),panel:box(p),disabled:b.disabled,label:b.textContent,overflow:p.scrollWidth>p.clientWidth};});
  report.samples.push({name,calls:await calls(),...data});assert.equal(data.overflow,false);assert.ok(data.button.top>=data.panel.top-1&&data.button.bottom<=data.panel.bottom+1,'status and update button remain in the same viewport');
}
try{
  fixture=await startFixture();const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
  Object.assign(env,{REVIEW_PROFILE:profile,REVIEW_ORIGIN:fixture.origin,REVIEW_LIBRARY_TOKEN:fixture.libraryDesktopToken,REVIEW_THEME:'light',REVIEW_HIDDEN:'1',WEFTMATE_TEST_HOST_NAME:'synthetic-update-feedback'});
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:[bootstrap,'--disable-backgrounding-occluded-windows','--disable-features=CalculateNativeWinOcclusion'],env,timeout:30000});
  page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(e.message));
  await app.evaluate(({ipcMain},{legacyReason})=>{
    globalThis.__feedbackProbe={reads:0,calls:0,mode:'hold',result:{restarted:false,reason:legacyReason},state:{layers:[{layer:'ui',currentVersion:'0.2.0-preview.25',status:'checking',error:null},{layer:'app',currentVersion:'0.2.0-preview.21',availableVersion:'0.2.0-preview.25',version:'0.2.0-preview.25',status:'downloaded',error:null,releaseNotes:'合成更新内容与完整说明。'.repeat(220)}],channel:'preview',canRestart:true,manualInstall:false,canChangeChannel:true}};
    for(const name of ['wm:desktop:update-state','wm:desktop:update-check','wm:desktop:update-restart'])ipcMain.removeHandler(name);
    for(const name of ['wm:desktop:update-state','wm:desktop:update-check'])ipcMain.handle(name,()=>{__feedbackProbe.reads++;return structuredClone(__feedbackProbe.state);});
    ipcMain.handle('wm:desktop:update-restart',()=>{__feedbackProbe.calls++;if(__feedbackProbe.mode==='hold')return new Promise((resolve,reject)=>{__feedbackProbe.pending={resolve,reject};});if(__feedbackProbe.mode==='reject')throw Error('C:\\Synthetic\\private credential=synthetic-only');return structuredClone(__feedbackProbe.result);});
  },{legacyReason});
  await app.evaluate(async()=>{await __reviewDesktop.ready;return true;});await page.goto(fixture.origin+'/personal/v1/ui');await feedbackUiSession(page,fixture,{native:true});await page.evaluate(()=>WeftReplyMotion.setVisibility(false));
  await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.showInactive();win.webContents.setBackgroundThrottling(false);});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(900,700));
  await open();await button().waitFor();await page.locator('[data-update-layer=app] .settings-update-notes > summary').click();
  report.setupAnimations=await page.evaluate(()=>document.getAnimations().map(a=>({target:a.effect.target?.className,state:a.playState,time:a.currentTime,duration:a.effect.getTiming().duration})));
  await capture('expanded-content-ready');await button().scrollIntoViewIfNeeded();
  await button().click();await page.waitForFunction(()=>document.querySelector('.settings-update-actions > button').disabled);
  assert.equal(await status().count(),1,'pending update has an action-area status');await visible('正在准备更新');assert.match(await button().innerText(),/准备/);assert.equal(await calls(),1);
  await button().evaluate(b=>b.dispatchEvent(new MouseEvent('click',{bubbles:true})));assert.equal(await calls(),1,'duplicate click cannot dispatch another native IPC');
  await poll();await visible('正在准备更新');assert.equal(await button().isDisabled(),true);await sample('pending-light-bottom');
  await release({restarted:false,reason:legacyReason});await visible(legacyReason);assert.equal(await status().getAttribute('role'),'alert');assert.equal(await button().isEnabled(),true);await sample('legacy-false-light-bottom');
  await poll();await visible(legacyReason);await refresh();assert.equal(await status().innerText(),legacyReason);await button().scrollIntoViewIfNeeded();await visible(legacyReason);
  await page.locator('.settings-category[data-category=about]').evaluate(p=>p.scrollTop=0);await page.getByRole('button',{name:'关闭设置',exact:true}).click();await open();await visible(legacyReason);await sample('legacy-false-reopened');
  assert.equal(await calls(),1,'polls, checks and reopening never resend the install request');
  report.checks.push('pending is visible, disabled and single IPC; legacy false survives poll/check/reopen at bottom');
  await mode('hold');await button().click();await visible('正在准备更新');assert.equal((await status().innerText()).includes(legacyReason),false);
  await app.evaluate(()=>__feedbackProbe.pending.reject(Error('C:\\Synthetic\\private credential=synthetic-only')));await visible('更新请求未完成');assert.doesNotMatch(await status().innerText(),/Synthetic|credential|private/);await sample('reject-safe');
  await mode('false',{restarted:false,stage:'backup',code:'BACKUP_PAUSE_TIMEOUT',reason:backupReason});await button().click();await visible(backupReason);await poll();await visible(backupReason);await sample('backup-reason');
  await mode('false',{restarted:true});const beforeTrue=await calls();report.beforeAcceptedCalls=beforeTrue;await button().click();await visible('重启请求');assert.doesNotMatch(await status().innerText(),/已安装|安装成功|更新成功|更新完成/);
  await button().evaluate(b=>b.dispatchEvent(new MouseEvent('click',{bubbles:true})));await poll();assert.equal(await calls(),beforeTrue+1);assert.equal(await button().isDisabled(),true);assert.equal(await button().innerText(),'正在重启…');await sample('restart-requested');
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();await open();await visible('重启请求');await button().evaluate(b=>b.dispatchEvent(new MouseEvent('click',{bubbles:true})));assert.equal(await calls(),beforeTrue+1);assert.equal(await button().isDisabled(),true);await sample('restart-requested-reopened');
  report.checks.push('new attempt clears old failure; reject is bounded; optional backup metadata; accepted restart stays locked through repeated clicks/poll/reopen without installation claims');
  await app.evaluate(()=>{__feedbackProbe.state.layers[1].availableVersion=__feedbackProbe.state.layers[1].version='0.2.0-preview.26';});await refresh();await page.waitForFunction(()=>document.querySelector('#settings-update-attempt').hidden);
  assert.equal(await button().isEnabled(),true);await mode('false',{restarted:false,reason:legacyReason});await button().click();await visible(legacyReason);
  await app.evaluate(()=>{__feedbackProbe.state.layers[1].availableVersion=__feedbackProbe.state.layers[1].version='0.2.0-preview.27';});await refresh();await page.waitForFunction(()=>document.querySelector('#settings-update-attempt').hidden);
  await mode('hold');await button().click();await visible('正在准备更新');const beforeTargetChange=await calls();
  await app.evaluate(()=>{__feedbackProbe.state.layers[1].availableVersion=__feedbackProbe.state.layers[1].version='0.2.0-preview.28';});await refresh();
  await button().evaluate(b=>b.dispatchEvent(new MouseEvent('click',{bubbles:true})));assert.equal(await calls(),beforeTargetChange);
  await release({restarted:false,reason:'旧目标的合成错误'});await page.waitForFunction(()=>!document.querySelector('.settings-update-actions > button').disabled);assert.equal(await status().isHidden(),true);
  await mode('hold');await button().click();await visible('正在准备更新');
  await page.evaluate(()=>{__feedbackSessionCore.state.identityGeneration++;WeftSettingsNavigation.open('general');WeftSettingsNavigation.open('about');});
  await release({restarted:false,reason:'旧身份的合成错误'});await page.waitForFunction(()=>!document.querySelector('.settings-update-actions > button').disabled);assert.equal(await status().isHidden(),true);
  report.checks.push('target and synthetic identity generation changes discard late feedback and preserve one in-flight IPC');
  for(const [width,height]of [[900,700],[620,760],[520,640]])for(const theme of ['light','dark']){
    await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows()[0].setContentSize(width,height),{width,height});await page.evaluate(theme=>WeftDesktop.setAppearance({theme}),theme);
    await mode('false',{restarted:false,reason:legacyReason});await button().click();await visible(legacyReason);await sample(`${width}-${theme}-failure-bottom`);
  }
  await app.evaluate(()=>{Object.assign(__feedbackProbe.state.layers[1],{currentVersion:__feedbackProbe.state.layers[1].availableVersion,availableVersion:null,version:null,status:'current'});__feedbackProbe.state.canRestart=false;});await refresh();await page.waitForFunction(()=>document.querySelector('.settings-update-actions').hidden);assert.equal(await status().isHidden(),true);
  report.checks.push('wide/narrow light/dark errors remain in view; confirmed current-version change clears the attempt');assert.deepEqual(report.errors,[]);
}catch(error){report.failure=error.stack;report.nativeCalls=await calls().catch(()=>null);if(page){report.failureState=await page.evaluate(()=>{const e=document.querySelector('#settings-update-attempt'),b=document.querySelector('.settings-update-actions > button'),box=n=>{const r=n.getBoundingClientRect();return{top:r.top,bottom:r.bottom,height:r.height,hidden:n.hidden,display:getComputedStyle(n).display,scrollTop:n.scrollTop};};return {text:e?.textContent,status:e&&box(e),actions:e&&box(e.closest('.settings-update-actions')),button:b&&{...box(b),label:b.textContent,disabled:b.disabled},panels:[...document.querySelectorAll('.settings-category[data-category=about]')].map(box),innerHeight};}).catch(()=>null);await capture('failure').catch(()=>{});}throw error;}
finally{await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));await app?.close();await fixture?.close();disposeManagedTemp(profile,{log(){}});}
console.log(JSON.stringify({checks:report.checks,samples:report.samples.length,errors:report.errors}));
