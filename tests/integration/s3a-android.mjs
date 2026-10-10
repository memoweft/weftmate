import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
export const adb='D:/Software/MuMuPlayer/nx_main/adb.exe',serial='127.0.0.1:7555',pkg='com.memoweft.weftmate.mobile.s3aqa';
export const shell=(...args)=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',windowsHide:true,maxBuffer:12*1024*1024});
export const pause=ms=>new Promise(r=>setTimeout(r,ms));
export async function wait(check,label,timeout=60000){const end=Date.now()+timeout;while(Date.now()<end){const result=await check();if(result)return result;await pause(300);}throw Error('S3a timeout: '+label);}
export function shot(name){const out=resolve('tests/evidence/s3a');mkdirSync(out,{recursive:true});writeFileSync(join(out,name+'.png'),execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{windowsHide:true,maxBuffer:12*1024*1024}));}
export function notifications(){try{return JSON.parse(shell('shell','run-as',pkg,'cat','files/s3a-notifications.json'));}catch{return [];}}
export async function phone(origin,credentials){
  const port=new URL(origin).port;shell('reverse',`tcp:${port}`,`tcp:${port}`);
  const args=['-s',serial,'shell','am','instrument','-w','-e','class','com.memoweft.weftmate.mobile.S3aNotificationProbeTest','-e','s3aProbe','1',
    '-e','host',origin,'-e','username',credentials.username,'-e','password',credentials.password,`${pkg}.test/androidx.test.runner.AndroidJUnitRunner`];
  const instrument=spawn(adb,args,{windowsHide:true});let log='';instrument.stdout.on('data',p=>{log+=p;});instrument.stderr.on('data',p=>{log+=p;});
  let browser,forward;
  try {
    const pid=await wait(()=>{try{return shell('shell','pidof',pkg).trim();}catch{return false;}},'Android process');
    forward=shell('forward','tcp:0',`localabstract:webview_devtools_remote_${pid}`).trim();
    await wait(async()=>{try{return (await(await fetch(`http://127.0.0.1:${forward}/json`)).json()).some(p=>p.url.includes('appassets'));}catch{return false;}},'real WebView');
    browser=await chromium.connectOverCDP(`http://127.0.0.1:${forward}`,{noDefaults:true});
    const page=browser.contexts()[0].pages().find(p=>p.url().includes('appassets'));
    page.setDefaultTimeout(20000);await page.waitForFunction(()=>typeof state!=='undefined'&&state.booted);
    // Isolated local-account acceptance does not test the cloud login page. Keep its
    // composition dormant; all native login, auth, business routes and OS APIs stay real.
    await page.addInitScript(()=>Object.defineProperty(globalThis,'WeftMobileCloud',{configurable:true,set(value){value.init=async()=>{};Object.defineProperty(globalThis,'WeftMobileCloud',{value,writable:true,configurable:true});}}));
    await page.evaluate(async({origin,credentials})=>await call('auth.login',{origin,...credentials,deviceName:'S3a synthetic Android'}),{origin,credentials});
    await page.reload();await page.waitForFunction(()=>state.booted&&state.loggedIn);
    await page.evaluate(async()=>{uiCore.syncMobileIdentity();await listConversations();await listSharedSessions();if(state.logicalChats)await uiCore.selectMainChat();else page('home');await call('app.ready',{owner:state.owner,hasDraft:hasAnyDraft()});});
    return {page,call:(method,params={})=>page.evaluate(async({method,params})=>call(method,params),{method,params}),
      async close(keepReverse=false){try{shell('shell','run-as',pkg,'touch','files/s3a-probe.done');await pause(1200);}finally{await browser?.close();if(forward)shell('forward','--remove',`tcp:${forward}`);if(!keepReverse)shell('reverse','--remove',`tcp:${port}`);if(instrument.exitCode===null)instrument.kill();}assert.ok(!log.includes('FAILURES'),log);},get log(){return log;}};
  }catch(error){instrument.kill();await browser?.close();if(forward)shell('forward','--remove',`tcp:${forward}`);throw Error(error.message+' '+log);}
}
