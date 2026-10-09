/** Real HybridActivity, isolated APK and account; no simulated bridge calls. */
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {startTimelineCandidate} from './timeline-ui-candidate.mjs';
import {harness} from './ia-2b-harness.mjs';
const root=resolve(import.meta.dirname,'../..'),out=join(root,'tests/evidence/ia-4');await mkdir(out,{recursive:true});
const adb='D:/Software/MuMuPlayer/nx_main/adb.exe',serial='127.0.0.1:7555',pkg='com.memoweft.weftmate.mobile.ia4qa';
const run=(...args)=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',windowsHide:true});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function nativeNode(pattern){try{run('shell','uiautomator','dump','/sdcard/ia4-picker.xml');}catch(error){if(!/dumped to/.test(error.stdout||''))throw error;}const xml=run('shell','cat','/sdcard/ia4-picker.xml');const nodes=xml.match(/<node\b[^>]*>/g)||[];const node=nodes.find(row=>pattern.test(row));if(!node)return false;const bounds=/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node);assert.ok(bounds);run('shell','input','tap',String(Math.round((+bounds[1]+ +bounds[3])/2)),String(Math.round((+bounds[2]+ +bounds[4])/2)));return true;}
async function until(fn){for(let i=0;i<150;i++){const value=await fn();if(value)return value;await delay(200);}throw Error('Android condition timeout');}
const f=await startTimelineCandidate({daily:true,sidebar:true,interactive:true,inlineProgress:true,historyCount:0});
const main=(await f.request('/chats/main')).chat,host=(await f.request('/status')).hostId;
let browser,webBrowser,instrumentation,debugPort,installed=false,reversed=false,log='',previousIme,previousFont,realHost,realPort;
const errors=[],report={realAndroid:true,synthetic:true,packageName:pkg,checks:[]};
try{
  const running=run('shell','ps','-A').split('\n').filter(row=>row.includes('weftmate'));assert.deepEqual(running,[],'MuMu belongs to another running work package');
  assert.ok(!run('shell','pm','list','packages').includes(`package:${pkg}`));
  run('install',join(root,'apps/android/app/build/outputs/apk/debug/app-debug.apk'));installed=true;
  run('install',join(root,'apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'));
  run('reverse',`tcp:${new URL(f.origin).port}`,`tcp:${new URL(f.origin).port}`);
  reversed=true;
  instrumentation=spawn(adb,['-s',serial,'shell','am','instrument','-w','-e','class','com.memoweft.weftmate.mobile.Ia4WebViewProbeTest','-e','ia4Probe','1',`${pkg}.test/androidx.test.runner.AndroidJUnitRunner`],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  instrumentation.stdout.on('data',v=>{log+=v});instrumentation.stderr.on('data',v=>{log+=v});
  const pid=await until(()=>{try{return run('shell','pidof',pkg).trim();}catch{return false;}});
  const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));debugPort=reservation.address().port;await new Promise(r=>reservation.close(r));
  run('forward',`tcp:${debugPort}`,`localabstract:webview_devtools_remote_${pid}`);
  await until(async()=>{try{return (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).some(row=>row.url.includes('appassets'));}catch{return false;}});
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`,{noDefaults:true});const page=browser.contexts()[0].pages().find(row=>row.url().includes('appassets'));assert.ok(page);page.setDefaultTimeout(30000);page.on('pageerror',error=>{errors.push(error.message);console.log(error.stack)});
  await page.waitForFunction(()=>typeof call==='function'&&window.weftNative?.onmessage);
  await page.getByRole('heading',{name:'登录 WeftMate',exact:true}).waitFor();
  await page.waitForFunction(()=>state.booted&&!state.transitionPending);
  page.on('console',message=>{if(message.type()==='error')console.log('native console',message.text());});
  await page.evaluate(()=>{const render=mobileEffects.renderMainChat;mobileEffects.renderMainChat=()=>{try{return render();}catch(error){console.error('render error',error.stack);throw error;}};const read=uiCore.readChatEvents;uiCore.readChatEvents=async(...args)=>{try{return await read(...args);}catch(error){console.error('history read error',JSON.stringify(error));throw error;}};});
  await page.evaluate(async values=>{await call('auth.login',values);const me=await call('auth.me');WeftMobileCloud.core.acceptSession(await (await androidBridge.fetch('/personal/v1/auth/me')).json());state.loggedIn=true;state.owner=me.owner;state.username=me.username;state.deviceId=me.deviceId||me.device?.id||'';state.authEpoch++;document.body.classList.remove('cloud-auth-active');$('cloud-auth-page').classList.remove('active');uiCore.syncMobileIdentity();await listSharedSessions();await uiCore.selectMainChat();},{origin:f.origin,...f.credentials,deviceName:'IA-4 合成安卓'});
  const cmd=async body=>{let row=(await f.request('/commands',{requestId:randomUUID(),targetDeviceId:host,...body})).command;return until(async()=>{row=(await f.request(`/commands/${row.commandId}`)).command;assert.notEqual(row.state,'rejected',JSON.stringify(row));return row.state==='accepted_by_dsh'&&row;});};
  const first=await cmd({kind:'chat.message',chatId:main.chatId,modelProfileId:'local',text:'合成安卓首句'});f.seedMainHistory(first.sessionId,10000,{mixed:true});
  for(const [state,reason]of [['completed','completed'],['failed','error'],['stopped','aborted']]){
    const side=await cmd({kind:'session.side.create',parent:{kind:'main',id:main.chatId},modelProfileId:'local',title:`合成安卓结果 ${state}`});const task=await cmd({kind:'session.message',sessionId:side.sessionId,text:`合成任务 ${state}`});f.progress.text(`合成安卓摘要 ${state}`);f.progress.finish(reason);
    const history=await f.request(`/chats/${side.chatId}/events?limit=50`),event=history.items.findLast(row=>row.type==='assistant.message'),current=(await f.request(`/chats/${side.chatId}`)).chat;await f.request(`/chats/${side.chatId}/results`,{requestId:randomUUID(),sourceEventId:event.eventId,expectedRevision:current.revision,taskId:task.commandId});
  }
  await page.evaluate(()=>uiCore.selectMainChat());console.log('native state',await page.evaluate(()=>({logical:state.logicalChats,page:state.page,main:uiCore.state.mainChat,events:uiCore.state.chatWindow.events.size,notice:document.querySelector('.main-chat-notice')?.textContent,csrf:!!uiCore.state.csrfToken})));await page.screenshot({path:join(out,'android-start-diagnostic.png')});await page.getByRole('group',{name:/^(我的消息|助手消息)：/}).first().waitFor();
  const b=name=>page.getByRole('button',{name,exact:true}),shot=async name=>{await page.screenshot({path:join(out,`android-${name}.png`)});};
  await until(async()=>{const data=await f.request(`/chats/${main.chatId}/search?q=${encodeURIComponent('纸船')}`);return data.indexState==='ready';});
  for(const theme of ['light','dark']){
    await page.evaluate(theme=>applyTheme(theme),theme);await shot(`${theme}-recent`);
    for(const label of ['成功','失败','停止'])await page.getByRole('button',{name:new RegExp(`^打开旁聊结果：${label}`)}).waitFor();
    await page.getByRole('button',{name:/^打开旁聊结果：停止/}).click();await page.getByRole('banner').getByText('合成安卓结果 stopped',{exact:true}).waitFor();await page.getByText('合成安卓摘要 stopped',{exact:true}).waitFor();await b('打开导航').click();await b('WeftMate 主对话').click();
    await b('搜索主对话').click();await page.getByRole('searchbox',{name:'主对话搜索关键词'}).fill('纸船');await b('查找').click();await delay(1000);console.log('search state',await page.evaluate(()=>({search:uiCore.state.chatWindow.search,index:uiCore.state.chatWindow.indexState,notice:document.querySelector('.main-chat-notice')?.textContent,toast:$('toast').textContent,owner:state.owner})));await shot(`${theme}-search-diagnostic`);await page.locator('mark').first().waitFor();await b('下一条搜索结果').click();await b('上一条搜索结果').click();await shot(`${theme}-search`);await b('关闭主对话搜索').click();
    await b('跳到日期').click();await writeFile(join(out,`android-${theme}-native-date-picker.png`),execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{windowsHide:true,maxBuffer:12*1024*1024}));await nativeNode(/text="(?:取消|Cancel)"[^>]*package="android"/);
    const date=new Date(Date.now()-6*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'}),label=`${Number(date.slice(5,7))} 月 ${Number(date.slice(8))} 日`;
    await page.getByRole('textbox',{name:'跳到日期',exact:true}).fill(date);await delay(300);console.log('native date',await page.evaluate(()=>({value:document.querySelector('.main-chat-tools input').value,selected:uiCore.state.selectedChatId,dates:uiCore.mainChatDays().map(row=>({label:row.label,collapsed:row.collapsed})),notice:document.querySelector('.main-chat-notice')?.textContent})));await b(`${label}，收起`).click();await page.getByRole('button',{name:new RegExp(`^${label} · \\d+ 条，展开$`)}).click();await shot(`${theme}-expanded`);
    const name=await page.evaluate(()=>{const box=$('chat-scroll').getBoundingClientRect();return [...document.querySelectorAll('[role=group][aria-label]')].find(row=>{const r=row.getBoundingClientRect();return r.top>=box.top&&r.bottom<=box.bottom;})?.getAttribute('aria-label');});
    assert.ok(name);const row=page.getByRole('group',{name,exact:true});
    if(theme==='light'){const box=await row.boundingBox(),dpr=await page.evaluate(()=>devicePixelRatio);assert.ok(box);const x=String(Math.round((box.x+box.width/2)*dpr)),y=String(Math.round((box.y+box.height/2+24)*dpr));run('shell','input','swipe',x,y,x,y,'700');}
    else{await row.click();await row.getByLabel('消息菜单',{exact:true}).click();}
    await row.getByRole('button',{name:'从这里开旁聊',exact:true}).click();
    await page.getByRole('textbox',{name:'旁聊名称'}).fill('合成安卓旁聊');await b('确认开旁聊').click();await page.getByRole('dialog',{name:'开旁聊',exact:true}).waitFor({state:'hidden'});await page.getByText('相关上下文尚未带入',{exact:true}).waitFor();await shot(`${theme}-origin`);await b('回到主对话原消息').click();
    console.log('native navigation',await page.evaluate(()=>({body:document.body.className,topbar:getComputedStyle(document.querySelector('.topbar')).display,menuHidden:$('menu-button').hidden,page:state.page,logical:state.logicalChats,transition:state.transitionPending})));
    await b('打开导航').click();await b('WeftMate 主对话').click();
  }
  report.checks.push('real-native-status-main','native-calendar','search-navigation','fold-expand','side-create-source-return','themes');
  if(process.argv.includes('--performance')){
    console.log('native 60-second scroll sample');await cmd({kind:'chat.message',chatId:main.chatId,modelProfileId:'local',text:'合成安卓万条流式滚动'});
    await page.evaluate(async()=>{await uiCore.selectMainChat();for(let n=0;n<5;n++)await uiCore.loadOlderLogicalHistory();for(const day of uiCore.mainChatDays())uiCore.expandChatDay(day.date);mobileEffects.scrollToLatest();});
    let active=true,streamed=0;const stream=setInterval(()=>f.progress.text(`合成安卓流式更新 ${++streamed}`),800);
    const swipes=(async()=>{while(active){run('shell','input','swipe','360','850','360','350','180');await delay(650);}})();
    try{report.performance=await page.evaluate(async()=>{const frames=[],longTasks=[];let last=performance.now(),rows=0;const start=last;
      const observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(row=>row.duration)));observer.observe({type:'longtask'});
      await new Promise(done=>{function tick(now){frames.push(now-last);last=now;rows=Math.max(rows,document.querySelectorAll('.main-chat-row').length);if(now-start<60000)requestAnimationFrame(tick);else done();}requestAnimationFrame(tick);});observer.disconnect();frames.sort((a,b)=>a-b);return {durationMs:performance.now()-start,frames:frames.length,p95Ms:frames[Math.ceil(frames.length*.95)-1],maxMs:Math.max(...frames),maxRows:rows,longTasks,cacheEvents:uiCore.state.chatWindow.events.size,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio}};});}
    finally{active=false;clearInterval(stream);await swipes;f.progress.finish('completed');}
    report.performance.streamedUpdates=streamed;report.performance.appPssKiB=Number(/TOTAL PSS:\s*(\d+)/.exec(run('shell','dumpsys','meminfo',pkg))?.[1]||0);
    const cdp=await page.context().newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');report.performance.heapBytes=(await cdp.send('Runtime.getHeapUsage')).usedSize;
    await writeFile(join(out,'android-performance.json'),JSON.stringify(report.performance,null,2)+'\n');
    await page.evaluate(()=>uiCore.selectMainChat());
  }
  const beforeSendIds=new Set((await f.request('/commands?limit=50')).commands.map(row=>row.commandId));
  await page.getByRole('textbox',{name:'输入消息',exact:true}).fill('合成安卓立即发送');await b('发送').click();
  await until(async()=>{const rows=(await f.request('/commands?limit=50')).commands;return rows.find(row=>row.kind==='chat.message'&&row.state==='accepted_by_dsh'&&!beforeSendIds.has(row.commandId));});
  f.progress.call('read','ia4-read',{paths:['synthetic.md']});f.progress.result('ia4-read','synthetic contents');
  const approval=await f.progress.approve('ia4-approve','echo synthetic');await page.evaluate(()=>uiCore.refreshLogicalHistory());await b('批准').waitFor();await shot('approval');await b('批准').click();
  f.progress.ask([{id:'format',question:'合成提问：采用哪种格式？',options:[{label:'简要报告'},{label:'完整记录'}]}]);await page.evaluate(()=>uiCore.refreshLogicalHistory());
  await page.getByRole('region',{name:'待回答问题',exact:true}).waitFor();await page.getByRole('radio',{name:'简要报告',exact:true}).click();await shot('question');await b('提交回答').click();await page.getByRole('region',{name:'待回答问题',exact:true}).waitFor({state:'hidden'});
  await page.getByRole('textbox',{name:'输入消息',exact:true}).fill('');await b('停止回复').waitFor();await b('停止回复').click();await shot('stopped');
  report.checks.push('native-chat-message','immediate-optimistic','progress-approval-original-identity','question-original-identity','native-stop','native-long-press-side-menu');
  previousIme=run('shell','settings','get','secure','default_input_method').trim();previousFont=run('shell','settings','get','system','font_scale').trim();
  const ime=`${pkg}.test/com.memoweft.weftmate.mobile.Ui2vTestIme`;run('shell','ime','enable',ime);run('shell','ime','set',ime);
  await page.getByRole('textbox',{name:'输入消息',exact:true}).click();await delay(1000);
  report.keyboard={shown:/mInputShown=true|mIsInputViewShown=true|isInputViewShown=true/.test(run('shell','dumpsys','input_method')),geometry:await page.evaluate(()=>({height:innerHeight,visual:visualViewport.height,draft:$('draft').getBoundingClientRect().toJSON(),dock:$('composer-dock').getBoundingClientRect().toJSON()}))};
  await writeFile(join(out,'android-keyboard.png'),execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{windowsHide:true,maxBuffer:12*1024*1024}));assert.ok(report.keyboard.shown);assert.ok(report.keyboard.geometry.dock.bottom<=report.keyboard.geometry.visual+1);run('shell','input','keyevent','4');
  run('shell','settings','put','system','font_scale','1.3');await delay(500);await shot('font130');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  report.checks.push('native-soft-keyboard-visible-composer','font130');assert.deepEqual(errors,[]);
  if(process.argv.includes('--mimo')){
    console.log('starting isolated native MiMo');realHost=await harness('ia4-android',{memory:false,mainChat:true});
    const origin=new URL(realHost.page.url()).origin;realPort=new URL(origin).port;run('reverse',`tcp:${realPort}`,`tcp:${realPort}`);
    await page.evaluate(async values=>{await call('auth.login',values);}, {origin,...realHost.credentials,deviceName:'IA-4 合成安卓 MiMo'});
    await page.waitForFunction(()=>!state.transitionPending);
    await page.evaluate(async()=>{const me=await call('auth.me');WeftMobileCloud.core.acceptSession(await (await androidBridge.fetch('/personal/v1/auth/me')).json());state.loggedIn=true;state.owner=me.owner;state.username=me.username;state.deviceId=me.deviceId||me.device?.id||'';state.authEpoch++;document.body.classList.remove('cloud-auth-active');$('cloud-auth-page').classList.remove('active');uiCore.syncMobileIdentity();await listSharedSessions();await uiCore.selectMainChat();});
    const draft=page.getByRole('textbox',{name:'输入消息',exact:true});
    await page.getByRole('button',{name:'当前模型',exact:true}).click();await page.getByRole('option',{name:'ia2b-mimo',exact:true}).click();
    await draft.fill('请只回复合成编号 IA4-NATIVE-OK，不要调用工具。');await b('发送').click();
    let sent=await until(async()=>{const rows=(await realHost.api('/commands?limit=20')).body.commands;return rows.find(row=>row.kind==='chat.message'&&row.state==='accepted_by_dsh');});await realHost.complete(sent);await page.evaluate(()=>uiCore.refreshLogicalHistory());await page.getByText('IA4-NATIVE-OK',{exact:true}).waitFor();await shot('real-mimo-text');
    const file=join(realHost.base,'weftmate-ia4-synthetic-note.txt');await writeFile(file,'Synthetic attachment code: PAPER-IA4-26. Only test data.');run('push',file,'/sdcard/Download/weftmate-ia4-synthetic-note.txt');
    await b('添加图片或文件').click();await page.getByRole('menuitem',{name:/^文件/}).click();
    if(!await nativeNode(/text="weftmate-ia4-synthetic-note.txt"/)){await nativeNode(/content-desc="(?:显示根目录|Show roots|打开导航抽屉)"/);await nativeNode(/text="(?:下载|Downloads)"/);assert.ok(await nativeNode(/text="weftmate-ia4-synthetic-note.txt"/));}
    await page.getByRole('button',{name:'移除附件 weftmate-ia4-synthetic-note.txt',exact:true}).waitFor();
    await draft.fill('只读附件并回复里面的合成编号，不要调用工具。');await b('发送').click();
    const attached=await until(async()=>{const rows=(await realHost.api('/commands?limit=20')).body.commands;return rows.find(row=>row.kind==='chat.message'&&row.state==='accepted_by_dsh'&&row.commandId!==sent.commandId);});await realHost.complete(attached);
    await page.evaluate(()=>uiCore.refreshLogicalHistory());await page.getByText(/PAPER-IA4-26/).waitFor();await shot('real-mimo-attachment');
    assert.equal(await page.getByRole('button',{name:'移除附件 weftmate-ia4-synthetic-note.txt',exact:true}).count(),0);
    webBrowser=await chromium.launch({headless:true,channel:'chrome'});const webPage=await webBrowser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});webPage.setDefaultTimeout(30000);
    await webPage.route('**/bridge.js',route=>route.fulfill({contentType:'text/javascript',body:'// Production browser transport.'}));
    await webPage.route('**/personal/v1/**',async route=>{const u=new URL(route.request().url()),response=await route.fetch({url:origin+u.pathname+u.search,headers:{...route.request().headers(),origin}});await route.fulfill({response});});
    const login=await webPage.request.post(origin+'/personal/v1/auth/login',{data:{...realHost.credentials,deviceName:'IA-4 合成手机网页'},headers:{origin}}),identity=await login.json();assert.equal(login.status(),200);
    await webPage.goto(f.mobileUrl);await webPage.waitForFunction(()=>state.booted);
    await webPage.evaluate(async identity=>{state.loggedIn=true;state.owner=identity.account.ownerId;state.username=identity.account.username;state.deviceId=identity.device.id;state.authEpoch++;document.body.classList.remove('cloud-auth-active');$('cloud-auth-page').classList.remove('active');uiCore.syncMobileIdentity();await listSharedSessions();await uiCore.selectMainChat();},identity);
    const webDraft=webPage.getByRole('textbox',{name:'输入消息',exact:true});await webDraft.fill('请只回复合成编号 IA4-WEB-OK，不要调用工具。');await webPage.getByRole('button',{name:'发送',exact:true}).click();
    const webSent=await until(async()=>{const rows=(await realHost.api('/commands?limit=30')).body.commands;return rows.find(row=>row.kind==='chat.message'&&row.state==='accepted_by_dsh'&&![sent.commandId,attached.commandId].includes(row.commandId));});await realHost.complete(webSent);await webPage.evaluate(()=>uiCore.refreshLogicalHistory());await webPage.getByText('IA4-WEB-OK',{exact:true}).waitFor();await webPage.screenshot({path:join(out,'web-real-mimo-text.png')});
    await webPage.getByRole('button',{name:'添加图片或文件',exact:true}).click();const chooser=webPage.waitForEvent('filechooser');await webPage.getByRole('menuitem',{name:/^文件/}).click();await (await chooser).setFiles(file);
    await webPage.getByRole('button',{name:'移除附件 weftmate-ia4-synthetic-note.txt',exact:true}).waitFor();await webDraft.fill('只读附件并回复其中的合成编号，不要调用工具。');await webPage.getByRole('button',{name:'发送',exact:true}).click();
    const webAttached=await until(async()=>{const rows=(await realHost.api('/commands?limit=30')).body.commands;return rows.find(row=>row.kind==='chat.message'&&row.state==='accepted_by_dsh'&&![sent.commandId,attached.commandId,webSent.commandId].includes(row.commandId));});await realHost.complete(webAttached);await webPage.evaluate(()=>uiCore.refreshLogicalHistory());await webPage.getByText(/PAPER-IA4-26/).last().waitFor();await webPage.screenshot({path:join(out,'web-real-mimo-attachment.png')});
    await webBrowser.close();webBrowser=null;await realHost.close();report.realMimo={model:'mimo-v2.6-flash',usage:await realHost.usage(),commands:[sent,attached,webSent,webAttached].map(row=>({kind:row.kind,chatId:row.chatId,sessionId:row.sessionId,requestId:row.requestId,receiptId:row.receiptId}))};report.checks.push('real-MiMo-native-text','real-MiMo-native-logical-staging-attachment','real-MiMo-web-text','real-MiMo-web-logical-staging-attachment','original-request-receipt');
  }
  await writeFile(join(out,process.argv.includes('--mimo')?'android-full-verification.json':'android-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{
  if(previousIme)run('shell','ime','set',previousIme);if(previousFont)run('shell','settings','put','system','font_scale',previousFont);
  if(realPort){try{run('reverse','--remove',`tcp:${realPort}`);run('shell','rm','-f','/sdcard/Download/weftmate-ia4-synthetic-note.txt','/sdcard/ia4-picker.xml');}catch{}}
  if(realHost){await realHost.close();await writeFile(join(out,'native-mimo-usage.json'),JSON.stringify(await realHost.usage().catch(()=>[]),null,2)+'\n');}
  if(instrumentation){try{run('shell','run-as',pkg,'touch','files/ia4-probe.done');await until(()=>instrumentation.exitCode!==null);}catch{instrumentation.kill();}}
  await webBrowser?.close();await browser?.close();if(debugPort)run('forward','--remove',`tcp:${debugPort}`);if(reversed)run('reverse','--remove',`tcp:${new URL(f.origin).port}`);
  if(installed){run('uninstall',`${pkg}.test`);run('uninstall',pkg);}await f.close();
  await writeFile(join(out,'android-probe.txt'),log);
}
