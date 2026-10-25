// Real production desktop shell with an isolated identity and synthetic personal host.
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, open, readdir, lstat, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { startFixture } from './ux-4-fixture.mjs';
import { feedbackUiSession } from '../helpers/feedback-ui-session.mjs';

const baseline = process.argv.includes('--baseline');
const output = process.env.WEFTMATE_FE_SETTINGS_OUTPUT;
assert.ok(output, 'Set an evidence directory outside the repository');
const locks = process.env.WEFTMATE_TEST_LOCKS;
assert.ok(locks, 'Set WEFTMATE_TEST_LOCKS to the available heavy slots');
let app, child, fixture, profile, lock, page;
const errors = [], failures = [];
const kill = () => { if (child?.exitCode === null) { if(process.platform==='win32')spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide:true, stdio:'ignore', timeout:5000 });else child.kill('SIGKILL'); } };
const deadline = setTimeout(() => { kill(); process.exitCode = 1; }, 240000);
async function cleanup(directory) {
  const rel = relative(tmpdir(), directory);
  assert.ok(rel && !isAbsolute(rel) && !rel.startsWith('..') && rel.startsWith('weftmate-fe-settings-'));
  async function links(path) { for (const entry of await readdir(path,{withFileTypes:true})) { const p=join(path,entry.name); if ((await lstat(p)).isSymbolicLink()) await unlink(p); else if(entry.isDirectory()) await links(p); } }
  await links(directory); await rm(directory,{recursive:true,force:true});
}
async function check(name, run) { if(process.argv.includes('--draft-only')&&!name.startsWith('account connection'))return;try { await run(); console.log('PASS '+name); } catch (error) { failures.push(name+': '+error.message); console.log('FAIL '+name+': '+error.message); } }
async function finishMotion() { await page.evaluate(async paint=>{await document.fonts.ready;for(let i=0;i<3;i++){for(const a of document.getAnimations())if(Number.isFinite(a.effect.getTiming().iterations))a.finish();if(paint)await new Promise(requestAnimationFrame);else await Promise.resolve();}},process.env.WEFTMATE_FE_SETTINGS_CAPTURE!=='0'); }
async function capture(name, settle = true) {
  if(process.env.WEFTMATE_FE_SETTINGS_CAPTURE==='0')return;
  if (settle) await finishMotion();
  const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'));
  await writeFile(join(output,`${baseline?'before':'after'}-${name}.png`),Buffer.from(png,'base64'));
}
async function category(id) {
  await page.evaluate(id=>WeftSettingsNavigation.open(id),id);
  await page.locator(`#settings-dialog .settings-category[data-category="${id}"]`).waitFor({state:'visible'});
  await page.waitForFunction(id=>!document.querySelector(`.settings-category[data-category="${id}"] .wm-skeleton`),id,{timeout:10000});
  await finishMotion();
}
try {
  for (let n=1;n<=3;n++) { const path=join(locks,`heavy-${n}.lock`); try { const handle=await open(path,'wx');await handle.writeFile('FE-SETTINGS '+new Date().toISOString());await handle.close();lock=path;break; } catch(error) { if(error.code!=='EEXIST')throw error; } }
  assert.ok(lock,'No heavy slot available');await mkdir(output,{recursive:true});
  profile=await mkdtemp(join(tmpdir(),'weftmate-fe-settings-'));
  if(!process.env.WEFTMATE_TEST_TEMP_SCOPE)process.env.WEFTMATE_MANAGED_TEMP_ROOT=join(profile,'fixtures');
  fixture=await startFixture();
  const bootstrap=join(profile,'shell.mjs');
  await writeFile(bootstrap,`import {createRequire} from 'node:module';const {app}=createRequire(${JSON.stringify(new URL('../../package.json',import.meta.url).href)})('electron');app.setName('WeftMate FE Settings Test');app.setAppUserModelId('com.memoweft.weftmate.test.fe-settings');app.disableHardwareAcceleration();for(const s of [process.stdout,process.stderr])s.on('error',e=>{if(e.code!=='EPIPE')throw e});await import(${JSON.stringify(new URL('../../scripts/review-gallery/electron.mjs',import.meta.url).href)});`);
  const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
  Object.assign(env,{REVIEW_PROFILE:profile,REVIEW_ORIGIN:fixture.origin,REVIEW_LIBRARY_TOKEN:fixture.libraryDesktopToken,REVIEW_THEME:'light',REVIEW_HIDDEN:'1',WEFTMATE_TEST_HOST_NAME:'synthetic-host'});
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:[bootstrap,'--disable-backgrounding-occluded-windows','--disable-features=CalculateNativeWinOcclusion'],env,timeout:30000});
  child=app.process();child.stdout?.resume();child.stderr?.resume();page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  if(process.argv.includes('--baseline-nav')){
    const original=spawnSync('git',['show','HEAD:src/personal-access-ui/components/settings-navigation.js'],{encoding:'utf8',windowsHide:true,timeout:5000});assert.equal(original.status,0);
    await page.route('**/personal/v1/ui/components/settings-navigation.js',route=>route.fulfill({body:original.stdout,contentType:'text/javascript'}));
  }
  await feedbackUiSession(page,fixture,{native:true});
  await page.locator('#transcript .message.user,#transcript .main-chat-row').first().waitFor();
  await page.evaluate(()=>WeftReplyMotion.setVisibility(false));
  const ids=await page.evaluate(()=>WeftUiCore.settingsRegistry().list({desktop:true}).map(c=>c.id));
  for(const theme of process.argv.includes('--updates-only')||process.argv.includes('--draft-only')?[]:['light','dark']) {
    await page.evaluate(theme=>WeftDesktop.setAppearance({theme}),theme);
    for(const id of ids) { await category(id); await capture(id+'-'+theme); console.log('CAPTURE '+id+' '+theme); }
  }
  await check('update checks retain the last version while awaiting a response',async()=>{
    await category('general');
    await page.evaluate(()=>{const core=__feedbackSessionCore;globalThis.__updateOriginal={read:core.readUpdateState,check:core.checkUpdates};core.readUpdateState=async()=>({layers:[{layer:'app',currentVersion:'0.2.0-synthetic',status:'current'}],channel:'preview',canChangeChannel:true,canRestart:false});core.checkUpdates=()=>new Promise(resolve=>globalThis.__updateRelease=resolve);});
    try {
      await category('about');await page.getByText('当前 0.2.0-synthetic',{exact:false}).waitFor();
      await page.evaluate(()=>globalThis.__updateRow=[...document.querySelectorAll('#settings-updates .settings-row')].find(n=>n.textContent.includes('0.2.0-synthetic')));
      await page.locator('#settings-updates').getByRole('button',{name:'检查更新',exact:true}).click();
      await page.waitForFunction(()=>!!globalThis.__updateRelease);
      assert.equal(await page.evaluate(()=>__updateRow.isConnected&&document.querySelector('#settings-updates').textContent.includes('0.2.0-synthetic')&&!document.querySelector('#settings-updates .wm-skeleton')),true);
      await capture('updates-checking');
    } finally {
      await page.evaluate(()=>{globalThis.__updateRelease?.({layers:[{layer:'app',currentVersion:'0.2.0-synthetic',status:'current'}]});__feedbackSessionCore.readUpdateState=__updateOriginal.read;__feedbackSessionCore.checkUpdates=__updateOriginal.check;delete globalThis.__updateRelease;});
      await category('general');
    }
  });
  await check('download polling preserves rows, progress, focus and retry actions',async()=>{
    await category('general');
    await page.evaluate(()=>{
      const core=__feedbackSessionCore;globalThis.__updateOriginal={read:core.readUpdateState,check:core.checkUpdates,restart:core.restartForUpdate};
      globalThis.__downloadValue={layers:[{layer:'app',currentVersion:'0.2.0-synthetic',availableVersion:'0.2.1-synthetic',status:'downloading',progress:{percent:35,transferred:35*1048576,total:100*1048576,bytesPerSecond:1048576}}],channel:'preview',canChangeChannel:false,canRestart:false};
      globalThis.__downloadReads=0;core.readUpdateState=()=>{__downloadReads++;return __downloadReads===1?Promise.resolve(__downloadValue):new Promise(resolve=>globalThis.__downloadRelease=resolve);};
    });
    try {
      await category('about');const progress=page.getByRole('progressbar',{name:'Windows 程序下载进度'});await progress.waitFor();
      assert.equal(await progress.evaluate(n=>n.value),35);await capture('updates-download-35');
      await page.evaluate(()=>{globalThis.__downloadRow=document.querySelector('[data-update-layer=app]');document.querySelector('#settings-updates button').focus();});
      await page.waitForFunction(()=>!!globalThis.__downloadRelease);
      assert.equal(await page.evaluate(()=>__downloadRow.isConnected&&!document.querySelector('#settings-updates .wm-skeleton')&&document.activeElement===document.querySelector('#settings-updates button')),true);
      await page.evaluate(()=>{__downloadValue.layers[0].progress.percent=67;__downloadValue.layers[0].progress.transferred=67*1048576;__downloadRelease(__downloadValue);delete globalThis.__downloadRelease;});
      await page.waitForFunction(()=>document.querySelector('.settings-update-progress').value===67);await capture('updates-download-67');
      assert.equal(await page.evaluate(()=>__downloadRow===document.querySelector('[data-update-layer=app]')),true);
      await page.evaluate(()=>{__feedbackSessionCore.readUpdateState=async()=>({...__downloadValue,layers:[{...__downloadValue.layers[0],status:'error',error:'合成网络中断，请重试。'}]});});
      await category('general');await category('about');await page.getByRole('button',{name:'重试更新',exact:true}).waitFor();await capture('updates-failed');
      await page.evaluate(()=>{__feedbackSessionCore.readUpdateState=async()=>({...__downloadValue,canRestart:true,layers:[{...__downloadValue.layers[0],status:'downloaded'}]});__feedbackSessionCore.restartForUpdate=async()=>{globalThis.__restartCalls=(globalThis.__restartCalls||0)+1;return {restarted:false,reason:'合成任务仍在运行，请稍后重试。'};};});
      await category('general');await category('about');const restart=page.getByRole('button',{name:'重启并更新',exact:true});await restart.waitFor();await capture('updates-ready');await restart.click();await page.getByText('合成任务仍在运行，请稍后重试。',{exact:true}).waitFor();assert.equal(await restart.isEnabled(),true);assert.equal(await page.evaluate(()=>__restartCalls),1);
    } finally {
      await page.evaluate(()=>{globalThis.__downloadRelease?.(__downloadValue);__feedbackSessionCore.readUpdateState=__updateOriginal.read;__feedbackSessionCore.checkUpdates=__updateOriginal.check;__feedbackSessionCore.restartForUpdate=__updateOriginal.restart;delete globalThis.__downloadRelease;});await category('general');
    }
  });
  await check('category change retains live fields and unsaved text',async()=>{
    await category('personalization');const field=page.getByRole('textbox',{name:'你的简介',exact:true});await field.fill('合成的未保存简介');
    await page.evaluate(()=>globalThis.__settingsDraft=document.querySelector('#personalization-bio'));
    await category('assistant');await category('personalization');
    assert.equal(await field.inputValue(),'合成的未保存简介');
    assert.equal(await page.evaluate(()=>__settingsDraft===document.querySelector('#personalization-bio')),true);
  });
  await check('category transition keeps both pages until it settles',async()=>{
    await category('general');await finishMotion();
    const state=await page.evaluate(()=>{WeftSettingsNavigation.open('appearance');return [...document.querySelectorAll('.settings-category')].filter(n=>!n.hidden).map(n=>n.dataset.category);});
    assert.deepEqual(state.sort(),['appearance','general']);await finishMotion();
    assert.equal(await page.locator('.settings-category:not([hidden])').count(),1);
  });
  await check('transitions run forward and back without emptying either page',async()=>{
    await category('general');await finishMotion();
    for(const id of ['appearance','general']){
      await page.evaluate(id=>WeftSettingsNavigation.open(id),id);
      const values=await page.evaluate(()=>document.querySelector('.settings-content').getAnimations({subtree:true}).map(a=>({duration:a.effect.getTiming().duration,frames:a.effect.getKeyframes()})));
      assert.ok(values.some(a=>a.duration===420));
      for(const elapsed of [0,80,180,300,419]) { await page.evaluate(elapsed=>{for(const a of document.querySelector('.settings-content').getAnimations({subtree:true})){a.pause();a.currentTime=elapsed;}},elapsed);await capture(`motion-${id}-${elapsed}`,false); }
      await finishMotion();
    }
  });
  await check('expanded editors animate real height and keep unsaved input',async()=>{
    await category('personalization');const summary=page.locator('.settings-editor > summary').filter({hasText:'固定说明'});await summary.click();
    const editor=summary.locator('..');const animation=await editor.evaluate(n=>n.getAnimations().map(a=>a.effect.getKeyframes().map(f=>f.height)));
    assert.ok(animation.some(frames=>frames[0]!==frames.at(-1)));await finishMotion();
    const field=page.getByRole('textbox',{name:'固定说明',exact:true});await field.fill('合成的固定说明');await summary.click();await finishMotion();await summary.click();await finishMotion();assert.equal(await field.inputValue(),'合成的固定说明');
    await capture('personalization-expanded');
  });
  await check('reduced motion settles category and disclosure changes immediately',async()=>{
    await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>WeftReplyMotion.setPreference('system'));
    await category('general');await page.evaluate(()=>WeftSettingsNavigation.open('appearance'));
    assert.equal(await page.locator('.settings-category:not([hidden])').count(),1);
    assert.equal(await page.locator('.settings-content').evaluate(n=>n.getAnimations({subtree:true}).length),0);
    await page.emulateMedia({reducedMotion:'no-preference'});
  });
  await check('reselect does not replay content or replace navigation',async()=>{
    await category('appearance');await finishMotion();
    assert.equal(await page.evaluate(()=>{const panel=document.querySelector('.settings-category[data-category=appearance]');const nav=document.querySelector('.settings-navigation');WeftSettingsNavigation.open('appearance');return nav===document.querySelector('.settings-navigation')&&!panel.getAnimations().length;}),true);
  });
  await check('model keys and account passwords remain masked',async()=>{
    assert.equal(await page.locator('#account-model-key').getAttribute('type'),'password');
    assert.equal(await page.locator('#current-password').getAttribute('type'),'password');
  });
  await check('settings search reveals a collapsed editor without resetting drafts',async()=>{
    const search=page.getByRole('searchbox',{name:'搜索设置'});await search.fill('固定说明');
    await page.locator('.settings-navigation button[data-category=personalization]').click();
    await page.getByRole('textbox',{name:'固定说明',exact:true}).waitFor();
    assert.equal(await page.getByRole('textbox',{name:'你的简介',exact:true}).inputValue(),'合成的未保存简介');await search.fill('');
  });
  await check('account connection state is accurate for a local account',async()=>{
    await category('account');assert.equal(await page.locator('#cloud-login-state').isVisible(),false);assert.equal(await page.locator('#cloud-email').textContent(),'尚未登录');
    await page.getByRole('textbox',{name:'显示昵称',exact:true}).fill('合成的未保存昵称');await category('general');await category('account');
    assert.equal(await page.getByRole('textbox',{name:'显示昵称',exact:true}).inputValue(),'合成的未保存昵称');
    await category('memory');await category('account');assert.equal(await page.getByRole('textbox',{name:'显示昵称',exact:true}).inputValue(),'合成的未保存昵称','visiting memory preserves the profile draft');
  });
  await check('every settings category fits a narrow desktop and remains reachable',async()=>{
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(920,700));
    for(const id of ids){await category(id);await finishMotion();const size=await page.locator(`.settings-category[data-category="${id}"]`).evaluate(n=>({w:n.clientWidth,s:n.scrollWidth}));assert.ok(size.s<=size.w+1,id+' overflows '+JSON.stringify(size));}
    await capture('narrow-about');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(640,700));
    for(const id of ['account','appearance','models','backups','data','usage']){await category(id);await finishMotion();const size=await page.locator(`.settings-category[data-category="${id}"]`).evaluate(n=>({w:n.clientWidth,s:n.scrollWidth}));assert.ok(size.s<=size.w+1,id+' small window overflows '+JSON.stringify(size));if(['account','appearance'].includes(id))await capture('small-window-'+id);}
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1200,800));
  });
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.isVisible())),false);
  await writeFile(join(output,`${baseline?'before':'after'}-results.json`),JSON.stringify({ids,errors,failures},null,2));
  assert.deepEqual(errors,[]);if(!baseline)assert.deepEqual(failures,[]);
} finally {
  await app?.close().catch(()=>{});kill();await fixture?.close();clearTimeout(deadline);
  if(profile)await cleanup(profile);if(lock)await unlink(lock);
}
