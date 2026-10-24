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
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
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
  const compactControls=await page.evaluate(async()=>{
    const list=document.createElement('ol');document.body.append(list);
    try {
      WeftTimeline.render([{seq:0,type:'turn.started',data:{turn:9}},{seq:1,type:'assistant.message',data:{text:'',modelThinking:'合成思考',thinkingMs:1000}},
        {seq:2,type:'step.completed',data:{taskId:'turn-9',stepId:'compact-command',toolName:'pwsh',state:'completed',summary:'运行命令',detailRef:{seq:2}}},
        {seq:3,type:'turn.ended',data:{turn:9,reason:'completed'}}],list,{readDetail:async()=>({text:JSON.stringify({arguments:{command:'Write-Output "compact"'},output:'compact output'})}),openStep(){}});
      list.querySelectorAll('details').forEach(node=>node.open=true);await new Promise(resolve=>setTimeout(resolve,0));
      return [...list.querySelectorAll('.timeline-action:not(.step-resources):not(.step-reference)')].map(button=>({icon:!!button.querySelector('svg'),text:button.textContent.trim()}));
    } finally {list.remove();}
  });
  assert.ok(compactControls.length>=4 && compactControls.every(button=>button.icon && !button.text),'progress copy/collapse controls must be icons, not text buttons');
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
  await block.locator(':scope > summary').click();
  fixture.progress.reasoning('先核对合成资料中的约束。',2);
  const thinking=page.locator('.model-thinking').last();
  const thinkingBlock=page.locator('.execution-block').last();
  await thinkingBlock.locator(':scope > summary').getByText('先核对合成资料中的约束。',{exact:true}).waitFor();
  assert.equal(await page.locator('.inline-waiting:visible').count(),0);
  assert.equal(await page.locator('.progress-indicator:visible').count(),1);
  assert.equal(await thinkingBlock.locator(':scope > summary .progress-indicator i').count(),3);
  assert.match(await thinkingBlock.locator(':scope > summary .progress-elapsed').innerText(),/\d+ 秒/);
  for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await thinkingBlock.scrollIntoViewIfNeeded();await capture('running-'+theme);}
  if(!await thinkingBlock.evaluate(node=>node.open))await thinkingBlock.locator(':scope > summary').click();
  await thinking.locator('p').getByText('先核对合成资料中的约束。',{exact:true}).waitFor();
  assert.equal(await thinking.evaluate(node=>node.open),true);
  fixture.progress.reasoning('再比较两种结果。',2);
  await page.waitForFunction(()=>document.querySelector('.model-thinking p')?.textContent.endsWith('再比较两种结果。'));
  await page.evaluate(()=>progressCore.savePersonalization({thinkingDisplay:'collapsed'}));
  assert.equal(await thinking.evaluate(node=>node.open),false);
  await page.evaluate(()=>progressCore.savePersonalization({thinkingDisplay:'hidden'}));
  assert.equal(await thinking.isVisible(),false);
  await page.evaluate(()=>progressCore.savePersonalization({thinkingDisplay:'expanded'}));
  await thinking.locator('p').waitFor();
  for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await capture('live-thinking-'+theme);}
  fixture.progress.chunk('核对完成，下面是结果。',2);
  await page.getByText('核对完成，下面是结果。',{exact:true}).waitFor();
  assert.equal(await thinking.evaluate(node=>node.open),false);
  assert.equal(await thinking.locator('summary').innerText(),'先核对合成资料中的约束。');
  await thinking.locator('summary').click();
  await thinking.locator('p').waitFor();
  fixture.progress.completeStream('核对完成，下面是结果。',2); fixture.progress.finish();
  await page.waitForFunction(()=>(progressCore.inLogicalTimeline()?progressCore.mainChatDays().flatMap(day=>day.events):progressCore.timelineEventsForContext()).some(event=>event.type==='turn.ended'));
  await page.waitForFunction(()=>!(progressCore.inLogicalTimeline()?progressCore.mainChatDays().flatMap(day=>day.events):progressCore.timelineEventsForContext()).some(event=>event.data?.live));
  assert.equal(await page.locator('.model-thinking').count(),1);
  assert.equal(await thinking.evaluate(node=>node.open),true,'user can keep finished thinking expanded');
  await thinking.locator('.thinking-body').hover();
  await thinking.getByRole('button',{name:'收起',exact:true}).click();
  assert.equal(await thinking.evaluate(node=>node.open),false);
  await thinking.locator('summary').click();
  const commentaryRow=page.locator('#transcript .message.assistant').filter({has:page.getByText('目录已经找到，接着核对用法。',{exact:true})});
  await commentaryRow.hover();assert.equal(await commentaryRow.locator('.message-actions').count(),0,'interim commentary never receives reply controls');
  const answerRow=page.locator('#transcript .message.assistant').filter({has:page.getByText('核对完成，下面是结果。',{exact:true})});
  await page.mouse.move(10,10);assert.equal(await answerRow.locator('.message-actions').evaluate(node=>getComputedStyle(node).visibility),'hidden');
  await answerRow.hover();assert.equal(await answerRow.locator('.message-actions').evaluate(node=>getComputedStyle(node).visibility),'visible','final reply keeps hover actions');
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
  const restored=page.locator('.model-thinking');await restored.waitFor({state:'attached'});assert.equal(await restored.evaluate(node=>node.open),false);
  await page.locator('.execution-block').last().locator(':scope > summary').click();
  await restored.locator('summary').click();await page.waitForFunction(()=>document.querySelector('.model-thinking p')?.innerText.includes('再比较两种结果。'));assert.equal(await restored.locator('p').innerText(),'先核对合成资料中的约束。再比较两种结果。');
  const recovered = await page.evaluate(async () => {
    const list=document.createElement('ol');document.body.append(list);
    const original=progressCore.completeMessageEvent, text='合成长答案。'.repeat(1000);
    try {
      progressCore.completeMessageEvent=async(_session,event)=>({...event,data:{...event.data,text,truncated:false}});
      progressUi.paintHistoryMessages([{seq:1000,type:'assistant.message',data:{text:'',streamSeq:1000,live:true,streaming:true,modelThinking:'仅思考快照',thinkingActive:true}}],list);
      progressUi.paintHistoryMessages([{seq:1001,type:'assistant.message',data:{text:text.slice(0,4000),streamSeq:1000,truncated:true,modelThinking:'仅思考快照'}}],list);
      await new Promise(resolve=>setTimeout(resolve,0));
      return list.querySelector('.message-text')?.textContent === text;
    } finally {progressCore.completeMessageEvent=original;list.remove();}
  });
  assert.equal(recovered,true,'reasoning-only snapshot must create a body before hydrating a truncated final reply');
  const probes = await page.evaluate(async () => {
    let copied;
    const list=document.createElement('ol');list.id='progress2-command-probe';list.className='chat-progress';document.querySelector('#transcript').append(list);
    const readDetail=async()=>({text:JSON.stringify({arguments:{command:'Write-Output "synthetic"'},output:'synthetic output'})});
    try {
      WeftTimeline.render([{seq:0,type:'turn.started',data:{turn:9}},{seq:0.5,type:'assistant.message',data:{text:'',modelThinking:'先检查合成命令。',thinkingMs:1000}}, {seq:1,type:'step.completed',data:{taskId:'turn-9',stepId:'command',toolName:'pwsh',state:'completed',summary:'运行命令',detailRef:{seq:1}}},
        {seq:2,type:'turn.ended',data:{turn:9,reason:'completed'}}],list,{readDetail,copyText:async text=>{copied=text;}});
      list.querySelector('.execution-block').open=true;
      list.querySelectorAll('.execution-step').forEach(step=>step.open=true);
      await new Promise(resolve=>setTimeout(resolve,100));
      list.querySelector('[aria-label="复制思考内容"]').click();await new Promise(resolve=>setTimeout(resolve,0));const copiedThinking=copied;
      const code=list.querySelector('code');
      list.querySelector('.render-code-actions button:last-child').click();
      await new Promise(resolve=>setTimeout(resolve,0));
      return {feedback:!!list.querySelector('.model-thinking [data-copied="true"] svg'),copiedThinking,code:code?.textContent,highlighted:!!code?.querySelector('.hljs-built_in'),output:list.querySelector('.step-output')?.textContent,copied,summary:list.querySelector('.inline-progress-text')?.textContent};
    } catch(error) {list.remove();throw error;}
  });
  await page.locator('#progress2-command-probe').scrollIntoViewIfNeeded();
  const stepBody=page.locator('#progress2-command-probe .execution-step-body');
  await stepBody.locator('[data-icon="copy"]').first().focus();
  assert.equal(await stepBody.locator('[data-icon="copy"]').first().evaluate(node=>getComputedStyle(node).opacity),'1','keyboard focus reveals detail icons');
  await page.locator('#progress2-command-probe .render-code').hover();
  const codeCopy=page.locator('#progress2-command-probe .render-code [data-icon="copy"]');
  assert.equal(await codeCopy.evaluate(node=>getComputedStyle(node).opacity),'1');
  assert.equal(await codeCopy.evaluate(node=>getComputedStyle(node).borderTopWidth),'0px');
  assert.equal(await codeCopy.evaluate(node=>node.textContent),'');
  for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await capture('command-'+theme);}
  await page.locator('#progress2-command-probe').evaluate(node=>node.remove());
  assert.equal(probes.feedback,true,'copy feedback uses a check icon');
  assert.equal(probes.copiedThinking,'先检查合成命令。');
  assert.match(probes.code,/^\$ Write-Output/);assert.equal(probes.output,'synthetic output');assert.equal(probes.copied,probes.code);
  assert.equal(probes.highlighted,true);assert.equal(probes.summary,'已运行 1 个命令');
  if(logical) {
    const reasoningOnly=await page.evaluate(()=>{
      const original=progressCore.mainChatDays,sessionId=progressCore.state.selectedSessionId;
      const event=(seq,type,data)=>({seq,type,data,eventId:'synthetic-reasoning-'+seq,at:new Date().toISOString(),orderKey:String(seq),sourceRef:{sessionId,seq}});
      try {
        progressCore.mainChatDays=()=>[{date:'2026-10-25',label:'今天',collapsed:false,events:[
          event(0,'turn.started',{turn:9}),event(1,'assistant.message',{streamSeq:1,text:'只有思考后的合成答案。',modelThinking:'先核对合成问题。',thinkingMs:1000}),event(2,'turn.ended',{turn:9,reason:'completed'})]}];
        progressUi.renderMainChat();
        const rows=[...document.querySelectorAll('#transcript > li')];
        return {answer:rows.findIndex(row=>row.querySelector('.message-text')?.textContent==='只有思考后的合成答案。'),progress:rows.findIndex(row=>row.querySelector('.model-thinking'))};
      } finally {progressCore.mainChatDays=original;progressUi.renderMainChat();}
    });
    assert.ok(reasoningOnly.progress>=0 && reasoningOnly.answer>reasoningOnly.progress,'a reasoning-only reply keeps progress above the answer');
  }
  const queueProbe=await page.evaluate(()=>{
    const before=progressCore.state.historyEvents,commands=progressCore.state.tasks;
    const queued=(seq,id)=>({seq,type:'task.queued',data:{taskId:id,text:id}});
    try {
      progressCore.state.tasks=[];
      progressCore.state.historyEvents=new Map([[0,queued(0,'first')]]);
      progressUi.renderTaskQueue();const idle=document.querySelectorAll('.queued-task').length;
      progressCore.state.historyEvents.set(1,{seq:1,type:'turn.started',data:{turn:1}});
      progressCore.state.historyEvents.set(2,queued(2,'second'));
      progressUi.renderTaskQueue();return {idle,busy:document.querySelectorAll('.queued-task').length};
    } finally {progressCore.state.historyEvents=before;progressCore.state.tasks=commands;progressUi.renderTaskQueue();}
  });
  if(!logical)assert.deepEqual(queueProbe,{idle:0,busy:1});
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.execution-block').first().evaluate(node=>getComputedStyle(node).animationName),'none');
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
