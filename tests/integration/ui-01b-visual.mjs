import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, open, unlink, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { measureUi } from '../helpers/ui-smoothness.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
process.env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
const root=resolve(import.meta.dirname,'../..'),temp=join(root,'.local/ui01b');await mkdir(temp,{recursive:true});
process.env.WEFTMATE_MANAGED_TEMP_ROOT??=join(temp,'fixtures');
let app,fixture,page,lock,watchdog,browser,phoneFixture;const errors=[],observations=[];
const kill=()=>{const pid=app?.process()?.pid;if(pid)spawnSync('taskkill',['/PID',String(pid),'/T','/F'],{windowsHide:true,timeout:10000,stdio:'ignore'});};
const capture=async name=>{assert.equal(await page.locator('#toast').isVisible(),false,'capture has no transient error toast');if(process.env.WEFTMATE_EVIDENCE_DIR&&!process.argv.includes('--no-capture')){await mkdir(process.env.WEFTMATE_EVIDENCE_DIR,{recursive:true});await page.screenshot({path:join(process.env.WEFTMATE_EVIDENCE_DIR,name+'.png'),animations:'disabled'});}};
const size=async(w,h)=>{await app.evaluate(({BrowserWindow},[w,h])=>BrowserWindow.getAllWindows()[0].setContentSize(w,h),[w,h]);await page.waitForFunction(w=>innerWidth===w,w);};
try {
  if(process.env.WEFTMATE_HEAVY_LOCK_DIR){for(const n of [1,2,3]){const p=join(process.env.WEFTMATE_HEAVY_LOCK_DIR,`heavy-${n}.lock`);try{const f=await open(p,'wx');await f.writeFile('UI-01B '+new Date().toISOString());await f.close();lock=p;break;}catch(e){if(e.code!=='EEXIST')throw e;}}assert.ok(lock,'No heavy slot');}
  watchdog=setTimeout(()=>{kill();process.exitCode=1;},150000);
  const profile=await mkdtemp(join(temp,'profile-')),folder=join(temp,'synthetic-project');await mkdir(folder,{recursive:true});
  fixture=await startTimelineCandidate({historyCount:0,interactive:true,daily:true,sidebar:true,nativeIdentity:true,authenticate:async({service,origin})=>{const response=await fetch(origin+'/personal/v1/auth/desktop',{method:'POST',headers:{origin,'content-type':'application/json','x-weftmate-desktop':service.libraryDesktopToken},body:JSON.stringify({deviceName:'UI01B synthetic desktop'})});assert.equal(response.status,200);return {auth:await response.json(),cookie:response.headers.get('set-cookie').split(';')[0]};},systemManager:{status:async()=>({components:[],metrics:{},queue:{}})}});await fixture.complete();await fixture.request(`/sessions/${fixture.sessionId}/metadata`,{title:'项目进度报告'},'PATCH');
  const project=(await fixture.request('/projects',{requestId:'ui01b-project',name:'秋季发布与产品资料',rootPath:folder,permission:'write'})).project;
  const source=await fixture.newOutputSource('合成项目计划，不访问真实资料。',project.projectId);fixture.finishOutputSource(source);
  await fixture.request(`/sessions/${source.sessionId}/metadata`,{title:'发布计划与交付安排'},'PATCH');
  const env={...process.env,UI01_PROFILE:profile,UI01_ORIGIN:fixture.origin,UI01_TOKEN:fixture.libraryDesktopToken,UI01_PICKER_PATH:folder,WEFTMATE_SMOOTHNESS_FILE:'offscreen-render'};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:['tests/helpers/ui-01b-electron.mjs'],cwd:root,env,timeout:20000});
  app.process().stdout?.resume();app.process().stderr?.resume();page=await app.firstWindow();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{Object.defineProperty(document,'hidden',{get:()=>false});Object.defineProperty(document,'visibilityState',{get:()=> 'visible'});});
  await page.route('**/personal/v1/ui/app.js',async route=>route.fulfill({contentType:'text/javascript',body:(await readFile(join(root,'src/personal-access-ui/app.js'),'utf8')).replace('ui.loadAttachmentHasher =','globalThis.visualCore=core;globalThis.testCore=core;globalThis.visualUi=ui;ui.loadAttachmentHasher =')}));
  await page.waitForURL('**/personal/v1/ui');await page.reload();await page.waitForFunction(()=>globalThis.visualCore?.state.device?.authKind==='desktop'&&visualCore.state.csrfToken);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('wm:desktop:visibility',false));
  await page.waitForFunction(()=>globalThis.__WeftUiStarted);await page.evaluate(()=>{globalThis.bNotices=[];const old=visualUi.toast;visualUi.toast=(text,...args)=>{bNotices.push(text);return old(text,...args);};});await size(1280,800);
  await page.waitForFunction(id=>visualCore.state.sessions?.some(row=>row.sessionId===id)&&Array.isArray(visualCore.state.chats)&&!visualCore.state.refreshing,fixture.sessionId);
  await page.evaluate(id=>visualCore.selectSession(id),fixture.sessionId);
  const rail=page.locator('#session-rail'),projects=rail.getByRole('button',{name:'项目',exact:true}),recent=rail.getByRole('button',{name:'最近',exact:true});
  await projects.waitFor();await recent.waitFor();await page.getByText('秋季发布与产品资料',{exact:true}).first().waitFor();
  assert.equal(await page.locator('#rail-brand-actions').getByRole('button',{name:'搜索',exact:true}).count(),1);
  assert.equal(await page.locator('.rail-history-modes').count(),0);
  await page.evaluate(()=>{globalThis.originalUnread=visualCore.activity.unreadCount;visualCore.activity.unreadCount=2;visualUi.renderActivity();});assert.equal(await page.getByRole('button',{name:'查看动态通知',exact:true}).getAttribute('aria-description'),'2 条未读');await page.evaluate(()=>{visualCore.activity.unreadCount=0;visualUi.renderActivity();});assert.equal(await page.locator('.rail-brand-badge').isVisible(),false);await page.evaluate(()=>{visualCore.activity.unreadCount=originalUnread;visualUi.renderActivity();});
  await page.evaluate(()=>WeftDesktop.setAppearance({uiFontSize:'16'}));assert.equal(await page.locator('.shell-navigation .rail-link').first().evaluate(el=>getComputedStyle(el).fontSize),'16px');await page.evaluate(()=>WeftDesktop.setAppearance({uiFontSize:'14'}));
  const projectRow=page.locator('.sidebar-project');await page.evaluate(id=>{globalThis.originalSidebarStatus=visualCore.state.sessionStatusSummary;visualCore.state.sessionStatusSummary={projects:{[id]:{running:true}}};visualUi.renderSessions();},project.projectId);await projects.click();await projectRow.waitFor({state:'hidden'});await rail.locator('[data-section-id=projects] [aria-label="正在运行"]').waitFor();await projects.click();await projectRow.waitFor();await page.evaluate(()=>{visualCore.state.sessionStatusSummary=originalSidebarStatus;visualUi.renderSessions();});
  const recentRow=page.locator(`.session-row[data-session-id="${fixture.sessionId}"]`);
  await page.evaluate(()=>{visualCore.state.sessionListNextCursor='synthetic-next';visualUi.renderSessions();});await rail.getByRole('button',{name:'更早的对话',exact:true}).waitFor();
  await recent.focus();await recent.press('Enter');await recentRow.waitFor({state:'hidden'});assert.equal(await rail.getByRole('button',{name:'更早的对话',exact:true}).count(),0);assert.equal(await recent.evaluate(el=>el===document.activeElement),true);
  await recent.press('Enter');await recentRow.waitFor();await page.evaluate(()=>{visualCore.state.sessionListNextCursor=null;visualUi.renderSessions();});
  await page.getByRole('button',{name:'筛选最近对话'}).click();await page.getByRole('menuitemradio',{name:'工作',exact:true}).click();await recentRow.waitFor({state:'hidden'});await projectRow.waitFor();
  await page.getByRole('button',{name:'筛选最近对话'}).click();await page.getByRole('menuitemradio',{name:'全部',exact:true}).click();await recentRow.waitFor();
  await page.keyboard.press('Control+n');
  const modes=page.getByRole('tablist',{name:'新对话模式',exact:true});await modes.getByRole('tab',{name:'新对话：工作',exact:true}).click();
  await page.getByRole('button',{name:'选择项目或文件夹',exact:true}).click();await page.getByRole('menuitemradio',{name:/秋季发布与产品资料/}).click();
  assert.equal(await page.locator('.work-mode-toolbar').evaluate(el=>el.parentElement.id), 'message-form');
  await page.locator('#message-text').fill('保留在工作模式的草稿');await modes.getByRole('tab',{name:'新对话：对话',exact:true}).click();
  assert.equal(await page.locator('#message-text').inputValue(),'保留在工作模式的草稿');await page.locator('#message-text').fill('');
  assert.deepEqual(await page.evaluate(()=>globalThis.bNotices),[],'capture only an authenticated settled fixture');
  for(const theme of ['light','dark']) for(const [w,h] of [[1280,800],[900,700]]) {
    await size(w,h);await page.evaluate(theme=>{WeftDesktop.setAppearance({theme});WeftPanels.reset();WeftDesktop.toggleRail(false);},theme);
    await page.keyboard.press('Control+n');
    await page.waitForFunction(()=>visualCore.state.newConversation&&!visualCore.state.submitting);
    await page.getByRole('button',{name:'打开工作面板',exact:true}).click();
    const emptyGap=await page.evaluate(()=>document.getElementById('message-form').getBoundingClientRect().top-document.querySelector('#chat-intro h1').getBoundingClientRect().bottom);assert.ok(emptyGap<110,`welcome and composer stay together: ${emptyGap}`);
    await capture(`empty-${theme}-${w}`);
    await modes.getByRole('tab',{name:'新对话：工作',exact:true}).click();await page.locator('.work-mode-toolbar').waitFor();await capture(`work-${theme}-${w}`);await modes.getByRole('tab',{name:'新对话：对话',exact:true}).click();
    await page.evaluate(id=>visualCore.selectSession(id),fixture.sessionId);await page.getByText('报告已保存，测试全部通过。',{exact:true}).waitFor();
    await page.evaluate(()=>{WeftPanels.hide(false);WeftDesktop.toggleRail(false);});await page.getByRole('button',{name:'打开工作面板',exact:true}).click();
    if(w===1280)await page.waitForFunction(()=>document.getElementById('session-rail').getBoundingClientRect().width===256);
    const measured=await page.evaluate(()=>{const css=el=>getComputedStyle(el),rect=el=>el.getBoundingClientRect();return {authKind:visualCore.state.device.authKind,width:innerWidth,theme:document.documentElement.dataset.theme,uiFont:css(document.documentElement).fontSize,navFont:css(document.querySelector('.shell-navigation .rail-link')).fontSize,railWidth:rect(document.getElementById('session-rail')).width,top:rect(document.querySelector('.assistant-main')).top,launcherIcon:rect(document.querySelector('.panel-launcher-item svg')).width,launcherHeight:rect(document.querySelector('.panel-launcher-item')).height,launcherGap:css(document.querySelector('.panel-launcher')).gap,inputFont:css(document.getElementById('message-text')).fontSize,overflow:document.documentElement.scrollWidth>innerWidth};});
    observations.push(measured);assert.equal(measured.uiFont,'14px');assert.equal(measured.navFont,'14px');assert.equal(measured.inputFont,'14px');assert.equal(measured.top,0);assert.equal(measured.launcherIcon,20);assert.ok(measured.launcherHeight>=50);assert.equal(measured.overflow,false);if(w===1280)assert.equal(measured.railWidth,256);
    await capture(`workspace-${theme}-${w}`);
  }
  await size(390,844);await page.evaluate(()=>WeftPanels.hide(false));await page.locator('#message-text').fill('窄窗口输入');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await capture('narrow-composer');
  if(process.env.WEFTMATE_SMOOTHNESS_FILE){
    const samples=[];const panel=page.locator('.timeline-preview');
    for(const [width,height] of [[1280,800],[900,700]]){
      await size(width,height);await page.evaluate(()=>{WeftPanels.reset();WeftDesktop.setAppearance({theme:'light'});});
      for(let repetition=0;repetition<3;repetition++){
        samples.push({width,repetition,...await measureUi(page,'open-panel',()=>page.keyboard.press('Control+Alt+p'),{kind:'panel',visible:true})});
        samples.push({width,repetition,...await measureUi(page,'close-panel',()=>page.keyboard.press('Control+Alt+p'),{kind:'panel',visible:false})});
      }
      await page.keyboard.press('Control+Alt+1');await page.keyboard.press('Control+Alt+4');
      for(let repetition=0;repetition<3;repetition++){
        samples.push({width,repetition,...await measureUi(page,'switch-tab',()=>page.keyboard.press('Control+Alt+1'),{kind:'tab',title:'审查'})});await page.keyboard.press('Control+Alt+4');
        const before=await panel.boundingBox(),handle=await panel.getByRole('separator').boundingBox();
        samples.push({width,repetition,...await measureUi(page,'resize-panel',async()=>{await page.mouse.move(handle.x+handle.width/2,handle.y+100);await page.mouse.down();await page.mouse.move(handle.x+(before.width>400?60:-60),handle.y+100,{steps:12});await page.mouse.up();},{kind:'width',before:before.width})});
      }
      await page.evaluate(()=>WeftPanels.hide(false));
      for(let repetition=0;repetition<3;repetition++){
        samples.push({width,repetition,...await measureUi(page,'new-conversation',()=>page.keyboard.press('Control+n'),{kind:'draft'})});await page.evaluate(()=>WeftDesktop.toggleRail(false));
        samples.push({width,repetition,...await measureUi(page,'switch-conversation',()=>page.locator(`.session-row[data-session-id="${fixture.sessionId}"] > button`).first().click(),{kind:'conversation',id:fixture.sessionId})});
      }
      await page.evaluate(async()=>{await visualCore.refreshAssistantOverview();visualCore.stopAssistantRefresh();const source=visualCore.state.sessions.find(row=>row.sessionId===visualCore.state.selectedSessionId);for(let i=0;i<200;i++)visualCore.state.sessions.push({...source,sessionId:`session-b-scroll-${i}`,chatId:undefined,title:`合成最近对话 ${i}`,updatedAt:new Date(Date.now()-i*1000).toISOString()});visualUi.renderSessions();WeftDesktop.toggleRail(false);});
      await page.waitForFunction(()=>document.getElementById('session-rail').getBoundingClientRect().width>=255.9);
      await page.waitForFunction(()=>document.querySelectorAll('#session-list .session-row').length>=200);
      for(let repetition=0;repetition<3;repetition++){const list=page.locator('#session-list'),box=await list.boundingBox(),before=await list.evaluate(el=>el.scrollTop);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);samples.push({width,repetition,syntheticRows:200,...await measureUi(page,'long-list-scroll',()=>page.mouse.wheel(0,650),{kind:'scroll',before})});}
      await page.evaluate(async()=>{await visualCore.refreshSessions();visualUi.startAssistantRefresh();});
    }
    await writeFile(process.env.WEFTMATE_SMOOTHNESS_FILE,JSON.stringify({application:'WeftMate UI01B',complete:true,sampleWindowMs:750,renderer:'Electron software offscreen 60fps',samples},null,2));
  }
  browser=await chromium.launch({headless:true,channel:'chrome'});
  const phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});phone.setDefaultTimeout(10000);phone.on('pageerror',e=>errors.push(e.message));
  phoneFixture=await startTimelineCandidate({historyCount:0,interactive:true,systemManager:{status:async()=>({components:[],metrics:{},queue:{}})}});
  await phoneFixture.request('/projects',{requestId:'ui01b-phone-project',name:'秋季发布与产品资料',rootPath:folder,permission:'write'});
  await phone.goto(phoneFixture.origin+'/personal/v1/ui');await localUiSession(phone,phoneFixture.credentials,'UI01B touch',{mainChat:true});
  await phone.keyboard.press('Control+n');
  const phoneModes=phone.getByRole('tablist',{name:'新对话模式',exact:true});await phoneModes.waitFor();
  assert.equal(await phoneModes.evaluate(el=>el.parentElement.id),'chat-intro');
  await phoneModes.getByRole('tab',{name:'新对话：工作',exact:true}).click();
  await phone.getByRole('button',{name:'选择项目或文件夹',exact:true}).click();await phone.getByRole('menuitemradio',{name:/秋季发布与产品资料/}).click();
  await phone.locator('#message-text').fill('手机新草稿');
  await phoneModes.getByRole('tab',{name:'新对话：对话',exact:true}).click();assert.equal(await phone.locator('#message-text').inputValue(),'手机新草稿');
  for(const theme of ['light','dark']){await phone.evaluate(theme=>WeftDesktop.setAppearance({theme}),theme);assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);if(process.env.WEFTMATE_EVIDENCE_DIR)await phone.screenshot({path:join(process.env.WEFTMATE_EVIDENCE_DIR,`phone-new-${theme}.png`),animations:'disabled'});}
  assert.deepEqual(errors,[]);
  if(process.env.WEFTMATE_EVIDENCE_DIR)await writeFile(join(process.env.WEFTMATE_EVIDENCE_DIR,'geometry.json'),JSON.stringify({observations,errors},null,2));
  console.log('UI-01B visual shell: groups, filters, draft, chrome and geometry passed.');
} catch(e){if(page){await capture('failure').catch(()=>{});console.error('page errors',errors);}throw e;}
finally{clearTimeout(watchdog);await browser?.close();if(app)try{await Promise.race([app.close(),new Promise((_,reject)=>setTimeout(()=>reject(Error('close timeout')),5000))]);}catch{kill();}await phoneFixture?.close();await fixture?.close();if(lock)await unlink(lock);}
