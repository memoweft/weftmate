import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { invokeProjectReader } from '../src/personal-projects/index.mjs';
import { installedSmokeFailureSummary } from '../scripts/nightly/installed-smoke-diagnostics.mjs';

function fixture(observe: any = undefined) {
  let time = 10_000, kills = 0;
  const timers: any[] = [], observations: any[] = [];
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
  child.stdout.setEncoding = child.stderr.setEncoding = () => {};
  child.stdin.end = () => {};
  child.kill = () => { kills++; return true; };
  const work = invokeProjectReader({ action: 'inspect', rootPath: 'C:\\Synthetic\\private-project' }, {
    spawnProcess: () => child, now: () => time,
    setTimer: (fn: any, ms: number) => { const timer = { fn, ms, active: true }; timers.push(timer); return timer; },
    clearTimer: (timer: any) => { timer.active = false; },
    observe: observe ?? ((event: any) => observations.push(event)),
  } as any);
  return { child, work, timers, observations, get kills() { return kills; },
    time(value: number) { time = value; },
    stage(name: string, elapsed: number) { child.stderr.emit('data', `WEFTMATE_PROJECT_READER_STAGE|${name}|${elapsed}\n`); },
    success() { child.stdout.emit('data', 'WEFTMATE_PROJECT_READER_READY\n{"ok":true,"value":{"synthetic":true}}'); child.emit('close', 0, null); } };
}

test('reader observations keep parent and child clocks separate and do not renew budgets', async () => {
  const f = fixture(); f.child.emit('spawn'); f.child.stdin.emit('finish');
  f.time(10_025); f.stage('bootstrap_started', 0); f.stage('utility_imported', 4);
  f.stage('payload_read', 5); f.stage('compile_started', 6); f.stage('compile_completed', 40_000); f.stage('ready_emitted', 40_001);
  assert.equal(f.timers.length, 1); assert.equal(f.timers[0].ms, 30_000);
  f.success(); assert.deepEqual(await f.work, { synthetic: true });
  assert.deepEqual(f.timers.map(timer => timer.ms), [30_000, 15_000]);
  assert.ok(f.observations.some(event => event.stage === 'spawn_observed'));
  assert.ok(f.observations.some(event => event.stage === 'stdin_finished'));
  const child = f.observations.find(event => event.stage === 'compile_completed');
  assert.equal(child.childElapsedMs, 40_000); assert.equal(child.parentElapsedMs, 25);
  assert.ok(f.observations.some(event => event.stage === 'ready_observed'));
  assert.ok(f.observations.some(event => event.stage === 'close_observed' && event.exitCode === 0));
});

test('initialization timeout retains its code and observes kill and subsequent close', async () => {
  const f = fixture(); const rejected = assert.rejects(f.work, (error: any) => {
    assert.equal(error.code, 'PROJECT_READER_TIMEOUT'); assert.equal(error.readerEvidence.phase, 'initialization');
    assert.equal(error.readerEvidence.operationMs, null); return true;
  });
  f.stage('bootstrap_started', 0); f.stage('ready_emitted', 100);
  assert.equal(f.timers.length, 1); f.time(40_000); f.timers[0].fn(); await rejected;
  f.child.emit('close', 1, null);
  assert.equal(f.kills, 1);
  assert.ok(f.observations.some(event => event.stage === 'kill_requested' && event.returned && event.killed));
  assert.ok(f.observations.some(event => event.stage === 'close_observed' && event.exitCode === 1));
});

test('diagnostic publication failures never replace success or the original error', async t => {
  const success = fixture(() => { throw Error('private-observation-sink'); });
  success.child.emit('spawn'); success.success(); assert.deepEqual(await success.work, { synthetic: true });
  t.mock.method(console, 'warn', () => { throw Error('private-warning-sink'); });
  const failed = fixture(() => { throw Error('private-observation-sink'); });
  const rejected = assert.rejects(failed.work, (error: any) => error.code === 'PROJECT_READER_TIMEOUT' && error.readerEvidence.observationFailures > 0);
  failed.child.emit('spawn'); failed.time(40_000); failed.timers[0].fn(); await rejected;
});

test('unknown or sensitive stderr stays out of new observations and cannot act as READY', async () => {
  const f = fixture();
  f.child.stderr.emit('data', 'Bearer private-token C:\\Private\\project\nWEFTMATE_PROJECT_READER_STAGE|private-stage|1\n');
  f.child.stderr.emit('data', 'WEFTMATE_PROJECT_READER_STAGE|compile_started|private-token\n');
  f.stage('ready_emitted', 2); assert.equal(f.timers.length, 1);
  f.success(); await f.work;
  assert.doesNotMatch(JSON.stringify(f.observations), /private|Bearer|C:\\/);
});

test('only stdout READY starts the unchanged operation budget and checkpoints never renew it', async () => {
  const f = fixture();
  f.time(10_040); f.child.stdout.emit('data', 'WEFTMATE_PROJECT_READER_READY\n');
  f.stage('compile_completed', 20); f.stage('ready_emitted', 21);
  assert.deepEqual(f.timers.map(timer => timer.ms), [30_000, 15_000]);
  assert.equal(f.timers[0].active, false); assert.equal(f.timers[1].active, true);
  const rejected = assert.rejects(f.work, (error: any) => {
    assert.equal(error.code, 'PROJECT_READER_TIMEOUT');
    assert.equal(error.readerEvidence.phase, 'operation');
    assert.equal(error.readerEvidence.initializationMs, 40);
    assert.equal(error.readerEvidence.operationMs, 15_000); return true;
  });
  f.time(25_040); f.timers[1].fn(); await rejected;
  assert.equal(f.kills, 1);
});

