/** Real installer, synthetic profile; never reads a personal backup or task. */
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../../../src/host-mode.mjs';
const run=promisify(execFile), repository=resolve('.'), root=await mkdtemp(join(tmpdir(),'weftmate-fx14-migration-'));
const configFile=join(root,'config.json'), migrationDirectory=join(root,'migration'), installation=join(root,'Programs/WeftMate');
const executable=join(installation,'WeftMate r01qa.exe'), profile=join(root,'profile');
const installer=resolve('.local/r0-1/final-releases/0.1.1-preview.1/build/WeftMate-Setup-0.1.1-preview.1.exe');
const evidence=resolve('tests/evidence/fx-14/migration');await mkdir(evidence,{recursive:true});await mkdir(profile);
await writeFile(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const env={...process.env,APPDATA:join(root,'Roaming'),LOCALAPPDATA:join(root,'Local'),NODE_OPTIONS:'--require='+resolve('tests/integration/r0-1-offline.cjs')};
for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_|MIMO_API_KEY|MODEL_SWITCH_UNIFIED_KEY|ELECTRON_RUN_AS_NODE)/.test(key))delete env[key];
const report={syntheticOnly:true,realInstaller:true,rehearsal:true,taskUntouched:true,publicConfigRemainsProtected:false};let application;
const script=resolve('scripts/migrate-installed-desktop.ps1');
async function migrate(action){return run('powershell.exe',['-NoProfile','-NonInteractive','-File',script,'-Action',action,'-Rehearsal',
  '-SourceTaskScript',resolve('scripts/run-personal-host-task.ps1'),'-DataDirectory',profile,'-ConfigFile',configFile,'-MigrationDirectory',migrationDirectory,'-InstalledExe',executable],{env,windowsHide:true,timeout:30000});}
try{
 await migrate('Prepare');report.prepare=true;
 await run(installer,['/S','/currentuser',`/D=${installation}`],{env,windowsHide:true,timeout:600000});
 const files=await readdir(installation);const actualExe=join(installation,files.find(name=>name.endsWith('.exe')&&!/Uninstall|Recovery/.test(name)));
 application=await _electron.launch({executablePath:actualExe,args:['--desktop-config='+configFile],cwd:root,env,timeout:90000});
 const page=await application.firstWindow();await page.waitForURL('**/personal/v1/ui*');await page.waitForFunction(()=>globalThis.__WeftUiStarted===true);
 const origin=new URL(page.url()).origin, port=Number(new URL(origin).port);assert.ok(![8081,18186].includes(port));
 const config=JSON.parse(await readFile(configFile,'utf8'));config.accessPort=port;await writeFile(configFile,JSON.stringify(config));
 assert.equal((await fetch(origin+'/personal/v1/config')).status,401);report.publicConfigRemainsProtected=true;
 const verify=await migrate('Verify');assert.match(verify.stdout,/公开登录状态可访问/);report.verify=true;
 const health=await(await fetch(origin+'/personal/v1/auth/state')).json();assert.equal(typeof health.configured,'boolean');report.health=health;
 await page.screenshot({path:join(evidence,'installed-rehearsal.png')});report.passed=true;
}catch(error){report.passed=false;report.error=error.message;throw error;}
finally{
 await application?.close().catch(()=>{});
 const files=await readdir(installation).catch(()=>[]),uninstaller=files.find(name=>/^Uninstall.*\.exe$/i.test(name));
 if(uninstaller)await run(join(installation,uninstaller),['/S'],{env,windowsHide:true,timeout:60000});
 await writeFile(join(evidence,'verification.json'),JSON.stringify(report,null,2));
 await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:500});report.temporaryDirectoryRemoved=true;
 await writeFile(join(evidence,'verification.json'),JSON.stringify(report,null,2));
}
