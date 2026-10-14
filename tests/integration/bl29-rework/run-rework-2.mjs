import { evidencePath } from '../../helpers/evidence-path.mjs';
/** Review gates and retained BL-29b proofs, strictly one application at a time. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { scrub } from './exit-supervisor.mjs';
const base=resolve(process.env.BL29_EVIDENCE_DIR || evidencePath('bl-29/rework-2'));
mkdirSync(base,{recursive:true});
const jobs=[
  ...['model-scope','catalog-generation','catalog-close','account-probe','frozen-state','policy-probe','three-readers','cancel-stress',
    'probe-race','probe-http-race','probe-server','probe-gateway','probe-auth','probe-compat','old-host','probe-desktop-errors','ui-extra','probe-latency','send-backoff','host-recovery','zero-browser']
    .map(name=>[name,[`tests/integration/bl29-rework/${name}.mjs`]]),
  ['probe-browser',['tests/integration/bl29-rework/probe-browser.mjs','--budget-only','--empty-main']],
  ['census',['tests/integration/bl-29-requests.mjs','--logical']],
  ['responsiveness',['tests/integration/bl-29-requests.mjs','--logical','--latency']],
];
const selected=process.argv.slice(2),runs=[];
const outputFiles={'probe-race':'race','probe-http-race':'http-race','probe-server':'server','probe-gateway':'gateway',
  'probe-auth':'auth','probe-compat':'compat','probe-desktop-errors':'desktop-errors','probe-latency':'latency','probe-browser':'browser',census:'after-main'};
for(const [name,args] of jobs.filter(([name])=>!selected.length||selected.includes(name))){
  const dir=join(base,name);mkdirSync(dir,{recursive:true});const at=Date.now();let log='';
  console.log('START',name,new Date().toISOString());
  const env={...process.env,BL29_EVIDENCE_DIR:dir,WEFTMATE_BL29_EVIDENCE_DIR:dir,WEFTMATE_TEST_HOST_NAME:'synthetic-host'};
  delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(process.execPath,[...(name==='cancel-stress'?['--expose-gc']:[]),...args],{env,windowsHide:true});
  for(const pipe of [child.stdout,child.stderr])pipe.on('data',chunk=>{log+=chunk;writeFileSync(join(dir,'run.log'),scrub(log));});
  const code=await new Promise(resolve=>child.once('close',resolve));
  const row={name,code,ms:Date.now()-at};runs.push(row);writeFileSync(join(base,'proof-runs.json'),JSON.stringify(runs,null,2));
  assert.equal(code,0,`${name}: ${scrub(log).slice(-3000)}`);
  const r=JSON.parse(readFileSync(join(dir,`${outputFiles[name]||name}.json`),'utf8'));
  assert.equal(r.failure,undefined,JSON.stringify(r));
  if(name==='model-scope'){
    assert.equal(r.scope.hiddenVisible,false);assert.equal(r.scope.visibleUnchanged,true);assert.equal(r.scope.sameDigestAcrossAccounts,false);
    assert.equal(r.scope.ownDigestChangedOnOtherModel,false);assert.equal(r.scope.ownRevisionBefore,r.scope.ownRevisionAfter);assert.deepEqual(r.rename.changedHashes,['models']);
  }
  if(name==='catalog-generation')assert.ok(r.status===409||r.status===200&&r.returnedRevision===r.currentRevision,JSON.stringify(r));
  if(name==='catalog-close')for(const row of r){assert.ok(row.ms<500);assert.equal(row.result.status,row.kind==='logout'?401:503);if(row.kind.startsWith('close'))assert.equal(row.result.body.error.code,'SERVICE_CLOSING');}
  if(name==='account-probe'){assert.equal(r.catalogFailure.status,200);assert.equal(r.guess.matches,false);assert.equal(r.guess.modelSettingsMatches,false);assert.equal(r.mixedRevision.staleRevision,r.mixedRevision.oldRevision);assert.ok(r.mixedRevision.currentRevision>r.mixedRevision.staleRevision);}
  if(name==='frozen-state'){assert.equal(r.length,7);for(const row of r.slice(1,6)){assert.ok(row.after>row.before);assert.equal(row.rootReplaced,true);}}
  if(name==='policy-probe'){assert.equal(new Set(r.firstRetry.map(row=>row.ms)).size,7);for(const row of [...r.firstRetry,...r.secondRetry])assert.ok(row.ms>=1500&&row.ms<=1750);}
  if(name==='three-readers')for(const row of r){assert.ok(row.ms<200);assert.equal(row.counts.accountWaiters,0);assert.equal(row.native,0);}
  if(name==='cancel-stress'){assert.equal(r.samples.length,10);assert.equal(r.final.accountWaiters,0);assert.equal(r.final.nativeWaiters,0);assert.equal(r.final.closingListeners,0);assert.equal(r.final.waitTimers,0);}
  if(name==='probe-race'){assert.ok(r.waitMs<200);assert.ok(r.alreadyAbortedMs<20);}
  if(name==='probe-http-race'){assert.ok(r.aDelayAfterReleaseMs<200);assert.equal(r.abortBeforeWait.accountWaiters,0);assert.equal(r.abortBeforeWait.nativeWaiters,0);}
  if(name==='probe-gateway')for(const row of r){assert.ok(row.closeMs<500);assert.equal(row.response.status,503);assert.equal(row.response.body.error.code,'SERVICE_CLOSING');}
  if(name==='old-host'){assert.equal(r.actualOldHost.replyWait,null);assert.equal(r.actualOldHost.hasAccountChanges,false);assert.equal(r.waitParameters,0);assert.equal(r.accountRevisionParameters,0);}
  if(name==='probe-desktop-errors')for(const row of r){assert.equal(row.failure,undefined);assert.ok(row.count<=3);if(!['NOT_FOUND','UNAUTHORIZED'].includes(row.code))assert.ok(row.recoveredWaitMs!==null&&row.recoveredWaitMs<=2000);}
  if(name==='probe-browser')for(const row of r.cases){assert.ok(row.requests<=2);if(!['NOT_FOUND','UNAUTHORIZED'].includes(row.code))assert.ok(row.recoveredWaitMs!==null&&row.recoveredWaitMs<=2000);}
  if(name==='ui-extra'){
    assert.equal(r.individualChanges.length,5);for(const change of r.individualChanges)for(const row of change.rows){assert.equal(row.error,undefined);assert.ok(row.ms<=7000);}
  }
  if(name==='probe-latency')for(const row of r.rows){assert.equal(row.error,undefined);if(row.kind==='rename'){assert.ok(row.desktop<=6000);assert.ok(row.mobile<=6000);}else assert.ok(row.ms<=1000);}
  if(name==='send-backoff')for(const row of r.sends){assert.equal(row.error,undefined);assert.ok(row.sendBackendMs!==null&&row.sendBackendMs<1000);assert.ok(row.replyVisibleMs<7000);}
  if(name==='host-recovery')for(const row of r.hostRecovery){assert.equal(row.error,undefined);assert.ok(row.ms<35000);}
  if(name==='zero-browser'){assert.equal(r.cases.length,1);assert.ok(r.cases[0].state.zeroDelayTicks>100,'real browser demonstrates the isolated scheduling mutation');assert.ok(r.cases[0].requests<=2);}
  console.log('END',JSON.stringify(row));
}
