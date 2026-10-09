import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { saveDesktopConfig } from '../../src/desktop-config.mjs';
import { PERSONAL_HOST_MARKER,PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
const root=await mkdtemp(join(tmpdir(),'weftmate-r01-login-')),profile=join(root,'profile');
const control=join(process.env.APPDATA,'WeftMate r01qa'),configFile=join(control,'WeftMate/desktop-config.json');
const executable=resolve(process.argv[2]);let application;
await mkdir(profile);await writeFile(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
saveDesktopConfig(configFile,{schemaVersion:1,dataDirectory:profile,accessPort:0,production:{cloudIssuer:'',relayEnabled:false,acmeEnabled:false},updates:{channel:'preview'}});
const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_|ELECTRON_RUN_AS_NODE)/.test(key))delete env[key];
try{
 application=await _electron.launch({executablePath:executable,args:[],cwd:root,env,timeout:90000});
 const page=await application.firstWindow({timeout:90000});await page.waitForURL('**/personal/v1/ui*');await page.waitForFunction(()=>globalThis.__WeftUiStarted===true);
 const on=await page.evaluate(()=>weftmateDesktop.setAutoStart(true));assert.equal(on.autoStart,true);
 const reread=await page.evaluate(()=>weftmateDesktop.settings());assert.equal(reread.autoStart,true);
 const registered=await application.evaluate(({app})=>app.getLoginItemSettings({path:process.execPath}).launchItems.find(row=>row.name==='WeftMate r01qa'));
 assert.equal(registered.enabled,true);assert.equal(registered.scope,'user');
 const command=await application.evaluate(()=>new Promise((resolve,reject)=>process.getBuiltinModule('child_process').execFile('powershell.exe',
  ['-NoProfile','-NonInteractive','-Command',"[Console]::Out.Write((Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name 'WeftMate r01qa').'WeftMate r01qa')"],
  {windowsHide:true,env:{...process.env,PSModulePath:process.env.SystemRoot+'\\System32\\WindowsPowerShell\\v1.0\\Modules'}},(error,out)=>error?reject(error):resolve(out))));
 assert.ok(command.includes('--start-in-tray'),command);assert.ok(command.includes('desktop-config='),command);
 const off=await page.evaluate(()=>weftmateDesktop.setAutoStart(false));assert.equal(off.autoStart,false);
 await writeFile(resolve('tests/evidence/r0-1/login-item-report.json'),JSON.stringify({passed:true,realWindowsRegistry:true,isolatedName:'WeftMate r01qa',enabledReadback:true,disabledReadback:true,startInTray:true,configurationPathContainsSpaces:true},null,2));
 console.log('Real named Windows login-item enable/read/disable passed');
}finally{
 if(application){await application.evaluate(({app})=>app.setLoginItemSettings({openAtLogin:false,name:'WeftMate r01qa',path:process.execPath})).catch(()=>{});await application.close().catch(()=>{});}
 await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:300});await rm(control,{recursive:true,force:true,maxRetries:5,retryDelay:300});
}
