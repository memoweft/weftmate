import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { runManagedTestProcess } from './helpers/managed-test-process.mjs';
import { createRequire } from 'node:module';
import { parseTap, runFileGate } from '../.github/scripts/ci-test-policy.mjs';
import { collectNativeExitDiagnostics } from './helpers/native-exit-diagnostics.mjs';
const { installNativeExitObserver, projectReport } = createRequire(import.meta.url)('./helpers/native-exit-observer.cjs');

test('all passing leaves followed by a native-style file exit retain worker diagnostics without retry', async () => {
  const scope = mkdtempSync(join(tmpdir(), 'weftmate-native-exit-'));
  try {
    const file = join(scope, 'fixture.cjs');
    // An exit code, not an actual access violation: no WER dialog or dump.
    writeFileSync(file, `require('node:test')('synthetic passing leaf', () => {});
      process.once('exit', () => process.reallyExit(process.platform === 'win32' ? 0xC0000005 : 7));`);
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const run = await runManagedTestProcess(process.execPath, ['--test', '--test-reporter=tap', file], {
      env, commandRoots: [scope], timeoutMs: 15000, diagnosticDirectory: scope,
    });
    assert.notEqual(run.status, 0);
    assert.match(run.stdout, /ok 1 - synthetic passing leaf/);
    assert.match(run.stdout, /exitCode: (3221225477|7)/);
    assert.ok(run.evidence?.nativeExit?.snapshots.length >= 2, 'runner and file worker survive in parent evidence');
    const worker = run.evidence.nativeExit.snapshots.find(row => row.pid !== run.evidence.nativeExit.runnerPid);
    assert.equal(worker.nodeVersion, process.version);
    assert.equal(worker.phase, 'exit');
    assert.ok(worker.sharedObjects.length > 0);
    assert.deepEqual(worker.activeChildren, []);
    const runner = run.evidence.nativeExit.snapshots.find(row => row.pid === run.evidence.nativeExit.runnerPid);
    assert.equal(runner.lastChildExit.pid, worker.pid);
    assert.equal(runner.lastChildExit.code, process.platform === 'win32' ? 3221225477 : 7);
    assert.ok(run.evidence.nativeExit.outputTail.some(row => row.includes('synthetic passing leaf')));
    assert.deepEqual(run.evidence.nativeExit.reports, [], 'absence of a fatal report is explicit');
    let attempts = 0;
    const gate = await runFileGate([file], {
      entries: [{ file, name: 'synthetic passing leaf' }],
      policy: { ci: 'true', mode: 'required', event: 'pull_request' },
      execute: async () => { attempts++; return { ...parseTap(run.stdout), status: run.status, evidence: run.evidence }; },
    });
    assert.equal(gate.exitCode, 1); assert.equal(attempts, 1); assert.deepEqual(gate.recovered, []);
  } finally { rmSync(scope, { recursive: true, force: true }); }
});

test('a real generated Node report is collected before scope cleanup with private fields excluded', async () => {
  const scope = mkdtempSync(join(tmpdir(), 'weftmate-native-report-'));
  try {
    const file = join(scope, 'report-fixture.cjs');
    writeFileSync(file, `process.report.writeReport(); process.stdout.write('synthetic final output'); process.exit(7);`);
    const run = await runManagedTestProcess(process.execPath, [`--report-directory=${scope}`, file], {
      env: { ...process.env, SYNTHETIC_PRIVATE_REPORT_VALUE: 'private-report-sentinel' },
      commandRoots: [scope], timeoutMs: 15000, diagnosticDirectory: scope,
    });
    assert.equal(run.status, 7); assert.equal(run.stdout, 'synthetic final output');
    assert.equal(run.evidence.nativeExit.reports.length, 1);
    assert.equal(run.evidence.nativeExit.reports[0].nodeVersion, process.version);
    assert.ok(run.evidence.nativeExit.reports[0].sharedObjects.length > 0);
    assert.equal(JSON.stringify(run.evidence.nativeExit).includes('private-report-sentinel'), false);
    assert.equal(JSON.stringify(run.evidence.nativeExit.reports).includes(scope), false);
  } finally { rmSync(scope, { recursive: true, force: true }); }
});

test('an unavailable diagnostic directory leaves successful output and exit unchanged', async () => {
  const scope = mkdtempSync(join(tmpdir(), 'weftmate-native-unavailable-'));
  try {
    const blocked = join(scope, 'not-a-directory'); writeFileSync(blocked, 'synthetic');
    const run = await runManagedTestProcess(process.execPath, ['-e', "console.log('original result')"], {
      env: process.env, commandRoots: [scope], timeoutMs: 15000, diagnosticDirectory: blocked,
    });
    assert.equal(run.status, 0); assert.equal(run.stdout, 'original result\n');
    assert.equal(run.stderr, ''); assert.equal(run.error, undefined); assert.equal(run.evidence, undefined);
  } finally { rmSync(scope, { recursive: true, force: true }); }
});

test('last snapshot includes a still-running child before abrupt parent termination', async () => {
  const scope = mkdtempSync(join(tmpdir(), 'weftmate-native-child-'));
  let pid;
  try {
    const file = join(scope, 'child-fixture.cjs');
    writeFileSync(file, `const {spawn}=require('node:child_process');
      const child=spawn(process.execPath,['-e','setTimeout(()=>{},10000)',${JSON.stringify(scope)}],{stdio:'ignore',windowsHide:true});
      child.once('spawn',()=>process.exit(7));`);
    const run = await runManagedTestProcess(process.execPath, [file], {
      env: process.env, commandRoots: [scope], timeoutMs: 15000, diagnosticDirectory: scope,
    });
    assert.equal(run.status, 7);
    const snapshot = run.evidence.nativeExit.snapshots.find(row => row.pid === run.evidence.nativeExit.runnerPid);
    assert.equal(snapshot.activeChildren.length, 1);
    pid = snapshot.activeChildren[0].pid;
    assert.equal(snapshot.activeChildren[0].executable, basename(process.execPath));
    // Existing owned cleanup still removes this process after observation.
    if (process.platform === 'win32') assert.throws(() => process.kill(pid, 0));
  } finally { if (pid) try { process.kill(pid); } catch {} rmSync(scope, { recursive: true, force: true }); }
});

