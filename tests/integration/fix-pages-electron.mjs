// Real hidden Windows shell, isolated identity and synthetic data; no model calls.
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, open, unlink, readdir, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { startFixture } from './ux-4-fixture.mjs';
import { feedbackUiSession } from '../helpers/feedback-ui-session.mjs';
import { healthPageSynthetic } from '../helpers/health-page-synthetic.mjs';

for (const stream of [process.stdout, process.stderr]) stream.on('error', e => { if (e.code !== 'EPIPE') throw e; });
const root = resolve(import.meta.dirname, '../..'), baseline = process.argv.includes('--before');
const locks = process.env.WEFTMATE_HEAVY_LOCK_DIR, output = process.env.WEFTMATE_EVIDENCE_DIR;
assert.ok(locks); assert.ok(output);
let app, child, fixture, profile, lock, browser;
const failures = [], errors = [];
const kill = () => { if (child?.exitCode === null) { if(process.platform==='win32')spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide:true, stdio:'ignore', timeout:5000 });else child.kill('SIGKILL'); } };
const deadline = setTimeout(() => { kill(); process.exitCode = 1; }, 180000);
async function cleanup(directory) {
  const rel = relative(tmpdir(), directory); assert.ok(rel && !isAbsolute(rel) && !rel.startsWith('..') && rel.startsWith('weftmate-fix-pages-'));
  async function links(path) { for (const entry of await readdir(path,{withFileTypes:true})) { const p=join(path,entry.name); if ((await lstat(p)).isSymbolicLink()) await unlink(p); else if(entry.isDirectory()) await links(p); } }
  await links(directory); await rm(directory,{recursive:true,force:true});
}
try {
  for (let n=1;n<=3;n++) { const path=join(locks,`heavy-${n}.lock`); try { const h=await open(path,'wx'); await h.writeFile('FIX-PAGES '+new Date().toISOString()); await h.close(); lock=path; break; } catch(e) { if(e.code!=='EEXIST')throw e; } }
  assert.ok(lock,'No heavy slot available'); await mkdir(output,{recursive:true});
  profile=await mkdtemp(join(tmpdir(),'weftmate-fix-pages-'));
  if(!process.env.WEFTMATE_TEST_TEMP_SCOPE)process.env.WEFTMATE_MANAGED_TEMP_ROOT=join(profile,'fixtures');
  fixture=await startFixture();
  const bootstrap=join(profile,'shell.mjs');
  await writeFile(bootstrap,`import {createRequire} from 'node:module';const {app}=createRequire(${JSON.stringify(new URL('../../package.json',import.meta.url).href)})('electron');app.setName('WeftMate Pages Test');app.setAppUserModelId('com.memoweft.weftmate.test.pages');app.disableHardwareAcceleration();for(const s of [process.stdout,process.stderr])s.on('error',e=>{if(e.code!=='EPIPE')throw e});await import(${JSON.stringify(new URL('../../scripts/review-gallery/electron.mjs',import.meta.url).href)});`);
  const env={...process.env}; for(const k of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(k)||k==='ELECTRON_RUN_AS_NODE')delete env[k];
  Object.assign(env,{REVIEW_PROFILE:profile,REVIEW_ORIGIN:fixture.origin,REVIEW_LIBRARY_TOKEN:fixture.libraryDesktopToken,REVIEW_THEME:'light',REVIEW_HIDDEN:'1',WEFTMATE_TEST_HOST_NAME:'synthetic-host'});
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:root,args:[bootstrap,'--disable-backgrounding-occluded-windows','--disable-features=CalculateNativeWinOcclusion'],env,timeout:30000});
  child=app.process(); child.stdout?.resume();child.stderr?.resume();
  const page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  await feedbackUiSession(page,fixture,{native:true});await page.unroute('**/personal/v1/status');
  await page.evaluate(async()=>{await __feedbackSessionCore.refreshStatus();await __feedbackSessionCore.refreshSessions();WeftReplyMotion.setVisibility(false);});
  const capture=async name=>{await page.evaluate(async()=>{for(const a of document.getAnimations())if(Number.isFinite(a.effect.getTiming().iterations))a.finish();await document.fonts.ready;await new Promise(requestAnimationFrame);});const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'));await writeFile(join(output,`${baseline?'before':'after'}-${name}.png`),Buffer.from(png,'base64'));};
  for(const theme of ['light','dark']) {
    await page.evaluate(async theme=>{WeftDesktop.setAppearance({theme});await __feedbackSessionCore.startNewConversation();},theme);
    await capture('new-chat-'+theme);
    for(const view of ['activity','library','goals','health']) {
      await page.locator('.'+view+'-entry').evaluate(n=>n.click());await page.locator('.'+view+'-surface').waitFor({state:'visible'});
      await page.waitForFunction(view=>Object.entries(__feedbackSessionCore[view==='goals'?'goalsPage':view]).every(([key,value])=>!/loading$/i.test(key)||!value),view);
      await capture(view+'-'+theme);
    }
  }
  async function check(name,run) { try { await run();console.log('PASS '+name); } catch(e) { failures.push(name+': '+e.message);console.log('FAIL '+name+': '+e.message); } }
  // Exercise the real shared renderers with controlled snapshots, as polling does.
  await check('health refresh preserves heading and date control',async()=>{
    const value=await page.evaluate(()=>{const core=__feedbackSessionCore,target=document.createElement('section');document.body.append(target);const model={...core.health,day:'2026-10-25',today:'2026-10-25',overview:{connected:false},loading:false};const view=WeftHealthView.mount({target,core:{...core,health:model}});view.render();const heading=target.querySelector('h1'),date=target.querySelector('[aria-label="选择健康日期"]');date.focus();view.render();const result={heading:heading===target.querySelector('h1'),date:date===target.querySelector('[aria-label="选择健康日期"]'),focus:document.activeElement===date};view.destroy();target.remove();return result;});assert.deepEqual(value,{heading:true,date:true,focus:true});
  });
  await check('activity refresh keeps day, row and keyboard focus connected',async()=>{
    const value=await page.evaluate(()=>{const core=__feedbackSessionCore,target=document.createElement('section');document.body.append(target);const model={...core.activity,timeZone:'Asia/Shanghai',items:[{id:'synthetic-activity',at:'2026-10-25T01:00:00Z',title:'合成提醒',summary:'整理今天的想法',type:'reminder.delivered',state:'completed',read:false,actions:[]}]};const view=WeftActivityView.mount({target,core:{...core,activity:model}});view.render();const day=target.querySelector('.activity-day'),row=target.querySelector('article'),action=row.querySelector('button');action.focus();const observer=new MutationObserver(()=>{});observer.observe(target,{childList:true,subtree:true});view.render();const mutations=observer.takeRecords().length;observer.disconnect();const result={day:day===target.querySelector('.activity-day'),row:row===target.querySelector('article'),focus:document.activeElement===action,mutations};view.destroy();target.remove();return result;});assert.deepEqual(value,{day:true,row:true,focus:true,mutations:0});
  });
  await check('goals polling preserves existing task controls',async()=>{
    const value=await page.evaluate(()=>{const core=__feedbackSessionCore,target=document.createElement('section');document.body.append(target);const model={...core.goalsPage,errors:{},tasks:[{taskId:'synthetic-task',title:'整理想法',conversationTitle:'今天的计划',status:'running',elapsedSeconds:120,canStop:true,step:'正在整理',source:{sessionId:'synthetic'}}]};const view=WeftGoalsView.mount({target,core:{...core,goalsPage:model},openSource:()=>{},toast:()=>{}});view.render();const row=target.querySelector('article'),button=row.querySelector('button');button.focus();model.loading=true;view.render();model.loading=false;view.render();const result={row:row===target.querySelector('article'),button:button===target.querySelector('article button'),focus:document.activeElement===button};view.close();target.remove();return result;});assert.deepEqual(value,{row:true,button:true,focus:true});
  });
  await check('confirmation uses common dialog, cancels and restores focus',async()=>{
    await page.evaluate(()=>{const trigger=document.querySelector('.health-entry');trigger.focus();globalThis.pagesAnswer=null;void WeftDialogs.request({title:'删除合成内容？',message:'仅用于界面测试。',danger:true}).then(value=>globalThis.pagesAnswer=value);});
    const dialog=page.getByRole('dialog',{name:'删除合成内容？'});await dialog.waitFor();await capture('dialog-dark');assert.equal(await dialog.evaluate(n=>n.classList.contains('wm-dialog')),true);await page.keyboard.press('Escape');await page.waitForFunction(()=>pagesAnswer===false);assert.equal(await page.locator('.health-entry').evaluate(n=>n===document.activeElement),true);
  });
  await check('reminder refresh keeps actions and retries after an error',async()=>{
    assert.equal(await page.evaluate(async()=>{const core=__feedbackSessionCore,target=document.createElement('section');document.body.append(target);let fail=false;const fake={...core,loadSchedules:async()=>{if(fail)throw Error('synthetic unavailable');return {items:[{id:'synthetic-reminder',text:'喝一杯水',sessionId:core.state.selectedSessionId,state:'active',timeZone:'Asia/Shanghai',repeat:{kind:'daily',time:'09:00'}}]};},scheduleDescription:()=> '每天 9:00',manageSchedule:async()=>{}};const render=WeftSchedulesView(fake,target,{autoLoad:false,openConversation:()=>{}});await render();const button=target.querySelector('li button');await render();const same=button===target.querySelector('li button');fail=true;await render();const retry=!target.querySelector('.settings-schedules-toolbar button').disabled&&!target.querySelector('ul').hasAttribute('aria-busy')&&target.textContent.includes('读取失败');target.remove();return same&&retry;}),true);
  });
  // A full health snapshot also exercises the connected layout, not just an empty page.
  const health=healthPageSynthetic({today:'2026-10-25'});
  await page.route(/\/personal\/v1\/health\/(overview|metrics|calendar|analysis)(\?|\/|$)/,route=>route.fulfill({json:health.reply(new URL(route.request().url()).pathname+new URL(route.request().url()).search)}));
  await page.evaluate(()=>__feedbackSessionCore.readHealth());await capture('health-connected-dark');
  await page.locator('.goals-entry').evaluate(n=>n.click());await page.locator('.goals-surface').waitFor({state:'visible'});
  await check('library opens without briefly revealing the conversation',async()=>{
    const visible=await page.evaluate(()=>{const core=__feedbackSessionCore,enter=core.enterAssistant;core.enterAssistant=async()=>{await new Promise(resolve=>setTimeout(resolve,50));return enter();};document.querySelector('.library-entry').click();const visible=!document.querySelector('.library-surface').hidden&&document.querySelector('#conversation-pane').hidden;core.enterAssistant=enter;return visible;});assert.equal(visible,true);
  });
  await check('reselecting the current mode preserves the draft and sidebar',async()=>{
    await page.evaluate(()=>__feedbackSessionCore.startNewConversation());
    const result=await page.evaluate(async()=>{const core=__feedbackSessionCore,start=core.startNewConversation,choose=core.chooseSidebarMode;let starts=0,choices=0;core.startNewConversation=(...args)=>{starts++;return start(...args);};core.chooseSidebarMode=(...args)=>{choices++;return choose(...args);};const field=document.getElementById('message-text');field.value='尚未发送的合成想法';document.querySelector('.conversation-mode-switch [aria-selected=true]').click();document.querySelector('[aria-label="筛选最近对话"]').click();document.querySelector('[aria-label="最近对话类型"] [aria-checked=true]').click();await new Promise(resolve=>setTimeout(resolve,0));core.startNewConversation=start;core.chooseSidebarMode=choose;return {starts,choices,draft:field.value};});assert.deepEqual(result,{starts:0,choices:0,draft:'尚未发送的合成想法'});
  });
  // The generated mobile bundle uses the same renderers at the phone viewport.
  browser=await chromium.launch({headless:true});const phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});phone.setDefaultTimeout(12000);phone.on('pageerror',e=>errors.push(e.message));
  await phone.goto(fixture.mobileUrl);await phone.waitForFunction(()=>state.booted&&state.loggedIn);
  for(const theme of ['light','dark']){
    await phone.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
    for(const view of ['activity','library','goals','health']){
      await phone.getByRole('tab',{name:new RegExp('^'+({activity:'动态',library:'成果库',goals:'目标',health:'健康'}[view])+'(?:，|$)')}).click();
      await phone.getByRole('heading',{name:({activity:'动态',library:'成果库',goals:'目标',health:'健康'}[view]),exact:true,level:1}).waitFor();
      await phone.waitForFunction(()=>!document.querySelector('#page-content .wm-skeleton'));
      assert.equal(await phone.locator('#page-content').evaluate(n=>n.scrollWidth<=n.clientWidth),true,view+' fits phone');
      await phone.screenshot({path:join(output,'after-mobile-'+view+'-'+theme+'.png')});
    }
  }
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.isVisible())),false);
  assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
} finally {
  await browser?.close();await app?.close().catch(()=>{});kill();await fixture?.close();clearTimeout(deadline);
  if(profile)await cleanup(profile);if(lock)await unlink(lock);
}
