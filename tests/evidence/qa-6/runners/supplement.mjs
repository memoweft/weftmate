// Bounded rechecks of selectors / coverage gaps from the continuous smoke.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {harness,pause,until} from './harness.mjs';
import {localUiSession} from '../../../helpers/local-ui-session.mjs';
const out=resolve('tests/evidence/qa-6/supplement');mkdirSync(out,{recursive:true});
const installRoot=mkdtempSync(join(tmpdir(),'weftmate-qa6-supplement-installed-')),installation=join(installRoot,'Programs');writeFileSync(join(out,'install-root.txt'),installRoot);
execFileSync(resolve('.local/qa-6/releases/0.1.1-preview.1/build/WeftMate-Setup-0.1.1-preview.1.exe'),['/S','/currentuser',`/D=${installation}`],{windowsHide:true,stdio:'pipe',timeout:600000});
const executable=join(installation,readdirSync(installation).find(n=>n.endsWith('.exe')&&!/Uninstall|Recovery/.test(n)));
const h=await harness('supplement',{mimo:true,installed:executable}),p=h.page,report={startedAt:new Date().toISOString(),installed:true,checks:[],errors:[]};let browser,phone;
const b=(page,name)=>page.getByRole('button',{name,exact:true});
const shot=(name,page=p)=>page.screenshot({path:join(out,name+'.png')});
const save=()=>writeFileSync(join(out,'results.json'),JSON.stringify(report,null,2));
report.suggestionRequests=[];
p.on('requestfinished',async request=>{if(!new URL(request.url()).pathname.includes('/suggestions'))return;const response=await request.response();report.suggestionRequests.push({at:new Date().toISOString(),path:new URL(request.url()).pathname,method:request.method(),status:response?.status(),timing:request.timing(),body:await response?.json().catch(()=>null)});save();});
const close=async(page=p)=>{await page.keyboard.press('Escape');if(await page.locator('#settings-dialog').isVisible())await b(page,'关闭设置').click();};
const check=async(name,fn)=>{try{report.checks.push({name,passed:true,...await fn()});console.log('PASS',name);}catch(e){report.checks.push({name,passed:false,error:e.message});console.log('FAIL',name,e.message);await shot(name+'-failed').catch(()=>{});await close().catch(()=>{});}save();};
async function active(page=p){return page.locator('#session-list [data-session-id]:has(button.is-current)').first().getAttribute('data-session-id');}
async function select(page,id){await close(page);await page.locator(`[data-session-id="${id}"]`).waitFor({state:'attached'});await page.evaluate(()=>WeftDesktop.toggleRail(false));await page.locator(`[data-session-id="${id}"] > button`).first().click();await page.waitForFunction(()=>!document.getElementById('message-text').disabled);}
async function newSide(){await b(p,'新旁聊 Ctrl N').click();await p.waitForFunction(()=>!document.getElementById('message-text').disabled);return active();}
async function submit(page,text){const id=await active(page),prior=Math.max(-1,...(await h.events(id)).map(e=>e.seq));await page.locator('#message-text').fill(text);await b(page,'发送').click();return {id,prior};}
const finished=async token=>(await h.events(token.id)).some(e=>e.type==='turn.ended'&&e.seq>token.prior);
async function prompt(page,text){const token=await submit(page,text);await until(()=>finished(token),90000);return token;}
async function choose(page,label,name){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name,exact:true}).click();}
async function listener(on){const port=Number(new URL(h.origin).port);await h.app.evaluate(async(_,v)=>{if(!v.on){globalThis.qa6Listener=process._getActiveHandles().find(x=>typeof x.address==='function'&&x.address()?.port===v.port&&typeof x.listen==='function');if(!qa6Listener)throw Error('listener missing');qa6Listener.closeAllConnections();await new Promise(r=>qa6Listener.close(r));}else await new Promise(r=>qa6Listener.listen(v.port,'127.0.0.1',r));},{port,on});}
try{
 await h.api('/settings/models',{defaultModelProfileId:h.modelId},'PATCH');await p.reload();await b(p,'新旁聊 Ctrl N').waitFor();await until(()=>b(p,'新旁聊 Ctrl N').isEnabled());await newSide();
 const folder=join(h.root,'QA6-project');mkdirSync(folder);writeFileSync(join(folder,'source.txt'),'QA6_PROJECT_SOURCE');
 await check('folder-picker-project',async()=>{
  await h.app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},folder);
  await b(p,'添加文件夹').click();await p.locator('.folder-confirm').waitFor();await choose(p,'文件权限','可读写');await shot('folder-permission-open');await b(p,'在这个文件夹里工作').click();await p.locator('.folder-confirm').waitFor({state:'detached'});await p.getByRole('button',{name:/^选择文件夹，当前/}).click();await shot('folder-recent-light');await p.evaluate(()=>document.documentElement.dataset.theme='dark');await shot('folder-recent-dark');await p.keyboard.press('Escape');await p.evaluate(()=>document.documentElement.dataset.theme='light');return {nativeDialogStub:true,projects:(await h.api('/projects')).body.projects.map(x=>({name:x.name,permission:x.permission}))};
 });
 const projectId=await active();report.projectSession=projectId;
 await check('activity-open',async()=>{await p.getByRole('button',{name:/^动态/}).click();await shot('activity-open');await select(p,projectId);return {opened:true};});
 const other=await newSide();await select(p,projectId);
 async function approvalTask(page,surface){
  await select(page,projectId);await h.api(`/sessions/${projectId}/approval-mode`,{mode:'ask'},'PATCH');const target=join(folder,surface+'-output.txt').replaceAll('\\','/');
  const token=await submit(page,`请读取项目中的source.txt，把原文写到 ${target}，再读回核对。只操作这个合成项目。`),decisions=[];
  for(let n=0;n<7;n++){
   const state=await until(async()=>await b(page,'批准').isVisible().catch(()=>false)?'approval':await finished(token)?'done':false,60000);if(state==='done')break;
   const before=(await h.api('/sessions?limit=100')).body;writeFileSync(join(out,`${surface}-status-${n}.json`),JSON.stringify(before,null,2));await shot(surface+'-approval-before-'+n,page);
   if(n===0){await page.reload();await page.locator('#assistant-view').waitFor();await select(page,projectId);}
   else if(n===1){await select(page,other);await select(page,projectId);}
   else if(n===2){await listener(false);try{await page.locator('.presence-badge[data-state="host_offline"]').waitFor({timeout:35000});await shot(surface+'-approval-offline',page);}finally{await listener(true);}await page.locator('.presence-badge[data-state="online"]').waitFor({timeout:40000});}
   await b(page,'批准').waitFor();const at=Date.now();await b(page,'批准').click();await b(page,'批准').waitFor({state:'hidden',timeout:12000});decisions.push({after:['reload','switch','reconnect'][n]||'normal',ackMs:Date.now()-at});
  }
  assert.ok(decisions.length);assert.equal(readFileSync(target,'utf8').trim(),'QA6_PROJECT_SOURCE');await shot(surface+'-file-complete',page);return {decisions,fileExact:true};
 }
 await check('desktop-project-approval-races',()=>approvalTask(p,'desktop'));
 browser=await chromium.launch({channel:'msedge',headless:true});phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await phone.goto(h.origin+'/personal/v1/ui');await localUiSession(phone,h.credentials,'QA6 phone supplement',{mainChat:true});await phone.locator('#assistant-view').waitFor();await phone.locator(`[data-session-id="${projectId}"]`).waitFor({state:'attached'});
 await check('phone-viewport-geometry',async()=>{await select(phone,projectId);const geometry=await phone.evaluate(()=>({innerHeight,visualHeight:visualViewport.height,bodyHeight:document.body.scrollHeight,inputBottom:document.getElementById('message-text').getBoundingClientRect().bottom,sendBottom:document.getElementById('send-message').getBoundingClientRect().bottom}));report.phoneGeometry=geometry;await shot('phone-viewport',phone);assert.ok(geometry.sendBottom<=geometry.visualHeight,'Send button below phone viewport');return geometry;});
 await check('phone-project-approval-races',()=>approvalTask(phone,'phone'));
 for(const [surface,page] of [['desktop',p],['phone',phone]])await check(surface+'-reject',async()=>{
  await select(page,projectId);const file=join(folder,surface+'-rejected.txt').replaceAll('\\','/');const token=await submit(page,`请写入 ${file}，内容QA6_REJECT。若拒绝就停止，不换工具重试。`);await b(page,'拒绝').waitFor({timeout:60000});await shot(surface+'-reject-before',page);const at=Date.now();await b(page,'拒绝').click();await b(page,'拒绝').waitFor({state:'hidden',timeout:12000});await until(()=>finished(token),60000);assert.equal(existsSync(file),false);await shot(surface+'-reject-after',page);return {ackMs:Date.now()-at,fileAbsent:true};
 });
 await check('folder-real-drag',async()=>{
  await newSide();const dir=join(h.root,'QA6-dragged');mkdirSync(dir);const cdp=await p.context().newCDPSession(p),box=await p.locator('#message-text').boundingBox(),data={items:[],files:[dir],dragOperationsMask:1};for(const type of ['dragEnter','dragOver','drop'])await cdp.send('Input.dispatchDragEvent',{type,x:box.x+20,y:box.y+20,data});await p.locator('.folder-confirm').waitFor({timeout:10000});await shot('drag-confirm-light');await p.evaluate(()=>document.documentElement.dataset.theme='dark');await shot('drag-confirm-dark');await b(p,'在这个文件夹里工作').click();await p.locator('.folder-confirm').waitFor({state:'detached'});await cdp.detach();return {nativeFilePath:true};
 });
 await check('reply-motion-long-stream',async()=>{
  await select(p,other);await p.bringToFront();const token=await submit(p,'请连续输出60条编号的合成收纳建议，每条15个字。不要工具，不要省略。');const samples=[];let captured=false;while(!await finished(token)){const s=await p.evaluate(()=>({at:Date.now(),hidden:document.hidden,paused:WeftReplyMotion.paused,reduced:WeftReplyMotion.reduced,dot:!!document.querySelector('.reply-indicator'),sheen:[...document.querySelectorAll('.reply-sheen')].some(e=>e.getBoundingClientRect().width>0),inputY:document.getElementById('message-text').getBoundingClientRect().y}));samples.push(s);if(s.dot&&!captured){await shot('breathing-dot');captured=true;}await pause(100);}await shot('reply-complete-actions');report.motionSamples=samples;assert.ok(captured,'No breathing dot observed during real MiMo stream');return {dotSeen:captured,sheenSeen:samples.some(s=>s.sheen),inputYRange:Math.max(...samples.map(s=>s.inputY))-Math.min(...samples.map(s=>s.inputY))};
 });
 await check('reply-suggestions',async()=>{await p.locator('.next-suggestion-chip').first().waitFor({timeout:12000});await shot('suggestion-chips');const count=(await h.api('/commands?limit=100')).body.commands.length,text=await p.locator('.next-suggestion-chip').first().textContent();await p.locator('.next-suggestion-chip').first().click();assert.equal(await p.locator('#message-text').inputValue(),text);assert.equal((await h.api('/commands?limit=100')).body.commands.length,count);await p.locator('#message-text').fill('');return {fillOnly:true};});
 await check('gray-completion-tab',async()=>{await p.locator('#message-text').fill('请把刚才的建议整理成');await p.locator('.composer-completion:not([hidden])').waitFor({timeout:12000});await shot('gray-completion');const text=await p.locator('.composer-completion-text').textContent();await p.locator('#message-text').press('Tab');assert.equal(await p.locator('#message-text').inputValue(),'请把刚才的建议整理成'+text);await p.locator('#message-text').fill('');return {tabAccepted:true};});
 await check('reduced-and-disabled',async()=>{
  await p.locator('#message-text').fill('');await p.keyboard.press('Control+,');await p.locator('button[data-category="appearance"]').click();await choose(p,'减少动态效果','开启');await shot('reduced-motion-setting');await p.locator('button[data-category="assistant"]').click();await p.locator('#personalization-nextSuggestionsEnabled').uncheck();await until(async()=>(await h.api('/settings/personalization')).body.settings.nextSuggestionsEnabled===false);await shot('suggestions-off-setting');await b(p,'关闭设置').click();await prompt(p,'只说一句：这是一条关闭动效和建议后的合成回复。');const states=await p.evaluate(()=>({reduced:WeftReplyMotion.reduced,animations:document.getAnimations().filter(a=>a.playState==='running').map(a=>a.animationName),suggestions:!document.getElementById('next-suggestions').hidden}));assert.equal(states.reduced,true);assert.equal(states.suggestions,false);report.reducedState=states;assert.equal(states.animations.length,0,'Animations remain enabled');await shot('reduced-completed');return states;
 });
 await check('status-unread-seen',async()=>{await select(p,other);const token=await submit(p,'请用三句话回答今天如何整理测试资料，不用工具。');await select(p,projectId);await until(()=>finished(token),60000);await p.reload();await p.locator(`[data-session-id="${other}"]`).waitFor();await shot('completed-unread');const before=(await h.api('/sessions?limit=100')).body.sessions.find(x=>x.sessionId===other);await select(p,other);await until(async()=>(await h.api('/sessions?limit=100')).body.sessions.find(x=>x.sessionId===other)?.unread===false,15000);await shot('completed-read');assert.equal(before.unread,true);return {unreadBefore:true,readAfter:true};});
 await check('offline-draft-single-toast',async()=>{
  await select(p,other);await p.locator('#message-text').fill('QA6_OFFLINE_DRAFT');await p.evaluate(()=>{globalThis.qa6ToastTransitions=[];let last=false;new MutationObserver(()=>{const visible=[...document.querySelectorAll('[role=status],.toast')].some(e=>e.textContent.includes('连接已恢复')&&!e.hidden&&e.getBoundingClientRect().height>0);if(visible&&!last)qa6ToastTransitions.push(Date.now());last=visible;}).observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','class']});});
  await listener(false);try{await p.locator('.presence-badge[data-state="host_offline"]').waitFor({timeout:35000});await shot('desktop-offline');await shot('phone-offline',phone);}finally{await listener(true);}await p.locator('.presence-badge[data-state="online"]').waitFor({timeout:40000});await shot('desktop-recovered');assert.equal(await p.locator('#message-text').inputValue(),'QA6_OFFLINE_DRAFT');const toasts=await p.evaluate(()=>qa6ToastTransitions.length);assert.equal(toasts,1);await p.locator('#message-text').fill('');return {draftPreserved:true,recoveryToasts:toasts};
 });
 await check('light-settings-and-dark-search',async()=>{
  await p.evaluate(()=>document.documentElement.dataset.theme='light');await p.keyboard.press('Control+,');const categories=await p.locator('.settings-nav-item').evaluateAll(xs=>xs.map(x=>x.dataset.category));for(const id of categories){await p.locator(`.settings-nav-item[data-category="${id}"]`).click();await pause(100);await shot('settings-light-'+id);}await b(p,'关闭设置').click();await p.evaluate(()=>document.documentElement.dataset.theme='dark');await b(p,'搜索').click();await p.getByRole('combobox',{name:'搜索内容'}).fill('source');await p.locator('.search-result-row').first().waitFor({timeout:12000});await shot('search-dark');await p.locator('.search-result-more').first().click();await shot('search-menu-dark');await p.keyboard.press('Escape');await b(p,'关闭搜索').click();return {categories};
 });
 report.finishedAt=new Date().toISOString();
}finally{save();await browser?.close();await h.close();try{execFileSync(join(installation,'Uninstall WeftMate.exe'),['/S'],{windowsHide:true,stdio:'pipe',timeout:600000});report.uninstalled=true;}catch{report.uninstalled=false;}save();}
