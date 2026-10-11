import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startTimelineCandidate } from './integration/bl29-rework/fixture.mjs';
import { nativeTimelineLog } from '../src/runtime/dsh-adapter/timeline.mjs';
import { getEventListeners } from 'node:events';
import { runInNewContext } from 'node:vm';

function probe(name: string, output: string, timeout = 60000, args: string[] = []) {
  const root = mkdtempSync(join(tmpdir(), 'bl29-regression-'));
  try {
    const env = { ...process.env, BL29_EVIDENCE_DIR:root, WEFTMATE_TEST_HOST_NAME:'synthetic-host' };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(process.execPath, [`tests/integration/bl29-rework/${name}.mjs`, ...args], {
      env, windowsHide:true, encoding:'utf8', timeout, maxBuffer:8 * 1024 * 1024,
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
    return JSON.parse(readFileSync(join(root, output), 'utf8'));
  } finally { rmSync(root, {recursive:true, force:true, maxRetries:5, retryDelay:100}); }
}

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

test('BL-29b M5 host close revokes empty account waits before closing sockets', async () => {
  const f = await startTimelineCandidate({interactive:true,daily:true,inlineProgress:true,historyCount:0});
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
    const response = await pending;
    assert.equal(response.status, 503); assert.equal((await response.json()).error.code, 'SERVICE_CLOSING');
    assert.ok(Date.now()-at<500);
    assert.equal(f.debug.service.__reviewCounts().accountWaiters, 0);
    assert.equal(f.debug.eventWaiters.size, 0);
    assert.ok(f.debug.service.__reviewCounts().accountRevision>before, 'closing pending approvals publishes an account revision');
  } finally {await f.close();rmSync(f.root,{recursive:true,force:true});}
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
    assert.ok(row.count <= 3, JSON.stringify(row));
    if (row.code === 'UNAUTHORIZED') assert.ok(row.count <= 1);
    if (!['NOT_FOUND','UNAUTHORIZED'].includes(row.code)) assert.ok(row.recoveredWaitMs!==null&&row.recoveredWaitMs<=2000, JSON.stringify(row));
  }
});

test('BL-29b M1/S3 shipped mobile full lifecycle empty main budgets errors, recovery and healthy idle', {timeout:150000}, () => {
  const r = probe('probe-browser', 'browser.json', 140000, ['--budget-only','--empty-main']);
  assert.equal(r.failure, undefined); assert.deepEqual(r.errors, []);
  assert.equal(r.cases.length, 8);
  for (const row of r.cases) {
    assert.ok(row.requests<=2, JSON.stringify(row));
    if (!['NOT_FOUND','UNAUTHORIZED'].includes(row.code)) assert.ok(row.recoveredWaitMs!==null&&row.recoveredWaitMs<=2000, JSON.stringify(row));
  }
  assert.ok(Object.values(r.idleMethods).reduce((sum:number,value:number)=>sum+value,0)<=62, 'all bridge methods count in 31s healthy idle');
  assert.ok(r.background10s.length<=1, 'all bridge methods count in 10s hidden');
});

test('BL-29b M4/S1 real Electron and mobile synchronize settings and regain foreground under 200ms transport', {timeout:60000}, () => {
  const r = probe('probe-latency', 'latency.json', 55000);
  assert.equal(r.failure, undefined);
  for (const row of r.rows) {
    assert.equal(row.error, undefined);
    if (row.kind === 'rename') {assert.ok(row.desktop<=6000, JSON.stringify(row));assert.ok(row.mobile<=6000, JSON.stringify(row));}
    else assert.ok(row.ms<=1000, JSON.stringify(row));
  }
  assert.equal(r.electronConfig.suggestions, false); assert.equal(r.mobileConfig.suggestions, false);
  assert.ok(r.electronConfig.models.includes('added-electron')); assert.ok(r.mobileConfig.models.includes('added-electron'));
  for (const row of r.configurationTimes) assert.ok(row.ms<=7000, JSON.stringify(row));
});
