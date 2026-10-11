/** Repeated review probes, one process at a time; no production accounts/models. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
const dir = resolve(process.env.BL29_EVIDENCE_DIR || 'tests/evidence/bl-29/rework/after');
mkdirSync(dir,{recursive:true});
const selected = process.argv.slice(2);
const names = selected.length ? selected : ['probe-race','probe-http-race','probe-server','probe-gateway','probe-browser','probe-desktop-errors','probe-latency','probe-exit','probe-events','probe-auth','probe-compat'];
const scrub=s=>s.replaceAll(process.env.USERPROFILE||'no-profile','C:\\Users\\<user>').replaceAll(process.env.COMPUTERNAME||'no-host','<host>');
const runs=[];
for(const name of names){
  console.log('START',name); const at=Date.now();let log='';
  const env={...process.env,BL29_EVIDENCE_DIR:dir,WEFTMATE_TEST_HOST_NAME:'synthetic-host'};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(process.execPath,[`tests/integration/bl29-rework/${name}.mjs`],{env,windowsHide:true});
  child.stdout.on('data',b=>{log+=b;writeFileSync(join(dir,`${name}.log`),scrub(log));});
  child.stderr.on('data',b=>{log+=b;writeFileSync(join(dir,`${name}.log`),scrub(log));});
  const code=await new Promise(r=>child.on('exit',r));
  assert.equal(code,0,`${name}: ${scrub(log)}`);
  const file=({'probe-http-race':'http-race','probe-desktop-errors':'desktop-errors','probe-latency':'latency','probe-exit':'exit'})[name]||name.slice(6);
  const jsonFile=join(dir,`${file}.json`), r=JSON.parse(readFileSync(jsonFile,'utf8'));
  assert.equal(r.failure,undefined,`${name}: ${r.failure}`);
  if(name==='probe-race'){assert.ok(r.waitMs<200);assert.ok(r.alreadyAbortedMs<20);}
  if(name==='probe-http-race'){assert.ok(r.aDelayAfterReleaseMs<200);assert.equal(r.abortBeforeWait.accountWaiters,0);assert.equal(r.abortBeforeWait.nativeWaiters,0);}
  if(name==='probe-gateway')for(const row of r){assert.equal(row.response.status,503);assert.equal(row.response.body.error.code,'SERVICE_CLOSING');assert.ok(row.closeMs<500);}
  if(name==='probe-browser'){
    for(const row of r.cases.filter(row=>row.client==='new')){
      assert.ok(row.requests<=2,JSON.stringify(row));
      if(!['NOT_FOUND','UNAUTHORIZED'].includes(row.code))assert.ok(row.recoveredWaitMs!==null&&row.recoveredWaitMs<=2000,JSON.stringify(row));
    }
    const head=r.config.find(row=>row.version==='head');assert.ok(head.state.models.includes('added-model'));assert.equal(head.state.suggestions,false);
  }
  if(name==='probe-desktop-errors')for(const row of r){assert.equal(row.failure,undefined);assert.ok(row.count<=3,JSON.stringify(row));if(!['NOT_FOUND','UNAUTHORIZED'].includes(row.code))assert.ok(row.recoveredWaitMs!==null&&row.recoveredWaitMs<=2000,JSON.stringify(row));}
  if(name==='probe-latency'){
    for(const row of r.rows){assert.equal(row.error,undefined);if(row.kind==='rename'){assert.ok(row.desktop<=6000);assert.ok(row.mobile<=6000);}else assert.ok(row.ms<=1000);}
    assert.equal(r.electronConfig.suggestions,false);assert.equal(r.mobileConfig.suggestions,false);
    assert.ok(r.electronConfig.models.includes('added-electron'));assert.ok(r.mobileConfig.models.includes('added-electron'));
  }
  if(name==='probe-exit')for(const row of r.filter(row=>row.version==='head')){assert.equal(row.error,undefined);assert.ok(row.ms<1000);if(row.method.endsWith('first')){assert.ok(row.accessCloseMs<500);assert.ok(row.runtimeCloseMs<1000);assert.equal(row.gatewayWait.status,503);assert.equal(row.gatewayWait.body.error.code,'SERVICE_CLOSING');}}
  writeFileSync(jsonFile,scrub(JSON.stringify(r,null,2))+'\n');
  runs.push({name,code,ms:Date.now()-at});writeFileSync(join(dir,'runs.json'),JSON.stringify(runs,null,2));console.log('END',JSON.stringify(runs.at(-1)));
}
// The source overlay is generated input for a private child, not evidence.
rmSync(join(dir,'baseline.json'),{force:true});
