import { evidencePath } from '../helpers/evidence-path.mjs';
process.env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
import assert from 'node:assert/strict';
import {execFile,execFileSync,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,open,unlink,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {chromium} from 'playwright';
import {startTimelineCandidate} from './timeline-ui-candidate.mjs';
import {generateHealthSequence} from '../helpers/health-sequence.mjs';
import {assertSystemBars} from '../../scripts/nightly/system-bars.mjs';
const repo=resolve(import.meta.dirname,'../..'),out=evidencePath('health-2'),lock='D:/AIProjects/WeftMate/Runtime/Orchestrator/mumu.lock',pkg='com.memoweft.weftmate.mobile.health2qa',adb='D:/Software/MuMuPlayer/nx_main/adb.exe',execute=promisify(execFile);
let serial,fixture,browser,forward,probe,installed=false,held=false,reversed=false,probeLog='';const report={synthetic:true,realNativeBusinessBridge:true,modelRequests:0,checks:[],screenshots:[],settingsChanged:false};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+45000;while(Date.now()<end){try{const v=await fn();if(v)return v;}catch{}await pause(150);}throw Error('Health native timeout: '+label);}
const run=(...args)=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',windowsHide:true,timeout:15000});
try{
 const handle=await open(lock,'wx');await handle.writeFile('HEALTH-2 '+new Date().toISOString());await handle.close();held=true;
 const info=JSON.parse(execFileSync('D:/Software/MuMuPlayer/nx_main/MuMuManager.exe',['info','-v','0'],{encoding:'utf8',windowsHide:true})),details=info[0]??info,port=details.adb_port??details.vm?.adb_port;assert.ok(Number(port)>0);serial='127.0.0.1:'+port;
 execFileSync(adb,['connect',serial],{windowsHide:true});assert.ok(!run('shell','ps','-A').split('\n').some(line=>line.includes('com.memoweft.weftmate')),'Another WeftMate test app is running');
 assert.ok(!run('shell','pm','list','packages',pkg).includes(pkg),'Our package was already installed');
 fixture=await startTimelineCandidate({daily:true,digest:true,logicalMobile:true,clock:Date.now});fixture.progress.finish('completed');
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());await fixture.request('/settings/health',{modelInsightsEnabled:false},'PATCH');await fixture.request('/health/records/batch',{items:generateHealthSequence({to:day}).items},'PUT');
 const hostPort=new URL(fixture.origin).port;run('reverse','tcp:'+hostPort,'tcp:'+hostPort);reversed=true;
 run('install',join(repo,'apps/android/app/build/outputs/apk/debug/app-debug.apk'));installed=true;run('install',join(repo,'apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'));
 run('shell','pm','grant',pkg,'android.permission.POST_NOTIFICATIONS');
 report.systemVersion=run('shell','getprop','ro.build.version.release').trim();report.systemTheme=run('shell','cmd','uimode','night').trim();
 const credentials=fixture.credentials;
 probe=spawn(adb,['-s',serial,'shell','am','instrument','-w','-e','class','com.memoweft.weftmate.mobile.Health2ProbeTest','-e','health2Probe','1','-e','host',fixture.origin,'-e','username',credentials.username,'-e','password',credentials.password,pkg+'.test/androidx.test.runner.AndroidJUnitRunner'],{windowsHide:true,stdio:['ignore','pipe','pipe']});probe.stdout.on('data',v=>probeLog+=v);probe.stderr.on('data',v=>probeLog+=v);
 const pid=await until(()=>run('shell','pidof',pkg).trim(),'app process'),reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));forward=reservation.address().port;await new Promise(r=>reservation.close(r));run('forward','tcp:'+forward,'localabstract:webview_devtools_remote_'+pid);
 await until(async()=>{const v=await fetch('http://127.0.0.1:'+forward+'/json').then(r=>r.json());return v.some(t=>t.url.includes('appassets'));},'debug WebView');
 browser=await chromium.connectOverCDP('http://127.0.0.1:'+forward,{noDefaults:true});const page=browser.contexts()[0].pages().find(p=>p.url().includes('appassets'));assert.ok(page);page.setDefaultTimeout(20000);report.pageErrors=[];page.on('pageerror',e=>report.pageErrors.push(e.message));await page.waitForFunction(()=>typeof state!=='undefined'&&state.booted&&state.loggedIn&&document.documentElement.dataset.nativeInsets==='true');
 const reads=await page.evaluate(async()=>{const overview=await call('host.business',{method:'GET',path:'/personal/v1/health/overview'}),metric=await call('host.business',{method:'GET',path:'/personal/v1/health/metrics/sleepMinutes?days=30'}),calendar=await call('host.business',{method:'GET',path:'/personal/v1/health/calendar'});return {connected:overview.connected,score:overview.recovery.score,points:metric.points.length,days:calendar.days.length};});assert.ok(reads.connected);assert.equal(reads.points,30);assert.ok(reads.days>=28);report.checks.push('three-health-reads-through-real-native-allowlist');
 await page.evaluate(()=>page('notifications'));await page.getByRole('switch',{name:'用模型解读',exact:true}).waitFor();await page.waitForFunction(()=>!document.getElementById('health-modelInsightsEnabled').disabled);assert.equal(await page.getByRole('switch',{name:'用模型解读',exact:true}).isChecked(),false);
 async function capture(name){await pause(900);await page.waitForFunction(()=>!document.getElementById('toast')||document.getElementById('toast').hidden); const png=execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{windowsHide:true,maxBuffer:16*1024*1024});await writeFile(join(out,name+'.png'),png);const geometry=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scale:devicePixelRatio,top:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--native-safe-top')),bottom:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--native-safe-bottom')),theme:document.documentElement.dataset.theme}));assert.ok(geometry.bottom>0);const bars=assertSystemBars(png,{statusHeight:geometry.top*geometry.scale});report.screenshots.push({file:name+'.png',...geometry,bottomNavigationVisible:true,...bars});}
 for(const theme of ['light','dark']){await page.evaluate(async t=>{await call('settings.appearance',{value:t});applyTheme(t);},theme);await page.getByRole('switch',{name:'用模型解读',exact:true}).scrollIntoViewIfNeeded();await capture('android-'+theme+'-settings');await page.getByRole('combobox',{name:'健康数据保留多久',exact:true}).click();await capture('android-'+theme+'-retention-open');await page.keyboard.press('Escape');await page.getByRole('button',{name:'清空健康数据',exact:true}).click();await capture('android-'+theme+'-clear-open');await page.getByRole('button',{name:'取消',exact:true}).click();assert.ok(await page.locator('.notification-settings').evaluate(n=>n.scrollWidth<=n.clientWidth));}
 await page.getByRole('switch',{name:'用模型解读',exact:true}).check();await page.waitForFunction(()=>!document.getElementById('health-modelInsightsEnabled').disabled);assert.equal((await fixture.request('/settings/health')).settings.modelInsightsEnabled,true);report.checks.push('native-health-settings-load-and-write-with-shared-controls');report.completed=true;
}catch(e){report.completed=false;report.failure=e.message;throw e;}
finally{
 if(installed&&serial){try{run('shell','run-as',pkg,'touch','files/health2-probe.done');await until(()=>probe?.exitCode!==null,'probe finish');report.instrumentationPassed=/OK \(1 test\)/.test(probeLog);}catch{} }
 await browser?.close();if(probe&&probe.exitCode===null)probe.kill();
 if(serial){if(forward)run('forward','--remove','tcp:'+forward);if(reversed)run('reverse','--remove','tcp:'+new URL(fixture.origin).port);if(installed){run('shell','am','force-stop',pkg);run('uninstall',pkg+'.test');run('uninstall',pkg);}execFileSync(adb,['disconnect',serial],{windowsHide:true});}
 await fixture?.close();if(fixture)await rm(fixture.root,{recursive:true,force:true});if(held)await unlink(lock);await writeFile(join(out,'native-verification.json'),JSON.stringify(report,null,2)+'\n');
}
