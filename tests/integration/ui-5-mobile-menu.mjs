import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { mobileBridge } from '../../scripts/review-gallery/mobile-bridge.mjs';

const repository=resolve(import.meta.dirname,'../..'),adb='D:/Software/MuMuPlayer/nx_main/adb.exe',serial='127.0.0.1:7555',packageId='com.memoweft.weftmate.mobile.ui5qa';
const adbRun=(...args)=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',windowsHide:true});
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
async function until(check){const end=Date.now()+60000;while(Date.now()<end){const value=await check();if(value)return value;await sleep(250)}throw Error('Mobile UI-5 wait timed out');}

export async function verifyMobileMenus({origin,credentials,evidence,sessionId,api,mumu=false}){
  let browser,server,page,installed=false,instrumentation,forwardPort;
  const surface=mumu?'mumu':'mobile-web',errors=[];
  try{
    if(mumu){
      assert.equal(adbRun('shell','ps','-A').split('\n').filter(row=>row.includes('weftmate')).length,0,'MuMu occupied by another work package');
      adbRun('install',join(repository,'apps/android/app/build/outputs/apk/debug/app-debug.apk'));installed=true;
      adbRun('install',join(repository,'apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'));
      const hostPort=new URL(origin).port;adbRun('reverse',`tcp:${hostPort}`,`tcp:${hostPort}`);
      instrumentation=spawn(adb,['-s',serial,'shell','am','instrument','-w','-e','class','com.memoweft.weftmate.mobile.Ui5WebViewProbeTest','-e','ui5Probe','1',`${packageId}.test/androidx.test.runner.AndroidJUnitRunner`],{windowsHide:true});
      instrumentation.stdout.on('data',part=>process.stdout.write(part));instrumentation.stderr.on('data',part=>process.stderr.write(part));
      const pid=await until(()=>{try{return adbRun('shell','pidof',packageId).trim()}catch{return false}});
      const reserve=createServer();await new Promise(done=>reserve.listen(0,'127.0.0.1',done));forwardPort=reserve.address().port;await new Promise(done=>reserve.close(done));
      adbRun('forward',`tcp:${forwardPort}`,`localabstract:webview_devtools_remote_${pid}`);
      await until(async()=>{try{return (await(await fetch(`http://127.0.0.1:${forwardPort}/json`)).json()).some(row=>row.url.includes('appassets'))}catch{return false}});
      browser=await chromium.connectOverCDP(`http://127.0.0.1:${forwardPort}`,{noDefaults:true});page=browser.contexts()[0].pages().find(row=>row.url().includes('appassets'));
      await page.waitForFunction(()=>typeof state!=='undefined'&&state.booted);
      await page.evaluate(async value=>{await mobileEffects.nativeCall('auth.login',value)}, {origin,...credentials,deviceName:'合成 UI-5 MuMu'});await page.reload();
      await page.waitForFunction(()=>WeftMobileCloud.core?.state.cloudAuth.mode==='login');
      await page.waitForTimeout(1500);
      await page.evaluate(()=>{WeftMobileCloud.core.show=()=>{};WeftMobileCloud.core.state.cloudAuth.mode='authenticated';WeftMobileCloud.core.state.currentView='assistant';document.body.classList.remove('cloud-auth-active');page('home');});
    }else{
      const fixture={origin,credentials,ownerId:(await api('/auth/me')).body.account.ownerId};const bridge=mobileBridge(fixture,'light');await bridge({method:'auth.login',params:{...credentials,deviceName:'合成 UI-5 手机网页'}});
      const assets=join(repository,'apps/mobile-ui/www');server=createServer((req,res)=>{try{const file=resolve(assets,'.'+(req.url==='/'?'/index.html':new URL(req.url,'http://localhost').pathname));if(!file.startsWith(assets))return res.writeHead(404).end();res.setHeader('content-type',{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]||'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404).end();}});
      await new Promise(done=>server.listen(0,'127.0.0.1',done));browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
      await page.exposeFunction('__ui5Native',async payload=>{try{return{id:payload.id,ok:true,result:await bridge(payload)}}catch(error){return{id:payload.id,ok:false,error:{code:error.message,status:error.status}}}});
      await page.addInitScript(()=>window.weftNative={postMessage(value){window.__ui5Native(JSON.parse(value)).then(result=>window.weftNative.onmessage({data:JSON.stringify(result)}));}});await page.goto(`http://127.0.0.1:${server.address().port}/`);
    }
    page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));await page.waitForFunction(()=>state.booted&&state.loggedIn);
    const click=async locator=>{await locator.click();};
    const shots=async name=>{for(const theme of ['light','dark']){await page.evaluate(t=>applyTheme(t),theme);await sleep(200);const file=join(evidence,`${surface}-${name}-${theme}.png`);if(mumu)writeFileSync(file,execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{windowsHide:true,maxBuffer:12*1024*1024}));else await page.screenshot({path:file,animations:'disabled'});}};
    const button=name=>page.getByRole('button',{name,exact:true});
    await page.evaluate(()=>page('home'));await page.waitForFunction(id=>state.sharedSessions.some(row=>row.sessionId===id),sessionId);
    const title=(await api('/sessions')).body.sessions.find(row=>row.sessionId===sessionId).title;
    const session=page.getByRole('main').getByRole('button',{name:title,exact:true});await session.waitFor();
    if(mumu){const box=await session.boundingBox(),dpr=await page.evaluate(()=>devicePixelRatio),x=Math.round((box.x+box.width/2)*dpr),y=Math.round((box.y+box.height/2+24)*dpr);adbRun('shell','input','swipe',String(x),String(y),String(x),String(y),'650');}
    else{await session.dispatchEvent('pointerdown');await sleep(600);await session.dispatchEvent('pointerup');}
    await page.getByRole('dialog',{name:'对话操作',exact:true}).waitFor();
    for(const name of ['取消置顶','标记为未读','重命名','分叉','移至分组','归档','删除'])await button(name).waitFor();
    await shots('long-press-menu');await click(button('标记为未读'));await until(async()=>(await api('/sessions')).body.sessions.find(row=>row.sessionId===sessionId).unread);
    await click(page.getByRole('main').getByRole('button',{name:`更多操作 ${title}`,exact:true}));await click(button('标记为已读'));await until(async()=>!(await api('/sessions')).body.sessions.find(row=>row.sessionId===sessionId).unread);
    await click(page.getByRole('main').getByRole('button',{name:`更多操作 ${title}`,exact:true}));await click(button('移至分组'));await page.getByRole('dialog',{name:'移至分组',exact:true}).waitFor();await button('合成资料').waitFor();await shots('groups');await click(button('取消'));
    await click(page.getByRole('main').getByRole('button',{name:`更多操作 ${title}`,exact:true}));await click(button('归档'));
    await until(async()=>(await api('/sessions?archived=all')).body.sessions.find(row=>row.sessionId===sessionId).archived);
    await click(button('设置与账户'));await click(button(/^已归档/));await page.getByRole('searchbox',{name:'搜索已归档对话',exact:true}).fill('合成');await button('恢复').waitFor();await shots('archived');await click(button('恢复'));
    await until(async()=>!(await api('/sessions?archived=all')).body.sessions.find(row=>row.sessionId===sessionId).archived);
    assert.deepEqual(errors,[]);writeFileSync(join(evidence,`${surface}-verification.json`),JSON.stringify({surface,realHost:true,realNativeBridge:mumu,longPress:true,sameMenu:true,unread:true,groups:true,archiveRestore:true,errors},null,2));
  }catch(error){if(page)console.error('Mobile state:',await page.evaluate(()=>({page:state.page,loggedIn:state.loggedIn,cloud:WeftMobileCloud.core?.state.cloudAuth.mode,body:document.body.innerText.slice(0,1200),width:innerWidth,height:innerHeight})).catch(()=>({})));if(page)await page.screenshot({path:join(evidence,`${surface}-failure.png`)}).catch(()=>{});throw error}
  finally{
    if(mumu&&installed){try{adbRun('shell','run-as',packageId,'touch','files/ui5-probe.done');await sleep(600)}catch{}await browser?.close().catch(()=>{});instrumentation?.kill();try{adbRun('uninstall',packageId+'.test');adbRun('uninstall',packageId);if(forwardPort)adbRun('forward','--remove',`tcp:${forwardPort}`);const port=new URL(origin).port;adbRun('reverse','--remove',`tcp:${port}`);}catch{}}
    else await browser?.close().catch(()=>{});
    await new Promise(done=>server?server.close(done):done());
  }
}
