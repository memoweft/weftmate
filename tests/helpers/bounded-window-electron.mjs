import { execFile, spawn } from 'node:child_process';
import { appendFileSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { _electron } from 'playwright';
import { closeTestElectron } from './close-test-electron.mjs';

const cases = new WeakMap();
export function within(promise, milliseconds, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), milliseconds); })])
    .finally(() => clearTimeout(timer));
}
export async function stopWindowElectron(application) {
  if (!application) return;
  const state = cases.get(application); clearTimeout(state?.timer);
  const child = state?.child;
  if (!child) return;
  if (child.exitCode === null && child.signalCode === null) await new Promise(resolve => {
    if (process.platform === 'win32') execFile(join(process.env.SystemRoot, 'System32', 'taskkill.exe'),
      ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, () => { resolve(); });
    else { child.kill('SIGKILL'); resolve(); }
  });
}
export async function launchWindowElectron(options, logFile) {
  const application = await _electron.launch({ ...options, timeout: 15000 });
  const child = application.process();
  const log = value => { try { appendFileSync(logFile, value); } catch {} };
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('data', log);
    stream?.on('error', error => { if (error.code !== 'EPIPE') log(String(error)); });
  }
  child.stdin?.on('error', error => { if (error.code !== 'EPIPE') log(String(error)); });
  cases.set(application, { child, timer: setTimeout(() => { void stopWindowElectron(application); }, 30000) });
  return application;
}
export async function closeWindowElectron(application) {
  try { await within(closeTestElectron(application, async () => { await globalThis.windowBoundsDesktop.close(); }), 10000, 'WINDOW_TEST_CLOSE_TIMEOUT'); }
  finally { await stopWindowElectron(application); }
}

export async function launchWindowBoundsProcess(options, logFile) {
  const fd = openSync(logFile, 'w');
  const child = spawn(options.executablePath, options.args, { cwd: options.cwd, env: options.env,
    windowsHide: true, timeout: 15000, stdio: ['ignore', fd, fd, 'ipc'] });
  closeSync(fd);
  let counter = 0;
  const pending = new Map();
  const stop = async () => {
    clearTimeout(watchdog);
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise(resolve => execFile(join(process.env.SystemRoot, 'System32', 'taskkill.exe'),
      ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, () => resolve()));
  };
  const watchdog = setTimeout(() => { void stop(); }, 14000);
  const started = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.on('message', message => {
      if (message.started) resolve();
      else if (pending.has(message.id)) {
        const job = pending.get(message.id); pending.delete(message.id);
        if (message.error) job.reject(new Error(message.error)); else job.resolve(message.value);
      }
    });
  });
  child.on('error', () => {});
  child.on('exit', () => { for (const job of pending.values()) job.reject(new Error('WINDOW_TEST_PROCESS_EXITED')); pending.clear(); });
  try { await within(started, 10000, 'WINDOW_TEST_START_TIMEOUT'); }
  catch (error) { await stop(); throw error; }
  return { child, stop, request(command) {
    const id = ++counter;
    return within(new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.send({ id, command }, error => { if (error) { pending.delete(id); reject(error); } });
    }), 5000, 'WINDOW_TEST_COMMAND_TIMEOUT');
  } };
}
