import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startTimelineCandidate } from './integration/bl29-rework/fixture.mjs';
import { observeHostClose } from './integration/bl29-rework/close-observation.mjs';
import { nativeTimelineLog } from '../src/runtime/dsh-adapter/timeline.mjs';
import { getEventListeners } from 'node:events';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { probe } from './helpers/bl-29-probe.mjs';


test('BL-29b account watermark stays scoped to identity when switching to an older host', async () => {
  const ctx:any={WeftUiCore:{factories:{}},URLSearchParams};
  runInNewContext(readFileSync('src/ui-core/client.js','utf8'),ctx);
  const paths:string[]=[];
  const core:any={state:{identityGeneration:1,accountRevisionIdentity:1,accountRevision:7},accessApi:async path=>{paths.push(path);return {};}};
  const client=ctx.WeftUiCore.factories.client(core);
  await client.readChatChanges('synthetic','cursor');
  assert.equal(new URL(paths.at(-1),'http://synthetic.invalid').searchParams.get('accountRevision'),'7');
  core.state.identityGeneration++;
  await client.readChatChanges('synthetic','cursor');
  assert.equal(new URL(paths.at(-1),'http://synthetic.invalid').searchParams.has('accountRevision'),false);
});

test('BL-29b M2 query-bound watermarks wake A when B indexed the native event first', () => {
  const r = probe('probe-race', 'race.json');
  assert.equal(r.clientAEmpty, 0); assert.equal(r.clientBNew, 1); assert.equal(r.clientAAfter, 1);
  assert.ok(r.waitMs < 200, JSON.stringify(r));
  assert.ok(r.alreadyAbortedMs < 20, JSON.stringify(r));
});

test('BL-29b M2/M3 HTTP race and twenty disconnects during first query leave zero waiters', () => {
  const r = probe('probe-http-race', 'http-race.json');
  assert.equal(r.bUpserts, 1); assert.equal(r.aUpserts, 1);
  assert.ok(r.aDelayAfterReleaseMs < 200, JSON.stringify(r));
  assert.equal(r.four.accountWaiters, 4); assert.equal(r.fourAfter.accountWaiters, 0);
  assert.equal(r.after.accountWaiters, 0); assert.equal(r.nativeAfter, 0);
  assert.equal(r.abortBeforeWait.prepared, 20);
  assert.equal(r.abortBeforeWait.accountWaiters, 0); assert.equal(r.abortBeforeWait.nativeWaiters, 0);
  assert.ok(r.switches.every(([, after]: number[]) => after === 0));
});

test('BL-29b M5/S2 gateway shutdown and runtime dispose respond SERVICE_CLOSING promptly', () => {
  for (const row of probe('probe-gateway', 'gateway.json')) {
    assert.equal(row.receivedAfterClose100ms, true);
    assert.equal(row.response.status, 503); assert.equal(row.response.body.error.code, 'SERVICE_CLOSING');
    assert.ok(row.closeMs < 500, JSON.stringify(row));
  }
});

