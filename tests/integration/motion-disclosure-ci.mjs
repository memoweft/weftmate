// Real UI at a controlled offscreen cadence, or an explicitly visible loaded window.
import assert from 'node:assert/strict';
import {_electron} from 'playwright';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {startFixture} from './ux-4-fixture.mjs';
import {localUiSession} from '../helpers/local-ui-session.mjs';
import {managedMkdtempSync,disposeManagedTemp} from '../helpers/managed-temp.mjs';
const root=resolve(import.meta.dirname,'../..'),visible=process.argv.includes('--visible');
const out=resolve(process.env.WEFTMATE_DISCLOSURE_OUTPUT||'.local/evidence/motion-disclosure');
await mkdir(out,{recursive:true});
const report={commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true,timeout:10000}).trim(),node:process.version,controlledOffscreen:!visible,cases:[],errors:[]};let app,page,fixture,scope,cdp,currentCase='setup';const images=[],writes=[];
try{
  scope=managedMkdtempSync('weftmate-disclosure-ci-',{prune:false});fixture=await startFixture();
  const env={...process.env,REVIEW_PROFILE:join(scope,'profile'),REVIEW_ORIGIN:fixture.origin,REVIEW_LIBRARY_TOKEN:fixture.libraryDesktopToken};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:root,args:[visible?'tests/helpers/ui-motion-2-electron.mjs':'tests/helpers/motion-disclosure-ci-electron.mjs'],env,timeout:30000});
  for(const stream of [app.process().stdout,app.process().stderr])stream?.resume();page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(e.message));
  if(!visible)await page.addInitScript(()=>{Object.defineProperty(document,'visibilityState',{get:()=> 'visible'});Object.defineProperty(document,'hidden',{get:()=>false});});
  await page.route('**/personal/v1/ui/app.js',async route=>route.fulfill({contentType:'text/javascript',body:(await readFile(join(root,'src/personal-access-ui/app.js'),'utf8')).replace('ui.loadAttachmentHasher =','globalThis.testCore=core;globalThis.testUi=ui;ui.loadAttachmentHasher =')}));
  await page.waitForURL('**/personal/v1/ui');await localUiSession(page,fixture.credentials,'Disclosure CI synthetic',{mainChat:true});
  await page.waitForFunction(()=>globalThis.__WeftUiStarted&&globalThis.testCore?.state.sessions.length>0);
  if(visible)await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.show();w.focus();});
  if(visible){cdp=await page.context().newCDPSession(page);cdp.on('Page.screencastFrame',event=>{const file=`capture-${String(images.length).padStart(5,'0')}.jpg`;images.push({file,case:currentCase,timestamp:event.metadata.timestamp});writes.push(writeFile(join(out,file),Buffer.from(event.data,'base64')));void cdp.send('Page.screencastFrameAck',{sessionId:event.sessionId}).catch(()=>{});});await cdp.send('Page.startScreencast',{format:'jpeg',quality:72,maxWidth:1280,maxHeight:800,everyNthFrame:1});}
  await page.evaluate(()=>{
    WeftReplyMotion.setPreference('full');WeftReplyMotion.setVisibility(false);globalThis.readyWork=0;globalThis.workEvents=[];
    const animate=Element.prototype.animate;
    Element.prototype.animate=function(...args){const animation=animate.apply(this,args);if(this.matches('.execution-block')&&readyWork){const ms=readyWork;readyWork=0;animation.ready.then(()=>{const start=performance.now();workEvents.push({start,timeline:document.timeline.currentTime,time:animation.currentTime});while(performance.now()-start<ms){}workEvents.at(-1).end=performance.now();}).catch(()=>{});}return animation;};
  });
  const cases=visible?[{rate:0,load:0,lines:3},{rate:30,load:28,lines:3},{rate:30,load:28,lines:35},{rate:30,load:28,lines:12,streaming:true}]:[{rate:60,load:0,lines:3},{rate:60,load:20,lines:3},{rate:30,load:0,lines:3}];
  for(const scenario of cases){
    currentCase=`${scenario.rate}-${scenario.load}-${scenario.lines}`;
    if(!visible)await app.evaluate(({BrowserWindow},rate)=>BrowserWindow.getAllWindows()[0].webContents.setFrameRate(rate),scenario.rate);
    await page.evaluate(async({id,lines,streaming})=>{
      await testCore.selectSession(id);testCore.stopAssistantRefresh();testCore.refreshConversationFacts=async()=>{};testCore.state.historyGeneration++;
      testCore.state.personalization={...testCore.state.personalization,thinkingDisplay:'collapsed'};testCore.state.historyEvents.clear();testCore.state.seenSeq.clear();testCore.state.liveMessageSeq=-1;testUi.resetMainChatView();
      const at=new Date().toISOString(),ev=(seq,type,data)=>({seq,type,data,at,sessionId:id}),text=Array.from({length:lines},(_,i)=>`第 ${i+1} 段合成思考，核对展开与阅读位置。`).join('\n\n');
      testCore.appendHistory([ev(0,'turn.started',{turn:1}),ev(1,'user.message',{text:'合成问题',turn:1}),...(!streaming?[ev(2,'assistant.message',{text:'合成回答，正文保留。',modelThinking:text,thinkingMs:2000,turn:1}),ev(3,'turn.ended',{turn:1,reason:'completed'})]:[])],streaming?[ev(2,'assistant.delta',{text:'',modelThinking:text,thinkingActive:true,streaming:true,turn:1})]:[],4);
    },{id:fixture.source,...scenario});
    await page.waitForTimeout(380);await page.locator('#transcript .execution-block > summary').first().scrollIntoViewIfNeeded();
    await page.evaluate(({load,visible})=>{
      workEvents=[];readyWork=visible?0:load;globalThis.probeFrames=[];
      const tick=frameAt=>{const d=document.querySelector('#transcript .execution-block');if(visible&&d.open&&load){const until=performance.now()+load;while(performance.now()<until){}}
        const height=d.getBoundingClientRect().height,s=d.querySelector(':scope > summary'),body=d.querySelector('.execution-records');
        probeFrames.push({frameAt,at:performance.now(),timeline:document.timeline.currentTime,height,y:s.getBoundingClientRect().y,body:body.getBoundingClientRect().height,open:d.open,animations:d.getAnimations().map(a=>({time:a.currentTime,start:a.startTime,pending:a.pending,state:a.playState,timing:a.effect.getTiming(),computed:a.effect.getComputedTiming(),frames:a.effect.getKeyframes()}))});globalThis.probeRaf=requestAnimationFrame(tick);};probeRaf=requestAnimationFrame(tick);
    },{...scenario,visible});
    await page.locator('#transcript .execution-block > summary').first().click();
    if(scenario.streaming){await page.waitForTimeout(40);await page.evaluate(id=>{const text=Array.from({length:24},(_,i)=>`第 ${i+1} 段合成思考，核对展开与阅读位置。`).join('\n\n');testCore.appendHistory([],[{seq:2,type:'assistant.delta',sessionId:id,at:new Date().toISOString(),data:{text:'',modelThinking:text,thinkingActive:true,streaming:true,turn:1}}],5);},fixture.source);}
    await page.waitForTimeout(600);
    const captured=await page.evaluate(()=>{cancelAnimationFrame(probeRaf);return {frames:probeFrames,workEvents};}),open=captured.frames.filter(f=>f.open&&f.height>0),end=open.at(-1).height,maxJump=Math.max(...open.slice(1).map((f,i)=>Math.abs(f.height-open[i].height)));
    const native=await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];return {visible:w.isVisible(),focused:w.isFocused(),minimized:w.isMinimized()};});
    const result={...scenario,end,maxJump,limit:Math.max(32,end*.4),passes:open.length>4&&maxJump<Math.max(32,end*.4),native,...captured};report.cases.push(result);await writeFile(join(out,`${scenario.rate}-${scenario.load}-${scenario.lines}.json`),JSON.stringify(result,null,2));
    if(!visible&&scenario.load)assert.ok(captured.workEvents.length===1&&captured.workEvents[0].end-captured.workEvents[0].start>=scenario.load,'the single ready-frame workload actually ran');
  }
  assert.ok(report.cases.every(c=>c.passes),JSON.stringify(report.cases.map(({rate,load,lines,maxJump,passes})=>({rate,load,lines,maxJump,passes}))));
  assert.ok(report.cases.every(c=>Math.max(...c.frames.map(f=>f.y))-Math.min(...c.frames.map(f=>f.y))<=2),'summary remains anchored');
  assert.ok(report.cases.every(c=>c.frames.some(f=>f.animations.some(a=>a.timing.duration===220))),'height animation retains its 220ms duration');
  const reversed=await page.evaluate(async()=>{const d=document.querySelector('#transcript .execution-block'),s=d.querySelector('summary');s.click();await new Promise(r=>setTimeout(r,35));s.click();await new Promise(r=>setTimeout(r,25));s.click();await new Promise(r=>setTimeout(r,300));return {open:d.open,height:d.style.height,overflow:d.style.overflow};});
  assert.deepEqual(reversed,{open:false,height:'',overflow:''});
  await page.evaluate(()=>WeftReplyMotion.setPreference('reduce'));
  const reduced=await page.evaluate(()=>{const d=document.querySelector('#transcript .execution-block');d.querySelector('summary').click();return {open:d.open,height:d.style.height,frames:d.getAnimations().flatMap(a=>a.effect.getKeyframes())};});
  assert.ok(reduced.open&&!reduced.height&&reduced.frames.every(f=>!f.height&&!f.transform),'reduction keeps immediate layout with non-spatial feedback');
  assert.equal(report.errors.length,0,JSON.stringify(report.errors));
}catch(e){report.failure=e.stack;throw e;}finally{if(cdp){await cdp.send('Page.stopScreencast').catch(()=>{});await cdp.detach().catch(()=>{});}await Promise.all(writes);report.imageFrames=images.length;await writeFile(join(out,'screencast.json'),JSON.stringify(images,null,2));await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));await page?.unrouteAll({behavior:'wait'}).catch(()=>{});await app?.close();await fixture?.close();if(scope)disposeManagedTemp(scope);}
console.log(JSON.stringify(report.cases.map(({rate,load,lines,maxJump,passes})=>({rate,load,lines,maxJump,passes}))));
