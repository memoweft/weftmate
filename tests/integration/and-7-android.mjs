import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import {open,readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {startAnd7Fixture} from './and-7-fixture.mjs';
const exec=promisify(execFile),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const root=resolve('.'),orchestrator='D:/AIProjects/WeftMate/Runtime/Orchestrator';
const adb='D:/Software/MuMuPlayer/nx_main/adb.exe',manager='D:/Software/MuMuPlayer/nx_main/MuMuManager.exe';
const pkg='com.memoweft.weftmate.mobile.and7qa';
const variants=process.argv.includes('--single')?[[360,'light']]:[[360,'light'],[360,'dark'],[390,'light'],[390,'dark']];
let heavy,mumu,fixture,serial,adbPort,connected=false,installed=false;
const evidence=join(root,'tests/evidence/and-7');await mkdir(evidence,{recursive:true});await mkdir('.local/and-7',{recursive:true});
async function claim(path,label){try{const f=await open(path,'wx');await f.writeFile(`AND-7 ${new Date().toISOString()} ${label}`);await f.close();return path;}catch(e){if(e.code==='EEXIST')return null;throw e;}}
async function reserve(){while(true){const slots=await Promise.all([1,2,3].map(n=>readFile(join(orchestrator,`heavy-${n}.lock`),'utf8').catch(()=>'')));if(!slots.some(text=>text.startsWith('AND-7')))for(let n=1;n<=3;n++){heavy=await claim(join(orchestrator,`heavy-${n}.lock`),'MuMu');if(heavy)break;}if(heavy){mumu=await claim(join(orchestrator,'mumu.lock'),'native library screenshots');if(mumu)return;await unlink(heavy);heavy=null;}console.log('Waiting for MuMu and a heavy slot');await sleep(120000);}}
async function call(args,timeout=30000){return exec(adb,['-P',String(adbPort),...args],{windowsHide:true,timeout,maxBuffer:16*1024*1024});}
try {
 await reserve();const started=Date.now();
 const info=JSON.parse((await exec(manager,['info','-v','0'],{windowsHide:true})).stdout);if(!info.is_android_started)throw Error('MuMu is not running');serial=`127.0.0.1:${info.adb_port}`;
 const portServer=createServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));adbPort=portServer.address().port;await new Promise(r=>portServer.close(r));
 await call(['start-server']);await call(['connect',serial]);connected=true;
 const packages=(await call(['-s',serial,'shell','pm','list','packages'])).stdout;
 await writeFile('.local/and-7/installed-packages.txt',packages.split('\n').filter(line=>line.includes('weftmate')).join('\n'));
 const other=packages.split('\n').filter(line=>/weftmate.*(?:and\d|qa|probe)/i.test(line)&&!line.includes(pkg));
 if(other.length)throw Error('MUMU_BUSY: '+other.join(', '));
 fixture=await startAnd7Fixture();const port=new URL(fixture.origin).port;
 await call(['-s',serial,'reverse',`tcp:${port}`,`tcp:${port}`]);
 await call(['-s',serial,'install','-r','apps/android/app/build/outputs/apk/debug/app-debug.apk'],60000);installed=true;
 await call(['-s',serial,'install','-r','apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'],60000);
 for(const [width,theme] of variants){
  if(Date.now()-started>18*60000)throw Error('MuMu batch reached 18 minutes; release before the 20 minute limit');
  await call(['-s',serial,'shell','am','force-stop',pkg]);
  const instrument=call(['-s',serial,'shell','am','instrument','-w','-e','class','com.memoweft.weftmate.mobile.NativeLibraryInstrumentedTest','-e','and7Origin',fixture.origin,'-e','and7User',fixture.credentials.username,'-e','and7Password',fixture.credentials.password,'-e','and7MarkdownId',fixture.outputs['虚构周计划.md'],'-e','and7Width',String(width),'-e','and7Theme',theme,`${pkg}.test/androidx.test.runner.AndroidJUnitRunner`],240000);
  await sleep(1000);
  const pid=(await call(['-s',serial,'shell','pidof',pkg]).catch(()=>({stdout:''}))).stdout.trim();
  const result=await instrument;
  await writeFile(`.local/and-7/instrumentation-${width}-${theme}.txt`,result.stdout+result.stderr);
  if(pid){const log=(await call(['-s',serial,'logcat','-d','--pid='+pid,'-t','300']).catch(()=>({stdout:''}))).stdout;await writeFile(`.local/and-7/logcat-${width}-${theme}.txt`,log);}
  const names=(await call(['-s',serial,'shell','run-as',pkg,'ls','files'])).stdout.trim().split(/\r?\n/).filter(name=>name.startsWith(`and7-${width}-${theme}-`)&&/\.(png|json)$/.test(name));
  for(const name of names){const contents=await exec(adb,['-P',String(adbPort),'-s',serial,'exec-out','run-as',pkg,'cat',`files/${name}`],{windowsHide:true,encoding:'buffer',maxBuffer:16*1024*1024});await writeFile(join(evidence,name),contents.stdout);}
  if(!result.stdout.includes('OK (1 test)'))throw Error(`Instrumentation failed: ${width} ${theme}. See .local/and-7.`);
  console.log(`Passed ${width} ${theme}: ${names.length} evidence files`);
 }
} finally {
 if(connected){if(installed){await call(['-s',serial,'uninstall',`${pkg}.test`]).catch(()=>{});await call(['-s',serial,'uninstall',pkg]).catch(()=>{});}if(fixture){const port=new URL(fixture.origin).port;await call(['-s',serial,'reverse','--remove',`tcp:${port}`]).catch(()=>{});}await call(['disconnect',serial]).catch(()=>{});await call(['kill-server']).catch(()=>{});}
 await fixture?.close().catch(()=>{});
 if(mumu)await unlink(mumu);if(heavy)await unlink(heavy);
}
