import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, appendFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createHostLog } from '../src/host-log.mjs';
import { waitForFirstWindow, summarizeDescendants } from './helpers/first-window-diagnostics.mjs';
import { installedSmokeFailureSummary } from '../scripts/nightly/installed-smoke-diagnostics.mjs';

const timeout = () => Object.assign(new Error('original firstWindow timeout'), { name: 'TimeoutError' });
function fixture(t: any, pid: number) {
  const launchStartedAt = Date.now();
  const profile = mkdtempSync(join(tmpdir(), 'first-window-'));
  t.after(() => rmSync(profile, { recursive: true, force: true }));
  const runId = randomUUID(), log = createHostLog(profile, { runId });
  log.write('host.start', { pid, memoryEnabled: false });
  log.write('host.startup', { phase: 'runtime-start' });
  log.write('runtime.event', { source: 'dsh', code: 'RUNTIME_STATE' });
  return { profile, runId, log, launchStartedAt };
}
function application(child: any, error: any) {
  const calls: any[] = [];
  return { calls, process: () => child, firstWindow(...args: any[]) { calls.push(args); return Promise.reject(error); } };
}

test('first-window failure finds the live host log behind the real Windows shell launcher', { timeout: 15000 }, async t => {
  const f = fixture(t, -1), entry = join(f.profile, 'host.mjs');
  const moduleUrl = new URL('../src/host-log.mjs', import.meta.url).href;
  writeFileSync(entry, `
    import { createHostLog } from ${JSON.stringify(moduleUrl)};
    const log = createHostLog(${JSON.stringify(f.profile)});
    log.write('host.start', { pid: process.pid });
    log.write('host.startup', { phase: 'window-prepare' });
    process.stdout.write('ready\\n');
    process.stdin.resume();
  `);
  const launchStartedAt = Date.now();
  const child = process.platform === 'win32'
    ? spawn(`"${process.execPath}" "${entry}"`, { shell: true, windowsHide: true })
    : spawn(process.execPath, [entry]);
  t.after(async () => { if (child.exitCode === null) { const closed = once(child, 'close'); child.stdin.end(); await closed; } });
  await once(child.stdout, 'data');
  // A newer run outside the launcher's tree must not replace the real host.
  const unrelated = createHostLog(f.profile);
  unrelated.write('host.start', { pid: process.pid });
  unrelated.write('host.startup', { phase: 'window-created' });
  const error: any = timeout();
  await assert.rejects(waitForFirstWindow({ app: application(child, error), profile: f.profile, launchStartedAt, publish() {} }), value => value === error);
  assert.equal(error.firstWindowDiagnostics.hostLog.status, 'ok');
  assert.equal(error.firstWindowDiagnostics.hostLog.lastStartupPhase, 'window-prepare');
  assert.doesNotMatch(JSON.stringify(error.firstWindowDiagnostics), /host\.mjs|first-window-|runId/);
});

test('first-window failure rejects yesterday\'s log for a reused live descendant PID', { timeout: 15000 }, async t => {
  const f = fixture(t, -1), entry = join(f.profile, 'host.mjs');
  const moduleUrl = new URL('../src/host-log.mjs', import.meta.url).href;
  writeFileSync(entry, `
    import { createHostLog } from ${JSON.stringify(moduleUrl)};
    const log = createHostLog(${JSON.stringify(f.profile)}, { now: () => new Date(Date.now() - 86400000) });
    log.write('host.start', { pid: process.pid });
    log.write('host.startup', { phase: 'window-created' });
    log.write('host.exit', { reason: 'user-quit', exitCode: 0 });
    process.stdout.write('ready\\n');
    process.stdin.resume();
  `);
  const launchStartedAt = Date.now();
  const child = process.platform === 'win32'
    ? spawn(`"${process.execPath}" "${entry}"`, { shell: true, windowsHide: true })
    : spawn(process.execPath, [entry]);
  t.after(async () => { if (child.exitCode === null) { const closed = once(child, 'close'); child.stdin.end(); await closed; } });
  await once(child.stdout, 'data');
  const error: any = timeout(), app = application(child, error);
  await assert.rejects(waitForFirstWindow({ app, profile: f.profile, launchStartedAt, publish() {} }), value => value === error);
  assert.deepEqual(app.calls, [[]]);
  assert.deepEqual(error.firstWindowDiagnostics.hostLog, { status: 'no-current-run' });
});

