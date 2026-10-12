/* Existing HybridActivity and native bridge; isolated synthetic package/account only. */
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {open,mkdir,writeFile,readFile,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import {readMuMuInfo,adbExecutable} from '../../scripts/nightly/mumu.mjs';
import {startTimelineCandidate} from './timeline-ui-candidate.mjs';
const {PNG}=createRequire(import.meta.url)('playwright-core/lib/utilsBundle');
const out=resolve('tests/evidence/mob-3');await mkdir(out,{recursive:true});
const pkg='com.memoweft.weftmate.mobile.tb4qa',lock='D:/AIProjects/WeftMate/Runtime/Orchestrator/mumu.lock';
const report={synthetic:true,realNativeShell:true,modelRequests:0,packageName:pkg,settingsChanged:false,screenshots:[],errors:[]};
let lease,serial,f,browser,forward,instrumentation,installed=false,reverse=false;
const run=(...args)=>execFileSync(adbExecutable,['-s',serial,...args],{windowsHide:true,timeout:15000,maxBuffer:24*1024*1024});
const until=async(fn,label)=>{for(let i=0;i<150;i++){try{const result=await fn();if(result)return result;}catch{}await new Promise(done=>setTimeout(done,200));}throw Error(label+' did not become ready');};
try{
  lease=await open(lock,'wx');await lease.writeFile('MOB-3 '+new Date().toISOString()+' existing native shell');await lease.close();
  const info=readMuMuInfo();serial=info.serial;report.systemVersion=info.androidVersion;
  execFileSync(adbExecutable,['connect',serial],{windowsHide:true,timeout:15000});
  const packages=run('shell','pm','list','packages').toString().split('\n').map(line=>line.trim()).filter(line=>line.includes('weftmate'));
  const running=run('shell','ps','-A').toString().split('\n').filter(line=>line.includes('weftmate'));
  if(running.length)throw Error('MuMu still has another work package running; its app was left untouched');
  assert.ok(!packages.includes('package:'+pkg),'The isolated package name belongs to an existing installation');
  const apk=resolve('apps/android/app/build/outputs/apk/debug/app-debug.apk');report.apkSha256=createHash('sha256').update(await readFile(apk)).digest('hex');
  run('install',apk);installed=true;run('install',resolve('apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'));
  f=await startTimelineCandidate({daily:true,sidebar:true,interactive:true,composer:true,historyCount:0,baseTime:Date.now()-5000});
  run('reverse','tcp:'+new URL(f.origin).port,'tcp:'+new URL(f.origin).port);reverse=true;
  instrumentation=spawn(adbExecutable,['-s',serial,'shell','am','instrument','-w','-e','class','com.memoweft.weftmate.mobile.Tb4WebViewProbeTest','-e','tb4Probe','1',pkg+'.test/androidx.test.runner.AndroidJUnitRunner'],{windowsHide:true,stdio:'ignore'});
  const pid=await until(()=>run('shell','pidof',pkg).toString().trim(),'native app');forward=run('forward','tcp:0','localabstract:webview_devtools_remote_'+pid).toString().trim();
  await until(async()=>{const response=await fetch('http://127.0.0.1:'+forward+'/json/list');return (await response.json()).some(row=>row.url.includes('appassets'));},'native WebView');
  browser=await chromium.connectOverCDP('http://127.0.0.1:'+forward,{noDefaults:true});const page=browser.contexts()[0].pages().find(p=>p.url().includes('appassets'));assert.ok(page);page.setDefaultTimeout(15000);page.on('pageerror',error=>report.errors.push(error.message));
  await page.waitForFunction(()=>typeof call==='function'&&window.weftNative?.onmessage&&state.booted);
  await page.evaluate(async values=>{await call('auth.login',values);const me=await call('auth.me');const response=await androidBridge.fetch('/personal/v1/auth/me');WeftMobileCloud.core.acceptSession(await response.json());state.loggedIn=true;state.owner=me.owner;state.username=me.username||'Synthetic';state.deviceId=me.deviceId||me.device?.id||'';state.authEpoch++;document.body.classList.remove('cloud-auth-active');$('cloud-auth-page').classList.remove('active');uiCore.syncMobileIdentity();await listSharedSessions();}, {origin:f.origin,...f.credentials,deviceName:'MOB-3 synthetic phone'});
  await page.evaluate(async id=>{await selectSharedSession(id);closeDrawer();},f.sessionId);await page.waitForFunction(()=>!state.sharedLoading&&state.sharedEvents.length>0);
  const systemMode=run('shell','dumpsys','uimode').toString().match(/mCurUiMode=(?:0x)?([0-9a-f]+)/i)?.[1];report.systemTheme=systemMode?(parseInt(systemMode,16)&0x30)===0x20?'dark':'light':'unknown';
  const insets=()=>{const dump=run('shell','dumpsys','window','displays').toString();const height=type=>{const line=dump.split('\n').find(n=>n.includes('type='+type)&&n.includes('visible=true')),frame=line?.match(/frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);return frame?Number(frame[4])-Number(frame[2]):0;};return {status:height('statusBars'),navigation:height('navigationBars'),ime:height('ime')};};
  const capture=async(theme,scene)=>{await page.evaluate(()=>WeftSystemBars.sync());await page.waitForTimeout(400);const frame=run('exec-out','screencap','-p'),name='android-'+theme+'-'+scene+'.png';await writeFile(join(out,name),frame);const png=PNG.sync.read(frame),bars=insets(),pixel=(x,y)=>[0,1,2].map(i=>png.data[(Math.floor(y)*png.width+x)*4+i]);const colorDelta=bars.status?Math.max(...pixel(8,bars.status/2).map((v,i)=>Math.abs(v-pixel(8,bars.status+5)[i]))):null;report.screenshots.push({file:name,pageTheme:theme,systemTheme:report.systemTheme,systemVersion:info.androidVersion,width:png.width,height:png.height,statusHeight:bars.status,navigationHeight:bars.navigation,imeHeight:bars.ime,bottomNavigationVisible:bars.navigation>0,statusPageColorDifference:colorDelta,nativeProductBridge:true});};
  for(const theme of ['light','dark']){
    await page.evaluate(theme=>{applyTheme(theme);stopSharedPoll();state.sharedRunning=false;state.busy=false;attachmentDrafts.delete(attachmentKey());$('draft').value='';$('draft').blur();composerKeyboardDismissed=true;$('approval-bar').hidden=true;$('question-bar').hidden=true;renderAttachmentDrafts();updateComposer();syncMobileKeyboard(false);},theme);await capture(theme,'composer-idle');
    await page.locator('#draft').focus();await capture(theme,'composer-focused');
    await page.evaluate(async()=>{$('draft').blur();composerKeyboardDismissed=true;resetToolApprovals();await refreshToolApprovals();renderConversationApprovals();scrollBottom(true);updateComposer();});await capture(theme,'approval');
    await page.evaluate(()=>{syncMobileTabs();uiCore.activity.unreadCount=3;syncMobileTabs();});await capture(theme,'navigation');
  }
  assert.deepEqual(report.errors,[]);report.result='passed';
}catch(error){report.result='unavailable';report.reason=String(error.message).replace(/[A-Za-z]:\\Users\\[^\\]+/g,'C:\\Users\\<user>');console.log(report.reason);}
finally{
  if(installed){try{run('shell','run-as',pkg,'touch','files/tb4-probe.done');}catch{}try{run('shell','am','force-stop',pkg+'.test');run('shell','am','force-stop',pkg);run('uninstall',pkg+'.test');run('uninstall',pkg);}catch{}}
  instrumentation?.kill();try{await browser?.close();}catch{}if(serial&&forward)try{run('forward','--remove','tcp:'+forward);}catch{}if(serial&&reverse)try{run('reverse','--remove','tcp:'+new URL(f.origin).port);}catch{}
  await f?.close();if(serial)try{execFileSync(adbExecutable,['disconnect',serial],{windowsHide:true,timeout:10000});}catch{}if(lease)await unlink(lock).catch(()=>{});
  await writeFile(join(out,'android-verification.json'),JSON.stringify(report,null,2)+'\n');
}
