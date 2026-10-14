import { evidencePath } from '../helpers/evidence-path.mjs';
// Production Electron and remote phone view, synthetic model/commands only.
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { managedMkdtempSync, managedTempRoot } from '../helpers/managed-temp.mjs';
import { startFixture } from './ux-4-fixture.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
const phase = process.argv.includes('--before') ? 'before' : 'after';
const baselineScroll=phase==='before'?execFileSync('git',['show','c3b341aa5:src/personal-access-ui/conversation-scroll.js'],{encoding:'utf8'}):null;
const evidence = evidencePath('fix-37'); mkdirSync(evidence, {recursive:true});
const f = await startFixture(), profile = managedMkdtempSync(join(managedTempRoot(),'weftmate-fix37-'));
let app, browser; const report = {phase, synthetic:true, surfaces:[], errors:[]};
try {
 const main = (await f.request('/chats/main')).chat;
 let command = (await f.request('/commands',{requestId:'scroll-main',kind:'chat.message',targetDeviceId:f.hostId,chatId:main.chatId,modelProfileId:'synthetic',text:'弹出一个审批窗口',mode:'queue'})).command;
 while (['pending','dispatching','preflight'].includes(command.state)) {await new Promise(r=>setTimeout(r,30));command=(await f.request('/commands/'+command.commandId)).command;}
 assert.equal(command.state,'accepted_by_dsh');
 const memories = [{kind:'fact',id:'synthetic-a',summary:'合成记忆一'},{kind:'fact',id:'synthetic-b',summary:'合成记忆二'}];
 const events = [
  ['assistant.message',{text:Array.from({length:24},(_,i)=>`合成命令输出第 ${i+1} 行：中文输出正常，英文 UTF-8 output。`).join('\n'),memoryUsed:memories}],
  ['turn.started',{turn:2}], ['user.message',{text:'弹出一个审批窗口'}],
  ['step.completed',{stepId:'command-a',toolName:'pwsh',state:'completed',summary:'运行合成命令',output:'中文命令输出'}],
  ['step.completed',{stepId:'command-b',toolName:'pwsh',state:'completed',summary:'运行第二个合成命令',output:'OK'}],
  ['assistant.message',{text:'已弹出审批窗口（OK/Cancel 确认框）。',memoryUsed:memories,turn:2}],
  ['turn.ended',{reason:'completed',turn:2}]
 ];
 f.logs.set(command.sessionId,events.map(([type,data],seq)=>({seq,type,data,at:new Date().toISOString(),sessionId:command.sessionId})));
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key))delete env[key];
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['scripts/review-gallery/electron.mjs'],env:{...env,WEFTMATE_TEST_HOST_NAME:'synthetic-host',REVIEW_LIBRARY_TOKEN:f.libraryDesktopToken,REVIEW_PROFILE:profile,REVIEW_ORIGIN:f.origin,REVIEW_THEME:'light'}});
 const page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>console.log('PAGE ERROR',e.message));
 if(baselineScroll)await page.route('**/conversation-scroll.js',route=>route.fulfill({contentType:'text/javascript',body:baselineScroll}));
 await page.route('**/app.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:`const create=WeftUiCore.create;WeftUiCore.create=options=>{globalThis.__ui=options.effects;return globalThis.__core=create(options)};\n${await response.text()}`});});
 await localUiSession(page,f.credentials,'FIX-37 synthetic',{mainChat:true});
 try {await page.waitForFunction(()=>globalThis.__core?.inMainChat()&&document.querySelector('.main-chat-row.message'));}catch(error){console.log(await page.locator('body').innerText());console.log(await page.evaluate(()=>({core:!!globalThis.__core,main:globalThis.__core?.state.mainChat})));throw error;}
 async function measure(page, name) {
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.waitForTimeout(250); // Let initial logical history hydration settle.
  await page.evaluate(()=>{
   const core=globalThis.__core || uiCore;
   core.nextSuggestionsView=()=>({enabled:true,suggestions:['点击确定按钮','点击取消按钮','再弹出一个窗口'],inlineCompletionEnabled:false,completion:''});
   core._nextSuggestionsPaint();
   const follow=globalThis.__ui?.conversationScroll || ensureConversationScroll();follow.latest();
   // A late memory label and suggestion row arrive during the same follow.
   const text=document.querySelector('.message.assistant .message-text,.message.assistant .markdown');
   text.append(document.createTextNode('\n异步命令进展到达。'.repeat(12)));follow.changed();
  });
  const sample=()=>page.evaluate(async()=>{const values=[];const box=document.querySelector('#chat-scroll');for(let i=0;i<90;i++){await new Promise(requestAnimationFrame);values.push({top:box.scrollTop,height:box.scrollHeight,viewport:box.clientHeight,rows:document.querySelectorAll('.main-chat-row').length});}return values;});
  const stable=await sample();
  await page.evaluate(()=>{const row=document.querySelector('.message.assistant .message-text,.message.assistant .markdown');row.append(document.createTextNode('\n新增中文命令输出。'.repeat(12)));});
  const growth=await sample();
  // A real viewport resize clamps scrollTop while a smooth follow is in flight.
  // Repeated layout notifications after it settles must not restart that motion.
  const clamping=await page.evaluate(async()=>{
   const follow=globalThis.__ui?.conversationScroll || ensureConversationScroll(), box=document.querySelector('#chat-scroll');
   follow.latest();const start=box.scrollTop;
   const height=box.getBoundingClientRect().height;
   box.style.flex='none';box.style.height=`${height-160}px`;follow.changed();
   for(let i=0;i<8;i++)await new Promise(requestAnimationFrame);
   box.style.height=`${height-80}px`;follow.changed();
   const values=[];for(let i=0;i<90;i++){await new Promise(requestAnimationFrame);follow.changed();values.push(box.scrollTop);}
   box.style.flex='';box.style.height='';return {start,values};
  });
  await page.waitForTimeout(250);
  const box=page.locator('#chat-scroll');await box.hover();await page.mouse.wheel(0,-240);await page.waitForTimeout(220);
  const up=await page.evaluate(()=>document.querySelector('#chat-scroll').scrollTop);
  await page.evaluate(()=>{document.querySelector('.message.assistant .message-text,.message.assistant .markdown').append(document.createTextNode('\n用户上翻之后的新内容。'.repeat(12)));});
  const held=await sample();
  const ring=await page.locator('#context-usage').evaluate(node=>({label:node.getAttribute('aria-label'),animations:node.getAnimations({subtree:true}).map(a=>a.animationName),height:node.getBoundingClientRect().height}));
  report.surfaces.push({name,stable,growth,clamping,up,held,ring});
  await page.evaluate(()=>(globalThis.__ui?.conversationScroll || ensureConversationScroll()).latest());
  await page.waitForTimeout(200);
  for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:join(evidence,`${phase}-${name}-${theme}.png`)});}
  const continuous=await page.evaluate(async()=>{
   const body=[...document.querySelectorAll('.message.assistant .message-text,.message.assistant .markdown')].at(-1),box=document.querySelector('#chat-scroll'),follow=globalThis.__ui?.conversationScroll || ensureConversationScroll();
   const nodes=[],values=[];follow.latest();const start=box.scrollTop;
   for(let i=0;i<20;i++){const node=document.createElement('p');node.textContent='连续到达的合成中文输出。';nodes.push(node);body.append(node);follow.changed();await new Promise(requestAnimationFrame);values.push(box.scrollTop);}
   for(let i=0;i<30;i++)await new Promise(requestAnimationFrame);
   const end=box.scrollTop,gap=box.scrollHeight-box.clientHeight-end;nodes.forEach(node=>node.remove());follow.latest();return {start,values,end,gap};
  });
  report.surfaces.at(-1).continuous=continuous;
  await page.waitForTimeout(250);
  if(phase==='after') {assert.ok(Math.max(...stable.slice(30).map(v=>v.top))-Math.min(...stable.slice(30).map(v=>v.top))<=1,`${name} stable viewport`);assert.ok(Math.max(...clamping.values)-Math.min(...clamping.values)<=1,`${name} no replay after layout clamp`);assert.ok(held.every(v=>Math.abs(v.top-up)<=1),`${name} preserves upward reading`);}
  if(phase==='after') {assert.ok(continuous.values.at(-1)>continuous.start+200,`${name} live continuous following`);assert.ok(Math.abs(continuous.gap)<=1,`${name} finishes at bottom`);}
 }
 for(const width of [1200,480]){await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,800),width);await measure(page,`electron-${width}`);}
 browser=await chromium.launch({channel:'chrome',headless:true});
 const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 if(baselineScroll)await mobile.route('**/conversation-scroll.js',route=>route.fulfill({contentType:'text/javascript',body:baselineScroll}));
 await mobile.goto(f.mobileUrl);await mobile.waitForFunction(()=>typeof uiCore!=='undefined'&&state.booted);
 await mobile.evaluate(async()=>{await uiCore.selectMainChat();});
 await mobile.waitForFunction(()=>uiCore.inMainChat()&&document.querySelector('.main-chat-row.message'));
 await measure(mobile,'mobile-web-390');
 assert.deepEqual(report.errors,[]);
} finally {writeFileSync(join(evidence,`${phase}.json`),JSON.stringify(report,null,2)+'\n');await browser?.close();await app?.close();await f.close();}
