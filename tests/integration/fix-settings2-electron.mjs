// Production shell, synthetic host, independent hidden Windows identity. No model calls.
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { startFixture } from './ux-4-fixture.mjs';
import { feedbackUiSession } from '../helpers/feedback-ui-session.mjs';

for (const stream of [process.stdout, process.stderr]) stream.on('error', error => { if (error.code !== 'EPIPE') throw error; });
const profile = await mkdtemp(join(tmpdir(), 'weftmate-settings2-'));
if (!process.env.WEFTMATE_TEST_TEMP_SCOPE) process.env.WEFTMATE_MANAGED_TEMP_ROOT = join(profile, 'fixtures');
const output = process.env.WEFTMATE_SETTINGS2_OUTPUT;
if (output) await mkdir(output, {recursive:true});
const bootstrap = join(profile, 'settings2-shell.mjs');
await writeFile(bootstrap, `import {createRequire} from 'node:module';
const {app}=createRequire(${JSON.stringify(new URL('../../package.json', import.meta.url).href)})('electron');
app.setName('WeftMate Settings2 Test');app.setAppUserModelId('com.memoweft.weftmate.test.settings2');app.disableHardwareAcceleration();
for(const stream of [process.stdout,process.stderr])stream.on('error',error=>{if(error.code!=='EPIPE')throw error});
await import(${JSON.stringify(new URL('../../scripts/review-gallery/electron.mjs', import.meta.url).href)});`);
let app, fixture, child, page;
const killTree = () => { if (child?.exitCode === null) {
  if(process.platform==='win32')spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {windowsHide:true,stdio:'ignore'});
  else child.kill('SIGKILL');
} };
const deadline = setTimeout(() => { killTree(); process.exitCode = 1; }, 160000);
const capture = async name => {
  if (!output) return;
  await page.evaluate(async()=>{for(const animation of document.getAnimations())if(Number.isFinite(animation.effect.getTiming().iterations))animation.finish();await document.fonts.ready;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
  const png = await app.evaluate(async ({BrowserWindow}) => (await BrowserWindow.getAllWindows()[0].capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'));
  await writeFile(join(output, name+'.png'),Buffer.from(png,'base64'));
};
try {
  fixture = await startFixture();
  const env = {...process.env};
  for (const key of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_)/.test(key) || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
  Object.assign(env,{REVIEW_PROFILE:profile,REVIEW_ORIGIN:fixture.origin,REVIEW_LIBRARY_TOKEN:fixture.libraryDesktopToken,REVIEW_THEME:'light',REVIEW_HIDDEN:'1',WEFTMATE_TEST_HOST_NAME:'synthetic-host'});
  app = await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:[bootstrap,'--disable-backgrounding-occluded-windows','--disable-features=CalculateNativeWinOcclusion'],env,timeout:30000});
  child=app.process(); for(const stream of [child.stdout,child.stderr]) stream?.on('error',error=>{if(error.code!=='EPIPE')throw error;});
  page=await app.firstWindow();page.setDefaultTimeout(12000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  if (process.argv.includes('--baseline')) for (const path of ['settings.css','components/shell.js','components/settings-navigation.js','components/settings-controls.js','components/cloud-settings.js']) {
    const source=execFileSync('git',['show','15739bc1:src/personal-access-ui/'+path],{encoding:'utf8',windowsHide:true});
    await page.route('**/personal/v1/ui/'+path,route=>route.fulfill({body:source,contentType:path.endsWith('.css')?'text/css':'text/javascript'}));
  }
  await feedbackUiSession(page,fixture,{native:true});
  await page.locator('#transcript .message.user,#transcript .main-chat-row').first().waitFor();
  await page.evaluate(()=>WeftReplyMotion.setVisibility(false));
  const open=async id=>{await page.evaluate(id=>WeftSettingsNavigation.open(id),id);await page.locator(`#settings-dialog .settings-category[data-category="${id}"]`).waitFor();};
  await open('general');await capture('initial-general');
  if(!process.argv.includes('--baseline')) {
    const shell=await page.locator('#settings-dialog').boundingBox();assert.ok(shell.width<=880&&shell.height<=660,'settings shell is smaller than the old 1000 by 760 window');
    assert.equal(await page.locator('#settings-dialog').evaluate(el=>parseFloat(getComputedStyle(el).transitionDuration)*1000),await page.evaluate(()=>parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dur-1'))),'settings use the shared short transition');
  }
  await open('account');await capture('initial-account');
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  if(!process.argv.includes('--baseline')) {
    const exit=await page.evaluate(()=>({inert:document.querySelector('#settings-dialog').inert,content:getComputedStyle(document.querySelector('#account-view')).display}));
    assert.equal(exit.inert,true,'closing controls become inert during the exit transition');
    assert.equal(exit.content,'flex','closing retains the content until the dialog transition ends');
  }
  await page.getByRole('button',{name:'账户菜单',exact:true}).click();await page.locator('#account-menu').waitFor();
  await capture('initial-menu');
  assert.equal(await page.locator('#account-menu').getByRole('button',{name:'退出登录',exact:true}).count(),0,'local-only account has no logout action');
  await page.waitForFunction(()=>!document.querySelector('#account-menu-usage .wm-skeleton'));
  assert.match(await page.locator('#account-menu-usage').textContent(),/^本月 ¥[\d,.]+$/,'menu keeps the cost only');
  await page.getByRole('button',{name:'帮助',exact:true}).press('ArrowRight');
  const help=page.getByRole('menu',{name:'帮助',exact:true});await help.waitFor();
  const menuBox=await page.locator('#account-menu').boundingBox(),helpBox=await help.boundingBox();
  assert.ok(helpBox.x>=menuBox.x+menuBox.width-2,'help opens beside the account menu');
  await help.getByRole('menuitem',{name:'用户指南',exact:true}).waitFor();await capture('help-submenu');
  await page.keyboard.press('Escape');assert.equal(await help.count(),0);
  await page.keyboard.press('Escape');
  // Exercise the existing cloud logout action without credentials or external requests.
  await page.evaluate(()=>{
    const core=__feedbackSessionCore;globalThis.__cloudMode=core.state.cloudAuth.mode;globalThis.__cloudLogout=core.cloudLogout;
    globalThis.__cloudLogoutCalls=0;core.state.cloudAuth.mode='authenticated';core.state.cloudAuth.email='settings@example.invalid';
    core.cloudLogout=async()=>{globalThis.__cloudLogoutCalls++;};
  });
  await page.getByRole('button',{name:'账户菜单',exact:true}).click();
  await page.locator('#account-menu').getByRole('button',{name:'退出登录',exact:true}).click();
  await page.getByRole('dialog',{name:'退出登录',exact:true}).getByRole('button',{name:'确认退出',exact:true}).click();
  assert.equal(await page.evaluate(()=>globalThis.__cloudLogoutCalls),1,'signed-in menu delegates to cloud logout');
  await page.evaluate(()=>{const core=__feedbackSessionCore;core.state.cloudAuth.mode=globalThis.__cloudMode;delete core.state.cloudAuth.email;core.cloudLogout=globalThis.__cloudLogout;});
  await open('personalization');
  const bio=page.getByRole('textbox',{name:'你的简介',exact:true});await bio.waitFor();await bio.fill('合成的未保存简介');
  await page.evaluate(()=>{globalThis.__settingsDraft=document.querySelector('#personalization-bio');globalThis.__settingsNav=document.querySelector('.settings-navigation');});
  await open('assistant');await open('personalization');
  assert.equal(await bio.inputValue(),'合成的未保存简介','category switching preserves unsaved text');
  assert.equal(await page.evaluate(()=>__settingsDraft===document.querySelector('#personalization-bio')&&__settingsNav===document.querySelector('.settings-navigation')),true,'switch changes content visibility, retaining controls and navigation');
  await page.evaluate(()=>{
    const core=__feedbackSessionCore;globalThis.__readConnectors=core.readConnectors;
    core.readConnectors=()=>new Promise(resolve=>{globalThis.__releaseConnectors=async()=>{core.readConnectors=globalThis.__readConnectors;resolve(await core.readConnectors());};});
  });
  await open('connectors');
  assert.equal(await page.locator('.connectors-view .wm-skeleton').count(),1,'connector loading uses the shared skeleton');
  assert.doesNotMatch(await page.locator('.connectors-view').innerText(),/正在读取/);
  await page.evaluate(()=>globalThis.__releaseConnectors());
  await page.locator('.connectors-view .wm-skeleton').waitFor({state:'detached'});
  await page.evaluate(()=>{globalThis.__connectorBody=document.querySelector('.connectors-view');});
  await open('general');await open('connectors');
  assert.equal(await page.evaluate(()=>globalThis.__connectorBody===document.querySelector('.connectors-view')),true,'connector controls survive returning to the category');
  await page.evaluate(()=>WeftUiComponents.factories.account(__feedbackSessionCore,{byId:id=>document.getElementById(id)}).accountModelStatus('正在读取模型…'));
  assert.equal(await page.locator('#account-models-status .wm-skeleton').count(),1,'model loading uses the shared skeleton');
  await page.evaluate(()=>document.querySelector('#account-models-status').replaceChildren());
  {
    await page.evaluate(()=>{
      const core=__feedbackSessionCore;globalThis.__readRecords=core.readExecutionRecords;globalThis.__recordReads=0;
      core.readExecutionRecords=(...args)=>{globalThis.__recordReads++;return globalThis.__recordReads===1?new Promise(resolve=>{globalThis.__releaseRecords=()=>resolve({items:[],projects:[],hasMore:false});}):globalThis.__readRecords(...args);};
    });
    await open('executionRecords');await page.waitForFunction(()=>globalThis.__recordReads===1);
    await page.evaluate(()=>{globalThis.__recordFilters=document.querySelector('.record-filters');});
    await open('general');await page.evaluate(()=>globalThis.__releaseRecords());
    await open('executionRecords');
    await page.waitForFunction(()=>globalThis.__recordReads===2);
    await page.waitForFunction(()=>!document.querySelector('.execution-records .record-skeleton,.execution-records .wm-skeleton'));
    assert.equal(await page.evaluate(()=>globalThis.__recordFilters===document.querySelector('.record-filters')),true,'record loading resumes without rebuilding filters');
    await page.evaluate(()=>{document.querySelector('[aria-label="关闭设置"]').click();WeftSettingsNavigation.open('executionRecords');});
    await page.waitForFunction(()=>globalThis.__recordReads===3);
  }
  if(!process.argv.includes('--review-records')) {
    await page.evaluate(()=>{
      const core=__feedbackSessionCore;globalThis.__loadUsage=core.loadUsage;globalThis.__usageScopes=[];
      core.loadUsage=options=>{globalThis.__usageScopes.push(options.sessionId||'');return globalThis.__loadUsage(options);};
    });
    await page.evaluate(()=>WeftSettingsNavigation.open('usage',{sessionId:__feedbackSessionCore.state.selectedSessionId}));
    await page.locator('.usage-toolbar').waitFor();await open('general');await open('usage');
    assert.equal(await page.evaluate(()=>globalThis.__usageScopes.at(-1)),'','returning to usage restores account totals');
    await page.evaluate(()=>WeftSettingsNavigation.open('usage',{sessionId:__feedbackSessionCore.state.selectedSessionId}));
    await page.locator('.usage-toolbar').waitFor();await open('usage');
    assert.equal(await page.evaluate(()=>globalThis.__usageScopes.at(-1)),'','opening default usage also resets the active conversation scope');
  }
  for(const theme of ['light','dark']) {
    await page.evaluate(theme=>WeftDesktop.setAppearance({theme}),theme);
    for(const id of ['general','personalization','assistant','notifications','reviewHealth','appearance','account','devices','usage','data','archived','models','approvals','connectors','executionRecords','memory','schedules','resources','system','backups','about']) {
      await open(id);
      const panel=page.locator(`#settings-dialog .settings-category[data-category="${id}"]`);
      await page.waitForFunction(id=>!document.querySelector(`.settings-category[data-category="${id}"] .wm-skeleton`),id);
      const size=await panel.evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,overflow:[...el.querySelectorAll('*')].filter(n=>n.clientWidth&&n.scrollWidth>n.clientWidth+1).map(n=>({name:n.tagName+'.'+n.className,w:n.clientWidth,s:n.scrollWidth})).slice(0,8)}));
      assert.ok(size.scroll<=size.width+1,id+' fits the content width '+JSON.stringify(size));
      if(['general','personalization','reviewHealth','appearance','account','models'].includes(id))await capture(id+'-'+theme);
    }
  }
  await open('appearance');
  await page.getByRole('group',{name:'颜色模式',exact:true}).getByRole('button',{name:'浅色',exact:true}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  const search=page.getByRole('searchbox',{name:'搜索设置',exact:true});
  await search.fill('固定说明');await page.locator('.settings-navigation button[data-category=personalization]').click();
  assert.equal(await bio.inputValue(),'合成的未保存简介');
  await search.fill('半透明侧边栏');assert.equal(await page.locator('.settings-navigation button[data-category=appearance]').count(),1);
  await search.fill('');
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.isVisible())),false);
  assert.deepEqual(errors,[]);
  console.log('PASS #661/#656: compact categories, retained drafts, searchable settings, account menu/submenu, hidden production Electron in both themes.');
} catch(error) {
  console.error(await page?.evaluate(()=>({view:__feedbackSessionCore.state.currentView,layout:['#settings-dialog','#account-view','.settings-content','.settings-category[data-category=general]'].map(s=>{const e=document.querySelector(s),c=getComputedStyle(e),r=e.getBoundingClientRect();return {s,hidden:e.hidden,open:e.open,display:c.display,opacity:c.opacity,w:r.width,h:r.height};})})).catch(()=>null));
  await capture('failure').catch(()=>{});throw error;
}
finally {const closeDeadline=setTimeout(killTree,5000);await app?.close().catch(()=>{});killTree();clearTimeout(closeDeadline);clearTimeout(deadline);await fixture?.close();await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
