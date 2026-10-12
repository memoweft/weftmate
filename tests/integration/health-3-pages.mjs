process.env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
import assert from 'node:assert/strict';
import {_electron,chromium} from 'playwright';
import {createRequire} from 'node:module';
import {mkdir,writeFile,rm,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {startTimelineCandidate} from './timeline-ui-candidate.mjs';
import {localUiSession} from '../helpers/local-ui-session.mjs';
import {healthPageSynthetic} from '../helpers/health-page-synthetic.mjs';
const out=resolve('tests/evidence/health-3');await mkdir(out,{recursive:true});
const report={realElectron:true,syntheticOnly:true,realModelRequests:0,contractFixture:true,screenshots:[],checks:[],errors:[]};
const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
for(const theme of ['light','dark']){
 const fixture=await startTimelineCandidate({logicalMobile:true,interactive:true,historyCount:0,goals:true}),profile=await mkdtemp(join(tmpdir(),'weftmate-health3-'));let app,browser;let state='ready',delay=null;const writes=[];
 const reply=path=>healthPageSynthetic({state}).reply(path);
 try{
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['scripts/review-gallery/electron.mjs','--force-device-scale-factor=1'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:fixture.origin,REVIEW_LIBRARY_TOKEN:fixture.libraryDesktopToken,REVIEW_THEME:theme}});
  const desktop=await app.firstWindow();desktop.setDefaultTimeout(12000);await localUiSession(desktop,fixture.credentials,'HEALTH synthetic',{interceptLegacyStatus:false});await desktop.evaluate(theme=>localStorage.setItem('weftmate.desktop.appearance.v1',JSON.stringify({theme,accent:'neutral',fontSize:'15'})),theme);await desktop.reload();
  browser=await chromium.launch({headless:true});const phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Asia/Shanghai'});phone.setDefaultTimeout(12000);await phone.goto(fixture.mobileUrl);await phone.waitForFunction(()=>state.booted&&state.loggedIn);await phone.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
  for(const [page,mobile]of [[desktop,false],[phone,true]]){
   page.on('pageerror',error=>report.errors.push(error.message));
   if(mobile)await page.route('**/bridge',async route=>{const input=route.request().postDataJSON(),path=input.params?.path;if(input.method!=='host.business'||!path?.includes('/health/'))return route.continue();if(delay)await delay;if(state==='error')return route.fulfill({json:{error:{code:'UNAVAILABLE'}}});if(input.params.method==='POST')writes.push(input.params);await route.fulfill({json:{result:reply(path)}});});
   else await page.route('**/personal/v1/health/**',async route=>{if(delay)await delay;if(state==='error')return route.fulfill({status:503,json:{error:{code:'UNAVAILABLE'}}});if(route.request().method()==='POST')writes.push(route.request().postDataJSON());await route.fulfill({json:reply(route.request().url())});});
  }
  const shot=async(page,name,full=false)=>{if(!name.endsWith('-reminder'))await page.waitForFunction(()=>!document.getElementById('toast')||document.getElementById('toast').hidden);await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));const file=`${name}-${theme}.png`;await page.screenshot({path:join(out,file),fullPage:full});report.screenshots.push(file);};
  const ready=page=>page.getByRole('heading',{name:'把今天的节奏放轻松',exact:true}).waitFor();
  for(const [page,mobile,prefix]of [[desktop,false,'electron-1200'],[phone,true,'mobile-390']]){
   await page.getByRole(mobile?'tab':'button',{name:'健康',exact:true}).click();await ready(page);await page.locator('.health-trend-panel .health-line').first().waitFor({state:mobile?'attached':'visible'}).catch(()=>{});await shot(page,`${prefix}-today`);
   if(!mobile){assert.equal(await page.locator('#assistant-title').textContent(),'健康');const left=await page.locator('.health-today').boundingBox(),right=await page.locator('.health-trend-panel').boundingBox();assert.ok(right.x>left.x+left.width);await page.locator('.health-week').scrollIntoViewIfNeeded();await shot(page,`${prefix}-week`);await page.locator('.health-page h1').scrollIntoViewIfNeeded();}
   await page.getByRole('button',{name:'查看依据',exact:true}).click();await shot(page,`${prefix}-basis-open`);
   await page.getByRole('button',{name:'提醒我',exact:true}).click();await page.getByRole('button',{name:'已设提醒',exact:true}).waitFor();await shot(page,`${prefix}-reminder`);
   for(const [id,name]of [['recovery','恢复'],['sleep','睡眠'],['load','负荷']]){
    await page.getByRole('button',{name:`${name}，查看详情`,exact:true}).click();await page.locator('.health-detail').waitFor();await page.locator('.health-trend-panel .health-line').waitFor();await shot(page,`${prefix}-${id}-detail`);await page.locator('.health-insight-toggle').click();await shot(page,`${prefix}-${id}-insight-open`);await page.getByRole('button',{name:'返回今日',exact:true}).click();
   }
   await page.getByRole('button',{name:'选择健康日期',exact:true}).click();await page.getByRole('region',{name:'健康月历',exact:true}).waitFor();await page.getByRole('button',{name:'10月1日，有运动',exact:true}).waitFor();await shot(page,`${prefix}-calendar-open`);await page.getByRole('button',{name:'收起月历',exact:true}).click();
   await page.locator('.health-vital').first().click();await page.locator('.health-trend-panel .health-line').waitFor();await page.getByRole('switch',{name:'叠加：深夜使用时长'}).click();await page.locator('.health-usage-bar').first().waitFor();await shot(page,`${prefix}-trend-overlay`);
   const chart=page.getByRole('application',{name:/趋势图/}).first();await chart.focus();await page.keyboard.press('ArrowLeft');await page.locator('.health-chart-tip:not([hidden])').first().waitFor();await shot(page,`${prefix}-trend-point-open`);await page.keyboard.press('Escape');await page.getByRole('button',{name:'返回今日',exact:true}).click();
   await page.getByRole('button',{name:'接着问它',exact:true}).click();const draft=page.locator(mobile?'#draft':'#message-text');await draft.waitFor();await page.waitForFunction(selector=>document.querySelector(selector)?.value.includes('把今天的节奏放轻松'),mobile?'#draft':'#message-text');assert.match(await draft.inputValue(),/> .*把今天的节奏放轻松/);assert.ok(!(await draft.inputValue()).includes('undefined'));await page.getByRole(mobile?'tab':'button',{name:'健康',exact:true}).click();await ready(page);
   report.checks.push(`${prefix}-${theme}: today, three details, expanded interpretation and basis, calendar, overlay and keyboard tooltip, explicit reminder, unsent main-chat quote`);
  }
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(480,780));await phone.setViewportSize({width:360,height:780});
  for(const [page,prefix]of [[desktop,'electron-480'],[phone,'mobile-360']]){
   state='ready';await page.getByRole('button',{name:'刷新健康',exact:true}).click();await ready(page);await shot(page,`${prefix}-today`);assert.ok(await page.locator('.health-page').evaluate(n=>n.scrollWidth<=n.clientWidth));
   if(page===phone){const boxes=await page.locator('#mobile-bottom-tabs [role=tab]').evaluateAll(rows=>rows.map(n=>({text:n.textContent,x:n.getBoundingClientRect().x,right:n.getBoundingClientRect().right,width:n.getBoundingClientRect().width,scroll:n.scrollWidth,client:n.clientWidth})));assert.equal(boxes.length,5);assert.ok(boxes.every(b=>b.x>=0&&b.right<=360&&b.scroll<=b.client));await phone.getByRole('tab',{name:'健康',exact:true}).focus();await phone.keyboard.press('ArrowRight');assert.equal(await phone.getByRole('tab',{name:/目标/}).getAttribute('aria-selected'),'true');await phone.getByRole('tab',{name:'健康',exact:true}).click();await ready(phone);}
   for(const variant of ['disconnected','short','missing','statistical','empty']){state=variant;await page.getByRole('button',{name:'刷新健康',exact:true}).click();await page.locator('.health-skeleton').waitFor({state:'hidden'});await shot(page,`${prefix}-${variant}`);if(variant==='disconnected')assert.equal(await page.locator('.health-demo-label').textContent(),'示意');if(variant==='missing')assert.match(await page.locator('.health-vital').nth(3).textContent(),/—.*当天还没有测量/);}
   let release;delay=new Promise(r=>release=r);state='ready';await page.getByRole('button',{name:'刷新健康',exact:true}).click();await page.getByRole('status',{name:'正在读取健康',exact:true}).waitFor();await shot(page,`${prefix}-loading`);release();delay=null;await ready(page);
   state='error';await page.getByRole('button',{name:'刷新健康',exact:true}).click();await page.getByRole('alert').first().waitFor();await shot(page,`${prefix}-error`);state='ready';await page.getByRole('button',{name:'重试',exact:true}).click();await ready(page);
   for(const variant of ['no-trend','single']){state=variant;await page.locator('.health-vital').first().click();await page.locator('.health-skeleton').waitFor({state:'hidden'});await shot(page,`${prefix}-${variant}`);await page.getByRole('button',{name:'返回今日',exact:true}).click();}
   state='ready';await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.health-metric').first().evaluate(n=>getComputedStyle(n).animationName),'none');report.checks.push(`${prefix}-${theme}: no overflow, disconnected/insufficient/missing/statistical/no daily measurement/loading/error+retry, empty/single/gapped charts, reduced motion`);
  }
  assert.equal(writes.length,2);report.checks.push(`${theme}: two explicit reminder clicks produce two writes across isolated clients`);
 }catch(error){await app?.firstWindow().then(page=>page.screenshot({path:join(out,`failure-${theme}.png`)})).catch(()=>{});throw error;}
 finally{await browser?.close();await app?.close();await fixture.close();await rm(profile,{recursive:true,force:true});await rm(fixture.root,{recursive:true,force:true});}
}
assert.deepEqual(report.errors,[]);await writeFile(join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({screenshots:report.screenshots.length,checks:report.checks,errors:report.errors}));
