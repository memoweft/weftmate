// Real hidden Windows shell, isolated identity and synthetic data; no model calls.
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, open, unlink, readdir, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { startFixture } from './ux-4-fixture.mjs';
import { feedbackUiSession } from '../helpers/feedback-ui-session.mjs';
import { healthPageSynthetic } from '../helpers/health-page-synthetic.mjs';

for (const stream of [process.stdout, process.stderr]) stream.on('error', e => { if (e.code !== 'EPIPE') throw e; });
const root = resolve(import.meta.dirname, '../..'), baseline = process.argv.includes('--before');
const locks = process.env.WEFTMATE_HEAVY_LOCK_DIR, output = process.env.WEFTMATE_EVIDENCE_DIR;
assert.ok(locks); assert.ok(output);
let app, child, fixture, profile, lock, browser;
const failures = [], errors = [];
const kill = () => { if (child?.exitCode === null) { if(process.platform==='win32')spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide:true, stdio:'ignore', timeout:5000 });else child.kill('SIGKILL'); } };
const deadline = setTimeout(() => { kill(); process.exitCode = 1; }, 180000);
async function cleanup(directory) {
  const rel = relative(tmpdir(), directory); assert.ok(rel && !isAbsolute(rel) && !rel.startsWith('..') && rel.startsWith('weftmate-fe-pages-'));
  async function links(path) { for (const entry of await readdir(path,{withFileTypes:true})) { const p=join(path,entry.name); if ((await lstat(p)).isSymbolicLink()) await unlink(p); else if(entry.isDirectory()) await links(p); } }
  await links(directory); await rm(directory,{recursive:true,force:true});
}
try {
  for (let n=1;n<=3;n++) { const path=join(locks,`heavy-${n}.lock`); try { const h=await open(path,'wx'); await h.writeFile('FE-PAGES '+new Date().toISOString()); await h.close(); lock=path; break; } catch(e) { if(e.code!=='EEXIST')throw e; } }
  assert.ok(lock,'No heavy slot available'); await mkdir(output,{recursive:true});
  profile=await mkdtemp(join(tmpdir(),'weftmate-fe-pages-'));
  if(!process.env.WEFTMATE_TEST_TEMP_SCOPE)process.env.WEFTMATE_MANAGED_TEMP_ROOT=join(profile,'fixtures');
  fixture=await startFixture();
  const bootstrap=join(profile,'shell.mjs');
  await writeFile(bootstrap,`import {createRequire} from 'node:module';const {app}=createRequire(${JSON.stringify(new URL('../../package.json',import.meta.url).href)})('electron');app.setName('WeftMate Pages Test');app.setAppUserModelId('com.memoweft.weftmate.test.pages');app.disableHardwareAcceleration();for(const s of [process.stdout,process.stderr])s.on('error',e=>{if(e.code!=='EPIPE')throw e});await import(${JSON.stringify(new URL('../../scripts/review-gallery/electron.mjs',import.meta.url).href)});`);
  const env={...process.env}; for(const k of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(k)||k==='ELECTRON_RUN_AS_NODE')delete env[k];
  Object.assign(env,{REVIEW_PROFILE:profile,REVIEW_ORIGIN:fixture.origin,REVIEW_LIBRARY_TOKEN:fixture.libraryDesktopToken,REVIEW_THEME:'light',REVIEW_HIDDEN:'1',WEFTMATE_TEST_HOST_NAME:'synthetic-host'});
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:root,args:[bootstrap,'--disable-backgrounding-occluded-windows','--disable-features=CalculateNativeWinOcclusion'],env,timeout:30000});
  child=app.process(); child.stdout?.resume();child.stderr?.resume();
  const page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR '+e.message+' '+(e.stack||''));});
  if(baseline)for(const file of ['components/memory.js','components/markup.js','components/activity-view.js','components/goals-view.js','components/library-view.js','components/health-view.js','components/help-view.js','components/search-view.js','pages.css','health.css','ui-core/library.js','ui-core/goals.js','ui-core/activity.js']){
    const source=execFileSync('git',['show','9c2316968:src/'+(file.startsWith('ui-core/')?file:'personal-access-ui/'+file)],{cwd:root,encoding:'utf8',windowsHide:true});await page.route('**/personal/v1/ui/'+file,route=>route.fulfill({body:source,contentType:file.endsWith('.css')?'text/css':'text/javascript'}));
  }
  await feedbackUiSession(page,fixture,{native:true});await page.unroute('**/personal/v1/status');
  await page.evaluate(async()=>{await __feedbackSessionCore.refreshStatus();await __feedbackSessionCore.refreshSessions();WeftReplyMotion.setVisibility(false);});
  const capture=async name=>{await page.evaluate(async()=>{for(const a of document.getAnimations())if(Number.isFinite(a.effect.getTiming().iterations))a.finish();await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));});const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'));await writeFile(join(output,`${baseline?'before':'after'}-${name}.png`),Buffer.from(png,'base64'));};
  for(const theme of ['light','dark']) {
    await page.evaluate(async theme=>{WeftDesktop.setAppearance({theme});await __feedbackSessionCore.startNewConversation();},theme);
    await capture('new-chat-'+theme);
    for(const view of ['activity','library','goals','health']) {
      await page.locator('.'+view+'-entry').evaluate(n=>n.click());await page.locator('.'+view+'-surface').waitFor({state:'visible'});
      await page.waitForFunction(view=>Object.entries(__feedbackSessionCore[view==='goals'?'goalsPage':view]).every(([key,value])=>!/loading$/i.test(key)||!value),view);
      await capture(view+'-'+theme);
    }
  }
  async function check(name,run) { try { await run();console.log('PASS '+name); } catch(e) { failures.push(name+': '+e.message);console.log('FAIL '+name+': '+e.message); } }
  await check('memory refresh preserves existing row and keyboard focus',async()=>{
    const value=await page.evaluate(()=>{const base=__feedbackSessionCore,target=document.createElement('section');target.innerHTML='<form id="memory-search-form"></form><ul id="memory-list"></ul><button id="memory-more"></button>';document.body.append(target);const core={...base,state:{...base.state,account:null,ownerId:'synthetic-memory'},memory:{...base.memory,items:[{id:'fe-memory',kind:'cognition',text:'我喜欢先列出今天最重要的三件事。',sourceCount:1}],hasMore:false}};const ui={byId:id=>target.querySelector('#'+id),element:(tag,cls='',text)=>{const n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;}};const view=WeftUiComponents.factories.memory(core,ui);view.renderMemoryItems();const button=target.querySelector('.memory-item-button');button.focus();view.renderMemoryItems();const result={same:button===target.querySelector('.memory-item-button'),focus:document.activeElement===button};target.remove();return result;});assert.deepEqual(value,{same:true,focus:true});
  });
  await check('library append preserves existing preview control and focus',async()=>{
    const value=await page.evaluate(()=>{const base=__feedbackSessionCore,target=document.createElement('section');document.body.append(target);const item={id:'fe-file',fileName:'今天的计划.md',type:'document',size:2300,exists:true,modifiedAt:'2026-10-26T00:00:00Z',location:'synthetic/plan.md'};const core={...base,library:{...base.library,items:[item],projects:[],total:1,loading:false}};const view=WeftLibraryView.mount({target,core,desktop:true,openPreview:()=>document.createElement('div')});view.render();const button=target.querySelector('.library-file');button.focus();core.library.items.push({...item,id:'fe-file-2',fileName:'下周的计划.md'});view.render();const result={same:button===target.querySelector('.library-file'),focus:document.activeElement===button};view.dispose();target.remove();return result;});assert.deepEqual(value,{same:true,focus:true});
  });
  // Exercise the real shared renderers with controlled snapshots, as polling does.
  await check('health refresh preserves heading and date control',async()=>{
    const value=await page.evaluate(()=>{const core=__feedbackSessionCore,target=document.createElement('section');document.body.append(target);const model={...core.health,day:'2026-10-25',today:'2026-10-25',overview:{connected:false},loading:false};const view=WeftHealthView.mount({target,core:{...core,health:model}});view.render();const heading=target.querySelector('h1'),date=target.querySelector('[aria-label="选择健康日期"]');date.focus();view.render();const result={heading:heading===target.querySelector('h1'),date:date===target.querySelector('[aria-label="选择健康日期"]'),focus:document.activeElement===date};view.destroy();target.remove();return result;});assert.deepEqual(value,{heading:true,date:true,focus:true});
  });
  await check('activity refresh keeps day, row and keyboard focus connected',async()=>{
    const value=await page.evaluate(()=>{const core=__feedbackSessionCore,target=document.createElement('section');document.body.append(target);const model={...core.activity,timeZone:'Asia/Shanghai',items:[{id:'synthetic-activity',at:'2026-10-25T01:00:00Z',title:'合成提醒',summary:'整理今天的想法',type:'reminder.delivered',state:'completed',read:false,actions:[]}]};const view=WeftActivityView.mount({target,core:{...core,activity:model}});view.render();const day=target.querySelector('.activity-day'),row=target.querySelector('article'),action=row.querySelector('button');action.focus();const observer=new MutationObserver(()=>{});observer.observe(target,{childList:true,subtree:true});view.render();const mutations=observer.takeRecords().length;observer.disconnect();const result={day:day===target.querySelector('.activity-day'),row:row===target.querySelector('article'),focus:document.activeElement===action,mutations};view.destroy();target.remove();return result;});assert.deepEqual(value,{day:true,row:true,focus:true,mutations:0});
  });
  await check('goals polling preserves existing task controls',async()=>{
    const value=await page.evaluate(()=>{const core=__feedbackSessionCore,target=document.createElement('section');document.body.append(target);const model={...core.goalsPage,errors:{},tasks:[{taskId:'synthetic-task',title:'整理想法',conversationTitle:'今天的计划',status:'running',elapsedSeconds:120,canStop:true,step:'正在整理',source:{sessionId:'synthetic'}}]};const view=WeftGoalsView.mount({target,core:{...core,goalsPage:model},openSource:()=>{},toast:()=>{}});view.render();const row=target.querySelector('article'),button=row.querySelector('button');button.focus();model.loading=true;view.render();model.loading=false;view.render();const result={row:row===target.querySelector('article'),button:button===target.querySelector('article button'),focus:document.activeElement===button};view.close();target.remove();return result;});assert.deepEqual(value,{row:true,button:true,focus:true});
  });
  await check('confirmation uses common dialog, cancels and restores focus',async()=>{
    await page.evaluate(()=>{const trigger=document.querySelector('.health-entry');trigger.focus();globalThis.pagesAnswer=null;void WeftDialogs.request({title:'删除合成内容？',message:'仅用于界面测试。',danger:true}).then(value=>globalThis.pagesAnswer=value);});
    const dialog=page.getByRole('dialog',{name:'删除合成内容？'});await dialog.waitFor();await capture('dialog-dark');assert.equal(await dialog.evaluate(n=>n.classList.contains('wm-dialog')),true);await page.keyboard.press('Escape');await page.waitForFunction(()=>pagesAnswer===false);assert.equal(await page.locator('.health-entry').evaluate(n=>n===document.activeElement),true);
  });
  await check('reminder refresh keeps actions and retries after an error',async()=>{
    assert.equal(await page.evaluate(async()=>{const core=__feedbackSessionCore,target=document.createElement('section');document.body.append(target);let fail=false;const fake={...core,loadSchedules:async()=>{if(fail)throw Error('synthetic unavailable');return {items:[{id:'synthetic-reminder',text:'喝一杯水',sessionId:core.state.selectedSessionId,state:'active',timeZone:'Asia/Shanghai',repeat:{kind:'daily',time:'09:00'}}]};},scheduleDescription:()=> '每天 9:00',manageSchedule:async()=>{}};const render=WeftSchedulesView(fake,target,{autoLoad:false,openConversation:()=>{}});await render();const button=target.querySelector('li button');await render();const same=button===target.querySelector('li button');fail=true;await render();const retry=!target.querySelector('.settings-schedules-toolbar button').disabled&&!target.querySelector('ul').hasAttribute('aria-busy')&&target.textContent.includes('读取失败');target.remove();return same&&retry;}),true);
  });
  // A full health snapshot also exercises the connected layout, not just an empty page.
  const health=healthPageSynthetic({today:'2026-10-25'});
  await page.route(/\/personal\/v1\/health\/(overview|metrics|calendar|analysis)(\?|\/|$)/,route=>route.fulfill({json:health.reply(new URL(route.request().url()).pathname+new URL(route.request().url()).search)}));
  await page.evaluate(()=>__feedbackSessionCore.readHealth());await capture('health-connected-dark');
  await page.locator('.goals-entry').evaluate(n=>n.click());await page.locator('.goals-surface').waitFor({state:'visible'});
  await check('library opens without briefly revealing the conversation',async()=>{
    const visible=await page.evaluate(()=>{const core=__feedbackSessionCore,enter=core.enterAssistant;core.enterAssistant=async()=>{await new Promise(resolve=>setTimeout(resolve,50));return enter();};document.querySelector('.library-entry').click();const visible=!document.querySelector('.library-surface').hidden&&document.querySelector('#conversation-pane').hidden;core.enterAssistant=enter;return visible;});assert.equal(visible,true);
  });
  await check('reselecting the current mode preserves the draft and sidebar',async()=>{
    await page.evaluate(()=>__feedbackSessionCore.startNewConversation());
    const result=await page.evaluate(async()=>{const core=__feedbackSessionCore,start=core.startNewConversation,choose=core.chooseSidebarMode;let starts=0,choices=0;core.startNewConversation=(...args)=>{starts++;return start(...args);};core.chooseSidebarMode=(...args)=>{choices++;return choose(...args);};const field=document.getElementById('message-text');field.value='尚未发送的合成想法';document.querySelector('.conversation-mode-switch [aria-selected=true]').click();document.querySelector('.session-rail .rail-mode-switch [aria-selected=true]').click();await new Promise(resolve=>setTimeout(resolve,0));core.startNewConversation=start;core.chooseSidebarMode=choose;return {starts,choices,draft:field.value};});assert.deepEqual(result,{starts:0,choices:0,draft:'尚未发送的合成想法'});
  });
  if(!baseline){
    await page.evaluate(()=>{__feedbackSessionCore.readGoals=async()=>{};});
    const frame=async name=>{const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'));await writeFile(join(output,name+'.png'),Buffer.from(png,'base64'));};
    const film=async(name,action,selector)=>{const samples=[];await action();const start=Date.now();for(let i=0;i<7;i++){const sample=await page.locator(selector).evaluate(n=>({height:n.getBoundingClientRect().height,hidden:n.hidden,at:performance.now()}));samples.push({elapsed:Date.now()-start,...sample});await frame(`motion-${name}-${i}`);await new Promise(resolve=>setTimeout(resolve,55));}await writeFile(join(output,`motion-${name}.json`),JSON.stringify(samples,null,2));return samples;};
    // Production memory navigation and item/source requests, with synthetic content.
    const owner=await page.evaluate(()=>__feedbackSessionCore.state.account.ownerId);
    const items=[{id:'fe-memory-1',kind:'cognition',text:'我习惯先列出今天最重要的三件事，再安排其余工作。',sourceCount:1,currentState:'current',updatedAt:'2026-10-26T00:00:00Z',lifecycle:{}},{id:'fe-memory-2',kind:'entity',text:'河岸读书会每周三晚上一起讨论一本书。',sourceCount:1,currentState:'current',lifecycle:{}},{id:'fe-memory-3',kind:'event',text:'准备一份旅行清单，出发前逐项核对。'.repeat(8),sourceCount:1,currentState:'current',lifecycle:{}}];
    const memoryReply=path=>path.endsWith('/forget-preview')?{ownerId:owner,worldRevision:8,forgetScope:'synthetic-scope',itemCount:1,evidenceCount:1,items:[items[0]]}:path.endsWith('/status')?{ownerId:owner,state:'ready',worldRevision:8,formedMemoryCount:3,capabilities:{list:true,source:true,correct:true,mute:true,deleteWorldItem:true},pendingBoundaryCount:0}:path.endsWith('/sources')?{ownerId:owner,worldRevision:8,sources:[{id:'fe-source',currentnessState:'current',summary:'在计划对话中提到做事习惯。',rawContent:'先把最重要的三件事列出来，再安排其他事，这样更从容。',contentAvailable:true,recordedAt:'2026-10-26T00:00:00Z'}]}:path.includes('/items/')?{ownerId:owner,worldRevision:8,item:items.find(row=>path.endsWith('/'+row.id)),availableActions:{correct:{available:true},mute:{available:true},delete:{available:true}}}:{ownerId:owner,worldRevision:8,searchScope:'account_snapshot',items,totalCount:3,hasMore:false,nextCursor:null};
    await page.route('**/personal/v1/memory/**',route=>route.fulfill({json:memoryReply(new URL(route.request().url()).pathname)}));
    for(const theme of ['light','dark']){
      await page.evaluate(theme=>{WeftDesktop.setAppearance({theme});document.documentElement.dataset.theme=theme;},theme);
      await page.evaluate(()=>__feedbackSessionCore.openMemory());await page.locator('#memory-list .memory-item').first().waitFor();await page.locator('#settings-dialog[open]').waitFor();await capture('memory-'+theme);
      await page.locator('#memory-list .memory-item-button').first().click();await page.getByRole('dialog',{name:'理解详情'}).waitFor();await page.locator('.memory-source-raw').waitFor();await capture('memory-detail-'+theme);
      if(theme==='dark'){await page.locator('#memory-correct-action').click();await page.locator('#memory-correct-text').fill('先写下今天最重要的一件事。');await capture('memory-correction-dark');await page.locator('#memory-detail-back').click();await page.locator('#memory-delete-action').click();await page.locator('#memory-confirm-panel').waitFor({state:'visible'});await page.waitForFunction(()=>!__feedbackSessionCore.memory.forgetPreviewLoading);await capture('memory-forget-confirm-dark');await page.locator('#memory-detail-back').click();}
      await page.locator('#memory-detail-close').click();
      await page.evaluate(()=>document.querySelector('#settings-dialog')?.close());
      await page.evaluate(()=>__feedbackSessionCore.openSearch());await page.getByRole('dialog',{name:'搜索',exact:true}).waitFor();await page.waitForFunction(()=>!__feedbackSessionCore.search.loading);await capture('search-'+theme);await page.evaluate(()=>__feedbackSessionCore.closeSearch());
      await page.evaluate(()=>{document.dispatchEvent(new CustomEvent('weftmate:fixed-page',{detail:'gallery-reset'}));__feedbackSessionCore.show('assistant');document.querySelector('.goals-surface').className='goals-surface';});await page.locator('.goals-entry').evaluate(n=>n.click());
      await page.evaluate(()=>{const core=__feedbackSessionCore,target=document.querySelector('.goals-surface');globalThis.feGoalsModel={...core.goalsPage,loading:false,errors:{},busy:new Set(),sessions:[{sessionId:'synthetic',title:'本周计划',taskAvailable:true}],tasks:[{taskId:'fe-task',title:'整理本周阅读笔记',conversationTitle:'本周计划',status:'running',startedAt:'2026-10-26T00:00:00Z',elapsedSeconds:142,canStop:true,step:'正在归纳重点，完成后会把文档放到成果库。',source:{sessionId:'synthetic'}}],recent:[],schedules:[{id:'fe-schedule',text:'提醒我整理今天的笔记',sessionId:'synthetic',state:'active',timeZone:'Asia/Shanghai',repeat:{kind:'daily',time:'21:00:00'}}],goals:[{id:'fe-goal',title:'每周读完一本书',description:'把阅读变成稳定的习惯，留下自己的理解。',phase:'active',progress:'已完成 2 次阅读',source:{sessionId:'synthetic'}}]};globalThis.feGoalsView=WeftGoalsView.mount({target,core:{...core,state:{...core.state,personalCapabilities:{...core.state.personalCapabilities,scheduleEditing:1,goals:1}},goalsPage:feGoalsModel},openSource:()=>{},toast:()=>{}});feGoalsView.render();});
      await page.locator('.goals-surface').waitFor({state:'visible'});await capture('goals-content-'+theme);
      if(theme==='dark')await check('progress expands through real intermediate heights and survives refresh',async()=>{const samples=await film('goal-expand',()=>page.getByRole('button',{name:'展开进展 整理本周阅读笔记'}).click(),'.goals-task-detail');assert.ok(samples.at(-1).height>20);assert.ok(samples.some(row=>row.height>0&&row.height<samples.at(-1).height));await page.evaluate(()=>{feGoalsModel.tasks[0].elapsedSeconds++;feGoalsView.render();});assert.equal(await page.getByRole('button',{name:'展开进展 整理本周阅读笔记'}).getAttribute('aria-expanded'),'true');});
      // Help is mounted through its production factory with the existing core model.
      await page.evaluate(()=>{[...document.querySelectorAll('#chat-intro button')].find(n=>n.textContent==='了解更多').click();});await capture('help-'+theme);
      await page.getByRole('searchbox',{name:'搜索帮助'}).fill('没有这个关键词');await capture('help-empty-'+theme);await page.getByRole('searchbox',{name:'搜索帮助'}).fill('记忆');await capture('help-results-'+theme);
    }
    for(const theme of ['light','dark']){
      await page.evaluate(theme=>{WeftDesktop.setAppearance({theme});document.documentElement.dataset.theme=theme;const core=__feedbackSessionCore;core.readLibrary=async()=>{};document.dispatchEvent(new CustomEvent('weftmate:fixed-page',{detail:'gallery-reset'}));document.querySelector('.library-entry').click();const target=document.querySelector('.library-surface');const items=[{id:'fe-report',fileName:'本周阅读笔记.md',type:'document',size:4560,exists:true,modifiedAt:'2026-10-26T00:00:00Z',projectName:'阅读计划',location:'synthetic/reading.md'},{id:'fe-sheet',fileName:'今年读过的书.xlsx',type:'spreadsheet',size:18200,exists:true,modifiedAt:'2026-10-25T00:00:00Z',location:'synthetic/books.xlsx'},{id:'fe-moved',fileName:'上个月的记录.md',type:'document',size:800,exists:false,modifiedAt:'2026-09-26T00:00:00Z',location:'synthetic/moved.md'}];globalThis.feLibrary=WeftLibraryView.mount({target,desktop:true,core:{...core,state:{...core.state,personalCapabilities:{...core.state.personalCapabilities,libraryDesktopActions:0}},library:{...core.library,loading:false,error:'',items,total:3,projects:[],nextCursor:null},libraryPreview:async()=>({kind:'text',text:'本周阅读笔记\n\n整理想法，留下自己的理解。\n'.repeat(12)}),foreground:()=>false},openPreview:(item,trigger)=>WeftDesktop.openPreview(item.fileName,trigger,'library:'+item.id).content,copyPath:async()=>{},notice:()=>{}});feLibrary.render();},theme);
      await capture('library-content-'+theme);await page.getByRole('button',{name:'预览 本周阅读笔记.md'}).click();await page.locator('.library-preview-actions').waitFor();await capture('library-preview-'+theme);await page.evaluate(()=>WeftDesktop.closePreview());
    }
    await page.evaluate(()=>{[...document.querySelectorAll('#chat-intro button')].find(n=>n.textContent==='了解更多').click();});
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(760,740));
    await page.getByRole('searchbox',{name:'搜索帮助'}).fill('');await capture('help-narrow-dark');
    assert.equal(await page.locator('.help-page').evaluate(n=>n.scrollWidth<=n.clientWidth),true);
    // Empty, loading and error share the same list measure and keep useful chrome.
    await page.evaluate(()=>{const core=__feedbackSessionCore;core.readActivity=async()=>{};document.querySelector('.activity-entry').click();const target=document.querySelector('.activity-surface');globalThis.feActivityModel={...core.activity,items:[],loading:true,error:''};globalThis.feActivityView=WeftActivityView.mount({target,core:{...core,activity:feActivityModel}});feActivityView.render();});await capture('activity-loading-narrow');
    await page.evaluate(()=>{feActivityModel.loading=false;feActivityModel.error='暂时无法连接这台电脑，请重试。';feActivityView.render();});await capture('activity-error-narrow');
    await page.evaluate(()=>{feActivityModel.error='';feActivityView.render();});await capture('activity-empty-narrow');
    await check('reduced-motion search can close and immediately reopen',async()=>{await page.emulateMedia({reducedMotion:'reduce'});const open=await page.evaluate(async()=>{const core=__feedbackSessionCore;await core.openSearch();const closing=core.closeSearch();await core.openSearch();await closing;return document.querySelector('.search-palette').open;});assert.equal(open,true);await page.evaluate(()=>__feedbackSessionCore.closeSearch());});
    await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>{document.querySelector('.goals-entry').click();const target=document.querySelector('.goals-surface');target.className='goals-surface';globalThis.feReduced=WeftGoalsView.mount({target,core:{...__feedbackSessionCore,goalsPage:feGoalsModel},openSource:()=>{},toast:()=>{}});feReduced.render();});await page.getByRole('button',{name:'展开进展 整理本周阅读笔记'}).click();assert.ok(await page.locator('.goals-task-detail').evaluate(n=>n.getBoundingClientRect().height>0));await capture('goals-reduced-narrow');
  }
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.isVisible())),false);
  assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
} finally {
  await browser?.close();await app?.close().catch(()=>{});kill();await fixture?.close();clearTimeout(deadline);
  if(profile)await cleanup(profile);if(lock)await unlink(lock);
}
