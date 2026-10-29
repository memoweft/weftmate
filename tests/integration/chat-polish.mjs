import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, open, unlink, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startFixture } from './ux-4-fixture.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';

const root=resolve(import.meta.dirname,'../..'),before=process.argv.includes('--before');
const out=process.env.WEFTMATE_CHAT_POLISH_OUTPUT || await mkdtemp(join(tmpdir(),'weftmate-chat-polish-'));
await mkdir(out,{recursive:true});process.env.WEFTMATE_MANAGED_TEMP_ROOT=join(out,'fixtures');
const report={before,checks:[],samples:[]};let app,fixture,lock;
const check=(name,value)=>{report.checks.push({name,value});if(!before)assert.ok(value,name);};
try {
 if(process.env.WEFTMATE_HEAVY_LOCK_DIR) {
  for(let n=1;n<=3;n++){const path=join(process.env.WEFTMATE_HEAVY_LOCK_DIR,`heavy-${n}.lock`);try{const f=await open(path,'wx');await f.writeFile(`CHAT-POLISH ${new Date().toISOString()}`);await f.close();lock=path;break;}catch(e){if(e.code!=='EEXIST')throw e;}}
  assert.ok(lock,'No heavy slot');
 }
 fixture=await startFixture({usageSamples:true});
 const env={...process.env,REVIEW_PROFILE:join(out,'profile'),REVIEW_ORIGIN:fixture.origin,REVIEW_LIBRARY_TOKEN:fixture.libraryDesktopToken};delete env.ELECTRON_RUN_AS_NODE;
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:root,args:['tests/helpers/chat-polish-electron.mjs'],env,timeout:30000});
 app.process().stdout?.resume();app.process().stderr?.resume();
 const page=await app.firstWindow();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/personal/v1/ui/app.js',async route=>route.fulfill({contentType:'text/javascript',body:(await readFile(join(root,'src/personal-access-ui/app.js'),'utf8')).replace('ui.loadAttachmentHasher =','globalThis.testCore=core;globalThis.testUi=ui;ui.loadAttachmentHasher =')}));
 if(before){
 const baseline=process.env.WEFTMATE_CHAT_POLISH_BASE || execFileSync('git',['merge-base','HEAD','origin/main'],{cwd:root,encoding:'utf8'}).trim();
 for(const file of execFileSync('git',['diff','--name-only',baseline,'--','src/personal-access-ui','src/ui-core'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean)) {
  const asset=file.replace('src/personal-access-ui/','').replace('src/ui-core/','ui-core/');
  await page.route(`**/personal/v1/ui/${asset}`,route=>route.fulfill({contentType:file.endsWith('.css')?'text/css':'text/javascript',body:execFileSync('git',['show',`${baseline}:${file}`],{cwd:root,encoding:'utf8'})}));
 }
 }
 await page.waitForURL('**/personal/v1/ui');await localUiSession(page,fixture.credentials,'CHAT-POLISH synthetic',{mainChat:true});
 await page.waitForFunction(()=>globalThis.__WeftUiStarted&&globalThis.testCore?.state.sessions.length>0);
 const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 let measure;
 if(process.env.WEFTMATE_CHAT_POLISH_MEASURER)({measure}=await import(pathToFileURL(process.env.WEFTMATE_CHAT_POLISH_MEASURER)));
 async function sample(name,action,duration=1000){
  await page.evaluate(()=>{globalThis.polishFrames=[];const tick=()=>{const shell=document.querySelector('.assistant-shell').getBoundingClientRect(),form=document.getElementById('message-form').getBoundingClientRect(),box=document.getElementById('chat-scroll');polishFrames.push({at:performance.now(),w:innerWidth,h:innerHeight,right:shell.right,bottom:shell.bottom,formY:form.y,scrollTop:box.scrollTop,scrollHeight:box.scrollHeight,clientHeight:box.clientHeight,fold:document.querySelector('.work-mode-fold')?.getBoundingClientRect().height,background:getComputedStyle(document.documentElement).backgroundColor});globalThis.polishFrame=requestAnimationFrame(tick);};polishFrame=requestAnimationFrame(tick);});
  if(measure){const result=await measure(page,out,name,action,{duration});report.samples.push(result);assert.ok(!result.error,result.error);}
  else {await action();await page.waitForTimeout(350);}
  const frames=await page.evaluate(()=>{cancelAnimationFrame(polishFrame);return polishFrames;});await writeFile(join(out,`${name}-geometry.json`),JSON.stringify(frames));
  check(`${name}: root fills every measured frame`,frames.every(f=>Math.abs(f.right-f.w)<=1&&f.bottom>=f.h-1));
  if(name.includes('suggestions-only'))for(const key of ['formY','scrollTop','scrollHeight'])check(`${name}: ${key} stays stable`,Math.max(...frames.map(f=>f[key]))-Math.min(...frames.map(f=>f[key]))<=1);
 }
 async function geometry(){return page.evaluate(()=>({viewport:{w:innerWidth,h:innerHeight},form:document.getElementById('message-form').getBoundingClientRect().toJSON(),toolbar:document.querySelector('.work-mode-toolbar').getBoundingClientRect().toJSON()}));}
 for(const theme of ['dark','light']) {
  if(theme==='light'){await page.reload();await page.waitForFunction(()=>globalThis.__WeftUiStarted&&testCore.state.sessions.length>0);}
  await page.evaluate(t=>testCore.applyAppearance?.(t),theme).catch(()=>{});
  await page.evaluate(t=>{document.documentElement.dataset.theme=t;},theme);
  await app.evaluate(({nativeTheme},t)=>nativeTheme.themeSource=t,theme);
  await page.evaluate(()=>testCore.startNewConversation());await page.waitForTimeout(450);
  const empty=await geometry();await page.locator('#chat-scroll').hover();await page.mouse.wheel(0,-300);await settle();
  check(`${theme}: empty conversation has no jump`,!await page.locator('#jump-latest').isVisible());
  await page.screenshot({path:join(out,`${theme}-empty.png`)});
  await sample(`${theme}-mode-open`,()=>page.getByRole('tab',{name:'新对话：工作',exact:true}).click());
  await sample(`${theme}-mode-close`,()=>page.getByRole('tab',{name:'新对话：对话',exact:true}).click());
  await page.getByRole('textbox',{name:'输入消息',exact:true}).fill('你好，合成新对话');
  await sample(`${theme}-first-send`,()=>page.getByRole('button',{name:'发送',exact:true}).click());
  await page.waitForFunction(()=>!document.querySelector('#message-text').value);await settle();
  const sent=await geometry();report.checks.push({name:`${theme}: composer displacement`,value:sent.form.y-empty.form.y});
  if(!before)check(`${theme}: composer stays in place`,Math.abs(sent.form.y-empty.form.y)<=1);
  await page.locator('#chat-scroll').hover();await page.mouse.wheel(0,-300);await settle();
  check(`${theme}: short reply has no jump`,!await page.locator('#jump-latest').isVisible());
  check(`${theme}: delivered message has no sending state`,!await page.locator('#transcript').evaluate(el=>el.textContent.includes('发送中')));
  await page.screenshot({path:join(out,`${theme}-first-answer.png`)});
  await sample(`${theme}-suggestions-only`,async()=>{
   await page.locator('#message-text').click();
   await page.evaluate(async()=>{const prior=testCore.nextSuggestionsView;for(const suggestions of [['我叫小林，帮我记下来'],[],['介绍一下你自己','帮我整理今天的计划']]){testCore.nextSuggestionsView=()=>({enabled:true,suggestions});testCore._nextSuggestionsPaint();await new Promise(r=>setTimeout(r,160));}testCore.nextSuggestionsView=prior;testCore._nextSuggestionsPaint();});
  },1100);
  fixture.logs.get(fixture.source).length=0;
  await page.evaluate(async id=>{await testCore.selectSession(id);testCore.stopAssistantRefresh();testCore.state.historyGeneration++;testCore.refreshConversationFacts=async()=>{};testCore.state.personalization={...testCore.state.personalization,thinkingDisplay:'expanded'};testCore.state.sessionSnapshotAt=new Date(0).toISOString();testUi.resetMainChatView();},fixture.source);
  const sessionId=fixture.source;
  await page.evaluate(id=>{
   const now=new Date().toISOString();const event=(seq,type,data)=>({seq,type,data,at:now,sessionId:id});
   testCore.state.historyEvents.clear();testCore.state.seenSeq.clear();testCore.state.liveMessageSeq=-1;
   testCore.appendHistory([event(0,'turn.started',{turn:1}),event(1,'user.message',{text:'你好',turn:1})],[],1);
  },sessionId);await settle();
  await page.screenshot({path:join(out,`${theme}-waiting.png`)});
  check(`${theme}: no legacy wait prose`,!await page.locator('#transcript').evaluate(el=>/等待模型回复|用时未记录|回答会显示在下方/.test(el.textContent)));
  await page.evaluate(id=>testCore.appendHistory([],[{seq:2,type:'assistant.delta',sessionId:id,at:new Date().toISOString(),data:{text:'',modelThinking:'先理解问候，再给简洁回答。',thinkingActive:true,streaming:true,turn:1}}],2),sessionId);
  await settle();await page.screenshot({path:join(out,`${theme}-thinking.png`)});
  check(`${theme}: one current status`,await page.locator('#transcript .inline-progress-summary').count()===1);
  report.checks.push({name:`${theme}: thinking palette`,value:await page.locator('.model-thinking p').first().evaluate(el=>({ink:getComputedStyle(el).color,secondary:getComputedStyle(document.documentElement).getPropertyValue('--ink-secondary').trim(),padding:getComputedStyle(el).padding,margin:getComputedStyle(el).margin}))});
  await sample(`${theme}-stream-finish-suggestions`,async()=>{
   await page.locator('#message-text').click();
   await page.evaluate(async id=>{
    for(let i=1;i<=60;i++){
     testCore.appendHistory([],[{seq:2,type:'assistant.delta',sessionId:id,at:new Date().toISOString(),data:{text:Array.from({length:i},(_,n)=>`${n+1}. 你好，这是合成回复。`).join('\n'),modelThinking:'先理解问候，再给简洁回答。',thinkingActive:false,thinkingMs:3000,streaming:true,turn:1}}],i+2);
     await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    }
    const now=new Date().toISOString();testCore.appendHistory([{seq:2,type:'assistant.message',sessionId:id,at:now,data:{text:Array.from({length:60},(_,n)=>`${n+1}. 你好，这是合成回复。`).join('\n'),modelThinking:'先理解问候，再给简洁回答。',thinkingMs:3000,turn:1}},{seq:3,type:'turn.ended',sessionId:id,at:now,data:{turn:1,reason:'completed'}}],[],100);
    const prior=testCore.nextSuggestionsView;
    for(const suggestions of [['我叫小林，帮我记下来','介绍一下你自己'],[],['帮我整理今天的计划']]){testCore.nextSuggestionsView=()=>({enabled:true,suggestions});testCore._nextSuggestionsPaint();await new Promise(r=>setTimeout(r,180));}
    testCore.nextSuggestionsView=prior;
   },sessionId);
  },4000);
  await page.locator('#chat-scroll').hover();await page.mouse.wheel(0,-400);await page.waitForFunction(()=>{const b=document.getElementById('chat-scroll');return b.scrollHeight-b.clientHeight-b.scrollTop>100;});await settle();
  check(`${theme}: real distance offers arrow`,await page.locator('#jump-latest').isVisible());
  if(!before){check(`${theme}: arrow has no text`,(await page.locator('#jump-latest').textContent()).trim()==='');check(`${theme}: arrow is overlay`,await page.locator('#jump-latest').evaluate(el=>getComputedStyle(el).position==='absolute'));}
  await page.screenshot({path:join(out,`${theme}-reading.png`)});
  await page.locator('#jump-latest').click();await page.waitForTimeout(450);
  check(`${theme}: return resumes following`,await page.evaluate(()=>{const b=document.getElementById('chat-scroll');return testUi.conversationScroll.pinned&&b.scrollHeight-b.clientHeight-b.scrollTop<=2;}));
  check(`${theme}: usage absent from header`,await page.locator('.assistant-topbar').getByRole('button',{name:'本对话用量',exact:true}).count()===0);
  await page.locator('#workspace-panels').click();await settle();
  check(`${theme}: single panel toggle`,await page.locator('.preview-heading').getByRole('button',{name:'收起右侧面板',exact:true}).count()===0&&await page.getByRole('button',{name:'收起右侧面板',exact:true}).count()===1);
  await page.locator('#workspace-panels').click();
  await sample(`${theme}-panel-toggle`,async()=>{await page.locator('#workspace-panels').click();await page.waitForTimeout(180);await page.locator('#workspace-panels').click();});
  for(const size of [[900,700],[1280,800]]){await app.evaluate(({BrowserWindow},[w,h])=>BrowserWindow.getAllWindows()[0].setContentSize(w,h),size);await settle();check(`${theme}: native ${size.join('x')} fills window`,await page.evaluate(()=>document.documentElement.clientWidth===innerWidth&&document.querySelector('.assistant-shell').getBoundingClientRect().right>=innerWidth-1));}
  await sample(`${theme}-native-resize`,async()=>{await page.locator('#message-text').click();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].maximize());await page.waitForTimeout(300);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].unmaximize());},1000);
  await sample(`${theme}-native-drag-resize`,async()=>{await page.locator('#message-text').click();for(const w of [1200,1120,1000,900,1000,1120,1200,1280]){await app.evaluate(({BrowserWindow},w)=>BrowserWindow.getAllWindows()[0].setContentSize(w,800),w);await page.waitForTimeout(35);}},1100);
 }
 await page.evaluate(()=>testUi.openSettings('usage'));
 const usage=page.locator('.settings-category[data-category="usage"]');
 await usage.locator('.usage-ranking').first().waitFor();
 check('settings still shows recorded conversation usage',await usage.locator('.usage-ranking').first().evaluate(el=>el.textContent.includes('合成消息操作')));
 check('no renderer errors',errors.length===0);report.errors=errors;
} catch(error) {
 const page=app&&await app.firstWindow();
 if(page){await page.screenshot({path:join(out,'failure.png')});await writeFile(join(out,'failure.txt'),await page.locator('body').innerText());await writeFile(join(out,'failure-state.json'),JSON.stringify(await page.evaluate(()=>({fresh:testCore.state.newConversation,session:testCore.state.selectedSessionId,events:[...testCore.state.historyEvents.values()],live:testCore.state.liveMessageSeq,html:document.getElementById('transcript').innerHTML})),null,2));}
 throw error;
} finally {
 await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));
 await app?.close();await fixture?.close();if(lock)await unlink(lock);
}
console.log(JSON.stringify(report));
