import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
const root=resolve(import.meta.dirname,'../..'),evidence=join(root,'tests/evidence/ux-3');mkdirSync(evidence,{recursive:true});
const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
const checks=[],errors=[];
for(const theme of ['light','dark']){
 const fixture=await startTimelineCandidate({inlineProgress:true,interactive:true,composer:true,composerMenu:true,historyCount:0,baseTime:Date.now()-15000});
 fixture.progress.call('subagent','subtask-read',{description:'核对资料',prompt:'合成任务'});fixture.progress.result('subtask-read','started subagent synthetic-child');
 fixture.progress.call('subagent','subtask-test',{description:'运行测试',prompt:'合成任务'});fixture.progress.result('subtask-test','测试通过');
 fixture.progress.call('subagent','subtask-fail',{description:'检查链接',prompt:'合成任务'});fixture.progress.result('subtask-fail','合成错误',true);
 const profile=mkdtempSync(join(tmpdir(),'weftmate-ux-3-'));let app,browser;
 try{
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:root,args:['scripts/review-gallery/electron.mjs','--force-device-scale-factor=1'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:fixture.origin,REVIEW_THEME:theme}});
  const desktop=await app.firstWindow();await localUiSession(desktop,fixture.credentials);
  browser=await chromium.launch({headless:true,channel:'chrome'});
  const remote=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await remote.goto(fixture.origin+'/personal/v1/ui');await localUiSession(remote,fixture.credentials);
  const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});mobile.on('pageerror',error=>errors.push(error.message));await mobile.goto(fixture.mobileUrl);await mobile.getByRole('button',{name:/^项目进度报告.*正在运行$/}).click();
  for(const [surface,page]of [['desktop',desktop],['mobile-web',remote],['android-ui',mobile]]){
   console.log('surface',surface,theme);page.on('pageerror',error=>errors.push(error.message));await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   const shot=async name=>page.screenshot({path:join(evidence,`${surface}-${theme}-${name}.png`)});
   const input=page.getByRole('textbox',{name:'输入消息',exact:true});await input.waitFor();
   assert.equal(await input.getAttribute('placeholder'),'排队到下一条…');
   await page.getByRole('button',{name:'添加图片或文件',exact:true}).click();
   await page.getByRole('menuitemcheckbox',{name:'深入思考',exact:true}).waitFor();await shot('menu');
   if(surface==='desktop') {await page.getByRole('menuitem',{name:'截图',exact:true}).waitFor();await page.getByRole('menuitem',{name:'粘贴剪贴板图片',exact:true}).waitFor();}
   else{await page.getByRole('menuitem',{name:'相机',exact:true}).waitFor();await page.getByRole('menuitem',{name:'照片',exact:true}).waitFor();}
   await page.getByRole('menuitemcheckbox',{name:'深入思考',exact:true}).click();
   await page.getByLabel('已开启深入思考',{exact:true}).waitFor();await shot('thinking');
   assert.equal((await fixture.request(`/sessions/${fixture.sessionId}/thinking`)).enabled,true);
   await page.getByRole('button',{name:'添加图片或文件',exact:true}).click();
   await page.getByRole('menuitemcheckbox',{name:'深入思考',exact:true}).waitFor();
   assert.equal(await page.getByRole('menuitemcheckbox',{name:'深入思考',exact:true}).getAttribute('aria-checked'),'true');
   await page.keyboard.press('Escape');
   await page.getByRole('button',{name:'3 个子任务',exact:true}).click();
   const list=page.getByRole('dialog',{name:'当前回合子任务',exact:true});await list.waitFor();
   await page.getByRole('button',{name:/核对资料，进行中.*查看步骤/}).waitFor();
   await page.getByRole('button',{name:/运行测试，完成.*查看步骤/}).waitFor();
   await page.getByRole('button',{name:/检查链接，失败.*查看步骤/}).waitFor();await shot('subtasks');
   await page.getByRole('button',{name:/核对资料，进行中.*查看步骤/}).click();
   assert.equal(await page.getByText('交给子任务：核对资料',{exact:false}).first().evaluate(node=>node.closest('details').open),true);
   await shot('step');
   if(surface==='desktop'){
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(480,600));
    await page.getByRole('button',{name:'添加图片或文件',exact:true}).click();await shot('narrow');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.keyboard.press('Escape');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1200,800));
   }
   if(surface==='desktop'){
    // Synthetic clipboard reader in the isolated Electron process; system clipboard is untouched.
    await app.evaluate(({clipboard,nativeImage})=>{globalThis.ux3ClipboardRead=clipboard.readImage;
      clipboard.readImage=()=>nativeImage.createFromBitmap(Buffer.from([255,255,255,255]),{width:1,height:1});});
    try{await page.getByRole('button',{name:'添加图片或文件',exact:true}).click();await page.getByRole('menuitem',{name:'粘贴剪贴板图片',exact:true}).click();await page.getByText('剪贴板图片.png',{exact:true}).waitFor();await shot('clipboard');await page.getByRole('button',{name:'移除文件 剪贴板图片.png',exact:true}).click();}
    finally{await app.evaluate(({clipboard})=>{clipboard.readImage=globalThis.ux3ClipboardRead;delete globalThis.ux3ClipboardRead;});}
   }
   if(surface==='desktop'){
    await app.evaluate(({desktopCapturer,BrowserWindow,screen})=>{globalThis.ux3Sources=desktopCapturer.getSources;
      desktopCapturer.getSources=async()=>[{display_id:String(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id),thumbnail:await BrowserWindow.getAllWindows()[0].webContents.capturePage()}];});
    try{
     const popup=app.waitForEvent('window');await page.getByRole('button',{name:'添加图片或文件',exact:true}).click();await page.getByRole('menuitem',{name:'截图',exact:true}).click();
     const selection=await popup;await selection.getByRole('button',{name:'添加截图',exact:true}).waitFor();
     await selection.keyboard.press('ArrowRight');await selection.keyboard.press('Shift+ArrowLeft');await selection.getByRole('button',{name:'添加截图',exact:true}).click();
     await page.getByText('屏幕截图.png',{exact:true}).waitFor();await shot('screenshot-region');await page.getByRole('button',{name:'移除文件 屏幕截图.png',exact:true}).click();
     const cancelPopup=app.waitForEvent('window');await page.getByRole('button',{name:'添加图片或文件',exact:true}).click();await page.getByRole('menuitem',{name:'截图',exact:true}).click();
     const cancelPage=await cancelPopup;await cancelPage.getByRole('button',{name:'取消截图',exact:true}).click();
    }finally{await app.evaluate(({desktopCapturer})=>{desktopCapturer.getSources=globalThis.ux3Sources;delete globalThis.ux3Sources;});}
   }
   checks.push({surface,theme,menu:true,thinkingSaved:true,subtaskStates:true,stepNavigation:true,noOverflow:true});
   await fixture.request(`/sessions/${fixture.sessionId}/thinking`,{enabled:false},'PATCH');
  }
  fixture.progress.notice({kind:'subagent-settled',form:'notice',senderSessionId:'synthetic-child',summary:'Background subagent synthetic-child finished and will do no further work unless you send it more.'},'Background subagent synthetic-child finished and will do no further work unless you send it more.');
  for(const page of [desktop,remote,mobile])await page.getByRole('button',{name:'3 个子任务',exact:true}).waitFor({state:'hidden'});
 }finally{await browser?.close();await app?.close();await fixture.close();rmSync(fixture.root,{recursive:true,force:true});rmSync(profile,{recursive:true,force:true});}
}
assert.deepEqual(errors,[]);writeFileSync(join(evidence,'checks.json'),JSON.stringify({syntheticOnly:true,checks,errors},null,2)+'\n');
console.log('UX-3',checks.length,'surface/theme checks passed');
