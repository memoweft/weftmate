/** Remote mobile webpage inside the existing isolated Android test browser; no product shell edits. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {copyFile,open,unlink,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';
import {readMuMuInfo,adbExecutable} from '../../scripts/nightly/mumu.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function captureDailyDigestPhone(fixture,out,report){
  const cloud=!!process.env.WEFTMATE_DATA1_ANDROID_SERIAL,lock=cloud?resolve('.local/data1-phone.lock'):'D:/AIProjects/WeftMate/Runtime/Orchestrator/mumu.lock',pkg=process.env.WEFTMATE_DATA1_ANDROID_PACKAGE??'com.memoweft.weftmate.mobile.data1qa',activity=process.env.WEFTMATE_DATA1_ANDROID_ACTIVITY??'com.memoweft.weftmate.mobile.St2PhoneBrowserActivity',adb=process.env.WEFTMATE_DATA1_ADB??adbExecutable;
  if(cloud)await mkdir('.local',{recursive:true});
  const lease=await open(lock,'wx');await lease.writeFile(`DATA-1 ${new Date().toISOString()} synthetic remote webpage`);await lease.close();
  let serial,proxy,browser,forward,port,installed=false,size,density,night;
  const run=(...args)=>execFileSync(adb,['-s',serial,...args],{windowsHide:true,maxBuffer:16*1024*1024});
  const until=async(fn,label)=>{for(let n=0;n<100;n++){try{const result=await fn();if(result)return result;}catch{}await pause(100);}throw Error(`Synthetic phone did not become ready: ${label}`);};
  const metadata=[];
  try{
    serial=process.env.WEFTMATE_DATA1_ANDROID_SERIAL??readMuMuInfo().serial;if(!cloud)execFileSync(adb,['connect',serial],{windowsHide:true});
    const packages=run('shell','pm','list','packages').toString().split('\n').filter(line=>line.includes('weftmate'));
    assert.ok(!packages.some(line=>line.trim()===`package:${pkg}`),'Existing test browser is installed; preserve it and wait for its owner.');
    for(const line of packages){let pid='';try{pid=run('shell','pidof',line.replace('package:','').trim()).toString().trim();}catch{}assert.equal(pid,'','Another WeftMate test application is running.');}
    assert.notEqual(run('shell','getprop','qemu.hw.mainkeys').toString().trim(),'1','Visible bottom system navigation is required.');
    const apk=join(fixture.root,'data1-phone.apk');await copyFile(process.env.WEFTMATE_DATA1_PHONE_APK??resolve('apps/android/app/build/outputs/apk/debug/app-debug.apk'),apk);
    const manifest=execFileSync(process.env.WEFTMATE_DATA1_AAPT??'D:/Software/leidian/LDPlayer14/aapt.exe',['dump','xmltree','--file','AndroidManifest.xml',apk],{windowsHide:true,encoding:'utf8'});assert.ok(manifest.includes(activity));
    proxy=createServer(async(request,response)=>{try{const path=request.url==='/personal/v1/ui'?'/':request.url.replace(/^\/personal\/v1\//,'/');const body=['POST','PATCH','PUT','DELETE'].includes(request.method)?Buffer.concat(await Array.fromAsync(request)):undefined;const upstream=await fetch(new URL(path,fixture.mobileUrl),{method:request.method,body});response.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')??'application/octet-stream'});response.end(Buffer.from(await upstream.arrayBuffer()));}catch{response.writeHead(502).end();}});
    await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));port=proxy.address().port;run('reverse',`tcp:${port}`,`tcp:${port}`);run('install',apk);installed=true;
    size=/Override size: (\d+x\d+)/.exec(run('shell','wm','size').toString())?.[1]??'reset';density=/Override density: (\d+)/.exec(run('shell','wm','density').toString())?.[1]??'reset';night=/Night mode: (yes|no|auto)/.exec(run('shell','cmd','uimode','night').toString())?.[1];
    const version=run('shell','getprop','ro.build.version.release').toString().trim();
    for(const theme of process.env.WEFTMATE_DATA1_PHONE_THEME?[process.env.WEFTMATE_DATA1_PHONE_THEME]:['light','dark'])for(const [width,height]of (process.env.WEFTMATE_DATA1_PHONE_WIDTH?[[Number(process.env.WEFTMATE_DATA1_PHONE_WIDTH),Number(process.env.WEFTMATE_DATA1_PHONE_WIDTH)===360?780:844]]:[[360,780],[390,844]])){
      run('shell','wm','size',`${width*2}x${height*2}`);run('shell','wm','density','320');run('shell','cmd','uimode','night',theme==='dark'?'yes':'no');if(cloud)run('shell','am','force-stop','com.google.android.apps.nexuslauncher');
      run('shell','am','start','-W','-n',pkg+'/'+activity,'-e','st4Url',`http://127.0.0.1:${port}/personal/v1/ui`,'-e','st4Theme',theme);
      const pid=await until(()=>run('shell','pidof',pkg+':st4remote').toString().trim(),'browser process');forward=run('forward','tcp:0',`localabstract:webview_devtools_remote_${pid}`).toString().trim();await until(async()=>{const response=await fetch(`http://127.0.0.1:${forward}/json/list`);return (await response.json()).some(row=>row.url.includes(String(port)));},'debug target');
      browser=await chromium.connectOverCDP(`http://127.0.0.1:${forward}`,{noDefaults:true});const page=browser.contexts()[0].pages().find(page=>page.url().includes(String(port)));assert.ok(page);page.setDefaultTimeout(20000);await page.waitForFunction(()=>typeof state!=="undefined"&&state.booted&&state.loggedIn);
      const dump=run('shell','dumpsys','window','displays').toString(),inset=kind=>{const line=dump.split('\n').find(line=>line.includes('type='+kind)&&line.includes('visible=true'));const frame=/frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(line??'');return frame?Number(frame[4])-Number(frame[2]):0;};const status=inset('statusBars'),navigation=inset('navigationBars');assert.ok(status>0&&navigation>0);
      const capture=async scene=>{await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;WeftSystemBars.sync();},theme);await pause(500);const focus=run('shell','dumpsys','window').toString().split('\n').find(line=>line.includes('mCurrentFocus'))??'';assert.ok(focus.includes(pkg),'Only the synthetic webpage may be in front during capture: '+focus);const name=`phone-system-${width}-${theme}-${scene}.png`,path=join(out,name);await writeFile(path,run('exec-out','screencap','-p'));const pixels=cloud?{}:JSON.parse(execFileSync('python',['-c',"import sys,json;from PIL import Image;im=Image.open(sys.argv[1]).convert('RGB');s=int(sys.argv[2]);n=int(sys.argv[3]);a=im.getpixel((8,s//2));b=im.getpixel((8,s+5));c=im.getpixel((8,im.height-5));d=im.getpixel((8,im.height-n-5));print(json.dumps({'statusPageDifference':max(abs(x-y) for x,y in zip(a,b)),'navigationPageDifference':max(abs(x-y) for x,y in zip(c,d))}))",path,String(status),String(navigation)],{windowsHide:true,encoding:'utf8'}));metadata.push({file:name,systemTheme:theme,pageTheme:theme,systemVersion:version,statusHeight:status,navigationHeight:navigation,bottomNavigationVisible:true,fullSystemBars:true,nativeProductBridge:false,...pixels});report.screenshots.push(name);};
      await page.evaluate(()=>page('activity'));await page.getByRole('heading',{name:'这周回顾',exact:true}).waitFor();await page.getByRole('heading',{name:'这周回顾',exact:true}).evaluate(node=>node.scrollIntoView({block:'start'}));await capture('weekly');await page.getByRole('button',{name:/^更多来源/}).click();await capture('sources-open');await page.keyboard.press('Escape');
      {await page.evaluate(()=>page('notifications'));await page.getByRole('switch',{name:'回顾与洞察',exact:true}).waitFor();await page.getByRole('switch',{name:'回顾与洞察',exact:true}).scrollIntoViewIfNeeded();await capture('settings');await page.getByRole('combobox',{name:'保留多久',exact:true}).click();await capture('retention-open');await page.keyboard.press('Escape');await page.getByRole('button',{name:'清空回顾',exact:true}).click();await capture('clear-confirm');await page.getByRole('button',{name:'取消',exact:true}).click();}
      await browser.close();browser=null;run('forward','--remove',`tcp:${forward}`);forward=null;run('shell','am','force-stop',pkg);await pause(300);
    }
    await writeFile(join(out,'system-bars.json'),JSON.stringify(metadata,null,2)+'\n');report.mobileSystemBars='Android remote webpage in the synthetic test browser;  full status and bottom navigation bars captured. Product native bridge is outside this package.';report.checks.push('full-mobile-system-bars-light-dark-360-390-settings-open-controls');
  }finally{
    await browser?.close().catch(()=>{});
    if(serial){for(const args of [...(size?[['shell','wm','size',size],['shell','wm','density',density]]:[]),...(night?[['shell','cmd','uimode','night',night]]:[]),...(installed?[['shell','am','force-stop',pkg],['uninstall',pkg]]:[]),...(forward?[['forward','--remove',`tcp:${forward}`]]:[]),...(port?[['reverse','--remove',`tcp:${port}`]]:[])])try{run(...args);}catch{}try{if(!cloud)execFileSync(adb,['disconnect',serial],{windowsHide:true});}catch{}}
    if(proxy){proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}await unlink(lock);
  }
}
