import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {open,writeFile,mkdir,rm,readdir,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {readMuMuInfo,adbExecutable as defaultAdbExecutable,mumuManager} from '../../../scripts/nightly/mumu.mjs';
import {startNativeFixture} from './fixture.mjs';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
const exec=promisify(execFile),root=resolve(import.meta.dirname,'../../..'),out=import.meta.dirname;
const adbExecutable=process.env.AND4_ADB_EXE||defaultAdbExecutable;
const adbServer=process.env.AND4_ADB_SERVER_PORT?['-P',process.env.AND4_ADB_SERVER_PORT]:[];
const locks='D:/AIProjects/WeftMate/Runtime/Orchestrator',pkg='com.memoweft.weftmate.mobile.and4qa';
const metricsOnly=process.argv.includes('--metrics-only');
const flowOnly=process.argv.includes('--flow-only');
let heavy,mumu,serial,fixture,port,installed=false,reversed=false;
let baselineInstalled=false,forwardPort,browser;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const userPrefix=['C:','Users'].join('\\')+'\\';
const sanitize=s=>String(s).replace(new RegExp(userPrefix.replaceAll('\\','\\\\')+'[^\\\\\\s]+','gi'),userPrefix+'<user>').replace(/DESKTOP-[A-Z0-9-]+/gi,'<host>');
const report={synthetic:true,model:'mimo-v2.6-flash',instrumentation:[],screenshots:[],requests:[],mimoRequests:0};
const run=(...args)=>execFileSync(adbExecutable,[...adbServer,'-s',serial,...args],{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024,timeout:30000});
async function acquire(path,label){const f=await open(path,'wx');await f.writeFile(`AND-4 ${new Date().toISOString()} ${label}`);await f.close();return path;}
async function until(check,label){for(let i=0;i<300;i++){if(await check())return;await pause(200);}throw Error(`Timed out: ${label}`);}
try{
  await mkdir(out,{recursive:true});
  while(!heavy){for(let i=1;i<=3;i++)try{heavy=await acquire(join(locks,`heavy-${i}.lock`),'native MuMu acceptance');break;}catch(e){if(e.code!=='EEXIST')throw e;}if(!heavy){process.stdout.write('Waiting for heavy slot\n');await pause(60000);}}
  while(!mumu){try{mumu=await acquire(join(locks,'mumu.lock'),'native MuMu acceptance');}catch(e){if(e.code!=='EEXIST')throw e;process.stdout.write('Waiting for MuMu ownership\n');await pause(60000);}}
  const info=readMuMuInfo();serial=info.serial;execFileSync(adbExecutable,[...adbServer,'connect',serial],{windowsHide:true,timeout:30000});
  const packages=run('shell','pm','list','packages').split(/\r?\n/).filter(s=>s.includes('weftmate')&&/qa/.test(s)&&!s.includes('and4qa'));
  if(packages.length)throw Error(`Other isolated packages installed: ${packages.join(', ')}`);
  report.systemVersion=run('shell','getprop','ro.build.version.release').trim();report.emulatorAlreadyRunning=true;
  fixture=await startNativeFixture(process.env.MIMO_API_KEY);port=new URL(fixture.origin).port;
  run('reverse',`tcp:${port}`,`tcp:${port}`);reversed=true;
  run('install','-r',join(root,'apps/android/app/build/outputs/apk/debug/app-debug.apk'));installed=true;
  if(!metricsOnly)run('install','-r',join(root,'apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'));
  if(metricsOnly) {
    run('shell','am','start','-n',`${pkg}/com.memoweft.weftmate.mobile.NativeActivity`,'--es','lg1bHostOrigin',fixture.origin);await pause(900);
    run('shell','am','broadcast','-n',`${pkg}/com.memoweft.weftmate.mobile.And4QaReceiver`,'--es','command','login','--es','origin',fixture.origin,'--es','username',fixture.credentials.username,'--es','password',fixture.credentials.password);
    await until(()=>{run('shell','am','broadcast','-n',`${pkg}/com.memoweft.weftmate.mobile.And4QaReceiver`);return JSON.parse(run('shell','run-as',pkg,'cat','files/and4-ready.json')).ready;},'metric setup');
    run('shell','am','broadcast','-n',`${pkg}/com.memoweft.weftmate.mobile.And4QaReceiver`,'--es','command','draft');
  }
  else for(const width of [360,390])for(const theme of ['light','dark']){
    await fetch(`${fixture.origin}/__qa/reset`);run('shell','am','force-stop',pkg);
    const c=fixture.credentials;
    const args=[...adbServer,'-s',serial,'shell','am','instrument','-w','-r','-e','class','com.memoweft.weftmate.mobile.NativeChatInstrumentedTest','-e','and4Width',String(width),'-e','and4Theme',theme,'-e','and4Origin',c.origin,'-e','and4Username',c.username,'-e','and4Password',c.password,'-e','and4Mimo',(!flowOnly||process.argv.includes('--mimo'))&&width===390&&theme==='dark'?'1':'0',`${pkg}.test/androidx.test.runner.AndroidJUnitRunner`];
    process.stdout.write(`Native flow ${width} ${theme}\n`);
    const r=await exec(adbExecutable,args,{windowsHide:true,timeout:300000,maxBuffer:4*1024*1024});
    const text=sanitize(r.stdout+r.stderr);await writeFile(join(out,`instrumentation-${width}-${theme}.txt`),text);
    let files=[];try{files=run('shell','run-as',pkg,'ls','files').trim().split(/\s+/).filter(n=>n.startsWith(`and4-${width}-${theme}-`));}catch{}
    for(const file of files){const data=execFileSync(adbExecutable,[...adbServer,'-s',serial,'exec-out','run-as',pkg,'cat',`files/${file}`],{windowsHide:true,maxBuffer:12*1024*1024});await writeFile(join(out,file),data);if(file.endsWith('.png'))report.screenshots.push({file,systemTheme:'unchanged emulator setting',pageTheme:theme,widthDp:width,systemVersion:report.systemVersion});}
    report.instrumentation.push({width,theme,passed:/OK \(1 test\)/.test(text)});
    await writeFile(join(out,'native-report.json'),JSON.stringify({...report,mimoRequests:fixture.mimoRequests},null,2));
    if(!report.instrumentation.at(-1).passed)throw Error(`Native instrumented test failed ${width} ${theme}`);
  }
  if(!flowOnly) {
  run('shell','am','force-stop',pkg);let t=Date.now();const startup=run('shell','am','start','-W','-n',`${pkg}/com.memoweft.weftmate.mobile.NativeActivity`);report.nativeColdStart={amStart:startup,wallMs:Date.now()-t};
  let ready;
  await until(()=>{run('shell','am','broadcast','-n',`${pkg}/com.memoweft.weftmate.mobile.And4QaReceiver`);ready=JSON.parse(run('shell','run-as',pkg,'cat','files/and4-ready.json'));return ready.ready;},'native input ready');
  report.nativeColdStart.inputReadyUpperBoundMs=Date.now()-t;report.restoredDraft=ready.restoredDraft;report.insets=ready;
  await fetch(`${fixture.origin}/__qa/long`);run('shell','am','force-stop',pkg);run('shell','am','start','-n',`${pkg}/com.memoweft.weftmate.mobile.NativeActivity`);await pause(1800);
  run('shell','dumpsys','gfxinfo',pkg,'reset');for(let i=0;i<12;i++)run('shell','input','swipe','500','350','500','1050','250');report.frameStats=run('shell','dumpsys','gfxinfo',pkg);
  report.requests=fixture.requests;report.decisions=fixture.decisions;report.mimoRequests=fixture.mimoRequests;report.nativeApkBytes=(await stat(join(root,'apps/android/app/build/outputs/apk/debug/app-debug.apk'))).size;
  const baselinePkg='com.memoweft.weftmate.mobile.and4baselineqa',baselineApk=join(root,'.local/and-4/baseline-src/apps/android/app/build/outputs/apk/debug/app-debug.apk');
  run('install','-r',baselineApk);baselineInstalled=true;report.baselineApkBytes=(await stat(baselineApk)).size;
  run('shell','am','broadcast','-n',`${baselinePkg}/com.memoweft.weftmate.mobile.DiagnosticQaReceiver`);
  run('shell','am','start','-n',`${baselinePkg}/com.memoweft.weftmate.mobile.HybridActivity`,'--es','lg1bHostOrigin',fixture.origin);
  await pause(1400);const pid=run('shell','pidof',baselinePkg).trim();
  const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));forwardPort=reservation.address().port;await new Promise(r=>reservation.close(r));
  run('forward',`tcp:${forwardPort}`,`localabstract:webview_devtools_remote_${pid}`);
  await until(async()=>{try{return(await(await fetch(`http://127.0.0.1:${forwardPort}/json`)).json()).length>0;}catch{return false;}},'baseline web inspector');
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${forwardPort}`,{noDefaults:true});let page=browser.contexts()[0].pages().find(p=>p.url().includes('appassets'));
  await page.waitForFunction(()=>typeof call==='function');await page.evaluate(async c=>{await call('auth.login',{...c,deviceName:'Synthetic baseline'});location.reload();},fixture.credentials);
  await page.waitForFunction(()=>typeof state!=='undefined'&&state.booted&&state.loggedIn,{},{timeout:30000});
  await page.evaluate(()=>uiCore.selectMainChat());await pause(500);
  report.baselineReadyScreenshot='baseline-chat.png';await writeFile(join(out,report.baselineReadyScreenshot),execFileSync(adbExecutable,[...adbServer,'-s',serial,'exec-out','screencap','-p'],{windowsHide:true,maxBuffer:12*1024*1024}));
  await browser.close();browser=null;run('forward','--remove',`tcp:${forwardPort}`);forwardPort=null;
  run('shell','am','force-stop',baselinePkg);t=Date.now();const baseStart=run('shell','am','start','-W','-n',`${baselinePkg}/com.memoweft.weftmate.mobile.HybridActivity`,'--es','lg1bHostOrigin',fixture.origin);report.baselineColdStart={amStart:baseStart,wallMs:Date.now()-t};
  run('shell','am','broadcast','-n',`${baselinePkg}/com.memoweft.weftmate.mobile.DiagnosticQaReceiver`);
  const newPid=run('shell','pidof',baselinePkg).trim();const reservation2=createServer();await new Promise(r=>reservation2.listen(0,'127.0.0.1',r));forwardPort=reservation2.address().port;await new Promise(r=>reservation2.close(r));run('forward',`tcp:${forwardPort}`,`localabstract:webview_devtools_remote_${newPid}`);
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${forwardPort}`,{noDefaults:true});page=browser.contexts()[0].pages().find(p=>p.url().includes('appassets'));
  await page.waitForFunction(()=>typeof state!=='undefined'&&state.booted&&state.loggedIn&&document.getElementById('draft')&&!document.getElementById('draft').disabled);
  report.baselineColdStart.inputReadyUpperBoundMs=Date.now()-t;
  await page.evaluate(()=>uiCore.selectMainChat());await browser.close();browser=null;run('forward','--remove',`tcp:${forwardPort}`);forwardPort=null;
  report.measurementLimit='am start -W measures activity draw; input-ready polling adds UI automation overhead and is reported separately.';
  run('shell','dumpsys','gfxinfo',baselinePkg,'reset');for(let i=0;i<12;i++)run('shell','input','swipe','500','350','500','1050','250');report.baselineFrameStats=run('shell','dumpsys','gfxinfo',baselinePkg);
  }
}catch(error){report.failure=sanitize(error.message);process.stderr.write(`${report.failure}\n`);process.exitCode=1;
}finally{
  if(fixture){report.mimoRequests=fixture.mimoRequests;report.requests=fixture.requests;report.decisions=fixture.decisions;await fixture.close().catch(()=>{});}
  if(browser)await browser.close().catch(()=>{});
  if(serial){try{run('shell','rm','-f','/sdcard/and4-window.xml');}catch{}if(forwardPort)try{run('forward','--remove',`tcp:${forwardPort}`);}catch{}if(baselineInstalled)try{run('uninstall','com.memoweft.weftmate.mobile.and4baselineqa');}catch{}if(installed){try{run('uninstall',`${pkg}.test`);}catch{}try{run('uninstall',pkg);}catch{}}if(reversed)try{run('reverse','--remove',`tcp:${port}`);}catch{}try{execFileSync(adbExecutable,[...adbServer,'disconnect',serial],{windowsHide:true,timeout:5000});}catch{}}
  for(const lock of [mumu,heavy])if(lock)await rm(lock,{force:true});
  await writeFile(join(out,metricsOnly?'performance-report.json':'native-report.json'),JSON.stringify(report,null,2)+'\n');
  process.stdout.write(JSON.stringify({instrumentation:report.instrumentation,mimoRequests:report.mimoRequests,failure:report.failure})+'\n');
}