test('BL-29b M5 host close revokes empty account waits before closing sockets', async t => {
  const f = await startTimelineCandidate({interactive:true,daily:true,inlineProgress:true,historyCount:0});
  const observation = observeHostClose(t, f.debug.service);
  try {
    await f.progress.approve('bl29-close-approval','Write-Output synthetic');
    const chat = (await f.request('/chats/main')).chat;
    const page = await f.request(`/chats/${chat.chatId}/events`);
    const url = f.origin+`/personal/v1/chats/${chat.chatId}/changes?cursor=${page.syncCursor}&liveRevision=${page.liveRevision}&waitMs=30000`;
    const pending = fetch(url, {headers:{cookie:f.debug.cookie}});
    for (let i=0;i<100&&f.debug.service.__reviewCounts().accountWaiters===0;i++) await new Promise(r=>setTimeout(r,5));
    assert.equal(f.debug.service.__reviewCounts().accountWaiters, 1);
    const before = f.debug.service.__reviewCounts().accountRevision;
    const at = Date.now(); await f.debug.service.close();
    const closedAt = Date.now(); observation.mark('close.returned');
    const response = await pending;
    assert.equal(response.status, 503); assert.equal((await response.json()).error.code, 'SERVICE_CLOSING');
    observation.mark('client.body_read');
    assert.ok(Date.now()-at<500, JSON.stringify({closeMs:closedAt-at,totalMs:Date.now()-at}));
    t.diagnostic(JSON.stringify({kind:'host-close-wait',closeMs:closedAt-at,totalMs:Date.now()-at}));
    assert.equal(f.debug.service.__reviewCounts().accountWaiters, 0);
    assert.equal(f.debug.eventWaiters.size, 0);
    assert.ok(f.debug.service.__reviewCounts().accountRevision>before, 'closing pending approvals publishes an account revision');
  } finally {await f.close();rmSync(f.root,{recursive:true,force:true});}
});

test('host close drains a registered wait whose response finishes after the idle socket sweep', async t => {
  const f = await startTimelineCandidate({interactive:true,daily:true,inlineProgress:true,historyCount:0});
  // Exercise observer failure on every tap while retaining the real close,
  // complete 503 response, original 500ms budget and listener assertions.
  const observation = observeHostClose(t, f.debug.service, { throwAfterObservation: true });
  let finishResponse;
  try {
    await f.progress.approve('close-late-response','Write-Output synthetic');
    const chat = (await f.request('/chats/main')).chat;
    const page = await f.request(`/chats/${chat.chatId}/events`);
    const server = f.debug.service.__reviewServer();
    let listeningClosed = false;
    server.once('close', () => { listeningClosed = true; });
    let swept = false;
    const sweep = server.closeIdleConnections.bind(server);
    server.closeIdleConnections = () => {
      sweep(); swept = true;
      if (finishResponse) setImmediate(finishResponse);
    };
    // Hold only transport completion, after the real handler has revoked its
    // registered account wait and selected SERVICE_CLOSING. Release it after
    // close()'s idle sweep, the ordering that a slow transport can produce.
    server.once('request', (_request, response) => {
      const end = response.end.bind(response);
      response.end = (...args) => {
        let finished = false;
        finishResponse = () => { if (finished) return; finished = true; finishResponse = undefined; end(...args); };
        if (swept) setImmediate(finishResponse);
        return response;
      };
    });
    const pending = fetch(f.origin+`/personal/v1/chats/${chat.chatId}/changes?cursor=${page.syncCursor}&liveRevision=${page.liveRevision}&waitMs=30000`,
      {headers:{cookie:f.debug.cookie}});
    for (let i=0;i<100&&f.debug.service.__reviewCounts().accountWaiters===0;i++) await new Promise(r=>setTimeout(r,5));
    assert.equal(f.debug.service.__reviewCounts().accountWaiters, 1);
    const before = f.debug.service.__reviewCounts().accountRevision;
    const at = Date.now(); await f.debug.service.close(); observation.mark('close.returned');
    const response = await pending;
    assert.equal(response.status, 503); assert.equal((await response.json()).error.code, 'SERVICE_CLOSING');
    observation.mark('client.body_read');
    assert.ok(Date.now()-at<500, `close and response took ${Date.now()-at}ms`);
    t.diagnostic(JSON.stringify({kind:'host-close-late-response',totalMs:Date.now()-at}));
    assert.equal(listeningClosed, true, 'close waits for the actual HTTP server drain');
    assert.equal(f.debug.service.__reviewCounts().accountWaiters, 0);
    assert.equal(f.debug.eventWaiters.size, 0);
    assert.equal(getEventListeners(f.debug.service.__reviewContext.closingSignal,'abort').length, 0);
    assert.ok(f.debug.service.__reviewCounts().accountRevision>before);
    const phases = observation.phases.map(row => row.phase);
    for (const phase of ['waits.revoked', 'idle.swept', 'response.finished', 'http.closed', 'close.done', 'client.body_read'])
      assert.ok(phases.includes(phase), `missing close observation: ${phase}`);
    assert.ok(phases.indexOf('idle.swept') < phases.indexOf('response.finished'));
  } finally {finishResponse?.();await f.close();rmSync(f.root,{recursive:true,force:true});}
});

