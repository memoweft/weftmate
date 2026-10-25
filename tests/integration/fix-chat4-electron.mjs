// Real desktop shell, synthetic model and an isolated profile; no daily installation.
import assert from 'node:assert/strict';
import {_electron} from 'playwright';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {startFixture} from './ux-4-fixture.mjs';
import {feedbackUiSession} from '../helpers/feedback-ui-session.mjs';

const repo=resolve(import.meta.dirname,'../..'),out=process.env.WEFTMATE_CHAT4_OUTPUT;
assert.ok(out && !resolve(out).startsWith(repo),'captures belong outside the repository');
const profile=await mkdtemp(join(tmpdir(),'weftmate-fix-chat4-'));
process.env.WEFTMATE_MANAGED_TEMP_ROOT=join(profile,'fixtures');
await mkdir(out,{recursive:true});
const bootstrap=join(profile,'fix-chat4-shell.mjs');
await writeFile(bootstrap,`import {createRequire} from 'node:module';
const {app}=createRequire(${JSON.stringify(new URL('../../package.json',import.meta.url).href)})('electron');
app.setAppUserModelId('com.memoweft.weftmate.test.fixchat4');
await import(${JSON.stringify(new URL('../../scripts/review-gallery/electron.mjs',import.meta.url).href)});`);
let app,fixture;
const kill=()=>{const p=app?.process();if(p?.exitCode===null)spawnSync('taskkill.exe',['/PID',String(p.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'})};
const deadline=setTimeout(()=>{kill();process.exitCode=1},150000);
try {
  fixture=await startFixture();
  fixture.backend.chatRelayState=async()=>({pending:false,safe:true});
  let phase,live=[],turn=0,activeSession;
  const read=fixture.backend.readEvents;
  fixture.backend.readEvents=async input=>({...await read(input),liveEvents:input.sessionId===activeSession?live:[],liveSeq:live.length?turn:-1});
  const describe=fixture.backend.describeSession;
  fixture.backend.describeSession=async id=>({...await describe(id),running:fixture.logs.get(id)?.findLast(e=>['turn.started','turn.ended'].includes(e.type))?.type==='turn.started',processing:{phase}});
  const append=(type,data)=>{const rows=fixture.logs.get(activeSession);rows.push({seq:(rows.at(-1)?.seq??-1)+1,type,data,at:new Date().toISOString(),sessionId:activeSession})};
  fixture.backend.sendMessage=async input=>{
    await new Promise(resolve=>setTimeout(resolve,500));
    activeSession=input.sessionId;turn++;phase=undefined;live=[];
    const receiptId='r-'+randomUUID();append('turn.started',{turn});append('user.message',{text:input.text,receiptId});
    return {accepted:true,receiptId};
  };
  fixture.backend.cancelSession=async()=>{live=[];append('turn.ended',{turn,reason:'aborted'});return {accepted:true}};
  const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
  Object.assign(env,{REVIEW_PROFILE:profile,REVIEW_ORIGIN:fixture.origin,REVIEW_LIBRARY_TOKEN:fixture.libraryDesktopToken,REVIEW_THEME:'light',REVIEW_HIDDEN:'1',WEFTMATE_TEST_HOST_NAME:'synthetic-host'});
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:repo,args:[bootstrap],env,timeout:30000});
  for(const stream of [app.process().stdout,app.process().stderr])stream?.on('error',e=>{if(e.code!=='EPIPE')throw e});
  const page=await app.firstWindow();page.setDefaultTimeout(12000);
  if(process.argv.includes('--baseline'))for(const file of ['ui-core/timeline-model.js','ui-core/composer.js','ui-core/messages.js','ui-core/tasks.js','ui-core/main-chat.js','ui-core/reply-motion.js','ui-core/reply-motion.css','timeline.js','components/main-chat.js']){
    const source=execFileSync('git',['show','HEAD:src/'+(file.startsWith('ui-core/')?file:'personal-access-ui/'+file)],{cwd:repo,encoding:'utf8',windowsHide:true});
    await page.route('**/personal/v1/ui/'+file,route=>route.fulfill({body:source,contentType:file.endsWith('.css')?'text/css':'text/javascript'}));
  }
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/personal/v1/settings/usage',route=>route.fulfill({json:{timeZone:'Asia/Shanghai'}}));
  await feedbackUiSession(page,fixture,{native:true});
  await page.evaluate(async id=>{await __feedbackSessionCore.selectSession(id)},fixture.source);
  await page.unroute('**/personal/v1/status');
  await page.evaluate(async()=>{const c=__feedbackSessionCore;await c.refreshStatus();await c.refreshSessions();await c.selectMainChat();c.setMessageMode('queue')});
  const refresh=()=>page.evaluate(async()=>{const c=__feedbackSessionCore;await c.refreshSessions();await c.refreshHistory();c.setMessageMode('queue')});
  let sample=0,expectedProcesses=0;
  async function capture(name,action,duration=1200){
    const work=action?.();const frames=[],start=Date.now();
    do {
      const at=Date.now();
      const frame=await page.evaluate(()=>{const list=document.getElementById('transcript'),line=[...list.querySelectorAll('.execution-block > summary')].at(-1),answer=[...list.querySelectorAll('.message.assistant .message-text')].at(-1);if(globalThis.trackSend && line && !globalThis.sentProcess)globalThis.sentProcess=line.closest('.execution-block');const rect=n=>n?{x:n.getBoundingClientRect().x,y:n.getBoundingClientRect().y,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height}:null;return {scroll:document.getElementById('chat-scroll').scrollTop,lines:list.querySelectorAll('.execution-block > summary,.inline-waiting').length,line:rect(line),answer:rect(answer),text:line?.innerText,background:line&&getComputedStyle(line).backgroundColor,html:list.innerText}});
      frames.push(frame);
      const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'));
      await writeFile(join(out,`${name}-${String(sample++).padStart(4,'0')}.png`),Buffer.from(png,'base64'));
      await new Promise(resolve=>setTimeout(resolve,Math.max(0,80-(Date.now()-at))));
    }while(Date.now()-start<duration);
    await work;
    for(const f of frames){assert.ok(f.lines<=expectedProcesses,`one process: ${JSON.stringify(f)}`);assert.doesNotMatch(f.html,/核对已执行的步骤与成果后/)}
    return frames;
  }
  const selectedTheme=process.argv.find(arg=>arg.startsWith('--theme='))?.split('=')[1] || 'light';
  const outcome=process.argv.includes('--stop')?'stop':'end';
  for(const theme of [selectedTheme]){
    await page.evaluate(theme=>WeftDesktop.setAppearance({theme}),theme);
    // Actual send path includes the optimistic interval before the native receipt.
    expectedProcesses++;
    await page.locator('#message-text').fill('合成消息 '+theme);
    await page.evaluate(()=>{globalThis.trackSend=true;globalThis.sentProcess=null});
    const sentFrames=await capture(theme+'-'+outcome+'-send',()=>page.locator('#message-form').evaluate(form=>form.requestSubmit()));
    await page.evaluate(()=>globalThis.trackSend=false);
    await page.waitForFunction(()=>!__feedbackSessionCore.state.submitting);
    assert.equal(turn,expectedProcesses,'the synthetic model accepted this turn');
    await refresh();
    try { await page.locator('#transcript .execution-block').last().waitFor(); }
    catch(error){console.error({activeSession,turn,logs:[...fixture.logs].map(([id,events])=>[id,events.map(e=>e.type)]),ui:await page.evaluate(()=>({text:document.getElementById('transcript').innerText,notice:document.getElementById('operation-status')?.textContent,tasks:__feedbackSessionCore.state.tasks.map(t=>({state:t.state,error:t.errorCode})),chat:__feedbackSessionCore.currentTimelineChat(),errors:document.getElementById('toast')?.innerText}))});throw error}
    assert.equal(await page.evaluate(()=>sentProcess===[...document.querySelectorAll('#transcript .execution-block')].at(-1)),true,'native receipt keeps the optimistic process node');
    const sentPositions=sentFrames.filter(f=>f.line);assert.ok(Math.max(...sentPositions.map(f=>f.line.y))-Math.min(...sentPositions.map(f=>f.line.y))<=1,'sending keeps its final position '+JSON.stringify(sentPositions.map(f=>f.line.y)));
    await page.evaluate(()=>{globalThis.savedProcess=[...document.querySelectorAll('#transcript .execution-block')].at(-1);globalThis.savedSummary=savedProcess.querySelector('summary')});
    phase='reasoning';await refresh();
    append('step.started',{taskId:`turn-${turn}`,stepId:'read-'+turn,toolName:'read',state:'running',summary:'读取合成资料'});await refresh();
    append('step.completed',{taskId:`turn-${turn}`,stepId:'read-'+turn,toolName:'read',state:'completed',summary:'读取合成资料'});
    const seq=fixture.logs.get(activeSession).at(-1).seq+1;
    live=[{seq,type:'assistant.delta',at:new Date().toISOString(),sessionId:activeSession,data:{text:'合成回答正在逐步出现。',streaming:true}}];phase='answering';await refresh();
    await page.waitForFunction(()=>[...document.querySelectorAll('#transcript .message.assistant .message-text')].at(-1)?.textContent.includes('合成回答正在逐步出现。'));
    await page.evaluate(async()=>{await __feedbackSessionCore.reconcileMainRequests();await __feedbackSessionCore.refreshHistory()});
    await page.evaluate(()=>{globalThis.savedAnswer=[...document.querySelectorAll('#transcript .message.assistant .message-text')].at(-1)});
    await page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)});
    const finish=outcome==='end'?async()=>{append('assistant.message',{text:'合成回答正在逐步出现。现在已经完成。',streamSeq:seq});live=[];append('turn.ended',{turn,reason:'completed'});await refresh()}:async()=>{append('assistant.message',{text:'合成回答正在逐步出现。',streamSeq:seq});live=[];await page.locator('#send-message').click();await refresh()};
    const frames=await capture(theme+'-'+outcome,finish);
    assert.equal(await page.evaluate(()=>savedProcess===[...document.querySelectorAll('#transcript .execution-block')].at(-1)&&savedSummary===savedProcess.querySelector('summary')&&savedAnswer===[...document.querySelectorAll('#transcript .message.assistant .message-text')].at(-1)),true,'completion keeps process and answer nodes');
    assert.match(await page.locator('#transcript .execution-block > summary').last().innerText(),outcome==='stop'?/已停止/:/处理了/);
    const positions=frames.filter(f=>f.line);assert.ok(Math.max(...positions.map(f=>f.line.y))-Math.min(...positions.map(f=>f.line.y))<=1,theme+' process stays at its original top '+JSON.stringify(positions.map(f=>[f.line.y,f.scroll,f.text])));
    assert.ok(positions.every(f=>f.background==='rgba(0, 0, 0, 0)'),'no transient process background');
    const geometry=await page.evaluate(()=>{const a=savedSummary.getBoundingClientRect(),b=savedAnswer.getBoundingClientRect();return {left:Math.abs(a.left-b.left),width:Math.abs(a.width-b.width)}});
    assert.ok(geometry.left<=1&&geometry.width<=1,JSON.stringify(geometry));
    await capture(theme+'-current',()=>page.evaluate(async()=>{await __feedbackSessionCore.selectMainChat();await __feedbackSessionCore.selectMainChat()}),600);
    assert.equal(await page.evaluate(()=>savedProcess===[...document.querySelectorAll('#transcript .execution-block')].at(-1)),true);
    await page.evaluate(async id=>{await __feedbackSessionCore.selectSession(id);await __feedbackSessionCore.selectMainChat()},fixture.source);
  }
  if(process.argv.includes('--mobile')) {
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(390,844));
    await page.goto(fixture.mobileUrl);
    await page.waitForFunction(()=>state.booted && !!uiCore.state.mainChat);
    await page.evaluate(async()=>{await uiCore.selectMainChat()});
    const summary=page.locator('#chat-content .execution-block > summary');await summary.waitFor();
    assert.equal(await summary.count(),1);
    assert.match(await summary.innerText(),/已停止/);
    assert.doesNotMatch(await page.locator('#chat-content').innerText(),/核对已执行的步骤与成果后/);
    const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'));
    await writeFile(join(out,'mobile-stopped.png'),Buffer.from(png,'base64'));
  }
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.isVisible())),false);
  assert.deepEqual(errors,[]);
  console.log(`PASS: hidden Electron ${selectedTheme}/${outcome}, send/current selection; one process, stable process and answer nodes, alignment, 80 ms captures${process.argv.includes('--mobile')?', mobile web stopped turn':''}.`);
}finally{
  clearTimeout(deadline);kill();await app?.close().catch(e=>{if(!/closed|EPIPE|Target/.test(e.message))throw e});await fixture?.close();await rm(profile,{recursive:true,force:true});
}
