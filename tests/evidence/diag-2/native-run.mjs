/** Isolated MuMu acceptance. Never changes emulator settings or calls a model. */
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { open, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve, relative, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { startFe1bFixture } from '../../integration/fe-1b-fixture.mjs';
import { systemBarDifference } from '../../../scripts/nightly/system-bars.mjs';
const root=resolve(import.meta.dirname,'../../..'),out=import.meta.dirname;
const locks='D:/AIProjects/WeftMate/Runtime/Orchestrator',adb=process.env.DIAG2_ADB||'D:/Software/MuMuPlayer/nx_main/adb.exe';
const adbServer=process.env.DIAG2_ADB_SERVER_PORT?['-P',process.env.DIAG2_ADB_SERVER_PORT]:[];
const pkg='com.memoweft.weftmate.mobile.diag2qa',receiver='com.memoweft.weftmate.mobile.DiagnosticQaReceiver';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const execute=promisify(execFile);
let heavy,mumu,serial,fixture,browser,port,installed=false,reversed=false;
const report={platform:'android',synthetic:true,realModelRequests:0,screenshots:[],scenarios:[],instrumentation:[],validationFailures:[]};
async function lock(path,label){const handle=await open(path,'wx');await handle.writeFile(`DIAG-2 ${new Date().toISOString()} ${label}\n`);await handle.close();return path;}
const run=(...args)=>execFileSync(adb,[...adbServer,'-s',serial,...args],{encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});
function journalRows(){
  const names=run('shell','run-as',pkg,'ls','no_backup/diagnostics').trim().split(/\s+/)
    .filter(name=>/^android-\d{4}-\d{2}-\d{2}(?:-\d+)?\.jsonl$/.test(name));
  return names.map(name=>run('shell','run-as',pkg,'cat',`no_backup/diagnostics/${name}`)).join('');
}
async function until(check,label){for(let i=0;i<150;i++){try{const value=await check();if(value)return value;}catch{}await pause(200);}throw Error(`Timed out: ${label}`);}
async function attach(){
  if(browser){await browser.close().catch(()=>{});browser=null;}
  if(port){try{run('forward','--remove',`tcp:${port}`);}catch{}port=null;}
  run('shell','am','broadcast','-n',`${pkg}/${receiver}`);
  run('shell','am','start','-n',`${pkg}/com.memoweft.weftmate.mobile.HybridActivity`);
  const pid=await until(()=>run('shell','pidof',pkg).trim(),'app process');
  const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));port=reservation.address().port;await new Promise(r=>reservation.close(r));
  run('forward',`tcp:${port}`,`localabstract:webview_devtools_remote_${pid}`);
  await until(async()=>{const rows=await (await fetch(`http://127.0.0.1:${port}/json`)).json();return rows.some(row=>row.url.includes('appassets'));},'WebView debugging');
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{noDefaults:true});
  const page=browser.contexts()[0].pages().find(page=>page.url().includes('appassets'));assert.ok(page);
  page.setDefaultTimeout(20000);
  await page.waitForFunction(()=>typeof call==='function'&&state.booted);
  return page;
}
async function shot(page,name){
  await pause(450);
  const png=execFileSync(adb,[...adbServer,'-s',serial,'exec-out','screencap','-p'],{windowsHide:true,maxBuffer:16*1024*1024});
  await writeFile(join(out,`${name}.png`),png);
  const geometry=await page.evaluate(()=>({scale:devicePixelRatio,status:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--native-safe-top')),
    navigation:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--native-safe-bottom')),
    theme:document.documentElement.dataset.theme,systemDark:state.nativeSystemDark,width:innerWidth,height:innerHeight}));
  const difference=systemBarDifference(png,{statusHeight:geometry.status*geometry.scale});
  assert.equal(geometry.theme,name.startsWith('light-')?'light':'dark',`Actual page theme: ${name}`);
  report.screenshots.push({name:`${name}.png`,...geometry,systemVersion:report.osVersion,bottomNavigationVisible:geometry.navigation>0,difference});
  assert.ok(difference.passed,`Status bar mismatch: ${name}`);
  await writeFile(join(out,'native-report.json'),JSON.stringify(report,null,2)+'\n');
}
async function records(page){return page.evaluate(()=>call('diagnostics.status'));}
async function themes(page,name){const original=await page.evaluate(()=>document.documentElement.dataset.theme);for(const theme of ['light','dark']){
  await page.evaluate(async theme=>{await call('settings.appearance',{value:theme});applyTheme(theme);},theme);
  await shot(page,`${theme}-${name}`);
}await page.evaluate(async theme=>{await call('settings.appearance',{value:theme});applyTheme(theme);},original);}
async function saveScenario(page,name,extra={}){
  const status=await records(page);const summary=JSON.parse(status.summary);
  await writeFile(join(out,`${name}.json`),JSON.stringify({previous:status.previous,summary},null,2)+'\n');
  report.scenarios.push({name,previous:status.previous,...extra});await writeFile(join(out,'native-report.json'),JSON.stringify(report,null,2)+'\n');return status;
}
async function general(page){await page.evaluate(()=>page('general'));await page.getByRole('heading',{name:'本机（这部手机）',exact:true}).waitFor();await page.locator('.run-records').first().waitFor();}
try {
  await mkdir(out,{recursive:true});
  while(!heavy){
    for(let slot=1;slot<=3;slot++){try{heavy=await lock(join(locks,`heavy-${slot}.lock`),'MuMu DIAG-2 acceptance');break;}catch(error){if(error.code!=='EEXIST')throw error;}}
    if(!heavy){console.log('DIAG-2 waiting for a heavy slot');await pause(120000);}
  }
  mumu=await lock(join(locks,'mumu.lock'),'MuMu DIAG-2 acceptance');
  for(const name of await readdir(out))if(/^(?:light|dark)-.*\.png$/.test(name)||/^(?:cold-start|force-stop|background-resume|uncaught-crash|renderer-crash|runtime-web-error|android-summary|native-report)\.json$/.test(name)||name==='android-events.jsonl')await rm(join(out,name));
  const info=JSON.parse(execFileSync('D:/Software/MuMuPlayer/nx_main/MuMuManager.exe',['info','-v','0'],{encoding:'utf8',windowsHide:true}));
  const details=info[0]??info;const adbPort=details.adb_port??details.vm?.adb_port;assert.ok(Number(adbPort)>0,'Manager must provide adb_port');
  serial=`127.0.0.1:${adbPort}`;execFileSync(adb,[...adbServer,'connect',serial],{windowsHide:true});
  const packages=run('shell','pm','list','packages').split('\n').filter(row=>row.includes('weftmate'));report.packageInventory=packages.map(row=>row.trim().replace('package:',''));
  assert.ok(!packages.some(row=>row.trim()===`package:${pkg}`),'Test package already installed');
  assert.ok(!run('shell','ps','-A').split('\n').some(row=>row.includes('com.memoweft.weftmate')),'Another WeftMate package is running');
  fixture=await startFe1bFixture();
  const hostPort=new URL(fixture.origin).port;run('reverse',`tcp:${hostPort}`,`tcp:${hostPort}`);reversed=true;
  run('install',join(root,'apps/android/app/build/outputs/apk/debug/app-debug.apk'));installed=true;
  run('install',join(root,'apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'));
  report.osVersion=run('shell','getprop','ro.build.version.release').trim();
  report.systemNightMode=run('shell','cmd','uimode','night').trim();
  for(const method of ['journalAndSummaryOnDevice','seedLocalLogin']){
    const args=['shell','am','instrument','-w','-e','class',`com.memoweft.weftmate.mobile.DiagnosticProbeTest#${method}`];
    if(method==='seedLocalLogin')args.push('-e','host',fixture.credentials.origin,'-e','username',fixture.credentials.username,'-e','password',fixture.credentials.password);
    // The synthetic host lives in this Node event loop, so network-using
    // instrumentation must run asynchronously rather than blocking its server.
    const {stdout:result}=await execute(adb,[...adbServer,'-s',serial,...args,`${pkg}.test/androidx.test.runner.AndroidJUnitRunner`],{windowsHide:true,timeout:120000});
    assert.match(result,/OK \(1 test\)/);report.instrumentation.push({method,passed:true});
  }
  // Instrumentation deliberately restarts its target process. Start the cold
  // launch scenarios with an empty journal, keeping only the synthetic login.
  run('shell','am','force-stop',pkg);
  run('shell','run-as',pkg,'rm','-r','no_backup/diagnostics');
  let page=await attach();
  await page.evaluate(async()=>{await call('settings.appearance',{value:'light'});applyTheme('light');});
  assert.equal((await records(page)).previous?.normal!==false,true);
  await saveScenario(page,'cold-start');await themes(page,'cold-start');
  await general(page);await shot(page,'light-empty-records');
  await page.locator('.run-records').first().getByRole('button',{name:'复制诊断摘要',exact:true}).click();await shot(page,'light-empty-preview');
  await page.evaluate(async()=>{await call('settings.appearance',{value:'dark'});applyTheme('dark');});await shot(page,'dark-empty-preview');
  await page.locator('.run-records').first().getByRole('button',{name:'复制诊断摘要',exact:true}).click();await shot(page,'dark-empty-records');
  // Layout-only error injection leaves the real native journal untouched.
  await page.evaluate(()=>{globalThis.diagRealCall=call;call=(method,...args)=>method==='diagnostics.status'?Promise.reject(new Error('synthetic-read-failure')):diagRealCall(method,...args);page('general');});
  await page.locator('.run-records[data-state="error"]').first().waitFor();await shot(page,'dark-read-error-layout');
  await page.evaluate(async()=>{await call('settings.appearance',{value:'light'});applyTheme('light');});await shot(page,'light-read-error-layout');
  await page.evaluate(()=>{call=diagRealCall;delete globalThis.diagRealCall;page('chat');});
  run('shell','am','force-stop',pkg);await pause(300);
  page=await attach();const forced=await saveScenario(page,'force-stop');
  assert.equal(forced.previous.normal,false);assert.ok(['user_requested','user_stopped'].includes(forced.previous.reason));
  await page.getByRole('button',{name:'查看详情',exact:true}).first().waitFor();await themes(page,'force-stop-notice');
  await page.getByRole('button',{name:'查看详情',exact:true}).first().click();await page.getByRole('heading',{name:'本机（这部手机）',exact:true}).waitFor();await shot(page,'light-run-records');
  await page.locator('.run-records').first().getByRole('button',{name:'复制诊断摘要',exact:true}).click();await shot(page,'light-summary-preview');
  await page.locator('.run-records').first().getByRole('button',{name:'复制摘要',exact:true}).click();
  await page.locator('.run-records').first().getByRole('button',{name:'分享日志文件',exact:true}).click();await pause(700);
  await shot(page,'light-system-share');run('shell','input','keyevent','KEYCODE_BACK');
  await page.evaluate(async()=>{await call('settings.appearance',{value:'dark'});applyTheme('dark');});await pause(300);await shot(page,'dark-summary-preview');
  await page.locator('.run-records').first().getByRole('button',{name:'复制诊断摘要',exact:true}).click();await shot(page,'dark-run-records');
  await page.locator('.run-records').first().getByRole('button',{name:'分享日志文件',exact:true}).click();await pause(700);
  await shot(page,'dark-system-share');run('shell','input','keyevent','KEYCODE_BACK');
  await page.evaluate(()=>page('chat'));run('shell','input','keyevent','KEYCODE_HOME');await pause(600);run('shell','am','start','-n',`${pkg}/com.memoweft.weftmate.mobile.HybridActivity`);await pause(600);
  const afterResume=await saveScenario(page,'background-resume');assert.equal(afterResume.runId,forced.runId);assert.equal(await page.getByRole('button',{name:'查看详情',exact:true,includeHidden:true}).count(),1);
  assert.equal(await page.getByRole('button',{name:'查看详情',exact:true,includeHidden:true}).isVisible(),false);await themes(page,'background-resume');
  // JVM exceptions are handled by the app's actual default uncaught handler.
  const pidBefore=run('shell','pidof',pkg).trim();await browser.close();browser=null;
  report.stage='uncaught-crash';await writeFile(join(out,'native-report.json'),JSON.stringify(report,null,2)+'\n');
  run('shell','am','broadcast','-n',`${pkg}/${receiver}`,'--ez','crash','true');
  await until(()=>{try{return !run('shell','pidof',pkg).trim();}catch{return true;}},'default process crash');
  const logcat=run('logcat','-d','--pid',pidBefore,'AndroidRuntime:E','*:S');
  // Keep this strict check and its failure visible, while completing the other
  // independent acceptance scenes as requested. Android's pre-handler runs
  // before an application's SDK default handler; do not bypass hidden APIs.
  try { assert.ok(!logcat.includes('synthetic private content'),'Private exception message reached logcat');report.logcatPrivateMessageAbsent=true; }
  catch(error){report.logcatPrivateMessageAbsent=false;report.validationFailures.push({check:'system-logcat-private-message',message:error.message,source:'android-runtime-pre-handler'});}
  page=await attach();const crashed=await saveScenario(page,'uncaught-crash');assert.equal(crashed.previous.reason,'crash');assert.equal(crashed.previous.normal,false);
  const crashRows=JSON.parse(crashed.summary).recentAbnormalRecords;assert.ok(crashRows.some(row=>row.event==='app.failure'&&row.fields.source==='native-uncaught'));
  report.defaultCrashEndedProcess=true;
  await themes(page,'uncaught-crash-notice');
  // CDP crash affects the real WebView renderer, not its host app process.
  const oldPid=run('shell','pidof',pkg).trim();await browser.close();browser=null;
  report.stage='renderer-crash';await writeFile(join(out,'native-report.json'),JSON.stringify(report,null,2)+'\n');
  run('shell','am','broadcast','-n',`${pkg}/${receiver}`,'--ez','rendererCrash','true');
  await until(()=>journalRows().includes('webview.recovery'),'native renderer recovery');
  page=await attach();
  assert.equal(run('shell','pidof',pkg).trim(),oldPid);
  const renderer=await saveScenario(page,'renderer-crash');const rendererRows=JSON.parse(renderer.summary).recentAbnormalRecords;
  assert.ok(rendererRows.some(row=>row.event==='webview.process_gone'&&row.fields.didCrash==='true'));
  assert.ok(journalRows().includes('webview.recovery'));
  await themes(page,'renderer-recovered');await general(page);await themes(page,'renderer-run-records');
  await page.evaluate(()=>{window.dispatchEvent(new ErrorEvent('error',{error:new TypeError('synthetic private prompt'),filename:new URL('app.js',location.href).href,lineno:563,colno:9}));});await pause(250);
  await page.evaluate(()=>{void Promise.reject(new RangeError('synthetic private model output'));});await pause(350);
  await saveScenario(page,'runtime-web-error');
  await writeFile(join(out,'android-summary.json'),(await records(page)).summary+'\n');
  const all=journalRows();
  assert.ok(!all.includes('synthetic private')&&!all.includes(fixture.credentials.username)&&!all.includes(fixture.credentials.password)&&!all.includes(fixture.origin));
  await writeFile(join(out,'android-events.jsonl'),all);
  report.defaultCrashEndedProcess=true;report.rendererHostProcessSurvived=true;
  report.stage='functional-scenes-complete';report.functionalScenesPassed=true;report.acceptancePassed=report.validationFailures.length===0;
} finally {
  if(browser)await browser.close().catch(()=>{});
  if(port&&serial)try{run('forward','--remove',`tcp:${port}`);}catch{}
  if(reversed&&fixture)try{const hostPort=new URL(fixture.origin).port;run('reverse','--remove',`tcp:${hostPort}`);}catch{}
  if(installed&&serial)try{await writeFile(join(out,'android-events.jsonl'),journalRows());}catch{}
  if(installed&&serial){try{run('uninstall',`${pkg}.test`);}catch{}try{run('uninstall',pkg);}catch{}
    report.remainingOwnedPackages=run('shell','pm','list','packages').split('\n').filter(row=>row.trim()===`package:${pkg}`||row.trim()===`package:${pkg}.test`);
  }
  if(serial)try{execFileSync(adb,[...adbServer,'disconnect',serial],{windowsHide:true});}catch{}
  if(fixture){await fixture.close();const relativeRoot=relative(resolve(tmpdir()),resolve(fixture.root));assert.ok(!relativeRoot.startsWith('..')&&basename(fixture.root).startsWith('weftmate-fe1b-'));await rm(fixture.root,{recursive:true,force:true});}
  if(mumu)await rm(mumu,{force:true});if(heavy)await rm(heavy,{force:true});
  report.cleanedTestPackages=installed&&report.remainingOwnedPackages.length===0;await writeFile(join(out,'native-report.json'),JSON.stringify(report,null,2)+'\n');
  assert.equal(report.remainingOwnedPackages?.length??0,0,'Owned test packages must be uninstalled');
}
console.log(JSON.stringify({scenarios:report.scenarios.length,screenshots:report.screenshots.length,cleanedTestPackages:report.cleanedTestPackages}));
assert.equal(report.validationFailures.length,0,'Native acceptance retains all failed checks in native-report.json');