test('BL-29b M3/S2 native dispose removes listeners and wait reauthorization prevents logout leakage', () => {
  const r = probe('probe-server', 'server.json');
  assert.equal(r.nativeDispose.settledAfterDispose, true);
  assert.equal(r.nativeDispose.abortListeners, 0); assert.equal(r.nativeDispose.listenersAfter, 0);
  assert.ok(r.nativeAlreadyAbortedMs < 20);
  assert.equal(r.logoutAfterQuery.gateStarted, true); assert.equal(r.logoutAfterQuery.response, 401);
  assert.equal(r.afterWakeWaiters, 0); assert.equal(r.rejectedWait.remaining, 0);
});

test('BL-29b M3 native cancellation during first storage read clears listeners before that read returns', async () => {
  let release, reads = 0;
  const gate = new Promise(resolve => {release=resolve;});
  const read = nativeTimelineLog({on(){},get(key){return key==='sessionPersistence'?{async inspect(){reads++;await gate;return {events:[]};}}:undefined;},effect(){}},{cache:false});
  const controllers = Array.from({length:20},()=>new AbortController());
  const pending = controllers.map(controller=>read.waitForChange('synthetic',-1,30000,controller.signal));
  assert.equal(reads,20);
  controllers.forEach(controller=>controller.abort());
  await Promise.all(pending);
  for (const controller of controllers) assert.equal(getEventListeners(controller.signal,'abort').length,0);
  await read.close(); release();
});

test('BL-29b M1 real Electron empty main keeps eight immediate errors within old changes budget', {timeout:120000}, () => {
  const rows = probe('probe-desktop-errors', 'desktop-errors.json', 110000);
  assert.equal(rows.length, 8);
  for (const row of rows) {
    assert.equal(row.failure, undefined);
    assert.deepEqual(row.nativeWindow,{visible:true,minimized:false},JSON.stringify(row));
    assert.equal(row.debug.background,false,JSON.stringify(row));
    assert.ok(row.count <= 3, JSON.stringify(row));
    if (row.code === 'UNAUTHORIZED') assert.ok(row.count <= 1);
    if (!['NOT_FOUND','UNAUTHORIZED'].includes(row.code)) assert.ok(row.recoveredWaitMs!==null&&row.recoveredWaitMs<=2000, JSON.stringify(row));
  }
});

test('BL-29b M1/S3 shipped mobile full lifecycle empty main budgets errors, recovery and healthy idle', {timeout:150000}, t => {
  const r = probe('probe-browser', 'browser.json', 140000, ['--budget-only','--empty-main']);
  t.diagnostic(JSON.stringify({kind:'healthy-idle-method-census',idleMethods:r.idleMethods,background10s:r.background10s,initial:r.initial}));
  assert.equal(r.failure, undefined); assert.deepEqual(r.errors, []);
  assert.equal(r.cases.length, 8);
  for (const row of r.cases) {
    assert.ok(row.requests<=2, JSON.stringify(row));
    if (!['NOT_FOUND','UNAUTHORIZED'].includes(row.code)) assert.ok(row.recoveredWaitMs!==null&&row.recoveredWaitMs<=2000, JSON.stringify(row));
  }
  assert.ok(Object.values(r.idleMethods).reduce((sum:number,value:number)=>sum+value,0)<=62, 'all bridge methods count in 31s healthy idle');
  assert.ok(r.background10s.length<=1, 'all bridge methods count in 10s hidden');
});
