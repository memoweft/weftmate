import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startTimelineCandidate } from './integration/bl29-rework/fixture.mjs';
import { getEventListeners } from 'node:events';

function probe(name: string) {
  const root=mkdtempSync(join(tmpdir(),'weftmate-bl29-account-'));
  try {
    const run=spawnSync(process.execPath,[`tests/integration/bl29-rework/${name}.mjs`],{
      env:{...process.env,BL29_EVIDENCE_DIR:root,WEFTMATE_TEST_HOST_NAME:'synthetic-host'},
      encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:4*1024*1024,
    });
    assert.equal(run.status,0,run.stderr||run.error?.message||run.stdout);
    return JSON.parse(readFileSync(join(root,`${name}.json`),'utf8'));
  } finally {rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
}

test('BL-29c N1/N4 public model projection is scoped, domain keyed and covers account display name/revision',()=>{
  const r=probe('model-scope');
  assert.equal(r.scope.hiddenVisible,false);assert.equal(r.scope.visibleUnchanged,true);
  assert.equal(r.scope.sameDigestAcrossAccounts,false);assert.equal(r.scope.ownDigestChangedOnOtherModel,false);
  assert.equal(r.scope.ownRevisionBefore,r.scope.ownRevisionAfter);
  assert.equal(r.rename.oldName,'Visible old name');assert.equal(r.rename.newName,'Visible new name');
  assert.deepEqual(r.rename.changedHashes,['models']);
});

test('BL-29c N1 an unrelated account commit cannot wake this account subscriber',async()=>{
  const f=await startTimelineCandidate({daily:true,inlineProgress:true,historyCount:0});
  const c=f.debug.service.__reviewContext,owner=f.debug.auth.account.ownerId,controller=new AbortController();
  try {
    const other=await c.registerAccount({username:'other-synthetic',password:'Synthetic-password-234567',deviceName:'synthetic-host'});
    const before=await c.accountChanges(owner);let woke=false;
    const pending=c.waitAccountChange(before.revision,controller.signal,owner).then(()=>{woke=true;});
    await c.serial(()=>c.mutate(other.account.ownerId,next=>{next.account.displayName='Changed other account';next.account.profileRevision++;}));
    await new Promise(resolve=>setTimeout(resolve,30));assert.equal(woke,false);
    assert.equal((await c.accountChanges(owner)).revision,before.revision);
    await f.request('/settings/personalization',{nextSuggestionsEnabled:false},'PATCH');
    await pending;assert.equal(woke,true);assert.equal(f.debug.service.__reviewCounts().accountWaiters,0);
  } finally {controller.abort();await f.close();rmSync(f.root,{recursive:true,force:true});}
});

test('BL-29c N2 final catalog gap cannot return a retired body generation',()=>{
  const r=probe('catalog-generation');
  assert.ok(r.status===409||r.status===200&&r.returnedRevision===r.currentRevision,JSON.stringify(r));
  assert.equal(r.returnedSyntheticBody,false);
});

test('BL-29c N3 catalog close during snapshot and after a real commit wake drains 503, logout reauth remains',()=>{
  const rows=probe('catalog-close');assert.equal(rows.length,3);
  for (const row of rows.filter(row=>row.kind.startsWith('close'))) {
    assert.ok(row.ms<500,JSON.stringify(row));assert.equal(row.result.status,503);
    assert.equal(row.result.body.error.code,'SERVICE_CLOSING');assert.equal(row.result.error,undefined);
  }
  assert.equal(rows.find(row=>row.kind==='logout').result.status,401);
});

test('BL-29c N3 cancellation during shared catalog read removes each HTTP request listener',async()=>{
  const f=await startTimelineCandidate({daily:true,inlineProgress:true,historyCount:0});
  let release;
  try {
    const c=f.debug.service.__reviewContext,chat=(await f.request('/chats/main')).chat;
    let entered=false;const gate=new Promise(resolve=>{release=resolve;});
    const original=f.debug.backend.listModels;
    f.debug.backend.listModels=async args=>{entered=true;await gate;return original(args);};
    const controllers=Array.from({length:20},()=>new AbortController());
    const pending=controllers.map(controller=>fetch(`${f.origin}/personal/v1/chats/${chat.chatId}/events`,{
      headers:{cookie:f.debug.cookie},signal:controller.signal,
    }).catch(()=>null));
    while(!entered)await new Promise(resolve=>setTimeout(resolve,1));
    await new Promise(resolve=>setTimeout(resolve,30));controllers.forEach(controller=>controller.abort());
    await Promise.all(pending);await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(getEventListeners(c.closingSignal,'abort').length,1,'only the independent shared catalog owns a close listener');
    release();await c.accountChanges(f.debug.auth.account.ownerId);
    assert.equal(getEventListeners(c.closingSignal,'abort').length,0);
  } finally {release?.();await f.close();rmSync(f.root,{recursive:true,force:true});}
});

test('BL-29c N3/mixed revision catalog failure preserves body and catalog snapshot keeps its starting revision',()=>{
  const r=probe('account-probe');assert.equal(r.catalogFailure.status,200);
  assert.equal(r.guess.matches,false);assert.equal(r.guess.modelSettingsMatches,false);
  assert.equal(r.mixedRevision.staleRevision,r.mixedRevision.oldRevision);
  assert.ok(r.mixedRevision.currentRevision>r.mixedRevision.staleRevision);
  assert.notEqual(r.mixedRevision.currentModels,r.mixedRevision.staleModels);
});

test('BL-29c S4 warm snapshots hash once per account revision, including a fresh wrapper on every read',async()=>{
  const f=await startTimelineCandidate({daily:true,inlineProgress:true,historyCount:0});
  try {
    const c=f.debug.service.__reviewContext,owner=f.debug.auth.account.ownerId;
    await c.accountChanges(owner);
    const count=()=>f.debug.service.__reviewDigests().filter(field=>field==='sessions').length;
    const before=count();for(let i=0;i<250;i++)await c.accountChanges(owner);assert.equal(count(),before);
    await f.request('/settings/personalization',{nextSuggestionsEnabled:false},'PATCH');
    await c.accountChanges(owner);assert.equal(count(),before+1);
    for(let i=0;i<250;i++)await c.accountChanges(owner);assert.equal(count(),before+1);
  } finally {await f.close();rmSync(f.root,{recursive:true,force:true});}
});

test('BL-29c S4 deep frozen committed fingerprint fields remain immutable across real read/write/close paths',()=>{
  const rows=probe('frozen-state');assert.equal(rows.length,7);
  assert.equal(rows[0].before,rows[0].after);assert.equal(rows[0].rootReplaced,false);
  for (const row of rows.slice(1,6)) {assert.ok(row.after>row.before,JSON.stringify(row));assert.equal(row.rootReplaced,true);}
  assert.ok(rows[6].after>=rows[6].before);
});

test('BL-29c S5 first retry jitters directly above the old request floor without extending the recovery cap',()=>{
  const r=probe('policy-probe');assert.equal(new Set(r.firstRetry.map(row=>row.ms)).size,7);
  for (const row of [...r.firstRetry,...r.secondRetry])assert.ok(row.ms>=1500&&row.ms<=1750,JSON.stringify(row));
  assert.equal(r.fullHostRecovery.delay,29999,'existing full-host probe ceiling remains explicit');
});