test('first-window failure samples a live real process before cleanup and keeps error identity and deadline', async t => {
  const child = spawn(process.execPath, ['-e', `
    const sub = require('node:child_process').spawn(process.execPath, ['-e', 'process.stdin.resume()', process.argv[1]], { stdio: ['pipe', 'ignore', 'ignore'] });
    sub.once('spawn', () => process.stderr.write("Bearer synthetic-secret private conversation\\nError: ENOENT: private-file\\n"));
    process.stdin.resume();
  `, import.meta.filename]);
  t.after(async () => { if (child.exitCode === null) { child.kill(); await once(child, 'close'); } });
  const stderr: string[] = []; child.stderr.on('data', value => stderr.push(String(value)));
  await once(child.stderr, 'data');
  const f = fixture(t, child.pid!); const error: any = timeout(), app = application(child, error);
  await assert.rejects(waitForFirstWindow({ app, profile: f.profile, launchStartedAt: f.launchStartedAt, stderr }), value => value === error);
  assert.deepEqual(app.calls, [[]]);
  const snapshot = error.firstWindowDiagnostics;
  assert.equal(snapshot.process.state, 'alive'); assert.equal(snapshot.process.exitCode, null);
  assert.equal(snapshot.hostLog.status, 'ok');
  assert.equal(snapshot.hostLog.lastStartupPhase, 'runtime-start');
  assert.equal(snapshot.hostLog.lastEvent, 'runtime.event');
  assert.equal(snapshot.hostLog.memoryEnabled, false);
  if (process.platform === 'win32') assert.deepEqual(snapshot.children, { status: 'ok', total: 1, python: 0, core: 0 });
  assert.deepEqual(snapshot.stderrTail.map((row: any) => row.kind), ['unclassified', 'node-error']);
  assert.equal(snapshot.stderrTail[1].code, 'ENOENT');
  assert.doesNotMatch(JSON.stringify(snapshot), /synthetic-secret|private|Bearer|conversation|first-window-|runId/);
  const summary = installedSmokeFailureSummary({ error: error.stack, failureView: undefined, firstWindowDiagnostics: snapshot });
  assert.equal(summary.firstWindowDiagnostics, snapshot); assert.equal(summary.error, error.stack);
});

test('exited process retains exit code and missing logs are explicit, without waiting for Electron IPC', async t => {
  const child = spawn(process.execPath, ['-e', 'process.exit(23)', import.meta.filename]); await once(child, 'close');
  const profile = mkdtempSync(join(tmpdir(), 'first-window-')); t.after(() => rmSync(profile, { recursive: true, force: true }));
  const error: any = timeout(); const app = application(child, error);
  await assert.rejects(waitForFirstWindow({ app, profile, stderr: [] }), value => value === error);
  assert.equal(error.firstWindowDiagnostics.process.state, 'exited');
  assert.equal(error.firstWindowDiagnostics.process.exitCode, 23);
  assert.equal(error.firstWindowDiagnostics.hostLog.status, 'missing');
  assert.equal(error.firstWindowDiagnostics.children.status, 'parent-exited');
});

test('log projection follows the current PID/run across rotation and ignores old runs, partial rows and private fields', async t => {
  const f = fixture(t, process.pid);
  const old = createHostLog(f.profile, { runId: randomUUID() }); old.write('host.start', { pid: process.pid + 1 }); old.write('host.ready');
  f.log.write('host.startup', { phase: 'window-prepare', profileId: 'private-account' });
  const file = join(f.profile, 'logs', 'host-2099-01-01-1.jsonl');
  appendFileSync(file, '{partial\n' + JSON.stringify({ runId: f.runId, recordIndex: 100, event: 'host.failure', source: 'private-source', code: 'private-code' }) + '\n');
  appendFileSync(file, JSON.stringify({ runId: f.runId, recordIndex: 101, event: 'private-event', phase: 'private-phase' }) + '\n');
  const error: any = timeout(); await assert.rejects(waitForFirstWindow({ app: application(process, error), profile: f.profile, launchStartedAt: f.launchStartedAt, stderr: [] }));
  assert.equal(error.firstWindowDiagnostics.hostLog.lastStartupPhase, 'window-prepare');
  assert.equal(error.firstWindowDiagnostics.hostLog.lastEvent, 'host.failure');
  assert.doesNotMatch(JSON.stringify(error.firstWindowDiagnostics), /private|2099|profileId/);
});

test('unreadable diagnostics and publication failures cannot replace the original rejection', async () => {
  for (const publish of [() => { throw Error('private sink'); }, () => Promise.reject(Error('private async sink'))]) {
    const error: any = timeout();
    await assert.rejects(waitForFirstWindow({ app: application({ pid: -1, exitCode: null, signalCode: null }, error), profile: '', stderr: [], publish }), value => value === error);
    assert.equal(error.firstWindowDiagnostics.process.state, 'unavailable');
    assert.equal(error.firstWindowDiagnostics.hostLog.status, 'unavailable');
  }
});

