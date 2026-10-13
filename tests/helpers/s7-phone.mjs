// Real remote webpage in the existing, unmodified debug-only Android browser.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {open,unlink,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
const {PNG}=createRequire(import.meta.url)('playwright-core/lib/utilsBundle');
import {readMuMuInfo,adbExecutable} from '../../scripts/nightly/mumu.mjs';
const pause=ms=>new Promise(done=>setTimeout(done,ms));
export async function s7Phone(origin,issuer,out,report,theme){
  const lock='D:/AIProjects/WeftMate/Runtime/Orchestrator/mumu.lock';
  for(;;){try{const handle=await open(lock,'wx');await handle.writeFile(`S7 ${new Date().toISOString()} Android system bars`);await handle.close();break;}catch(e){if(e.code!=='EEXIST')throw e;console.log('S7: waiting for simulator lock');await pause(120000);}}
  const pkg='com.memoweft.weftmate.mobile.st4qa',activity='com.memoweft.weftmate.mobile.St4RemoteBrowserActivity';
  let serial,installed=false,size,density,night,cdp,forward,page;
  const scripts=[],ports=[...new Set([new URL(origin).port,new URL(issuer).port])],metadata=[];
  const run=(...args)=>execFileSync(adbExecutable,['-s',serial,...args],{windowsHide:true,maxBuffer:16*1024*1024});
  const until=async(fn,label)=>{for(let n=0;n<120;n++){try{const value=await fn();if(value)return value;}catch{}await pause(250);}throw Error(label);};
  async function closePage(){
    if(installed)run('shell','am','force-stop',pkg);
    await cdp?.close().catch(()=>{});cdp=null;
    if(forward){run('forward','--remove',`tcp:${forward}`);forward=null;}
  }
  async function close(){
    try{await closePage();if(serial){for(const args of [...(size?[['shell','wm','size',size],['shell','wm','density',density]]:[]),...(night?[['shell','cmd','uimode','night',night]]:[]),...(installed?[['uninstall',pkg]]:[]),...ports.map(port=>['reverse','--remove',`tcp:${port}`])])try{run(...args);}catch{}execFileSync(adbExecutable,['disconnect',serial],{windowsHide:true});}}finally{await unlink(lock);}
  }
  try{
    serial=readMuMuInfo().serial;execFileSync(adbExecutable,['connect',serial],{windowsHide:true});
    await until(()=>run('shell','id','-u').toString().trim(),'Emulator shell');
    const packages=run('shell','pm','list','packages').toString().split('\n').filter(line=>line.includes('weftmate'));
    assert.ok(!packages.some(line=>line.trim()===`package:${pkg}`),'Existing test identity must be left to its owner');
    for(const line of packages){let pid='';try{pid=run('shell','pidof',line.replace('package:','').trim()).toString().trim();}catch{}assert.equal(pid,'','Another test app is using the simulator');}
    assert.notEqual(run('shell','getprop','qemu.hw.mainkeys').toString().trim(),'1','Bottom system navigation must be visible');
    size=/Override size: (\d+x\d+)/.exec(run('shell','wm','size').toString())?.[1]??'reset';density=/Override density: (\d+)/.exec(run('shell','wm','density').toString())?.[1]??'reset';night=/Night mode: (yes|no|auto)/.exec(run('shell','cmd','uimode','night').toString())?.[1];
    run('shell','wm','size','780x1688');run('shell','wm','density','320');run('shell','cmd','uimode','night',theme==='dark'?'yes':'no');
    for(const port of ports)run('reverse',`tcp:${port}`,`tcp:${port}`);
    run('install',resolve('apps/android/app/build/outputs/apk/debug/app-debug.apk'));installed=true;
    const systemVersion=run('shell','getprop','ro.build.version.release').toString().trim();
    return {
      theme,
      async addInitScript(script){scripts.push(script);},
      async newPage(){
        run('shell','am','start','-W','-n',pkg+'/'+activity,'-e','st4Url',origin+'/personal/v1/ui','-e','st4Theme',theme);
        const pid=await until(()=>run('shell','pidof',pkg+':st4remote').toString().trim(),'Synthetic phone process');
        forward=run('forward','tcp:0',`localabstract:webview_devtools_remote_${pid}`).toString().trim();
        await until(async()=>{const response=await fetch(`http://127.0.0.1:${forward}/json/list`);return (await response.json()).some(row=>row.url.includes(new URL(origin).port));},'Phone debug target');
        cdp=await chromium.connectOverCDP(`http://127.0.0.1:${forward}`,{noDefaults:true});const context=cdp.contexts()[0];
        for(const script of scripts)await context.addInitScript(script);
        page=context.pages().find(page=>page.url().includes(new URL(origin).port));assert.ok(page);page.setDefaultTimeout(30000);
        await page.reload();page.close=closePage;return page;
      },
      async capture(scene){
        const dump=run('shell','dumpsys','window','displays').toString(),inset=kind=>{const line=dump.split('\n').find(line=>line.includes('type='+kind)&&line.includes('visible=true'));const frame=/frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(line??'');return frame?Number(frame[4])-Number(frame[2]):0;};
        const status=inset('statusBars'),navigation=inset('navigationBars');
        if(!(status>0&&navigation>0)){await writeFile(join(out,'failure-system-bars.png'),run('exec-out','screencap','-p'));throw Error('System bar frames: '+JSON.stringify(dump.split('\n').filter(line=>/statusBars|navigationBars|mHasNavigationBar/.test(line))));}
        assert.ok(run('shell','dumpsys','window').toString().split('\n').some(line=>line.includes('mCurrentFocus')&&line.includes(pkg)),'Synthetic app must own the captured screen');
        await page.evaluate(()=>document.activeElement?.blur());await pause(600);
        const probes=await page.evaluate(()=>[...document.querySelectorAll('.offline-task-state,.offline-chat h1,.goals-confirm h2,#header-title')].filter(n=>{const r=n.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight;}).map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,color:getComputedStyle(n).color.match(/[\d.]+/g)?.slice(0,3).map(Number),text:n.textContent.trim().slice(0,80)};}));
        assert.ok(probes.length,'Visible product text required');
        let frame,png,nativeTextRegions;
        for(let attempt=0;attempt<8;attempt++){
          await pause(600);frame=run('exec-out','screencap','-p');png=PNG.sync.read(frame);const scale=png.width/(await page.evaluate(()=>innerWidth));
          nativeTextRegions=probes.map(p=>{let ink=0;for(let y=Math.ceil(status+p.y*scale);y<Math.min(png.height,Math.floor(status+(p.y+p.height)*scale));y++)for(let x=Math.max(0,Math.ceil(p.x*scale));x<Math.min(png.width,Math.floor((p.x+p.width)*scale));x++){const at=(y*png.width+x)*4;if(p.color?.every((c,i)=>Math.abs(c-png.data[at+i])<12))ink++;}return {text:p.text,inkPixels:ink};});
          if(nativeTextRegions.every(r=>r.inkPixels>32))break;
        }
        assert.ok(nativeTextRegions.every(r=>r.inkPixels>32),'Native screenshot must contain the visible product text: '+JSON.stringify(nativeTextRegions));
        const file=`phone-system-390-${theme}-${scene}.png`,pixel=(x,y)=>[0,1,2].map(i=>png.data[(Math.floor(y)*png.width+x)*4+i]);
        const difference=(a,b)=>Math.max(...a.map((v,i)=>Math.abs(v-b[i]))),statusPageDifference=difference(pixel(8,status/2),pixel(8,status+5)),navigationPageDifference=difference(pixel(8,png.height-5),pixel(8,png.height-navigation-5));
        assert.ok(statusPageDifference<=3,`Status colour difference ${statusPageDifference}`);assert.ok(navigationPageDifference<=18,`Navigation colour difference ${navigationPageDifference}`);
        await writeFile(join(out,file),frame);report.screenshots.push(file);
        report.systemBars='Real Android remote webpage in the unchanged isolated debug browser; full status and bottom navigation captured.';
        metadata.push({file,systemTheme:theme,pageTheme:theme,systemVersion,statusHeight:status,navigationHeight:navigation,bottomNavigationVisible:true,fullSystemBars:true,nativeProductBridge:false,nativeTextRegions,statusPageDifference,navigationPageDifference});
        await writeFile(join(out,`system-bars-${theme}.json`),JSON.stringify(metadata,null,2)+'\n');
      },close,
    };
  }catch(error){await close();throw error;}
}
