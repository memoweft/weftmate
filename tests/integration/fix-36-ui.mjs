process.env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,open,writeFile,readFile,rm,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {_electron} from 'playwright';
import {readMuMuInfo,adbExecutable} from '../../scripts/nightly/mumu.mjs';
import {startProgressFixture} from '../evidence/fix-36/fixture.mjs';
import {localUiSession} from '../helpers/local-ui-session.mjs';
const execute=promisify(execFile),repo=resolve(import.meta.dirname,'../..'),out=join(repo,'tests/evidence/fix-36');
const locks='D:/AIProjects/WeftMate/Runtime/Orchestrator',pkg='com.memoweft.weftmate.mobile.fix36qa';
const desktopOnly=process.argv.includes('--desktop-only');
let heavy,mumu,serial,fixture,port,installed=false,app,profile;
const report={synthetic:true,package:pkg,modelRequests:0,checks:[],cleanup:[]};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sanitize=text=>String(text).replace(/C:[\\/]Users[\\/][^\\/\s]+/gi,'C:/Users/<user>').replace(/DESKTOP-[A-Z0-9-]+/gi,'<host>');
const run=(...args)=>execFileSync(adbExecutable,['-s',serial,...args],{windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:12*1024*1024});
async function acquire(name){const path=join(locks,name);const file=await open(path,'wx');await file.writeFile(`FIX-36 ${new Date().toISOString()} folded progress acceptance`);await file.close();return path;}
try {
 await mkdir(out,{recursive:true});
 while(true){
  for(let n=1;n<=3&&!heavy;n++)try{heavy=await acquire(`heavy-${n}.lock`);}catch(error){if(error.code!=='EEXIST')throw error;}
  if(heavy&&!desktopOnly)try{mumu=await acquire('mumu.lock');}catch(error){if(error.code!=='EEXIST')throw error;}
  if(heavy&&(mumu||desktopOnly))break;if(heavy)await rm(heavy);heavy=null;
  process.stdout.write('Waiting for MuMu ownership\n');await pause(60000);await pause(60000);
 }
 fixture=await startProgressFixture();
 if(!desktopOnly) {
 serial=readMuMuInfo().serial;execFileSync(adbExecutable,['connect',serial],{windowsHide:true,timeout:10000});
 const active=run('shell','pm','list','packages').split(/\r?\n/).filter(x=>x.includes('weftmate')&&x.includes('qa')).map(x=>x.slice(8)).filter(p=>{try{return run('shell','pidof',p).trim();}catch{return false;}});
 if(active.length)throw Error('Other QA package is active: '+active.join(', '));
 report.systemVersion=run('shell','getprop','ro.build.version.release').trim();report.systemDark=run('shell','cmd','uimode','night').trim();
 port=new URL(fixture.origin).port;run('reverse',`tcp:${port}`,`tcp:${port}`);
 run('install','-r',join(repo,'apps/android/app/build/outputs/apk/debug/app-debug.apk'));installed=true;
 run('install','-r',join(repo,'apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'));
 for(const [theme,reopen] of [['light',false],['dark',true]]) {
  run('shell','am','force-stop',pkg);const c=fixture.credentials;
  const result=await execute(adbExecutable,['-s',serial,'shell','am','instrument','-w','-r','-e','class','com.memoweft.weftmate.mobile.NativeProgressInstrumentedTest',
   '-e','theme',theme,'-e','reopen',reopen?'1':'0','-e','origin',c.origin,'-e','username',c.username,'-e','password',c.password,`${pkg}.test/androidx.test.runner.AndroidJUnitRunner`],{windowsHide:true,timeout:150000,maxBuffer:8*1024*1024});
  const log=sanitize(result.stdout+result.stderr);await writeFile(join(out,`instrumentation-${theme}.txt`),log);
  const external=`/sdcard/Android/data/${pkg}/files`,files=run('shell','ls',external).split(/\s+/).filter(x=>x.startsWith(`fix36-${theme}-`));
  for(const file of files)await writeFile(join(out,file),execFileSync(adbExecutable,['-s',serial,'exec-out','cat',`${external}/${file}`],{windowsHide:true,maxBuffer:12*1024*1024,timeout:15000}));
  if(!/OK \(1 test\)/.test(log))throw Error(`Instrumented ${theme} flow failed`);
  report.checks.push(`native-${theme}-fold-expand-collapse${reopen?'-process-restart':''}`);
 }
 // Release simulator ownership before starting the real desktop window.
 for(const p of [`${pkg}.test`,pkg])report.cleanup.push({package:p,result:run('uninstall',p).trim()});installed=false;
 run('reverse','--remove',`tcp:${port}`);execFileSync(adbExecutable,['disconnect',serial],{windowsHide:true,timeout:5000});serial=null;
 await rm(mumu);mumu=null;
 } else await fetch(fixture.origin+'/__qa/progress?mode=completed');
 profile=await mkdtemp(join(tmpdir(),'weftmate-fix36-'));const env={...process.env,WEFTMATE_TEST_HOST_NAME:'synthetic-host'};delete env.ELECTRON_RUN_AS_NODE;
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:repo,args:['scripts/review-gallery/electron.mjs','--force-device-scale-factor=1'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:fixture.origin,REVIEW_THEME:'light'}});
 const page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',error=>process.stdout.write('PAGE_ERROR '+error.message+'\n'));
 await page.route('**/personal/v1/ui/app.js',async route=>route.fulfill({contentType:'text/javascript',body:(await readFile('src/personal-access-ui/app.js','utf8')).replace('ui.loadAttachmentHasher =','globalThis.__fixCore=core;globalThis.__fixUi=ui;ui.loadAttachmentHasher =')}));
 const {username,password}=fixture.credentials;await localUiSession(page,{username,password},'FIX-36 synthetic desktop');
 await page.waitForFunction(()=>globalThis.__fixCore);
 await page.evaluate(async()=>{const response=await fetch('/personal/v1/auth/me');const identity=await response.json();__fixCore.acceptSession(identity);await __fixCore.enterAssistant();});
 await page.evaluate(()=>__fixCore.selectSession('session-11111111-1111-4111-8111-111111111111'));
 await page.locator('#transcript .inline-progress-summary').waitFor();
 for(const theme of ['light','dark']) {
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  const order=await page.evaluate(()=>{const answer=[...document.querySelectorAll('.message.assistant')].find(row=>row.textContent.includes('现在是下午'));const progress=document.querySelector('.inline-progress-summary');return {answer:answer?.getBoundingClientRect().top,progress:progress?.getBoundingClientRect().top};});
  if(!(order.progress>order.answer))throw Error('Desktop summary is not below reply: '+JSON.stringify(order));
  await page.evaluate(()=>Promise.allSettled(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished)));
  await page.screenshot({path:join(out,`electron-${theme}-collapsed.png`)});
  await page.locator('#transcript .inline-progress-summary').click();await page.evaluate(()=>Promise.allSettled(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished)));await page.screenshot({path:join(out,`electron-${theme}-expanded.png`)});await page.locator('#transcript .inline-progress-summary').click();
  report.checks.push(`electron-${theme}-reply-before-progress`);
 }
}catch(error){report.failure=sanitize(error.stack);process.exitCode=1;}
finally {
 await app?.close().catch(()=>{});await fixture?.close().catch(()=>{});
 if(profile)await rm(profile,{recursive:true,force:true});
 if(serial){if(installed)for(const p of [`${pkg}.test`,pkg])try{report.cleanup.push({package:p,result:run('uninstall',p).trim()});}catch{}
  if(port)try{run('reverse','--remove',`tcp:${port}`);}catch{}try{execFileSync(adbExecutable,['disconnect',serial],{windowsHide:true,timeout:5000});}catch{}
 }
 for(const lock of [mumu,heavy])if(lock)await rm(lock,{force:true});
 await writeFile(join(out,'validation.json'),JSON.stringify(report,null,2)+'\n');process.stdout.write(JSON.stringify(report)+'\n');
}
