// Production Windows shell, a hidden independent identity and synthetic host.
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { startFixture } from './ux-4-fixture.mjs';
import { feedbackUiSession } from '../helpers/feedback-ui-session.mjs';

const baseline = process.argv.includes('--before');
const refreshBaseline=process.argv.includes('--refresh-before');
const profile = await mkdtemp(join(tmpdir(), 'weftmate-fe-shell-'));
if (!process.env.WEFTMATE_TEST_TEMP_SCOPE) process.env.WEFTMATE_MANAGED_TEMP_ROOT = join(profile, 'fixtures');
const output = process.env.WEFTMATE_FE_SHELL_OUTPUT;
if (output) await mkdir(output, {recursive:true});
const bootstrap = join(profile, 'shell.mjs');
await writeFile(bootstrap, `import {createRequire} from 'node:module';
const {app}=createRequire(${JSON.stringify(new URL('../../package.json',import.meta.url).href)})('electron');
app.setName('WeftMate FE Shell Test');app.setAppUserModelId('com.memoweft.weftmate.test.fe-shell');app.disableHardwareAcceleration();
await import(${JSON.stringify(new URL('../../scripts/review-gallery/electron.mjs',import.meta.url).href)});`);
let app, fixture, child;
const kill = () => { if(child?.exitCode === null) {
  if(process.platform==='win32')spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:5000});
  else child.kill('SIGKILL');
} };
const deadline = setTimeout(()=>{kill();process.exitCode=1;},150000);
const failures = [], errors = [];
try {
  fixture = await startFixture();
  const env = {...process.env};
  for(const k of Object.keys(env)) if(/^(WEFTMATE_|MEMOWEFT_)/.test(k)||k==='ELECTRON_RUN_AS_NODE') delete env[k];
  Object.assign(env,{REVIEW_PROFILE:profile,REVIEW_ORIGIN:fixture.origin,REVIEW_LIBRARY_TOKEN:fixture.libraryDesktopToken,REVIEW_THEME:'light',REVIEW_HIDDEN:'1',WEFTMATE_TEST_HOST_NAME:'synthetic-host'});
  app = await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:[bootstrap,'--disable-backgrounding-occluded-windows','--disable-features=CalculateNativeWinOcclusion'],env,timeout:30000});
  child=app.process();child.stdout?.resume();child.stderr?.resume();
  const page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  if(baseline||refreshBaseline){const source=execFileSync('git',['show','HEAD:src/ui-core/controls.js'],{encoding:'utf8',windowsHide:true});await page.route('**/personal/v1/ui/ui-core/controls.js',route=>route.fulfill({body:source,contentType:'text/javascript'}));}
  await feedbackUiSession(page,fixture,{native:true});await page.unroute('**/personal/v1/status');
  await page.evaluate(async()=>{await __feedbackSessionCore.refreshStatus();await __feedbackSessionCore.refreshSessions();WeftReplyMotion.setVisibility(false);});
  const settle=async()=>{for(let pass=0;pass<2;pass++){
    await page.evaluate(async()=>{await document.fonts.ready;for(const a of document.getAnimations())if(Number.isFinite(a.effect.getTiming().iterations))a.finish();await Promise.resolve();});
    // A hidden Electron window can defer idle RAFs. capturePage flushes its
    // actual compositor without ever showing the test window to the user.
    await app.evaluate(async({BrowserWindow})=>{await BrowserWindow.getAllWindows()[0].capturePage(undefined,{stayHidden:true,stayAwake:true});});
  }};
  const capture=async name=>{if(!output)return;const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'));await writeFile(join(output,`${baseline?'before':'after'}-${name}.png`),Buffer.from(png,'base64'));};
  async function check(name, run) {try {await run();console.log('PASS '+name);}catch(e){failures.push(name+': '+e.message);console.log('FAIL '+name+': '+e.message);}}
  await check('refresh preserves usable controls and only the newest load settles',async()=>{
    const probe=()=>page.evaluate(()=>{const box=document.createElement('div'),button=document.createElement('button');button.textContent='可用内容';box.append(button);document.body.append(box);button.focus();const first=WeftControls.loading(box),second=WeftControls.loading(box);const kept=button.isConnected&&document.activeElement===button;const stale=first(),busy=box.getAttribute('aria-busy'),latest=second();const result={kept,stale,busy,latest,ready:!box.hasAttribute('aria-busy')};box.remove();return result;});
    assert.deepEqual(await probe(),{kept:true,stale:false,busy:'true',latest:true,ready:true});
  });
  if(refreshBaseline)assert.deepEqual(failures,[]);
  for(const theme of ['light','dark']) {
    await page.evaluate(async theme=>{WeftDesktop.setAppearance({theme});await __feedbackSessionCore.startNewConversation();},theme);await settle();await capture('new-'+theme);
    await page.getByRole('button',{name:'账户菜单',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#account-menu-usage .wm-skeleton'));await settle();await capture('account-'+theme);await page.keyboard.press('Escape');await settle();
    await page.locator('.conversation-mode-switch [data-draft-mode=work]').click();await settle();await capture('work-'+theme);
    await page.locator('.activity-entry').evaluate(n=>n.click());await settle();await capture('activity-'+theme);
  }
  await page.evaluate(async()=>{await __feedbackSessionCore.startNewConversation();});await settle();
  await check('mode selection keeps an unsent draft and new opens from every page',async()=>{
    await page.locator('#message-text').fill('还没发送的想法');await page.locator('.conversation-mode-switch [data-draft-mode=work]').click();
    await page.waitForFunction(()=>__feedbackSessionCore.currentConversationMode()==='work');await settle();assert.equal(await page.locator('#message-text').inputValue(),'还没发送的想法');
    await page.locator('.conversation-mode-switch [data-draft-mode=chat]').click();await page.waitForFunction(()=>__feedbackSessionCore.currentConversationMode()==='chat');assert.equal(await page.locator('#message-text').inputValue(),'还没发送的想法');
    await page.locator('.goals-entry').click();await page.locator('#new-session').click();await page.waitForFunction(()=>!document.querySelector('#conversation-pane').hidden);await settle();assert.equal(await page.locator('.conversation-mode-switch').isVisible(),true);
  });
  await check('sidebar continuously pushes the main workspace',async()=>{
    await page.evaluate(()=>WeftDesktop.toggleRail(false));await settle();
    const result=await page.evaluate(async()=>{
      const rail=document.getElementById('session-rail'), main=document.querySelector('.assistant-main');
      const full=rail.getBoundingClientRect().width,x=main.getBoundingClientRect().x;
      WeftDesktop.toggleRail(true);
      for(const a of rail.getAnimations()) {a.pause();a.currentTime=160;}
      return {full,x,mid:rail.getBoundingClientRect().width,main:main.getBoundingClientRect().x,animations:rail.getAnimations().map(a=>({time:a.currentTime,frames:a.effect.getKeyframes()})),classes:document.body.className,reduced:WeftMotion.reduced};
    });assert.ok(result.mid>0&&result.mid<result.full,JSON.stringify(result));assert.ok(result.main>0&&result.main<result.x,JSON.stringify(result));
    for(const time of [0,130,260,420]){await page.evaluate(time=>{for(const a of document.querySelector('#session-rail').getAnimations()){a.pause();a.currentTime=Math.min(time,a.effect.getTiming().duration);}},time);await capture('rail-frame-'+time);}
    await settle();await capture('rail-collapsed');await page.evaluate(()=>WeftDesktop.toggleRail(false));await settle();
  });
  await check('details interpolates actual layout height in both directions',async()=>{
    const result=await page.evaluate(async()=>{
      const d=document.createElement('details');d.id='shell-details-probe';d.innerHTML='<summary>合成详情</summary><div style="height:240px">展开内容</div>';document.querySelector('.assistant-main').append(d);WeftMotion.details(d);
      const short=d.getBoundingClientRect().height;d.querySelector('summary').click();
      const animation=d.getAnimations().find(a=>a.effect.getKeyframes().some(f=>f.height));
      if(!animation)return {short,animated:false};animation.pause();animation.currentTime=160;
      const mid=d.getBoundingClientRect().height;animation.finish();await Promise.resolve();
      const full=d.getBoundingClientRect().height;d.querySelector('summary').click();const closing=d.getAnimations().find(a=>a.effect.getKeyframes().some(f=>f.height));closing.pause();closing.currentTime=160;
      const closingMid=d.getBoundingClientRect().height;closing.finish();await Promise.resolve();const closed=!d.open;d.remove();return {animated:true,short,mid,full,closingMid,closed};
    });assert.equal(result.animated,true);assert.ok(result.mid>result.short&&result.mid<result.full,JSON.stringify(result));assert.ok(result.closingMid>result.short&&result.closingMid<result.full,JSON.stringify(result));assert.equal(result.closed,true);
  });
  await check('reselecting the current session does not fetch history or replay it',async()=>{
    await page.evaluate(async id=>__feedbackSessionCore.selectSession(id),fixture.source);await settle();
    const history=[];const listener=req=>{if(/\/history(?:\?|$)/.test(req.url()))history.push(req.url());};page.on('request',listener);
    const same=await page.evaluate(async()=>{const row=document.querySelector('.session-row > .is-current');const transcript=document.querySelector('#transcript');const original=transcript.firstElementChild;row.click();await new Promise(requestAnimationFrame);return original===transcript.firstElementChild;});
    page.off('request',listener);assert.equal(same,true);assert.equal(history.length,0);
  });
  await check('page handoff retains an inert outgoing surface and has no empty frame',async()=>{
    await page.evaluate(()=>document.querySelector('.activity-entry').click());await settle();
    const state=await page.evaluate(async()=>{document.querySelector('.goals-entry').click();await Promise.resolve();await Promise.resolve();return {copies:[...document.querySelectorAll('.motion-copy')].filter(n=>n.inert&&n.getAttribute('aria-hidden')==='true').length,visible:!document.querySelector('.goals-surface').hidden};});
    assert.equal(state.visible,true);assert.ok(state.copies>=1);await settle();
  });
  await check('async handoff retains content while the next presentation is pending',async()=>{
    if(baseline)return;
    assert.equal(await page.evaluate(async()=>{const target=document.createElement('section');target.textContent='原内容';document.body.append(target);let done;const operation=WeftMotion.handoff(target,()=>new Promise(resolve=>{done=resolve;target.replaceChildren();}));const copy=[...document.querySelectorAll('.motion-copy')].some(node=>node.textContent==='原内容'&&node.inert);done();await operation;target.remove();return copy;}),true);
  });
  await check('common dialog keeps its exit, cancellation and focus',async()=>{
    await page.evaluate(()=>{const b=document.querySelector('.goals-entry');b.focus();globalThis.shellAnswer=null;void WeftDialogs.request({title:'合成确认',message:'保留焦点与取消动作'}).then(v=>globalThis.shellAnswer=v);});await settle();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog',{name:'合成确认'}).count(),1,'outgoing dialog remains during the exit');
    await settle();await page.waitForFunction(()=>shellAnswer===false);assert.equal(await page.locator('.goals-entry').evaluate(n=>n===document.activeElement),true);
  });
  await check('shell remains usable in a narrow Windows window',async()=>{
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(760,680));await page.evaluate(async()=>{await __feedbackSessionCore.startNewConversation();document.querySelector('#new-session').click();});await page.waitForFunction(()=>!document.querySelector('#conversation-pane').hidden);await settle();await capture('narrow-new-dark');
    assert.equal(await page.locator('.assistant-shell').evaluate(n=>n.scrollWidth<=n.clientWidth+1),true);
    assert.equal(await page.locator('.session-rail').evaluate(n=>n.querySelector('.rail-mode-switch').getBoundingClientRect().right<=n.getBoundingClientRect().right),true,'both history modes stay inside the narrow sidebar');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1200,800));
  });
  await check('reduced motion settles layout immediately',async()=>{
    await page.emulateMedia({reducedMotion:'reduce'});
    const state=await page.evaluate(()=>{const d=document.querySelector('#shell-details-probe')||document.createElement('details');if(!d.isConnected){d.innerHTML='<summary>合成</summary><div>内容</div>';document.body.append(d);WeftMotion.details(d);}d.querySelector('summary').click();const result={open:d.open,animations:d.getAnimations().length};d.remove();return result;});assert.deepEqual(state,{open:true,animations:0});
  });
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.isVisible())),false);assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
} finally {await app?.close().catch(()=>{});kill();await fixture?.close();clearTimeout(deadline);const rel=relative(tmpdir(),profile);assert.ok(rel&&!isAbsolute(rel)&&!rel.startsWith('..')&&rel.startsWith('weftmate-fe-shell-'));await rm(profile,{recursive:true,force:true});}
