/** Production Electron and generated Android assets, synthetic accounts/random ports. */
import assert from 'node:assert/strict';
import {_electron,chromium} from 'playwright';
import {createRequire} from 'node:module';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {startTimelineCandidate} from './timeline-ui-candidate.mjs';
import {localUiSession} from '../helpers/local-ui-session.mjs';
const root=resolve(import.meta.dirname,'../..'),out=join(root,'tests/evidence/r0-5');await mkdir(out,{recursive:true});
const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
const report={screenshots:[],checks:[],errors:[],modelRequests:0};let f,app,browser,profile;
const b=(p,name)=>p.getByRole('button',{name,exact:true}).filter({visible:true});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function shot(p,surface,theme,scene){await wait(120);const file=`${surface}-${theme}-${scene}.png`;await p.screenshot({path:join(out,file)});report.screenshots.push(file);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,file);console.log(file);}
async function searchReady(p){await p.waitForFunction(()=>document.querySelector('#search-results')?.getAttribute('aria-busy')==='false');}
async function desktopScenes(p,surface,theme){
  await p.evaluate(()=>WeftDesktop.toggleRail(false));await b(p,'账户菜单').click();await b(p,'帮助').waitFor();await shot(p,surface,theme,'avatar-menu');await b(p,'帮助').click();
  await p.getByRole('heading',{name:'帮助与小技巧',exact:true}).waitFor();assert.equal(await p.locator('#assistant-title').textContent(),'帮助与小技巧');assert.equal(await p.locator('#conversation-resources').isVisible(),false);
  await shot(p,surface,theme,'help');const search=p.getByRole('searchbox',{name:'搜索帮助'});await search.fill('记忆 纠正');assert.equal(await p.locator('.help-topic').count(),1);await shot(p,surface,theme,'help-filter');
  await search.fill('zz-no-result');await b(p,'清除搜索').waitFor();await shot(p,surface,theme,'help-empty');await b(p,'清除搜索').click();await b(p,'打开目标').click();await p.getByRole('heading',{name:'目标',exact:true}).waitFor();
  await p.keyboard.press('Control+k');await searchReady(p);await shot(p,surface,theme,'search-actions');await p.getByRole('option').filter({hasText:'更新内容'}).click();await p.getByRole('heading',{name:'更新内容',exact:true}).waitFor();await p.getByText('当前版本',{exact:true}).waitFor();await shot(p,surface,theme,'releases');
  await p.locator('.help-surface .release-toggle').first().click();await shot(p,surface,theme,'release-collapsed');await b(p,'返回对话').click();
  await p.keyboard.press('Control+/');await p.getByRole('dialog',{name:'快捷键一览'}).waitFor();const ids=await p.locator('.shortcuts-panel [data-shortcut-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.shortcutId));const registry=await p.evaluate(()=>WeftShortcuts.rows.map(row=>row.id));assert.deepEqual(ids,registry);await shot(p,surface,theme,'shortcuts');await b(p,'关闭快捷键').click();
  await p.keyboard.press('Control+,');if(surface.endsWith('480')){await p.getByRole('combobox',{name:'设置分类'}).click();await p.getByRole('option',{name:/关于/}).click();}else await b(p,'关于').click();await b(p,'更新内容').waitFor();await shot(p,surface,theme,'settings-about');await b(p,'更新内容').click();await p.getByRole('heading',{name:'更新内容',exact:true}).waitFor();await b(p,'返回对话').click();
}
try{
  f=await startTimelineCandidate({daily:true,logicalMobile:true,sidebar:true,interactive:true,goals:true,historyCount:0});
  profile=await mkdtemp(join(tmpdir(),'weftmate-r05-electron-'));
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:root,args:['scripts/review-gallery/electron.mjs','--force-device-scale-factor=1'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:f.origin,REVIEW_THEME:'light'}});
  await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('wm:desktop:update-state');ipcMain.handle('wm:desktop:update-state',()=>({layers:[{layer:'ui',currentVersion:'0.1.0'},{layer:'app',currentVersion:'0.1.0'}],canRestart:false}));});
  const p=await app.firstWindow();p.setDefaultTimeout(15000);p.on('pageerror',e=>{report.errors.push(e.message);console.log(e.stack);});await localUiSession(p,f.credentials,undefined,{mainChat:true});await b(p,'WeftMate 主对话').waitFor();
  // Observe a synthetic prior installed version, then reload through the real shell.
  await p.evaluate(()=>{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key.startsWith('weftmate-release-seen:'))localStorage.setItem(key,JSON.stringify({current:'0.0.9',seen:['0.0.9']}));}});await p.reload();await b(p,'关闭更新提示').waitFor();await shot(p,'electron-1200','light','update-notice');await b(p,'关闭更新提示').click();await p.reload();await b(p,'WeftMate 主对话').waitFor();await wait(200);assert.equal(await b(p,'关闭更新提示').count(),0);report.checks.push('notice-dismiss-and-reload-once');
  // A different version shows once; opening the notice goes to the reading page.
  await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('wm:desktop:update-state');ipcMain.handle('wm:desktop:update-state',()=>({layers:[{layer:'ui',currentVersion:'0.1.1'},{layer:'app',currentVersion:'0.1.0'}],canRestart:false}));});
  await p.reload();await b(p,'关闭更新提示').waitFor();await p.getByRole('button',{name:'已更新到 0.1.1 · 看看有什么新东西',exact:true}).click();await p.getByRole('heading',{name:'更新内容',exact:true}).waitFor();await b(p,'返回对话').click();
  await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('wm:desktop:update-state');ipcMain.handle('wm:desktop:update-state',()=>({layers:[{layer:'ui',currentVersion:'0.1.0'},{layer:'app',currentVersion:'0.1.0'}],canRestart:false}));});
  for(const width of [1200,480]){await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,800),width);for(const theme of ['light','dark']){
    await p.evaluate(()=>{for(const key of Object.keys(localStorage))if(key.startsWith('weftmate-release-seen:'))localStorage.setItem(key,JSON.stringify({current:'0.0.9',seen:['0.0.9']}));});await p.reload();await b(p,'关闭更新提示').waitFor();await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);await shot(p,`electron-${width}`,theme,'update-notice');await b(p,'关闭更新提示').click();await desktopScenes(p,`electron-${width}`,theme);
  }}
  // Exercise the actual table's search bindings, including the operation menu.
  await p.keyboard.press('Control+k');await searchReady(p);const searchInput=p.getByRole('combobox',{name:'搜索内容'});await searchInput.press('ArrowRight');await searchReady(p);assert.equal(await p.getByRole('tab',{name:'对话',exact:true}).getAttribute('aria-selected'),'true');await searchInput.press('ArrowLeft');await searchReady(p);await searchInput.press('ArrowDown');await searchInput.press('ArrowUp');await p.getByRole('tab',{name:'全部',exact:true}).focus();await p.keyboard.press('End');assert.equal(await p.getByRole('option').last().getAttribute('aria-selected'),'true');await p.keyboard.press('Home');assert.equal(await p.getByRole('option').first().getAttribute('aria-selected'),'true');await searchInput.focus();await searchInput.press('Alt+Enter');await p.getByRole('menu').waitFor();await p.keyboard.press('Escape');await searchInput.focus();await searchInput.press('Escape');await wait(150);
  await p.keyboard.press('Control+k');await searchReady(p);await p.getByRole('option').filter({hasText:'快捷键一览'}).click();await p.getByRole('dialog',{name:'快捷键一览'}).waitFor();await p.keyboard.press('Escape');
  // Loading uses the same page while the real update adapter is pending.
  await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('wm:desktop:update-state');ipcMain.handle('wm:desktop:update-state',()=>new Promise(resolve=>setTimeout(()=>resolve({layers:[{layer:'ui',currentVersion:'0.1.0'}],canRestart:false}),600)));});
  await p.keyboard.press('Control+k');await searchReady(p);await p.getByRole('option').filter({hasText:'更新内容'}).click();await p.locator('.help-skeleton').first().waitFor();await shot(p,'electron-480','dark','release-loading');await p.getByText('当前版本',{exact:true}).waitFor();await b(p,'返回对话').click();

  // Public reading state remains useful when the update service cannot be read.
  await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('wm:desktop:update-state');ipcMain.handle('wm:desktop:update-state',()=>{throw new Error('Synthetic unavailable');});});
  await p.keyboard.press('Control+k');await searchReady(p);await p.getByRole('option').filter({hasText:'更新内容'}).click();await b(p,'重试').waitFor();await shot(p,'electron-480','dark','release-error');await b(p,'返回对话').click();
  browser=await chromium.launch({headless:true});
  for(const surface of ['phone-web','android-bundle'])for(const [width,height]of [[390,844],[360,780]]){
    const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true});const q=await context.newPage();q.setDefaultTimeout(15000);q.on('pageerror',e=>{report.errors.push(e.message);console.log(e.stack);});
    if(surface==='phone-web'){await q.route('**/personal/v1/app/manifest',r=>r.fulfill({json:{version:'0.8.25'}}));await q.goto(f.origin+'/personal/v1/ui');await localUiSession(q,f.credentials,undefined,{mainChat:true});await q.getByRole('button',{name:'WeftMate 主对话',exact:true,includeHidden:true}).waitFor({state:'attached'});}
    else{await q.route('**/bridge',r=>{const input=r.request().postDataJSON();if(input.method==='updates.status')return r.fulfill({json:{result:{activeVersion:'0.8.25',nativeVersion:'0.8.25'}}});return r.fallback();});await q.goto(f.mobileUrl);await q.waitForFunction(()=>state.booted&&state.loggedIn);}
    await q.waitForFunction(()=>Object.keys(localStorage).some(key=>key.startsWith('weftmate-release-seen:')));
    for(const theme of ['light','dark']){
      await q.evaluate(()=>{for(const key of Object.keys(localStorage))if(key.startsWith('weftmate-release-seen:'))localStorage.setItem(key,JSON.stringify({current:'0.0.9',seen:['0.0.9']}));});await q.reload();if(surface==='android-bundle')await q.waitForFunction(()=>state.booted&&state.loggedIn);else await q.getByRole('button',{name:'个人资料与设置',exact:true}).waitFor();await b(q,'关闭更新提示').waitFor();
      await q.evaluate(({surface,theme})=>surface==='android-bundle'?applyTheme(theme):document.documentElement.dataset.theme=theme,{surface,theme});await shot(q,`${surface}-${width}`,theme,'update-notice');await b(q,'关闭更新提示').click();
      await q.evaluate(({surface,theme})=>surface==='android-bundle'?applyTheme(theme):document.documentElement.dataset.theme=theme,{surface,theme});
      if(surface==='phone-web'){await b(q,'个人资料与设置').click();await q.getByRole('menu').waitFor();await shot(q,`${surface}-${width}`,theme,'avatar-menu');await q.getByRole('menuitem',{name:'帮助',exact:true}).click();}
      else{await b(q,'个人资料与设置').click();await q.getByRole('menu').waitFor();await shot(q,`${surface}-${width}`,theme,'avatar-menu');await q.getByRole('menuitem',{name:'帮助',exact:true}).click();}
      await q.getByRole('heading',{name:'帮助与小技巧',exact:true}).waitFor();await shot(q,`${surface}-${width}`,theme,'help');const input=q.getByRole('searchbox',{name:'搜索帮助'});await input.fill('离线');await shot(q,`${surface}-${width}`,theme,'help-filter');await input.fill('');await b(q,'连接设备').click();
      if(surface==='phone-web'){await q.keyboard.press('Escape');await q.keyboard.press('Control+k');}
      else{await q.evaluate(()=>{page('chat');uiCore.openSearch();});}
      await searchReady(q);assert.equal(await q.getByRole('option').filter({hasText:'快捷键一览'}).count(),0);await shot(q,`${surface}-${width}`,theme,'search-actions');await q.getByRole('option').filter({hasText:'更新内容'}).click();await q.getByRole('heading',{name:'更新内容',exact:true}).waitFor();await q.locator('.release-entry').first().waitFor();await shot(q,`${surface}-${width}`,theme,'releases');await b(q,'返回对话').click();
      if(surface==='android-bundle'){await q.evaluate(()=>page('about'));await q.getByRole('button',{name:/更新内容/}).waitFor();await shot(q,`${surface}-${width}`,theme,'settings-about');await q.getByRole('button',{name:/更新内容/}).click();await q.getByRole('heading',{name:'更新内容',exact:true}).waitFor();await b(q,'返回对话').click();}
    }
    await context.close();
  }
  assert.deepEqual(report.errors,[]);report.checks.push('help-filter-and-empty','help-try-opens-goals-and-devices','all-three-desktop-entry-points','mobile-menu-and-search-and-about','registry-panel-identical','actual-search-key-bindings','shortcut-search-action','release-loading-skeleton','light-dark-desktop-480-and-two-phone-sizes','release-error-retry','mobile-shortcuts-hidden');await writeFile(join(out,'verification.json'),JSON.stringify(report,null,2));
}finally{await app?.evaluate(({app})=>app.exit(0)).catch(()=>{});await app?.close().catch(()=>{});await browser?.close();await f?.close();if(profile)await rm(profile,{recursive:true,force:true});if(f?.root)await rm(f.root,{recursive:true,force:true});}
