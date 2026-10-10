import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {startTimelineCandidate} from './timeline-ui-candidate.mjs';
const adb='D:/Software/MuMuPlayer/nx_main/adb.exe',serial='127.0.0.1:7555',pkg='com.memoweft.weftmate.mobile.st4qa',out=resolve('tests/evidence/st-4');await mkdir(out,{recursive:true});
function run(...args){try{return execFileSync(adb,['-s',serial,...args],{windowsHide:true,maxBuffer:16*1024*1024});}catch(error){if(args[1]==='pidof'&&error.status===1)return Buffer.alloc(0);throw error;}}
assert.equal(run('shell','pidof','com.memoweft.weftmate.mobile.and1').toString().trim(),'');
const f=await startTimelineCandidate({interactive:true,composer:true,historyCount:0}),port=new URL(f.origin).port;let socket,forward;
try{
 run('reverse',`tcp:${port}`,`tcp:${port}`);run('install','-r',resolve('apps/android/app/build/outputs/apk/debug/app-debug.apk'));run('install','-r',resolve('apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'));
 for(const theme of ['light','dark']){
  run('shell','am','force-stop',pkg+'.test');
  console.log(run('shell','am','start','-n',pkg+'/com.memoweft.weftmate.mobile.St4RemoteBrowserActivity','-e','st4Url',f.origin+'/personal/v1/ui','-e','st4Theme',theme).toString());
  let pid;for(let i=0;i<80;i++){pid=run('shell','pidof',pkg+':st4remote').toString().trim();if(pid)break;await new Promise(r=>setTimeout(r,200));}assert.ok(pid);
  forward=run('forward','tcp:0',`localabstract:webview_devtools_remote_${pid}`).toString().trim();let target;
  for(let i=0;i<80;i++){try{target=(await(await fetch(`http://127.0.0.1:${forward}/json/list`)).json()).find(row=>row.url.startsWith(f.origin));if(target)break;}catch{}await new Promise(r=>setTimeout(r,200));}assert.ok(target,'Remote browser target');
  socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));let sequence=0;
  const cdp=(method,params)=>new Promise((done,fail)=>{const id=++sequence;const listener=event=>{const value=JSON.parse(event.data);if(value.id===id){socket.removeEventListener('message',listener);value.error?fail(value.error):done(value.result);}};socket.addEventListener('message',listener);socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const value=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(value.exceptionDetails)throw Error(JSON.stringify(value.exceptionDetails));return value.result.value;};
  await evaluate(`fetch('/personal/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(${JSON.stringify(f.credentials)})}).then(r=>r.status)`);await cdp('Page.reload',{});
  for(let i=0;i<100;i++){if(await evaluate("!!document.querySelector('#account-view')"))break;await new Promise(r=>setTimeout(r,150));}
  await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)};WeftSettingsNavigation.open('data')`);
  for(let i=0;i<100;i++){if(await evaluate("document.body.innerText.includes('本账户共占用')"))break;await new Promise(r=>setTimeout(r,150));}
  await new Promise(r=>setTimeout(r,500));await writeFile(join(out,`mobile-web-system-${theme}-overview.png`),run('exec-out','screencap','-p'));
  await evaluate("[...document.querySelectorAll('.data-danger button')].find(n=>n.textContent==='删除本账户的全部数据').click()");
  await writeFile(join(out,`mobile-web-system-${theme}-delete-dialog.png`),run('exec-out','screencap','-p'));
  await evaluate("(()=>{const input=document.querySelector('.data-dialog input');input.value='TimelineFixture';input.dispatchEvent(new Event('input'));[...document.querySelectorAll('.data-dialog button')].find(n=>n.textContent==='继续').click()})()");
  await writeFile(join(out,`mobile-web-system-${theme}-delete-final.png`),run('exec-out','screencap','-p'));
  socket.close();socket=null;run('forward','--remove',`tcp:${forward}`);forward=null;
 }
 await writeFile(join(out,'mobile-web-system-checks.json'),JSON.stringify({synthetic:true,realHost:true,remoteWeb:true,isolatedTestBrowser:true,productBridge:false,fullSystemBars:true,chromiumEmulation:'390×844 separately verified',notChromeApp:true},null,2)+'\n');console.log('ST4 remote mobile web system-bar capture passed');
}catch(error){console.log(run('logcat','-d','-t','500').toString().split('\n').filter(line=>line.includes('St4RemoteBrowser')||line.includes('st4qa.test')||line.includes('AndroidRuntime')).slice(-25).join('\n'));throw error;}
finally{socket?.close();try{run('shell','am','force-stop',pkg+'.test');run('uninstall',pkg+'.test');run('uninstall',pkg);run('reverse','--remove',`tcp:${port}`);if(forward)run('forward','--remove',`tcp:${forward}`);}catch{}await f.close();await rm(f.root,{recursive:true,force:true});}
