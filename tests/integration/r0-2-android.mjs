import { evidencePath } from '../helpers/evidence-path.mjs';
/** R0-2 native screenshots: existing shell, external test probe, synthetic local account only. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, openSync, closeSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { managedMkdtempSync, managedTempRoot, disposeManagedTemp } from '../helpers/managed-temp.mjs';
import { startR02Fixture } from '../helpers/r0-2-fixture.mjs';
import { createSystemStatusManager } from '../../src/system-status-runtime.mjs';
import { createHostDiagnostics } from '../../src/host-diagnostics.mjs';
import { systemBarDifference } from '../../scripts/nightly/system-bars.mjs';

process.env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
const repository=resolve(import.meta.dirname,'../..'),out=evidencePath('r0-2');mkdirSync(out,{recursive:true});
const adb='D:/Software/MuMuPlayer/nx_main/adb.exe',manager='D:/Software/MuMuPlayer/nx_main/MuMuManager.exe';
const pkg='com.memoweft.weftmate.mobile.r02',locks='D:/AIProjects/WeftMate/Runtime/Orchestrator';
const root=managedMkdtempSync(join(managedTempRoot(),'weftmate-r0-2-android-'));
const pause=ms=>new Promise(done=>setTimeout(done,ms));
const run=(file,args,options={})=>execFileSync(file,args,{encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:16*1024*1024,...options});
let serial,heavy,mumu,fixture,browser,instrument,debugPort,reversePort,installed=false,testInstalled=false,priorSize,priorDensity,priorPolicy,priorNavigationOverlay,policyChanged=false,overlayChanged=false,probeOutput='';
const report={synthetic:true,realAndroid:true,realModelRequests:0,packageName:pkg,screenshots:[],checks:[],cleanup:{}};
const android=(...args)=>run(adb,['-s',serial,...args]);
async function until(check,label,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){try{const value=await check();if(value)return value;}catch{}await pause(200);}throw Error('R0-2 Android timed out: '+label);}
function lock(file,label){const fd=openSync(file,'wx');writeFileSync(fd,`R0-2 ${new Date().toISOString()} ${label}\n`);closeSync(fd);return file;}
async function command(file,args,options={}){
  const child=spawn(file,args,{windowsHide:true,...options});let output='';child.stdout?.on('data',v=>output+=v);child.stderr?.on('data',v=>output+=v);
  const code=await new Promise((done,reject)=>{child.on('error',reject);child.on('exit',done)});
  assert.equal(code,0,'Native build failed: '+output.slice(-3000).replaceAll(repository,'<worktree>').replace(/C:[\\/]Users[\\/][^\\/\s]+/gi,'C:/Users/<user>'));
}
function restoredValue(raw,kind){const override=raw.match(new RegExp('Override '+kind+':\\s*([^\\r\\n]+)'));return override?.[1]?.trim()||'reset';}
async function attach(){
  if(browser){await browser.close().catch(()=>{});browser=null;}
  if(debugPort){android('forward','--remove',`tcp:${debugPort}`);debugPort=null;}
  const pid=await until(()=>android('shell','pidof',pkg).trim(),'native process');
  debugPort=android('forward','tcp:0',`localabstract:webview_devtools_remote_${pid}`).trim();
  await until(async()=>{const rows=await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json();return rows.some(row=>row.url.includes('appassets'));},'WebView debugging');
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`,{noDefaults:true});
  const page=browser.contexts()[0].pages().find(page=>page.url().includes('appassets'));assert.ok(page,'Real appassets WebView');page.setDefaultTimeout(25000);
  await page.waitForFunction(()=>typeof state!=='undefined'&&state.booted&&state.loggedIn);
  await page.evaluate(()=>page('system'));await page.locator('.mobile-system-component').first().waitFor();return page;
}
async function shot(page,width,theme,scene){
  await pause(400);
  const png=run(adb,['-s',serial,'exec-out','screencap','-p'],{encoding:null});
  const name=`android-native-${width}-${theme}-${scene}.png`;writeFileSync(join(out,name),png);
  const geometry=await page.evaluate(()=>({scale:devicePixelRatio,width:innerWidth,height:innerHeight,pageTheme:document.documentElement.dataset.theme,
    systemDark:state.nativeSystemDark,status:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--native-safe-top')),
    navigation:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--native-safe-bottom')),
    horizontalOverflow:document.documentElement.scrollWidth>innerWidth}));
  const difference=systemBarDifference(png,{statusHeight:geometry.status*geometry.scale});
  assert.equal(geometry.width,width,'Native CSS viewport');assert.equal(geometry.pageTheme,theme);assert.equal(geometry.horizontalOverflow,false);assert.ok(difference.passed,'Native status bar matches header');
  report.screenshots.push({name,...geometry,systemVersion:report.androidVersion,bottomNavigationVisible:geometry.navigation>0,statusDifference:difference});
  writeFileSync(join(out,'android-native-report.json'),JSON.stringify(report,null,2)+'\n');
}
const probe=`package com.memoweft.weftmate.mobile
import android.content.Intent
import android.webkit.WebView
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test
import java.io.File
class R02NativeProbeTest {
 @Test fun inspectSyntheticSystem() {
  val i=InstrumentationRegistry.getInstrumentation()
  val c=i.targetContext
  check(c.packageName=="${pkg}")
  val a=InstrumentationRegistry.getArguments()
  check(a.getString("r02Probe")=="1")
  val host=PersonalApi().login(a.getString("host")!!,a.getString("username")!!,a.getString("password")!!,"R0-2 synthetic")
  SecureSettings(c).saveHost(host)
  val done=File(c.filesDir,"r0-2-probe.done");done.delete()
  i.runOnMainSync { WebView.setWebContentsDebuggingEnabled(true) }
  i.startActivitySync(Intent(c,HybridActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  try {
   val end=System.currentTimeMillis()+5*60*1000
   while(!done.exists()&&System.currentTimeMillis()<end)Thread.sleep(200)
   check(done.exists()) { "R0-2 native probe timed out" }
  } finally { i.runOnMainSync { WebView.setWebContentsDebuggingEnabled(false) };done.delete() }
 }
}
`;
try{
  for(let slot=1;slot<=3;slot++){try{heavy=lock(join(locks,`heavy-${slot}.lock`),'native build and screenshots');break;}catch(error){if(error.code!=='EEXIST')throw error;}}
  assert.ok(heavy,'No heavy slot free; retry once root has released its slot');
  mumu=lock(join(locks,'mumu.lock'),'native screenshots');
  const info=JSON.parse(run(manager,['info','-v','0']));assert.ok(info.is_android_started,'Existing MuMu must be started');assert.ok(Number(info.adb_port)>0);serial=`127.0.0.1:${info.adb_port}`;
  run(adb,['connect',serial]);
  report.existingPackages=android('shell','pm','list','packages','weftmate').split(/\r?\n/).filter(Boolean).map(v=>v.replace(/^package:/,''));
  assert.ok(!report.existingPackages.includes(pkg)&&!report.existingPackages.includes(pkg+'.test'),'Do not overwrite existing native QA package');
  const active=android('shell','ps','-A').split(/\r?\n/).filter(v=>v.includes('com.memoweft.weftmate'));
  assert.deepEqual(active,[],'MuMu occupied by another active WeftMate package; leave it untouched');
  priorSize=android('shell','wm','size');priorDensity=android('shell','wm','density');
  report.androidVersion=android('shell','getprop','ro.build.version.release').trim();report.systemNightMode=android('shell','cmd','uimode','night').trim();
  // Reveal the real SystemUI navigation region through ordinary, reversible
  // emulator settings. Never paint a pretend system bar into the screenshot.
  priorPolicy=android('shell','settings','get','global','policy_control').trim();
  const overlayList=android('shell','cmd','overlay','list','--user','0');
  priorNavigationOverlay=overlayList.match(/\[x\]\s+(com\.android\.internal\.systemui\.navbar\.[^\s]+)/)?.[1];
  report.navigationAttempt={policyHadImmersiveRule:/immersive/.test(priorPolicy),initialOverlay:priorNavigationOverlay||'none',
    hardwareKeys:android('shell','getprop','qemu.hw.mainkeys').trim()||'not-set'};
  if(/immersive/.test(priorPolicy)){android('shell','settings','delete','global','policy_control');policyChanged=true;}
  if(priorNavigationOverlay&&priorNavigationOverlay!=='com.android.internal.systemui.navbar.threebutton'&&overlayList.includes('com.android.internal.systemui.navbar.threebutton')){
    try{android('shell','cmd','overlay','enable-exclusive','--user','0','--category','com.android.internal.systemui.navbar.threebutton');overlayChanged=true;report.navigationAttempt.threeButtonOverlayEnabled=true;}
    catch{report.navigationAttempt.threeButtonOverlayEnabled=false;}
  }
  const source=join(root,'probe');mkdirSync(source);writeFileSync(join(source,'R02NativeProbeTest.kt'),probe);
  const init=join(root,'probe.gradle');writeFileSync(init,`gradle.projectsEvaluated { rootProject.project(':app').android.sourceSets.androidTest.java.srcDir('${source.replaceAll('\\','/')}') }\n`);
  const build=join(root,'build.ps1');writeFileSync(build,`. D:/AIProjects/AIGame/Repository/runtime/toolchains/activate-android.ps1\ngradle --offline -I '${init}' '-PweftmateApplicationId=${pkg}' :app:assembleDebug :app:assembleDebugAndroidTest --console=plain --no-daemon\nexit $LASTEXITCODE\n`);
  await command('pwsh',['-NoProfile','-File',build],{cwd:join(repository,'apps/android')});
  const metadata=JSON.parse(readFileSync(join(repository,'apps/android/app/build/outputs/apk/debug/output-metadata.json'),'utf8'));
  assert.equal(metadata.applicationId,pkg);report.nativeVersion=metadata.elements[0].versionName;report.nativeVersionCode=metadata.elements[0].versionCode;
  report.checks.push('existing-shell-built-with-current-www-no-native-source-or-version-edits');
  android('install',join(repository,'apps/android/app/build/outputs/apk/debug/app-debug.apk'));installed=true;
  android('install',join(repository,'apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'));testInstalled=true;
  const diagnostics=createHostDiagnostics(root,{version:'0.1.0'});diagnostics.begin({mode:'personal-host'});
  let modelReady=true;
  const status=createSystemStatusManager({readHost:()=>({state:'ready',version:'0.1.0'}),readMemory:()=>({state:'ready',runtime:{semantic_recall:{state:'ready'}}}),
    readModel:()=>({configured:true,state:modelReady?'ready':'unavailable'}),readRelay:()=>({state:'online',certificateExpiresAt:'2030-01-01T00:00:00Z'}),
    diagnostics,repairs:{},metrics:()=>({startupMs:1200,firstTokenMs:[800,1100,900],rssBytes:120*1024**2}),versions:()=>({appVersion:'0.1.0'})});
  fixture=await startR02Fixture({root,systemManager:status});reversePort=new URL(fixture.origin).port;android('reverse',`tcp:${reversePort}`,`tcp:${reversePort}`);
  android('shell','wm','density','160');android('shell','wm','size','360x780');
  instrument=spawn(adb,['-s',serial,'shell','am','instrument','-w','-e','class','com.memoweft.weftmate.mobile.R02NativeProbeTest','-e','r02Probe','1',
    '-e','host',fixture.origin,'-e','username',fixture.credentials.username,'-e','password',fixture.credentials.password,`${pkg}.test/androidx.test.runner.AndroidJUnitRunner`],{windowsHide:true});
  instrument.stdout.on('data',v=>probeOutput+=v);instrument.stderr.on('data',v=>probeOutput+=v);
  for(const width of [360,390]){
    if(width!==360)android('shell','wm','size','390x844');
    let page=await attach();assert.equal(await page.locator('.mobile-system-component').count(),5);
    for(const theme of ['light','dark']){
      await page.evaluate(async theme=>{await call('settings.appearance',{value:theme});applyTheme(theme);},theme);
      await page.locator('.mobile-system-component').first().scrollIntoViewIfNeeded();await shot(page,width,theme,'status');
      await page.locator('[data-metric="startup"]').scrollIntoViewIfNeeded();await shot(page,width,theme,'metrics');
    }
    assert.equal(await page.getByRole('button',{name:/^修复|^重启|导出诊断包/}).count(),0);
    modelReady=false;await page.getByRole('button',{name:'刷新系统状态',exact:true}).click();await page.locator('[data-component="model"][data-state="problem"]').waitFor();
    for(const theme of ['light','dark']){
      await page.evaluate(async theme=>{await call('settings.appearance',{value:theme});applyTheme(theme);},theme);
      await page.locator('[data-component="model"]').scrollIntoViewIfNeeded();await shot(page,width,theme,'model-unreachable');
    }
    modelReady=true;await page.getByRole('button',{name:'刷新系统状态',exact:true}).click();await page.locator('[data-component="model"][data-state="healthy"]').waitFor();
  }
  report.checks.push('real-native-local-login-existing-system-route-five-components-three-metrics','read-only-controls-no-repair-or-package-export','unreachable-model-status-refresh-recovery');
  android('shell','run-as',pkg,'touch','files/r0-2-probe.done');await until(()=>instrument.exitCode!==null,'instrumentation clean exit',15000);
  assert.match(probeOutput,/OK \(1 test\)/,'Native instrumentation successful');report.instrumentationPassed=true;
  report.nativeSystemBarsComplete=report.screenshots.every(item=>item.bottomNavigationVisible&&item.statusDifference.passed);
  if(!report.nativeSystemBarsComplete)report.remaining='MuMu exposes no bottom navigation inset after inspecting immersive policy and navigation overlays; original full-screen status bars verified, bottom navigation needs a visible native SystemUI navigation region on a real device.';
} finally {
  if(browser)await browser.close().catch(()=>{});
  if(instrument&&instrument.exitCode===null){try{android('shell','run-as',pkg,'touch','files/r0-2-probe.done');await until(()=>instrument.exitCode!==null,'probe cleanup',10000);}catch{}if(instrument.exitCode===null){instrument.kill();report.cleanup.killedProbe=1;}}
  if(serial&&installed)try{android('shell','am','force-stop',pkg);report.cleanup.forceStoppedNativeApp=true;}catch{}
  if(serial&&debugPort)try{android('forward','--remove',`tcp:${debugPort}`);}catch{}
  if(serial&&reversePort)try{android('reverse','--remove',`tcp:${reversePort}`);}catch{}
  if(serial&&priorSize)try{android('shell','wm','size',restoredValue(priorSize,'size'));report.cleanup.sizeRestored=true;}catch{}
  if(serial&&priorDensity)try{android('shell','wm','density',restoredValue(priorDensity,'density'));report.cleanup.densityRestored=true;}catch{}
  if(serial&&overlayChanged)try{android('shell','cmd','overlay','enable-exclusive','--user','0','--category',priorNavigationOverlay);report.cleanup.navigationOverlayRestored=true;}catch{}
  if(serial&&policyChanged)try{if(priorPolicy==='null')android('shell','settings','delete','global','policy_control');else android('shell','settings','put','global','policy_control',priorPolicy);report.cleanup.immersivePolicyRestored=true;}catch{}
  if(serial&&testInstalled)try{android('uninstall',pkg+'.test');report.cleanup.testPackageRemoved=true;}catch{}
  if(serial&&installed)try{android('uninstall',pkg);report.cleanup.packageRemoved=true;}catch{}
  if(serial)try{run(adb,['disconnect',serial]);report.cleanup.adbDisconnected=true;}catch{}
  if(fixture)await fixture.close();
  disposeManagedTemp(root,{log:()=>{}});report.cleanup.tempRemoved=true;
  if(mumu)rmSync(mumu);if(heavy)rmSync(heavy);
  writeFileSync(join(out,'android-native-report.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({screenshots:report.screenshots.length,checks:report.checks.length,instrumentationPassed:report.instrumentationPassed,nativeSystemBarsComplete:report.nativeSystemBarsComplete,cleanup:report.cleanup}));
