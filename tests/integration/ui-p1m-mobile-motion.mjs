import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { startFe1bFixture } from './fe-1b-fixture.mjs';
import { mobileBridge } from '../../scripts/review-gallery/mobile-bridge.mjs';
const repository=resolve(import.meta.dirname,'../..'), assets=join(repository,'apps/mobile-ui/www');
const evidence=join(repository,'tests/evidence/ui-p1m'), baseline='b99044dbf1ef920c5e1667f6f216f5aabf29bdc9';
const device=process.argv.includes('--device'), capture=!process.argv.includes('--verify-only');
const surface=device?'android':'chromium', packageName='com.memoweft.weftmate.mobile.uip1mqa';
const adb='D:/Software/MuMuPlayer/nx_main/adb.exe', serial='127.0.0.1:7555';
const adbRun=(...args)=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});
const fixture=await startFe1bFixture();
let bridge=mobileBridge(fixture,'light'), phase='after', browser, page, server, debugPort, assetPort, instrument, installed=false, probeInstalled=false;
let instrumentLog='', savedScales={}; const errors=[], results=[], performanceResults=[], checks=[];
async function until(fn){const deadline=Date.now()+30000;while(Date.now()<deadline){const value=await fn();if(value)return value;await sleep(100)}throw Error('Motion condition timed out')}
async function freePort(){const s=createServer();await new Promise(done=>s.listen(0,'127.0.0.1',done));const p=s.address().port;await new Promise(done=>s.close(done));return p}
async function source(name){return phase==='before'?execFileSync('git',['show',`${baseline}:apps/mobile-ui/www/${name}`],{cwd:repository}):readFile(join(assets,name))}
function initializePage(){
  Object.defineProperty(window,'weftNative',{configurable:true,writable:true,value:{postMessage(value){window.__motionNative(JSON.parse(value)).then(result=>window.weftNative.onmessage({data:JSON.stringify(result)}))}}});
  window.__motionCapture=false;window.__motionFrames=[];
  if(!window.__motionPatched){const original=Element.prototype.animate;
  Element.prototype.animate=function(...args){const a=original.apply(this,args);if(window.__motionCapture){a.pause();window.__motionFrames.push(a)}return a};window.__motionPatched=true;}
}
async function installScript(){
 await page.exposeFunction('__motionNative',async payload=>{try{return {id:payload.id,ok:true,result:await bridge(payload)}}catch(e){return {id:payload.id,ok:false,error:{code:e.message}}}});
 await page.addInitScript(initializePage);
}
const button=name=>page.getByRole('button',{name,exact:typeof name==='string'});
const conversation=title=>button(new RegExp(`^${title} [0-9]`));
async function settle(){await page.evaluate(()=>Promise.allSettled(document.getAnimations().map(a=>a.finished)));await page.waitForTimeout(30)}
async function frames(name,action){
 await settle();await page.evaluate(()=>{window.__motionCapture=true;window.__motionFrames=[]});
 await action();await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));await page.evaluate(()=>{for(const a of document.getAnimations())if(!window.__motionFrames.includes(a)){a.pause();window.__motionFrames.push(a)}return document.fonts.ready});const samples=[];
 for(const time of [0,60,120,240]){
  samples.push(await page.evaluate(time=>{const animations=window.__motionFrames.filter(a=>a.effect?.target?.isConnected);for(const a of animations)a.currentTime=time;return animations.map(a=>({target:a.effect.target.id||a.effect.target.className,timing:a.effect.getTiming(),opacity:getComputedStyle(a.effect.target).opacity}))},time));
  if(capture){const file=join(evidence,`${phase}-${surface}-${name}-${time}.png`);if(device)await writeFile(file,execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{windowsHide:true,maxBuffer:16*1024*1024}));else await page.screenshot({path:file,animations:'allow'})}
 }
 await page.evaluate(()=>{window.__motionCapture=false;for(const a of window.__motionFrames){try{a.finish()}catch{}}});
 results.push({phase,name,sampleTimesMs:[0,60,120,240],samples});console.log(`${surface} ${phase} ${name}`);
 if(phase==='after')assert.ok(samples[0].length>0,`${name}: expected motion`);
 if(phase==='reduced')assert.equal(samples.flat().length,0,`${name}: reduced motion must be instant`);
}
async function measure(name,action){
 await settle();await page.evaluate(()=>{window.__tasks=[];window.__gaps=[];let last=null;window.__measuring=true;
 window.__perf=new PerformanceObserver(list=>window.__tasks.push(...list.getEntries().map(e=>({duration:e.duration,startTime:e.startTime}))));window.__perf.observe({type:'longtask'});
 const frame=t=>{if(!window.__measuring)return;if(last!==null)window.__gaps.push(t-last);last=t;requestAnimationFrame(frame)};requestAnimationFrame(frame)});
 await action();await page.waitForTimeout(300);
 const report=await page.evaluate(()=>{window.__measuring=false;window.__perf.disconnect();return {longTasks:window.__tasks,frameGapsMs:window.__gaps}});
 performanceResults.push({name,...report});if(capture){assert.equal(report.longTasks.filter(e=>e.duration>50).length,0,`${name}: long task`);assert.equal(report.frameGapsMs.filter(gap=>gap>50).length,0,`${name}: long frame`);}
}
async function home(){await page.evaluate(()=>page('home'));await conversation('整理项目进展').waitFor();await settle()}
async function report(){await home();await conversation('整理项目进展').click();await page.getByText(/执行了 1 步/).waitFor();await settle()}
async function projectSteps(count){await page.evaluate(count=>{
 let list=document.getElementById('motion-step-fixture');if(!list){list=el('div');list.id='motion-step-fixture';$('chat-content').prepend(list)}
 WeftTimeline.render(Array.from({length:count},(_,i)=>({seq:i+30,type:'step.completed',at:'2026-10-08T06:00:00Z',data:{taskId:'motion',stepId:`step-${i}`,state:'completed',summary:`合成执行步骤 ${i+1}`}})),list,{mobile:true});
 const details=list.querySelector('.execution-block');if(!details.open)details.open=true;
 },count)}
