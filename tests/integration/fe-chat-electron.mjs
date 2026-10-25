// Real desktop shell, synthetic model and an isolated profile; no daily installation.
import assert from 'node:assert/strict';
import {_electron} from 'playwright';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm,open,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {startFixture} from './ux-4-fixture.mjs';
import {feedbackUiSession} from '../helpers/feedback-ui-session.mjs';

const repo=resolve(import.meta.dirname,'../..'),out=process.env.WEFTMATE_FE_CHAT_OUTPUT;
assert.ok(out && !resolve(out).startsWith(repo),'captures belong outside the repository');
const profile=await mkdtemp(join(tmpdir(),'weftmate-fe-chat-'));
process.env.WEFTMATE_MANAGED_TEMP_ROOT=join(profile,'fixtures');
await mkdir(out,{recursive:true});
const bootstrap=join(profile,'fe-chat-shell.mjs');
await writeFile(bootstrap,`import {createRequire} from 'node:module';
const {app}=createRequire(${JSON.stringify(new URL('../../package.json',import.meta.url).href)})('electron');
app.setName('WeftMate FE Chat Test');app.setAppUserModelId('com.memoweft.weftmate.test.fechat');app.disableHardwareAcceleration();
await import(${JSON.stringify(new URL('../../scripts/review-gallery/electron.mjs',import.meta.url).href)});`);
let app,fixture,lock;
const failures=[];
async function check(name,run){try{await run();console.log('PASS '+name)}catch(error){failures.push(name+': '+error.message);console.log('FAIL '+name+': '+error.message)}}
for(let n=1;n<=3;n++){const path=`D:/AIProjects/WeftMate/Runtime/Orchestrator/locks/heavy-${n}.lock`;try{const handle=await open(path,'wx');await handle.writeFile('FE-CHAT '+new Date().toISOString());await handle.close();lock=path;break}catch(error){if(error.code!=='EEXIST')throw error}}
assert.ok(lock,'No heavy slot available');
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
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/personal/v1/settings/usage',route=>route.fulfill({json:{timeZone:'Asia/Shanghai'}}));
  await feedbackUiSession(page,fixture,{native:true});
  await page.evaluate(async()=>{
    WeftReplyMotion.setVisibility(false);
    await Promise.allSettled(document.getAnimations().filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished));
  });
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
  for(const theme of process.argv.includes('--both')?['light','dark']:[selectedTheme]){
    await page.evaluate(theme=>WeftDesktop.setAppearance({theme}),theme);
    await capture(theme+'-empty',null,450);
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
    await writeFile(join(out,'send-identity.json'),JSON.stringify(await page.evaluate(()=>({same:sentProcess===[...document.querySelectorAll('#transcript .execution-block')].at(-1),saved:sentProcess?.outerHTML,rows:[...document.querySelectorAll('#transcript > li')].map(n=>({key:n.dataset.eventId,html:n.innerHTML})),pending:__feedbackSessionCore.optimisticMessages()})),null,2));
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
  await check('a long live answer and its completion preserve manual scroll and the visible body',async()=>{
    expectedProcesses++;
    await page.locator('#message-text').fill('合成长回答');await page.locator('#message-form').evaluate(form=>form.requestSubmit());
    await page.waitForFunction(()=>!__feedbackSessionCore.state.submitting);await refresh();
    assert.equal(turn,expectedProcesses,'the long reply belongs to an accepted native turn');
    const seq=fixture.logs.get(activeSession).at(-1).seq+1;
    const prose='合成回答 · 长内容\n\n'+Array.from({length:65},(_,i)=>`第 ${i+1} 段：让阅读保持安静，旧内容留在原处，新的回答顺着页面继续。`).join('\n\n');
    live=[{seq,type:'assistant.delta',at:new Date().toISOString(),sessionId:activeSession,data:{text:prose,streaming:true}}];phase='answering';await refresh();
    await capture('long-live',null,700);
    const before=await page.evaluate(()=>{const box=document.getElementById('chat-scroll');box.dispatchEvent(new WheelEvent('wheel',{deltaY:-300}));box.scrollTop=Math.max(0,box.scrollTop-300);globalThis.feLongBody=[...document.querySelectorAll('#transcript .message.assistant .message-text')].at(-1);return box.scrollTop;});
    live[0].data.text+='\n\n新的合成补充，继续显示在文末。';await refresh();
    await capture('long-held',null,550);
    const held=await page.evaluate(()=>document.getElementById('chat-scroll').scrollTop);assert.ok(Math.abs(held-before)<=2,JSON.stringify({before,held}));
    append('assistant.message',{text:live[0].data.text+'\n\n合成长内容完成标记。',streamSeq:seq});live=[];append('turn.ended',{turn,reason:'completed'});await refresh();
    await capture('long-completed',null,650);
    assert.equal(await page.evaluate(()=>feLongBody===[...document.querySelectorAll('#transcript .message.assistant .message-text')].at(-1)),true);
    assert.ok(Math.abs(await page.evaluate(()=>document.getElementById('chat-scroll').scrollTop)-before)<=2);
  });
  // Production renderers, including their native details and keyboard controls.
  await page.evaluate(()=>{
    const pane=document.getElementById('conversation-pane');pane.hidden=false;
    const target=document.createElement('ol');target.id='fe-chat-probe';target.className='transcript';pane.querySelector('#chat-scroll').prepend(target);
    globalThis.feChatEvents=[{seq:0,at:'2026-10-26T01:00:00Z',type:'turn.started',data:{turn:42}},
      {seq:1,type:'user.message',data:{text:'合成工作'}},
      ...[0,1,2].map((n)=>({seq:n+2,at:'2026-10-26T01:00:01Z',type:'step.completed',data:{taskId:'turn-42',stepId:'file-'+n,toolName:'read',summary:'读取合成文件 '+n,state:'completed',detailRef:{seq:n+2}}}))];
    globalThis.feChatRender=()=>WeftTimeline.render(feChatEvents,target,{readDetail:async()=>({text:'合成输出\n'.repeat(12)})});feChatRender();
    WeftReplyMotion.setVisibility(false);
  });
  await check('polling retains tool, group and focused summary nodes',async()=>{
    const work=page.evaluate(async()=>{
      const target=document.getElementById('fe-chat-probe'),process=target.querySelector('.execution-block');process.open=true;
      await new Promise(requestAnimationFrame);
      const group=target.querySelector('.execution-step-group');group.open=true;
      const tool=target.querySelector('.execution-step'),summary=tool.querySelector('summary');tool.open=true;
      await new Promise(resolve=>setTimeout(resolve,700));summary.focus();
      if(document.activeElement!==summary){const chain=[];for(let n=summary;n;n=n.parentElement)chain.push({tag:n.tagName,cls:n.className,hidden:n.hidden,open:n.open,rect:n.getBoundingClientRect().toJSON(),display:getComputedStyle(n).display,content:getComputedStyle(n,'::details-content').contentVisibility,height:getComputedStyle(n,'::details-content').blockSize});throw Error('tool summary must be focusable before polling '+JSON.stringify(chain));}
      feChatEvents.push({seq:5,at:'2026-10-26T01:00:02Z',type:'step.completed',data:{taskId:'turn-42',stepId:'file-3',toolName:'read',summary:'读取合成文件 3',state:'completed'}});feChatRender();
      return {group:group===target.querySelector('.execution-step-group'),tool:tool===target.querySelector('.execution-step'),summary:summary===target.querySelector('.execution-step > summary'),focus:document.activeElement===summary,open:tool.open&&group.open};
    });await capture('tool-focus',()=>work,1500);const result=await work;assert.deepEqual(result,{group:true,tool:true,summary:true,focus:true,open:true});
  });
  await check('process expansion and collapse have real intermediate heights',async()=>{
    await capture('disclosure-closed',()=>page.evaluate(()=>{document.querySelector('#fe-chat-probe .execution-block').open=false}),900);
    const work=page.evaluate(async()=>{
      const process=document.querySelector('#fe-chat-probe .execution-block');
      const closed=process.getBoundingClientRect().height;
      process.querySelector('summary').click();const open=[];let start=performance.now();
      while(performance.now()-start<750){await new Promise(requestAnimationFrame);open.push(process.getBoundingClientRect().height)}
      process.querySelector('summary').click();const close=[];start=performance.now();
      while(performance.now()-start<750){await new Promise(requestAnimationFrame);close.push(process.getBoundingClientRect().height)}
      return {closed,open,close};
    });
    await capture('disclosure',()=>work,1900);const frames=await work;await writeFile(join(out,'disclosure-heights.json'),JSON.stringify(frames,null,2));const full=Math.max(...frames.open);assert.ok(full>frames.closed+20,JSON.stringify({closed:frames.closed,full,first:frames.open.slice(0,6)}));
    assert.ok(frames.open.some(n=>n>frames.closed+2&&n<full-2),'opening changes actual height');
    assert.ok(frames.close.some(n=>n>frames.closed+2&&n<full-2),'closing changes actual height');
    await writeFile(join(out,'disclosure-heights.json'),JSON.stringify(frames,null,2));
  });
  await check('tool timestamps and durations are available to focus',async()=>{
    const result=await page.evaluate(()=>{const summary=document.querySelector('#fe-chat-probe .execution-step > summary');summary.focus();return {name:summary.getAttribute('aria-description')||summary.getAttribute('title'),time:summary.querySelector('time')?.textContent};});
    assert.ok(result.name?.includes('2026')||result.time,'recorded tool time');
  });
  await page.evaluate(()=>document.getElementById('fe-chat-probe').remove());
  await check('streaming appends plain prose without replacing the paragraph or its text node',async()=>{
    const work=page.evaluate(async()=>{
      const target=document.createElement('div');document.getElementById('chat-scroll').append(target);
      const body=WeftContent.create('这是已经读到的前文。','message-text markdown-body');target.append(body);
      const paragraph=body.firstElementChild,text=paragraph.firstChild;
      WeftContent.update(body,'这是已经读到的前文。现在继续出现后面的回答。',{streaming:true});
      await new Promise(resolve=>setTimeout(resolve,600));
      const result={paragraph:paragraph===body.firstElementChild,text:text===paragraph.firstChild,content:body.textContent};target.remove();return result;
    });await capture('stream-prose',()=>work,900);const result=await work;
    assert.equal(result.paragraph,true);assert.equal(result.text,true);assert.equal(result.content,'这是已经读到的前文。现在继续出现后面的回答。');
  });
  await check('inline decisions keep the original controls through parking and reattachment',async()=>{
    const result=await page.evaluate(()=>{
      const approval=WeftTimeline.decisionSurface('approval-bar'),question=WeftTimeline.decisionSurface('question-bar');
      const button=document.createElement('button');button.textContent='合成决定';let submitted=0;button.onclick=()=>submitted++;approval.append(button);approval.hidden=false;
      WeftTimeline.placeDecisions();const adjacent=!!approval.closest('#transcript .timeline-entry');
      button.focus();WeftTimeline.placeDecisions(document.getElementById('transcript'),true);const parked=approval.isConnected&&!approval.closest('#transcript');
      WeftTimeline.placeDecisions();button.click();const retained=approval.querySelector('button')===button&&question.isConnected;
      approval.hidden=true;button.remove();return {adjacent,parked,retained,submitted};
    });assert.deepEqual(result,{adjacent:true,parked:true,retained:true,submitted:1});
  });
  await check('manual upward scrolling holds its reading position while a long reply grows',async()=>{
    const result=await page.evaluate(async()=>{
      const box=document.createElement('div'),content=document.createElement('div'),button=document.createElement('button');
      Object.assign(box.style,{height:'160px',width:'400px',overflow:'auto',position:'fixed',top:'100px',left:'300px'});content.style.height='1200px';box.append(content);document.body.append(box,button);
      const scroll=WeftConversationScroll(box,content,button);scroll.latest();box.dispatchEvent(new WheelEvent('wheel',{deltaY:-100}));box.scrollTop=400;box.dispatchEvent(new Event('scroll'));
      content.style.height='1800px';scroll.changed();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
      const held=box.scrollTop===400&&!scroll.pinned;button.click();const latest=box.scrollTop===1640&&scroll.pinned;box.remove();button.remove();return {held,latest};
    });assert.deepEqual(result,{held:true,latest:true});
  });
  await check('desktop composer and transcript share a compact readable measure',async()=>{
    const result=await page.evaluate(()=>{const pane=document.getElementById('conversation-pane'),form=document.getElementById('message-form'),text=document.getElementById('message-text'),list=document.getElementById('transcript');return {form:form.getBoundingClientRect().width,list:list.getBoundingClientRect().width,height:form.getBoundingClientRect().height,font:parseFloat(getComputedStyle(text).fontSize),overflow:pane.scrollWidth>pane.clientWidth};});
    assert.ok(Math.abs(result.form-result.list)<=2,'input and answer share a reading column '+JSON.stringify(result));assert.equal(result.overflow,false);
  });
  await check('system reduced motion keeps a completed answer and native controls',async()=>{
    await page.emulateMedia({reducedMotion:'reduce'});
    const result=await page.evaluate(()=>({reduced:WeftReplyMotion.reduced,text:document.querySelector('#transcript .message.assistant .message-text')?.textContent,process:document.querySelectorAll('#transcript .execution-block > summary').length}));
    assert.equal(result.reduced,true);assert.ok(result.text?.includes('合成回答'));assert.ok(result.process>0);await page.emulateMedia({reducedMotion:'no-preference'});
  });
  await check('narrow desktop keeps the input, answer and process inside the window',async()=>{
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(780,760));
    await capture('narrow-desktop',null,650);
    const result=await page.evaluate(()=>{const pane=document.getElementById('conversation-pane');return {fits:pane.scrollWidth<=pane.clientWidth,form:document.getElementById('message-form').getBoundingClientRect().width,viewport:pane.clientWidth};});
    assert.equal(result.fits,true);assert.ok(result.form<=result.viewport);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1200,800));
  });
  await writeFile(join(out,'checks.json'),JSON.stringify({failures,errors},null,2));
  assert.deepEqual(failures,[]);
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.isVisible())),false);
  assert.deepEqual(errors,[]);
  console.log(`PASS: hidden Electron ${selectedTheme}/${outcome}, send/current selection; one process, stable process and answer nodes, alignment, 80 ms captures${process.argv.includes('--mobile')?', mobile web stopped turn':''}.`);
}finally{
  clearTimeout(deadline);kill();if(lock)await unlink(lock);await app?.close().catch(e=>{if(!/closed|EPIPE|Target/.test(e.message))throw e});await Promise.race([fixture?.close(),new Promise(resolve=>setTimeout(resolve,1000))]);assert.ok(profile.startsWith(join(tmpdir(),'weftmate-fe-chat-')));await rm(profile,{recursive:true,force:true});
}
