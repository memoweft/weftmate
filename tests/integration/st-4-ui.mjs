import assert from 'node:assert/strict';
import { _electron,chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp,mkdir,writeFile,readFile,rm,utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
const out=resolve('tests/evidence/st-4');await mkdir(out,{recursive:true});
const f=await startTimelineCandidate({interactive:true,composer:true,historyCount:0}),profile=await mkdtemp(join(tmpdir(),'weftmate-st4-ui-'));
const owner=Object.keys(JSON.parse(await readFile(join(f.root,'store.json'),'utf8')).accounts)[0];
for(const category of ['cache','logs','temporary','offline']){const dir=join(f.root,'accounts',owner,category);await mkdir(dir,{recursive:true});const file=join(dir,'synthetic');await writeFile(file,Buffer.alloc(65536,0x53));await utimes(file,new Date('2026-01-01'),new Date('2026-01-01'));}
const env={...process.env};for(const name of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(name)||name==='ELECTRON_RUN_AS_NODE')delete env[name];
let app,browser;const errors=[],checks=[];
async function settings(page,surface){
 if(surface==='android-ui') {await page.getByRole('button',{name:'返回',exact:true}).click();await page.getByRole('button',{name:'设置与账户',exact:true}).click();await page.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:/^数据与存储/}).click();}
 else {if(!(await page.getByRole('button',{name:'账户菜单',exact:true}).isVisible().catch(()=>false)))await page.getByRole('button',{name:'切换会话侧栏',exact:true}).click();await page.getByRole('button',{name:'账户菜单',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();
 if(surface==='mobile-web'){await page.getByRole('combobox',{name:'设置分类',exact:true}).click();await page.getByRole('option',{name:'设置 · 数据与存储',exact:true}).click();}else await page.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:'数据与存储',exact:true}).click();}
 await page.getByText(/^本账户共占用/).waitFor();
}
async function capture(page,surface,name){for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:join(out,`${surface}-${theme}-${name}.png`)});}}
try{
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['scripts/review-gallery/electron.mjs'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:f.origin,REVIEW_LIBRARY_TOKEN:f.libraryDesktopToken,REVIEW_THEME:'light'}});
 const desktop=await app.firstWindow();desktop.setDefaultTimeout(20000);desktop.on('pageerror',e=>errors.push(e.message));await localUiSession(desktop,f.credentials);
 browser=await chromium.launch({channel:'chrome',headless:true});const web=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await web.goto(f.origin+'/personal/v1/ui');await localUiSession(web,f.credentials);
 const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await mobile.goto(f.mobileUrl);await mobile.getByRole('button',{name:/^项目进度报告.*正在运行$/}).evaluate(button=>button.click());
 for(const [surface,page]of [['desktop',desktop],['mobile-web',web],['android-ui',mobile]]){
  page.on('pageerror',e=>errors.push(e.message));await settings(page,surface);await capture(page,surface,'overview');
  await page.getByRole('button',{name:'删除本账户的全部数据',exact:true}).scrollIntoViewIfNeeded();await capture(page,surface,'danger-zone');
  for(const kind of ['删除本账户的全部数据','注销账号']){
   await page.getByRole('button',{name:kind,exact:true}).click();await page.getByRole('dialog',{name:kind,exact:true}).waitFor();await capture(page,surface,kind==='注销账号'?'close-account':'delete-account');
   assert.equal(await page.getByRole('button',{name:'继续',exact:true}).isDisabled(),true);await page.getByRole('textbox',{name:'输入账户名确认'}).fill('TimelineFixture');await page.getByRole('button',{name:'继续',exact:true}).click();await page.getByRole('dialog',{name:'最后确认',exact:true}).waitFor();await capture(page,surface,kind==='注销账号'?'close-final':'delete-final');await page.getByRole('dialog',{name:'最后确认',exact:true}).getByRole('button',{name:'取消',exact:true}).click();
  }
  const logRow=page.locator('.data-category').filter({hasText:'日志与诊断'});await logRow.getByRole('button',{name:'清理',exact:true}).click();await capture(page,surface,'clean-confirm');await page.getByRole('dialog',{name:'清理日志与诊断'}).getByRole('button',{name:'取消',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);checks.push({surface,statisticsVisible:true,dialogsCancelable:true,accountNameRequired:true,noHorizontalOverflow:true});
 }
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(480,780));await desktop.locator('.settings-content').evaluate(node=>node.scrollTop=0);await capture(desktop,'desktop-480','overview');
 await web.getByRole('button',{name:'删除本账户的全部数据',exact:true}).click();await web.getByRole('textbox',{name:'输入账户名确认'}).fill('TimelineFixture');await web.getByRole('button',{name:'继续',exact:true}).click();await web.getByRole('button',{name:'请求电脑确认',exact:true}).click();
 await web.getByText('已请求电脑确认。可以在确认前取消。',{exact:true}).waitFor();await capture(web,'mobile-web','pending-computer');
 await desktop.getByRole('button',{name:'核对并确认',exact:true}).waitFor();await capture(desktop,'desktop','pending-computer');
 await web.getByRole('button',{name:'取消操作',exact:true}).click();await web.getByRole('button',{name:'删除本账户的全部数据',exact:true}).waitFor({state:'visible'});
 assert.deepEqual(errors,[]);await writeFile(join(out,'ui-checks.json'),JSON.stringify({checks,errors,realElectron:true,hostSynthetic:true,androidUiPackage:true,mobileViewport:'390×844'},null,2)+'\n');console.log('ST-4 UI captures passed');
}catch(error){for(const page of await app?.windows()||[]){console.log((await page.locator('body').innerText()).slice(-5000));await page.screenshot({path:join(out,'ui-failure.png')});}throw error;}
finally{await browser?.close();await app?.close();await f.close();await rm(profile,{recursive:true,force:true});await rm(f.root,{recursive:true,force:true});}
