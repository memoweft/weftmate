// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
/** Isolated native-fact status acceptance; no external model or daily profile. */
import assert from 'node:assert/strict';
import {_electron,chromium} from 'playwright';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {startTimelineCandidate} from './timeline-ui-candidate.mjs';
import {localUiSession} from '../helpers/local-ui-session.mjs';
const out=resolve('tests/evidence/ux-10');await mkdir(out,{recursive:true});
const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
const wait=ms=>new Promise(done=>setTimeout(done,ms));
const button=(page,name)=>page.getByRole('button',{name,exact:true}).filter({visible:true});
let f,app,browser,profile;const report={synthetic:true,modelRequests:0,shots:[],checks:[],errors:[]};
async function shot(page,surface,theme,name){await wait(200);const file=`${surface}-${theme}-${name}.png`;await page.screenshot({path:join(out,file)});report.shots.push(file);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,file);console.log(file);}
try {
 f=await startTimelineCandidate({daily:true,sidebar:true,inlineProgress:true,logicalMobile:true,historyCount:0});
 const owner=(await f.request('/auth/me')).account.ownerId;
 f.progress.finish();await f.request(`/sessions/${f.sessionId}/events`);await f.request(`/sessions/${f.sessionId}/metadata`,{unread:false},'PATCH');
 const {group}=await f.request('/session-groups',{name:'状态对比'});
 const rows=[];
 async function source(kind,title,projectId=null){const source=await f.newOutputSource(title,projectId);await f.request(`/sessions/${source.sessionId}/metadata`,{title,...(!projectId?{groupId:group.id}:{})},'PATCH');Object.assign(source,{kind,title});rows.push(source);return source;}
 const done=await source('completed','完成 · 未读');f.progress.text('合成任务已完成。');f.progress.finish();await f.request(`/sessions/${done.sessionId}/events`);
 const failed=await source('failed','失败 · 未读');f.progress.finish('error');await f.request(`/sessions/${failed.sessionId}/events`);
 const stopped=await source('stopped','已停止 · 未读');f.progress.finish('aborted');await f.request(`/sessions/${stopped.sessionId}/events`);
 const idleCommand=await f.request('/commands',{requestId:randomUUID(),kind:'session.create',modelProfileId:'local',targetDeviceId:(await f.request('/status')).hostId});
 let idle=idleCommand.command;while(idle.state!=='accepted_by_dsh'){await wait(20);idle=(await f.request(`/commands/${idle.commandId}`)).command;}
 await f.request(`/sessions/${idle.sessionId}/metadata`,{title:'已读 · 空状态',groupId:group.id,unread:false},'PATCH');rows.push({sessionId:idle.sessionId,kind:'empty',title:'已读 · 空状态'});
 const running=await source('running','正在运行');
 const question=await source('question','等你回答');const frame=f.progress.ask([{id:'choice',question:'请选择合成报告格式',options:[{label:'简要'},{label:'完整'}],multiSelect:false}]);
 await f.request(`/sessions/${question.sessionId}/questions`);
 const approval=await source('approval','等你批准');const approvalFact=await f.progress.approve('synthetic-approval','Write-Output synthetic');
 const projectFolder=join(f.root,'synthetic-project');await mkdir(projectFolder);const {project}=await f.request('/projects',{requestId:randomUUID(),name:'合成项目',rootPath:projectFolder});
 const projectSource=await source('approval','项目中的审批',project.projectId);const projectFact=await f.progress.approve('project-approval','Write-Output synthetic-project');
 const projected=(await f.request('/sessions?archived=all')).sessions;
 for(const row of rows){const actual=projected.find(item=>item.sessionId===row.sessionId);assert.ok(actual,row.title);report.checks.push({kind:row.kind,attention:actual.attention,lastOutcome:actual.lastOutcome,unread:actual.unread,running:actual.running});}
 assert.equal(projected.find(row=>row.sessionId===approval.sessionId).attention,'approval');assert.equal(projected.find(row=>row.sessionId===question.sessionId).attention,'question');
 const mainChat=(await f.request('/chats/main')).chat;
 let mainCommand=(await f.request('/commands',{requestId:randomUUID(),kind:'chat.message',chatId:mainChat.chatId,modelProfileId:'local',text:'合成主对话任务',targetDeviceId:(await f.request('/status')).hostId})).command;
 while(mainCommand.state!=='accepted_by_dsh'){await wait(20);mainCommand=(await f.request(`/commands/${mainCommand.commandId}`)).command;}
 f.progress.text('合成主对话已完成。');f.progress.finish();await f.request(`/sessions/${mainCommand.sessionId}/events`);
 assert.equal((await f.request('/chats/main')).chat.unread,true);
 profile=await mkdtemp(join(tmpdir(),'weftmate-ux10-electron-'));
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:['scripts/review-gallery/electron.mjs','--force-device-scale-factor=1'],cwd:resolve('.'),env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:f.origin,REVIEW_THEME:'light'}});
 const page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',error=>report.errors.push(error.message));
 await page.addInitScript(()=>{let api;Object.defineProperty(globalThis,'WeftUiCore',{configurable:true,get:()=>api,set(value){api=value;const create=value.create;value.create=(...args)=>{const core=create(...args);globalThis.__statusCore=core;return core;};}});});
 await localUiSession(page,f.credentials,undefined,{mainChat:true});await page.waitForFunction(()=>globalThis.__statusCore?.state.mainChat?.unread===false);assert.equal((await f.request('/chats/main')).chat.unread,false);report.checks.push({mainLatestReadCleared:true});
 for(const theme of ['light','dark']){
  await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;WeftDesktop.toggleRail(false);document.getElementById('session-list').scrollTop=0;},theme);await page.mouse.move(1100,700);await page.evaluate(()=>document.activeElement?.blur());
  await shot(page,'electron-1200',theme,'all-statuses');
  for(const row of rows.slice(0,7)) {const label=await button(page,row.title).evaluate(node=>node.parentElement.querySelector('.session-status [aria-label]')?.getAttribute('aria-label')??'');report.checks.push({surface:'electron',theme,kind:row.kind,label});assert.equal(label,{completed:'已完成，未读',failed:'失败',stopped:'已完成，未读',running:'正在运行',question:'等你回答',approval:'等你批准',empty:''}[row.kind]);}
  await button(page,approval.title).hover();await page.getByRole('tooltip',{name:'对话详情'}).waitFor();assert.match(await page.getByRole('tooltip',{name:'对话详情'}).innerText(),/等你批准/);await shot(page,'electron-1200',theme,'hover-card');
  const slot=button(page,approval.title).locator('..').locator('.session-status');await slot.hover();await shot(page,'electron-1200',theme,'status-tooltip');
  await button(page,'合成项目').click();assert.equal(await button(page,'合成项目').evaluate(n=>n.parentElement.querySelector('.session-status [aria-label]').getAttribute('aria-label')),'等你批准');
  await button(page,'状态对比').click();assert.equal(await button(page,'状态对比').evaluate(n=>n.parentElement.querySelector('.session-status [aria-label]').getAttribute('aria-label')),'等你批准');await shot(page,'electron-1200',theme,'collapsed-aggregates');await button(page,'状态对比').click();await button(page,'合成项目').click();
  await button(page,'搜索').click();await page.getByRole('combobox',{name:'搜索内容'}).fill('未读');await wait(450);await shot(page,'electron-1200',theme,'search-statuses');assert.ok(await page.getByRole('img',{name:'失败',exact:true}).count());await page.keyboard.press('Escape');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(480,800));await button(page,'切换会话侧栏').click();await shot(page,'electron-480',theme,'all-statuses');await button(page,'切换会话侧栏').click();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1200,800));await page.evaluate(()=>WeftDesktop.toggleRail(false));
 }
 // Terminal transition: native fixture facts are returned by the real host.
 await page.evaluate(()=>{document.documentElement.dataset.theme='dark';document.getElementById('session-list').scrollTop=0;});
 f.finishOutputSource(running);await f.request(`/sessions/${running.sessionId}/events`);
 const transition=await page.evaluate(async id=>{await __statusCore.refreshSessions();const dot=document.querySelector(`[data-session-id="${id}"] .session-unread-dot`),animation=dot.getAnimations()[0];animation.pause();animation.currentTime=0;return {duration:animation.effect.getTiming().duration,fromNativeUpdate:dot.parentElement.classList.contains('status-entering')};},running.sessionId);
 assert.equal(transition.duration,150);assert.equal(transition.fromNativeUpdate,true);report.checks.push({transition});
 for(const time of [0,60,150]){await button(page,running.title).evaluate((node,time)=>node.parentElement.querySelector('.session-unread-dot').getAnimations()[0].currentTime=time,time);const name=`electron-1200-dark-transition-${time}ms.png`;await page.screenshot({path:join(out,name)});report.shots.push(name);}
 await button(page,running.title).evaluate(node=>node.parentElement.querySelector('.session-unread-dot').getAnimations().forEach(animation=>animation.finish()));
 await shot(page,'electron-1200','dark','run-completed');
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await button(page,running.title).evaluate(n=>getComputedStyle(n.parentElement.querySelector('.session-unread-dot')).animationName),'none');await shot(page,'electron-1200','dark','reduced-motion');await page.emulateMedia({reducedMotion:'no-preference'});
 await button(page,done.title).click();await wait(400);assert.equal((await f.request('/sessions')).sessions.find(row=>row.sessionId===done.sessionId).unread,false);await shot(page,'electron-1200','dark','read-cleared');
 await f.request(`/sessions/${approval.sessionId}/approvals/${approvalFact.approvalId}`,{requestId:randomUUID(),outcome:'allowed-once'});await f.progress.resolve(approvalFact,'allowed-once');
 assert.equal((await f.request('/sessions')).sessions.find(row=>row.sessionId===approval.sessionId).attention,null);await page.reload();await localUiSession(page,f.credentials,undefined,{mainChat:true});await shot(page,'electron-1200','dark','approval-cleared');
 await f.request(`/sessions/${done.sessionId}/metadata`,{unread:true},'PATCH');
 for(const row of [running,approval]) {let command=(await f.request('/commands',{requestId:randomUUID(),kind:'session.message',sessionId:row.sessionId,text:row.title,targetDeviceId:(await f.request('/status')).hostId})).command;while(command.state!=='accepted_by_dsh'){await wait(20);command=(await f.request(`/commands/${command.commandId}`)).command;}}
 await f.progress.approve('mobile-approval','Write-Output synthetic-mobile');
 await f.request(`/sessions/${question.sessionId}/archive`,{});await f.request(`/sessions/${stopped.sessionId}/archive`,{});
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const surface of ['phone-web','android-bundle'])for(const size of [{width:390,height:844},{width:360,height:780}]){
  const p=await browser.newPage({viewport:size,isMobile:true,hasTouch:true});p.on('pageerror',error=>report.errors.push(error.message));p.setDefaultTimeout(15000);await p.goto(surface==='phone-web'?f.origin+'/personal/v1/ui':f.mobileUrl);
  if(surface==='phone-web'){await localUiSession(p,f.credentials,undefined,{mainChat:true});await wait(700);await p.evaluate(()=>WeftDesktop.toggleRail(false));}else{await p.waitForFunction(()=>state.booted&&state.loggedIn);await p.evaluate(()=>page('home'));await button(p,'打开导航').click();}
  const nav=surface==='android-bundle'?p.getByRole('navigation',{name:'主导航',exact:true}):p;
  for(const theme of ['light','dark']){
   await p.evaluate(surface=>{if(surface==='phone-web'){WeftDesktop.toggleRail(false);document.getElementById('session-list').scrollTop=0;}else document.getElementById('conversation-list').scrollTop=0;},surface);
   await p.evaluate(({surface,theme})=>{if(surface==='android-bundle')applyTheme(theme);else document.documentElement.dataset.theme=theme;},{surface,theme});await shot(p,`${surface}-${size.width}`,theme,'drawer');
   if(surface==='phone-web'){await button(p,'合成项目').click();}else await button(nav,'收起项目 合成项目').click();
   await button(nav,'状态对比').click();await shot(p,`${surface}-${size.width}`,theme,'collapsed-aggregates');await button(nav,'状态对比').click();
   if(surface==='phone-web')await button(p,'合成项目').click();else await button(nav,'展开项目 合成项目').click();
   if(surface==='phone-web'){await button(p,'搜索').click();}else{await button(nav,'搜索').click();}
   await p.getByRole('combobox',{name:'搜索内容'}).fill('未读');await wait(450);await shot(p,`${surface}-${size.width}`,theme,'search-statuses');await p.getByRole('button',{name:'关闭搜索',exact:true}).click();
   if(surface==='phone-web'){await shot(p,`${surface}-${size.width}`,theme,'chat-tab-attention');await button(p,'切换会话侧栏').click();}else{await p.evaluate(async()=>{closeDrawer();await selectMobileTab('chat');});await p.getByRole('tab',{name:'聊天',exact:true}).waitFor();assert.equal(await p.locator('#mobile-tab-chat .chat-attention-dot').count(),1);await shot(p,`${surface}-${size.width}`,theme,'chat-tab-attention');await p.evaluate(()=>page('home'));await button(p,'打开导航').click();}
  }
  await p.close();
 }
 assert.deepEqual(report.errors,[]);
} finally {
 await writeFile(join(out,'acceptance.json'),JSON.stringify(report,null,2));await browser?.close();await app?.close();await f?.close();
 if(profile)await rm(profile,{recursive:true,force:true});if(f)await rm(f.root,{recursive:true,force:true});
}
