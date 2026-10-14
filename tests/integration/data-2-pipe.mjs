import { evidencePath } from '../helpers/evidence-path.mjs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {managedMkdtemp as mkdtemp,managedTempRoot as tmpdir} from '../helpers/managed-temp.mjs';
import {PERSONAL_HOST_MARKER,PERSONAL_HOST_MARKER_CONTENT} from '../../src/host-mode.mjs';
import {disposeHealthFixture} from '../helpers/health-5-temp.mjs';
import {cleanupOwnedProcesses,redactEvidenceText} from '../helpers/process-evidence.mjs';
import {createPersonalAccessService} from '../../src/personal-access/index.mjs';
import {computerUsageInterval,mergeComputerBuckets} from '../../src/personal-access/computer-usage.mjs';
const repo=resolve(import.meta.dirname,'../..'),out=evidencePath('data-2'),root=await mkdtemp(join(tmpdir(),'weftmate-data2-pipe-')),profile=join(root,'profile'),directory=join(profile,'pipe-test'),startedAt=Date.now(),electron=createRequire(import.meta.url)('electron');
await mkdir(directory,{recursive:true});await mkdir(out,{recursive:true});await writeFile(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_|DSH_)/.test(key)||/API_KEY|API_TOKEN|MODEL_SWITCH_UNIFIED_KEY/.test(key))delete env[key];env.WEFTMATE_TEST_HOST_NAME='synthetic-host';env.WEFTMATE_BASELINE_TRACE=join(root,'requests.jsonl');
const report={realElectron:true,parentExitedBeforeWarnings:true,warningEvents:[],errorDialogs:null,cleanedProcesses:0};let pid;
async function until(fn){const end=Date.now()+90000;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,250));}throw Error('Pipe test timeout');}
try {
  // Also read the final additive device contract through the running program.
  const preparation=await createPersonalAccessService({root:join(profile,'personal-access'),port:0,backend:Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(name=>[name,async()=>({})]))});let cookie;
  try{const {origin}=await preparation.start(),grant=await preparation.issueSetupGrant(),response=await fetch(origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,username:'data2-pipe-synthetic',password:'synthetic-long-password',deviceName:'Synthetic pipe test'})});assert.equal(response.status,201);const auth=await response.json();cookie=response.headers.get('set-cookie').split(';')[0];const policy=preparation.computerUsagePolicy(auth.account.ownerId),today=new Intl.DateTimeFormat('en-CA',{timeZone:policy.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),day=new Date(Date.parse(today+'T00:00:00Z')-2*86400000).toISOString().slice(0,10);let buckets=[];const from=Date.parse(day+'T08:00:00Z');for(let n=0;n<15;n++)buckets=mergeComputerBuckets(buckets,computerUsageInterval({from:from+n*60000,to:from+(n+1)*60000,idleSeconds:0,timeZone:policy.timeZone}));await preparation.recordComputerUsage(auth.account.ownerId,policy.generation,buckets);}finally{await preparation.close();}
  execFileSync(process.execPath,[join(repo,'tests/integration/data-2-pipe-parent.mjs'),electron,join(repo,'tests/integration/data-2-pipe-bootstrap.mjs'),profile,join(root,'pid')],{env,stdio:'ignore',windowsHide:true,timeout:15000});
  pid=Number(await readFile(join(root,'pid'),'utf8'));await writeFile(join(directory,'request.json'),'{}');
  report.alive=await until(()=>readFile(join(directory,'alive.json'),'utf8').then(JSON.parse).catch(()=>null));
  assert.equal(report.alive.parentExited,true);assert.ok(report.alive.streamErrors.some(row=>['EPIPE','EOF','ERR_STREAM_DESTROYED'].includes(row.code)));
  const host=await until(async()=>{const files=await readdir(join(profile,'logs')).catch(()=>[]);const lines=(await Promise.all(files.filter(n=>n.endsWith('.jsonl')).map(n=>readFile(join(profile,'logs',n),'utf8')))).join('\n');return lines.includes('"event":"host.ready"');});
  report.hostReady=host;assert.doesNotThrow(()=>process.kill(pid,0));
  const snapshot=JSON.parse(await readFile(join(profile,'dsh-home','weftmate-host-state.json'),'utf8')),origin=snapshot.personalAccess.origin;
  const daily=await fetch(origin+'/personal/v1/daily-summaries',{headers:{origin,cookie}}).then(r=>r.json()),device=daily.items.flatMap(day=>day.devices.items).find(row=>row.deviceId==='this-computer');assert.ok(device);assert.equal(device.platform,'windows');assert.equal(device.activeMinutes,15);report.deviceContract={deviceId:device.deviceId,label:device.label,platform:device.platform,activeMinutes:device.activeMinutes};
  report.baseline=JSON.parse(await readFile(join(directory,'baseline.json'),'utf8'));assert.equal(report.baseline.defaultErrorBoxCalls,1);
  report.errorDialogs=Number(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',join(repo,'tests/helpers/error-window-count.ps1'),'-TargetProcessId',String(pid)],{encoding:'utf8',windowsHide:true,timeout:15000}).trim());assert.equal(report.errorDialogs,0);
  const lines=(await Promise.all((await readdir(join(profile,'logs'))).filter(name=>name.endsWith('.jsonl')).map(name=>readFile(join(profile,'logs',name),'utf8')))).join('\n');
  assert.doesNotMatch(lines,/PRIVATE PATH MUST NOT APPEAR/);report.warningEvents=lines.split('\n').filter(Boolean).map(JSON.parse).filter(row=>row.event==='process.warning'&&row.code==='DATA2_PIPE');assert.equal(report.warningEvents.length,1);assert.equal(report.warningEvents[0].name,'Data2Warning');
  report.completed=true;
}catch(error){report.completed=false;report.failure=redactEvidenceText(error.message,[root]);throw error;}
finally{
  await writeFile(join(directory,'stop'),'');if(pid)await until(async()=>{try{process.kill(pid,0);return false;}catch{return true;}}).catch(()=>{});
  const cleanup=cleanupOwnedProcesses({startedAt,executables:[electron,process.execPath],commandRoots:[root]});report.cleanedProcesses=cleanup.cleaned;report.cleanup=cleanup;
  await disposeHealthFixture(root);await writeFile(join(out,'broken-pipe.json'),JSON.stringify(report,null,2)+'\n');
}