test('diagnostic frames cannot repair an invalid stdout protocol or native failure', async () => {
  const invalid = fixture();
  const invalidResult = assert.rejects(invalid.work, (error: any) => error.code === 'PROJECT_READER_INVALID');
  invalid.stage('ready_emitted', 1); invalid.child.stdout.emit('data', 'not-the-READY-protocol\n');
  await invalidResult; assert.equal(invalid.timers.length, 1); assert.equal(invalid.kills, 1);
  const failed = fixture();
  const failedResult = assert.rejects(failed.work, (error: any) => error.code === 'PROJECT_ROOT_CHANGED');
  failed.stage('compile_completed', 10);
  failed.child.stdout.emit('data', 'WEFTMATE_PROJECT_READER_READY\n{"ok":false,"code":"PROJECT_ROOT_CHANGED"}');
  failed.child.emit('close', 0, null); await failedResult;
});

test('chunked checkpoints are parsed without exposing long, unknown or incomplete stderr', async () => {
  const f = fixture();
  f.child.stderr.emit('data', 'WEFTMATE_PROJECT_READER_STA');
  f.child.stderr.emit('data', 'GE|bootstrap_started|7\r\n');
  f.child.stderr.emit('data', 'private'.repeat(100) + '\n');
  f.child.stderr.emit('data', 'WEFTMATE_PROJECT_READER_STAGE|private_stage|8\n');
  f.child.stderr.emit('data', 'WEFTMATE_PROJECT_READER_STAGE|compile_started|999999999999999999999\n');
  f.child.stderr.emit('data', 'WEFTMATE_PROJECT_READER_STAGE|payload_read|');
  f.success(); await f.work;
  assert.deepEqual(f.observations.filter(event => event.source === 'child').map(event => [event.stage, event.childElapsedMs]), [['bootstrap_started', 7]]);
  assert.doesNotMatch(JSON.stringify(f.observations), /private/);
});

test('a rejected asynchronous observation does not change the original success', async () => {
  const f = fixture(() => Promise.reject(Error('private-async-sink')));
  f.child.emit('spawn'); f.child.stdin.emit('finish');
  await Promise.resolve();
  f.success(); assert.deepEqual(await f.work, { synthetic: true });
});

test('packaged smoke keeps its original failure and adds only whitelisted native reader evidence', () => {
  const summary: any = installedSmokeFailureSummary({ error: 'MIGRATION_SMOKE_TIMEOUT', failureView: { selectedCount: 0 }, stderr: [
    'Bearer private-token C:\\Private\\project\n',
    'Project reader failure: {"code":"PROJECT_READER_TIMEOUT","phase":"initialization","initializationMs":30001,"operationMs":null,"stdoutBytes":0,"stderrBytes":0,"path":"C:\\\\Private"}\n',
    "Error occurred in handler for 'wm:desktop:project-create': Error: PROJECT_READER_TIMEOUT\n",
  ] } as any);
  assert.equal(summary.error, 'MIGRATION_SMOKE_TIMEOUT'); assert.deepEqual(summary.failureView, { selectedCount: 0 });
  assert.deepEqual(summary.nativeProjectDiagnostics.errorCodes, ['PROJECT_READER_TIMEOUT']);
  assert.equal(summary.nativeProjectDiagnostics.readerFailures[0].initializationMs, 30001);
  assert.doesNotMatch(JSON.stringify(summary.nativeProjectDiagnostics), /private|Bearer|path|C:\\/i);
});

test('smoke diagnostics reject unknown codes and values while leaving the legacy failure unchanged', () => {
  const stderr = [
    'Project reader failure: {invalid-json}\n',
    'Project reader failure: {"code":"PROJECT_PRIVATE_TOKEN","phase":"initialization"}\n',
    'Project reader failure: {"code":"PROJECT_READER_TIMEOUT","phase":"private"}\n',
    'Project reader failure: {"code":"PROJECT_READER_TIMEOUT","phase":"operation","initializationMs":"private","childElapsedMs":-1,"readyObserved":"private","lastChildStage":"private","operationMs":1.5}\n',
  ];
  const summary: any = installedSmokeFailureSummary({ error: 'original-failure', failureView: null, stderr });
  assert.equal(summary.error, 'original-failure'); assert.equal(summary.failureView, null);
  assert.deepEqual(summary.nativeProjectDiagnostics.readerFailures, [{ code: 'PROJECT_READER_TIMEOUT', phase: 'operation' }]);
  assert.doesNotMatch(JSON.stringify(summary.nativeProjectDiagnostics), /private/i);
  assert.deepEqual(installedSmokeFailureSummary({ error: 'original-failure', failureView: null, stderr: ['arbitrary private stderr\n'] }),
    { error: 'original-failure', failureView: null });
  const unavailable: any = installedSmokeFailureSummary({ error: 'original-failure', failureView: null,
    stderr: ["Error occurred in handler for 'wm:desktop:project-create': Error: PROJECT_UNAVAILABLE\n"] });
  assert.deepEqual(unavailable.nativeProjectDiagnostics.errorCodes, ['PROJECT_UNAVAILABLE']);
});