test('observer failures preserve native loader receiver, result and original exception', () => {
  const original = process.dlopen, receiver = {}, sentinel = {}, failure = Error('synthetic loader failure');
  let calls = 0, stop;
  try {
    process.dlopen = function (...args) {
      assert.equal(this, receiver); assert.deepEqual(args, ['synthetic']);
      if (++calls === 2) throw failure;
      return sentinel;
    };
    stop = installNativeExitObserver({ directory: tmpdir(), reportReader: () => { throw Error('report failed'); }, write: () => { throw Error('disk failed'); } });
    assert.equal(Reflect.apply(process.dlopen, receiver, ['synthetic']), sentinel);
    assert.throws(() => Reflect.apply(process.dlopen, receiver, ['synthetic']), error => error === failure);
    assert.equal(calls, 2);
  } finally { stop?.(); process.dlopen = original; }
});

test('diagnostic reports publish module basenames and handle kinds without private report fields', () => {
  const secret = 'synthetic-private-content';
  const projected = projectReport({ header: { nodejsVersion: 'v24.21.0', event: 'FatalError', host: secret, cwd: secret },
    environmentVariables: { KEY: secret }, javascriptStack: { stack: secret },
    sharedObjects: ['C:\\private\\addon.node', '/private/library.so'],
    nativeStack: [{ pc: '0x123', symbol: secret }],
    libuv: [{ type: 'process', is_active: true, is_referenced: false, path: secret, pid: 123 }],
  });
  assert.deepEqual(projected.sharedObjects, ['addon.node', 'library.so']);
  assert.equal(JSON.stringify(projected).includes(secret), false);
  assert.equal(JSON.stringify(projected).includes('private'), false);
});

test('successful observer lifecycle and native loads never collect a full report', () => {
  const original = process.dlopen;
  let reports = 0, stop;
  try {
    process.dlopen = () => undefined;
    stop = installNativeExitObserver({ directory: tmpdir(), reportReader: () => { reports++; return {}; }, write: () => {} });
    process.dlopen({}, 'synthetic.node');
    // Exercise the actual registered lifecycle callbacks without emitting exit
    // into node:test's own process listeners.
    const lifecycle = process.listeners('beforeExit').at(-1);
    lifecycle(0);
    process.listeners('exit').at(-1)(0);
    assert.equal(reports, 0);
  } finally { stop?.(); process.dlopen = original; }
});

test('failure indications collect once and abort preserves its receiver, return and exception', () => {
  const original = process.abort, receiver = {}, result = {}, failure = Error('synthetic abort exception');
  let reports = 0, calls = 0, stop;
  try {
    process.abort = function (...args) {
      assert.equal(this, receiver); assert.deepEqual(args, ['synthetic']);
      if (++calls === 2) throw failure;
      return result;
    };
    stop = installNativeExitObserver({ directory: tmpdir(), reportReader: () => { reports++; return {}; }, write: () => {} });
    assert.equal(reports, 0);
    assert.equal(Reflect.apply(process.abort, receiver, ['synthetic']), result);
    assert.equal(reports, 1);
    assert.throws(() => Reflect.apply(process.abort, receiver, ['synthetic']), error => error === failure);
    process.listeners('uncaughtExceptionMonitor').at(-1)(Error('synthetic exception'));
    process.listeners('beforeExit').at(-1)(7);
    process.listeners('exit').at(-1)(7);
    assert.equal(reports, 1, 'later failure indications reuse the first report');
    assert.equal(calls, 2);
  } finally { stop?.(); process.abort = original; }
});

test('every newly published diagnostic string is scrubbed including nested snapshot and report fields', () => {
  const scope = mkdtempSync(join(tmpdir(), 'weftmate-native-redaction-'));
  const root = String.raw`D:\Synthetic Private\workspace`;
  const forms = [root, root.replaceAll('\\', '\\\\'), root.replaceAll('\\', '/'),
    'file:///' + root.replaceAll('\\', '/').split('/').map(encodeURIComponent).join('/')];
  try {
    for (const value of forms) {
      writeFileSync(join(scope, 'native-1-0.json'), JSON.stringify({ pid: 1, phase: value,
        activeChildren: [{ pid: 2, executable: value }], sharedObjects: [value], lastChildExit: { executable: value } }));
      writeFileSync(join(scope, 'report.synthetic.json'), JSON.stringify({ header: { event: value } }));
      const evidence = collectNativeExitDiagnostics(scope, { runnerPid: 1, stdout: value, stderr: value, roots: [root] });
      assert.equal(evidence.outputTail[0], '%TEMP%');
      assert.equal(evidence.stderrTail[0], '%TEMP%');
      assert.equal(evidence.snapshots[0].phase, '%TEMP%');
      assert.equal(evidence.snapshots[0].activeChildren[0].executable, '%TEMP%');
      assert.equal(evidence.snapshots[0].sharedObjects[0], '%TEMP%');
      assert.equal(evidence.snapshots[0].lastChildExit.executable, '%TEMP%');
      assert.equal(evidence.reports[0].event, '%TEMP%');
    }
  } finally { rmSync(scope, { recursive: true, force: true }); }
});
