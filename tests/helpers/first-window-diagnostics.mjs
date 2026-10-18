import { execFile } from 'node:child_process';
import { readdirSync, readFileSync, openSync, readSync, closeSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { constants } from 'node:os';
import { sanitizeErrorDiagnostic } from '../../src/host-log.mjs';
import { startupPhases } from '../../src/startup-observation.mjs';

const phases = new Set(['bootstrap', 'runtime-start', 'runtime-ready', 'personal-access-start',
  'personal-access-ready', 'window-prepare', 'window-create', 'window-created']);
const events = new Set(['host.start', 'host.crash_reporter', 'host.startup', 'host.ready', 'host.failure',
  'host.exit', 'runtime.event', 'runtime.process_gone', 'child.process_gone', 'memory.bridge']);
const reasons = new Set(['single-instance', 'startup-failure', 'user-quit', 'unknown', 'clean-exit',
  'abnormal-exit', 'killed', 'crashed', 'oom', 'launch-failed', 'startup-failed']);
const sources = new Set(['uncaughtException', 'unhandledRejection', 'main-startup', 'personal-host-startup',
  'harness-startup', 'harness-window-startup', 'crash-reporter', 'startup-error-dialog']);
const signals = new Set(['SIGTERM', 'SIGINT', 'SIGKILL', 'SIGHUP', 'SIGABRT', 'SIGSEGV', 'SIGBREAK', 'SIGQUIT']);
const integer = Number.isSafeInteger;

export function prepareFirstWindowTrace(profile, env) {
  try {
    const directory = join(profile, 'logs'), file = join(directory, `first-window-${randomUUID()}.jsonl`);
    mkdirSync(directory, { recursive: true });
    env.WEFTMATE_FIRST_WINDOW_TRACE = file;
    return file;
  } catch { return undefined; /* Trace setup must not prevent the original launch. */ }
}

function processSnapshot(child) {
  const exitCode = integer(child?.exitCode) ? child.exitCode : null;
  const signal = signals.has(child?.signalCode) ? child.signalCode : null;
  let state = 'unavailable';
  if (exitCode !== null || signal !== null) state = 'exited';
  else if (integer(child?.pid) && child.pid > 0) {
    try { process.kill(child.pid, 0); state = 'alive'; }
    catch (error) { if (error.code === 'ESRCH') state = 'not-running'; }
  }
  return { state, exitCode, signal };
}

function hostLogSnapshot(profile, processIds, launchStartedAt) {
  if (!profile) return { status: 'unavailable' };
  let names;
  try { names = readdirSync(join(profile, 'logs')).filter(name => /^host-\d{4}-\d\d-\d\d(?:-\d+)?\.jsonl$/.test(name))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true })); }
  catch (error) { return { status: error.code === 'ENOENT' ? 'missing' : 'unavailable' }; }
  const rows = [];
  try {
    for (const name of names) for (const line of readFileSync(join(profile, 'logs', name), 'utf8').split('\n')) {
      try { const row = JSON.parse(line); if (row && typeof row === 'object') rows.push(row); } catch { /* Interrupted final write. */ }
    }
  } catch { return { status: 'unavailable' }; }
  const sampledAt = Date.now();
  if (!Number.isFinite(launchStartedAt) || launchStartedAt <= 0 || launchStartedAt > sampledAt)
    return { status: 'no-current-run' };
  // The launcher and host log share the machine's millisecond wall clock.
  // Do not admit pre-launch records: a live descendant may have reused a PID.
  // Missing/invalid times or a backward clock change leave attribution unknown.
  const start = rows.findLast(row => {
    const at = typeof row.at === 'string' ? Date.parse(row.at) : NaN;
    return row.event === 'host.start' && processIds.has(row.pid) && at >= launchStartedAt && at <= sampledAt;
  });
  if (!start || typeof start.runId !== 'string') return { status: 'no-current-run' };
  const current = rows.filter(row => row.runId === start.runId && events.has(row.event))
    .sort((a, b) => a.recordIndex - b.recordIndex);
  const tail = current.slice(-12).map(row => {
    const item = { event: row.event };
    if (row.event === 'host.startup' && phases.has(row.phase)) item.phase = row.phase;
    if (row.event === 'host.start' && row.mode === 'single-instance') item.mode = row.mode;
    if (row.event === 'memory.bridge') item.configured = row.configured === true;
    if (row.event === 'runtime.event' && ['RUNTIME_STATE', 'RUNTIME_FAILURE'].includes(row.code)) item.code = row.code;
    if (row.event === 'host.failure') Object.assign(item, sanitizeErrorDiagnostic(row, { knownPaths: new Set() }));
    if (sources.has(row.source)) item.source = row.source;
    if (reasons.has(row.reason)) item.reason = row.reason;
    if (integer(row.exitCode)) item.exitCode = row.exitCode;
    return item;
  });
  return { status: 'ok', lastEvent: current.at(-1)?.event ?? 'host.start',
    lastStartupPhase: current.findLast(row => row.event === 'host.startup' && phases.has(row.phase))?.phase ?? null,
    ...(typeof start.memoryEnabled === 'boolean' ? { memoryEnabled: start.memoryEnabled } : {}), tail };
}

