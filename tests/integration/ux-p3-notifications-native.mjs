/** Real Android NotificationManager/shade, synthetic DSH host, isolated QA APK. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';

const root=resolve(import.meta.dirname,'../..'),out=join(root,'tests/evidence/ux-p3');mkdirSync(out,{recursive:true});
const adb='D:/Software/MuMuPlayer/nx_main/adb.exe',cli='D:/Software/MuMuPlayer/nx_main/mumu-cli.exe',pkg='com.memoweft.weftmate.mobile.uxp3qa';
let serial='127.0.0.1:7555';
const run=(file,args,options={})=>execFileSync(file,args,{encoding:'utf8',windowsHide:true,maxBuffer:12*1024*1024,...options});
const android=(...args)=>run(adb,['-s',serial,...args]);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label,timeout=60000){const end=Date.now()+timeout;while(Date.now()<end){const result=await check();if(result)return result;await pause(400);}throw Error('UX-P3 native timeout: '+label);}
async function command(file,args,options={}){const child=spawn(file,args,{windowsHide:true,...options});let output='';child.stdout?.on('data',value=>{output+=value;});child.stderr?.on('data',value=>{output+=value;});const code=await new Promise(resolve=>child.on('exit',resolve));assert.equal(code,0,output.slice(-6000));return output;}
const temp=mkdtempSync(join(tmpdir(),'weftmate-ux-p3-notifications-'));
let ownEmulator=false,installed=false,testInstalled=false,fixture,instrument,reversePort,priorNight,log='';
const report={realAndroid:true,packageName:pkg,syntheticAccount:true,randomHostPorts:true,beforeReference:'tests/evidence/s3a/background-notifications-dark.png',checks:[],records:[],cleanup:{}};
const probe=`package com.memoweft.weftmate.mobile
import android.app.Notification
import android.app.NotificationManager
import android.content.Intent
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test
import java.io.File
class UxP3NotificationProbeTest {
 @Test fun inspectRealNotifications() {
  val instrumentation=InstrumentationRegistry.getInstrumentation()
  val context=instrumentation.targetContext
  check(context.packageName=="${pkg}")
  val args=InstrumentationRegistry.getArguments()
  val done=File(context.filesDir,"ux-p3-probe.done");done.delete()
  val host=PersonalApi().login(args.getString("host")!!,args.getString("username")!!,args.getString("password")!!,"UX-P3 合成安卓")
  SecureSettings(context).saveHost(host)
  instrumentation.startActivitySync(Intent(context,HybridActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  try {
   val end=System.currentTimeMillis()+5*60*1000
   while(!done.exists()&&System.currentTimeMillis()<end) {
    ActivityNotifications(context).poll(host,current={true})
    val rows=org.json.JSONArray()
    for(item in context.getSystemService(NotificationManager::class.java).activeNotifications) {
     val n=item.notification
     rows.put(org.json.JSONObject().put("tag",item.tag).put("title",n.extras.getString(Notification.EXTRA_TITLE))
      .put("body",n.extras.getString(Notification.EXTRA_TEXT)).put("channel",n.channelId)
      .put("ongoing",n.flags and Notification.FLAG_ONGOING_EVENT!=0))
    }
    File(context.filesDir,"ux-p3-notification-records.json").writeText(rows.toString())
    Thread.sleep(400)
   }
   check(done.exists()) { "UX-P3 notification probe timed out" }
  } finally { done.delete() }
 }
}
`;
const records=()=>{try{return JSON.parse(android('shell','run-as',pkg,'cat','files/ux-p3-notification-records.json'));}catch{return [];}};
async function stopProbe(){if(instrument){try{android('shell','run-as',pkg,'touch','files/ux-p3-probe.done');await until(()=>instrument.exitCode!==null,'probe clean exit',15000);}finally{if(instrument.exitCode===null)instrument.kill();instrument=null;}}if(installed)android('shell','am','force-stop',pkg);if(reversePort){android('reverse','--remove',`tcp:${reversePort}`);reversePort=null;}if(fixture){const hostRoot=fixture.root;await fixture.close();assert.ok(hostRoot.startsWith(join(tmpdir(),'weftmate-m0-3-')));rmSync(hostRoot,{recursive:true,force:true});fixture=null;}}
try{
  const initial=JSON.parse(run(cli,['info','--vmindex','0']));
  if(initial.adb_port)serial=`127.0.0.1:${initial.adb_port}`;
  if(initial.is_process_started||initial.is_android_started){
    run(adb,['connect',serial]);
    const active=android('shell','ps','-A').split('\n').filter(row=>row.includes('weftmate'));
    assert.deepEqual(active,[],'MuMu occupied by another active WeftMate package; leave it untouched');
  }
  const probeDir=join(temp,'probe');mkdirSync(probeDir);writeFileSync(join(probeDir,'UxP3NotificationProbeTest.kt'),probe);
  const init=join(temp,'probe.gradle');writeFileSync(init,`gradle.projectsEvaluated { rootProject.project(':app').android.sourceSets.androidTest.java.srcDir('${probeDir.replaceAll('\\','/')}') }\n`);
  const build=join(temp,'build.ps1');writeFileSync(build,`. D:/AIProjects/AIGame/Repository/runtime/toolchains/activate-android.ps1\ngradle --offline -I '${init}' '-PweftmateApplicationId=${pkg}' :app:assembleDebug :app:assembleDebugAndroidTest --console=plain --no-daemon\nexit $LASTEXITCODE\n`);
  await command('pwsh',['-NoProfile','-File',build],{cwd:join(root,'apps/android')});
  report.checks.push('isolated-native-apk-and-instrumentation-built-without-version-change');
  const beforeLaunch=JSON.parse(run(cli,['info','--vmindex','0']));
  if(!initial.is_process_started&&!initial.is_android_started){
    assert.ok(!beforeLaunch.is_process_started&&!beforeLaunch.is_android_started,'another work package started MuMu while building');
    run(cli,['control','--vmindex','0','launch']);ownEmulator=true;
  }
  if(ownEmulator)await until(()=>{try{run(cli,['control','--vmindex','0','hide_window']);return true;}catch{return false;}},'hide owned emulator window',60000);
  const launched=JSON.parse(run(cli,['info','--vmindex','0']));if(launched.adb_port)serial=`127.0.0.1:${launched.adb_port}`;
  report.serial=serial;
  await until(()=>{try{run(adb,['connect',serial]);return android('shell','getprop','sys.boot_completed').trim()==='1';}catch{return false;}},'Android boot',90000);
  const active=android('shell','ps','-A').split('\n').filter(row=>row.includes('weftmate'));
  assert.deepEqual(active,[],'MuMu occupied by another active WeftMate package');
  const packages=android('shell','pm','list','packages','weftmate');
  report.existingPackages=packages.trim().split('\n').filter(Boolean);
  const installedNames=packages.split(/\r?\n/).map(value=>value.replace(/^package:/,''));
  assert.ok(!installedNames.includes(pkg)&&!installedNames.includes(pkg+'.test'),'QA app or probe already installed: refuse overwrite');
  android('install',join(root,'apps/android/app/build/outputs/apk/debug/app-debug.apk'));installed=true;
  android('install',join(root,'apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'));testInstalled=true;
  android('shell','pm','grant',pkg,'android.permission.POST_NOTIFICATIONS');
  priorNight=android('shell','cmd','uimode','night').match(/(auto|yes|no)/)?.[1]||'no';
  for(const scenario of ['completed','failed','approval','reminder']){
    fixture=await startTimelineCandidate({daily:true,sidebar:true,inlineProgress:true,s3a:true,historyCount:0,baseTime:Date.now()-10000});
    await fixture.request(`/sessions/${fixture.sessionId}/metadata`,{title:scenario==='failed'?'整理资料摘要':'整理项目资料'},'PATCH');
    const initialActivities=await fixture.request('/activity');
    await fixture.request('/activity/read',{requestId:crypto.randomUUID(),through:initialActivities.snapshotCursor});
    if(scenario==='approval')await fixture.progress.approve('ux-p3-save','保存项目摘要');
    else if(scenario==='reminder')fixture.deliverReminder('下午三点查看项目资料');
    else {fixture.progress.call('read','ux-p3-read',{paths:['synthetic.md']});fixture.progress.result('ux-p3-read','Synthetic file read.');if(scenario==='failed')fixture.progress.text('文件已被移动，无法读取。');fixture.progress.finish(scenario==='failed'?'error':'completed');}
    const expectedType={completed:'task.completed',failed:'task.failed',approval:'approval.pending',reminder:'reminder.triggered'}[scenario];
    const activity=await until(async()=>(await fixture.request('/activity')).items.find(row=>row.type===expectedType),'host '+scenario);
    reversePort=new URL(fixture.origin).port;android('reverse',`tcp:${reversePort}`,`tcp:${reversePort}`);
    instrument=spawn(adb,['-s',serial,'shell','am','instrument','-w','-e','class','com.memoweft.weftmate.mobile.UxP3NotificationProbeTest','-e','host',fixture.origin,'-e','username',fixture.credentials.username,'-e','password',fixture.credentials.password,`${pkg}.test/androidx.test.runner.AndroidJUnitRunner`],{windowsHide:true});
    let scenarioLog='';instrument.stdout.on('data',value=>{scenarioLog+=value;});instrument.stderr.on('data',value=>{scenarioLog+=value;});
    const native=await until(()=>records().find(row=>row.tag.endsWith(':'+activity.id)),'native '+scenario);
    assert.equal(native.title,activity.notification.title);assert.equal(native.body,activity.notification.body);assert.equal(native.ongoing,false);
    if(scenario==='completed')assert.equal(native.body,'已完成 · 点开查看结果');
    if(scenario==='failed')assert.equal(native.body,'文件已被移动，无法读取。');
    if(scenario==='approval')assert.ok(native.body.startsWith('需要你批准：'));
    if(scenario==='reminder')assert.equal(native.body,'下午三点查看项目资料');
    for(const theme of ['light','dark']){
      android('shell','cmd','uimode','night',theme==='dark'?'yes':'no');android('shell','input','keyevent','3');
      android('shell','cmd','statusbar','expand-notifications');await pause(800);
      const file=`notification-${scenario}-${theme}.png`;
      writeFileSync(join(out,file),execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{windowsHide:true,maxBuffer:12*1024*1024}));
      report.records.push({scenario,theme,screenshot:file,host:{type:activity.type,title:activity.notification.title,body:activity.notification.body},native});
      android('shell','cmd','statusbar','collapse');
    }
    report.checks.push(`${scenario}-host-copy-equals-real-notification-title-body-light-dark`);
    await fixture.request(`/activity/${activity.id}/read`,{requestId:crypto.randomUUID(),read:true,attentionRevision:activity.attentionRevision},'PATCH');
    await until(()=>!records().some(row=>row.tag.endsWith(':'+activity.id)),'notification read cancellation');
    await stopProbe();assert.ok(!scenarioLog.includes('FAILURES'),scenarioLog);log+=scenarioLog;
    android('shell','am','force-stop',pkg);
  }
  report.checks.push('all-four-original-host-event-types','no-real-model','read-notification-cancels','private-daily-data-untouched');
}catch(error){report.error=error.message;throw error;}
finally{
  await stopProbe().catch(error=>{report.cleanup.probeError=error.message;});
  if(priorNight)try{android('shell','cmd','uimode','night',priorNight);}catch{}
  if(testInstalled){try{android('uninstall',pkg+'.test');report.cleanup.testUninstalled=true;}catch{}}
  if(installed){try{android('uninstall',pkg);report.cleanup.appUninstalled=true;}catch{}}
  if(ownEmulator){run(cli,['control','--vmindex','0','shutdown']);await until(()=>{const info=JSON.parse(run(cli,['info','--vmindex','0']));return !info.is_process_started&&!info.is_android_started;},'owned emulator shutdown',30000);report.cleanup.ownedEmulatorShutdown=true;}
  assert.ok(temp.startsWith(join(tmpdir(),'weftmate-ux-p3-notifications-')));rmSync(temp,{recursive:true,force:true});report.cleanup.tempRemoved=true;
  report.cleanup.forwardCreated=false;report.cleanup.reverseRemoved=!reversePort;report.cleanup.instrumentEnded=!instrument;
  writeFileSync(join(out,'notification-checks.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}
