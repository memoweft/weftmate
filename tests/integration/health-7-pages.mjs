/** HEALTH-7 visual evidence. Production Electron and shared phone UI, synthetic records only. */
process.env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
import assert from 'node:assert/strict';
import {_electron,chromium} from 'playwright';
import {createRequire} from 'node:module';
import {mkdir,writeFile,rm,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {startTimelineCandidate} from './timeline-ui-candidate.mjs';
import {localUiSession} from '../helpers/local-ui-session.mjs';
import {health6Synthetic} from '../helpers/health-6-synthetic.mjs';
import {generateHealthSequence} from '../helpers/health-sequence.mjs';
import {healthOverview,healthMetrics} from '../../src/personal-health/analysis.mjs';
import {HEALTH_DEFAULTS} from '../../src/personal-health/records-schema.mjs';
const mode=process.argv.includes('--before')?'before':process.argv.includes('--recovery')?'recovery':process.argv.includes('--cards')?'cards':'after';
const out=resolve('tests/evidence/health-7',mode==='cards'?'after':mode);await mkdir(out,{recursive:true});
const report={realElectron:true,syntheticOnly:true,realModelRequests:0,mode,stillCapture:'System reduced motion enabled only during each still capture; displayed numerals checked against their source. Normal count-up is covered separately.',screenshots:[],checks:[],errors:[]};
const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
const names=[['recovery','恢复'],['sleep','睡眠'],['load','负荷'],['stress','压力'],['energy','电能'],['fitnessAge','体能年龄']];
const shortSequence=generateHealthSequence({days:5});
const shortState={settings:{...HEALTH_DEFAULTS},days:Object.fromEntries(shortSequence.items.map(row=>[row.day,{health:row.health,updatedAt:row.day+'T12:00:00Z'}]))};
for(const theme of mode==='recovery'?['dark']:['dark','light']){
 const host=await startTimelineCandidate({logicalMobile:true,interactive:true,historyCount:0,goals:true}),profile=await mkdtemp(join(tmpdir(),'weftmate-health7-'));let app,browser;
 try{
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['scripts/review-gallery/electron.mjs','--force-device-scale-factor=1'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:host.origin,REVIEW_LIBRARY_TOKEN:host.libraryDesktopToken,REVIEW_THEME:theme}});
  const desktop=await app.firstWindow();desktop.setDefaultTimeout(15000);await localUiSession(desktop,host.credentials,'HEALTH synthetic',{interceptLegacyStatus:false});
  await desktop.evaluate(theme=>localStorage.setItem('weftmate.desktop.appearance.v1',JSON.stringify({theme,accent:'neutral',fontSize:'15'})),theme);
  await desktop.route('**/ui-core/health.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\n{const factory=WeftUiCore.factories.health;WeftUiCore.factories.health=(core,...args)=>{globalThis.__health7Core=core;return factory(core,...args);};}\n'});});
  browser=await chromium.launch({headless:true});const phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Asia/Shanghai'});phone.setDefaultTimeout(15000);
  let variant='six',fail=false,delay=null;const fixtures=new Map([[desktop,health6Synthetic()],[phone,health6Synthetic()]]);
  for(const [page,mobile]of [[desktop,false],[phone,true]]){
   page.on('pageerror',e=>report.errors.push(e.message));
   const handler=async route=>{
    const input=mobile?route.request().postDataJSON():null,path=mobile?input.params?.path:route.request().url();if(mobile&&(input.method!=='host.business'||!/(?:health\/|settings\/health)/.test(path??'')))return route.continue();
    if(path.includes('/health/overview')){if(delay)await delay;if(fail)return route.fulfill(mobile?{json:{error:{code:'SYNTHETIC_UNAVAILABLE'}}}:{status:503,json:{error:{code:'SYNTHETIC_UNAVAILABLE'}}});}
    const method=mobile?input.params.method??'GET':route.request().method(),body=mobile?input.params.body:method==='GET'?undefined:route.request().postDataJSON();
    const result=fixtures.get(page).reply(path,{method,body});
    if(variant==='suggestion'&&path.includes('/health/overview'))result.insight.suggestions=[{id:'health7-synthetic-rest',text:'今晚给自己留一点放松的时间',reminder:{title:'留一点放松的时间',time:'2026-10-13T13:30:00Z'}}];
    if(variant==='disconnected'&&path.includes('/health/overview'))result.connected=false;
    if(variant==='short'){
     const u=new URL(path,'http://synthetic.invalid');
     if(path.includes('/health/overview'))Object.assign(result,healthOverview(shortState,{dailyDigest:{days:shortSequence.usageDays}},'2026-10-12',shortSequence.timeZone),{stress:null,energy:null,fitnessAge:null});
     else if(path.includes('/health/metrics/'))Object.assign(result,healthMetrics(shortState,{dailyDigest:{days:shortSequence.usageDays}},u.pathname.split('/').at(-1),Number(u.searchParams.get('days')??30),'2026-10-12',shortSequence.timeZone));
    }
    return route.fulfill({json:mobile?{result}:result});
   };
   if(mobile)await page.route('**/bridge',handler);else {await page.route('**/personal/v1/health/**',handler);await page.route('**/personal/v1/settings/health',handler);}
  }
  const settled=page=>page.waitForFunction(()=>{const m=globalThis.__health7Core?.health??globalThis.uiCore?.health??(typeof uiCore!=='undefined'?uiCore.health:null);return m?.overview&&!m.loading&&!m.trendLoading&&!m.supplementLoading&&!m.settingsLoading&&!m.dimensionLoading&&!m.calendarLoading;});
  const top=page=>page.evaluate(()=>{const n=document.querySelector('.health-surface')??document.getElementById('generic-page');if(n)n.scrollTop=0;});
  const shot=async(page,name,locator=null)=>{await page.waitForFunction(()=>!document.getElementById('toast')||document.getElementById('toast').hidden);const previous=await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>[...document.querySelectorAll('.health-page [data-count-to]')].every(n=>n.textContent===WeftHealth.value(Number(n.dataset.countTo),n.dataset.countMetric)));await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));const file=`${name}-${theme}.png`;await (locator??page).screenshot({path:join(out,file)});report.screenshots.push(file);if(!previous)await page.emulateMedia({reducedMotion:'no-preference'});};
  const enter=async(page,mobile)=>{if(mobile)await page.evaluate(()=>page('health'));else {await page.waitForFunction(()=>globalThis.__health7Core?.state.currentView==='assistant'&&globalThis.__health7Core.state.online&&!globalThis.__health7Core.state.refreshing&&!globalThis.__health7Core.state.sessionSelecting&&!!globalThis.__health7Core.state.mainChat);if(!(await page.locator('.health-entry').isVisible()))await page.evaluate(()=>WeftDesktop.toggleRail(false));await page.locator('.health-entry').click();}await settled(page);};
  for(const [page,mobile,width,height]of mode==='recovery'?[[phone,true,390,844]]:mode==='cards'?[[desktop,false,1200,1100],[desktop,false,480,1100],[phone,true,390,1100],[phone,true,360,1100]]:[[desktop,false,1200,800],[desktop,false,480,780],[phone,true,390,844],[phone,true,360,780]]){
   const prefix=mobile?`mobile-${width}`:`electron-${width}`;variant='six';fixtures.set(page,health6Synthetic());
   if(mobile){await page.setViewportSize({width,height});await page.goto(host.mobileUrl);await page.waitForFunction(()=>state.booted&&state.loggedIn);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);}else {await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows()[0].setContentSize(width,height),{width,height});await page.reload();}
   await enter(page,mobile);await top(page);if(mode==='cards'){await page.locator('.health-scores').evaluate(n=>n.scrollIntoView({block:'start'}));await shot(page,`${prefix}-all-six-cards`,page.locator('.health-scores'));continue;}await shot(page,`${prefix}-today-six`);
   await shot(page,`${prefix}-recovery-card`,page.getByRole('button',{name:'恢复，查看详情',exact:true}));
   if(mode==='recovery')continue;
   assert.ok(await page.locator('.health-page').evaluate(n=>n.scrollWidth<=n.clientWidth),'health page must fit its width');
   const boxes=await page.locator('.health-scores').evaluate(n=>[...n.children].map(c=>{const r=c.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,width:r.width};}));
   if(width<600){assert.equal(boxes[0].y,boxes[1].y);assert.ok(boxes[2].y>boxes[0].y);assert.ok(boxes.every(b=>b.right<=width));}
   if(mode==='after'){
    if(mobile&&width===390){await page.setViewportSize({width,height:4000});await top(page);await shot(page,`${prefix}-today-content`,page.locator('.health-today'));await page.setViewportSize({width,height});}
    if(!mobile&&width===1200){await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,1100),width);await top(page);await shot(page,`${prefix}-today-six-tall`);}
    if(mobile)await page.setViewportSize({width,height:1100});else await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,1100),width);await page.locator('.health-scores').evaluate(n=>n.scrollIntoView({block:'start'}));await shot(page,`${prefix}-all-six-cards`,page.locator('.health-scores'));if(mobile)await page.setViewportSize({width,height});else await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows()[0].setContentSize(width,height),{width,height});
    for(const [selector,scene]of [['.health-scores','scores'],['.health-scores>:last-child','scores-lower'],['.health-sleep-summary','sleep-summary'],['.health-vitals','vitals'],['.health-activity-numbers','activity']]){await page.locator(selector).evaluate(n=>n.scrollIntoView({block:'center'}));await shot(page,`${prefix}-${scene}`);}
    await top(page);
    for(const state of ['three','disconnected','short']){variant=state;fixtures.set(page,health6Synthetic({variant:state==='three'?'three':'six'}));await page.getByRole('button',{name:'刷新健康',exact:true}).click();await settled(page);await top(page);await shot(page,`${prefix}-today-${state}`);if(state==='three'||state==='short')assert.equal(await page.locator('.health-scores').evaluate(n=>n.children.length),3);}
    variant='six';fixtures.set(page,health6Synthetic());await page.getByRole('button',{name:'刷新健康',exact:true}).click();await settled(page);
   }
   for(const [id,name]of names){await page.getByRole('button',{name:`${name}，查看详情`,exact:true}).click();await settled(page);await top(page);await shot(page,`${prefix}-${id}-detail`);
    if(mode==='after'){
     assert.doesNotMatch(await page.locator('.health-page').textContent(),/医学结论|趋势估计|免责声明|按公开.*估计/);
     if(id==='sleep'){await page.locator('.health-stages').evaluate(n=>n.scrollIntoView({block:'center'}));await shot(page,`${prefix}-sleep-stages`);}
     if(id==='stress'){await page.locator('.health-method-toggle').click();await top(page);await shot(page,`${prefix}-method-open`);await page.locator('.health-analysis-toggle').first().click();await page.locator('.health-analysis-body').evaluate(n=>n.scrollIntoView({block:'center'}));await shot(page,`${prefix}-analysis-open`);}
    }
    await page.getByRole('button',{name:'返回今日',exact:true}).click();
   }
   await page.locator('.health-vital').first().click();await settled(page);await page.getByRole('switch',{name:'叠加：深夜使用时长'}).click();await settled(page);await page.locator('.health-trend-panel').evaluate(n=>n.scrollIntoView({block:'start'}));await shot(page,`${prefix}-trend-overlay`);
   const chart=page.getByRole('application',{name:/趋势图/}).first();await chart.evaluate(n=>n.scrollIntoView({block:'center'}));const box=await chart.boundingBox(),x=box.x+box.width*.65,y=box.y+box.height*.5;let touch;
   if(mobile){touch=await page.context().newCDPSession(page);await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});}else {await page.mouse.move(x,y);await page.mouse.down();}
   await page.locator('.health-chart-tip:not([hidden])').first().waitFor();await shot(page,`${prefix}-trend-point-open`);
   if(mobile){await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach();}else await page.mouse.up();
   await chart.focus();await page.keyboard.press('ArrowLeft');assert.ok(await page.locator('.health-chart-tip').first().isVisible());await page.keyboard.press('Escape');
   await page.getByRole('button',{name:'返回今日',exact:true}).click();
   if(mode==='after'){
    await page.getByRole('button',{name:'选择健康日期',exact:true}).click();await page.getByRole('region',{name:'健康月历'}).waitFor();await shot(page,`${prefix}-calendar-open`);await page.getByRole('button',{name:'收起月历',exact:true}).click();
    if(mobile)await page.evaluate(()=>page('healthData'));else await page.evaluate(()=>WeftSettingsNavigation.open('healthData'));
    await page.getByRole('switch',{name:'今日解读用模型写',exact:true}).waitFor();assert.equal(await page.getByText('按公开方法做的估计，不是医学结论',{exact:true}).count(),1);await shot(page,`${prefix}-settings`);
    if(!mobile)await page.getByRole('button',{name:'关闭设置',exact:true}).click();await enter(page,mobile);await top(page);
    await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'前一天',exact:true}).click();await settled(page);const animations=await page.locator('.health-page').evaluate(n=>n.getAnimations({subtree:true}).filter(a=>a.playState==='running').length);assert.equal(animations,0);await shot(page,`${prefix}-reduced-motion`);await page.emulateMedia({reducedMotion:'no-preference'});
    assert.doesNotMatch(await page.locator('.health-page').textContent(),/医学结论|趋势估计|免责声明/);
    if(width===360){const geometry=await page.evaluate(()=>{const root=document.querySelector('.health-page'),panel=document.createElement('div');panel.style.width='32px';root.append(panel);let count=0;for(const value of [null,42,-900,900]){const G=WeftHealthGraphics;for(const svg of [G.band(value),G.dualBars(value,450),G.range(value,30,65),G.halfGauge(value),G.area(value===null?[]:[{value}]),G.comparison(value,34),G.progress(value,60),G.stages({deepMinutes:value,remMinutes:null,awakeMinutes:null},value)]){panel.replaceChildren(svg);if(panel.scrollWidth>32)throw Error('Narrow graphic overflow');if([...svg.querySelectorAll('*')].some(n=>[...n.attributes].some(a=>/NaN|Infinity/.test(a.value))))throw Error('Non-finite SVG geometry');count++;}}panel.remove();return {width:32,componentCases:count};});report.checks.push({theme,renderedGraphics:geometry});}
    let release;delay=new Promise(r=>release=r);await page.evaluate(()=>{const core=globalThis.__health7Core??uiCore;core.resetHealth();void core.readHealth();});await page.getByRole('status',{name:'正在读取健康',exact:true}).waitFor();await shot(page,`${prefix}-loading`);release();delay=null;await settled(page);
    fail=true;await page.getByRole('button',{name:'刷新健康',exact:true}).click();await page.getByRole('alert').first().waitFor();await shot(page,`${prefix}-error`);fail=false;await page.getByRole('button',{name:'重试',exact:true}).click();await settled(page);
    variant='suggestion';await page.getByRole('button',{name:'刷新健康',exact:true}).click();await settled(page);await top(page);await page.getByRole('button',{name:'提醒我',exact:true}).waitFor();await shot(page,`${prefix}-insight-reminder`);variant='six';
    report.checks.push(`${prefix}-${theme}: two-column narrow scores, six details, sleep stages, colored SVGs, overlay, touch/keyboard point, method/analysis/calendar open, unique settings notice, reduced motion, no overflow`);
   }
  }
 }finally{await browser?.close();await app?.close();await host.close();await rm(profile,{recursive:true,force:true});await rm(host.root,{recursive:true,force:true});}
}
assert.deepEqual(report.errors,[]);report.componentCrop='Six-card groups: capture window height 1100. Complete 390-width today content: capture window height 4000, cropped to the actual component. These component crops complement canonical device viewports and native system-bar evidence.';await writeFile(join(out,mode==='cards'?'cards-verification.json':'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({mode,screenshots:report.screenshots.length,checks:report.checks,errors:report.errors}));