function descendantIds(rows, parentPid) {
  const descendants = new Set([parentPid]);
  for (let previous = 0; previous !== descendants.size;) {
    previous = descendants.size;
    for (const row of rows) if (integer(row.ProcessId) && descendants.has(row.ParentProcessId)) descendants.add(row.ProcessId);
  }
  return descendants;
}

/** Process names and command lines are used only in memory, never returned. */
export function summarizeDescendants(rows, parentPid) {
  const descendants = descendantIds(rows, parentPid);
  const children = rows.filter(row => row.ProcessId !== parentPid && descendants.has(row.ProcessId));
  return { status: 'ok', total: children.length,
    python: children.filter(row => /^python(?:w|\d+(?:\.\d+)*)?(?:\.exe)?$/i.test(row.Name)).length,
    core: children.filter(row => /^python(?:w|\d+(?:\.\d+)*)?(?:\.exe)?$/i.test(row.Name) &&
      /(?:^|\s)memoweft\.integrations\.dsh_bridge(?:\s|$)/.test(row.CommandLine ?? '')).length };
}

export function queryWindowsProcesses(run = execFile) {
  const systemPowerShell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0');
  return new Promise((resolve, reject) => run(join(systemPowerShell, 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,CommandLine -ErrorAction Stop | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress'],
  { windowsHide: true, encoding: 'utf8', timeout: 3000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, PSModulePath: join(systemPowerShell, 'Modules') } }, (error, stdout) => {
    if (error) reject(error);
    else {
      try {
        const rows = JSON.parse(stdout), processes = Array.isArray(rows) ? rows : [rows];
        if (!processes.length || !processes.every(row => integer(row?.ProcessId) && integer(row?.ParentProcessId) && typeof row?.Name === 'string'))
          throw Object.assign(Error(), { code: 'INVALID_PROCESS_ROWS' });
        resolve(processes);
      } catch (error) { reject(error); }
    }
  }));
}

async function childSnapshot(pid, state, queryProcesses) {
  const unavailable = (status, reason) => ({ summary: { status, ...(reason ? { reason } : {}) }, processIds: new Set([pid]) });
  if (state === 'exited' || state === 'not-running') return unavailable('parent-exited');
  if (state !== 'alive' || process.platform !== 'win32') return unavailable('unavailable');
  try {
    const rows = await queryProcesses();
    const processes = Array.isArray(rows) ? rows : [rows];
    return { summary: summarizeDescendants(processes, pid), processIds: descendantIds(processes, pid) };
  } catch (error) {
    const reason = error?.killed ? 'timeout' : error?.code === 'ENOENT' ? 'query-missing' :
      error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'output-limit' :
      error instanceof SyntaxError ? 'invalid-json' : error?.code === 'INVALID_PROCESS_ROWS' ? 'invalid-result' : 'query-failed';
    return unavailable('unavailable', reason);
  }
}

