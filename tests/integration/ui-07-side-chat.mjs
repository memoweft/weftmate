import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, open, unlink, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
import { measureUi } from '../helpers/ui-smoothness.mjs';
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
const root = resolve(import.meta.dirname, '../..');
if (!process.env.WEFTMATE_TEST_TEMP_SCOPE) process.env.WEFTMATE_MANAGED_TEMP_ROOT ??= join(root,'.local','ui07-fixtures');
const out = process.env.WEFTMATE_EVIDENCE_DIR;
let app, fixture, lock, page, profile;
const errors = [], samples = [];
try {
  if (process.env.WEFTMATE_HEAVY_LOCK_DIR) {
    for (const n of [1,2,3]) {
      const path = join(process.env.WEFTMATE_HEAVY_LOCK_DIR, `heavy-${n}.lock`);
      try { const file = await open(path, 'wx'); await file.writeFile('UI-07-SIDE-CHAT ' + new Date().toISOString()); await file.close(); lock=path; break; }
      catch (error) { if(error.code!=='EEXIST')throw error; }
    }
    assert.ok(lock, 'No heavy slot available');
  }
  profile = await mkdtemp(join(tmpdir(), 'weftmate-ui07-'));
  const messages=[],stops=[];
  fixture = await startTimelineCandidate({ daily:true, modelServices:true, historyCount:0, interactive:true, baseTime:Date.now()-2000, configureBackend(backend) {
    const models=backend.listModels,sendMessage=backend.sendMessage,stopTask=backend.stopTask,cancelSession=backend.cancelSession;
    backend.listModels=async()=>[...await models(),{id:'side-model',name:'侧聊合成模型',model:'synthetic-side',configured:true,sourceKind:'local'}];
    backend.sendMessage=async input=>{messages.push(input);return sendMessage(input);};
    backend.stopTask=async input=>{stops.push(input.sessionId);return stopTask(input);};
    backend.cancelSession=async input=>{stops.push(input.sessionId);return cancelSession(input);};
  } });
  messages.length=0;
  const env={...process.env,UI07_PROFILE:profile,UI07_ORIGIN:fixture.origin,UI07_TOKEN:fixture.libraryDesktopToken};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:root,args:['tests/helpers/ui-07-electron.mjs'],env,timeout:25000});
  app.process().stdout?.resume();app.process().stderr?.resume();
  page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{Object.defineProperty(document,'visibilityState',{get:()=> 'visible'});Object.defineProperty(document,'hidden',{get:()=>false});});
  await page.route('**/personal/v1/ui/app.js',async route=>route.fulfill({contentType:'text/javascript',body:(await readFile(join(root,'src/personal-access-ui/app.js'),'utf8')).replace('ui.loadAttachmentHasher =','globalThis.testCore=core;globalThis.testUi=ui;ui.loadAttachmentHasher =')}));
  await page.route('**/personal/v1/ui/panels/chat.js',async route=>route.fulfill({contentType:'text/javascript',body:(await readFile(join(root,'src/personal-access-ui/panels/chat.js'),'utf8')).replace('core = scope.core;', 'core = scope.core; globalThis.testSideCore=core;')}));
  await page.waitForURL('**/personal/v1/ui');
  await localUiSession(page,fixture.credentials,'UI07 synthetic',{mainChat:true});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('wm:desktop:visibility',false));
  await page.waitForFunction(()=>globalThis.testCore?.state.models.length);
  const main=page.getByRole('textbox',{name:'输入消息',exact:true});await main.waitFor();
  await page.evaluate(id=>testCore.selectSession(id),fixture.sessionId);
  const mainId=await page.evaluate(()=>testCore.state.selectedSessionId);
  await main.fill('主对话独立草稿');
  await page.locator('#message-attachments').setInputFiles({name:'main-draft.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic main attachment')});
  const creates=fixture.operations.filter(row=>row.kind==='create').length;
  await page.getByRole('button',{name:'打开工作面板',exact:true}).click();
  await page.locator('[data-panel-kind=chat]').click();
  const side=page.getByRole('region',{name:'侧边聊天',exact:true});
  await side.getByRole('textbox',{name:'侧边聊天消息',exact:true}).waitFor();
  assert.equal(fixture.operations.filter(row=>row.kind==='create').length,creates,'Opening a side draft must not create a session');
  assert.equal(await main.inputValue(),'主对话独立草稿');
  assert.equal(await page.evaluate(()=>testCore.state.selectedSessionId),mainId);
  const defaultModel=(await fixture.request('/settings/models')).defaultModelProfileId;
  await side.locator('.side-chat-model').click();
  await page.getByRole('menuitemradio',{name:'侧聊合成模型',exact:true}).click();
  await page.waitForFunction(()=>testSideCore.state.modelProfileId==='side-model');
  assert.equal((await fixture.request('/settings/models')).defaultModelProfileId,defaultModel,'Side model choice must not change the account default');
  assert.equal(await page.evaluate(()=>testCore.state.modelProfileId),'local');
  await side.locator('input[type=file]').setInputFiles({name:'side-first.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic side attachment')});
  await side.getByRole('textbox',{name:'侧边聊天消息',exact:true}).fill('侧聊独立问题');
  await side.getByRole('button',{name:'发送侧聊消息',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.panel-chat')?.dataset.sessionId);
  const sideId=await side.getAttribute('data-session-id');
  assert.notEqual(sideId,mainId);
  await side.getByText('侧聊独立问题',{exact:true}).waitFor();
  assert.equal(await main.inputValue(),'主对话独立草稿');
  assert.equal(await page.evaluate(()=>testCore.state.selectedSessionId),mainId);
  await page.waitForFunction(()=>testSideCore.state.turnStatus === 'running');
  await side.getByRole('button',{name:'停止侧聊回复',exact:true}).waitFor();
  assert.equal(fixture.operations.filter(row=>row.kind==='create').length,creates+1);
  assert.equal(await page.evaluate(()=>testSideCore.state.modelProfileId),'side-model');
  assert.equal(await page.evaluate(()=>testCore.currentAttachmentDrafts()[0].file.name),'main-draft.txt');
  assert.equal(await page.evaluate(()=>testSideCore.currentAttachmentDrafts().length),0);
  assert.equal(messages.length,1);assert.equal(messages[0].sessionId,sideId);
  assert.match(messages[0].text,/Synthetic side attachment/);
  assert.doesNotMatch(messages[0].text,/Synthetic main attachment/);
  const chunk=(id,text)=>fixture.appendSessionEvent(id,'assistant/chunk',{turn:1,step:1,chunk:{type:'text-delta',text}});
  samples.push(await measureUi(page,'parallel-stream',async()=>{
    await side.getByRole('textbox',{name:'侧边聊天消息',exact:true}).press('End');
    const mainText=Array.from('主线流式：正在梳理安排。'),sideText=Array.from('侧聊流式：单独解释概念。');
    for(let index=0;index<Math.max(mainText.length,sideText.length);index++){
      if(mainText[index])chunk(mainId,mainText[index]);if(sideText[index])chunk(sideId,sideText[index]);
      await new Promise(resolve=>setTimeout(resolve,30));
    }
  },{kind:'parallelStream'}));
  await page.locator('#transcript').getByText('主线流式：正在梳理安排。',{exact:false}).last().waitFor();
  await side.getByText('侧聊流式：单独解释概念。',{exact:true}).waitFor();
  assert.equal(await side.getByText('主线流式：正在梳理安排。',{exact:true}).count(),0);
  assert.equal(await page.locator('#transcript').getByText('侧聊流式：单独解释概念。',{exact:true}).count(),0);
  const disclosure=side.locator('.execution-block').first(),wasOpen=await disclosure.evaluate(el=>el.open);
  samples.push(await measureUi(page,'toggle-side-process',()=>disclosure.locator(':scope > summary').click(),{kind:'disclosure'}));
  assert.equal(await disclosure.evaluate(el=>el.open),!wasOpen);
  const panel=page.getByRole('complementary',{name:'工作面板',exact:true}),beforeWidth=(await panel.boundingBox()).width;
  samples.push(await measureUi(page,'resize-side',()=>panel.getByRole('separator',{name:'调整预览宽度'}).press('ArrowLeft'),{kind:'width',before:beforeWidth}));
  await panel.getByRole('separator',{name:'调整预览宽度'}).press('ArrowRight');
  await side.getByRole('textbox',{name:'侧边聊天消息',exact:true}).fill('侧聊后续草稿');
  await side.locator('input[type=file]').setInputFiles({name:'side-next.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic next attachment')});
  samples.push(await measureUi(page,'hide-side',()=>page.getByRole('button',{name:'收起右侧面板',exact:true}).click(),{kind:'panel',visible:false}));
  samples.push(await measureUi(page,'show-side',()=>page.getByRole('button',{name:'打开工作面板',exact:true}).click(),{kind:'panel',visible:true}));
  assert.equal(await side.getByRole('textbox',{name:'侧边聊天消息',exact:true}).inputValue(),'侧聊后续草稿');
  assert.equal(await side.locator('.attachment-draft strong').textContent(),'side-next.txt');
  assert.equal(await main.inputValue(),'主对话独立草稿');
  chunk(mainId,' 主线继续。');chunk(sideId,' 侧聊继续。');
  await side.getByText('侧聊流式：单独解释概念。 侧聊继续。',{exact:true}).waitFor();
  for(const theme of ['light','dark'])for(const [width,height]of [[1280,800],[900,700]]){
    await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setContentSize(...size),[width,height]);
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
    await page.waitForFunction(w=>innerWidth===w,width);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.ok(await main.isVisible());assert.ok(await side.getByRole('textbox',{name:'侧边聊天消息',exact:true}).isVisible());
    const geometry=await side.evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));assert.ok(geometry.scroll<=geometry.width+1);
    if(out){await mkdir(out,{recursive:true});await page.screenshot({path:join(out,`side-${theme}-${width}x${height}.png`),animations:'disabled'});}
  }
  await side.getByRole('button',{name:'停止侧聊回复',exact:true}).click();
  await page.waitForFunction(()=>testSideCore.state.turnStatus!=='running');
  assert.deepEqual(stops,[sideId]);
  chunk(mainId,' 侧聊停止后主线仍在回复。');
  await page.locator('#transcript').getByText('主线流式：正在梳理安排。 主线继续。 侧聊停止后主线仍在回复。',{exact:false}).last().waitFor();
  await main.fill('');await page.getByRole('button',{name:'移除文件 main-draft.txt',exact:true}).click();
  await page.getByRole('button',{name:'停止回复',exact:true}).click();
  await page.waitForFunction(()=>testCore.state.turnStatus!=='running');
  assert.deepEqual(stops,[sideId,mainId]);
  // Switching the central conversation keeps the independent side session/draft.
  await page.evaluate(()=>testCore.startNewConversation());
  assert.equal(await side.getAttribute('data-session-id'),sideId);
  assert.equal(await side.getByRole('textbox',{name:'侧边聊天消息',exact:true}).inputValue(),'侧聊后续草稿');
  await page.evaluate(()=>WeftPanels.close('chat'));
  assert.equal(await page.evaluate(()=>testSideCore.state.csrfToken),null);
  assert.equal(await page.evaluate(()=>testSideCore.currentAttachmentDrafts().length),0);
  assert.deepEqual(stops,[sideId,mainId],'Closing the tab only releases its view, never cancels another conversation');
  assert.deepEqual(errors,[]);
  if(out)await writeFile(join(out,'report.json'),JSON.stringify({checks:['lazy creation','independent models/drafts/attachments','first-send attachment migration','parallel streams','hide/show retention','four viewports/themes','separate stops','main switch','dispose'],samples,errors},null,2));
  console.log('UI-07 side chat: parallel streams, attachments, models, separate stops and lifecycle passed');
} catch(error) {
  if(page){if(out){await mkdir(out,{recursive:true});await page.screenshot({path:join(out,'failure.png')});}console.error('Page errors:',errors);console.error(await page.evaluate(()=>({error:globalThis.sideError,delivery:globalThis.sideDeliveryError,notice:document.querySelector('.side-chat-notice')?.textContent,turn:testSideCore.state.turnStatus,events:[...testSideCore.state.historyEvents.values()],sessions:testSideCore.state.sessions.map(s=>({id:s.sessionId,running:s.running})),connection:testSideCore.state.connection})));}
  throw error;
} finally {
  await app?.close();await fixture?.close();if(lock)await unlink(lock);
  if(profile){assert.ok(resolve(profile).startsWith(join(resolve(tmpdir()),'weftmate-ui07-')));await rm(profile,{recursive:true,force:true});}
}
