/** Real production desktop shell, isolated identity, synthetic native log. */
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, open, unlink, readFile, readdir, lstat, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { localUiSession, nativeFixtureFetchOptions } from '../helpers/local-ui-session.mjs';
for (const stream of [process.stdout, process.stderr]) stream.on('error', error => { if (error.code !== 'EPIPE') throw error; });
const root = resolve(import.meta.dirname, '../..'), locks = process.env.WEFTMATE_HEAVY_LOCK_DIR;
const logical = process.argv.includes('--logical');
assert.ok(locks, 'Set the machine heavy-slot directory');
let app, child, fixture, profile, lock, watchdog, page;
const errors = [];
function killOwnedTree() {
  if (child && child.exitCode === null) spawnSync('taskkill', ['/PID',String(child.pid),'/T','/F'], { windowsHide:true,stdio:'ignore',timeout:5000 });
}
async function removeOwned(directory, parent, prefix) {
  const rel = relative(parent, directory);
  assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel) && rel.startsWith(prefix));
  async function links(path) {
    for (const row of await readdir(path, {withFileTypes:true})) {
      const child = join(path,row.name);
      if ((await lstat(child)).isSymbolicLink()) await unlink(child); else if (row.isDirectory()) await links(child);
    }
  }
  await links(directory); await rm(directory,{recursive:true,force:true});
}
async function capture(name) {
  if (!process.env.WEFTMATE_EVIDENCE_DIR) return;
  await mkdir(process.env.WEFTMATE_EVIDENCE_DIR,{recursive:true});
  await page.screenshot({path:join(process.env.WEFTMATE_EVIDENCE_DIR, name+'.png')});
}
try {
  for (const n of [1,2,3]) {
    const path = join(locks,`heavy-${n}.lock`);
    try { const handle = await open(path,'wx'); await handle.writeFile('FIX-SIDEBAR '+new Date().toISOString()); await handle.close(); lock=path; break; }
    catch(error) { if(error.code!=='EEXIST')throw error; }
  }
  assert.ok(lock,'No heavy slot available');
  watchdog=setTimeout(()=>{killOwnedTree();process.exitCode=1;},110000);
  profile=await mkdtemp(join(tmpdir(),'weftmate-fix-sidebar-'));
  process.env.WEFTMATE_MANAGED_TEMP_ROOT=join(profile,'fixture');
  fixture=await startTimelineCandidate({historyCount:0,interactive:true,inlineProgress:true,thinking:true,baseTime:Date.now()-2000});
  const env={...process.env,FIX_SIDEBAR_PROFILE:profile,FIX_SIDEBAR_ORIGIN:fixture.origin,FIX_SIDEBAR_DESKTOP_TOKEN:fixture.libraryDesktopToken}; delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:root,args:['tests/helpers/fix-sidebar-electron.mjs'],env,timeout:20000});
  child=app.process(); child.stdout?.resume(); child.stderr?.resume();
  page=await app.firstWindow(); page.setDefaultTimeout(12000); page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    Object.defineProperty(document,'visibilityState',{get:()=> 'visible'});
    Object.defineProperty(document,'hidden',{get:()=>false});
  });
  await page.route('**/personal/v1/ui/app.js',async route=>route.fulfill({contentType:'text/javascript',body:(await readFile(join(root,'src/personal-access-ui/app.js'),'utf8')).replace('ui.loadAttachmentHasher =','globalThis.progressCore=core;globalThis.progressUi=ui;ui.loadAttachmentHasher =')}));
  if(logical)await page.route(url=>/^\/personal\/v1\/chats(?:\/[^/]+)?$/.test(url.pathname),async route=>{
    // Exercise the existing segmented-history desktop renderer with the same synthetic log.
    const response=await route.fetch(nativeFixtureFetchOptions(route,{origin:fixture.origin,libraryDesktopToken:fixture.libraryDesktopToken})),body=await response.json();
    for(const chat of body.items || []) if(chat.activeSessionId===fixture.sessionId)chat.logicalHistory=true;
    if(body.chat?.activeSessionId===fixture.sessionId)body.chat.logicalHistory=true;
    await route.fulfill({response,json:body});
  });
  await page.waitForURL('**/personal/v1/ui');
  await localUiSession(page,fixture.credentials,'FIX-SIDEBAR synthetic',{mainChat:true});
  await page.getByRole('textbox',{name:'输入消息',exact:true}).waitFor();
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('wm:desktop:visibility',false));
  await page.waitForFunction(()=>progressCore.foreground() && progressCore.state.background===false);
  await page.waitForFunction(()=>progressCore.state.refreshing===false && progressCore.state.sessions.length>0);
  await page.evaluate(async id=>{try {await progressCore.savePersonalization({thinkingDisplay:'expanded',nextSuggestionsEnabled:false});await progressCore.selectSession(id);}catch(error){throw Error(JSON.stringify(error));}},fixture.sessionId);
  const failures=[];
  async function check(name,run){try{await run();console.log('PASS '+name);}catch(error){failures.push(name+': '+error.message);console.log('FAIL '+name+': '+error.message);}}
  const row=page.locator('.session-row').filter({has:page.locator('.is-current')}).first();
  await check('#645 one more button',async()=>{
    await row.hover(); assert.equal(await row.locator('.session-quick-action').count(),0);
    assert.equal(await row.locator('.session-more').isVisible(),true);
    const height=await row.evaluate(n=>n.getBoundingClientRect().height);assert.ok(height<=34,'compact row '+height);
  });
  await check('#644 menu anchored and reachable',async()=>{
    await row.locator('button').first().click({button:'right',position:{x:80,y:16}});
    const menu=page.getByRole('menu',{name:'对话操作',exact:true});await menu.waitFor();
    const geometry=await menu.evaluate(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,bottom:r.bottom,font:parseFloat(getComputedStyle(n).fontSize),height:innerHeight};});
    const anchor=await row.boundingBox();assert.ok(Math.abs(geometry.y-(anchor.y+16))<20,JSON.stringify({geometry,anchor}));
    assert.ok(geometry.bottom<=geometry.height-7.5);assert.ok(geometry.font<=13,'menu font '+geometry.font);
    await menu.getByRole('menuitem',{name:'删除'}).focus();assert.equal(await menu.getByRole('menuitem',{name:'删除'}).isVisible(),true);
    await page.keyboard.press('Escape');
  });
  await page.keyboard.press('Escape');
  await check('#638 visible completion read',async()=>{
    let releaseHistory;
    const delayed=new Promise(resolve=>releaseHistory=resolve);
    const pattern='**/personal/v1/sessions/*/events?*';
    await page.route(pattern,async route=>{const response=await route.fetch(nativeFixtureFetchOptions(route,{origin:fixture.origin,libraryDesktopToken:fixture.libraryDesktopToken}));await delayed;await route.fulfill({response});});
    try {
      fixture.progress.chunk('合成完成结果',2);fixture.progress.completeStream('合成完成结果',2);fixture.progress.finish();
      await page.evaluate(()=>progressCore.refreshSessions());
      assert.equal(await page.evaluate(()=>progressCore.state.sessions.find(s=>s.sessionId===progressCore.state.selectedSessionId)?.unread),true,'unseen completion remains unread while history is delayed');
      releaseHistory();
      await page.getByText('合成完成结果',{exact:true}).waitFor();
      await page.waitForFunction(()=>!progressCore.state.sessions.find(s=>s.sessionId===progressCore.state.selectedSessionId)?.unread,{},{timeout:5000});
    } finally {releaseHistory();await page.unroute(pattern);}
    assert.equal(await row.locator('.is-completed').count(),0);
  });
  await check('manual unread stays unread until the next turn',async()=>{
    await row.locator('.session-more').click();await page.getByRole('menuitemcheckbox',{name:/标记为未读/}).click();
    await page.waitForFunction(()=>progressCore.state.sessions.find(s=>s.sessionId===progressCore.state.selectedSessionId)?.unread===true);
    await page.evaluate(()=>progressCore.refreshSessions());assert.equal(await row.locator('.is-completed').count(),1);
  });
  await row.locator('.session-more').click();await page.getByRole('menuitemcheckbox',{name:/标记为已读/}).click();
  await check('tooltip follows control and flips at viewport edges',async()=>{
    await row.locator('.session-more').hover();const tip=page.getByRole('tooltip').filter({hasText:'更多操作'});await tip.waitFor();
    const a=await row.locator('.session-more').boundingBox(),r=await tip.boundingBox();assert.ok(Math.abs(r.y+r.height-a.y-(-8))<2);
    const flipped=await page.evaluate(()=>{const control=document.createElement('button');Object.assign(control.style,{position:'fixed',left:'8px',top:'48px',width:'32px',height:'32px'});document.body.append(control);const tip=document.querySelector('.control-tooltip');WeftPopover.position(tip,control);const r=tip.getBoundingClientRect(),a=control.getBoundingClientRect();const result=r.top>=a.bottom&&r.left>=8&&r.right<=innerWidth-8;control.remove();return result;});assert.equal(flipped,true);
  });
  for(const theme of ['light','dark']){
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.mouse.move(1100,700);await capture('sidebar-'+theme);
    await row.locator('.session-more').click();const menu=page.getByRole('menu',{name:'对话操作',exact:true});
    await menu.waitFor();const a=await row.locator('.session-more').boundingBox(),r=await menu.boundingBox();assert.ok(Math.abs(r.y-a.y-a.height-8)<2||Math.abs(r.y+r.height-a.y+8)<2,'anchored button menu');
    await capture('menu-'+theme);await menu.getByRole('menuitem',{name:'打开方式',exact:true}).click();await page.getByRole('menuitem',{name:'在当前窗口打开'}).waitFor();await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  }
  await check('short window menu scrolls to final memory item; header keeps first line visible',async()=>{
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(900,560));
    await row.locator('button').first().click({button:'right',position:{x:60,y:16}});
    const menu=page.getByRole('menu',{name:'对话操作',exact:true});await menu.waitFor();
    await page.evaluate(()=>{progressCore.state.sessionGroups=Array.from({length:25},(_,i)=>({id:'synthetic-'+i,name:'合成分区 '+i}));});
    await menu.getByRole('menuitem',{name:'移至分区'}).click();
    const submenu=page.getByRole('menu',{name:'移至分组',exact:true});await submenu.waitFor();await submenu.getByRole('menuitem',{name:'管理分组',exact:true}).focus();
    const geometry=await submenu.evaluate(n=>{const r=n.getBoundingClientRect(),last=n.lastElementChild.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight,scroll:n.scrollHeight>n.clientHeight,reached:last.bottom<=r.bottom+1};});assert.ok(geometry.top>=44&&geometry.bottom<=geometry.height-7.5&&geometry.scroll&&geometry.reached,JSON.stringify(geometry));
    await capture('short-menu');await page.keyboard.press('Escape');await page.keyboard.press('Escape');
    const header=await page.evaluate(()=>{const h=document.querySelector('.assistant-topbar').getBoundingClientRect(),c=document.querySelector('#chat-scroll').getBoundingClientRect();return {headerBottom:h.bottom,contentTop:c.top};});assert.ok(header.contentTop>=header.headerBottom,JSON.stringify(header));
  });
  await check('project nesting and empty sections',async()=>{
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1200,800));
    await page.evaluate(()=>{progressCore.state.background=true;progressCore.state.sessionGroups=[];progressCore.state.projects=[{projectId:'synthetic-project',name:'合成资料项目'}];progressCore.state.sessions.push({sessionId:'synthetic-project-chat',title:'合成项目对话',mode:'work',projectId:'synthetic-project'});progressCore.chooseSidebarMode('work');progressUi.renderSessions();});
    const project=page.locator('.sidebar-project').filter({hasText:'合成资料项目'});await project.waitFor();const nested=project.locator('.project-conversations');
    assert.equal(await nested.locator('.session-row').count(),1);
    const style=await nested.evaluate(n=>({border:getComputedStyle(n).borderLeftWidth,indent:n.querySelector('button').getBoundingClientRect().left-n.parentElement.getBoundingClientRect().left}));assert.ok(parseFloat(style.border)>0&&parseFloat(style.border)<=1);assert.ok(style.indent>0);
    assert.equal(await page.getByRole('button',{name:'已置顶',exact:true}).count(),0);
    await project.hover();assert.equal(await page.getByRole('button',{name:'在项目 合成资料项目 新建对话'}).isVisible(),true);
    for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await capture('project-'+theme);}
  });
  assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
  console.log('PASS FIX-SIDEBAR hidden Electron');
} catch(error) {await capture('failure').catch(()=>{});throw error;}
finally {
  await page?.unrouteAll({behavior:'ignoreErrors'}).catch(()=>{});
  await app?.close().catch(()=>{}); killOwnedTree();
  await fixture?.close(); clearTimeout(watchdog);
  if(lock)await unlink(lock);
  if(fixture)await removeOwned(fixture.root,resolve(fixture.root,'..'),'weftmate-m0-3-');
  if(profile)await removeOwned(profile,tmpdir(),'weftmate-fix-sidebar-');
}
