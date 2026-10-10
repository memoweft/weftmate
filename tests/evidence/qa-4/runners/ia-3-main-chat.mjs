/** Production desktop window; isolated real personal API and synthetic native history. */
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir, cpus, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { startTimelineCandidate } from '../../../../tests/integration/timeline-ui-candidate.mjs';
import { localUiSession } from '../../../../tests/helpers/local-ui-session.mjs';
const root=resolve(import.meta.dirname,'../../../..'), evidence=join(root,'tests/evidence/qa-4/main-chat');
await mkdir(evidence,{recursive:true});
const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
let fixture,memoryFixture,application,browser,profile;const errors=[],report={synthetic:true,realElectron:true,historyMessages:10000,segments:3,checks:[],performance:{},modelRequests:0};
const button=(page,name)=>page.getByRole('button',{name,exact:true});
const pause=ms=>new Promise(done=>setTimeout(done,ms));
const percentile=(values,p=.95)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
try{
  fixture=await startTimelineCandidate({daily:true,sidebar:true,interactive:true,inlineProgress:true,historyCount:0,baseTime:Date.now()-15000});
  const hostId=(await fixture.request('/status')).hostId;
  async function command(body){let row=(await fixture.request('/commands',{requestId:randomUUID(),targetDeviceId:hostId,...body})).command;
    for(let n=0;n<150;n++){if(row.state==='accepted_by_dsh')return row;assert.notEqual(row.state,'rejected',JSON.stringify(row));await pause(20);row=(await fixture.request(`/commands/${row.commandId}`)).command;}throw Error('command timeout');}
  const main=(await fixture.request('/chats/main')).chat;
  const first=await command({kind:'chat.message',chatId:main.chatId,modelProfileId:'local',text:'合成主对话首句'});
  fixture.seedMainHistory(first.sessionId,3500,{offset:0,total:10000,mixed:true});fixture.relayNextMain();
  const second=await command({kind:'chat.message',chatId:main.chatId,modelProfileId:'local',text:'合成第二段'});
  fixture.seedMainHistory(second.sessionId,3500,{offset:3500,total:10000,mixed:true});fixture.relayNextMain();
  const third=await command({kind:'chat.message',chatId:main.chatId,modelProfileId:'local',text:'合成第三段'});
  fixture.seedMainHistory(third.sessionId,3000,{offset:7000,total:10000,mixed:true});
  for(const [state,reason] of [['completed','completed'],['failed','error'],['stopped','aborted']]) {
    const side=await command({kind:'session.side.create',parent:{kind:'main',id:main.chatId},modelProfileId:'local',title:`合成结果：${state}`});
    const task=await command({kind:'session.message',sessionId:side.sessionId,text:`合成旁聊任务 ${state}`});
    fixture.progress.call('pwsh',`result-${state}`,{command:'echo synthetic'});fixture.progress.result(`result-${state}`,'Synthetic result');fixture.progress.text(`合成旁聊 ${state}：纸船核对结果。`);fixture.progress.finish(reason);
    const history=await fixture.request(`/chats/${side.chatId}/events?limit=50`),source=history.items.findLast(event=>event.type==='assistant.message');
    const current=(await fixture.request(`/chats/${side.chatId}`)).chat;
    const shared=await fixture.request(`/chats/${side.chatId}/results`,{requestId:randomUUID(),sourceEventId:source.eventId,expectedRevision:current.revision,taskId:task.commandId});
    assert.equal(shared.result.state,state);
  }
  await fixture.request(`/sessions/${fixture.sessionId}/metadata`,{title:'合成旁聊：项目安排'},'PATCH');
  profile=await mkdtemp(join(tmpdir(),'weftmate-ia3-electron-'));
  application=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:root,args:['scripts/review-gallery/electron.mjs','--force-device-scale-factor=1','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:fixture.origin,REVIEW_THEME:'light',TZ:'Asia/Shanghai'}});
  const page=await application.firstWindow();page.setDefaultTimeout(25000);page.on('pageerror',error=>{if(errors.length<5)console.log(error.stack);errors.push(error.message)});
  page.on('response',async response=>{if(response.url().endsWith('/personal/v1/commands'))console.log('command response',response.status(),JSON.stringify(await response.json()).slice(0,200));});
  const coldStart=performance.now();await localUiSession(page,fixture.credentials,'Synthetic IA-3',{mainChat:true});
  await button(page,'WeftMate 主对话').waitFor();
  await page.locator('#message-text').waitFor();
  await page.waitForFunction(()=>document.querySelector('#transcript .main-chat-row'));
  report.performance.coldUiOpenMs=performance.now()-coldStart;
  const shot=async(name)=>{await page.screenshot({path:join(evidence,name+'.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);};
  await shot('desktop-light-recent');
  await page.getByRole('button',{name:/打开旁聊结果：成功/}).waitFor();await page.getByRole('button',{name:/打开旁聊结果：失败/}).waitFor();await page.getByRole('button',{name:/打开旁聊结果：停止/}).waitFor();
  await page.getByRole('button',{name:/打开旁聊结果：停止/}).click();await page.waitForFunction(()=>document.querySelector('#assistant-title').textContent.startsWith('合成结果：stopped'));await button(page,'WeftMate 主对话').click();
  report.checks.push('result-success-failure-stopped','result-opens-source-side');
  console.log('main loaded',await page.locator('#assistant-title').innerText());
  // Index completion is separate from input readiness and cold opening.
  for(let n=0;n<100;n++){const data=await fixture.request(`/chats/${main.chatId}/search?q=${encodeURIComponent('纸船')}`);if(data.indexState==='ready')break;await pause(50);}
  const searches=[],dates=[];
  for(let n=0;n<30;n++) {let start=performance.now();await fixture.request(`/chats/${main.chatId}/search?q=${encodeURIComponent('纸船')}`);searches.push(performance.now()-start);
    start=performance.now();await fixture.request(`/chats/${main.chatId}/locate?date=${new Date(Date.now()-6*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'})}`);dates.push(performance.now()-start);}
  report.performance.searchHttp={samples:searches,p95Ms:percentile(searches),budgetMs:500};report.performance.dateHttp={samples:dates,p95Ms:percentile(dates),budgetMs:300};
  await button(page,'搜索主对话').click();await page.getByRole('searchbox',{name:'主对话搜索关键词'}).fill('纸船');await button(page,'查找').click();
  await page.waitForFunction(()=>document.querySelector('#transcript mark'));await shot('desktop-light-search');
  await button(page,'下一条搜索结果').click();await button(page,'上一条搜索结果').click();
  await button(page,'关闭主对话搜索').click();
  await button(page,'搜索主对话').click();await page.getByRole('searchbox',{name:'主对话搜索关键词'}).fill('合成旁聊');await button(page,'查找').click();
  await page.waitForFunction(()=>{const box=document.querySelector('#chat-scroll').getBoundingClientRect();return [...document.querySelectorAll('#transcript .side-result mark')].some(mark=>{const rect=mark.getBoundingClientRect();return rect.top>=box.top&&rect.bottom<=box.bottom;});});await shot('desktop-light-result-search');await button(page,'关闭主对话搜索').click();
  await button(page,'跳到日期').click();const date=new Date(Date.now()-6*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});
  await page.getByRole('textbox',{name:'跳到日期',exact:true}).fill(date);
  const dateLabel=`${Number(date.slice(5,7))} 月 ${Number(date.slice(8))} 日`;
  await button(page,`${dateLabel}，收起`).waitFor();await shot('desktop-light-date');
  await button(page,`${dateLabel}，收起`).click();await page.getByRole('button',{name:new RegExp(`^${dateLabel} · \\d+ 条，展开$`)}).waitFor();await shot('desktop-light-folded');
  await page.getByRole('button',{name:new RegExp(`^${dateLabel} · \\d+ 条，展开$`)}).click();
  const menu=page.getByLabel('消息菜单',{exact:true}).first();await menu.click();await button(page,'从这里开旁聊').first().click();
  await page.getByRole('textbox',{name:'旁聊名称'}).fill('合成旁聊：纸船核对');await page.getByRole('textbox',{name:'旁聊第一句话'}).fill('请核对纸船');
  await button(page,'确认开旁聊').click();await page.getByRole('dialog',{name:'开旁聊',exact:true}).waitFor({state:'hidden'});await page.getByText('相关上下文尚未带入',{exact:true}).waitFor();
  assert.equal(await page.locator('#message-text').inputValue(),'请核对纸船');await shot('desktop-light-side-origin');
  await button(page,'回到主对话原消息').click();await page.waitForFunction(()=>document.querySelector('#assistant-title').textContent==='WeftMate');
  report.checks.push('fixed-main','recent-tail','search-highlight-next-previous','date-locate','side-origin-reference-only','draft-transfer');
  // Two local cache tiers, 30 switches, no model/network latency injected.
  const timings=[];
  for(let n=0;n<30;n++){await button(page,/^合成旁聊：项目安排/).click();const start=performance.now();await button(page,'WeftMate 主对话').click();await page.waitForFunction(()=>document.querySelector('#assistant-title').textContent==='WeftMate'&&!document.querySelector('#message-text').disabled&&document.querySelector('#transcript .message'));timings.push(performance.now()-start);}
  report.performance.openMain={samples:timings,p95Ms:percentile(timings),budgetMs:1000};
  await page.evaluate(()=>{document.documentElement.dataset.theme='dark';WeftUiCore.createAppearance(localStorage).set({theme:'dark'});});await shot('desktop-dark-recent');
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(720,600));await shot('desktop-dark-narrow');
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1200,800));
  await command({kind:'chat.message',chatId:main.chatId,modelProfileId:'local',text:'合成流式混合测试'});
  fixture.progress.call('read','live-read',{paths:['synthetic.md']});fixture.progress.result('live-read','Synthetic contents');fixture.progress.text('合成流式回复：正在核对纸船。');
  await button(page,'WeftMate 主对话').click();
  const progress=page.getByRole('button',{name:/读取了 1 个文件.*已收起/}).first();if(await progress.count())await progress.click();
  const scrollMs=Number(process.env.IA3_SCROLL_MS||60000);
  let streamed=0;const stream=setInterval(()=>{fixture.progress.text(`合成流式更新 ${++streamed}：纸船核对仍在继续。`);},800);
  let metrics;
  try {
  metrics=await page.evaluate(async duration=>{
    const box=document.querySelector('#chat-scroll'),frames=[],blocks=[];let last=performance.now(),maxRows=0;
    const observer=new PerformanceObserver(list=>blocks.push(...list.getEntries().map(entry=>entry.duration)));observer.observe({entryTypes:['longtask']});
    const start=performance.now();await new Promise(done=>{function tick(now){frames.push(now-last);last=now;maxRows=Math.max(maxRows,document.querySelectorAll('#transcript [data-event-id]').length);
      const span=Math.max(1,box.scrollHeight-box.clientHeight);box.scrollTop=span*(1+(Math.sin((now-start)/1300)))/2;
      if(now-start<duration)requestAnimationFrame(tick);else done();}requestAnimationFrame(tick);});observer.disconnect();
    return {frames,blocks,maxRows,heapBytes:performance.memory?.usedJSHeapSize,scrollHeight:box.scrollHeight,durationMs:performance.now()-start};
  },scrollMs);
  } finally {clearInterval(stream);fixture.progress.finish('completed');}
  report.performance.scroll={durationMs:metrics.durationMs,sampleCount:metrics.frames.length,p95FrameMs:percentile(metrics.frames),maxFrameMs:Math.max(...metrics.frames),over20ms:metrics.frames.filter(n=>n>20).length,longTasks:metrics.blocks,maxMountedRows:metrics.maxRows,heapBytes:metrics.heapBytes,streamedMessages:streamed};
  assert.ok(metrics.maxRows<150,'mounted rows remain bounded');
  report.performance.machine={platform:process.platform,cpu:cpus()[0].model,totalMemoryMiB:totalmem()/1048576,viewport:'1200x800',pageLimit:200,network:'loopback, no artificial delay',fixture:'10000 native public messages across three segments and ten days, long code lines, lazy images and tool steps; synthetic backend, production API/desktop'};
  await button(page,'发送').waitFor();
  await page.locator('#message-text').fill('合成主对话发送验收');await button(page,'发送').click();
  await page.waitForFunction(()=>document.querySelector('#transcript').innerText.includes('合成主对话发送验收')&&document.querySelector('#message-text').value==='');await shot('desktop-dark-sent');
  assert.equal(fixture.operations.filter(operation=>operation.kind==='message'&&operation.text==='合成主对话发送验收').length,1);report.checks.push('main-send-once');
  let cdp=await page.context().newCDPSession(page);
  async function memorySample(){await cdp.send('HeapProfiler.collectGarbage');const heap=await cdp.send('Runtime.getHeapUsage');const renderer=await application.evaluate(({app,BrowserWindow})=>{const pid=BrowserWindow.getAllWindows()[0].webContents.getOSProcessId();return app.getAppMetrics().find(item=>item.pid===pid)?.memory;});return {heapBytes:heap.usedSize,renderer};}
  const tenThousand=await memorySample();
  memoryFixture=await startTimelineCandidate({daily:true,sidebar:true,interactive:true,inlineProgress:true,historyCount:0,baseTime:Date.now()-15000});
  const baselineMain=(await memoryFixture.request('/chats/main')).chat,baselineHost=(await memoryFixture.request('/status')).hostId;
  let baselineCommand=(await memoryFixture.request('/commands',{requestId:randomUUID(),kind:'chat.message',chatId:baselineMain.chatId,targetDeviceId:baselineHost,modelProfileId:'local',text:'合成内存基线'})).command;
  while(baselineCommand.state!=='accepted_by_dsh'){await pause(20);baselineCommand=(await memoryFixture.request(`/commands/${baselineCommand.commandId}`)).command;assert.notEqual(baselineCommand.state,'rejected');}
  memoryFixture.seedMainHistory(baselineCommand.sessionId,1000,{mixed:true});
  await application.close();
  application=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:root,args:['scripts/review-gallery/electron.mjs','--force-device-scale-factor=1'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:memoryFixture.origin,REVIEW_THEME:'dark',TZ:'Asia/Shanghai'}});
  const baselinePage=await application.firstWindow();await localUiSession(baselinePage,memoryFixture.credentials,'Synthetic memory baseline',{mainChat:true});await baselinePage.waitForFunction(()=>document.querySelector('#transcript .main-chat-row'));
  cdp=await baselinePage.context().newCDPSession(baselinePage);
  for(let n=0;n<30;n++){await button(baselinePage,/^项目进度报告/).click();await button(baselinePage,'WeftMate 主对话').click();await baselinePage.waitForFunction(()=>document.querySelector('#transcript .message'));}
  let baselineRun=(await memoryFixture.request('/commands',{requestId:randomUUID(),kind:'chat.message',chatId:baselineMain.chatId,targetDeviceId:baselineHost,modelProfileId:'local',text:'合成流式内存基线'})).command;
  while(baselineRun.state!=='accepted_by_dsh'){await pause(20);baselineRun=(await memoryFixture.request(`/commands/${baselineRun.commandId}`)).command;}
  memoryFixture.progress.call('read','baseline-live',{paths:['synthetic.md']});memoryFixture.progress.result('baseline-live','Synthetic contents');memoryFixture.progress.text('合成流式回复：正在核对纸船。');
  await button(baselinePage,'WeftMate 主对话').click();
  let baselineStreamed=0;const baselineStream=setInterval(()=>memoryFixture.progress.text(`合成流式更新 ${++baselineStreamed}：纸船核对仍在继续。`),800);
  try {await baselinePage.evaluate(async duration=>{const box=document.querySelector('#chat-scroll'),start=performance.now();await new Promise(done=>{function tick(now){box.scrollTop=Math.max(1,box.scrollHeight-box.clientHeight)*(1+Math.sin((now-start)/1300))/2;if(now-start<duration)requestAnimationFrame(tick);else done();}requestAnimationFrame(tick);});},scrollMs);}finally{clearInterval(baselineStream);memoryFixture.progress.finish('completed');}
  const thousand=await memorySample();report.performance.memory={thousand,tenThousand,heapDeltaMiB:(tenThousand.heapBytes-thousand.heapBytes)/1048576,rendererPrivateDeltaMiB:((tenThousand.renderer?.privateBytes||0)-(thousand.renderer?.privateBytes||0))/1024,budgetMiB:50,comparison:'separate renderer processes, identical shell/resources, 30 switches and equal-duration scroll/live updates, forced JS GC before each sample',imageResource:'same 1x1 PNG, lazy decode; decoder cache not separately observable in Electron metrics'};
  browser=await chromium.launch({headless:true,channel:'msedge'});const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Asia/Shanghai'});
  mobile.on('pageerror',error=>errors.push(error.message));await mobile.goto(fixture.origin+'/personal/v1/ui');await localUiSession(mobile,fixture.credentials,'Synthetic IA-3 mobile',{mainChat:true});
  await mobile.waitForFunction(()=>document.querySelector('#assistant-title').textContent==='WeftMate');await mobile.screenshot({path:join(evidence,'mobile-web-390x844.png')});assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);report.checks.push('mobile-web-390x844');
  assert.deepEqual(errors,[]);report.errors=errors;
  await writeFile(join(evidence,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){if(application){const page=await application.firstWindow();report.failureState=await page.evaluate(()=>({operation:document.querySelector('#operation-status')?.textContent,input:document.querySelector('#message-text')?.value,transcript:document.querySelector('#transcript')?.innerText.slice(-1000),sendAction:document.querySelector('#send-message')?.dataset.action}));await page.screenshot({path:join(evidence,'failure.png')});report.nativeOperations=fixture.operations.slice(-4);}await writeFile(join(evidence,'failure.json'),JSON.stringify({error:error.message,errors,report},null,2));throw error;}
finally{await browser?.close();await application?.close();await fixture?.close();await memoryFixture?.close();if(profile)await rm(profile,{recursive:true,force:true});if(fixture?.root)await rm(fixture.root,{recursive:true,force:true});if(memoryFixture?.root)await rm(memoryFixture.root,{recursive:true,force:true});}