function startupSnapshot(file, launchStartedAt) {
  if (!file) return { status: 'unavailable' };
  if (!Number.isFinite(launchStartedAt) || launchStartedAt <= 0 || launchStartedAt > Date.now())
    return { status: 'no-current-run' };
  let fd;
  try {
    // Bound reads even when a malformed trace was supplied; never emit its text.
    fd = openSync(file, 'r');
    const buffer = Buffer.alloc(64 * 1024), length = readSync(fd, buffer, 0, buffer.length, 0);
    const sampledAt = Date.now(), phases = [];
    let pid;
    for (const line of buffer.subarray(0, length).toString('utf8').split('\n')) {
      try {
        const row = JSON.parse(line);
        if (!Number.isFinite(launchStartedAt) || row.at < launchStartedAt || row.at > sampledAt || !Number.isFinite(row.at) ||
          !integer(row.pid) || row.pid <= 0 || !integer(row.elapsedMs) || row.elapsedMs < 0 || !startupPhases.has(row.phase)) continue;
        if (!pid) { if (row.phase !== 'module-entry') continue; pid = row.pid; }
        if (row.pid === pid) phases.push({ phase: row.phase, elapsedMs: row.elapsedMs });
      } catch { /* Partial final write. */ }
    }
    return phases.length ? { status: 'ok', lastPhase: phases.at(-1).phase, phases } : { status: 'no-current-run' };
  } catch (error) { return { status: error.code === 'ENOENT' ? 'missing' : 'unavailable' }; }
  finally { if (fd !== undefined) try { closeSync(fd); } catch {} }
}

function stderrSnapshot(stderr) {
  return stderr.join('').split(/\r?\n/).filter(Boolean).slice(-12).map(line => {
    const match = /^(?:\w*Error: )?([A-Z][A-Z0-9_]+):/.exec(line.trim());
    if (match && Object.hasOwn(constants.errno, match[1])) return { kind: 'node-error', code: match[1] };
    if (/^\[weftmate\] ✗ /.test(line)) return { kind: 'startup-failure' };
    if (/^\[weftmate\] \[dsh:stderr\]/.test(line)) return { kind: 'dsh-stderr' };
    if (/^\[\d+:\d+:\d+\/.+:(?:ERROR|WARNING):/.test(line)) return { kind: 'chromium-diagnostic' };
    return { kind: 'unclassified' };
  });
}

/** Sample only after the unchanged firstWindow call fails, before host cleanup.
 * No Electron IPC: the main thread may be stalled. Publication is best effort. */
export async function waitForFirstWindow({ app, profile, launchStartedAt = NaN, traceFile, queryProcesses = queryWindowsProcesses,
  stderr = [], publish = message => console.error(message) }) {
  try { return await app.firstWindow(); }
  catch (error) {
    try {
      const child = app.process(), main = processSnapshot(child);
      // Capture the failed wait's stage before the optional 3s CIM query can
      // advance the startup we are trying to diagnose.
      const startup = startupSnapshot(traceFile, launchStartedAt);
      // Playwright's Windows launcher is cmd.exe. Match the host only inside
      // that live process tree; never fall back to an unrelated/stale log run.
      const children = await childSnapshot(child?.pid, main.state, queryProcesses);
      const hostLog = hostLogSnapshot(profile, children.processIds, launchStartedAt), stderrTail = stderrSnapshot(stderr);
      const snapshot = { process: main, hostLog, children: children.summary, stderrTail, startup };
      try { error.firstWindowDiagnostics = snapshot; } catch { /* Preserve frozen errors too. */ }
      try { Promise.resolve(publish(`First window failure: ${JSON.stringify(snapshot)}`)).catch(() => {}); } catch {}
    } catch { /* Observation must never replace the original failure. */ }
    throw error;
  }
}