async function projectQueue(count){await page.evaluate(count=>{
 window.__queueCore??=uiCore.taskQueue;uiCore.taskQueue=()=>Array.from({length:count},(_,i)=>({taskId:`motion-queue-${i}`,text:`合成排队任务 ${i+1}`,state:'queued'}));renderQueuedTasks();$('queued-tasks').open=true;
 },count)}
async function loginStep(mode,step){await page.evaluate(({mode,step})=>{
 const core={state:{currentView:'login',cloudAuth:{}},cloudAuthView:()=>({mode:'login',step:'email',email:'',deviceName:'合成手机'}),cloudError:()=>'',cloudPasswordHint:()=>''};
 const ui={byId:id=>document.getElementById(id),element:el,errorAt(){},setBusy(){}};
 WeftMobileCloudForms(core,ui).paint({mode,step,email:'',deviceName:'合成手机',busy:false});
 },{mode,step})}
async function preference(reduced){
 if(device){for(const key of Object.keys(savedScales))adbRun('shell','settings','put','global',key,reduced?'0':savedScales[key]);await until(()=>page.evaluate(expected=>!!document.documentElement.hasAttribute('data-reduced-motion')===expected,reduced))}
 else await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});
}
try{
 if(capture)await mkdir(evidence,{recursive:true});
 await startAssets();
 if(device){
  const packages=adbRun('shell','pm','list','packages');const running=adbRun('shell','ps','-A').split('\n').filter(row=>row.includes('weftmate'));
  assert.equal(running.length,0,'MuMu occupied by another running WeftMate application');assert.ok(!packages.includes(packageName),'Isolated package must be fresh');
  for(const key of ['animator_duration_scale','transition_animation_scale','window_animation_scale'])savedScales[key]=adbRun('shell','settings','get','global',key).trim();
  adbRun('install',join(repository,'apps/android/app/build/outputs/apk/debug/app-debug.apk'));installed=true;
  adbRun('install',join(repository,'apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'));probeInstalled=true;
  adbRun('reverse',`tcp:${server.address().port}`,`tcp:${server.address().port}`);
  instrument=spawn(adb,['-s',serial,'shell','am','instrument','-w','-e','class','com.memoweft.weftmate.mobile.UiP1mWebViewProbeTest','-e','uiP1mProbe','1','-e','uiP1mAssetOrigin',`http://127.0.0.1:${server.address().port}/`,`${packageName}.test/androidx.test.runner.AndroidJUnitRunner`],{windowsHide:true});
  instrument.stdout.on('data',v=>instrumentLog+=v);instrument.stderr.on('data',v=>instrumentLog+=v);
  const pid=await until(()=>{try{return adbRun('shell','pidof',packageName).trim()}catch{return false}});debugPort=await freePort();adbRun('forward',`tcp:${debugPort}`,`localabstract:webview_devtools_remote_${pid}`);
  await until(async()=>{try{return (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).some(row=>row.url.includes(`127.0.0.1:${server.address().port}`))}catch{return false}});
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`,{noDefaults:true});page=await until(()=>browser.contexts()[0].pages()[0]);

 }
  if(!device){
  browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 }
 /* The test shell loads this same production asset server through ADB reverse. */
 async function startAssets(){
  server=createServer(async(req,res)=>{const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';try{res.setHeader('content-type',{'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'}[extname(name)]||'application/octet-stream');res.end(device&&name==='app.js'?Buffer.concat([Buffer.from(`(${initializePage.toString()})();\n`),await source(name)]):await source(name))}catch{res.writeHead(404).end()}});await new Promise(done=>server.listen(0,'127.0.0.1',done));assetPort=server.address().port;
 }
 await installScript();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
 const url=`http://127.0.0.1:${server.address().port}/`;
 for(phase of (capture?['before','after','reduced']:['after','reduced'])){
  bridge=mobileBridge(fixture,'light');await page.goto(url);await page.waitForFunction(()=>state.booted);await page.evaluate(()=>WeftMobileCloud.init());await page.getByRole('heading',{name:'登录 WeftMate',exact:true}).waitFor();
  await preference(phase==='reduced');
  await frames('login-register',()=>button('还没有账号？注册').click());
  await frames('login-code',()=>loginStep('registration','code'));
  await frames('login-password',()=>loginStep('registration','password'));
  await bridge({method:'auth.login',params:{...fixture.credentials,deviceName:'合成动效手机'}});await page.reload();await conversation('整理项目进展').waitFor();
  await frames('session-enter',()=>conversation('整理项目进展').click());await page.getByText(/执行了 1 步/).waitFor();
  await page.getByText(/执行了 1 步/).scrollIntoViewIfNeeded();
  await frames('execution-expand',()=>page.getByText(/执行了 1 步/).click());
  await frames('execution-collapse',()=>page.getByText(/执行了 1 步/).click());
  await projectSteps(1);
  await frames('steps-enter',()=>projectSteps(3));
  await frames('outputs-push',()=>button('输出与来源').click());await button(/^notes.md 1 次使用$/).waitFor();
  await frames('outputs-back',()=>button('返回对话').click());
  await home();
  await frames('drawer-open',()=>button('打开导航').click());
  await frames('drawer-close',()=>button('关闭导航').click());
  await report();
  await frames('queue-enter',()=>projectQueue(2));
  await frames('queue-exit',()=>projectQueue(0));
  await home();
  await frames('long-press-menu',async()=>{await conversation('整理项目进展').dispatchEvent('pointerdown');await page.waitForTimeout(520);await page.getByRole('dialog',{name:'对话操作',exact:true}).waitFor()});
  await page.getByRole('dialog',{name:'对话操作',exact:true}).getByRole('button',{name:'取消',exact:true}).click();
  await frames('approval-enter',async()=>{await conversation('整理临时文件').click();await button('允许一次').waitFor()});
  await frames('approval-resolve',()=>page.evaluate(()=>{const card=document.querySelector('.conversation-approval');const context=approvalContext();const cache=toolApprovals.sessions.get(context.sessionId);fillApprovalCard(card,{...[...cache.rows.values()][0],status:'answered',decisionOutcome:'allowed-once'},context,cache)}));
  await page.evaluate(()=>{page('chat');state.sharedRunning=false;updateComposer()});
  await frames('send-stop',()=>page.evaluate(()=>{state.sharedRunning=true;updateComposer()}));
  await frames('stop-send',()=>page.evaluate(()=>{state.sharedRunning=false;updateComposer()}));
 }
 phase='after';await preference(false);await report();
 await measure('execution-expand-collapse',async()=>{await page.getByText(/执行了 1 步/).click();await page.waitForTimeout(250);await page.getByText(/执行了 1 步/).click()});
 await measure('outputs-push-back',async()=>{await button('输出与来源').click();await button(/^notes.md 1 次使用$/).waitFor();await page.waitForTimeout(250);await button('返回对话').click()});
 await home();
 await measure('drawer-open-close',async()=>{await button('打开导航').click();await page.waitForTimeout(250);await button('关闭导航').click()});
 await report();
 await page.getByRole('textbox',{name:'输入消息',exact:true}).fill('动效期间保留的合成草稿');
 const beforeScroll=await page.evaluate(()=>({top:$('chat-scroll').scrollTop,height:$('chat-scroll').scrollHeight}));
 await button('输出与来源').click();await settle();await button('返回对话').click();await settle();
 assert.deepEqual(await page.evaluate(()=>({top:$('chat-scroll').scrollTop,height:$('chat-scroll').scrollHeight})),beforeScroll);assert.equal(await page.getByRole('textbox',{name:'输入消息',exact:true}).inputValue(),'动效期间保留的合成草稿');checks.push('resource return preserves scroll, extent and draft');
 await page.evaluate(()=>{WeftMobileMotion.reveal($('chat-content'));});await preference(true);await page.waitForTimeout(30);assert.equal(await page.evaluate(()=>document.getAnimations().length),0);assert.equal(await page.locator('.motion-copy').count(),0);checks.push('live preference cancels animations and removes copies');await preference(false);
 await settle();await page.evaluate(()=>{$('motion-step-fixture')?.remove()});await projectSteps(21);await settle();
 await page.evaluate(()=>{window.__motionCapture=true;window.__motionFrames=[]});await projectSteps(22);assert.equal(await page.evaluate(()=>window.__motionFrames.length),0);checks.push('21+ steps skip item animations');
 await page.evaluate(()=>window.__motionFrames=[]);await projectQueue(21);assert.equal(await page.evaluate(()=>window.__motionFrames.length),0);checks.push('21+ queue cards skip item animations');await page.evaluate(()=>window.__motionCapture=false);
 assert.deepEqual(errors,[]);
 if(capture)await writeFile(join(evidence,`${surface}-verification.json`),JSON.stringify({baseline,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),synthetic:true,modelRequests:0,viewport:await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})),results,performanceResults,checks,errors},null,2)+'\n');
 console.log(JSON.stringify({surface,scenarios:results.length,checks,performanceResults:performanceResults.map(r=>({name:r.name,longTasks:r.longTasks.length,maxFrameGap:Math.max(...r.frameGapsMs)}))}));
}catch(error){console.log('motion failure',error.message,'motion errors',errors);console.log(instrumentLog);if(page)try{console.log(await page.evaluate(()=>({url:location.pathname,booted:typeof state==='undefined'?null:state.booted,page:typeof state==='undefined'?null:state.page,title:document.querySelector('#login-view')?.innerText,status:document.querySelector('#toast')?.innerText})));}catch{}throw error;}finally{
 if(device){for(const [key,value] of Object.entries(savedScales)){if(value==='null')adbRun('shell','settings','delete','global',key);else adbRun('shell','settings','put','global',key,value)}
  if(installed){try{adbRun('shell','run-as',packageName,'touch','files/ui-p1m-probe.done');await sleep(700)}catch{}}
 }
 await browser?.close();if(server){server.closeAllConnections();await new Promise(done=>server.close(done))}
 if(device){if(server)adbRun('reverse','--remove',`tcp:${assetPort}`);instrument?.kill();if(debugPort)adbRun('forward','--remove',`tcp:${debugPort}`);if(probeInstalled)adbRun('uninstall',`${packageName}.test`);if(installed)adbRun('uninstall',packageName)}
 await fixture.close();await rm(fixture.root,{recursive:true,force:true});
}
