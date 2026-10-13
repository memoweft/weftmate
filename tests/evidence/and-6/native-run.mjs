import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {open,writeFile,mkdir,unlink,readFile,rmdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {readMuMuInfo} from '../../../scripts/nightly/mumu.mjs';
import {startGoalsFixture} from './fixture.mjs';
import {startFiltersFixture} from './filters-fixture.mjs';
delete process.env.WEFTMATE_TEST_TEMP_SCOPE;
process.env.WEFTMATE_MANAGED_TEMP_ROOT=join('C:/weftmate-temp','weftmate-and6-'+randomUUID());
const exec=promisify(execFile),root=resolve(import.meta.dirname,'../../..'),out=import.meta.dirname;
const pkg='com.memoweft.weftmate.mobile.and6qa',locks='D:/AIProjects/WeftMate/Runtime/Orchestrator',adb='D:/AIProjects/AIGame/Repository/runtime/toolchains/android-sdk/platform-tools/adb.exe';
let heavy,mumu,serial,fixture,port,adbPort,installed=false;
const args=()=>['-P',String(adbPort),'-s',serial];
const run=(...a)=>execFileSync(adb,[...args(),...a],{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024,timeout:30000});
const safe=s=>String(s).replace(/C:[\\/]Users[\\/][^\\/\s]+/gi,'C:/Users/<user>').replace(/DESKTOP-[A-Z0-9-]+/gi,'<host>');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const report={synthetic:true,instrumentation:[],screenshots:[]};
const filters=process.argv.includes('--filters');
async function lock(path,label){const f=await open(path,'wx');await f.writeFile(`AND-6 ${new Date().toISOString()} ${label}`);await f.close();return path;}
try{
  while(true){
  while(!mumu){
    for(let i=1;i<=3&&!heavy;i++)try{heavy=await lock(join(locks,`heavy-${i}.lock`),'native goal walkthrough')}catch(e){if(e.code!=='EEXIST')throw e}
    if(heavy)try{mumu=await lock(join(locks,'mumu.lock'),'native goals 360/390 light/dark')}catch(e){if(e.code!=='EEXIST')throw e;await unlink(heavy);heavy=null}
    if(!mumu){process.stdout.write('Waiting for MuMu/heavy slot; no slot held\n');await pause(120000)}
  }
  report.occupancy={startedAt:new Date().toISOString(),heavySlot:heavy.split('/').at(-1)};
  const allocator=createServer();await new Promise(r=>allocator.listen(0,'127.0.0.1',r));adbPort=allocator.address().port;await new Promise(r=>allocator.close(r));
  serial=readMuMuInfo().serial;
  execFileSync(adb,['-P',String(adbPort),'connect',serial],{windowsHide:true,timeout:30000});
  const installedOthers=run('shell','pm','list','packages').split(/\r?\n/).filter(s=>s.includes('weftmate')&&!s.includes('and6qa'));
  const other=installedOthers.filter(s=>/qa$/.test(s)).filter(s=>{try{return Boolean(run('shell','pidof',s.replace(/^package:/,'')).trim())}catch{return false}});
  report.installedOtherPackages=installedOthers.length;
  if(!other.length)break;
  report.packageQueue=(report.packageQueue||0)+1;
  process.stdout.write(`Waiting for ${other.length} other WeftMate application(s) to be cleaned; all slots released\n`);
  execFileSync(adb,['-P',String(adbPort),'disconnect',serial],{windowsHide:true,timeout:5000});
  execFileSync(adb,['-P',String(adbPort),'kill-server'],{windowsHide:true,timeout:5000});serial=null;adbPort=null;
  await unlink(mumu);await unlink(heavy);mumu=heavy=null;await pause(120000);
  }
  report.systemVersion=run('shell','getprop','ro.build.version.release').trim();report.systemTheme=run('shell','cmd','uimode','night').trim();
  await mkdir(process.env.WEFTMATE_MANAGED_TEMP_ROOT,{recursive:true});
  fixture=await (filters?startFiltersFixture():startGoalsFixture());port=new URL(fixture.origin).port;run('reverse',`tcp:${port}`,`tcp:${port}`);
  report.apkHashes={};for(const [type,file]of [['app','debug/app-debug.apk'],['test','androidTest/debug/app-debug-androidTest.apk']]){const path=join(root,'apps/android/app/build/outputs/apk',file);report.apkHashes[type]=createHash('sha256').update(await readFile(path)).digest('hex');run('install','-r',path);installed=true}
  const only=process.argv.find(a=>a.startsWith('--variant='))?.split('=').at(-1);
  const variants=only?[[Number(only.split('-')[0]),only.split('-')[1]]]:filters?[[390,'light'],[390,'dark']]:[360,390].flatMap(w=>['light','dark'].map(t=>[w,t]));
  for(const [width,theme]of variants){
    if(Date.now()-Date.parse(report.occupancy.startedAt)>16*60*1000)throw Error('Release before twenty-minute MuMu limit');
    await fetch(`${fixture.origin}/${filters?'__and5':'__and6'}/reset`);run('shell','am','force-stop',pkg);run('shell','cmd','statusbar','collapse');
    const c=fixture.credentials;
    process.stdout.write(`Native goals ${width} ${theme}\n`);
    const r=await exec(adb,[...args(),'shell','am','instrument','-w','-r','-e','class',`com.memoweft.weftmate.mobile.${filters?'NativeFiltersInstrumentedTest':'NativeGoalsInstrumentedTest'}`,'-e','and6Width',String(width),'-e','and6Theme',theme,'-e','and6Origin',c.origin,'-e','and6Username',c.username,'-e','and6Password',c.password,`${pkg}.test/androidx.test.runner.AndroidJUnitRunner`],{windowsHide:true,timeout:240000,maxBuffer:4*1024*1024});
    const log=safe(r.stdout+r.stderr);await writeFile(join(out,`${filters?'filter-':''}instrumentation-${width}-${theme}.txt`),log);
    const files=run('shell','run-as',pkg,'ls','files').trim().split(/\s+/).filter(f=>f.startsWith(`and6-${width}-${theme}-`));
    for(const file of files){const data=execFileSync(adb,[...args(),'exec-out','run-as',pkg,'cat',`files/${file}`],{windowsHide:true,maxBuffer:12*1024*1024});await writeFile(join(out,file),data);if(file.endsWith('.png'))report.screenshots.push({file,pageTheme:theme,widthDp:width,systemVersion:report.systemVersion,systemTheme:report.systemTheme})}
    report.instrumentation.push({width,theme,passed:/OK \(1 test\)/.test(log)});if(!report.instrumentation.at(-1).passed)throw Error(`Native goal flow failed ${width} ${theme}`);
  }
}catch(e){report.failure=safe(e.message);process.stderr.write(report.failure+'\n');process.exitCode=1}
finally{
  if(fixture){report.requests=fixture.requests;await fixture.close().catch(()=>{})}
  await rmdir(process.env.WEFTMATE_MANAGED_TEMP_ROOT).catch(()=>{});
  if(serial){if(installed){try{run('uninstall',`${pkg}.test`)}catch{}try{run('uninstall',pkg)}catch{}}if(port)try{run('reverse','--remove',`tcp:${port}`)}catch{}try{execFileSync(adb,['-P',String(adbPort),'disconnect',serial],{windowsHide:true,timeout:5000})}catch{}}
  if(adbPort)try{execFileSync(adb,['-P',String(adbPort),'kill-server'],{windowsHide:true,timeout:5000});report.privateAdbClosed=true}catch{}
  for(const file of [mumu,heavy])if(file)await unlink(file);
  if(report.occupancy)report.occupancy.releasedAt=new Date().toISOString();
  await mkdir(out,{recursive:true});await writeFile(join(out,filters?'filters-report.json':'native-report.json'),JSON.stringify(report,null,2)+'\n');process.stdout.write(JSON.stringify({instrumentation:report.instrumentation,failure:report.failure})+'\n');
}
