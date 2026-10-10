/** Opt-in Android acceptance. Real login UI/native transport; synthetic cloud/host only. */
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
import {startAndroidLoginFixture} from './and-2-fixture.mjs';
import {systemBarDifference} from '../../scripts/nightly/system-bars.mjs';
const adb=process.env.AND2_ADB||'D:/Software/MuMuPlayer/nx_main/adb.exe',serial='127.0.0.1:7555',pkg='com.memoweft.weftmate.mobile.lg1bqa';
const out=resolve('tests/evidence/and-2');await mkdir(out,{recursive:true});
const adbServer=process.env.AND2_ADB_PORT?['-P',process.env.AND2_ADB_PORT]:[];
const run=(...args)=>execFileSync(adb,[...adbServer,'-s',serial,...args],{windowsHide:true,timeout:20000,maxBuffer:20*1024*1024,stdio:['ignore','pipe','pipe']});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,label,ms=30000){const deadline=Date.now()+ms;while(Date.now()<deadline){if(await check())return;await pause(150);}throw Error(label);}
const report={package:pkg,realNativeTransport:true,syntheticHostName:'synthetic-host',modelRequests:0,matrix:[],screens:[],instrumentation:[],avd:{emulatorInstalled:false,configuredAvd:false,navigationSupplement:false}};
let browser,probe,forward,log='',page;
async function attach(){await until(()=>{try{return !!run('shell','pidof',pkg).toString().trim();}catch{return false;}},'Native process missing');
 const pid=run('shell','pidof',pkg).toString().trim();forward=run('forward','tcp:0','localabstract:webview_devtools_remote_'+pid).toString().trim();
 await until(async()=>{try{browser=await chromium.connectOverCDP('http://127.0.0.1:'+forward,{noDefaults:true});return true;}catch{return false;}},'Native WebView missing');
 await until(()=>{page=browser.contexts()[0].pages().find(p=>p.url().includes('appassets'));return !!page;},'Actual assets missing');page.setDefaultTimeout(12000);
 await page.waitForFunction(()=>typeof state!=='undefined'&&state.booted);
}
async function finish(marker){try{run('shell','run-as',pkg,'touch','files/'+marker);}catch{}
 if(probe?.exitCode===null)await until(()=>probe.exitCode!==null,'Instrumentation did not finish',10000);
 if(log){report.instrumentation.push({passed:/OK \(1 test\)/.test(log),log});assert.match(log,/OK \(1 test\)/);}
 await browser?.close();browser=null;page=null;if(forward)run('forward','--remove','tcp:'+forward);forward=null;
}
function instrument(args){log='';const quoted=args.map(value=>"'"+String(value).replaceAll("'","'\\''")+"'");probe=spawn(adb,[...adbServer,'-s',serial,'shell','am','instrument','-w',...quoted,pkg+'.test/androidx.test.runner.AndroidJUnitRunner'],{windowsHide:true});probe.stdout.on('data',v=>log+=v);probe.stderr.on('data',v=>log+=v);}
async function resume(origin){instrument(['-e','class','com.memoweft.weftmate.mobile.Lg1bWebViewProbeTest','-e','lg1bProbe','1','-e','lg1bHostOrigin',origin]);await attach();}
const native=()=>{try{return JSON.parse(run('shell','run-as',pkg,'cat','files/and2-window.json'));}catch{return null;}};
async function theme(value){await page.evaluate(async value=>{if(state.loggedIn)await call('settings.appearance',{value});applyTheme(value);},value);await pause(350);}
async function shot(scene,requested,mode){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await pause(250);
 const png=run('exec-out','screencap','-p'),n=native();assert.ok(n,'Native system-bar measurement missing');
 const dom=await page.evaluate(()=>({theme:document.documentElement.dataset.theme,dpr:devicePixelRatio,width:innerWidth,height:innerHeight,
  topbar:document.querySelector('.topbar').getBoundingClientRect().toJSON(),composer:document.querySelector('.composer-dock').getBoundingClientRect().toJSON(),toast:document.getElementById('toast').hidden?null:document.getElementById('toast').getBoundingClientRect().toJSON(),safeTop:getComputedStyle(document.documentElement).getPropertyValue('--safe-top'),
  statusDots:[...document.querySelectorAll('.mobile-session-status,[data-status-key]')].map(n=>({class:n.className,label:n.getAttribute('aria-label'),color:getComputedStyle(n).backgroundColor}))}));
 const file=`${mode}-${scene}-${requested}.png`;await writeFile(join(out,file),png);
 const difference=systemBarDifference(png,{statusHeight:n.statusHeight});assert.ok(difference.passed,JSON.stringify({file,difference}));
 assert.equal(n.darkStatusIcons,dom.theme==='light',file);
 report.screens.push({file,scene,mode,systemTheme:run('shell','cmd','uimode','night').toString().trim(),pageTheme:dom.theme,osVersion:run('shell','getprop','ro.build.version.release').toString().trim(),navigationVisible:n.navigationHeight>0,native:n,dom,difference,iconsMatch:true});
 await writeFile(join(out,'results.json'),JSON.stringify(report,null,2)+'\n');
}
async function send(mode,scenario){await page.waitForFunction(()=>state.loggedIn&&state.logicalChats&&uiCore.inMainChat()&&!document.getElementById('draft').disabled);
 const message=`AND2 ${mode} ${scenario}`;await page.locator('#draft').fill(message);await page.getByRole('button',{name:'发送',exact:true}).click();
 try {await page.waitForFunction(text=>document.getElementById('chat-content').innerText.includes('合成回复：'+text),message);}catch(error){console.log(await page.evaluate(()=>({body:document.body.innerText,loggedIn:state.loggedIn,pending:state.sharedPending,shared:state.sharedSessionId,logical:state.logicalChats,chat:uiCore.state.selectedChatId,history:uiCore.state.historyEvents.size})));throw error;}
 return page.evaluate(()=>({loggedIn:state.loggedIn,ownerPresent:!!state.owner,connection:state.connection,authEpoch:state.authEpoch,mainChat:uiCore.inMainChat(),canSend:!document.getElementById('draft').disabled}));
}
try{
 const busy=run('shell','ps','-A').toString().split('\n').filter(line=>line.includes('weftmate')&&!line.includes(pkg));assert.deepEqual(busy,[],'Another package is running');
 for(const mode of ['local','cloud']){
  const f=await startAndroidLoginFixture({localMode:mode==='local'}),ports=[new URL(f.origin).port,new URL(f.cloud.origin).port];
  try{
   for(const name of [pkg+'.test',pkg])try{run('uninstall',name);}catch{}
   for(const file of ['debug/app-debug.apk','androidTest/debug/app-debug-androidTest.apk'])run('install',resolve('apps/android/app/build/outputs/apk/'+file));
   for(const port of ports)run('reverse','tcp:'+port,'tcp:'+(port===ports[0]?f.transportPort:port));
   instrument(['-e','class','com.memoweft.weftmate.mobile.AndroidLoginInstrumentedTest','-e','and2Login','1','-e','and2CaptureLogin','1','-e','and2Mode',mode,'-e','lg1bHostOrigin',f.origin,'-e','and2User',mode==='cloud'?f.email:f.credentials.username,'-e','and2Password',mode==='cloud'?f.password:f.credentials.password]);
   await attach();
   if(mode==='cloud'){
    for(const selected of ['light','dark']){await theme(selected);await shot('login',selected,mode);}
    run('shell','run-as',pkg,'touch','files/and2-start-login');
    await page.waitForFunction(()=>!!document.getElementById('auth-code'));
    // Only the synthetic file mailer is read. Product form validates the code.
    const challenge=f.cloud.db.prepare('SELECT * FROM email_challenges WHERE consumed=0').all().at(-1);
    const code=await f.cloud.mailCode(challenge.id);assert.match(code,/^\d{6}$/);run('shell','run-as',pkg,'sh','-c',`'echo ${code} > files/and2-code.txt'`);
    await page.waitForFunction(()=>WeftMobileCloud.core.state.cloudAuth.mode==='waiting');
    const requestId=await page.evaluate(()=>WeftMobileCloud.core.state.cloudAuth.requestId);await f.approve(requestId);
   }
   await until(()=>{try{return JSON.parse(run('shell','run-as',pkg,'cat','files/and2-smoke.json')).passed;}catch{return false;}},'Native real-login smoke failed: '+mode,55000);
   report.matrix.push({mode,scenario:'fresh-install',nativeSmoke:JSON.parse(run('shell','run-as',pkg,'cat','files/and2-smoke.json')),state:await send(mode,'fresh-install')});
   console.log(mode+' fresh real login/send passed');
   if(mode==='cloud'){
    const pairing=await f.request('/cloud/pairings',{},f.local);assert.equal(pairing.status,201);
    await page.evaluate(()=>page('devices'));await page.locator('#cloud-pairing-input').fill('wm1.'+Buffer.from(JSON.stringify(pairing)).toString('base64url'));await page.locator('#cloud-pairing-connect').click();
    await page.waitForFunction(()=>state.page==='chat'&&state.loggedIn&&!document.body.classList.contains('cloud-auth-active'));
    report.pairing={realVisibleForm:true,state:await send(mode,'pairing')};
    for(const selected of ['light','dark']){
     await theme(selected);await page.evaluate(()=>closeDrawer());await shot('main',selected,mode);
     await page.locator('#menu-button').click();await page.locator('#drawer.open').waitFor();await shot('drawer-status-dots',selected,mode);
     await page.locator('#mobile-search-entry').click();await page.getByRole('button',{name:'关闭搜索',exact:true}).waitFor();await shot('fullscreen-search',selected,mode);await page.getByRole('button',{name:'关闭搜索',exact:true}).click();await page.evaluate(()=>closeDrawer());
     await page.locator('#conversation-more').click();await page.getByRole('menu',{name:'对话操作',exact:true}).waitFor();await shot('top-more-menu',selected,mode);await page.keyboard.press('Escape');
     await page.evaluate(()=>page('data'));await page.getByText('本账户共占用',{exact:false}).waitFor();await shot('data-storage',selected,mode);
     await page.evaluate(()=>toast('系统通知说明：可以在设置中选择接收的提醒。'));await shot('data-storage-toast',selected,mode);
     const g=await page.evaluate(()=>({header:document.querySelector('.topbar').getBoundingClientRect().bottom,toast:document.getElementById('toast').getBoundingClientRect().top}));assert.ok(g.toast>=g.header);
     await page.evaluate(async()=>{closeToast();await uiCore.selectMainChat();page('chat');});
     const box=await page.locator('#draft').boundingBox(),dpr=await page.evaluate(()=>devicePixelRatio);run('shell','input','tap',String(Math.round((box.x+box.width/2)*dpr)),String(Math.round((box.y+box.height/2)*dpr)));
     if(!(native()?.imeHeight>0)){run('shell','run-as',pkg,'touch','files/and2-show-ime');}
     let keyboardVisible=true;
     try{await until(()=>native()?.imeHeight>0,'Current IME did not expose visible keyboard',10000);}catch(error){
      keyboardVisible=false;let request;try{request=JSON.parse(run('shell','run-as',pkg,'cat','files/and2-ime-request.json'));}catch{}
      report.keyboardGaps??=[];report.keyboardGaps.push({theme:selected,native:native(),request,defaultInputMethod:run('shell','settings','get','secure','default_input_method').toString().trim(),showImeWithHardKeyboard:run('shell','settings','get','secure','show_ime_with_hard_keyboard').toString().trim(),reason:String(error)});
     }
     await shot(keyboardVisible?'keyboard':'composer-focused-without-ime',selected,mode);run('shell','input','keyevent','4');await pause(300);
    }
   }
   // Real listener stop, not HTTP failure projection. Same profile and port reopen.
   const owner=await page.evaluate(()=>state.owner);await page.locator('#draft').fill('保留的合成草稿');await f.stop();console.log(mode+' synthetic host process stopped');
   for(let n=0;n<4;n++){await page.evaluate(()=>{void uiCore.retryConnection();});await pause(1100);}
   await page.waitForFunction(()=>uiCore.connectionView().kind==='host_offline',null,{timeout:45000});
   assert.equal(await page.evaluate(()=>state.loggedIn),true);assert.equal(await page.locator('#draft').inputValue(),'保留的合成草稿');
   for(const selected of ['light','dark']){await theme(selected);await shot('offline',selected,mode);}
   await f.resume();await page.evaluate(()=>uiCore.retryConnection());await page.waitForFunction(()=>uiCore.connectionView().kind==='online');assert.equal(await page.evaluate(()=>state.owner),owner);
   for(const selected of ['light','dark']){await theme(selected);await shot('recovered',selected,mode);}
   report.matrix.push({mode,scenario:'host-restart',draftRetained:true,identityRetained:true,state:await send(mode,'host-restart')});console.log(mode+' host restart passed');
   // Keep real inset measurement fresh while testing HOME -> existing task.
   run('shell','input','keyevent','3');await pause(500);run('shell','am','start','-n',pkg+'/com.memoweft.weftmate.mobile.HybridActivity');await pause(700);
   assert.equal(await page.evaluate(()=>state.owner),owner);report.matrix.push({mode,scenario:'background-return',identityRetained:true,state:await send(mode,'background-return')});console.log(mode+' background return passed');
   await finish('and2-probe.done');
   run('shell','am','force-stop',pkg);await resume(f.origin);
   report.matrix.push({mode,scenario:'process-reopen',state:await send(mode,'process-reopen')});console.log(mode+' process reopen passed');
   await finish('lg1b-probe.done');
   report.matrix.at(-1).hostReceivedMessages=f.sends.length;
  }catch(error){console.log('Failure in '+mode,String(error),log);try{console.log(JSON.stringify({sends:f.sends,state:await page.evaluate(()=>({loggedIn:state.loggedIn,connection:uiCore.connectionView(),body:document.body.innerText}))},null,2));await writeFile(join(out,mode+'-failure.png'),run('exec-out','screencap','-p'));}catch{}throw error;}finally{if(browser)await finish('and2-probe.done').catch(()=>{});for(const port of ports)try{run('reverse','--remove','tcp:'+port);}catch{}await f.close();}
 }
 report.authenticationPassed=report.matrix.length===8&&report.matrix.every(row=>row.state.loggedIn&&row.state.canSend);
 report.keyboardComplete=!report.keyboardGaps?.length;
 report.systemNavigationComplete=report.screens.length>0&&report.screens.every(row=>row.navigationVisible);
}catch(error){report.error=String(error);try{await writeFile(join(out,'failure.png'),run('exec-out','screencap','-p'));}catch{}throw error;}
finally{
 await browser?.close().catch(()=>{});try{run('shell','run-as',pkg,'touch','files/and2-probe.done');run('shell','run-as',pkg,'touch','files/lg1b-probe.done');}catch{}
 if(probe?.exitCode===null)probe.kill();if(forward)try{run('forward','--remove','tcp:'+forward);}catch{}
 for(const name of [pkg+'.test',pkg])try{run('uninstall',name);}catch{}
 await writeFile(join(out,'results.json'),JSON.stringify(report,null,2)+'\n');
}
