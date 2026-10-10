// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
const evidence=resolve('tests/evidence/st-1');mkdirSync(evidence,{recursive:true});
const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
const checks=[],errors=[];let fixture,app,browser,profile;
async function settings(page,surface,category){
 if(surface==='android-ui'){
  if(await page.getByRole('heading',{name:/^(个性化|助手)$/,exact:true}).isVisible().catch(()=>false))await page.getByRole('button',{name:'返回',exact:true}).click();
  else { if(await page.getByRole('button',{name:'返回',exact:true}).isVisible().catch(()=>false)) await page.getByRole('button',{name:'返回',exact:true}).click();await page.getByRole('button',{name:'设置与账户',exact:true}).click(); }
  await page.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:new RegExp('^'+category)}).click();
 }else{
  if(!(await page.getByRole('dialog',{name:'设置',exact:true}).isVisible())){
   if(!(await page.getByRole('button',{name:'账户菜单',exact:true}).isVisible().catch(()=>false)))await page.getByRole('button',{name:'切换会话侧栏',exact:true}).click();
   await page.getByRole('button',{name:'账户菜单',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();
  }
  if(surface==='mobile-web'){await page.getByRole('combobox',{name:'设置分类',exact:true}).click();await page.getByRole('option',{name:'设置 · '+category,exact:true}).click();}
  else await page.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:category,exact:true}).click();
 }
 await page.getByText('已同步 · 从下一次回复开始生效',{exact:true}).filter({visible:true}).waitFor();
}
try{
 fixture=await startTimelineCandidate({inlineProgress:true,interactive:true,composer:true,composerMenu:true,historyCount:0,baseTime:Date.now()-15000});
 profile=mkdtempSync(join(tmpdir(),'weftmate-st1-ui-'));
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['scripts/review-gallery/electron.mjs'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:fixture.origin,REVIEW_THEME:'light'}});
 const desktop=await app.firstWindow();await localUiSession(desktop,fixture.credentials);
 browser=await chromium.launch({headless:true,channel:'chrome'});
 const web=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await web.goto(fixture.origin+'/personal/v1/ui');await localUiSession(web,fixture.credentials);
 const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await mobile.goto(fixture.mobileUrl);await mobile.getByRole('button',{name:/^项目进度报告.*正在运行$/}).click();
 for(const [surface,page] of [['desktop',desktop],['mobile-web',web],['android-ui',mobile]]){
  page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
  console.log('testing',surface);


 
  await page.getByRole('textbox',{name:'输入消息',exact:true}).waitFor();
  await settings(page,surface,'个性化');
  await page.getByRole('textbox',{name:'怎么称呼你',exact:true}).fill('小合成');
  await page.getByRole('textbox',{name:'固定说明',exact:true}).fill('回答末尾加一行「—WM」。');
  await page.getByRole('button',{name:'保存个性化',exact:true}).click();await page.getByText('已同步 · 从下一次回复开始生效',{exact:true}).filter({visible:true}).waitFor();
  assert.equal((await fixture.request('/settings/personalization')).settings.preferredName,'小合成');
  await page.getByText('已同步 · 从下一次回复开始生效',{exact:true}).filter({visible:true}).scrollIntoViewIfNeeded();
  for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:join(evidence,`${surface}-${theme}-personalization.png`)});}
  await page.getByRole('switch',{name:'参考我的写作风格',exact:true}).uncheck();await page.getByText('已同步 · 从下一次回复开始生效',{exact:true}).filter({visible:true}).waitFor();
  await page.getByRole('switch',{name:'参考我的写作风格',exact:true}).check();await page.getByText('已同步 · 从下一次回复开始生效',{exact:true}).filter({visible:true}).waitFor();
  assert.ok(await page.getByRole('textbox',{name:'提炼结果',exact:true}).inputValue());
  await page.getByRole('button',{name:'清除提炼结果',exact:true}).click();await page.getByText('已同步 · 从下一次回复开始生效',{exact:true}).filter({visible:true}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'提炼结果',exact:true}).inputValue(),'');
  await settings(page,surface,'助手');
  await page.getByRole('switch',{name:'网页搜索',exact:true}).uncheck();await page.getByText('已同步 · 从下一次回复开始生效',{exact:true}).filter({visible:true}).waitFor();
  await page.getByRole('combobox',{name:'回复进行中时发送的消息',exact:true}).click();await page.getByRole('option',{name:'引导',exact:true}).click();await page.getByText('已同步 · 从下一次回复开始生效',{exact:true}).filter({visible:true}).waitFor();
  assert.equal((await fixture.request('/settings/personalization')).settings.messageMode,'steer');
  await page.getByText('已同步 · 从下一次回复开始生效',{exact:true}).filter({visible:true}).scrollIntoViewIfNeeded();
  for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:join(evidence,`${surface}-${theme}-assistant.png`)});}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  checks.push({surface,settingsSaved:true,localStyleEditableAndCleared:true,accountSynced:true,overflow:false});
 }
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(480,650));
 await settings(desktop,'mobile-web','个性化');await desktop.screenshot({path:join(evidence,'desktop-narrow-personalization.png')});
 await desktop.getByRole('textbox',{name:'固定说明',exact:true}).focus();await desktop.keyboard.press('Tab');assert.ok(await desktop.evaluate(()=>document.activeElement!==document.body));
 assert.deepEqual(errors,[]);writeFileSync(join(evidence,'settings-checks.json'),JSON.stringify({checks,errors,realElectron:true,mobileViewport:'390×844',androidUiPackage:true},null,2)+'\n');
 console.log('ST-1 UI checks passed',JSON.stringify(checks));
}catch(error){for(const page of await app?.windows()||[]){console.log('UI failure',await page.locator('body').innerText());await page.screenshot({path:join(evidence,'ui-failure.png')});}throw error;}finally{await browser?.close();await app?.close();await fixture?.close();if(profile)rmSync(profile,{recursive:true,force:true});if(fixture)rmSync(fixture.root,{recursive:true,force:true});}
