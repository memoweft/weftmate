// Production Electron shell and both phone web presentations, synthetic host only.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
const out = resolve('tests/evidence/st-5'); await mkdir(out,{recursive:true});
const f = await startTimelineCandidate({interactive:true,composer:true,historyCount:0});
const profile = await mkdtemp(join(tmpdir(),'weftmate-st5-electron-'));
const env = {...process.env}; for(const key of Object.keys(env)) if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE') delete env[key];
env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
let app, browser;
const report={realElectron:!process.argv.includes('--phone-only'),realModelRequests:0,syntheticHost:true,checks:[],screenshots:[],errors:[],phoneSystemBars:'Browser viewport only; OS/browser chrome not verified, no native shell modified.'};
async function shot(page,name,control){if(control)await control.evaluate(el=>(el.closest('.settings-row')||el).scrollIntoView({block:'center'}));await page.screenshot({path:join(out,name+'.png'),scale:'css'});report.screenshots.push(name+'.png');}
async function open(page,mobile=false){
 if(mobile){await page.getByRole('button',{name:'返回',exact:true}).click();await page.getByRole('button',{name:'设置与账户',exact:true}).click();await page.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:/^外观/}).click();}
 else {const phoneAccount=page.getByRole('button',{name:'个人资料与设置',exact:true});
 if(await phoneAccount.isVisible()){await phoneAccount.click();await page.getByRole('menuitem',{name:'设置',exact:true}).click();}
 else {if(!await page.getByRole('button',{name:'账户菜单',exact:true}).isVisible())await page.getByRole('button',{name:'切换会话侧栏',exact:true}).click();await page.getByRole('button',{name:'账户菜单',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();}
 if(await page.getByRole('combobox',{name:'设置分类',exact:true}).isVisible()){await page.getByRole('combobox',{name:'设置分类',exact:true}).click();await page.getByRole('option',{name:'设置 · 外观',exact:true}).click();}
 else await page.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:'外观',exact:true}).click();}
 await page.getByRole('group',{name:'颜色模式',exact:true}).waitFor();
}
async function mode(page,value){await page.getByRole('group',{name:'颜色模式',exact:true}).getByRole('button',{name:{light:'浅色',dark:'深色',system:'跟随系统'}[value],exact:true}).click();await page.waitForFunction(value=>document.querySelector(`.appearance-modes button[data-value="${value}"]`)?.getAttribute('aria-pressed')==='true',value);}
async function choose(page,label,text){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:text,exact:true}).click();await page.waitForFunction(({label,text})=>[...document.querySelectorAll('select')].some(el=>el.getAttribute('aria-label')===label&&el.selectedOptions[0]?.textContent===text),{label,text});}
async function matrix(page,name,width,mobile=false){
 await (name==='electron'?app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,800),width):page.setViewportSize({width,height:width===360?780:844}));
 for(const theme of ['light','dark']){
  await page.emulateMedia({colorScheme:theme,reducedMotion:'no-preference'});await mode(page,theme);
  const prefix=`${name}-${width}-${theme}`;
  for(const selected of ['light','dark','system']){await mode(page,selected);await shot(page,`${prefix}-mode-${selected}`,page.getByRole('group',{name:'颜色模式',exact:true}));}
  await mode(page,theme);
  // Keyboard selects modes using arrows, Space and Enter; names and state are accessible.
  await page.getByRole('group',{name:'颜色模式',exact:true}).getByRole('button',{name:'浅色',exact:true}).focus();await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');await page.keyboard.press('Home');await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');await mode(page,theme);
  const motion=page.getByRole('switch',{name:'减少动态效果',exact:true});
  for(const enabled of [false,true]){await motion.setChecked(enabled);await shot(page,`${prefix}-motion-${enabled?'on':'off'}`,motion);assert.equal(await page.evaluate(()=>WeftReplyMotion.reduced),enabled);}
  const motionCheck=await page.evaluate(()=>{const probe=document.createElement('div');probe.className='reply-sheen-part';probe.textContent='合成流式追加文本';document.body.append(probe);const css=getComputedStyle(probe);const values={animation:css.animationName,transition:css.transitionDuration,scroll:css.scrollBehavior};const count=document.getAnimations().length;WeftReplyMotion.reveal(probe);globalThis.WeftMotion?.reveal(probe);globalThis.WeftMobileMotion?.reveal(probe);WeftReplyMotion.fragment(probe);values.newAnimations=document.getAnimations().length-count;probe.remove();return values;});
  assert.equal(motionCheck.animation,'none');assert.equal(motionCheck.transition,'0s');assert.equal(motionCheck.scroll,'auto');assert.equal(motionCheck.newAnimations,0);
  // First-use and explicit override follow live media changes; reset restores the live default.
  await page.getByRole('button',{name:'恢复跟随系统',exact:true}).click();await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(100);await page.waitForFunction(()=>WeftReplyMotion.reduced&&document.getElementById('appearance-reduced-motion').checked);
  assert.equal(await motion.isChecked(),true);await motion.uncheck();await page.emulateMedia({reducedMotion:'no-preference'});await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await motion.isChecked(),false);
  await motion.check();await page.emulateMedia({reducedMotion:'no-preference'});assert.equal(await motion.isChecked(),true);
  for(const label of ['浅色强调色','深色强调色'])for(const color of ['石墨','蓝色','松绿','紫色']){
   await choose(page,label,color);await shot(page,`${prefix}-${label==='浅色强调色'?'accent-light':'accent-dark'}-${color}`,page.getByRole('combobox',{name:label,exact:true}));
  }
  // Separate preferences become the active palette when switching the mode.
  await choose(page,'浅色强调色','蓝色');await choose(page,'深色强调色','松绿');await mode(page,'light');assert.equal(await page.evaluate(()=>document.documentElement.dataset.accent),'blue');await mode(page,'dark');assert.equal(await page.evaluate(()=>document.documentElement.dataset.accent),'green');await mode(page,theme);
  for(const label of ['浅色强调色','深色强调色']){await page.getByRole('combobox',{name:label,exact:true}).click();await shot(page,`${prefix}-${label==='浅色强调色'?'accent-light':'accent-dark'}-menu`);await page.keyboard.press('Escape');}
  for(const [value,text]of [['14','小 · 14'],['15','标准 · 15'],['17','大 · 17'],['19','特大 · 19']]){await choose(page,'字号',text);await shot(page,`${prefix}-body-${value}`,page.getByRole('combobox',{name:'字号',exact:true}));}await choose(page,'字号','标准 · 15');
  const prose=await page.locator('.appearance-code-preview>p').evaluate(el=>getComputedStyle(el).fontSize);
  for(const [value,text]of [['12','小 · 12'],['13','标准 · 13'],['15','大 · 15'],['17','特大 · 17']]){
   await choose(page,'代码字号',text);assert.equal(await page.locator('.appearance-code-preview pre code').evaluate(el=>getComputedStyle(el).fontSize),value+'px');assert.equal(await page.locator('.appearance-code-preview>p>code').evaluate(el=>getComputedStyle(el).fontSize),value+'px');assert.equal(await page.locator('.appearance-code-preview>p').evaluate(el=>getComputedStyle(el).fontSize),prose);await shot(page,`${prefix}-code-${value}`,page.locator('.appearance-code-preview'));
  }
  await page.getByRole('combobox',{name:'代码字号',exact:true}).click();await shot(page,`${prefix}-code-menu`);await page.keyboard.press('Escape');
  assert.equal(await page.getByText('界面密度',{exact:true}).count(),0);assert.ok(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth));
  const buttons=await page.locator('.appearance-modes button').evaluateAll(nodes=>nodes.map(el=>({w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height})));assert.ok(buttons.every(b=>b.w>=44&&b.h>=44));
  report.checks.push({surface:name,width,theme,motionCheck,prose});console.log('verified '+prefix);
 }
}
try{
 if(!process.argv.includes('--phone-only')){
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['scripts/review-gallery/electron.mjs'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:f.origin,REVIEW_THEME:'light'}});
 const desktop=await app.firstWindow();desktop.on('pageerror',e=>report.errors.push(e.message));await localUiSession(desktop,f.credentials,'ST-5 synthetic',{mainChat:true});await desktop.getByRole('textbox',{name:'输入消息',exact:true}).waitFor();await open(desktop);
 await matrix(desktop,'electron',1200);await matrix(desktop,'electron',480);
 // Reload renderer and restart the actual application with the same isolated profile.
 const saved=await desktop.evaluate(()=>JSON.parse(localStorage.getItem('weftmate.desktop.appearance.v1')));await app.close();app=null;
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['scripts/review-gallery/electron.mjs'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:f.origin,REVIEW_THEME:'light'}});const reopened=await app.firstWindow();await reopened.waitForFunction(()=>!!globalThis.WeftDesktop);assert.deepEqual(await reopened.evaluate(()=>WeftDesktop.getAppearance()),saved);assert.equal(await reopened.evaluate(()=>WeftReplyMotion.preference),'reduce');report.checks.push('actual-electron-restart-persistence');await app.close();app=null;
 }
 browser=await chromium.launch({headless:true,channel:'chrome'});
 const web=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});web.on('pageerror',e=>report.errors.push(e.message));await web.goto(f.origin+'/personal/v1/ui');await localUiSession(web,f.credentials,'ST-5 phone',{mainChat:true});await web.getByRole('textbox',{name:'输入消息',exact:true}).waitFor();await open(web);await matrix(web,'phone-web',360);await matrix(web,'phone-web',390);
 const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});let nativeAppearance='light';await mobile.route('**/bridge',async route=>{const payload=route.request().postDataJSON();if(payload.method!=='settings.appearance')return route.continue();if(payload.params?.value)nativeAppearance=payload.params.value;await route.fulfill({json:{result:{value:nativeAppearance,systemDark:await mobile.evaluate(()=>matchMedia('(prefers-color-scheme: dark)').matches)}}});});mobile.on('pageerror',e=>report.errors.push(e.message));await mobile.goto(f.mobileUrl);await mobile.getByRole('button',{name:/^项目进度报告 [0-9]/}).click();await open(mobile,true);await matrix(mobile,'mobile-ui',360,true);await matrix(mobile,'mobile-ui',390,true);
 const phoneSaved=await mobile.evaluate(()=>localStorage.getItem('weftmate.mobile.appearance.v1'));await mobile.reload();await mobile.waitForFunction(()=>!!globalThis.WeftAppearanceControls);assert.equal(await mobile.evaluate(()=>localStorage.getItem('weftmate.mobile.appearance.v1')),phoneSaved);await mobile.waitForFunction(()=>document.documentElement.dataset.accent==='green');report.checks.push('mobile-reload-persistence');
 assert.deepEqual(report.errors,[]);await writeFile(join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({checks:report.checks.length,screenshots:report.screenshots.length,errors:report.errors}));
}catch(error){for(const page of browser?.contexts().flatMap(c=>c.pages())||[]){console.log(await page.locator('button').evaluateAll(nodes=>nodes.filter(el=>el.getBoundingClientRect().height).map(el=>({id:el.id,name:el.getAttribute('aria-label'),text:el.textContent.slice(0,40)}))));await page.screenshot({path:join(out,'failure-phone-'+(page.url().includes('/personal/v1/ui')?'web':'mobile')+'.png')}).catch(()=>{});}if(app)for(const page of await app.windows()){await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});console.log((await page.locator('body').innerText()).slice(-3000));}await writeFile(join(out,'failure.json'),JSON.stringify({error:error.message,checks:report.checks,errors:report.errors},null,2));throw error;}
finally{await browser?.close();await app?.close();await f.close();await rm(profile,{recursive:true,force:true});await rm(f.root,{recursive:true,force:true});}
