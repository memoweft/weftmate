import { evidencePath } from '../helpers/evidence-path.mjs';
/** Visual acceptance only: production phone webpage in an isolated test browser.
 * State is synthetic; real originals/Core acceptance is in phone-handover.mjs. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,open,unlink,rm,lstat,readdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {execFileSync,spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import {readMuMuInfo,adbExecutable} from '../../scripts/nightly/mumu.mjs';
import {redactEvidenceText} from '../helpers/process-evidence.mjs';
const {PNG}=createRequire(import.meta.url)('playwright-core/lib/utilsBundle');
const repo=resolve(import.meta.dirname,'../..'),local=join(repo,'.local/mem-7/phone-container'),out=evidencePath('mem-7');
const pkg='com.memoweft.weftmate.mobile.mem7qa',activity='com.memoweft.weftmate.mobile.St2PhoneBrowserActivity';
await mkdir(local,{recursive:true});
const generator=(await readFile(join(repo,'tests/integration/st-2-phone-container.mjs'),'utf8')).replace("resolve('.local/st2-phone-container')",`resolve(${JSON.stringify(local)})`);
const generated=join(local,'generate.mjs');await writeFile(generated,generator);await import(pathToFileURL(generated));
const init=join(local,'fixture.gradle');await writeFile(init,(await readFile(init,'utf8'))+`\nallprojects { buildDir = '${local.replaceAll('\\','/')}/build/' + project.name }\n`);
const build=join(local,'build.ps1');await writeFile(build,`. D:/AIProjects/AIGame/Repository/runtime/toolchains/activate-android.ps1\nSet-Location '${repo.replaceAll('\\','/')}/apps/android'\ngradle --offline -I '${init.replaceAll('\\','/')}' :app:assembleDebug :app:testDebugUnitTest '-PweftmateApplicationId=${pkg}' '-Pkotlin.compiler.execution.strategy=in-process' '-Dorg.gradle.jvmargs=-Xmx1536m -Dfile.encoding=UTF-8 -Dweftmate.mem7.workspace=${repo.replaceAll('\\','/')}' --no-daemon --max-workers=2 --console=plain\nexit $LASTEXITCODE\n`);
await new Promise((done,fail)=>{const child=spawn('powershell.exe',['-NoProfile','-File',build],{windowsHide:true,stdio:['ignore','pipe','pipe']});for(const stream of [child.stdout,child.stderr])stream.on('data',p=>process.stdout.write(redactEvidenceText(String(p))));child.on('error',fail);child.on('close',n=>n===0?done():fail(Error('Android isolated build failed')));});
const lock='D:/AIProjects/WeftMate/Runtime/Orchestrator/mumu.lock';let lease;
while(!lease){try{lease=await open(lock,'wx');await lease.writeFile(`MEM-7 ${new Date().toISOString()} webpage system bars`);await lease.close();}catch(e){if(e.code!=='EEXIST')throw e;console.log('MEM-7 waiting for MuMu');await new Promise(r=>setTimeout(r,120000));}}
let serial,server,browser,forward,port,size,density,night,installed;
const androidUnit={tests:0,failures:0,errors:0,skipped:0};for(const name of (await readdir(join(local,'build/app/test-results/testDebugUnitTest'))).filter(n=>n.endsWith('.xml'))){const text=await readFile(join(local,'build/app/test-results/testDebugUnitTest',name),'utf8');for(const key of Object.keys(androidUnit))androidUnit[key]+=Number(new RegExp('\\b'+key+'="(\\d+)"').exec(text)?.[1]??0);}assert.equal(androidUnit.failures+androidUnit.errors,0);
const report={visualOnly:true,syntheticState:true,nativeProductBridge:false,modelRequests:0,androidUnit,screenshots:[]};
const run=(...args)=>execFileSync(adbExecutable,['-s',serial,...args],{windowsHide:true,timeout:20000,maxBuffer:16*1024*1024});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<120;i++){try{const v=await fn();if(v)return v;}catch{}await pause(100);}throw Error('MEM-7 phone browser not ready');}
try{
 serial=readMuMuInfo().serial;execFileSync(adbExecutable,['connect',serial],{windowsHide:true});
 const packages=run('shell','pm','list','packages').toString().split('\n').filter(p=>p.includes('weftmate'));
 assert.ok(!packages.some(p=>p.trim()==='package:'+pkg));for(const row of packages){let pid='';try{pid=run('shell','pidof',row.replace('package:','').trim()).toString().trim();}catch{}assert.equal(pid,'','Other test application is running: '+row.replace('package:','').trim());}
 assert.notEqual(run('shell','getprop','qemu.hw.mainkeys').toString().trim(),'1');
 server=createServer(async(req,res)=>{const path=new URL(req.url,'http://synthetic.invalid').pathname;const name=path==='/personal/v1/ui'?'index.html':path.replace(/^\/personal\/v1\//,'');try{if(name.includes('..'))throw Error();const data=await readFile(join(repo,'apps/mobile-ui/www',name));res.writeHead(200,{'content-type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':'text/html'});res.end(data);}catch{res.writeHead(503,{'content-type':'application/json'});res.end('{"error":{"code":"SYNTHETIC_VISUAL_ONLY"}}');}});await new Promise(r=>server.listen(0,'127.0.0.1',r));port=server.address().port;
 run('reverse',`tcp:${port}`,`tcp:${port}`);run('install',join(local,'build/app/outputs/apk/debug/app-debug.apk'));installed=true;
 size=/Override size: (\d+x\d+)/.exec(run('shell','wm','size').toString())?.[1]??'reset';density=/Override density: (\d+)/.exec(run('shell','wm','density').toString())?.[1]??'reset';night=/Night mode: (yes|no|auto)/.exec(run('shell','cmd','uimode','night').toString())?.[1];const version=run('shell','getprop','ro.build.version.release').toString().trim();
 for(const [width,height] of [[360,780],[390,844]])for(const theme of ['light','dark']){
  run('shell','wm','size',`${width*2}x${height*2}`);run('shell','wm','density','320');run('shell','cmd','uimode','night',theme==='dark'?'yes':'no');run('shell','am','start','-W','-n',pkg+'/'+activity,'-e','st4Url',`http://127.0.0.1:${port}/personal/v1/ui`,'-e','st4Theme',theme);
  const pid=await until(()=>run('shell','pidof',pkg+':st4remote').toString().trim());forward=run('forward','tcp:0',`localabstract:webview_devtools_remote_${pid}`).toString().trim();browser=await until(()=>chromium.connectOverCDP(`http://127.0.0.1:${forward}`,{noDefaults:true}));const page=browser.contexts()[0].pages().find(p=>p.url().includes(String(port)));await page.waitForFunction(()=>typeof renderPhoneMemoryReplica==='function'&&typeof state!=='undefined'&&state.booted);
  await page.route('https://phone-model.synthetic.invalid/v1/**',async route=>{const headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type'};if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});report.syntheticModelRequests=(report.syntheticModelRequests??0)+1;await route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:'知道了。'}}]})});});
  await page.evaluate(async({theme,origin})=>{await WeftPhone.start({origin,accountId:'synthetic-bars-'+theme+'-'+innerWidth,deviceId:'synthetic-bars-device',email:'visual@example.com'},{authorized:async()=>({devices:[{isCurrent:true,revoked:false}],hosts:[]})});state.model=await WeftPhone.modelCall('models.configure',{endpoint:'https://phone-model.synthetic.invalid/v1',apiKey:'synthetic-only',modelId:'visual-only'});$('draft').value='我喜欢乌龙茶，正在做纸舟练习项目。';await WeftPhone.send();await WeftPhone.modelCall('models.account.removeLocal');state.restorePending=false;applyTheme(theme);page('memory');},{theme,origin:`http://127.0.0.1:${port}`});
  const dump=run('shell','dumpsys','window','displays').toString(),inset=kind=>{const line=dump.split('\n').find(l=>l.includes('type='+kind)&&l.includes('visible=true')),m=/frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(line??'');return m?Number(m[4])-Number(m[2]):0;};const status=inset('statusBars'),navigation=inset('navigationBars');assert.ok(status>0&&navigation>0);
  async function shot(scene){await page.evaluate(()=>WeftSystemBars.sync());await pause(1000);const focus=run('shell','dumpsys','window').toString().split('\n').find(l=>l.includes('mCurrentFocus'));assert.ok(focus?.includes(pkg));const name=`phone-system-${width}-${theme}-${scene}.png`,bytes=run('exec-out','screencap','-p');await writeFile(join(out,name),bytes);const png=PNG.sync.read(bytes),pixel=(x,y)=>[0,1,2].map(i=>png.data[(Math.floor(y)*png.width+x)*4+i]),delta=(a,b)=>Math.max(...a.map((v,i)=>Math.abs(v-b[i]))),statusDelta=delta(pixel(8,status/2),pixel(8,status+5)),navigationDelta=delta(pixel(8,png.height-5),pixel(8,png.height-navigation-5));assert.ok(statusDelta<=3&&navigationDelta<=18,JSON.stringify({statusDelta,navigationDelta}));report.screenshots.push({file:name,width,height,systemTheme:theme,pageTheme:theme,systemVersion:version,statusHeight:status,navigationHeight:navigation,bottomNavigationVisible:true,fullSystemBars:true,statusPageDifference:statusDelta,navigationPageDifference:navigationDelta});}
  await shot('memory-empty');assert.equal(await page.getByRole('switch').count(),0);
  await page.evaluate(()=>page('chat'));await page.getByRole('button',{name:'手机对话的更多操作',exact:true}).click();await shot('phone-conversation-menu');await page.getByRole('menuitem',{name:'删除对话',exact:true}).click();await shot('phone-conversation-delete');await page.getByRole('button',{name:'保留',exact:true}).click();

  await browser.close();browser=null;run('forward','--remove',`tcp:${forward}`);forward=null;run('shell','am','force-stop',pkg);
 }
 report.passed=true;
}finally{
 await browser?.close().catch(()=>{});if(serial){for(const args of [...(size?[['shell','wm','size',size],['shell','wm','density',density]]:[]),...(night?[['shell','cmd','uimode','night',night]]:[]),...(installed?[['shell','am','force-stop',pkg],['uninstall',pkg]]:[]),...(forward?[['forward','--remove',`tcp:${forward}`]]:[]),...(port?[['reverse','--remove',`tcp:${port}`]]:[])])try{run(...args);}catch{}execFileSync(adbExecutable,['disconnect',serial],{windowsHide:true});}
 if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await unlink(lock);await writeFile(join(out,'system-bars.json'),JSON.stringify(report,null,2));
 async function links(dir){for(const name of await readdir(dir)){const path=join(dir,name),s=await lstat(path);if(s.isSymbolicLink())await unlink(path);else if(s.isDirectory())await links(path);}}await links(local);assert.ok(local.startsWith(join(repo,'.local/mem-7')+ '/phone-container')||local===join(repo,'.local/mem-7/phone-container'));await rm(local,{recursive:true,force:true});
}
