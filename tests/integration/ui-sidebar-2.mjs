import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, open, unlink, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';

process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
const root = resolve(import.meta.dirname, '../..');
const temp = join(root, '.local', 'sidebar2'); await mkdir(temp, {recursive:true});
if (!process.env.WEFTMATE_TEST_TEMP_SCOPE) process.env.WEFTMATE_MANAGED_TEMP_ROOT ??= join(temp, 'fixtures');
const before = process.argv.includes('--before');
const out = process.env.WEFTMATE_EVIDENCE_DIR || join(temp, 'evidence'); await mkdir(out, {recursive:true});
let application, fixture, lock, page, watchdog, cdp;
const errors = [], report = {before, sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(), geometry:[], updates:[], phoneEntry:[]};
const stopTree = () => { const pid = application?.process()?.pid; if (pid) spawnSync('taskkill', ['/PID',String(pid),'/T','/F'], {windowsHide:true,stdio:'ignore',timeout:10000}); };
const b = name => page.getByRole('button', {name,exact:true});
const shot = async name => {
  // Native capture preserves the whole content surface when Chromium is zoomed.
  const {data}=await cdp.send('Page.captureScreenshot',{format:'png'});
  await writeFile(join(out,`${before?'before':'after'}-${name}.png`),Buffer.from(data,'base64'));
};
async function resize(width, height) {
  await application.evaluate(({BrowserWindow}, [w,h]) => BrowserWindow.getAllWindows()[0].setContentSize(w,h), [width,height]);
  await page.waitForFunction(w=>innerWidth===w,width);
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
}
try {
  if (process.env.WEFTMATE_HEAVY_LOCK_DIR) {
  for (const n of [1,2,3]) {
    const path=join(process.env.WEFTMATE_HEAVY_LOCK_DIR, `heavy-${n}.lock`);
    try { const file=await open(path,'wx'); await file.writeFile('UI-SIDEBAR-2 '+new Date().toISOString()); await file.close(); lock=path; break; }
    catch(error) { if(error.code!=='EEXIST') throw error; }
  }
  assert.ok(lock,'No heavy slot available');
  }
  watchdog=setTimeout(()=>{stopTree();process.exitCode=1;},170000);
  fixture=await startTimelineCandidate({historyCount:0,daily:true,sidebar:true,interactive:true,baseTime:Date.now()-2000});
  const projects=[];
  for (const [i,name] of ['合成项目研究计划与长期资料归档 Sidebar navigation research archive','空项目','资料三','资料四','资料五','资料六','资料七'].entries()) {
    const folder=join(temp, 'project-'+i); await mkdir(folder,{recursive:true});
    projects.push((await fixture.request('/projects',{requestId:randomUUID(),name,rootPath:folder,permission:'write'})).project);
  }
  await fixture.request(`/sessions/${fixture.sessionId}/metadata`,{title:'独立置顶 · 中文与 English title for reading every last character',pinned:true},'PATCH');
  const projectSessions=[];
  for (let n=0;n<7;n++) {
    let {command}=await fixture.request(`/projects/${projects[0].projectId}/sessions`,{requestId:randomUUID(),modelProfileId:'local'});
    const deadline=Date.now()+10000;
    while(command.state!=='accepted_by_dsh') { assert.notEqual(command.state,'rejected'); assert.ok(Date.now()<deadline); await new Promise(done=>setTimeout(done,20)); command=(await fixture.request(`/commands/${command.commandId}`)).command; }
    await fixture.request(`/sessions/${command.sessionId}/metadata`,{title:`项目对话 ${n+1}`,unread:n===2},'PATCH');
    projectSessions.push(command.sessionId);
  }
  for(let n=1;n<=12;n++) {
    const source=await fixture.newOutputSource(`合成最近记录 ${n}`);fixture.finishOutputSource(source);
    await fixture.request(`/sessions/${source.sessionId}/metadata`,{title:`最近对话 ${n}`},'PATCH');
  }
  const profile=await mkdtemp(join(temp,'profile-'));
  const env={...process.env,SIDEBAR2_PICKER_PATH:join(temp,'project-1'),SIDEBAR2_PROFILE:profile,SIDEBAR2_ORIGIN:fixture.origin,SIDEBAR2_TOKEN:fixture.libraryDesktopToken}; delete env.ELECTRON_RUN_AS_NODE;
  application=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:root,args:['tests/helpers/ui-sidebar-2-electron.mjs'],env,timeout:20000});
  application.process().stdout?.resume();application.process().stderr?.resume();
  page=await application.firstWindow();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
  cdp=await page.context().newCDPSession(page);
  await page.addInitScript(()=>{Object.defineProperty(document,'visibilityState',{get:()=> 'visible'});Object.defineProperty(document,'hidden',{get:()=>false});});
  await page.route('**/personal/v1/ui/app.js',async route=>route.fulfill({contentType:'text/javascript',body:(await readFile(join(root,'src/personal-access-ui/app.js'),'utf8')).replace('ui.loadAttachmentHasher =','globalThis.testCore=core;globalThis.testUi=ui;ui.loadAttachmentHasher =')}));
  await page.waitForURL('**/personal/v1/ui');await localUiSession(page,fixture.credentials,'UI-SIDEBAR-2 synthetic',{mainChat:true});
  await page.waitForFunction(()=>globalThis.__WeftUiStarted&&testCore.state.sessions.length>0);
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('wm:desktop:visibility',false));
  await page.evaluate(async id=>{await testCore.refreshSessions();testCore.pinProject(id,true);WeftDesktop.toggleRail(false);},projects[0].projectId);
  await resize(1280,800);
  report.sections=await page.locator('.sidebar-section-heading').evaluateAll(rows=>rows.map(row=>row.dataset.sectionId));
  const notice=page.locator('.desktop-update-notice');
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('wm:update-state',{layers:[{layer:'app',status:'not-available'}],completedVersion:'0.2.0-preview.21'}));
  await page.waitForFunction(()=>document.querySelector('.desktop-update-notice').hidden||document.querySelector('.desktop-update-notice').textContent.includes('已更新'));
  report.completedHidden=await notice.isHidden();
  for (const theme of ['light','dark']) {
    await page.evaluate(theme=>WeftDesktop.setAppearance({theme}),theme);
    for (const [width,height,zoom] of [[1280,800,1],[900,540,1],[1280,800,1.25],[1280,800,1.5]]) {
      await application.evaluate(({BrowserWindow},z)=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(z),zoom);
      await application.evaluate(({BrowserWindow},[w,h])=>BrowserWindow.getAllWindows()[0].setContentSize(w,h),[width,height]);
      await page.evaluate(()=>{WeftDesktop.toggleRail(false);document.querySelector('#session-list').scrollTop=0;});
      await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
      const geometry=await page.evaluate(()=>{
        const list=document.querySelector('#session-list'),footer=document.querySelector('.rail-footer'),nav=document.querySelector('.shell-navigation');
        const textStarts=[...nav.querySelectorAll('.rail-link:not([hidden])')].map(el=>{const range=document.createRange();range.selectNodeContents([...el.childNodes].find(n=>n.nodeType===3&&n.textContent.trim())||el.querySelector('span'));return {id:el.id,x:range.getBoundingClientRect().x};});
        return {list:list.getBoundingClientRect().toJSON(),nav:nav.getBoundingClientRect().toJSON(),footer:footer.getBoundingClientRect().toJSON(),scrollHeight:list.scrollHeight,scrollWidth:list.scrollWidth,clientWidth:list.clientWidth,textStarts};
      });
      report.geometry.push({theme,width,height,zoom,...geometry});
      await shot(`${theme}-${width}x${height}-zoom${zoom}`);
      if(!before) { assert.ok(geometry.list.top>=geometry.nav.bottom);assert.ok(geometry.list.bottom<=geometry.footer.top+1);assert.ok(geometry.list.height>=44);assert.ok(geometry.scrollWidth<=geometry.clientWidth);assert.ok(Math.max(...geometry.textStarts.map(x=>x.x))-Math.min(...geometry.textStarts.map(x=>x.x))<1,JSON.stringify(geometry.textStarts)); }
    }
  }
  if(before) { await writeFile(join(out,'before-report.json'),JSON.stringify(report,null,2));assert.deepEqual(report.sections,['pinned','projects','recent']);assert.equal(report.completedHidden,true); }
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));await resize(1280,800);
  assert.deepEqual(report.sections,['pinned','projects','recent']);assert.equal(report.completedHidden,true);
  await page.locator('#session-rail').evaluate(el=>el.style.setProperty('--rail-width','208px'));
  assert.equal(await page.locator('#session-list').evaluate(el=>el.scrollWidth<=el.clientWidth),true);await shot('narrow-sidebar');
  await page.locator('#session-rail').evaluate(el=>el.style.removeProperty('--rail-width'));
  const project=page.locator(`.sidebar-project[data-project-id="${projects[0].projectId}"]`);
  const independent=page.locator(`.session-row[data-session-id="${fixture.sessionId}"]`);
  assert.equal(await project.count(),1);assert.equal(await independent.count(),1);
  assert.equal(await page.locator('.sidebar-project').count(),6);
  await page.locator('[data-expand-projects]').click();assert.equal(await page.locator('.sidebar-project').count(),7);await page.locator('[data-expand-projects]').click();
  await page.locator('[data-section-id=projects] .sidebar-section-toggle').click();assert.equal(await page.locator('.sidebar-project').count(),1);
  await page.locator('[data-section-id=projects] .sidebar-section-toggle').press('Enter');assert.equal(await page.locator('.sidebar-project').count(),6);
  await page.locator('[data-section-id=pinned] .sidebar-section-toggle').click();assert.equal(await independent.count(),0);
  await page.locator('[data-section-id=pinned] .sidebar-section-toggle').press('Enter');assert.equal(await independent.count(),1);
  assert.equal(await project.locator('.project-conversations .session-row').count(),5);
  await project.locator('.project-expand').click();assert.equal(await project.locator('.project-conversations .session-row').count(),7);
  await project.locator('.project-expand').click();
  await project.locator('.sidebar-project-toggle').click();assert.equal(await project.locator('.project-conversations').count(),0);
  await project.locator('.sidebar-project-toggle').press('Enter');assert.equal(await project.locator('.project-conversations .session-row').count(),5);
  await project.getByRole('button',{name:`项目菜单 ${projects[0].name}`,exact:true}).click();
  await page.mouse.move(1000,400);await page.waitForFunction(()=>[...document.querySelectorAll('.project-action[aria-expanded=true]')].some(el=>getComputedStyle(el).opacity==='1'));
  await page.getByRole('menuitem',{name:'取消置顶',exact:true}).click();assert.equal(await page.evaluate(id=>testCore.projectPinned(id),projects[0].projectId),false);
  if (!await project.count()) await page.locator('[data-expand-projects]').click();
  await project.getByRole('button',{name:`项目菜单 ${projects[0].name}`,exact:true}).click();await page.getByRole('menuitem',{name:'置顶',exact:true}).click();
  const main=independent.locator('button').first();await main.focus();
  const title=main.locator('.sidebar-title-viewport');
  await page.waitForFunction(()=>document.querySelector('.session-row[data-session-id] .sidebar-title-viewport[data-overflow]'));
  assert.equal(await title.getAttribute('data-overflow'),'true');
  await page.waitForFunction(id=>getComputedStyle(document.querySelector(`.session-row[data-session-id="${id}"] .sidebar-title-text`)).transform!=='none',fixture.sessionId);
  await shot('title-keyboard-scroll');
  const titleMotion=[];
  for(let n=0;n<20;n++) {
    titleMotion.push(await title.locator('.sidebar-title-text').evaluate(el=>({at:performance.now(),transform:getComputedStyle(el).transform,x:el.getBoundingClientRect().x,right:el.getBoundingClientRect().right,clipRight:el.parentElement.getBoundingClientRect().right})));
    if(process.env.WEFTMATE_EVIDENCE_DIR) await shot(`title-motion-${String(n).padStart(2,'0')}`);
    await page.waitForTimeout(250);
  }
  report.titleMotion=titleMotion;assert.ok(titleMotion.at(-1).x<titleMotion[0].x);assert.ok(titleMotion.at(-1).right<=titleMotion.at(-1).clipRight+1,'the title tail becomes readable');
  await page.mouse.move(1000,400);await main.evaluate(el=>el.blur());
  assert.equal(await title.locator('.sidebar-title-text').evaluate(el=>getComputedStyle(el).transform),'none');
  await page.emulateMedia({reducedMotion:'reduce'});await main.focus();assert.equal(await title.locator('.sidebar-title-text').evaluate(el=>getComputedStyle(el).animationName),'none');assert.ok(await main.getAttribute('title'));await page.emulateMedia({reducedMotion:'no-preference'});
  await independent.locator('.session-more').click();await page.mouse.move(1000,400);await page.waitForFunction(()=>[...document.querySelectorAll('.session-more[aria-expanded=true]')].some(el=>getComputedStyle(el).opacity==='1'));await page.keyboard.press('Escape');
  await main.click();assert.equal(await page.evaluate(()=>testCore.state.selectedSessionId),fixture.sessionId);
  await independent.locator('.session-more').click();await page.getByRole('menuitemcheckbox',{name:/^取消置顶/}).click();
  await page.waitForFunction(id=>testCore.state.sessions.find(row=>row.sessionId===id)?.pinned===false,fixture.sessionId);
  await independent.locator('.session-more').click();await page.getByRole('menuitemcheckbox',{name:/^置顶/}).click();
  await page.waitForFunction(id=>testCore.state.sessions.find(row=>row.sessionId===id)?.pinned===true,fixture.sessionId);
  const shortTitle=project.locator('.project-conversations .session-row').first().locator('.sidebar-title-viewport');
  await shortTitle.hover();assert.equal(await shortTitle.getAttribute('data-overflow'),'false');assert.equal(await shortTitle.locator('.sidebar-title-text').evaluate(el=>getComputedStyle(el).animationName),'none');
  await page.locator('[data-section-id=recent] .project-action').last().click();assert.equal(await page.evaluate(()=>testCore.state.newConversation),true);
  await project.getByRole('button',{name:`在项目 ${projects[0].name} 新建对话`,exact:true}).click();
  await page.waitForFunction(()=>testCore.state.sessions.some(row=>row.sessionId===testCore.state.selectedSessionId));
  await project.locator('.sidebar-project-toggle').click();
  await shot('expanded-projects');
  await page.locator('[data-section-id=projects] .sidebar-section-toggle').click();
  for(const theme of ['light','dark']) { await page.evaluate(theme=>WeftDesktop.setAppearance({theme}),theme);await page.locator('#session-list').evaluate(el=>el.scrollTop=0);await shot(`groups-${theme}`); }
  await resize(900,540);
  const last=page.locator('#session-list > .session-row').last();await last.locator('button').first().focus();await last.scrollIntoViewIfNeeded();
  assert.equal(await last.evaluate(el=>{const row=el.getBoundingClientRect(),list=el.closest('#session-list').getBoundingClientRect();return row.top>=list.top&&row.bottom<=list.bottom;}),true);
  await shot('low-height-last-row');await resize(1280,800);
  // Finish the existing overview before introducing phone metadata. Assertions
  // below require the actual full snapshot, rather than a temporarily absent session.
  await page.evaluate(async()=>{testCore.stopAssistantRefresh();await testCore.refreshAssistantOverview();testCore.stopAssistantRefresh();});
  await page.waitForFunction(()=>!testCore.state.refreshing&&!testCore.state.phoneLoading);
  const phoneId='conversation-'+randomUUID(),at=new Date().toISOString();
  await fixture.request('/sync/capabilities',{sharedConversations:1,nativeVersionCode:11});
  await fixture.request('/sync/events',{events:[
    {eventId:'event-'+randomUUID(),conversationId:phoneId,clientSeq:1,kind:'conversation.created',occurredAt:at,payload:{title:'合成手机原话'}},
    {eventId:'event-'+randomUUID(),conversationId:phoneId,clientSeq:2,kind:'message.created',occurredAt:at,payload:{messageId:'message-'+randomUUID(),role:'user',text:'保留手机记录入口'}},
    {eventId:'event-'+randomUUID(),conversationId:phoneId,clientSeq:3,kind:'turn.finished',occurredAt:at,payload:{turnId:'turn-'+randomUUID(),status:'completed'}},
  ]});
  const shared=`/sync/conversations/${phoneId}/shared`;
  await fixture.request(shared,{requestId:randomUUID(),modelProfileId:'local',expectedSyncSeq:3});
  let binding=await fixture.request(shared);const bindDeadline=Date.now()+10000;
  while(binding.status!=='active') {assert.ok(Date.now()<bindDeadline);await page.waitForTimeout(20);binding=await fixture.request(shared);}
  await fixture.request(`/sessions/${binding.binding.sessionId}/metadata`,{pinned:true},'PATCH');
  const phoneRow=page.locator(`.session-row[data-phone-id="${phoneId}"]`);
  const phoneSessionId=binding.binding.sessionId;
  const phoneSnapshot=label=>page.evaluate(({id,sid,label})=>{
    const session=testCore.state.sessions.find(row=>row.sessionId===sid),view=testCore.state.phoneBindings.get(id),list=document.getElementById('session-list');
    const rows=[...list.querySelectorAll('.session-row')],phone=rows.filter(row=>row.dataset.phoneId===id);
    let section=null;if(phone.length){let owner=phone[0];while(owner.parentElement&&owner.parentElement!==list)owner=owner.parentElement;for(const child of list.children){if(child.dataset.sectionId)section=child.dataset.sectionId;if(child===owner)break;}}
    return {label,session:session?{sessionId:session.sessionId,pinned:session.pinned,projectId:session.projectId??null,groupId:session.groupId??null}:null,
      binding:{status:view?.status,sessionId:testCore.phoneBinding(id)?.sessionId},records:testCore.phoneConversations().filter(row=>row.id===id).length,
      phoneRows:phone.length,nativeRows:rows.filter(row=>row.dataset.sessionId===sid).length,section,activeChatSource:testCore.state.activeChatSource,selectedPhoneConversationId:testCore.state.selectedPhoneConversationId};
  },{id:phoneId,sid:phoneSessionId,label});
  const refreshPhone=async(label,{pinned,projectId=null,groupId=null,section='pinned',visible=true}={})=>{
    const states=[];
    for(let cycle=0;cycle<3;cycle++){
      await page.evaluate(async id=>{await testCore.refreshSessions();await testCore.refreshPhoneRecords();await testCore.refreshPhoneBinding(id);},phoneId);
      const state=await phoneSnapshot(`${label}:${cycle}`);report.phoneEntry.push(state);states.push(state);
      await writeFile(join(out,'phone-entry-report.json'),JSON.stringify({sourceCommit:report.sourceCommit,beforeFold:report.phoneEntryBeforeFold,states:report.phoneEntry},null,2));
      assert.deepEqual(state.session,{sessionId:phoneSessionId,pinned,projectId,groupId},'the full session metadata is present before checking its entry');
      assert.deepEqual(state.binding,{status:'active',sessionId:phoneSessionId});assert.equal(state.records,1);
      if(cycle===0)await shot('phone-entry-'+label);
    }
    for(const state of states){
      assert.equal(state.phoneRows,visible?1:0,JSON.stringify(state));assert.equal(state.nativeRows,visible?1:0,'phone and execution identities share one row');
      if(visible)assert.equal(state.section,section);
    }
  };
  await page.evaluate(async id=>{await testCore.refreshSessions();await testCore.refreshPhoneRecords();await testCore.refreshPhoneBinding(id);},phoneId);
  report.phoneEntryBeforeFold=await phoneSnapshot('full-state-before-fold');
  assert.deepEqual(report.phoneEntryBeforeFold.session,{sessionId:phoneSessionId,pinned:true,projectId:null,groupId:null});
  assert.deepEqual(report.phoneEntryBeforeFold.binding,{status:'active',sessionId:phoneSessionId});
  assert.equal(report.phoneEntryBeforeFold.records,1);
  // A real fold/reopen must reconcile the entry from the complete state even
  // when the binding arrived after an earlier cached sidebar presentation.
  await page.locator('[data-section-id="pinned"] .sidebar-section-toggle').click();
  await page.locator('[data-section-id="pinned"] .sidebar-section-toggle').click();
  await refreshPhone('coherent-pinned',{pinned:true});
  await page.evaluate(()=>{globalThis.phoneEntryNativeSelections=[];const select=testCore.selectSession;testCore.selectSession=(id,...args)=>{phoneEntryNativeSelections.push(id);return select(id,...args);};});
  const readPhone=async()=>{
    await phoneRow.locator('button').first().click();
    await page.waitForFunction(id=>testCore.state.activeChatSource==='phone'&&testCore.state.selectedPhoneConversationId===id,phoneId);
    await page.locator('#transcript').getByText('保留手机记录入口',{exact:true}).waitFor();
    assert.equal(await page.evaluate(sid=>phoneEntryNativeSelections.includes(sid),phoneSessionId),false,'the phone entry never opens the desktop execution history');
  };
  await readPhone();await refreshPhone('after-read',{pinned:true});
  const sectionToggle=id=>page.locator(`[data-section-id="${id}"] .sidebar-section-toggle`);
  await sectionToggle('recent').click();await refreshPhone('recent-folded',{pinned:true});await sectionToggle('recent').click();
  await sectionToggle('pinned').click();await refreshPhone('pinned-folded',{pinned:true,visible:false});await sectionToggle('pinned').click();await refreshPhone('pinned-reopened',{pinned:true});
  await phoneRow.locator('.session-more').click();await page.getByRole('menuitemcheckbox',{name:/^取消置顶/}).click();
  await page.waitForFunction(sid=>testCore.state.sessions.find(row=>row.sessionId===sid)?.pinned===false,phoneSessionId);
  await refreshPhone('unpinned',{pinned:false,section:'recent'});await readPhone();
  await sectionToggle('recent').click();await refreshPhone('unpinned-folded',{pinned:false,section:'recent',visible:false});await sectionToggle('recent').click();await refreshPhone('unpinned-reopened',{pinned:false,section:'recent'});
  const group=(await fixture.request('/session-groups',{name:'手机入口分组'})).group;
  await fixture.request(`/sessions/${phoneSessionId}/metadata`,{groupId:group.id},'PATCH');
  await refreshPhone('grouped',{pinned:false,groupId:group.id,section:'recent'});
  await b('手机入口分组').click();await refreshPhone('group-folded',{pinned:false,groupId:group.id,section:'recent',visible:false});await b('手机入口分组').click();await refreshPhone('group-reopened',{pinned:false,groupId:group.id,section:'recent'});
  await fixture.request(`/sessions/${phoneSessionId}/metadata`,{groupId:null,projectId:projects[1].projectId},'PATCH');
  await page.evaluate(()=>testCore.refreshSessions());
  if(await sectionToggle('projects').getAttribute('aria-expanded')==='false')await sectionToggle('projects').click();
  const phoneProject=page.locator(`.sidebar-project[data-project-id="${projects[1].projectId}"]`);
  if(!await phoneProject.count())await page.locator('[data-expand-projects]').click();
  await refreshPhone('project',{pinned:false,projectId:projects[1].projectId,section:'projects'});await readPhone();
  await phoneProject.locator('.sidebar-project-toggle').click();await refreshPhone('project-folded',{pinned:false,projectId:projects[1].projectId,section:'projects',visible:false});
  await phoneProject.locator('.sidebar-project-toggle').click();await refreshPhone('project-reopened',{pinned:false,projectId:projects[1].projectId,section:'projects'});
  await fixture.request(`/sessions/${phoneSessionId}/metadata`,{projectId:null,pinned:true},'PATCH');
  await refreshPhone('repinned',{pinned:true});await readPhone();
  await page.locator(`.session-row[data-session-id="${fixture.sessionId}"] > button`).first().click();
  await page.waitForFunction(sid=>testCore.state.activeChatSource==='desktop'&&testCore.state.selectedSessionId===sid,fixture.sessionId);
  await refreshPhone('after-desktop-switch',{pinned:true});
  await shot('pinned-phone-record');
  for(const [state,expected] of [
    [{status:'not-available'},''],
    [{status:'available',version:'0.2.0-preview.22'},'发现 0.2.0-preview.22 · 查看更新'],
    [{status:'available',version:'0.2.0-preview.22',progress:{percent:37.8}},'正在下载 · 37%'],
    [{status:'downloaded',version:'0.2.0-preview.22'},'新版已就绪 · 重启并更新'],
    [{status:'error',version:'0.2.0-preview.22',error:'合成下载失败'},'更新失败 · 查看并重试'],
    [{status:'not-available',completedVersion:'0.2.0-preview.22'},''],
  ]) {
    await application.evaluate(({BrowserWindow},value)=>BrowserWindow.getAllWindows()[0].webContents.send('wm:update-state',value),state);
    await page.waitForFunction(text=>document.querySelector('.desktop-update-notice').textContent===text,expected);
    assert.equal(await notice.isHidden(),!expected);report.updates.push({state,expected});await shot('update-'+state.status+(state.progress?'-progress':''));
  }
  assert.deepEqual(errors,[]);report.errors=errors;
  await writeFile(join(out,'after-report.json'),JSON.stringify(report,null,2));
  console.log('UI-SIDEBAR-2: grouping, native layout, actions, titles and update bridge passed');
} catch(error) {
  report.error=String(error.stack||error);report.errors=errors;await writeFile(join(out,'after-report.json'),JSON.stringify(report,null,2));
  if(page && !page.isClosed()) {
    await shot('failure').catch(()=>{});
    await writeFile(join(out,'failure.json'),JSON.stringify(await page.evaluate(()=>({sessions:testCore.state.sessions,selected:testCore.state.selectedSessionId,menus:[...document.querySelectorAll('[role=menu]')].map(el=>({text:el.innerText,html:el.outerHTML}))})),null,2));
  }
  throw error;
} finally {
  clearTimeout(watchdog);
  await application?.close().catch(stopTree);await fixture?.close().catch(()=>{});if(lock)await unlink(lock);
}


