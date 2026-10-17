import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startTimelineCandidate, observeTimelineHttp } from './integration/bl29-rework/fixture.mjs';
import { EventEmitter, getEventListeners } from 'node:events';

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
  const c=f.debug.service.__reviewContext,activeOwner=f.debug.auth.account.ownerId,controller=new AbortController();
  try {
    // Periodic activity boot observations are legitimate own-account commits.
    // Drain them so this isolation test controls every observed commit.
    await c.activity.close();
    // The timeline fixture owns a running command. Subscribe the new quiet
    // account so its legitimate task bookkeeping cannot masquerade as a
    // foreign-account wake while the machine is busy.
    const subscriber=await c.registerAccount({username:'quiet-subscriber',password:'Synthetic-password-234567',deviceName:'synthetic-host'});
    const owner=subscriber.account.ownerId;
    // Finish this account's own startup observation before testing foreign-account isolation.
    await c.activity.refresh(owner);
    const before=await c.accountChanges(owner);let woke=false;
    const pending=c.waitAccountChange(before.revision,controller.signal,owner).then(()=>{woke=true;});
    await c.serial(()=>c.mutate(activeOwner,next=>{next.account.displayName='Changed other account';next.account.profileRevision++;}));
    await new Promise(resolve=>setTimeout(resolve,30));assert.equal(woke,false);
    assert.equal((await c.accountChanges(owner)).revision,before.revision);
    await c.serial(()=>c.mutate(owner,next=>{next.account.displayName='Changed subscriber';next.account.profileRevision++;}));
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

function completionGate() {
  let release=()=>{};const promise=new Promise<void>(resolve=>{release=resolve;});
  return {promise,release};
}

function observeCatalogReaders(c,owner,count) {
  const ready=completionGate(),revisions=[],original=c.accountChanges;
  c.accountChanges=function(...args){
    const work=Reflect.apply(original,this,args);
    if(args[0]===owner&&args[1]){
      revisions.push(c.accountRevisionFor(owner));
      if(revisions.length===count)ready.release();
    }
    return work;
  };
  return {ready:ready.promise,revisions};
}

async function catalogCancellationFixture() {
  const f=await startTimelineCandidate({daily:true,inlineProgress:true,historyCount:0,quietCatalog:true});
  const c=f.debug.service.__reviewContext,owner=f.debug.auth.account.ownerId;
  const chat=(await f.request('/chats/main')).chat,path=`/personal/v1/chats/${chat.chatId}/events`;
  const http=observeTimelineHttp(f,path),controllers=Array.from({length:20},()=>new AbortController());
  let pending=[];
  return {f,c,owner,http,controllers,
    start(){pending=controllers.map(controller=>fetch(f.origin+path,{
      headers:{cookie:f.debug.cookie},signal:controller.signal,
    }).catch(()=>null));return pending;},
    async close(){controllers.forEach(controller=>controller.abort());await Promise.all(pending);await f.close();rmSync(f.root,{recursive:true,force:true});},
  };
}

test('BL-29c N3 cancellation during shared catalog read removes each HTTP request listener',async()=>{
  const fixture=await catalogCancellationFixture(),{f,c,owner,http,controllers}=fixture;
  const catalog=completionGate(),entered=completionGate(),readers=observeCatalogReaders(c,owner,20);
  const revision=c.accountRevisionFor(owner),original=f.debug.backend.listModels;let calls=0;
  f.debug.backend.listModels=async args=>{calls++;entered.release();await catalog.promise;return original(args);};
  try {
    const pending=fixture.start();await entered.promise;await readers.ready;
    assert.equal(http.started,20);assert.equal(calls,1);
    assert.deepEqual(readers.revisions,Array(20).fill(revision));
    controllers.forEach(controller=>controller.abort());await Promise.all(pending);
    await http.waitForCompleted(20);
    assert.equal(getEventListeners(c.closingSignal,'abort').length,1,'only the independent shared catalog owns a close listener');
    catalog.release();await c.accountChanges(owner);
    assert.equal(getEventListeners(c.closingSignal,'abort').length,0);
  } finally {catalog.release();await fixture.close();}
});

test('BL-29c N3 query cancellation waits for the real handler finally before checking cleanup',async()=>{
  const fixture=await catalogCancellationFixture(),{f,c,owner,http,controllers}=fixture;
  const query=completionGate(),queryEntered=completionGate(),catalog=completionGate(),readers=observeCatalogReaders(c,owner,19);
  const originalQuery=c.chatTimeline.query,originalModels=f.debug.backend.listModels;let queries=0;
  c.chatTimeline.query=async function(...args){
    if(++queries===2){queryEntered.release();await query.promise;}
    return Reflect.apply(originalQuery,this,args);
  };
  f.debug.backend.listModels=async args=>{await catalog.promise;return originalModels(args);};
  try {
    const pending=fixture.start();await queryEntered.promise;await readers.ready;
    assert.equal(http.started,20);
    controllers.forEach(controller=>controller.abort());await Promise.all(pending);
    await http.closed();await http.waitForCompleted(19);
    assert.equal(http.completed,19,'response.close does not complete the gated query handler');
    query.release();await http.waitForCompleted(20);
    assert.equal(getEventListeners(c.closingSignal,'abort').length,1);
    catalog.release();await c.accountChanges(owner);
    assert.equal(getEventListeners(c.closingSignal,'abort').length,0);
  } finally {query.release();catalog.release();await fixture.close();}
});

test('BL-29c N3 each revision owns its catalog until completion despite HTTP reader cancellation',async()=>{
  const fixture=await catalogCancellationFixture(),{f,c,owner,http,controllers}=fixture;
  const queries=completionGate(),firstEntered=completionGate(),secondEntered=completionGate();
  const firstCatalog=completionGate(),secondCatalog=completionGate(),readers=observeCatalogReaders(c,owner,20);
  const originalQuery=c.chatTimeline.query,originalModels=f.debug.backend.listModels;let queryCount=0,calls=0;
  c.chatTimeline.query=async function(...args){if(++queryCount>1)await queries.promise;return Reflect.apply(originalQuery,this,args);};
  f.debug.backend.listModels=async args=>{
    const call=++calls;assert.ok(call<=2);
    (call===1?firstEntered:secondEntered).release();
    await (call===1?firstCatalog:secondCatalog).promise;return originalModels(args);
  };
  try {
    const before=c.accountRevisionFor(owner),pending=fixture.start();await firstEntered.promise;
    const firstReader=c.accountChanges(owner);
    await c.serial(()=>c.mutate(owner,next=>{next.account.displayName='Catalog next revision';next.account.profileRevision++;}));
    const after=c.accountRevisionFor(owner);assert.ok(after>before);
    queries.release();await secondEntered.promise;await readers.ready;
    assert.equal(http.started,20);assert.equal(calls,2);
    assert.deepEqual(readers.revisions,[before,...Array(19).fill(after)]);
    const secondReader=c.accountChanges(owner);
    controllers[1].abort();await pending[1];await http.waitForCompleted(1);
    assert.equal(http.completed,1,'one HTTP cancellation must not complete the other shared readers');
    controllers.forEach(controller=>controller.abort());await Promise.all(pending);await http.waitForCompleted(20);
    assert.equal(getEventListeners(c.closingSignal,'abort').length,2,'each unfinished revision owns its shared read');
    firstCatalog.release();assert.ok((await firstReader).models);
    assert.equal(getEventListeners(c.closingSignal,'abort').length,1);
    secondCatalog.release();assert.ok((await secondReader).models);
    assert.equal(getEventListeners(c.closingSignal,'abort').length,0);
  } finally {queries.release();firstCatalog.release();secondCatalog.release();await fixture.close();}
});

test('BL-29c N3 handler completion observation rethrows the original rejection including undefined',async()=>{
  for(const error of [undefined,new Error('synthetic handler rejection')]){
    const fixture={debug:{service:{__reviewOnHttp:null}}},http=observeTimelineHttp(fixture,'/synthetic');
    const work=Promise.reject(error);
    fixture.debug.service.__reviewOnHttp({method:'GET',url:'/synthetic'},new EventEmitter(),work);
    await assert.rejects(http.waitForCompleted(1),actual=>actual===error);
    assert.equal(http.completed,1);
  }
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
