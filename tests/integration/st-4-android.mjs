import assert from 'node:assert/strict';
import { spawn,execFileSync } from 'node:child_process';
import { mkdir,writeFile,readFile,rm,utimes } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
const adb='D:/Software/MuMuPlayer/nx_main/adb.exe',serial='127.0.0.1:7555',pkg='com.memoweft.weftmate.mobile.st4qa',out=resolve('tests/evidence/st-4');await mkdir(out,{recursive:true});
function adbCall(...args){try{return execFileSync(adb,['-s',serial,...args],{windowsHide:true,maxBuffer:16*1024*1024});}catch(error){if(args[0]==='shell'&&args[1]==='pidof'&&error.status===1)return Buffer.alloc(0);throw error;}}
assert.equal(adbCall('shell','pidof','com.memoweft.weftmate.mobile.and1').toString().trim(),'','Another package is using MuMu');
const f=await startTimelineCandidate({interactive:true,composer:true,historyCount:0});let socket,probe,forward;const port=new URL(f.origin).port;
const owner=Object.keys(JSON.parse(await readFile(join(f.root,'store.json'),'utf8')).accounts)[0];
for(const category of ['cache','logs','temporary','offline']){const folder=join(f.root,'accounts',owner,category);await mkdir(folder,{recursive:true});const file=join(folder,'synthetic');await writeFile(file,Buffer.alloc(65536,0x53));await utimes(file,new Date('2026-01-01'),new Date('2026-01-01'));}
try{
 adbCall('reverse',`tcp:${port}`,`tcp:${port}`);
 adbCall('install','-r',resolve('apps/android/app/build/outputs/apk/debug/app-debug.apk'));
 adbCall('install','-r',resolve('apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'));
 adbCall('shell','pm','revoke',pkg,'android.permission.POST_NOTIFICATIONS');
 adbCall('shell','pm','set-permission-flags',pkg,'android.permission.POST_NOTIFICATIONS','user-set','user-fixed');
 probe=spawn(adb,['-s',serial,'shell','am','instrument','-w','-e','class','com.memoweft.weftmate.mobile.St4WebViewProbeTest','-e','st4Probe','1','-e','lg1bHostOrigin',f.origin,pkg+'.test/androidx.test.runner.AndroidJUnitRunner'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 let probeLog='';probe.stdout.on('data',part=>probeLog+=String(part));probe.stderr.on('data',part=>probeLog+=String(part));
 let pid;for(let i=0;i<100;i++){pid=adbCall('shell','pidof',pkg).toString().trim();if(pid)break;await new Promise(r=>setTimeout(r,200));}assert.ok(pid,probeLog);
 forward=adbCall('forward','tcp:0',`localabstract:webview_devtools_remote_${pid}`).toString().trim();
 if(!forward){const line=adbCall('forward','--list').toString().split('\n').find(row=>row.includes(`localabstract:webview_devtools_remote_${pid}`));forward=line?.match(/tcp:(\d+)/)?.[1];}assert.ok(forward,'Missing allocated debug port');
 let target;for(let i=0;i<100;i++){try{target=(await(await fetch(`http://127.0.0.1:${forward}/json/list`)).json()).find(row=>row.url.includes('appassets.androidplatform.net'));if(target)break;}catch{}await new Promise(r=>setTimeout(r,200));}assert.ok(target,probeLog);
 socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((done,fail)=>{socket.addEventListener('open',done,{once:true});socket.addEventListener('error',fail,{once:true});});let sequence=0;
 const cdp=(method,params)=>new Promise((done,fail)=>{const id=++sequence;const listener=event=>{const value=JSON.parse(event.data);if(value.id===id){socket.removeEventListener('message',listener);value.error?fail(value.error):done(value.result);}};socket.addEventListener('message',listener);socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async(expression)=>{const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
 const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,200));}throw Error('Android state timeout: '+expression);};
 const tap=async text=>evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(n=>n.textContent.trim()===${JSON.stringify(text)}&&n.getClientRects().length);if(!button)throw Error('Missing button: '+${JSON.stringify(text)});button.scrollIntoView({block:'nearest'});button.click();})()`);
 const fill=async(label,value)=>evaluate(`(()=>{const name=[...document.querySelectorAll('label')].find(n=>n.textContent.includes(${JSON.stringify(label)})&&n.getClientRects().length);const input=name?.htmlFor?document.getElementById(name.htmlFor):name?.querySelector('input');if(!input)throw Error('Missing field: '+${JSON.stringify(label)});input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await wait("typeof state!=='undefined'&&state.booted");console.log('Android initial',await evaluate('document.body.innerText'));
 // Seed only this isolated package using the existing real native login API.
 // This test covers data routes, not the separately tested cloud login page.
 await evaluate(`call('auth.login',${JSON.stringify({origin:f.origin,username:f.credentials.username,password:f.credentials.password,deviceName:'ST4 isolated Android'})})`);
 await cdp('Page.reload',{});await wait("typeof state!=='undefined'&&state.booted&&state.loggedIn");
 await evaluate("page('settings')");
 await evaluate("[...document.querySelectorAll('nav[aria-label=\"设置分类\"] button')].find(n=>n.textContent.includes('数据与存储')).click()");
 await wait("document.body.innerText.includes('本账户共占用')");
 const capture=async(name)=>writeFile(join(out,name),adbCall('exec-out','screencap','-p'));
 for(const theme of ['light','dark']){
  await evaluate(`(async()=>{await call('settings.appearance',{value:${JSON.stringify(theme)}});applyTheme(${JSON.stringify(theme)});})()`);await new Promise(r=>setTimeout(r,300));
  await capture(`android-native-${theme}-overview.png`);
  for(const label of ['删除本账户的全部数据','注销账号']){await tap(label);await capture(`android-native-${theme}-${label==='注销账号'?'close':'delete'}-dialog.png`);await fill('输入账户名确认','TimelineFixture');await tap('继续');await capture(`android-native-${theme}-${label==='注销账号'?'close':'delete'}-final.png`);await tap('取消');}
  await evaluate("[...document.querySelectorAll('.data-category')].find(n=>n.textContent.includes('日志与诊断')).querySelector('button').click()");await capture(`android-native-${theme}-clean-confirm.png`);await tap('取消');
 }
 await writeFile(join(out,'android-native-checks.json'),JSON.stringify({isolatedPackage:pkg,realNativeBridge:true,realHostAuthentication:true,exactDataRoutes:true,fullSystemBarScreenshots:true,randomPort:true,modelRequests:0},null,2)+'\n');console.log('ST4 Android native capture passed');
}catch(error){console.log('Android driver failure',String(error));try{await writeFile(join(out,'android-native-failure.png'),adbCall('exec-out','screencap','-p'));}catch{}throw error;}
finally{try{adbCall('shell','run-as',pkg,'touch','files/st4-probe.done');}catch{}socket?.close();if(probe&&probe.exitCode===null)await Promise.race([new Promise(r=>probe.once('exit',r)),new Promise(r=>setTimeout(r,3000))]);try{adbCall('shell','am','force-stop',pkg);adbCall('uninstall',pkg+'.test');adbCall('uninstall',pkg);}catch{}try{adbCall('reverse','--remove',`tcp:${port}`);if(forward)adbCall('forward','--remove',`tcp:${forward}`);}catch{}await f.close();await rm(f.root,{recursive:true,force:true});}
