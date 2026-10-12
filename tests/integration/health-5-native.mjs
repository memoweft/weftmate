process.env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
import assert from 'node:assert/strict';
import {execFile,execFileSync,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,open,unlink,rm,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {chromium} from 'playwright';
import {startTimelineCandidate} from './timeline-ui-candidate.mjs';
import {generateHealthV3Sequence} from '../helpers/health-sequence.mjs';
import {disposeHealthFixture} from '../helpers/health-5-temp.mjs';
import {assertSystemBars} from '../../scripts/nightly/system-bars.mjs';
const repo=resolve(import.meta.dirname,'../..'),out=join(repo,'tests/evidence/health-5'),lock='D:/AIProjects/WeftMate/Runtime/Orchestrator/mumu.lock',pkg='com.memoweft.weftmate.mobile.health5qa',adb=process.env.WEFTMATE_HEALTH5_ADB??'D:/Software/MuMuPlayer/nx_main/adb.exe',execute=promisify(execFile);
let serial,fixture,browser,forward,probe,installed=false,held=false,reversed=false,probeLog='';const report={source:process.env.WEFTMATE_HEALTH5_ANDROID_SERIAL?'cloudAndroid':'MuMu',synthetic:true,realNativeBusinessBridge:true,modelRequests:0,checks:[],screenshots:[],settingsChanged:false};
await mkdir(out,{recursive:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){console.log('Health-5 native stage: '+label);const end=Date.now()+45000;while(Date.now()<end){try{const v=await fn();if(v)return v;}catch{}await pause(150);}throw Error('Health native timeout: '+label);}
const run=(...args)=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',windowsHide:true,timeout:15000});
try{
 if(process.env.WEFTMATE_HEALTH5_ANDROID_SERIAL)serial=process.env.WEFTMATE_HEALTH5_ANDROID_SERIAL;
 else{const handle=await open(lock,'wx');await handle.writeFile('HEALTH-5 '+new Date().toISOString());await handle.close();held=true;
 const info=JSON.parse(execFileSync('D:/Software/MuMuPlayer/nx_main/MuMuManager.exe',['info','-v','0'],{encoding:'utf8',windowsHide:true})),details=info[0]??info,port=details.adb_port??details.vm?.adb_port;assert.ok(Number(port)>0);serial='127.0.0.1:'+port;}
 if(!process.env.WEFTMATE_HEALTH5_ANDROID_SERIAL)execFileSync(adb,['connect',serial],{windowsHide:true});assert.ok(!run('shell','ps','-A').split('\n').some(line=>line.includes('com.memoweft.weftmate')),'Another WeftMate test app is running');
 assert.ok(!run('shell','pm','list','packages',pkg).includes(pkg),'Our package was already installed');
 fixture=await startTimelineCandidate({daily:true,digest:true,logicalMobile:true,clock:Date.now});fixture.progress.finish('completed');
 await fixture.request('/settings/usage',{timeZone:'Asia/Shanghai'},'PATCH');
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());await fixture.request('/settings/health',{modelInsightsEnabled:false},'PATCH');const data=generateHealthV3Sequence({to:day});await fixture.request('/health/profile',data.profile,'PUT');await fixture.request('/health/records/batch',{items:data.items},'PUT');
 const hostPort=new URL(fixture.origin).port;run('reverse','tcp:'+hostPort,'tcp:'+hostPort);reversed=true;
 run('install',join(repo,'apps/android/app/build/outputs/apk/debug/app-debug.apk'));installed=true;run('install',join(repo,'apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'));
 run('shell','pm','grant',pkg,'android.permission.POST_NOTIFICATIONS');
 report.systemVersion=run('shell','getprop','ro.build.version.release').trim();report.systemTheme=run('shell','cmd','uimode','night').trim();
 const credentials=fixture.credentials;
 probe=spawn(adb,['-s',serial,'shell','am','instrument','-w','-e','class','com.memoweft.weftmate.mobile.Health5ProbeTest','-e','health5Probe','1','-e','host',fixture.origin,'-e','username',credentials.username,'-e','password',credentials.password,pkg+'.test/androidx.test.runner.AndroidJUnitRunner'],{windowsHide:true,stdio:['ignore','pipe','pipe']});probe.stdout.on('data',v=>probeLog+=v);probe.stderr.on('data',v=>probeLog+=v);
 const pid=await until(()=>run('shell','pidof',pkg).trim(),'app process'),reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));forward=reservation.address().port;await new Promise(r=>reservation.close(r));run('forward','tcp:'+forward,'localabstract:webview_devtools_remote_'+pid);
 await until(async()=>{const v=await fetch('http://127.0.0.1:'+forward+'/json').then(r=>r.json());return v.some(t=>t.url.includes('appassets'));},'debug WebView');
 browser=await chromium.connectOverCDP('http://127.0.0.1:'+forward,{noDefaults:true});const page=browser.contexts()[0].pages().find(p=>p.url().includes('appassets'));assert.ok(page);page.setDefaultTimeout(20000);report.pageErrors=[];page.on('pageerror',e=>report.pageErrors.push(e.message));await page.waitForFunction(()=>typeof state!=='undefined'&&state.booted&&state.loggedIn&&document.documentElement.dataset.nativeInsets==='true');
 const reads=await page.evaluate(async day=>{
   const overview=await call('host.business',{method:'GET',path:'/personal/v1/health/overview'});
   const results={};for(const id of ['stress','energy','fitnessAge','vo2Max']){const result=await call('host.business',{method:'GET',path:'/personal/v1/health/metrics/'+id+'?days=30&to='+day});results[id]=result.points.length;}
   const profile=await call('host.business',{method:'PUT',path:'/personal/v1/health/profile',body:{version:1,birthYear:1988,sex:'male',heightCm:175,weightKg:72}});
   const cache=await call('host.business',{method:'GET',path:'/personal/v1/health/analysis?day='+day}),week=await call('host.business',{method:'GET',path:'/personal/v1/health/weekly?to='+day});
   let off;try{await call('host.business',{method:'POST',path:'/personal/v1/health/analysis',body:{scope:'stress',day}});}catch(e){off=e.code??e.message;}
   return {connected:overview.connected,capabilities:overview.capabilities,stress:overview.stress,energy:overview.energy,fitnessAge:overview.fitnessAge,results,profile:!!profile.profile,cache:cache.items.length,week:!!week.health,off};
 },day);assert.ok(reads.connected);assert.equal(reads.capabilities.record,3);assert.ok(reads.energy.sleepPeriods.length);assert.ok(reads.fitnessAge.referenceRange);for(const n of Object.values(reads.results))assert.equal(n,30);assert.ok(reads.profile&&reads.week);assert.match(reads.off,/AI_ANALYSIS_OFF/);report.reads=reads;report.checks.push('v3-profile-analysis-weekly-and-four-metrics-through-real-native-allowlist');
 await page.evaluate(()=>page('notifications'));await page.getByRole('switch',{name:'用模型解读',exact:true}).waitFor();await page.waitForFunction(()=>!document.getElementById('health-modelInsightsEnabled').disabled);assert.equal(await page.getByRole('switch',{name:'用模型解读',exact:true}).isChecked(),false);
 async function capture(name){await pause(900);await page.waitForFunction(()=>!document.getElementById('toast')||document.getElementById('toast').hidden); const png=execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{windowsHide:true,maxBuffer:16*1024*1024});await writeFile(join(out,name+'.png'),png);const geometry=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scale:devicePixelRatio,top:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--native-safe-top')),bottom:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--native-safe-bottom')),theme:document.documentElement.dataset.theme}));assert.ok(geometry.bottom>0);const bars=assertSystemBars(png,{statusHeight:geometry.top*geometry.scale});report.screenshots.push({file:name+'.png',...geometry,bottomNavigationVisible:true,...bars});}
 for(const theme of ['light','dark']){await page.evaluate(async t=>{await call('settings.appearance',{value:t});applyTheme(t);},theme);await page.getByRole('switch',{name:'用模型解读',exact:true}).scrollIntoViewIfNeeded();await capture('android-'+theme+'-settings');await page.getByRole('combobox',{name:'健康数据保留多久',exact:true}).click();await capture('android-'+theme+'-retention-open');await page.keyboard.press('Escape');await page.getByRole('button',{name:'清空健康数据',exact:true}).click();await capture('android-'+theme+'-clear-open');await page.getByRole('button',{name:'取消',exact:true}).click();assert.ok(await page.locator('.notification-settings').evaluate(n=>n.scrollWidth<=n.clientWidth));}
 await page.getByRole('switch',{name:'各项 AI 分析',exact:true}).check();await page.waitForFunction(()=>!document.getElementById('health-itemAnalysisEnabled').disabled);assert.equal((await fixture.request('/settings/health')).settings.itemAnalysisEnabled,true);const analysis=await page.evaluate(async day=>call('host.business',{method:'POST',path:'/personal/v1/health/analysis',body:{scope:'stress',day}}),day);assert.equal(analysis.mode,'statistics');report.checks.push('native-health-settings-load-and-write-with-shared-controls');report.completed=true;
}catch(e){report.completed=false;report.failure=e.message;throw e;}
finally{
 if(installed&&serial){try{run('shell','run-as',pkg,'touch','files/health5-probe.done');await until(()=>probe?.exitCode!==null,'probe finish');report.instrumentationPassed=/OK \(1 test\)/.test(probeLog);}catch{} }
 await browser?.close();if(probe&&probe.exitCode===null)probe.kill();
 if(serial){if(forward)run('forward','--remove','tcp:'+forward);if(reversed)run('reverse','--remove','tcp:'+new URL(fixture.origin).port);if(installed){run('shell','am','force-stop',pkg);run('uninstall',pkg+'.test');run('uninstall',pkg);}}
 if(serial&&!process.env.WEFTMATE_HEALTH5_ANDROID_SERIAL)execFileSync(adb,['disconnect',serial],{windowsHide:true});
 await fixture?.close();if(fixture)await disposeHealthFixture(fixture.root);if(held)await unlink(lock);await writeFile(join(out,'native-verification.json'),JSON.stringify(report,null,2)+'\n');
}
