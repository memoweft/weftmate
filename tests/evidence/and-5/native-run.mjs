import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {open,writeFile,mkdir,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readMuMuInfo} from '../../../scripts/nightly/mumu.mjs';
import {createServer} from 'node:net';
import {startFeedFixture} from './fixture.mjs';
const exec=promisify(execFile),root=resolve(import.meta.dirname,'../../..'),out=import.meta.dirname;
const pkg='com.memoweft.weftmate.mobile.and5qa',locks='D:/AIProjects/WeftMate/Runtime/Orchestrator';
let heavy,mumu,serial,fixture,installed=false,reversed=false;
const adbExecutable='D:/AIProjects/AIGame/Repository/runtime/toolchains/android-sdk/platform-tools/adb.exe';
let adbPort;
const serverArgs=()=>adbPort?['-P',String(adbPort)]:[];
const notificationXml=`/sdcard/and5-notification-${randomUUID()}.xml`;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const report={synthetic:true,instrumentation:[],screenshots:[],notifications:[]};
const safe=s=>String(s).replace(/C:[\\/]Users[\\/][^\\/\s]+/gi,'C:/Users/<user>').replace(/DESKTOP-[A-Z0-9-]+/gi,'<host>');
const run=(...args)=>execFileSync(adbExecutable,[...serverArgs(),'-s',serial,...args],{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024,timeout:30000});
async function acquire(path,label){const f=await open(path,'wx');await f.writeFile(`AND-5 ${new Date().toISOString()} ${label}`);await f.close();return path;}
async function until(check,label){for(let i=0;i<150;i++){if(await check())return;await pause(200);}throw Error(`Timed out: ${label}`);}
const probe=()=>{run('shell','am','broadcast','-n',`${pkg}/com.memoweft.weftmate.mobile.And5QaReceiver`);return JSON.parse(run('shell','run-as',pkg,'cat','files/and5-ready.json'));};
async function screenshot(file,theme,width){const data=execFileSync(adbExecutable,[...serverArgs(),'-s',serial,'exec-out','screencap','-p'],{windowsHide:true,maxBuffer:12*1024*1024});await writeFile(join(out,file),data);report.screenshots.push({file,pageTheme:theme,widthDp:width,systemVersion:report.systemVersion,systemTheme:'unchanged emulator setting'});}
async function clickNotification(cold){
  run('shell','cmd','statusbar','expand-notifications');await pause(600);
  await screenshot(`and5-390-dark-notification-panel-${cold?'cold':'background'}.png`,'dark',390);
  await exec(adbExecutable,[...serverArgs(),'-s',serial,'shell','uiautomator','dump','--compressed',notificationXml],{windowsHide:true,timeout:15000,maxBuffer:1024*1024});
  const xml=run('shell','cat',notificationXml);
  const node=xml.match(/<node\b(?=[^>]*text="[^"]*新的合成任务完成[^"]*")[^>]*\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if(!node)throw Error('Synthetic notification row absent from system panel');
  run('shell','input','tap',String(Math.floor((Number(node[1])+Number(node[3]))/2)),String(Math.floor((Number(node[2])+Number(node[4]))/2)));
}
try{
  await mkdir(out,{recursive:true});
  while(!heavy){for(let i=1;i<=3;i++)try{heavy=await acquire(join(locks,`heavy-${i}.lock`),'MuMu native activity verification');break;}catch(e){if(e.code!=='EEXIST')throw e;}if(!heavy){process.stdout.write('Waiting for heavy slot (2 minutes)\n');await pause(120000);}}
  while(!mumu){try{mumu=await acquire(join(locks,'mumu.lock'),'native activity + notification screenshots');}catch(e){if(e.code!=='EEXIST')throw e;process.stdout.write('Waiting for MuMu lock (2 minutes)\n');await pause(120000);}}
  const start=Date.now();const allocator=createServer();await new Promise(r=>allocator.listen(0,'127.0.0.1',r));adbPort=allocator.address().port;await new Promise(r=>allocator.close(r));
  const info=readMuMuInfo();serial=info.serial;execFileSync(adbExecutable,[...serverArgs(),'connect',serial],{windowsHide:true,timeout:30000});
  report.adbIsolation={privateServer:true,portableSdk:true};
  report.occupancy={heavySlot:heavy.split(/[\\/]/).at(-1),mumuStartedAt:new Date(start).toISOString()};
  const other=run('shell','pm','list','packages').split(/\r?\n/).filter(s=>s.includes('weftmate')&&!s.includes('and5qa'));
  if(other.length)throw Error(`Other WeftMate packages installed; release emulator and retry (${other.length})`);
  report.systemVersion=run('shell','getprop','ro.build.version.release').trim();
  fixture=await startFeedFixture();const port=new URL(fixture.origin).port;
  run('reverse',`tcp:${port}`,`tcp:${port}`);reversed=true;
  run('install','-r',join(root,'apps/android/app/build/outputs/apk/debug/app-debug.apk'));installed=true;
  // Earlier shared-ADB timeouts may leave this package's synthetic account behind.
  run('shell','pm','clear',pkg);
  run('install','-r',join(root,'apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'));
  run('shell','pm','grant',pkg,'android.permission.POST_NOTIFICATIONS');
  for(const width of [360,390])for(const theme of ['light','dark']){
    if(Date.now()-start>16*60*1000)throw Error('Release MuMu before 20 minute ownership limit');
    await fetch(`${fixture.origin}/__and5/reset`);run('shell','am','force-stop',pkg);
    const c=fixture.credentials,args=[...serverArgs(),'-s',serial,'shell','am','instrument','-w','-r','-e','class','com.memoweft.weftmate.mobile.NativeFeedInstrumentedTest','-e','and5Width',String(width),'-e','and5Theme',theme,'-e','and5Origin',c.origin,'-e','and5Username',c.username,'-e','and5Password',c.password,`${pkg}.test/androidx.test.runner.AndroidJUnitRunner`];
    process.stdout.write(`Native activity ${width} ${theme}\n`);
    const r=await exec(adbExecutable,args,{windowsHide:true,timeout:240000,maxBuffer:4*1024*1024});const log=safe(r.stdout+r.stderr);await writeFile(join(out,`instrumentation-${width}-${theme}.txt`),log);
    const files=run('shell','run-as',pkg,'ls','files').trim().split(/\s+/).filter(f=>f.startsWith(`and5-${width}-${theme}-`));
    for(const file of files){const data=execFileSync(adbExecutable,[...serverArgs(),'-s',serial,'exec-out','run-as',pkg,'cat',`files/${file}`],{windowsHide:true,maxBuffer:12*1024*1024});await writeFile(join(out,file),data);if(file.endsWith('.png'))report.screenshots.push({file,pageTheme:theme,widthDp:width,systemVersion:report.systemVersion,systemTheme:'unchanged emulator setting'});}
    report.instrumentation.push({width,theme,passed:/OK \(1 test\)/.test(log)});if(!report.instrumentation.at(-1).passed)throw Error(`Native instrumented test failed ${width} ${theme}`);
  }
  // Real production Notification contentIntent; no fabricated navigation extras.
  for(const cold of [false,true]){
    run('shell','am','start','-n',`${pkg}/com.memoweft.weftmate.mobile.NativeActivity`);
    await until(()=>probe().ready,'notification setup');await fetch(`${fixture.origin}/__and5/notify`);
    run('shell','am','broadcast','-n',`${pkg}/com.memoweft.weftmate.mobile.And5QaReceiver`,'--es','command','poll');
    await until(()=>probe().noticeFound,'production notification');
    const polling=JSON.parse(run('shell','run-as',pkg,'cat','files/and5-notification-poll.json'));report.notificationPolling=polling;
    const oldPid=probe().pid;run('shell','input','keyevent','KEYCODE_HOME');await pause(1000);
    if(cold){run('shell','am','kill',pkg);await pause(700);let stopped=false;try{stopped=!run('shell','pidof',pkg).trim()}catch{stopped=true}if(!stopped)throw Error('Synthetic process did not stop');}
    await clickNotification(cold);
    await until(()=>{const p=probe();return p.ready&&p.tab==='chat'},'notification opens native conversation');await pause(500);
    const after=probe();
    report.notifications.push({cold,oldPid,newPid:after.pid,method:'tap actual system notification row',tab:after.tab,passed:after.tab==='chat'&&(!cold||after.pid!==oldPid)});
    await screenshot(`and5-390-dark-notification-${cold?'cold':'background'}.png`,'dark',390);
  }
}catch(e){report.failure=safe(e.message);process.stderr.write(report.failure+'\n');process.exitCode=1;
}finally{
  if(serial&&installed)try{report.notificationPolling=JSON.parse(run('shell','run-as',pkg,'cat','files/and5-notification-poll.json'))}catch{}
  if(fixture){report.requests=fixture.requests;report.reads=fixture.reads;await fixture.close().catch(()=>{});}
  if(serial){try{run('shell','rm','-f',notificationXml)}catch{}if(installed){try{run('uninstall',`${pkg}.test`)}catch{}try{run('uninstall',pkg)}catch{}}if(reversed)try{run('reverse','--remove',`tcp:${new URL(fixture.origin).port}`)}catch{}try{execFileSync(adbExecutable,[...serverArgs(),'disconnect',serial],{windowsHide:true,timeout:5000})}catch{}}
  if(adbPort)try{execFileSync(adbExecutable,[...serverArgs(),'kill-server'],{windowsHide:true,timeout:5000});report.privateAdbClosed=true}catch{report.privateAdbClosed=false}
  for(const lock of [mumu,heavy])if(lock)await unlink(lock);
  if(report.occupancy)report.occupancy.releasedAt=new Date().toISOString();
  await writeFile(join(out,'native-report.json'),JSON.stringify(report,null,2)+'\n');process.stdout.write(JSON.stringify({instrumentation:report.instrumentation,notifications:report.notifications,failure:report.failure})+'\n');
}
