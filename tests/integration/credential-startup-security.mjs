/** Review reproduction: real runtime HTTP and real device persistence, no daily data. */
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { mkdirSync, writeFileSync, readFileSync, existsSync, openSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
import { managedMkdtempSync, managedTempRoot, disposeManagedTemp } from '../helpers/managed-temp.mjs';
import { cleanupOwnedProcesses } from '../helpers/process-evidence.mjs';
import { protectProcessOutput } from '../../src/process-output.mjs';
protectProcessOutput();
const root=resolve('.'),profile=managedMkdtempSync(join(managedTempRoot(),'credential-startup-security-'));
writeFileSync(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const allocation=createServer();await new Promise(resolve=>allocation.listen(0,'127.0.0.1',resolve));
const port=allocation.address().port;await new Promise(resolve=>allocation.close(resolve));
const origin=`http://127.0.0.1:${port}`,executable=createRequire(import.meta.url)('electron'),startedAt=Date.now();
const out=resolve('.local/evidence/credential-startup-security');mkdirSync(out,{recursive:true});
const fd=openSync(join(out,'process.log'),'a');
const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_|MIMO_API_KEY|MODEL_SWITCH_UNIFIED_KEY|ELECTRON_RUN_AS_NODE)/.test(key))delete env[key];
Object.assign(env,{WEFTMATE_MEMOWEFT_ENABLED:'0',WEFTMATE_TEST_HOST_NAME:'synthetic-host',WEFTMATE_CREDENTIAL_STARTUP_TEST_PORT:String(port)});
let app,child,report;
const cleanup=()=>cleanupOwnedProcesses({startedAt,executables:[executable,process.execPath],commandRoots:[profile,root]});
const kill=()=>{if(child?.pid&&child.exitCode===null)try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:10000});}catch{}};
const watchdog=setTimeout(()=>{kill();cleanup();},60000);
const request=async(path,body)=>{
  try{const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{origin,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(2000)});return {status:response.status,body:await response.json()};}
  catch(error){return {reason:error.cause?.code??error.code};}
};
const deviceFile=join(profile,'dsh-home','weftmate-device-state.json');
const devices=()=>{try{return JSON.parse(readFileSync(deviceFile,'utf8')).devices??[];}catch{return [];}};
try{
  app=await _electron.launch({executablePath:executable,args:[resolve('tests/helpers/credential-startup-electron.cjs'),`--user-data-dir=${profile}`,'--personal-host','--access-port=0','--start-in-tray','--noerrdialogs'],cwd:root,env,timeout:30000});
  child=app.process();for(const stream of [child.stdout,child.stderr])stream?.on('data',b=>{try{writeFileSync(fd,b);}catch{}});
  const page=await app.firstWindow();await page.getByRole('status').filter({hasText:'准备中'}).waitFor();
  await app.evaluate(async({app})=>{if(!app.credentialStartupGate.earlySettled)await new Promise(resolve=>app.once('credential-startup-settled',resolve));});
  const listeners=await app.evaluate(({app})=>app.credentialStartupGate.listeners);
  const state=await request('/weftmate/device/state.json');
  const pair=await request('/weftmate/device/v1/pair',{token:state.body?.pairing?.token??'synthetic-unavailable-token',deviceName:'synthetic-before-ready'});
  if(pair.status===200){const end=Date.now()+3000;while(!devices().length&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,50));}
  const paths=['/weftmate/status.json','/weftmate/perception.json','/weftmate/update','/weftmate/perception','/weftmate/pet','/weftmate/device/v1/observation','/weftmate/api/v1/sessions','/weftmate/schedules/synthetic','/weftmate/goals/synthetic','/weftmate/mods/request','/weftmate/weftmod','/personal/v1/auth/setup','/rpc'];
  const routes=[];for(const path of paths){const result=await request(path,path.endsWith('.json')||path.endsWith('/sessions')?undefined:{action:'synthetic'});routes.push(result.reason??result.status);}
  const bridge=await page.evaluate(async()=>{try{await weftmateDesktop.createFolderProject({name:'synthetic',path:'synthetic'});return 'allowed';}catch(error){return error.message.includes('No handler registered')?'NO_HANDLER':'other-error';}});
  report={listeners,bridge,routes, state:state.reason??state.status,pair:pair.reason??pair.status,beforeFailureRecords:devices().length};
  await app.evaluate(({app})=>{app.credentialStartupGate.fail=true;app.credentialStartupGate.released=true;});
  await page.getByRole('alert').filter({hasText:'本机密钥未能安全读取'}).waitFor();
  let timer;try{await Promise.race([app.close(),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('close timeout')),10000))]);}finally{clearTimeout(timer);}
  report.deviceStateWritten=existsSync(deviceFile);
  report.requestWritten=existsSync(join(profile,'dsh-home','weftmate-device-request.json'));
  report.observationsWritten=existsSync(join(profile,'dsh-home','weftmate-device-observations.json'));
  report.perceptionWritten=existsSync(join(profile,'dsh-home','weftmate-perception-main.json'));
  report.afterFailureRecords=devices().length;report.credentialWritten=existsSync(join(profile,'weftmate-model.enc'));
  writeFileSync(join(out,'summary.json'),JSON.stringify(report,null,2));
  assert.deepEqual(report,{listeners:0,bridge:'NO_HANDLER',routes:paths.map(()=> 'ECONNREFUSED'),state:'ECONNREFUSED',pair:'ECONNREFUSED',beforeFailureRecords:0,deviceStateWritten:false,requestWritten:false,observationsWritten:false,perceptionWritten:false,afterFailureRecords:0,credentialWritten:false});
  console.log('credential startup security passed: interfaces unmounted; ECONNREFUSED; pairing records=0');
}finally{clearTimeout(watchdog);kill();const result=cleanup();closeSync(fd);assert.equal(result.available,true);assert.equal(result.failed,0);disposeManagedTemp(profile,{log:()=>{}});}
