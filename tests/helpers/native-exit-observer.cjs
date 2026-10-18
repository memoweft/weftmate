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
    let lastChildExit = null, report = null, reportAvailable = false;
    const snapshot = (phase, refresh = false) => safely(() => {
      if (refresh) {
        const next = safely(() => projectReport(reportReader()));
        if (next) { report = next; reportAvailable = true; }
      }
      write(destination, JSON.stringify({ pid: process.pid, ppid: process.ppid, threadId,
        nodeVersion: process.version, platform: process.platform, arch: process.arch,
        phase, capturedAt: new Date().toISOString(), reportAvailable,
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
          snapshot('child-exit');
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
      snapshot('native-load', true);
      return result;
    };
    process.dlopen = observedDlopen;
    const beforeExit = () => snapshot('beforeExit', true);
    const exit = () => snapshot('exit', true);
    process.on('beforeExit', beforeExit); process.on('exit', exit);
    const timer = setInterval(() => snapshot('sample', true), 1000); timer.unref();
    snapshot('startup', true);
    return () => safely(() => {
      clearInterval(timer); events.unsubscribe(spawned);
      process.off('beforeExit', beforeExit); process.off('exit', exit);
      if (process.dlopen === observedDlopen) process.dlopen = dlopen;
    });
  });
}

module.exports = { installNativeExitObserver, projectReport };
if (process.env.WEFTMATE_NATIVE_EXIT_DIR) installNativeExitObserver({ directory: process.env.WEFTMATE_NATIVE_EXIT_DIR });
