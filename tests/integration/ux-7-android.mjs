/** Real isolated Android shell and business route; deterministic presentation only. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
const root=resolve(import.meta.dirname,'../..'),out=join(root,'tests/evidence/ux-7');await mkdir(out,{recursive:true});
const adb='D:/Software/MuMuPlayer/nx_main/adb.exe',serial='127.0.0.1:7555',pkg='com.memoweft.weftmate.mobile.ux7qa';
const run=(...args)=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',windowsHide:true});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<120;i++){const v=await fn();if(v)return v;await delay(250)}throw Error('Android condition timeout')}
const f=await startTimelineCandidate({historyCount:0,interactive:true,composer:true});await f.complete();
let browser,instrumentation,debugPort,installed=false,reversed=false,log='';const errors=[],rows=[];
try{
 assert.deepEqual(run('shell','ps','-A').split('\n').filter(row=>row.includes('weftmate')),[],'MuMu belongs to another work package');
 assert.deepEqual(run('shell','pm','list','packages','weftmate').split('\n').filter(row=>row.trim()&&!row.trim().endsWith('.test')),[],'Other test app is installed');
 for(const file of ['debug/app-debug.apk','androidTest/debug/app-debug-androidTest.apk'])run('install',join(root,'apps/android/app/build/outputs/apk',file));installed=true;
 run('shell','pm','grant',pkg,'android.permission.POST_NOTIFICATIONS');
 run('reverse',`tcp:${new URL(f.origin).port}`,`tcp:${new URL(f.origin).port}`);reversed=true;
 instrumentation=spawn(adb,['-s',serial,'shell','am','instrument','-w','-e','class','com.memoweft.weftmate.mobile.Ux7WebViewProbeTest','-e','ux7Probe','1',`${pkg}.test/androidx.test.runner.AndroidJUnitRunner`],{windowsHide:true,stdio:['ignore','pipe','pipe']});instrumentation.stdout.on('data',v=>log+=v);instrumentation.stderr.on('data',v=>log+=v);
 const pid=await until(()=>{try{return run('shell','pidof',pkg).trim()}catch{return false}});
 const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));debugPort=reservation.address().port;await new Promise(r=>reservation.close(r));run('forward',`tcp:${debugPort}`,`localabstract:webview_devtools_remote_${pid}`);
 await until(async()=>{try{return(await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).some(row=>row.url.includes('appassets'))}catch{return false}});
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`,{noDefaults:true});const page=browser.contexts()[0].pages().find(p=>p.url().includes('appassets'));assert.ok(page);page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.waitForFunction(()=>typeof state!=='undefined'&&state.booted&&!state.transitionPending);
 await page.evaluate(async values=>{await call('auth.login',values);const me=await call('auth.me');WeftMobileCloud.core.acceptSession(await(await androidBridge.fetch('/personal/v1/auth/me')).json());state.loggedIn=true;state.owner=me.owner;state.username=me.username;state.deviceId=me.deviceId||me.device?.id||'';state.authEpoch++;document.body.classList.remove('cloud-auth-active');$('cloud-auth-page').classList.remove('active');uiCore.syncMobileIdentity();await listSharedSessions();await selectSharedSession(values.sessionId);closeDrawer();},{origin:f.origin,...f.credentials,sessionId:f.sessionId,deviceName:'UX-7 合成安卓'});
 await page.evaluate(async()=>{await call('app.ready',{owner:state.owner||'',hasDraft:hasAnyDraft()});});
 try { run('shell','uiautomator','dump','/sdcard/ux-7-hierarchy.xml'); } catch(error) { if(!error.stdout?.includes('UI hierchary dumped to: /sdcard/ux-7-hierarchy.xml'))throw error; }
 assert.doesNotMatch(run('shell','cat','/sdcard/ux-7-hierarchy.xml'),/内置界面未能启动|打开原生界面继续使用/);
 run('shell','rm','/sdcard/ux-7-hierarchy.xml');
 const requestId=randomUUID();const route=await page.evaluate(async({id,requestId})=>{const created=await uiCore.accessApi(`/sessions/${id}/suggestions`,{method:'POST',protectedWrite:true,body:{kind:'replies',requestId}});const cancelled=await uiCore.accessApi(`/sessions/${id}/suggestions?requestId=${requestId}`,{method:'DELETE',protectedWrite:true});return{created,cancelled};},{id:f.sessionId,requestId});assert.equal(route.created.requestId,requestId);assert.equal(route.cancelled.cancelled,true);
 for(const theme of ['light','dark']){
  await page.evaluate(theme=>applyTheme(theme),theme);
  for(const n of [1,2,3]){await page.evaluate(n=>{const value={suggestions:['把它保存成文件','继续说第二点','帮我设个提醒'].slice(0,n),completion:'',draft:'',enabled:true};uiCore.nextSuggestionsView=()=>value;$('draft').value='';uiCore._nextSuggestionsPaint();},n);await page.locator('.next-suggestion-chip').first().waitFor();await delay(200);const screenshot=`android-native-${theme}-replies-${n}.png`;await writeFile(join(out,screenshot),execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{windowsHide:true,maxBuffer:12*1024*1024}));rows.push({theme,scene:`replies-${n}`,screenshot,metrics:await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,chipHeight:document.querySelector('.next-suggestion-chip').getBoundingClientRect().height,priority:document.querySelector('#composer-above-slot').dataset.priority}))});assert.equal(rows.at(-1).metrics.overflow,false);assert.ok(rows.at(-1).metrics.chipHeight>=40);}
  await page.locator('.next-suggestion-chip').first().click();assert.equal(await page.locator('#draft').inputValue(),'把它保存成文件');await page.locator('#draft').fill('');
 }
 assert.deepEqual(errors,[]);await writeFile(join(out,'android-native-checks.json'),JSON.stringify({realAndroid:true,synthetic:true,modelRequests:0,packageName:pkg,versionCode:34,versionName:'0.8.21',nativeSuggestionsRoute:true,cancellationRoute:true,rows,errors},null,2));console.log('UX-7 real Android passed');
}finally{
 if(instrumentation){try{run('shell','run-as',pkg,'touch','files/ux-7-probe.done');await until(()=>instrumentation.exitCode!==null)}catch{instrumentation.kill()}}
 await browser?.close();if(debugPort)run('forward','--remove',`tcp:${debugPort}`);if(reversed)run('reverse','--remove',`tcp:${new URL(f.origin).port}`);
 if(installed){run('uninstall',`${pkg}.test`);run('uninstall',pkg)}await f.close();await rm(f.root,{recursive:true,force:true});await writeFile(join(out,'android-probe.txt'),log);
}