test('log attribution stays unknown without a valid launch time or host start timestamp', async t => {
  const f = fixture(t, process.pid);
  for (const launchStartedAt of [undefined, NaN, Infinity, Date.now() + 86400000]) {
    const error: any = timeout();
    await assert.rejects(waitForFirstWindow({ app: application(process, error), profile: f.profile, launchStartedAt, publish() {} }), value => value === error);
    assert.deepEqual(error.firstWindowDiagnostics.hostLog, { status: 'no-current-run' });
  }
  // Isolate each invalid start so there is no valid record to fall back to.
  for (const at of [undefined, 'invalid', new Date(Date.now() + 86400000).toISOString()]) {
    const profile = mkdtempSync(join(tmpdir(), 'first-window-time-'));
    t.after(() => rmSync(profile, { recursive: true, force: true }));
    const log = createHostLog(profile);
    log.write('host.start', { pid: process.pid });
    // Keep one real log file but supply a malformed/future start timestamp.
    const name = readdirSync(join(profile, 'logs'))[0];
    writeFileSync(join(profile, 'logs', name), JSON.stringify({ event: 'host.start', pid: process.pid, runId: f.runId, at }) + '\n');
    const error: any = timeout();
    await assert.rejects(waitForFirstWindow({ app: application(process, error), profile, launchStartedAt: f.launchStartedAt, publish() {} }), value => value === error);
    assert.deepEqual(error.firstWindowDiagnostics.hostLog, { status: 'no-current-run' });
  }
});

test('success returns the exact window without reading diagnostics or publishing', async () => {
  const window = {}, calls: any[] = [];
  const app = { firstWindow(...args: any[]) { calls.push(args); return Promise.resolve(window); }, process() { throw Error('must not sample success'); } };
  assert.equal(await waitForFirstWindow({ app, publish() { throw Error('must not publish success'); } }), window);
  assert.deepEqual(calls, [[]]);
});

test('descendant projection distinguishes Python from Core and excludes unrelated processes and command text', () => {
  const rows = [
    { ProcessId: 12, ParentProcessId: 11, Name: 'python.exe', CommandLine: 'python.exe -B -m memoweft.integrations.dsh_bridge --private secret' },
    { ProcessId: 11, ParentProcessId: 10, Name: 'WeftMate.exe', CommandLine: 'private-path' },
    { ProcessId: 13, ParentProcessId: 10, Name: 'pythonw.exe', CommandLine: 'private-program' },
    { ProcessId: 15, ParentProcessId: 14, Name: 'python.exe', CommandLine: 'python.exe -m memoweft.integrations.dsh_bridge' },
  ];
  assert.deepEqual(summarizeDescendants(rows, 10), { status: 'ok', total: 3, python: 2, core: 1 });
  assert.deepEqual(summarizeDescendants(rows, 14), { status: 'ok', total: 1, python: 1, core: 1 });
});

test('single-instance exit and the final twelve stderr lines remain fixed metadata', async t => {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)', import.meta.filename]); await once(child, 'close');
  const f = fixture(t, child.pid!);
  f.log.write('host.exit', { reason: 'single-instance', exitCode: 0, profileId: 'private-account' });
  const error: any = timeout();
  await assert.rejects(waitForFirstWindow({ app: application(child, error), profile: f.profile, launchStartedAt: f.launchStartedAt,
    stderr: ['private-secret\n'.repeat(20) + '[weftmate] ✗ private-error\n'] }));
  assert.deepEqual(error.firstWindowDiagnostics.hostLog.tail.at(-1), { event: 'host.exit', reason: 'single-instance', exitCode: 0 });
  assert.equal(error.firstWindowDiagnostics.stderrTail.length, 12);
  assert.equal(error.firstWindowDiagnostics.stderrTail.at(-1).kind, 'startup-failure');
  assert.doesNotMatch(JSON.stringify(error.firstWindowDiagnostics), /private/);
});

test('frozen rejection still publishes safe metadata and preserves exact error identity', async () => {
  const error = Object.freeze(timeout()), published: string[] = [];
  await assert.rejects(waitForFirstWindow({ app: application({ pid: -1 }, error), profile: '', publish: value => published.push(value) }), value => value === error);
  assert.equal(published.length, 1); assert.match(published[0], /"state":"unavailable"/);
});
