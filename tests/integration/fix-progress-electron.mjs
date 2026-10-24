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
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'));
  await writeFile(join(process.env.WEFTMATE_EVIDENCE_DIR, name+'.png'),Buffer.from(png,'base64'));
}
try {
  for (const n of [1,2,3]) {
    const path = join(locks,`heavy-${n}.lock`);
    try { const handle = await open(path,'wx'); await handle.writeFile('FIX-PROGRESS '+new Date().toISOString()); await handle.close(); lock=path; break; }
    catch(error) { if(error.code!=='EEXIST')throw error; }
  }
  assert.ok(lock,'No heavy slot available');
  watchdog=setTimeout(()=>{killOwnedTree();process.exitCode=1;},110000);
  profile=await mkdtemp(join(tmpdir(),'weftmate-fix-progress-'));
  process.env.WEFTMATE_MANAGED_TEMP_ROOT=join(profile,'fixture');
  fixture=await startTimelineCandidate({historyCount:0,interactive:true,inlineProgress:true,thinking:true,baseTime:Date.now()-2000});
  const env={...process.env,FIX_PROGRESS_PROFILE:profile,FIX_PROGRESS_ORIGIN:fixture.origin,FIX_PROGRESS_DESKTOP_TOKEN:fixture.libraryDesktopToken}; delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:root,args:['tests/helpers/fix-progress-electron.mjs'],env,timeout:20000});
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
  await localUiSession(page,fixture.credentials,'FIX-PROGRESS synthetic',{mainChat:true});
  await page.getByRole('textbox',{name:'输入消息',exact:true}).waitFor();
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('wm:desktop:visibility',false));
  await page.waitForFunction(()=>progressCore.foreground() && progressCore.state.background===false);
  await page.waitForFunction(()=>progressCore.state.refreshing===false && progressCore.state.sessions.length>0);
  await page.evaluate(async id=>{try {await progressCore.savePersonalization({thinkingDisplay:'expanded',nextSuggestionsEnabled:false});await progressCore.selectSession(id);}catch(error){throw Error(JSON.stringify(error));}},fixture.sessionId);
  assert.equal(await page.evaluate(()=>progressCore.inLogicalTimeline()),logical);
  fixture.progress.call('read','read-1',{path:'motion.json',offset:0,limit:100});
  await page.getByText(/正在读取.*motion.json/).first().waitFor();
  fixture.progress.result('read-1','Synthetic first segment');
  fixture.progress.chunk('目录已经找到，接着核对用法。',1);
  await page.getByText('目录已经找到，接着核对用法。',{exact:true}).waitFor();
  assert.equal(await page.locator('.execution-block .message-text').count(),0);
  fixture.progress.completeStream('目录已经找到，接着核对用法。',1);
  for (let n=2;n<=4;n++) {fixture.progress.call('read',`read-${n}`,{path:'motion.json',offset:(n-1)*100,limit:100});fixture.progress.result(`read-${n}`,'Synthetic next segment');}
  await page.waitForFunction(()=>document.querySelectorAll('.execution-block').length===2);
  const block=page.locator('.execution-block').last(); await block.locator(':scope > summary').click();
  const group=block.locator('.execution-step-group'); await group.waitFor();
  await group.locator(':scope > summary').filter({hasText:logical?/3 次/:/motion.json.*3 次/}).waitFor();
  assert.match(await group.locator(':scope > summary').innerText(),/3 次/);
  assert.equal(await block.locator('.execution-records > details').count(),1);
  await group.locator(':scope > summary').focus(); await group.locator(':scope > summary').press('Space');
  assert.equal(await group.evaluate(node=>node.open),true);
  assert.equal(await group.locator('.execution-step').count(),3);
  await group.locator('.execution-step > summary').first().click();
  await group.getByText(/Synthetic next segment/).first().waitFor();
  assert.equal(await group.locator('.execution-step > summary').first().evaluate(node=>getComputedStyle(node).listStyleType),'none');
  assert.equal(await group.locator('.execution-step > summary').first().evaluate(node=>getComputedStyle(node,'::after').content),'none');
  assert.equal(await group.locator('.execution-step > summary > .progress-chevron').first().count(),1);
  await capture('grouped-tools');
  fixture.progress.reasoning('先核对合成资料中的约束。',2);
  const thinking=page.locator('.model-thinking').last();
  await thinking.locator('p').getByText('先核对合成资料中的约束。',{exact:true}).waitFor();
  assert.equal(await thinking.evaluate(node=>node.open),true);
  fixture.progress.reasoning('再比较两种结果。',2);
  await page.waitForFunction(()=>document.querySelector('.model-thinking p')?.textContent.endsWith('再比较两种结果。'));
  await page.evaluate(()=>progressCore.savePersonalization({thinkingDisplay:'collapsed'}));
  assert.equal(await thinking.evaluate(node=>node.open),false);
  await page.evaluate(()=>progressCore.savePersonalization({thinkingDisplay:'hidden'}));
  assert.equal(await thinking.isVisible(),false);
  await page.evaluate(()=>progressCore.savePersonalization({thinkingDisplay:'expanded'}));
  await thinking.locator('p').waitFor(); await capture('live-thinking');
  fixture.progress.chunk('核对完成，下面是结果。',2);
  await page.getByText('核对完成，下面是结果。',{exact:true}).waitFor();
  assert.equal(await thinking.evaluate(node=>node.open),false);
  assert.match(await thinking.locator('summary').innerText(),/思考过程 · \d+ 秒/);
  await thinking.locator('summary').click();
  await thinking.locator('p').waitFor();
  fixture.progress.completeStream('核对完成，下面是结果。',2); fixture.progress.finish();
  await page.waitForFunction(()=>(progressCore.inLogicalTimeline()?progressCore.mainChatDays().flatMap(day=>day.events):progressCore.timelineEventsForContext()).some(event=>event.type==='turn.ended'));
  await page.waitForFunction(()=>!(progressCore.inLogicalTimeline()?progressCore.mainChatDays().flatMap(day=>day.events):progressCore.timelineEventsForContext()).some(event=>event.data?.live));
  assert.equal(await page.locator('.model-thinking').count(),1);
  assert.equal(await thinking.evaluate(node=>node.open),true,'user can keep finished thinking expanded');
  const positions=await page.locator('#transcript > li').evaluateAll(rows=>rows.map(row=>row.textContent));
  const commentary=positions.findIndex(text=>text.includes('目录已经找到'));
  assert.ok(positions.findIndex(text=>text.includes('读取了 1 个文件'))<commentary);
  assert.ok(positions.findLastIndex(text=>text.includes('读取了 3 个文件'))>commentary);
  for (const theme of ['light','dark']) {await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await capture('completed-'+theme);}
  await page.reload(); await page.getByRole('textbox',{name:'输入消息',exact:true}).waitFor();
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('wm:desktop:visibility',false));
  await page.waitForFunction(()=>progressCore.state.refreshing===false);
  await page.evaluate(id=>progressCore.selectSession(id),fixture.sessionId);
  await page.getByText('目录已经找到，接着核对用法。',{exact:true}).waitFor();
  const restored=page.locator('.model-thinking');await restored.waitFor();assert.equal(await restored.evaluate(node=>node.open),false);
  await restored.locator('summary').click();assert.equal(await restored.locator('p').innerText(),'先核对合成资料中的约束。再比较两种结果。');
  assert.deepEqual(errors,[]);
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(window=>!window.isVisible())),true);
  console.log(`PASS FIX-PROGRESS ${logical?'segmented':'ordinary'}: real hidden desktop, interleaved durable commentary, grouped calls/detail/keyboard, live thinking/settings/collapse/reload.`);
} catch(error) {
  if(page)console.error(await page.evaluate(()=>JSON.stringify({selected:globalThis.progressCore?.state.selectedSessionId,work:globalThis.progressCore?.state.workTimeline?.chatId,main:globalThis.progressCore?.state.mainChat?.chatId,events:globalThis.progressCore?.timelineEventsForContext?.().map(e=>({seq:e.seq,type:e.type})),errors:document.querySelector('#timeline-status')?.textContent})).catch(()=>''));
  await capture('failure').catch(()=>{}); throw error;
}
finally {
  await page?.unrouteAll({behavior:'ignoreErrors'}).catch(()=>{});
  await app?.close().catch(()=>{}); killOwnedTree();
  await fixture?.close(); clearTimeout(watchdog);
  if(lock)await unlink(lock);
  if(fixture)await removeOwned(fixture.root,resolve(fixture.root,'..'),'weftmate-m0-3-');
  if(profile)await removeOwned(profile,tmpdir(),'weftmate-fix-progress-');
}
