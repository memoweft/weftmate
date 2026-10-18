import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
import { managedMkdtempSync, managedTempRoot, disposeManagedTemp } from '../helpers/managed-temp.mjs';
import { cleanupOwnedProcesses } from '../helpers/process-evidence.mjs';
import { protectProcessOutput } from '../../src/process-output.mjs';
protectProcessOutput();
const scenario=process.argv[2]??'ready';
const root=resolve('.'), profile=managedMkdtempSync(join(managedTempRoot(),'weftmate-credential-window-'));
writeFileSync(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const executable=createRequire(import.meta.url)('electron'),startedAt=Date.now();
const output=resolve('.local/evidence/credential-first-window');mkdirSync(output,{recursive:true});
const fd=openSync(join(output,'process.log'),'a');
const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_|MIMO_API_KEY|MODEL_SWITCH_UNIFIED_KEY|ELECTRON_RUN_AS_NODE)/.test(key))delete env[key];
env.WEFTMATE_MEMOWEFT_ENABLED='0';env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
let app,child;
const kill=()=>{if(child?.pid&&child.exitCode===null)try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:10000});}catch{}};
const cleanup=()=>cleanupOwnedProcesses({startedAt,executables:[executable,process.execPath],commandRoots:[profile,root]});
const timer=setTimeout(()=>{kill();cleanup();},60000);
try {
  app=await _electron.launch({executablePath:executable,args:[resolve('tests/helpers/credential-startup-electron.cjs'),`--user-data-dir=${profile}`,'--personal-host','--access-port=0','--start-in-tray','--noerrdialogs'],cwd:root,env,timeout:30000});
  child=app.process();for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>{try{writeFileSync(fd,chunk);}catch{}});
  // Wait for a condition, not for a chosen elapsed time. Readiness cannot
  // complete until this test explicitly releases it after inspecting the UI.
  const windows=await app.evaluate(async ({app,BrowserWindow})=>{
    if(!app.credentialStartupGate.entered)await new Promise(resolve=>app.once('credential-startup-gated',resolve));
    return BrowserWindow.getAllWindows().length;
  });
  assert.equal(windows,1,'the first window must exist while credential readiness is still blocked');
  const page=await app.firstWindow();
  await page.getByRole('status').filter({hasText:'准备中'}).waitFor();
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(win=>win.isVisible())),false);
  const capture=async state=>{
    if(process.env.WEFTMATE_CREDENTIAL_STARTUP_CAPTURE!=='1')return;
    for(const theme of ['light','dark']){
      await app.evaluate(({nativeTheme},theme)=>{nativeTheme.themeSource=theme;},theme);
      await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
      const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'));
      writeFileSync(join(output,`${state}-${theme}.png`),Buffer.from(png,'base64'));
    }
  };
  if(scenario==='ready')await capture('preparing');
  await app.evaluate(async ({app})=>{
    if(!app.credentialStartupGate.runtimeStarted)await new Promise(resolve=>app.once('credential-startup-runtime',resolve));
  });
  const early=await app.evaluate(({app})=>app.credentialStartupGate.check());
  assert.deepEqual(early,{message:'本机没有可用的加密后端，无法安全保存模型凭据。',written:false});
  assert.equal(await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.close();return win.isDestroyed();}),false,'closing during preparation hides rather than destroys the shell');
  await app.evaluate(({app},scenario)=>{app.credentialStartupGate.fail=scenario==='failure';app.credentialStartupGate.released=true;},scenario);
  if(scenario==='failure'){
    await page.getByRole('alert').filter({hasText:'本机密钥未能安全读取'}).waitFor();
    await capture('failed');
    await app.evaluate(({app})=>app.credentialStartupGate.waitRuntimeClosed());
    assert.equal(page.url().startsWith('file:'),true,'failure never enables the business page');
    assert.equal((await app.evaluate(({app})=>app.credentialStartupGate.check())).written,false);
  }else{
  await page.waitForURL('**/personal/v1/ui*',{timeout:30000});
  await page.waitForFunction(()=>globalThis.__WeftUiStarted===true,{},{timeout:30000});
  assert.equal((await app.windows()).length,1,'startup hands off the same native window');
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false,'handoff preserves a user closing the preparation window');
  }
  let closeTimer;try{await Promise.race([app.close(),new Promise((_,reject)=>closeTimer=setTimeout(()=>reject(Error('close timeout')),10000))]);}finally{clearTimeout(closeTimer);}
  console.log(`credential first-window ${scenario} gate passed`);
} finally {clearTimeout(timer);kill();const result=cleanup();closeSync(fd);assert.equal(result.available,true);assert.equal(result.failed,0);disposeManagedTemp(profile,{log:()=>{}});}
