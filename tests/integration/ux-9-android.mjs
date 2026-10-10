/** Real isolated Android shell; synthetic host, random ports, no model. */
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {startFixture} from './ux-4-fixture.mjs';
const root=resolve(import.meta.dirname,'../..'),out=join(root,'tests/evidence/ux-9');await mkdir(out,{recursive:true});
const adb='D:/Software/MuMuPlayer/nx_main/adb.exe',serial='127.0.0.1:7555',pkg='com.memoweft.weftmate.mobile.ux9qa';
const run=(...args)=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',windowsHide:true});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<120;i++){const v=await fn();if(v)return v;await delay(250)}throw Error('Android condition timeout')}
const f=await startFixture();
const workFolder=join('C:/Temp','weftmate-ux9-android-folder-'+randomUUID());await mkdir(workFolder);
const project=(await f.request('/projects',{requestId:randomUUID(),name:'合成安卓项目',rootPath:workFolder,permission:'read-only'})).project;
let browser,instrumentation,debugPort,installed=false,reversed=false,log='';
try{
 assert.deepEqual(run('shell','ps','-A').split('\n').filter(row=>row.includes('weftmate')),[],'MuMu belongs to another work package');
 assert.ok(!run('shell','pm','list','packages').includes(`package:${pkg}`));
 run('install',join(root,'apps/android/app/build/outputs/apk/debug/app-debug.apk'));installed=true;
 run('install',join(root,'apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'));
 run('reverse',`tcp:${new URL(f.origin).port}`,`tcp:${new URL(f.origin).port}`);reversed=true;
 instrumentation=spawn(adb,['-s',serial,'shell','am','instrument','-w','-e','class','com.memoweft.weftmate.mobile.Ux9WebViewProbeTest','-e','ux9Probe','1',`${pkg}.test/androidx.test.runner.AndroidJUnitRunner`],{windowsHide:true,stdio:['ignore','pipe','pipe']});instrumentation.stdout.on('data',v=>log+=v);instrumentation.stderr.on('data',v=>log+=v);
 const pid=await until(()=>{try{return run('shell','pidof',pkg).trim()}catch{return false}});
 const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));debugPort=reservation.address().port;await new Promise(r=>reservation.close(r));run('forward',`tcp:${debugPort}`,`localabstract:webview_devtools_remote_${pid}`);
 await until(async()=>{try{return(await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).some(row=>row.url.includes('appassets'))}catch{return false}});
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`,{noDefaults:true});const page=browser.contexts()[0].pages().find(p=>p.url().includes('appassets'));assert.ok(page);page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.waitForFunction(()=>typeof state!=='undefined'&&state.booted&&!state.transitionPending);
 await page.evaluate(async values=>{await call('auth.login',values);const me=await call('auth.me');WeftMobileCloud.core.acceptSession(await(await androidBridge.fetch('/personal/v1/auth/me')).json());state.loggedIn=true;state.owner=me.owner;state.username=me.username;state.deviceId=me.deviceId||me.device?.id||'';state.authEpoch++;document.body.classList.remove('cloud-auth-active');$('cloud-auth-page').classList.remove('active');uiCore.syncMobileIdentity();await listSharedSessions();await uiCore.selectMainChat();},{origin:f.origin,...f.credentials,deviceName:'UX-P2 合成安卓'});

 await page.evaluate(()=>uiCore.startChatConversation());
 for(const theme of ['light','dark']){
  await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;uiCore.state.hostName='合成电脑';updateComposer();},theme);
  await page.getByRole('button',{name:'选择文件夹',exact:true}).waitFor();await writeFile(join(out,`android-native-${theme}-blank.png`),execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{windowsHide:true}));
  await page.getByRole('button',{name:'添加图片或文件',exact:true}).click();await page.getByRole('menuitem',{name:'选择电脑上的文件夹',exact:true}).waitFor();await writeFile(join(out,`android-native-${theme}-plus.png`),execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{windowsHide:true}));
  await page.getByRole('menuitem',{name:'选择电脑上的文件夹',exact:true}).click();await page.getByRole('menuitem',{name:'新文件夹请在电脑上添加',exact:true}).waitFor();await writeFile(join(out,`android-native-${theme}-folders.png`),execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{windowsHide:true}));await page.keyboard.press('Escape');
 }
 await page.getByRole('button',{name:'选择文件夹',exact:true}).click();await page.getByRole('menuitemradio',{name:'合成安卓项目',exact:true}).click();await page.getByRole('button',{name:'选择文件夹，当前 合成安卓项目',exact:true}).waitFor();await writeFile(join(out,'android-native-selected.png'),execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{windowsHide:true}));
 assert.deepEqual(errors,[]);await writeFile(join(out,'android-native.json'),JSON.stringify({realNativeShell:true,existingProjectSelected:true,independentPackage:pkg,rendererErrors:errors},null,2));
 run('shell','run-as',pkg,'touch','files/ux-9-probe.done');
}finally{
 await browser?.close();if(instrumentation&&!instrumentation.killed)instrumentation.kill();
 if(debugPort)try{run('forward','--remove',`tcp:${debugPort}`)}catch{}
 if(reversed)try{run('reverse','--remove',`tcp:${new URL(f.origin).port}`)}catch{}
 if(installed){try{run('uninstall',pkg+'.test')}catch{}try{run('uninstall',pkg)}catch{}}
 await f.close();await rm(workFolder,{recursive:true,force:true});console.log('Android cleanup complete');
}
