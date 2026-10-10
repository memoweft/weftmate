/** Real isolated Android shell; synthetic host, random ports, no model. */
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {startTimelineCandidate} from './timeline-ui-candidate.mjs';
const root=resolve(import.meta.dirname,'../..'),out=join(root,'tests/evidence/ux-p2');await mkdir(out,{recursive:true});
const adb='D:/Software/MuMuPlayer/nx_main/adb.exe',serial='127.0.0.1:7555',pkg='com.memoweft.weftmate.mobile.uxp2qa';
const run=(...args)=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',windowsHide:true});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<120;i++){const v=await fn();if(v)return v;await delay(250)}throw Error('Android condition timeout')}
const f=await startTimelineCandidate({daily:true,sidebar:true,interactive:true,inlineProgress:true,historyCount:0});
let browser,instrumentation,debugPort,installed=false,reversed=false,log='';
try{
 assert.deepEqual(run('shell','ps','-A').split('\n').filter(row=>row.includes('weftmate')),[],'MuMu belongs to another work package');
 assert.ok(!run('shell','pm','list','packages').includes(`package:${pkg}`));
 run('install',join(root,'apps/android/app/build/outputs/apk/debug/app-debug.apk'));installed=true;
 run('install',join(root,'apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'));
 run('reverse',`tcp:${new URL(f.origin).port}`,`tcp:${new URL(f.origin).port}`);reversed=true;
 instrumentation=spawn(adb,['-s',serial,'shell','am','instrument','-w','-e','class','com.memoweft.weftmate.mobile.UxP2WebViewProbeTest','-e','uxP2Probe','1',`${pkg}.test/androidx.test.runner.AndroidJUnitRunner`],{windowsHide:true,stdio:['ignore','pipe','pipe']});instrumentation.stdout.on('data',v=>log+=v);instrumentation.stderr.on('data',v=>log+=v);
 const pid=await until(()=>{try{return run('shell','pidof',pkg).trim()}catch{return false}});
 const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));debugPort=reservation.address().port;await new Promise(r=>reservation.close(r));run('forward',`tcp:${debugPort}`,`localabstract:webview_devtools_remote_${pid}`);
 await until(async()=>{try{return(await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).some(row=>row.url.includes('appassets'))}catch{return false}});
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`,{noDefaults:true});const page=browser.contexts()[0].pages().find(p=>p.url().includes('appassets'));assert.ok(page);page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.waitForFunction(()=>typeof state!=='undefined'&&state.booted&&!state.transitionPending);
 await page.evaluate(async values=>{await call('auth.login',values);const me=await call('auth.me');WeftMobileCloud.core.acceptSession(await(await androidBridge.fetch('/personal/v1/auth/me')).json());state.loggedIn=true;state.owner=me.owner;state.username=me.username;state.deviceId=me.deviceId||me.device?.id||'';state.authEpoch++;document.body.classList.remove('cloud-auth-active');$('cloud-auth-page').classList.remove('active');uiCore.syncMobileIdentity();await listSharedSessions();await uiCore.selectMainChat();},{origin:f.origin,...f.credentials,deviceName:'UX-P2 合成安卓'});
 const host=(await f.request('/status')).hostId,main=(await f.request('/chats/main')).chat;
 let cmd=(await f.request('/commands',{requestId:randomUUID(),targetDeviceId:host,kind:'chat.message',chatId:main.chatId,modelProfileId:'local',text:'合成安卓首句'})).command;
 await until(async()=>{cmd=(await f.request(`/commands/${cmd.commandId}`)).command;return cmd.state==='accepted_by_dsh'});f.seedMainHistory(cmd.sessionId,320,{total:320});f.progress.finish('completed');await page.evaluate(()=>uiCore.selectMainChat());await page.waitForFunction(()=>document.querySelector('.main-chat-row.message'));
 const b=name=>page.getByRole('button',{name,exact:true});
 const shot=async(ids,suffix)=>{for(const id of ids)await writeFile(join(out,`after-${id}-android-native-${suffix}.png`),execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{windowsHide:true,maxBuffer:12*1024*1024}))};
 for(const theme of ['light','dark']){await page.evaluate(t=>applyTheme(t),theme);await delay(250);await shot([1,2,3,4,7],theme);assert.equal(await page.evaluate(()=>document.body.textContent.includes('内置界面未能启动')),false);await page.evaluate(()=>page('settings'));await shot([5],theme+'-settings');await page.evaluate(()=>page('appearance'));await shot([5],theme+'-appearance');await page.evaluate(async()=>{page('chat');await uiCore.selectMainChat()});await b('搜索主对话').click();await page.getByRole('searchbox',{name:'主对话搜索关键词'}).fill('合成');await page.getByRole('searchbox',{name:'主对话搜索关键词'}).press('Enter');await page.waitForFunction(()=>document.querySelector('mark'));await b('下一条搜索结果').click();await b('上一条搜索结果').click();await delay(250);await shot([14,15],theme);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await b('关闭主对话搜索').click()}
 assert.deepEqual(errors,[]);await writeFile(join(out,'android-native-checks.json'),JSON.stringify({realAndroid:true,synthetic:true,modelRequests:0,packageName:pkg,versionCode:29,errors},null,2));console.log('UX-P2 real Android passed');
}finally{
 if(instrumentation){try{run('shell','run-as',pkg,'touch','files/ux-p2-probe.done');await until(()=>instrumentation.exitCode!==null)}catch{instrumentation.kill()}}
 await browser?.close();if(debugPort)run('forward','--remove',`tcp:${debugPort}`);if(reversed)run('reverse','--remove',`tcp:${new URL(f.origin).port}`);
 if(installed){run('uninstall',`${pkg}.test`);run('uninstall',pkg)}await f.close();await rm(f.root,{recursive:true,force:true});await writeFile(join(out,'android-probe.txt'),log);
}
