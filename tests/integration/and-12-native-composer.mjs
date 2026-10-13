process.env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, open, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { readMuMuInfo, adbExecutable } from '../../scripts/nightly/mumu.mjs';
const { startComposerFixture }=await import('../evidence/and-12/fixture.mjs');
const execute=promisify(execFile),repo=resolve(import.meta.dirname,'../..');
const out=join(repo,'tests/evidence/and-12');
const locks='D:/AIProjects/WeftMate/Runtime/Orchestrator';
const pkg='com.memoweft.weftmate.mobile.and12qa';
const testIme=process.argv.includes('--test-ime');
let heavy,mumu,serial,fixture,port,installed=false,imeBefore;
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
  fixture=await startComposerFixture();port=new URL(fixture.origin).port;
  run('reverse',`tcp:${port}`,`tcp:${port}`);
  run('install','-r',join(repo,'apps/android/app/build/outputs/apk/debug/app-debug.apk'));installed=true;
  report.debuggable=/\bDEBUGGABLE\b/.test(run('shell','dumpsys','package',pkg));
  run('install','-r',join(repo,'apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'));
  if(testIme) {
    imeBefore={default:run('shell','settings','get','secure','default_input_method').trim(),enabled:run('shell','settings','get','secure','enabled_input_methods').trim()};
    report.imeBefore=imeBefore;
    const id=`${pkg}.test/com.memoweft.weftmate.mobile.Ui2vTestIme`;
    run('shell','ime','enable',id);run('shell','ime','set',id);
    report.settingsChanged=true;report.testIme=id;
  }
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
    const external=`/sdcard/Android/data/${pkg}/files`;
    const collect=async()=>{
      const files=run('shell','ls',external).split(/\s+/).filter(x=>x.startsWith(`and12-${theme}-`));
      for(const file of files)await writeFile(join(out,file),execFileSync(adbExecutable,['-s',serial,'exec-out','cat',`${external}/${file}`],{windowsHide:true,maxBuffer:12*1024*1024,timeout:15000}));
      return files;
    };
    const files=await collect();
    await writeFile(join(out,`gfxinfo-${theme}.txt`),sanitize(run('shell','dumpsys','gfxinfo',pkg)));
    report.themes.push({theme,passed:/OK \(1 test\)/.test(log),files});
    if(!report.themes.at(-1).passed)throw Error(`Instrumented ${theme} flow failed`);
    await fetch(`${fixture.origin}/__qa/long`);
    const timing=await execute(adbExecutable,['-s',serial,'shell','am','instrument','-w','-r','-e','class','com.memoweft.weftmate.mobile.NativeComposerPerformanceTest',
      '-e','theme',theme,'-e','origin',c.origin,`${pkg}.test/androidx.test.runner.AndroidJUnitRunner`],{windowsHide:true,timeout:90000,maxBuffer:8*1024*1024});
    const timingLog=sanitize(timing.stdout+timing.stderr);await writeFile(join(out,`performance-${theme}.txt`),timingLog);
    report.themes.at(-1).performancePassed=/OK \(1 test\)/.test(timingLog);
    report.themes.at(-1).files=await collect();
    if(!report.themes.at(-1).performancePassed)throw Error(`Actual ${theme} keyboard timing failed`);
  }
}catch(error){report.failure=sanitize(error.message);process.exitCode=1;}
finally {
  await fixture?.close().catch(()=>{});
  if(serial){
    if(imeBefore) {
      try {
        run('shell','settings','put','secure','default_input_method',imeBefore.default);
        run('shell','settings','put','secure','enabled_input_methods',imeBefore.enabled);
        report.imeAfter={default:run('shell','settings','get','secure','default_input_method').trim(),enabled:run('shell','settings','get','secure','enabled_input_methods').trim()};
        report.imeRestored=JSON.stringify(report.imeAfter)===JSON.stringify(imeBefore);
        if(!report.imeRestored) {report.failure='IME restoration verification failed';process.exitCode=1;}
      } catch(error) {report.imeRestored=false;report.failure='IME restoration failed: '+sanitize(error.message);process.exitCode=1;}
    }
    if(installed){for(const p of [`${pkg}.test`,pkg])try{report.cleanup.push({package:p,result:run('uninstall',p).trim()});}catch{}}
    if(imeBefore) {
      report.imeAfterUninstall={default:run('shell','settings','get','secure','default_input_method').trim(),enabled:run('shell','settings','get','secure','enabled_input_methods').trim()};
      report.imeRestored=report.imeRestored && JSON.stringify(report.imeAfterUninstall)===JSON.stringify(imeBefore);
      if(!report.imeRestored){report.failure='IME post-uninstall restoration verification failed';process.exitCode=1;}
    }
    if(port)try{run('reverse','--remove',`tcp:${port}`);}catch{}
    try{execFileSync(adbExecutable,['disconnect',serial],{windowsHide:true,timeout:5000});report.cleanup.push('adb-disconnected');}catch{}
  }
  for(const lock of [mumu,heavy])if(lock)await rm(lock,{force:true});
  await writeFile(join(out,'validation.json'),JSON.stringify(report,null,2)+'\n');
  process.stdout.write(JSON.stringify(report)+'\n');
}
