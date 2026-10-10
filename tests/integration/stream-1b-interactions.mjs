/** STREAM-1b: real Electron and shipped mobile UI, isolated synthetic host. */
import assert from 'node:assert/strict';
import { _electron,chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
const out=resolve('tests/evidence/stream-1/rework');mkdirSync(out,{recursive:true});
const f=await startTimelineCandidate({interactive:true,daily:true,inlineProgress:true,sidebar:true,composerMenu:true,historyCount:0,baseTime:Date.now()});
const profile=mkdtempSync(join(tmpdir(),'weftmate-stream1b-'));let app,browser,timer;
const mobileOnly=process.argv.includes('--mobile-only');const previous=mobileOnly?JSON.parse(readFileSync(join(out,'interactions.json'),'utf8')):null;const report={synthetic:true,systemBarsVerified:false,surfaces:previous?previous.surfaces.filter(row=>row.surface==='electron'):[],errors:[]};
const pause=ms=>new Promise(done=>setTimeout(done,ms));
const folder=join(f.root,'synthetic-folder');mkdirSync(folder);
const registered=await f.request('/projects',{requestId:'stream1b-folder',name:'合成文件夹',rootPath:folder,permission:'read-only'});
const source=await f.newOutputSource('读取项目资料，运行测试，并保存一份进度报告。',registered.project.projectId);f.sessionId=source.sessionId;
await f.request(`/sessions/${f.sessionId}/metadata`,{title:'流式交互回归'},'PATCH');
f.progress.text('这是一条已经完成的回复，用来验证消息菜单。');f.progress.call('read','stream1b-read',{paths:['synthetic.md']});f.progress.result('stream1b-read','Synthetic read complete.');
try{
 const entry=join(profile,'desktop.cjs');writeFileSync(entry,`const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.whenReady().then(async()=>{const {createPersonalDesktop}=await import(${JSON.stringify(pathToFileURL(resolve('src/personal-desktop.mjs')).href)});let quitting=false;app.on('before-quit',()=>quitting=true);const desktop=createPersonalDesktop({origin:${JSON.stringify(f.origin)},isQuitting:()=>quitting});await desktop.ready;desktop.window.setContentSize(1120,800);});`);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[entry],env});const desktop=await app.firstWindow();
 await desktop.route('**/personal/v1/ui/app.js',route=>route.fulfill({contentType:'text/javascript',body:readFileSync('src/personal-access-ui/app.js','utf8').replace('ui.loadAttachmentHasher =','globalThis.__streamCore=core;globalThis.__streamUi=ui;ui.loadAttachmentHasher =')}));
 await desktop.route('**/personal/v1/status',async route=>{try{const response=await route.fetch(),body=await response.json();await route.fulfill({response,json:{...body,personalCapabilities:{...body.personalCapabilities,replyStreaming:1}}});}catch{await route.abort().catch(()=>{});}});await localUiSession(desktop,f.credentials,'STREAM-1b',{interceptLegacyStatus:false});await desktop.waitForFunction(()=>globalThis.__streamCore?.state.mainChat&&!__streamCore.state.refreshing&&!__streamCore.state.sessionSelecting);await desktop.evaluate(id=>__streamCore.selectSession(id),f.sessionId);
 browser=await chromium.launch({headless:true});const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await mobile.goto(f.mobileUrl);await mobile.waitForFunction(()=>state.booted&&state.loggedIn);await mobile.evaluate(id=>selectSharedSession(id),f.sessionId);
 let total='';timer=setInterval(()=>{const text='正文持续增长。';total+=text;f.progress.chunk(text);},220);
 for(const [surface,p]of (mobileOnly?[['mobile',mobile]]:[['electron',desktop],['mobile',mobile]])){
  p.setDefaultTimeout(5000);p.on('pageerror',e=>report.errors.push(surface+': '+e.message));
  const requests=[];p.on('request',request=>{if(/\/personal\/v1|\/bridge$/.test(request.url()))requests.push({at:Date.now(),path:new URL(request.url()).pathname,body:request.url().endsWith('/bridge')?JSON.parse(request.postData()||'{}').method:undefined});});
  const result={surface,checks:[],requests};report.surfaces.push(result);
  await p.waitForFunction(()=>document.querySelector('.reply-streaming'));
  const core=surface==='mobile'?'uiCore':'__streamCore',draft=surface==='mobile'?'#draft':'#message-text';
  const capture=async name=>{for(const theme of ['light','dark']){await p.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await p.screenshot({path:join(out,`${surface}-${name}-${theme}.png`)});}};
  const hold=async(name,selector,choose)=>{const item=p.locator(selector).first();await item.waitFor({state:'visible'});await item.evaluate(node=>globalThis.__heldNode=node);const start=Date.now(),before=requests.length;const oldLength=await p.evaluate(()=>[...document.querySelectorAll('.reply-streaming')].at(-1)?.textContent.length||0);await pause(3100);if(name!=='settings-dropdown'){assert.ok(oldLength>0,name+' starts during stream');assert.ok(await p.evaluate(()=>[...document.querySelectorAll('.reply-streaming')].at(-1)?.textContent.length||0)>oldLength,name+' body grows during hold');}assert.equal(await item.isVisible(),true,name+' stays visible');assert.equal(await item.evaluate(node=>node===__heldNode&&node.isConnected),true,name+' keeps node');await capture(name);await choose();result.checks.push({name,durationMs:Date.now()-start,requests:requests.length-before,passed:true});console.log(surface,name,'passed');};
  if(surface==='mobile'){
   await p.locator('#approval-mode-button').click();await p.waitForFunction(()=>!approvalModeState.loading);
   await hold('approval-menu','#approval-mode-popover [data-mode="allow-all"]',()=>p.locator('#approval-mode-popover [data-mode="allow-all"]').click());
   await hold('risk-confirm','#approval-risk-cancel',()=>p.locator('#approval-risk-cancel').click());
  }else{
   await p.locator('#approval-mode-trigger').click();await hold('approval-menu','#approval-mode-menu [data-mode="ask"]',()=>p.locator('#approval-mode-menu [data-mode="ask"]').click());
   await p.waitForFunction(()=>document.querySelector('#approval-mode-label').textContent.includes('每次'));
   await p.locator('#approval-mode-trigger').click();
   const dialogPromise=new Promise(done=>p.once('dialog',async dialog=>{assert.equal(dialog.type(),'confirm');await pause(3100);await dialog.dismiss();result.checks.push({name:'risk-confirm',durationMs:3100,passed:true,nativeDialog:true});done();}));
   await p.locator('#approval-mode-menu [data-mode="allow-all"]').click();await dialogPromise;
  }
  await p.locator(surface==='mobile'?'#plus-button':'#attachment-add').click();
  await hold('plus-menu',surface==='mobile'?'#attachment-popover':'#composer-menu',()=>p.locator(surface==='mobile'?'#plus-button':'#attachment-add').click());
  // Host-session model is fixed on mobile. Exercise the existing menu function and its settings action.
  if(surface==='mobile')await p.evaluate(()=>openModels());else await p.locator('#model-trigger').click();
  await hold('model-menu','#model-popover',async()=>{if(surface==='mobile'){await p.getByRole('button',{name:'管理手机与账户模型',exact:true}).click();assert.equal(await p.evaluate(()=>state.page),'models');await p.evaluate(()=>page('chat'));}else{await p.locator('#model-options button').first().click();assert.equal(await p.locator('#model-popover').isVisible(),false);}});
  await p.evaluate(({core})=>(core==='uiCore'?uiCore:globalThis[core]).openSearch(),{core});
  await hold('search','.search-palette[open]',()=>p.getByRole('button',{name:'关闭搜索',exact:true}).click());
  if(surface==='mobile'){await p.evaluate(()=>mobileSessionQuickMenu(selectedSharedSession()));}else await p.locator('#session-list .session-row > button').first().click({button:'right'});
  await hold('session-menu',surface==='mobile'?'.session-action-dialog[open]':'.session-menu[role="menu"]:not([hidden])',()=>surface==='mobile'?p.getByRole('button',{name:'置顶聊天',exact:true}).click():p.locator('.session-menu:not([hidden]) button').filter({hasText:'未读'}).click());
  if(surface==='mobile')await p.evaluate(()=>closeDrawer());
  if(surface==='mobile')await p.evaluate(()=>updateComposer());else await p.evaluate(()=>__streamUi.updateAvailability());
  await p.locator('.folder-current').click();await hold('folder-menu','.wm-menu[role="menu"]',()=>p.mouse.click(5,100));
  await p.evaluate(({core})=>{const c=core==='uiCore'?uiCore:globalThis[core];const scroll=document.querySelector('#chat-scroll');scroll.dispatchEvent(new WheelEvent('wheel',{deltaY:-500,bubbles:true}));if(core==='uiCore'){state.scrollPinned=false;ensureConversationScroll().hold();}else __streamUi.conversationScroll?.hold();scroll.scrollTop=0;},{core});
  const more=p.getByRole('button',{name:'更多回复操作',exact:true,includeHidden:true}).first();
  if(await more.count()){await more.locator('..').locator('..').scrollIntoViewIfNeeded();await more.locator('..').locator('..').hover();await more.click();await hold('message-more','.wm-menu[role="menu"]',()=>p.mouse.click(5,100));}
  else{const more=p.locator('.chat-message-menu summary').first();await more.scrollIntoViewIfNeeded();await more.click();await hold('message-more','.chat-message-menu[open]',()=>p.mouse.click(5,100));}
  await p.evaluate(()=>WeftContent.openGallery([{url:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180"><rect width="240" height="180" fill="#6b806d"/></svg>'),name:'合成图片'}],0,document.activeElement));
  await hold('gallery','.render-gallery',async()=>{await p.getByRole('button',{name:'放大',exact:true}).click();assert.match(await p.locator('.render-gallery-stage img').getAttribute('style'),/1.25/);await p.getByRole('button',{name:'关闭图片画廊',exact:true}).click();});
  await p.locator(draft).fill('先整理资料');await p.locator(draft).focus();
  const cdp=await p.context().newCDPSession(p);await cdp.send('Input.imeSetComposition',{text:'中文输入',selectionStart:4,selectionEnd:4});
  const composition=await p.locator(draft).evaluate(node=>({value:node.value,start:node.selectionStart,end:node.selectionEnd}));await pause(3100);
  assert.deepEqual(await p.locator(draft).evaluate(node=>({value:node.value,start:node.selectionStart,end:node.selectionEnd})),composition);
  assert.equal(await p.locator(draft).evaluate(node=>node===document.activeElement),true);await cdp.send('Input.insertText',{text:'中文输入'});await cdp.detach();await capture('chinese-composition');result.checks.push({name:'chinese-composition',passed:true,...composition});
  const at=Date.now(),before=requests.length;await pause(3100);result.streamingWindow={start:at,end:Date.now(),requests:requests.slice(before)};result.streamingRequestsPerSecond=(requests.length-before)/((Date.now()-at)/1000);
  if(surface==='mobile')await p.evaluate(()=>page('appearance'));else await p.evaluate(()=>__streamUi.openSettings('appearance'));
  await p.locator('.settings-select:visible').first().click();await hold('settings-dropdown','.settings-select-menu:not([hidden])',()=>p.locator('.settings-select-menu:not([hidden]) [role="option"]').last().click());
  if(surface==='mobile')await p.evaluate(()=>page('chat'));else await p.evaluate(()=>document.querySelector('#settings-dialog').close());
 }
 clearInterval(timer);timer=null;f.progress.completeStream(total);f.progress.finish();await pause(6500);
 for(const [surface,p]of (mobileOnly?[['mobile',mobile]]:[['electron',desktop],['mobile',mobile]])){const result=report.surfaces.find(row=>row.surface===surface),at=Date.now(),before=result.requests.length;await pause(6100);result.idleWindow={start:at,end:Date.now(),requests:result.requests.slice(before)};result.idleRequestsPerSecond=(result.requests.length-before)/((Date.now()-at)/1000);await p.screenshot({path:join(out,`${surface}-final.png`)});}
 assert.deepEqual(report.errors,[]);console.log('STREAM-1b interactions passed');
}catch(error){report.failure=error.message;report.buttons=await (await app.firstWindow()).locator('button').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')).filter(Boolean));report.hostEvents=await f.request(`/sessions/${f.sessionId}/events?limit=100`);for(const p of await app?.windows()||[])await p.screenshot({path:join(out,'failure.png')}).catch(()=>{});console.error(error);throw error;}
finally{clearInterval(timer);writeFileSync(join(out,'interactions.json'),JSON.stringify(report,null,2)+'\n');await browser?.close();await app?.close();await f.close();rmSync(profile,{recursive:true,force:true});rmSync(f.root,{recursive:true,force:true});}
