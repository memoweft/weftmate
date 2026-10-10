// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
/** Independent final bad-version trial; no manual recovery or callback substitution. */
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, cp, readFile, writeFile, rm, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import asar from '@electron/asar';
import { saveDesktopConfig } from '../../src/desktop-config.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
const run=promisify(execFile), repository=resolve(import.meta.dirname,'../..');
const root=await mkdtemp(join(tmpdir(),'weftmate-r01-rollback-')), program=join(root,'Programs/WeftMate'), executable=join(program,'WeftMate.exe');
const control=join(process.env.APPDATA,'WeftMate r01qa'), recovery=join(control,'WeftMate/app-recovery'), profile=join(root,'profile');
const base=resolve(process.argv[2]), bad=resolve(process.argv[3]), v2='0.1.1-preview.2', v3='0.1.1-preview.3';
const feedDir=join(root,'feed'), evidence=join(repository,'tests/evidence/r0-1');
await mkdir(profile); await mkdir(feedDir); await mkdir(evidence,{recursive:true});
await writeFile(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const env={...process.env,LOCALAPPDATA:join(root,'Local')}; await mkdir(env.LOCALAPPDATA);
for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_|ELECTRON_RUN_AS_NODE|MIMO_API_KEY|MODEL_SWITCH_UNIFIED_KEY)/.test(key))delete env[key];
env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
let application, page, log='';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,timeout=720000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const value=await check();if(value)return value;await pause(300);}throw new Error('Rollback trial timed out');}
const feed=createServer(async(req,res)=>{const path=new URL(req.url,'http://127.0.0.1').pathname.split('/').filter(Boolean).slice(1).join('/');
  if(path.includes('..'))return res.writeHead(404).end();try{const bytes=await readFile(join(feedDir,path)),range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');
    if(range){const start=Number(range[1]),end=range[2]?Number(range[2]):bytes.length-1;res.writeHead(206,{'content-range':`bytes ${start}-${end}/${bytes.length}`,'content-length':end-start+1,'accept-ranges':'bytes'});res.end(bytes.subarray(start,end+1));}
    else{res.writeHead(200,{'content-length':bytes.length,'accept-ranges':'bytes'});res.end(bytes);}}catch{res.writeHead(404).end();}});
await new Promise(done=>feed.listen(0,'127.0.0.1',done));
const configFile=join(control,'WeftMate/desktop-config.json');
async function start(){application=await _electron.launch({executablePath:executable,args:[],cwd:root,env,timeout:90000});
  application.process().stdout?.on('data',data=>log+=String(data));application.process().stderr?.on('data',data=>log+=String(data));
  page=await application.firstWindow({timeout:90000});await page.waitForURL('**/personal/v1/ui*');await page.waitForFunction(()=>globalThis.__WeftUiStarted===true);}
async function stopOwned(){const result=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',
  '$target=$env:WEFTMATE_QA_EXE; Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $target } | Select-Object -ExpandProperty ProcessId'],
  {windowsHide:true,env:{...env,WEFTMATE_QA_EXE:executable,PSModulePath:join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/Modules')}});
  for(const pid of result.stdout.trim().split(/\s+/))if(/^\d+$/.test(pid))await run('taskkill.exe',['/pid',pid,'/T','/F'],{windowsHide:true}).catch(()=>{});}
try{
  saveDesktopConfig(configFile,{schemaVersion:1,dataDirectory:profile,accessPort:0,production:{cloudIssuer:'',relayEnabled:false,acmeEnabled:false},updates:{channel:'preview',baseUrl:`http://127.0.0.1:${feed.address().port}/`}});
  await cp(join(base,'upload/updates/windows/x64/preview'),feedDir,{recursive:true});
  await run(join(base,'build',`WeftMate-Setup-${v2}.exe`),['/S','/currentuser',`/D=${program}`],{env,windowsHide:true,timeout:600000});
  await mkdir(join(env.LOCALAPPDATA,'weftmate-r01qa-updater'),{recursive:true});await copyFile(join(base,'build',`WeftMate-Setup-${v2}.exe`),join(env.LOCALAPPDATA,'weftmate-r01qa-updater/installer.exe'));
  await start();await cp(join(bad,'upload/updates/windows/x64/preview'),feedDir,{recursive:true});
  await page.evaluate(()=>weftmateDesktop.checkUpdates());await until(async()=>(await page.evaluate(()=>weftmateDesktop.updateState())).canRestart);
  assert.equal((await page.evaluate(()=>weftmateDesktop.restartForUpdate())).restarted,true);application=null;
  const result=await until(async()=>{const value=await readFile(join(recovery,'last-result.json'),'utf8').then(JSON.parse).catch(()=>null);if(value?.phase==='recovery-failed')throw new Error(JSON.stringify(value));return value?.phase==='rolled-back'&&value;});
  assert.equal(result.version,v2);assert.equal(result.rejectedVersion,v3);
  await stopOwned();await pause(500);await start();assert.equal(JSON.parse(asar.extractFile(join(program,'resources/app.asar'),'package.json')).version,v2);
  const bytes=await application.evaluate(async({BrowserWindow,desktopCapturer})=>{const win=BrowserWindow.getAllWindows().find(row=>row.getTitle()==='WeftMate');win.show();const h=win.getNativeWindowHandle(),id=h.length===8?h.readBigUInt64LE().toString():h.readUInt32LE().toString();const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:1600,height:1200}});return sources.find(row=>row.id.split(':')[1]===id).thumbnail.toPNG().toString('base64');});
  await writeFile(join(evidence,'07-automatic-app-rollback.png'),Buffer.from(bytes,'base64'));
  await page.evaluate(()=>weftmateDesktop.checkUpdates());assert.equal((await page.evaluate(()=>weftmateDesktop.updateState())).layers[1].status,'error');
  await application.close(); application=null;
  await writeFile(join(profile,'uninstall-retain.txt'),'R0-1 retain data');
  await run(join(program,'Uninstall WeftMate.exe'),['/S'],{env,windowsHide:true,timeout:600000});
  assert.equal(await readFile(join(profile,'uninstall-retain.txt'),'utf8'),'R0-1 retain data');
  await writeFile(join(evidence,'rollback-report.json'),JSON.stringify({passed:true,automatic:true,manualRecovery:false,realNsis:true,realElectron:true,realDsh:true,...result,badVersionRejected:true,uninstallRetainsData:true},null,2));
  console.log('Independent automatic rollback passed');
}finally{
  await application?.close().catch(()=>{});await stopOwned().catch(()=>{});
  await run(join(program,'Uninstall WeftMate.exe'),['/S'],{env,windowsHide:true,timeout:600000}).catch(()=>{});
  await new Promise(done=>feed.close(done));await writeFile(join(evidence,'rollback.log'),log.replaceAll(root,'<isolated>'));
  await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:300});await rm(control,{recursive:true,force:true,maxRetries:5,retryDelay:300});
  await rm(join(process.env.LOCALAPPDATA,'weftmate-r01qa-updater'),{recursive:true,force:true});
}
