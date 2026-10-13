process.env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, open, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { readMuMuInfo, adbExecutable } from '../../scripts/nightly/mumu.mjs';
const { startNativeFixture }=await import('../evidence/and-4/fixture.mjs');
const execute=promisify(execFile),repo=resolve(import.meta.dirname,'../..');
const out=join(repo,'tests/evidence/and-12');
const locks='D:/AIProjects/WeftMate/Runtime/Orchestrator';
const pkg='com.memoweft.weftmate.mobile.and12qa';
let heavy,mumu,serial,fixture,port,installed=false;
const report={synthetic:true,package:pkg,settingsChanged:false,mimoRequests:0,themes:[],cleanup:[]};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sanitize=text=>String(text).replace(/C:[\\/]Users[\\/][^\\/\s]+/gi,'C:/Users/<user>').replace(/DESKTOP-[A-Z0-9-]+/gi,'<host>');
const run=(...args)=>execFileSync(adbExecutable,['-s',serial,...args],{windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:12*1024*1024});
async function acquire(name){const path=join(locks,name);const file=await open(path,'wx');await file.writeFile(`AND-12 ${new Date().toISOString()} keyboard acceptance`);await file.close();return path;}
try {
  await mkdir(out,{recursive:true});
  while(true){
    for(let n=1;n<=3&&!heavy;n++)try{heavy=await acquire(`heavy-${n}.lock`);}catch(error){if(error.code!=='EEXIST')throw error;}
    if(heavy)try{mumu=await acquire('mumu.lock');}catch(error){if(error.code!=='EEXIST')throw error;}
    if(heavy&&mumu)break;
    if(heavy)await rm(heavy);heavy=null;
    process.stdout.write('Waiting for MuMu ownership\n');await pause(120000);
  }
  serial=readMuMuInfo().serial;
  execFileSync(adbExecutable,['connect',serial],{windowsHide:true,timeout:10000});
  const active=run('shell','pm','list','packages').split(/\r?\n/).filter(x=>x.includes('weftmate')&&x.includes('qa')).map(x=>x.slice(8)).filter(p=>{try{return run('shell','pidof',p).trim();}catch{return false;}});
  if(active.length)throw Error('Other QA installation is active; release ownership and retry');
  report.systemVersion=run('shell','getprop','ro.build.version.release').trim();
  report.ime=run('shell','settings','get','secure','default_input_method').trim();
  fixture=await startNativeFixture();port=new URL(fixture.origin).port;
  run('reverse',`tcp:${port}`,`tcp:${port}`);
  run('install','-r',join(repo,'apps/android/app/build/outputs/apk/debug/app-debug.apk'));installed=true;
  run('install','-r',join(repo,'apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'));
  const deadline=Date.now()+18*60000;
  for(const theme of ['light','dark']){
    if(Date.now()>deadline)throw Error('MuMu ownership limit');
    run('shell','am','force-stop',pkg);await fetch(`${fixture.origin}/__qa/long`);
    const c=fixture.credentials;
    process.stdout.write(`AND-12 ${theme} keyboard/tool-row/navigation flow\n`);
    run('shell','dumpsys','gfxinfo',pkg,'reset');
    const result=await execute(adbExecutable,['-s',serial,'shell','am','instrument','-w','-r','-e','class','com.memoweft.weftmate.mobile.NativeComposerInstrumentedTest',
      '-e','theme',theme,'-e','origin',c.origin,'-e','username',c.username,'-e','password',c.password,`${pkg}.test/androidx.test.runner.AndroidJUnitRunner`],{windowsHide:true,timeout:360000,maxBuffer:8*1024*1024});
    const log=sanitize(result.stdout+result.stderr);await writeFile(join(out,`instrumentation-${theme}.txt`),log);
    const files=run('shell','run-as',pkg,'ls','files').split(/\s+/).filter(x=>x.startsWith(`and12-${theme}-`));
    for(const file of files)await writeFile(join(out,file),execFileSync(adbExecutable,['-s',serial,'exec-out','run-as',pkg,'cat',`files/${file}`],{windowsHide:true,maxBuffer:12*1024*1024,timeout:15000}));
    await writeFile(join(out,`gfxinfo-${theme}.txt`),sanitize(run('shell','dumpsys','gfxinfo',pkg)));
    report.themes.push({theme,passed:/OK \(1 test\)/.test(log),files});
    if(!report.themes.at(-1).passed)throw Error(`Instrumented ${theme} flow failed`);
  }
}catch(error){report.failure=sanitize(error.message);process.exitCode=1;}
finally {
  await fixture?.close().catch(()=>{});
  if(serial){
    if(installed){for(const p of [`${pkg}.test`,pkg])try{report.cleanup.push({package:p,result:run('uninstall',p).trim()});}catch{}}
    if(port)try{run('reverse','--remove',`tcp:${port}`);}catch{}
    try{execFileSync(adbExecutable,['disconnect',serial],{windowsHide:true,timeout:5000});report.cleanup.push('adb-disconnected');}catch{}
  }
  for(const lock of [mumu,heavy])if(lock)await rm(lock,{force:true});
  await writeFile(join(out,'validation.json'),JSON.stringify(report,null,2)+'\n');
  process.stdout.write(JSON.stringify(report)+'\n');
}
