import { managedMkdtempSync as mkdtempSync, managedTempRoot as tmpdir } from '../helpers/managed-temp.mjs';
process.env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
import assert from 'node:assert/strict';
import {_electron,chromium} from 'playwright';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {startTimelineCandidate} from './timeline-ui-candidate.mjs';
import {localUiSession} from '../helpers/local-ui-session.mjs';
const out=resolve('tests/evidence/st-2');mkdirSync(out,{recursive:true});
const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
let f,app,browser,profile;const checks=[],errors=[];
async function settings(page,category){await page.evaluate(category=>WeftSettingsNavigation.open(category),category);}
async function select(page,label,value){const saved=page.waitForResponse(response=>{if(response.request().method()==='PATCH'&&response.url().endsWith('/settings/approvals'))return true;if(response.url().endsWith('/bridge')){const request=response.request().postDataJSON();return request?.method==='host.business'&&request.params?.method==='PATCH'&&request.params?.body?.rules;}return false;});await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:value,exact:true}).click();assert.ok((await saved).ok());}
try{
 f=await startTimelineCandidate({inlineProgress:false,interactive:true,composer:true,composerMenu:true,riskApproval:true,historyCount:0,baseTime:Date.now()-15000});
 profile=mkdtempSync(join(tmpdir(),'weftmate-st2-ui-'));
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['scripts/review-gallery/electron.mjs'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:f.origin,REVIEW_THEME:'light',REVIEW_LIBRARY_TOKEN:f.libraryDesktopToken}});
 const desktop=await app.firstWindow();await localUiSession(desktop,f.credentials,'ST-2 synthetic gallery',{interceptLegacyStatus:false});desktop.setDefaultTimeout(15000);desktop.on('pageerror',e=>errors.push(e.message));
 await desktop.locator(`[data-session-id="${f.sessionId}"] > button:first-child`).first().click();await desktop.getByRole('button',{name:'以后这类都允许',exact:true}).waitFor();
 for(const width of [1200,480]){await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,width===480?780:800),width);for(const theme of ['light','dark']){await desktop.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await desktop.screenshot({path:join(out,`desktop-${width}-${theme}-approval.png`)});if(width===1200)await desktop.screenshot({path:join(out,`desktop-${theme}-approval.png`)});}}
 await desktop.getByRole('button',{name:'以后这类都允许',exact:true}).click();
 for(let i=0;i<50&&(await f.request('/settings/approvals')).rules.write!=='allow';i++)await new Promise(r=>setTimeout(r,100));
 assert.equal((await f.request('/settings/approvals')).rules.write,'allow');await f.complete(true);checks.push('approval shortcut persisted globally');
 await f.request('/settings/approvals',{mode:'ask'},'PATCH');await settings(desktop,'approvals');await desktop.waitForFunction(()=>document.getElementById('permission-global-read')?.value==='ask');checks.push('legacy ask default is presented as ask without changing existing decisions');await f.request('/settings/approvals',{mode:'auto'},'PATCH');await desktop.getByRole('button',{name:'关闭设置',exact:true}).click();
 browser=await chromium.launch({headless:true,channel:'chrome'});
 const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await mobile.goto(f.mobileUrl);await mobile.getByRole('button',{name:/^项目进度报告 .*已完成/}).click();mobile.setDefaultTimeout(15000);mobile.on('pageerror',e=>errors.push(e.message));
 for(const [surface,page]of [['desktop',desktop],['phone-web',mobile]]){
   for(const size of surface==='desktop'?[1200,480]:[360,390]){
    if(surface==='desktop')await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,width===480?780:800),size);else await page.setViewportSize({width:size,height:size===360?780:844});
    for(const theme of ['light','dark']){
     await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
     if(surface==='desktop')await settings(page,'approvals');else {if(await page.getByRole('button',{name:'返回',exact:true}).isVisible().catch(()=>false))await page.getByRole('button',{name:'返回',exact:true}).click();await page.getByRole('button',{name:'设置与账户',exact:true}).click();await page.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:/^权限/}).click();}
     await page.getByRole('combobox',{name:'写文件',exact:true}).waitFor();
     await page.getByRole('combobox',{name:'写文件',exact:true}).scrollIntoViewIfNeeded();
     await page.screenshot({path:join(out,`${surface}-${size}-${theme}-permissions.png`)});
     await page.getByRole('combobox',{name:'写文件',exact:true}).click();await page.screenshot({path:join(out,`${surface}-${size}-${theme}-rule-menu.png`)});await page.keyboard.press('Escape');
     await page.getByRole('combobox',{name:'删除',exact:true}).click();assert.equal(await page.getByRole('option',{name:'总是允许',exact:true}).count(),0);await page.screenshot({path:join(out,`${surface}-${size}-${theme}-restricted-rule-menu.png`)});await page.keyboard.press('Escape');
     if(size===(surface==='desktop'?1200:360)&&theme==='light'){await select(page,'运行命令','禁止');assert.equal((await f.request('/settings/approvals')).rules.command,'deny');}
     if(surface==='desktop')await settings(page,'executionRecords');else {await page.getByRole('button',{name:'返回',exact:true}).click();await page.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:/^执行记录/}).click();}
     await page.locator('.record-row').first().waitFor();await page.screenshot({path:join(out,`${surface}-${size}-${theme}-records.png`)});
     await page.getByRole('combobox',{name:'操作类型',exact:true}).click();await page.screenshot({path:join(out,`${surface}-${size}-${theme}-record-filter.png`)});await page.getByRole('option',{name:'写文件',exact:true}).click();await page.locator('.record-row').first().waitFor();
     for(const [label,file]of [['筛选项目','record-project-filter'],['记录时间','record-time-filter']]){await page.getByRole('combobox',{name:label,exact:true}).click();await page.screenshot({path:join(out,`${surface}-${size}-${theme}-${file}.png`)});await page.keyboard.press('Escape');}
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
     await page.locator('.record-row').first().click();await page.getByRole('textbox',{name:'输入消息',exact:true}).waitFor();checks.push(`${surface} ${size} ${theme}: rules, menus, filters, exact chat jump, no overflow`);
    }
   }
 }
 assert.deepEqual(errors,[]);writeFileSync(join(out,'ui-checks.json'),JSON.stringify({realElectron:true,syntheticHost:true,realModelRequests:0,checks,errors,phoneWebViewportOnly:true,systemBars:'covered separately, not by viewport captures'},null,2)+'\n');console.log('ST-2 UI passed',checks);
}catch(error){if(app){const page=await app.firstWindow();console.log((await page.locator('body').innerText()).slice(-5000));await page.screenshot({path:join(out,'ui-failure.png')});}throw error;}
finally{await browser?.close();await app?.close();await f?.close();if(profile)rmSync(profile,{recursive:true,force:true});if(f)rmSync(f.root,{recursive:true,force:true});}
