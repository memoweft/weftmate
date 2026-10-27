import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, open, unlink, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { measureUi } from '../helpers/ui-smoothness.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
const root = resolve(import.meta.dirname, '../..');
const temp = join(root, '.local', 'ui01'); await mkdir(temp, { recursive: true });
if (!process.env.WEFTMATE_TEST_TEMP_SCOPE) process.env.WEFTMATE_MANAGED_TEMP_ROOT ??= join(temp, 'fixtures');
let application, fixture, lock, watchdog, page;
const errors = [];
const stopTree = () => { const pid = application?.process()?.pid; if (pid) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10000, stdio: 'ignore' }); };
const capture = async name => { if (!process.env.WEFTMATE_EVIDENCE_DIR) return; await mkdir(process.env.WEFTMATE_EVIDENCE_DIR, { recursive: true }); await page.screenshot({ path: join(process.env.WEFTMATE_EVIDENCE_DIR, name + '.png'), animations:'disabled' }); };
async function resize(width, height = 900) { await application.evaluate(({ BrowserWindow }, [w,h]) => BrowserWindow.getAllWindows()[0].setContentSize(w,h), [width,height]); await page.waitForFunction(expected=>innerWidth===expected,width); await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))); }
try {
  if (process.env.WEFTMATE_HEAVY_LOCK_DIR) {
    for (const n of [1,2,3]) {
      const path = join(process.env.WEFTMATE_HEAVY_LOCK_DIR, `heavy-${n}.lock`);
      try { const file = await open(path, 'wx'); await file.writeFile('UI-01-SHELL ' + new Date().toISOString()); await file.close(); lock = path; break; }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    assert.ok(lock, 'No heavy slot available');
  }
  watchdog = setTimeout(() => { stopTree(); process.exitCode = 1; }, process.env.WEFTMATE_SMOOTHNESS_FILE ? 280000 : 170000);
  const profile = await mkdtemp(join(temp, 'profile-'));
  fixture = await startTimelineCandidate({ historyCount: 0, interactive: true, thinking: true, baseTime: Date.now() - 2000 });
  const relocation=join(temp,'relocated-project');await mkdir(relocation,{recursive:true});
  const env = { ...process.env, UI01_PICKER_PATH:relocation, UI01_PROFILE: profile, UI01_ORIGIN: fixture.origin, UI01_TOKEN: fixture.libraryDesktopToken }; delete env.ELECTRON_RUN_AS_NODE;
  application = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: root, args: ['tests/helpers/ui-01-shell-electron.mjs'], env, timeout: 20000 });
  application.process().stdout?.resume(); application.process().stderr?.resume();
  page = await application.firstWindow(); page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { Object.defineProperty(document, 'visibilityState', {get: () => 'visible'}); Object.defineProperty(document, 'hidden', {get: () => false}); Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>globalThis.ui01Clipboard=text}}); });
  await page.route('**/personal/v1/ui/app.js', async route => route.fulfill({ contentType: 'text/javascript', body: (await readFile(join(root, 'src/personal-access-ui/app.js'), 'utf8')).replace('ui.loadAttachmentHasher =', 'globalThis.testCore=core;globalThis.testUi=ui;ui.loadAttachmentHasher =') }));
  await page.waitForURL('**/personal/v1/ui');
  await localUiSession(page, fixture.credentials, 'UI01 synthetic', { mainChat: true });
  await page.getByRole('textbox', {name:'输入消息', exact:true}).waitFor();
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('wm:desktop:visibility', false));
  await page.waitForFunction(() => globalThis.__WeftUiStarted && testCore.state.sessions.length > 0);
  await page.evaluate(id => testCore.selectSession(id), fixture.sessionId);
  await page.getByRole('button',{name:'停止回复',exact:true}).waitFor();
  await resize(1440);
  const panel = page.getByRole('complementary', { name:'工作面板', exact:true });
  if (!process.argv.includes('--evidence-only')) {
  await page.getByRole('button', {name:'打开工作面板',exact:true}).click();
  assert.equal(await panel.locator('[data-panel-kind]').count(), 6);
  await panel.locator('[data-panel-kind=review]').click();
  await panel.locator('.panel-review').getByText('先在工作模式里选一个工作目录。',{exact:true}).waitFor();
  await panel.getByRole('button', {name:'再打开一项',exact:true}).click();
  const menu = page.getByRole('menu', {name:'打开面板',exact:true});
  assert.equal(await menu.getByRole('menuitem').count(), 6);
  await menu.getByRole('menuitem', {name:'文件',exact:true}).click();
  await panel.locator('.files-resource-group summary').filter({hasText:/^成果 ·/}).waitFor();
  const before = await panel.boundingBox();
  await panel.getByRole('separator', {name:'调整预览宽度'}).press('ArrowLeft');
  assert.ok((await panel.boundingBox()).width > before.width);
  await panel.getByRole('button', {name:'放大右侧面板',exact:true}).click();
  assert.ok((await panel.boundingBox()).width > 900);
  await panel.getByRole('button', {name:'还原右侧面板',exact:true}).click();
  await panel.getByRole('tab', {name:'审查',exact:true}).press('ArrowRight');
  assert.equal(await panel.getByRole('tab', {name:'文件',exact:true}).getAttribute('aria-selected'), 'true');
  // A real mounted input verifies that hide/switch preserve content and close releases it.
  await page.evaluate(() => {
    globalThis.lifecycleLog = [];
    WeftPanels.register('terminal', {title:'终端',icon:'tool',create(ctx) {
      const el=document.createElement('input'); el.setAttribute('aria-label','合成终端输入'); lifecycleLog.push(['create',ctx.conversationId]);
      return {el,show(){lifecycleLog.push(['show']);},hide(){lifecycleLog.push(['hide']);},update(ctx){lifecycleLog.push(['update',ctx.conversationId]);},dispose(){lifecycleLog.push(['dispose']);}};
    }});
  });
  await page.keyboard.press('Control+Alt+2');
  await panel.getByRole('textbox', {name:'合成终端输入'}).fill('保留终端输入');
  await panel.getByRole('tab', {name:'文件',exact:true}).click();
  await panel.getByRole('tab', {name:'终端',exact:true}).click();
  assert.equal(await panel.getByRole('textbox', {name:'合成终端输入'}).inputValue(), '保留终端输入');
  await panel.getByRole('button', {name:'收起右侧面板',exact:true}).click();
  await panel.waitFor({state:'hidden'}); await page.keyboard.press('Control+Alt+p');
  assert.equal(await panel.getByRole('textbox', {name:'合成终端输入'}).inputValue(), '保留终端输入');
  await page.keyboard.press('Control+Alt+2'); assert.equal(await panel.getByRole('tab', {name:'终端',exact:true}).count(), 1);
  await panel.getByRole('button', {name:'关闭标签 终端',exact:true}).click();
  assert.equal(await page.evaluate(() => lifecycleLog.filter(row=>row[0]==='create').length), 1);
  assert.equal(await page.evaluate(() => lifecycleLog.filter(row=>row[0]==='dispose').length), 1);
  assert.equal(fixture.operations.filter(row=>row.kind==='cancel').length, 0);
  // Last explicit side wins at medium widths; phone tools are a full-screen page.
  await resize(960); await page.getByRole('button', {name:'切换会话侧栏',exact:true}).click();
  await panel.waitFor({state:'hidden'}); await page.locator('#session-rail').waitFor({state:'visible'});
  await page.getByRole('button', {name:'打开工作面板',exact:true}).click();
  await page.locator('#session-rail').waitFor({state:'hidden'});
  assert.ok((await page.locator('.assistant-main').boundingBox()).width >= 420);
  await resize(390,844); assert.ok((await panel.boundingBox()).width >= 388,JSON.stringify(await panel.evaluate(el=>({rect:el.getBoundingClientRect().toJSON(),width:getComputedStyle(el).width,position:getComputedStyle(el).position,parentTransform:getComputedStyle(el.parentElement).transform,sheets:[...document.styleSheets].map(s=>s.href).filter(x=>x?.includes('workspace'))}))));
  await panel.getByRole('button', {name:'收起右侧面板',exact:true}).click();
  await page.getByRole('textbox', {name:'输入消息',exact:true}).fill('窄窗口仍能输入');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await resize(1440); await page.evaluate(() => WeftDesktop.toggleRail(false)); await page.locator('#session-rail').waitFor({state:'visible'});
  // Late resource responses cannot paint into a new conversation.
  await page.evaluate(() => {
    const original=WeftPanels.services.resources; let first=true;
    WeftPanels.services.resources=()=>{if(!first)return Promise.resolve({outputs:[],sources:[]});first=false;return new Promise(resolve=>globalThis.releaseOldFiles=()=>resolve({outputs:[{key:'stale',name:'旧对话迟到文件',kind:'file'}],sources:[]}));};
    WeftPanels.close('files');WeftPanels.open('files');globalThis.restoreFiles=()=>WeftPanels.services.resources=original;
  });
  await page.keyboard.press('Control+n');
  await page.evaluate(() => releaseOldFiles());
  await panel.getByText('这段对话还没有成果。',{exact:true}).waitFor();
  assert.equal(await page.getByText('旧对话迟到文件',{exact:true}).count(),0);
  await page.evaluate(() => restoreFiles());
  fixture.progress.call('subagent','ui01-subtask',{description:'核对资料',prompt:'合成任务'}); fixture.progress.result('ui01-subtask','测试通过');
  await fixture.complete();
  await page.evaluate(id => testCore.selectSession(id), fixture.sessionId);
  await page.getByText('报告已保存，测试全部通过。',{exact:true}).waitFor();
  await page.getByRole('button',{name:'打开成果 项目进度报告.md',exact:true}).click();
  await panel.getByText('已读取 3 个文件。42 项测试通过。',{exact:true}).waitFor();
  await page.getByRole('button',{name:'打开成果 项目进度报告.md',exact:true}).click();
  assert.equal(await panel.getByRole('tab',{name:'项目进度报告.md',exact:true}).count(),1);
  // The host's subagent tool events feed both lists and the original step.
  await page.keyboard.press('Control+Alt+6');
  await panel.getByRole('button',{name:'核对资料，完成，查看步骤'}).click();
  assert.equal(await page.evaluate(()=>document.activeElement?.closest('.execution-step')?.open),true);
  await page.evaluate(() => WeftPanels.reset());
  const current=page.locator(`.session-row[data-session-id="${fixture.sessionId}"]`);
  await current.locator('.session-more').click();
  assert.equal(await page.getByRole('menuitem',{name:'打开方式',exact:true}).count(),0);
  await page.getByRole('menuitem',{name:'记忆与保留',exact:true}).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.session-computer-name').count(),0);
  const folder = join(temp,'synthetic-project'); await mkdir(folder,{recursive:true}); await writeFile(join(folder,'kept.txt'),'synthetic user file');
  const longName='合成项目需要在详情中完整阅读的文件夹名称';
  const project=(await fixture.request('/projects',{requestId:'ui01-gui-project',name:longName,rootPath:folder,permission:'write'})).project;
  await fixture.request(`/sessions/${fixture.sessionId}/metadata`,{projectId:project.projectId},'PATCH');
  await page.evaluate(async()=>{await testCore.refreshSessions();testCore.chooseSidebarMode('work');WeftDesktop.toggleRail(false);});
  const projectRow=page.locator(`.sidebar-project[data-project-id="${project.projectId}"]`);
  const projectToggle=projectRow.locator('.sidebar-project-toggle');await projectToggle.hover();
  await page.getByRole('tooltip').getByText(longName,{exact:true}).waitFor();
  await page.mouse.move(800,400);
  await projectRow.getByRole('button',{name:`项目菜单 ${longName}`,exact:true}).click();
  const projectMenu=page.getByRole('menu',{name:'项目操作',exact:true});
  for(const name of ['重命名','置顶','归档项目里的对话','批量管理','在文件资源管理器中显示','复制工作目录','更改文件夹位置','移除']) await projectMenu.getByRole('menuitem',{name,exact:true}).waitFor();
  await projectMenu.getByRole('menuitem',{name:'置顶',exact:true}).click();
  assert.equal(await page.evaluate(id=>testCore.projectPinned(id),project.projectId),true);
  await projectRow.getByRole('button',{name:`项目菜单 ${longName}`,exact:true}).click();
  await projectMenu.getByRole('menuitem',{name:'重命名',exact:true}).click();
  await page.getByRole('textbox',{name:'重命名项目',exact:true}).fill('合成项目的新名字');
  await page.getByRole('dialog',{name:'重命名项目',exact:true}).getByRole('button',{name:'保存',exact:true}).click();
  await projectRow.getByRole('button',{name:'项目菜单 合成项目的新名字',exact:true}).waitFor();
  await projectRow.getByRole('button',{name:'项目菜单 合成项目的新名字',exact:true}).click();
  await projectMenu.getByRole('menuitem',{name:'复制工作目录',exact:true}).click();
  await page.waitForFunction(value=>globalThis.ui01Clipboard===value,folder);
  await projectRow.getByRole('button',{name:'项目菜单 合成项目的新名字',exact:true}).click();
  await projectMenu.getByRole('menuitem',{name:'在文件资源管理器中显示',exact:true}).click();
  const revealDeadline=Date.now()+5000; while(await application.evaluate(()=>globalThis.ui01RevealedPath)!==folder) {assert.ok(Date.now()<revealDeadline,'native folder reveal receipt');await new Promise(resolve=>setTimeout(resolve,32));}
  await projectRow.getByRole('button',{name:'项目菜单 合成项目的新名字',exact:true}).click();
  await projectMenu.getByRole('menuitem',{name:'更改文件夹位置',exact:true}).click();
  await page.getByRole('dialog',{name:'更改文件夹位置',exact:true}).getByRole('button',{name:'使用这个文件夹',exact:true}).click();
  await page.getByRole('dialog',{name:'更改文件夹位置',exact:true}).waitFor({state:'hidden'});
  assert.equal((await page.evaluate(id=>weftmateDesktop.projectFolderInfo(id),project.projectId)).rootPath,relocation);
  assert.equal(await readFile(join(folder,'kept.txt'),'utf8'),'synthetic user file');
  await projectRow.getByRole('button',{name:'项目菜单 合成项目的新名字',exact:true}).click();
  await projectMenu.getByRole('menuitem',{name:'批量管理',exact:true}).click();
  await page.getByRole('dialog',{name:'管理项目对话'}).getByRole('checkbox').check();
  await page.getByRole('button',{name:'归档所选',exact:true}).click();
  await page.getByRole('dialog',{name:'管理项目对话'}).waitFor({state:'hidden'});
  assert.equal((await fixture.request('/sessions?archived=all')).sessions.find(row=>row.sessionId===fixture.sessionId).archived,true);
  await fixture.request(`/sessions/${fixture.sessionId}/unarchive`,{});
  await page.evaluate(async()=>{await testCore.refreshSessions();WeftDesktop.toggleRail(false);});
  assert.equal(await page.evaluate(()=>{const before=document.querySelector('.sidebar-project');testCore.state.projectsError='合成的无关状态变更';testUi.renderSessions();testCore.state.projectsError='';return before===document.querySelector('.sidebar-project');}),true);
  await page.getByRole('button',{name:'打开工作面板',exact:true}).click();
  // Closing the final tab returns to the same registered launcher.
  await panel.locator('[data-panel-kind=review]').click();await panel.getByRole('button',{name:'关闭标签 审查',exact:true}).click();
  assert.equal(await panel.locator('[data-panel-kind]').count(),6);
  for(const theme of ['light','dark']) {
    await page.evaluate(theme=>WeftDesktop.setAppearance({theme}),theme);
    for(const width of [1280,900,390]) {
      await resize(width,width===390?844:width===1280?800:700);
      await page.evaluate(() => { if(innerWidth>1100)WeftDesktop.toggleRail(false); WeftPanels.show(document.getElementById('workspace-panels')); });
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await capture(`workspace-${theme}-${width}`);
      if(width===390){await page.evaluate(()=>WeftPanels.hide(false));await capture(`composer-${theme}-390`);}
    }
  }
  } else {
    await fixture.complete();
    const folder=join(temp,'evidence-project');await mkdir(folder,{recursive:true});
    const project=(await fixture.request('/projects',{requestId:'evidence-project',name:'合成项目需要在信息卡中完整阅读的名称',rootPath:folder,permission:'write'})).project;
    await fixture.request(`/sessions/${fixture.sessionId}/metadata`,{projectId:project.projectId},'PATCH');
    await page.evaluate(async()=>{await testCore.refreshSessions();testCore.chooseSidebarMode('work');WeftDesktop.toggleRail(false);WeftDesktop.setAppearance({theme:'dark'});});
    const projectRow=page.locator(`.sidebar-project[data-project-id="${project.projectId}"]`);
    await projectRow.locator('.sidebar-project-toggle').hover();await page.getByRole('tooltip').waitFor();await capture('workspace-hover-card');
    await projectRow.getByRole('button',{name:/项目菜单/}).click();await page.getByRole('menu',{name:'项目操作',exact:true}).waitFor();await capture('workspace-project-menu');await page.keyboard.press('Escape');
  }
  if(process.env.WEFTMATE_SMOOTHNESS_FILE) {
    const samples=[];
    await mkdir(resolve(process.env.WEFTMATE_SMOOTHNESS_FILE,'..'),{recursive:true});
    const record=sample=>{samples.push(sample);writeFileSync(process.env.WEFTMATE_SMOOTHNESS_FILE,JSON.stringify({application:'WeftMate',complete:false,sampleWindowMs:750,repetitions:3,samples},null,2));};
    for(const width of [1280,900]) {
      await resize(width, width===1280?800:700);
      await page.evaluate(()=>{WeftDesktop.setAppearance({theme:'light'});WeftPanels.reset();});
      for(let repetition=0;repetition<3;repetition++) {
        record({width,repetition,...await measureUi(page,'open-panel',()=>page.keyboard.press('Control+Alt+p'),{kind:'panel',visible:true})});
        record({width,repetition,...await measureUi(page,'close-panel',()=>page.keyboard.press('Control+Alt+p'),{kind:'panel',visible:false})});
      }
      await page.keyboard.press('Control+Alt+1');await page.keyboard.press('Control+Alt+4');
      for(let repetition=0;repetition<3;repetition++) {
        record({width,repetition,...await measureUi(page,'switch-tab',()=>page.keyboard.press('Control+Alt+1'),{kind:'tab',title:'审查'})});
        await page.keyboard.press('Control+Alt+4');
        const before=await panel.boundingBox(),handle=await panel.getByRole('separator').boundingBox();
        record({width,repetition,...await measureUi(page,'resize-panel',async()=>{await page.mouse.move(handle.x+handle.width/2,handle.y+100);await page.mouse.down();await page.mouse.move(handle.x+(before.width>400?60:-60),handle.y+100,{steps:12});await page.mouse.up();},{kind:'width',before:before.width})});
      }
      await page.evaluate(()=>WeftPanels.hide(false));
      for(let repetition=0;repetition<3;repetition++) {
        record({width,repetition,...await measureUi(page,'new-conversation',()=>page.keyboard.press('Control+n'),{kind:'draft'})});
        await page.evaluate(()=>{testCore.chooseSidebarMode('work');WeftDesktop.toggleRail(false);});
        record({width,repetition,...await measureUi(page,'switch-conversation',()=>page.locator(`.session-row[data-session-id="${fixture.sessionId}"] > button`).first().click(),{kind:'conversation',id:fixture.sessionId})});
      }
      await page.evaluate(()=>{
        const source=testCore.state.sessions.find(row=>row.sessionId===testCore.state.selectedSessionId);
        for(let i=0;i<200;i++)testCore.state.sessions.push({...source,sessionId:`session-ui01-scroll-${i}`,chatId:undefined,title:`合成列表会话 ${i+1}`,updatedAt:new Date(Date.now()-i*1000).toISOString()});
        testCore.setProjectExpanded(source.projectId,true);testCore.chooseSidebarMode('work');testUi.renderSessions();WeftDesktop.toggleRail(false);
      });
      for(let repetition=0;repetition<3;repetition++) {
        const list=page.locator('#session-list'),box=await list.boundingBox(),before=await list.evaluate(el=>el.scrollTop);
        await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
        record({width,repetition,syntheticRows:200,...await measureUi(page,'long-list-scroll',()=>page.mouse.wheel(0,650),{kind:'scroll',before})});
      }
      await page.evaluate(()=>testCore.refreshSessions());
    }
    await mkdir(resolve(process.env.WEFTMATE_SMOOTHNESS_FILE,'..'),{recursive:true});
    await writeFile(process.env.WEFTMATE_SMOOTHNESS_FILE,JSON.stringify({application:'WeftMate',complete:true,sampleWindowMs:750,repetitions:3,visibility:'Electron offscreen rendering at 60fps with background throttling disabled; no visible window',samples},null,2));
  }
  assert.deepEqual(errors,[]);
  console.log(process.argv.includes('--evidence-only')?'UI-01 evidence and smoothness complete.':'UI-01 shell: lifecycle, keyboard, context, resources, subtasks, responsive and themes passed.');
} catch(error) {
  if(page) { await capture('failure').catch(()=>{}); console.error('UI errors:',JSON.stringify(errors)); console.error('Shell state:',await page.evaluate(()=>({width:innerWidth,body:document.body.className,rail:document.getElementById('session-rail')?.className,ctx:WeftPanels?.context,model:getComputedStyle(document.getElementById('model-label')).cssText})).catch(()=>({})));  }
  throw error;
} finally {
  clearTimeout(watchdog);
  if(application) { try { await Promise.race([application.close(),new Promise((_,reject)=>setTimeout(()=>reject(Error('close timeout')),7000))]); } catch {stopTree();} }
  await fixture?.close(); if(lock)await unlink(lock);
}
