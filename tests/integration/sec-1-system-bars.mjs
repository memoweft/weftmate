/** Existing isolated test WebView, real Android system bars; no product shell changes. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {open,rm,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {readMuMuInfo} from '../../scripts/nightly/mumu.mjs';
export async function sec1SystemBars({origin,cookie,out}) {
  await mkdir(resolve('.local/sec-1'),{recursive:true});
  const stock=!!process.env.WEFTMATE_SEC1_ANDROID_SERIAL,lock=stock?resolve('.local/sec1-phone.lock'):'D:/AIProjects/WeftMate/Runtime/Orchestrator/mumu.lock',lease=await open(lock,'wx');await lease.writeFile(`SEC-1 ${new Date().toISOString()} synthetic cloud webpage`);await lease.close();
  const adb=process.env.WEFTMATE_SEC1_ADB??'D:/Software/MuMuPlayer/nx_main/adb.exe',pkg=process.env.WEFTMATE_SEC1_ANDROID_PACKAGE??'com.memoweft.weftmate.mobile.st4qa',apk=resolve(process.env.WEFTMATE_SEC1_ANDROID_APK??'apps/android/app/build/outputs/apk/debug/app-debug.apk');
  let serial,socket,forward,installed=false,resized=false,originalSize,originalDensity,originalNight;
  const checks=[];
  const run=(...args)=>execFileSync(adb,['-s',serial,...args],{windowsHide:true,maxBuffer:16*1024*1024});
  async function close(){
    socket?.close();
    if(serial){for(const args of [...(resized?[['shell','wm','size',originalSize],['shell','wm','density',originalDensity]]:[]),...(installed?[['shell','am','force-stop',pkg],['uninstall',pkg]]:[]),...(originalNight?[['shell','cmd','uimode','night',originalNight]]:[]),...(forward?[['forward','--remove',`tcp:${forward}`]]:[]),['reverse','--remove',`tcp:${new URL(origin).port}`]])try{run(...args);}catch{}
      try{if(!stock)execFileSync(adb,['disconnect',serial],{windowsHide:true});}catch{}
    }
    await writeFile(join(out,'system-bar-checks.json'),JSON.stringify({surface:'synthetic cloud webpage in isolated test WebView',productionNativeShell:false,checks},null,2)+'\n');await rm(lock,{force:true});
  }
  try{
    serial=process.env.WEFTMATE_SEC1_ANDROID_SERIAL??readMuMuInfo(execFileSync).serial;if(!stock)execFileSync(adb,['connect',serial],{windowsHide:true});
    const packages=run('shell','pm','list','packages').toString().split('\n').filter(line=>/weftmate/.test(line));assert.ok(!packages.some(line=>line.includes(pkg)),'Existing test browser belongs to another task');
    for(const line of packages){let pid='';try{pid=run('shell','pidof',line.replace('package:','').trim()).toString().trim();}catch{}assert.equal(pid,'','Another WeftMate test is running');}
    originalSize=run('shell','wm','size').toString().trim().split(': ').at(-1);originalDensity=run('shell','wm','density').toString().trim().split(': ').at(-1);originalNight=/Night mode: (yes|no|auto)/i.exec(run('shell','cmd','uimode','night').toString())?.[1];
    const metadata=execFileSync(process.env.WEFTMATE_SEC1_AAPT??'D:/Software/leidian/LDPlayer14/aapt.exe',['dump','badging',apk],{windowsHide:true,encoding:'utf8'});assert.ok(metadata.startsWith(`package: name='${pkg}'`));
    run('install',apk);installed=true;run('reverse',`tcp:${new URL(origin).port}`,`tcp:${new URL(origin).port}`);
    const systemVersion=run('shell','getprop','ro.build.version.release').toString().trim();
    async function capture(mode,sessionId){
      for(const width of process.env.WEFTMATE_SEC1_PHONE_WIDTH?[Number(process.env.WEFTMATE_SEC1_PHONE_WIDTH)]:[360,390])for(const theme of process.env.WEFTMATE_SEC1_PHONE_THEME?[process.env.WEFTMATE_SEC1_PHONE_THEME]:['light','dark']){
        socket?.close();socket=null;if(forward){run('forward','--remove',`tcp:${forward}`);forward=null;}
        run('shell','am','force-stop',pkg);const height=width===360?780:844;run('shell','wm','size',`${width*2}x${height*2}`);run('shell','wm','density','320');resized=true;run('shell','cmd','uimode','night',theme==='dark'?'yes':'no');
        await new Promise(done=>setTimeout(done,1500));if(stock)try{run('shell','am','force-stop','com.google.android.apps.nexuslauncher');}catch{}
        run('shell','am','start','-W','-n',pkg+'/'+(process.env.WEFTMATE_SEC1_ANDROID_ACTIVITY??'com.memoweft.weftmate.mobile.St4RemoteBrowserActivity'),'-e','st4Url',origin+'/personal/v1/ui','-e','st4Theme',theme);
        await new Promise(done=>setTimeout(done,500));console.log(run('shell','am','start','-W','-f','0x10020000','-n',pkg+'/'+(process.env.WEFTMATE_SEC1_ANDROID_ACTIVITY??'com.memoweft.weftmate.mobile.St4RemoteBrowserActivity'),'-e','st4Url',origin+'/personal/v1/ui','-e','st4Theme',theme).toString());
        let pid;for(let n=0;n<100;n++){try{pid=run('shell','pidof',pkg+':st4remote').toString().trim();if(pid)break;}catch{}await new Promise(done=>setTimeout(done,100));}assert.ok(pid);
        forward=run('forward','tcp:0',`localabstract:webview_devtools_remote_${pid}`).toString().trim();
        let target;for(let n=0;n<100;n++){try{target=(await(await fetch(`http://127.0.0.1:${forward}/json/list`)).json()).find(row=>row.url.startsWith(origin));if(target)break;}catch{}await new Promise(done=>setTimeout(done,100));}assert.ok(target);
        socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((done,fail)=>{socket.addEventListener('open',done,{once:true});socket.addEventListener('error',fail,{once:true});});let sequence=0;
        const cdp=(method,params)=>new Promise((done,fail)=>{const id=++sequence,timer=setTimeout(()=>{socket.removeEventListener('message',listener);fail(Error('CDP timeout '+method));},30000),listener=event=>{const data=JSON.parse(event.data);if(data.id===id){socket.removeEventListener('message',listener);clearTimeout(timer);data.error?fail(Error(JSON.stringify(data.error))):done(data.result);}};socket.addEventListener('message',listener);socket.send(JSON.stringify({id,method,params}));});
        const evaluate=async expression=>{const value=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(value.exceptionDetails)throw Error(JSON.stringify(value.exceptionDetails));return value.result.value;};
        const until=async expression=>{for(let n=0;n<150;n++){if(await evaluate(expression))return;await new Promise(done=>setTimeout(done,100));}throw Error('WebView readiness timeout: '+expression+' '+await evaluate("document.body.innerText.slice(-800)"));};
        await cdp('Page.enable',{});
        await cdp('Page.addScriptToEvaluateOnNewDocument',{source:"(()=>{const originalFetch=globalThis.fetch;globalThis.fetch=async(...args)=>{const response=await originalFetch(...args);if(new URL(String(args[0]),location.origin).pathname==='/personal/v1/status'){const data=await response.json();return new Response(JSON.stringify({...data,personalCapabilities:{}}),{status:response.status,headers:response.headers});}return response;};let api;Object.defineProperty(globalThis,'WeftUiCore',{configurable:true,get:()=>api,set:value=>{api=value;const create=value.create;value.create=(...args)=>{const core=create(...args),init=core.initializeCloudAccount;core.cloudOfflineIdentity=()=>null;core.initializeCloudAccount=(...args)=>{const result=init(...args),load=core.load;core.load=async(...args)=>{try{return await load(...args);}finally{globalThis.sec1Loaded=true;}};return result;};return globalThis.sec1Core=core;};}});})();"});
        const [name,...value]=cookie.split('=');assert.ok((await cdp('Network.setCookie',{name,value:value.join('='),url:origin,httpOnly:true,sameSite:'Strict'})).success);await cdp('Page.reload',{});await until('globalThis.sec1Loaded===true');
        console.log(run('shell','am','start','-W','-f','0x10020000','-n',pkg+'/'+(process.env.WEFTMATE_SEC1_ANDROID_ACTIVITY??'com.memoweft.weftmate.mobile.St4RemoteBrowserActivity'),'-e','st4Url',origin+'/personal/v1/ui','-e','st4Theme',theme).toString());
        // This fixture covers approvals; it does not provision an offline cloud model/replica.
        await evaluate(`(async()=>{const me=await(await fetch('/personal/v1/auth/me')).json();if(me.device.authKind!=='cloud')throw Error('Cloud identity required');sec1Core.cloudOfflineIdentity=()=>null;sec1Core.state.cloudAuth.mode='authenticated';await sec1Core.acceptSession(me);await sec1Core.enterAssistant();await sec1Core.selectSession(${JSON.stringify(sessionId)});document.documentElement.dataset.theme=${JSON.stringify(theme)};window.weftSyncSystemBars?.();})()`);
        await until("!!document.querySelector('#approval-bar:not([hidden])')");await new Promise(done=>setTimeout(done,200));
        console.log(run('shell','am','start','-W','-f','0x10020000','-n',pkg+'/'+(process.env.WEFTMATE_SEC1_ANDROID_ACTIVITY??'com.memoweft.weftmate.mobile.St4RemoteBrowserActivity'),'-e','st4Url',origin+'/personal/v1/ui','-e','st4Theme',theme).toString());
        await new Promise(done=>setTimeout(done,300));
        const focus=run('shell','dumpsys','window').toString().split('\n').find(line=>line.includes('mCurrentFocus'));
        if(!focus?.includes(pkg))console.log(run('logcat','-d','-s','AndroidRuntime:E').toString().slice(-6000));
        assert.ok(focus?.includes(pkg), 'Screenshot must show the test browser, without a system error dialog: '+(focus??'focus unavailable'));
        const dump=run('shell','dumpsys','window','displays').toString();
        await writeFile(resolve('.local/sec-1/system-insets.txt'),dump.split('\n').filter(line=>/navigationBars|statusBars|NavigationBar/.test(line)).join('\n'));
        const insetHeight=kind=>{const line=dump.split('\n').find(line=>line.includes('type='+kind)&&line.includes('visible=true'));const frame=/frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(line??'');return frame?Number(frame[4])-Number(frame[2]):0;};
        const statusHeight=insetHeight('statusBars'),navigationHeight=insetHeight('navigationBars');assert.ok(statusHeight>0&&navigationHeight>0, 'Real visible system insets required: '+dump.split('\n').filter(line=>/navigationBars|statusBars/.test(line)).join('\n'));
        const file=`phone-system-${width}-${theme}-${mode}.png`;await writeFile(join(out,file),run('exec-out','screencap','-p'));
        checks.push({file,width,height,systemTheme:theme,pageTheme:theme,systemVersion,statusHeight,navigationHeight,bottomNavigationVisible:true,fullSystemScreen:true});
      }
    }
    return {capture,close};
  }catch(error){await close();throw error;}
}
