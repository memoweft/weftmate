import { evidencePath } from '../helpers/evidence-path.mjs';
/* Existing HybridActivity and native bridge; isolated synthetic package/account only. */
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {open,mkdir,writeFile,readFile,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import {readMuMuInfo,adbExecutable} from '../../scripts/nightly/mumu.mjs';
import {systemBarDifference} from '../../scripts/nightly/system-bars.mjs';
import {startAnd3Fixture} from './and-3-fixture.mjs';
const {PNG}=createRequire(import.meta.url)('playwright-core/lib/utilsBundle');
const out=evidencePath('mob-3');await mkdir(out,{recursive:true});
const pkg='com.memoweft.weftmate.mobile.and3qa',lock='D:/AIProjects/WeftMate/Runtime/Orchestrator/mumu.lock';
const report={synthetic:true,realNativeShell:true,modelRequests:0,packageName:pkg,settingsChanged:false,screenshots:[],errors:[]};
let lease,serial,f,browser,forward,instrumentation,nativePage,installed=false;const reversed=[];
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
  run('install',apk);installed=true;run('shell','pm','grant',pkg,'android.permission.POST_NOTIFICATIONS');report.isolatedExistingNotificationPermissionGranted=true;run('install',resolve('apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'));
  const unusedModelMutation=async()=>{throw Error('Unexpected model mutation in the synthetic UI fixture');};
  f=await startAnd3Fixture({usageSamples:true,composer:true,accountModelManager:{
    stageSecret:unusedModelMutation,apply:unusedModelMutation,test:unusedModelMutation,disable:unusedModelMutation,
    inspect:async()=>({configured:true}),hasCredential:async()=>true,readSecret:async()=> 'synthetic-fixture-key-not-valid',
    readOfflineModel:async()=>({apiKey:'synthetic-fixture-key-not-valid',baseUrl:f.cloud.origin+'/synthetic-model',modelId:'synthetic'}),
  }});
  for(const origin of [f.origin,f.cloud.origin]){const port=new URL(origin).port;run('reverse','tcp:'+port,'tcp:'+port);reversed.push(port);}
  instrumentation=spawn(adbExecutable,['-s',serial,'shell','am','instrument','-w','-e','class','com.memoweft.weftmate.mobile.And3ShellProbeTest','-e','host',f.origin,'-e','cloudCa',Buffer.from(f.cloud.certificatePem).toString('base64'),pkg+'.test/androidx.test.runner.AndroidJUnitRunner'],{windowsHide:true,stdio:'ignore'});
  const pid=await until(()=>run('shell','pidof',pkg).toString().trim(),'native app');forward=run('forward','tcp:0','localabstract:webview_devtools_remote_'+pid).toString().trim();
  await until(async()=>{const response=await fetch('http://127.0.0.1:'+forward+'/json/list');return (await response.json()).some(row=>row.url.includes('appassets'));},'native WebView');
  browser=await chromium.connectOverCDP('http://127.0.0.1:'+forward,{noDefaults:true});const page=nativePage=browser.contexts()[0].pages().find(p=>p.url().includes('appassets'));assert.ok(page);page.setDefaultTimeout(30000);page.on('pageerror',error=>report.errors.push(error.message));report.stage='native-ui-boot';
  await page.waitForFunction(()=>typeof call==='function'&&window.weftNative?.onmessage&&state.booted);
  report.stage='synthetic-native-login';await page.getByLabel('邮箱',{exact:true}).fill(f.email);await page.getByLabel('密码',{exact:true}).fill(f.password);await page.locator('#cloud-auth-form [type=submit]').click();await page.getByLabel('邮箱验证码',{exact:true}).waitFor();
  const challenge=f.cloud.db.prepare('SELECT id FROM email_challenges WHERE consumed=0 ORDER BY rowid DESC LIMIT 1').get();assert.ok(challenge);await page.getByLabel('邮箱验证码',{exact:true}).fill(await f.cloud.mailCode(challenge.id));await page.locator('#cloud-auth-form [type=submit]').click();await page.waitForFunction(()=>state.loggedIn&&!document.body.classList.contains('cloud-auth-active'));report.nativeLogin='password and email confirmation through the existing native UI';
  report.stage='synthetic-native-model';await page.waitForFunction(()=>state.logicalChats);await page.evaluate(async()=>{state.model=await call('models.selectHost',{profileId:'local'});await uiCore.refreshModels();updateComposer();});await page.locator('#draft:not([disabled])').waitFor();
  const systemMode=run('shell','dumpsys','uimode').toString().match(/mCurUiMode=(?:0x)?([0-9a-f]+)/i)?.[1];report.systemTheme=systemMode?(parseInt(systemMode,16)&0x30)===0x20?'dark':'light':'unknown';
  const insets=()=>{const dump=run('shell','dumpsys','window','displays').toString();const height=type=>{const line=dump.split('\n').find(n=>n.includes('type='+type)&&/visible=true/i.test(n)),frame=line?.match(/frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\]/i);return frame?Number(frame[4])-Number(frame[2]):0;};return {status:height('statusBars'),navigation:height('navigationBars'),ime:height('ime')};};
  const nativeWindow=()=>JSON.parse(run('shell','run-as',pkg,'cat','files/and3-window.json').toString());
  const hideKeyboard=async()=>{if(nativeWindow().keyboardVisible){run('shell','input','keyevent','4');await until(()=>!nativeWindow().keyboardVisible,'keyboard dismissal');}};
  const snoozeOwnTestNotifications=()=>{const keys=run('shell','cmd','notification','list').toString().split('\n').map(line=>line.trim()).filter(key=>key.includes('|'+pkg+'|'));for(const key of keys){const quoted="'"+key.replaceAll("'","'\\''")+"'";run('shell','cmd','notification','snooze','--for','600000',quoted);}report.testNotificationsTemporarilySnoozed=(report.testNotificationsTemporarilySnoozed||0)+keys.length;};
  const capture=async(theme,scene)=>{await page.evaluate(()=>WeftSystemBars.sync());await page.waitForTimeout(7000);snoozeOwnTestNotifications();await page.waitForTimeout(500);const frame=run('exec-out','screencap','-p'),name='android-'+theme+'-'+scene+'.png';await writeFile(join(out,name),frame);const png=PNG.sync.read(frame),bars=insets(),native=nativeWindow(),geometry=await page.evaluate(()=>({scale:devicePixelRatio,safeTop:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--native-safe-top'))||0,safeBottom:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--native-safe-bottom'))||0}));const status=native.statusHeight,difference=status>2?systemBarDifference(frame,{statusHeight:status}):null;assert.equal(native.windowFocused,true);assert.equal(native.darkStatusIcons,theme==='light');report.screenshots.push({file:name,pageTheme:theme,systemTheme:report.systemTheme,systemVersion:info.androidVersion,width:png.width,height:png.height,statusHeight:status,navigationHeight:native.navigationHeight,imeHeight:bars.ime,keyboardVisible:native.keyboardVisible,bottomNavigationVisible:native.navigationHeight>0,statusPageColorDifference:difference?.delta??null,statusDifference:difference,nativeInsets:geometry,nativeProductBridge:true,native});};
  for(const theme of ['light','dark']){
    await hideKeyboard();await page.evaluate(theme=>{applyTheme(theme);stopSharedPoll();state.sharedRunning=false;state.busy=false;attachmentDrafts.delete(attachmentKey());$('draft').value='';$('draft').blur();composerKeyboardDismissed=true;$('approval-bar').hidden=true;$('question-bar').hidden=true;renderAttachmentDrafts();updateComposer();syncMobileKeyboard(false);},theme);await capture(theme,'composer-idle');
    await page.locator('#draft').click();await capture(theme,'composer-focused');
  }
  report.stage='synthetic-native-message';const prompt='手机界面合成验收：请帮我整理周末计划。';await page.locator('#draft').fill(prompt);await page.getByRole('button',{name:'发送',exact:true}).click();await until(()=>f.candidate.operations.some(row=>row.kind==='message'&&row.text===prompt),'real native synthetic message');f.candidate.progress.text('我会先整理材料，再保存一份简短的计划。');await f.candidate.progress.approve('mob3-native-plan','node scripts/report.mjs');await hideKeyboard();
  for(const theme of ['light','dark']){
    report.stage='native-approval-capture';await page.evaluate(async theme=>{applyTheme(theme);$('draft').blur();composerKeyboardDismissed=true;resetToolApprovals();await refreshToolApprovals();renderConversationApprovals();scrollBottom(true);updateComposer();},theme);await page.locator('#approval-bar .tool-approval').first().waitFor();await capture(theme,'approval');
    await page.evaluate(()=>{uiCore.activity.unreadCount=3;syncMobileTabs();});await page.locator('#mobile-bottom-tabs:not([hidden])').waitFor();await capture(theme,'navigation');
  }
  assert.deepEqual(report.errors,[]);report.result='passed';report.stage='captured';
}catch(error){report.result='unavailable';report.reason=String(error.message).replace(/[A-Za-z]:\\Users\\[^\\]+/g,'C:\\Users\\<user>');if(nativePage){await nativePage.screenshot({path:resolve('.local/mob-3/native-failure.png')}).catch(()=>{});report.uiReady=await nativePage.evaluate(()=>({scripts:typeof call,booted:typeof state!=='undefined'&&state.booted,bridge:!!window.weftNative?.onmessage})).catch(()=>null);}console.log(report.stage,report.reason);}
finally{
  if(installed){try{run('shell','run-as',pkg,'touch','files/and3-probe.done');}catch{}try{run('shell','am','force-stop',pkg+'.test');run('shell','am','force-stop',pkg);run('uninstall',pkg+'.test');run('uninstall',pkg);}catch{}}
  instrumentation?.kill();try{await browser?.close();}catch{}if(serial&&forward)try{run('forward','--remove','tcp:'+forward);}catch{}for(const port of reversed)if(serial)try{run('reverse','--remove','tcp:'+port);}catch{}
  await f?.close();if(serial)try{execFileSync(adbExecutable,['disconnect',serial],{windowsHide:true,timeout:10000});}catch{}if(lease)await unlink(lock).catch(()=>{});
  await writeFile(join(out,'android-verification.json'),JSON.stringify(report,null,2)+'\n');
}
