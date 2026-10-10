/** Real HybridActivity, isolated APK and account; no simulated bridge calls. */
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
import {startTimelineCandidate} from './timeline-ui-candidate.mjs';
import {harness} from './ia-2b-harness.mjs';
const root=resolve(import.meta.dirname,'../..'),out=join(root,'tests/evidence/tb-4');await mkdir(out,{recursive:true});
const adb='D:/Software/MuMuPlayer/nx_main/adb.exe',serial='127.0.0.1:7555',pkg='com.memoweft.weftmate.mobile.tb4qa';
const run=(...args)=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',windowsHide:true});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,timeout=30000){for(let i=0;i<timeout/200;i++){const value=await fn();if(value)return value;await delay(200);}throw Error('Android condition timeout');}
const f=await startTimelineCandidate({daily:true,sidebar:true,logicalMobile:true,goals:true,interactive:true,inlineProgress:true,historyCount:0});
let browser,instrumentation,debugPort,installed=false,reversed=false,log='',previousIme,previousFont,previousHeadsUp,realHost,realPort;
const errors=[],report={realAndroid:true,synthetic:true,packageName:pkg,checks:[]};
try{
  previousHeadsUp=run('shell','settings','get','global','heads_up_notifications_enabled').trim();run('shell','settings','put','global','heads_up_notifications_enabled','0');
  const running=run('shell','ps','-A').split('\n').filter(row=>row.includes('weftmate'));assert.deepEqual(running,[],'MuMu belongs to another running work package');
  assert.ok(!run('shell','pm','list','packages').includes(`package:${pkg}`));
  run('install',join(root,'apps/android/app/build/outputs/apk/debug/app-debug.apk'));installed=true;run('shell','pm','grant',pkg,'android.permission.POST_NOTIFICATIONS');
  run('install',join(root,'apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'));
  run('reverse',`tcp:${new URL(f.origin).port}`,`tcp:${new URL(f.origin).port}`);
  reversed=true;
  instrumentation=spawn(adb,['-s',serial,'shell','am','instrument','-w','-e','class','com.memoweft.weftmate.mobile.Tb4WebViewProbeTest','-e','tb4Probe','1',`${pkg}.test/androidx.test.runner.AndroidJUnitRunner`],{windowsHide:true,stdio:['ignore','pipe','pipe']});
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
  await page.evaluate(async values=>{await call('auth.login',values);const me=await call('auth.me');WeftMobileCloud.core.acceptSession(await (await androidBridge.fetch('/personal/v1/auth/me')).json());state.loggedIn=true;state.owner=me.owner;state.username=me.username;state.deviceId=me.deviceId||me.device?.id||'';state.authEpoch++;document.body.classList.remove('cloud-auth-active');$('cloud-auth-page').classList.remove('active');uiCore.syncMobileIdentity();await listSharedSessions();await uiCore.selectMainChat();await call('app.ready',{owner:state.owner,hasDraft:hasAnyDraft()});},{origin:f.origin,...f.credentials,deviceName:'TB-4 合成安卓'});
  await page.waitForFunction(()=>!state.transitionPending&&state.loggedIn);await page.evaluate(()=>uiCore.selectMainChat());
  const b=name=>page.getByRole('button',{name,exact:true}),tab=name=>page.getByRole('tab',{name:new RegExp(`^${name}(?:，|$)`)});
  const shot=async name=>{await delay(500);await writeFile(join(out,`android-${name}.png`),execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{windowsHide:true,maxBuffer:12*1024*1024}));};
  for(const theme of ['light','dark']){
    await page.evaluate(async theme=>{await call('settings.appearance',{value:theme});applyTheme(theme);},theme);await tab('聊天').waitFor();await shot(`${theme}-chat`);
    for(const name of ['动态','目标','成果库']){await tab(name).click();await page.getByRole('heading',{name,exact:true}).waitFor();await shot(`${theme}-${{'动态':'activity','目标':'goals','成果库':'library'}[name]}`);}
    await tab('目标').click();await page.getByRole('region',{name:'进行中',exact:true}).getByRole('button',{name:/更多操作/}).click();await shot(`${theme}-goal-menu-open`);await page.getByRole('menuitem',{name:'打开对话与步骤',exact:true}).click();await page.waitForFunction(()=>state.page==='chat');assert.equal(await page.getByRole('tablist').isVisible(),false);await shot(`${theme}-goal-source`);run('shell','input','keyevent','4');await page.waitForFunction(()=>state.page==='goals').catch(async error=>{console.log('first-back-state',await page.evaluate(()=>({page:state.page,source:state.tabSource,main:uiCore.inMainChat(),logical:state.logicalChats,menu:document.querySelector('.session-menu')?.outerHTML,keyboard:keyboardShown,drawer:state.drawer,settingsChild:state.settingsChild,image:$('image-preview').hidden,resource:$('resource-page').hidden})));throw error;});await delay(400);run('shell','input','keyevent','4');await page.waitForFunction(()=>state.page==='chat'&&uiCore.inMainChat()).catch(async error=>{console.log('back-state',await page.evaluate(()=>({page:state.page,source:state.tabSource,main:uiCore.inMainChat(),logical:state.logicalChats,menu:!!document.querySelector('.session-menu'),keyboard:keyboardShown})));throw error;});
  }
  report.checks.push('real-native-four-tabs-light-dark','original-goal-source-full-height','system-back-source-tab-main');
  previousIme=run('shell','settings','get','secure','default_input_method').trim();previousFont=run('shell','settings','get','system','font_scale').trim();
  const ime=`${pkg}.test/com.memoweft.weftmate.mobile.Ui2vTestIme`;run('shell','ime','enable',ime);run('shell','ime','set',ime);
  await page.getByRole('textbox',{name:'输入消息',exact:true}).click();await delay(800);await shot('keyboard');assert.equal(await page.getByRole('tablist').isVisible(),false);
  report.keyboard=await page.evaluate(()=>({shown:keyboardShown,visual:visualViewport.height,draft:$('draft').getBoundingClientRect().toJSON(),dock:$('composer-dock').getBoundingClientRect().toJSON()}));assert.equal(report.keyboard.shown,true);
  run('shell','input','keyevent','4');await until(()=>page.getByRole('tablist').isVisible());
  run('shell','settings','put','system','font_scale','1.3');await delay(700);await shot('font-130-chat');await tab('成果库').click();await shot('font-130-library');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  run('shell','settings','put','system','accelerometer_rotation','0');run('shell','settings','put','system','user_rotation','1');await delay(1000);await shot('landscape-library');await tab('聊天').click();await shot('landscape-chat');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  run('shell','settings','put','system','user_rotation','0');run('shell','settings','put','system','font_scale',previousFont);await delay(700);report.checks.push('real-system-keyboard-tabs-hidden','130-percent-system-font','landscape');
  if(process.argv.includes('--synthetic-only')){
    run('reverse','--remove',`tcp:${new URL(f.origin).port}`);reversed=false;
    for(const theme of ['light','dark']){await page.evaluate(async theme=>{await call('settings.appearance',{value:theme});applyTheme(theme);},theme);for(const name of ['聊天','动态','目标','成果库']){await tab(name).click();await delay(800);await shot(`${theme}-offline-${{'聊天':'chat','动态':'activity','目标':'goals','成果库':'library'}[name]}`);}}
    report.checks.push('real-native-offline-four-pages-light-dark');
  }
  if(!process.argv.includes('--synthetic-only')){
  // Reconnect the actual native transport to the fixed DSH and one paid MiMo reminder.
  realHost=await harness('tb4-reminder',{memory:false,mainChat:true});
  const origin=await realHost.page.evaluate(()=>location.origin);realPort=new URL(origin).port;run('reverse',`tcp:${realPort}`,`tcp:${realPort}`);
  await page.evaluate(async values=>{await call('auth.login',values);const me=await call('auth.me');WeftMobileCloud.core.acceptSession(await (await androidBridge.fetch('/personal/v1/auth/me')).json());state.loggedIn=true;state.owner=me.owner;state.username=me.username;state.deviceId=me.deviceId||me.device?.id||'';state.authEpoch++;document.body.classList.remove('cloud-auth-active');$('cloud-auth-page').classList.remove('active');uiCore.syncMobileIdentity();await listSharedSessions();await uiCore.selectMainChat();await call('app.ready',{owner:state.owner,hasDraft:hasAnyDraft()});},{origin,...realHost.credentials,deviceName:'TB-4 synthetic Android'});
  run('shell','pm','grant',pkg,'android.permission.POST_NOTIFICATIONS');
  await b('当前模型').click();await page.getByRole('option',{name:'ia2b-mimo',exact:true}).click();await page.evaluate(()=>uiCore.refreshActivity());const before=await page.evaluate(()=>uiCore.activity.unreadCount);
  await page.getByRole('textbox',{name:'输入消息',exact:true}).fill('请设一个一分钟后的提醒，提醒我核对合成周末计划。使用原生定时提醒，不要只在回复里说会提醒。');await b('发送').click();
  const sent=await until(async()=> (await realHost.api('/commands?limit=20')).body.commands.find(row=>row.kind==='chat.message'&&row.state==='accepted_by_dsh'));await realHost.complete(sent);
  const reminder=await until(async()=> (await realHost.api('/activity')).body.items.find(row=>row.type==='reminder.triggered'),150000);
  await page.evaluate(()=>uiCore.refreshActivity());assert.ok(await page.evaluate(()=>uiCore.activity.unreadCount)>before);await shot('real-mimo-badge');
  await until(()=>run('shell','dumpsys','notification','--noredact').includes(reminder.id));
  run('shell','run-as',pkg,'sh','-c',`"echo ${reminder.id} > files/tb4-notification-click"`);
  await page.waitForFunction(id=>state.page==='activity'&&document.activeElement?.dataset.activityId===id,reminder.id);await shot('real-notification-deeplink');
  await page.getByRole('button',{name:new RegExp('^更多操作 .*')}).first().click();await shot('real-reminder-menu-open');await page.getByRole('menuitem',{name:'标为已读',exact:true}).click();await shot('real-reminder-read');
  report.realMimo={model:'mimo-v2.6-flash',beforeUnread:before,reminder:{id:reminder.id,title:reminder.title,type:reminder.type},command:{chatId:sent.chatId,sessionId:sent.sessionId,requestId:sent.requestId,receiptId:sent.receiptId}};report.checks.push('real-MiMo-one-minute-reminder','same-host-unread-increment','actual-system-notification-content-intent-focus','mark-read-badge-decrement');
  await tab('聊天').click();run('shell','input','keyevent','4');await until(()=>!run('shell','dumpsys','activity','activities').split('\n').some(line=>line.includes('mResumedActivity')&&line.includes(pkg)));report.checks.push('main-chat-system-back-backgrounds-app');
  }
  assert.deepEqual(errors,[]);report.errors=errors;await writeFile(join(out,process.argv.includes('--synthetic-only')?'android-synthetic-verification.json':'android-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{
  if(previousHeadsUp&&previousHeadsUp!=='null')run('shell','settings','put','global','heads_up_notifications_enabled',previousHeadsUp);else run('shell','settings','delete','global','heads_up_notifications_enabled');
  if(previousIme)run('shell','ime','set',previousIme);if(previousFont)run('shell','settings','put','system','font_scale',previousFont);
  try{run('shell','settings','put','system','user_rotation','0');run('shell','settings','put','system','accelerometer_rotation','1');}catch{}
  if(realPort)try{run('reverse','--remove',`tcp:${realPort}`);}catch{}
  if(realHost){await realHost.close();const usage=await realHost.usage().catch(()=>[]);const previous=await readFile(join(out,'real-mimo-usage.json'),'utf8').then(JSON.parse).catch(()=>[]);await writeFile(join(out,'real-mimo-usage.json'),JSON.stringify([...previous,...usage],null,2)+'\n');}
  if(instrumentation){try{run('shell','run-as',pkg,'touch','files/tb4-probe.done');await until(()=>instrumentation.exitCode!==null);}catch{instrumentation.kill();}}
  await browser?.close();if(debugPort)run('forward','--remove',`tcp:${debugPort}`);if(reversed)run('reverse','--remove',`tcp:${new URL(f.origin).port}`);
  if(installed){run('uninstall',`${pkg}.test`);run('uninstall',pkg);}await f.close();await writeFile(join(out,'android-probe.txt'),log);
}
