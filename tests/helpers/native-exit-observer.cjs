// Opt-in preload for the CI runner AND its node:test file worker. Never log
// argv, environment, host identity, paths, JS stacks or report memory contents.
const fs = require('node:fs');
const path = require('node:path');
const { channel } = require('node:diagnostics_channel');
const { threadId } = require('node:worker_threads');

const safely = fn => { try { return fn(); } catch { return undefined; } };
const name = value => typeof value === 'string' ? path.win32.basename(path.posix.basename(value)) : null;

// A deliberately small projection, also used for fatal reports in the parent.
function projectReport(report) {
  return {
    nodeVersion: report?.header?.nodejsVersion ?? null,
    event: report?.header?.event ?? null,
    sharedObjects: Array.isArray(report?.sharedObjects) ? report.sharedObjects.map(name) : [],
    nativeStack: Array.isArray(report?.nativeStack) ? report.nativeStack.map(row => ({ pc: row.pc })) : [],
    resources: Array.isArray(report?.libuv) ? report.libuv.map(row => ({ type: row.type, is_active: row.is_active, is_referenced: row.is_referenced })) : [],
  };
}

function atomicWrite(file, contents) {
  fs.writeFileSync(file + '.next', contents);
  fs.renameSync(file + '.next', file);
}

function installNativeExitObserver({ directory, reportReader = () => process.report.getReport(), write = atomicWrite } = {}) {
  if (!directory) return;
  return safely(() => {
    const destination = path.join(directory, `native-${process.pid}-${threadId}.json`);
    const active = new Map();
    const modules = new Set([name(process.execPath), ...Object.keys(require.cache).filter(file => file.endsWith('.node')).map(name)]);
    let lastChildExit = null, report = null, reportAvailable = false, reportAttempted = false;
    const snapshot = (phase, failed = false) => safely(() => {
      // Full reports are synchronous and expensive. Never collect one for
      // startup, successful native loads, a normal exit or periodic sampling.
      if (failed && !reportAttempted) {
        reportAttempted = true;
        const next = safely(() => projectReport(reportReader()));
        if (next) { report = next; reportAvailable = true; }
      }
      write(destination, JSON.stringify({ pid: process.pid, ppid: process.ppid, threadId,
        nodeVersion: process.version, platform: process.platform, arch: process.arch,
        phase, capturedAt: new Date().toISOString(), reportAvailable, sharedObjects: [...modules],
        ...report, activeChildren: [...active.values()], lastChildExit }));
    });
    const spawned = ({ process: child }) => safely(() => {
      // The diagnostics channel fires in the constructor, before pid exists.
      child?.once('spawn', () => safely(() => {
        const row = { pid: child.pid, executable: name(child.spawnfile), spawnedAt: new Date().toISOString() };
        active.set(child.pid, row);
        snapshot('child-spawn');
        child.once('exit', (code, signal) => safely(() => {
          active.delete(row.pid); lastChildExit = { ...row, code, signal };
          snapshot('child-exit', code !== 0 || !!signal);
        }));
      }));
    });
    const events = channel('child_process');
    events.subscribe(spawned);
    // Preserve the original receiver, return value and exception even when the
    // report reader or writer fails. No async work, retry or waiting is added.
    const dlopen = process.dlopen;
    const observedDlopen = function (...args) {
      const result = Reflect.apply(dlopen, this, args);
      safely(() => modules.add(name(args[1])));
      snapshot('native-load');
      return result;
    };
    process.dlopen = observedDlopen;
    const beforeExit = code => { if (code) snapshot('beforeExit', true); };
    const exit = code => snapshot('exit', !!code);
    const uncaught = () => snapshot('uncaughtException', true);
    // Monitor preserves Node's original uncaught-exception behavior. Do not
    // install signal handlers: those would suppress default termination.
    process.on('uncaughtExceptionMonitor', uncaught);
    const abort = process.abort;
    const observedAbort = function (...args) {
      snapshot('abort', true);
      return Reflect.apply(abort, this, args);
    };
    process.abort = observedAbort;
    process.on('beforeExit', beforeExit); process.on('exit', exit);
    snapshot('startup');
    return () => safely(() => {
      events.unsubscribe(spawned);
      process.off('beforeExit', beforeExit); process.off('exit', exit);
      process.off('uncaughtExceptionMonitor', uncaught);
      if (process.abort === observedAbort) process.abort = abort;
      if (process.dlopen === observedDlopen) process.dlopen = dlopen;
    });
  });
}

module.exports = { installNativeExitObserver, projectReport };
if (process.env.WEFTMATE_NATIVE_EXIT_DIR) installNativeExitObserver({ directory: process.env.WEFTMATE_NATIVE_EXIT_DIR });
