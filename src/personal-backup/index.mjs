import { createProfileWriteBarrier } from './write-barrier.mjs';
import path from 'node:path';
import { mkdir, readFile, lstat, cp, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { snapshot, verify, listBackups, prune, durableWrite, backupError } from './archive.mjs';
import { beginRestore, rollbackRestore, commitRestore } from './restore.mjs';
import { validateStore } from '../personal-access/store.mjs';

export async function createBackupManager({ root, isIdle, requestRestart, clock = Date.now, appVersion = '0', captureBoundary = work => work(), pauseTimeoutMs = 2000, validate = async stage => {
  validateStore(JSON.parse(await readFile(path.join(stage, 'personal-access', 'store.json'), 'utf8')));
} }) {
  const control = path.join(root, 'personal-backup'); await mkdir(control, { recursive: true, mode: 0o700 });
  const configFile = path.join(control, 'settings.json'), pendingFile = path.join(control, 'pending.json'), statusFile = path.join(control, 'status.json');
  const read = async (file, fallback) => readFile(file, 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return fallback; throw error; });
  let settings = await read(configFile, { enabled: true, directory: path.join(path.dirname(root), 'Backups'), dailyDays: 7, weeklyCopies: 4 });
  const writeBarrier = createProfileWriteBarrier(root);
  let pending = await read(pendingFile, null), status = await read(statusFile, null), timer, busy = false, stopping = false, activeCapture = null, operationDone = Promise.resolve(), finishOperation;
  // If a restore crashed mid-replacement or failed to launch, recover before any writer opens.
  const transaction = await read(path.join(control, 'restore.json'), null);
  if (transaction?.state === 'applying' || transaction?.state === 'starting') {
    await rollbackRestore({ root, control }); status = { state: 'rolled-back', at: new Date(clock()).toISOString() }; await durableWrite(statusFile, status);
  } else if (transaction?.state === 'awaiting-start') {
    transaction.state = 'starting'; await durableWrite(path.join(control, 'restore.json'), transaction);
  }
  const restoreRequestFile = path.join(control, 'restore-request.json'), restoreRequest = await read(restoreRequestFile, null);
  if (restoreRequest) {
    try {
      if (restoreRequest.attempted) throw backupError('BACKUP_INTERRUPTED');
      restoreRequest.attempted = true; await durableWrite(restoreRequestFile, restoreRequest);
      const restored = await beginRestore({ root, control, file: restoreRequest.file, validate });
      restored.state = 'starting'; await durableWrite(path.join(control, 'restore.json'), restored);
      status = { state: 'succeeded', restored: true, at: new Date(clock()).toISOString(), backup: restoreRequest.backup };
      await durableWrite(statusFile, status); await prune(settings.directory, settings, clock());
    } catch (error) { status = { state: 'failed', at: new Date(clock()).toISOString(), code: error.code ?? 'STORAGE_UNAVAILABLE' }; await durableWrite(statusFile, status); }
    finally { await rm(restoreRequestFile, { force: true }); }
  }
  const versionFile = path.join(control, 'version.json'), previousVersion = await read(versionFile, null);
  if (previousVersion && previousVersion.appVersion !== appVersion) {
    await snapshot({ root, directory: settings.directory, reason: 'before-upgrade', now: clock() });
  }
  await durableWrite(versionFile, { appVersion });
  let restoredStartup = status?.restored === true && transaction?.state === 'awaiting-start' || !!restoreRequest && status?.restored === true;
  async function onlineSnapshot(reason) {
    return snapshot({ root, directory: settings.directory, reason, now: clock(), withCapture: async (work, stage) => {
      const controller = new AbortController(), deadline = Date.now() + pauseTimeoutMs;
      activeCapture = controller;
      const timeout = backupError('BACKUP_PAUSE_TIMEOUT');
      const timer = setTimeout(() => controller.abort(timeout), pauseTimeoutMs);
      const check = () => {
        if (Date.now() >= deadline && !controller.signal.aborted) controller.abort(timeout);
        controller.signal.throwIfAborted();
      };
      try {
        check();
        const resume = await writeBarrier.pause(controller.signal);
        try {
          await captureBoundary(async () => {
            check(); if (!await isIdle()) throw backupError('SESSION_BUSY'); check(); await work(check); check();
          }, { signal: controller.signal, deadline, check, stage });
        } finally { resume(); }
      } finally { clearTimeout(timer); if (activeCapture === controller) activeCapture = null; }
    } });
  }
  async function configure(input) {
    if (busy || pending || stopping) throw backupError('CONFLICT');
    const next = { ...settings, ...input };
    if (Object.keys(input).some(key => !['enabled', 'directory', 'dailyDays', 'weeklyCopies'].includes(key)) ||
      typeof next.enabled !== 'boolean' || typeof next.directory !== 'string' || !path.isAbsolute(next.directory) ||
      [next.dailyDays, next.weeklyCopies].some(value => !Number.isSafeInteger(value) || value < 1) ||
      path.resolve(next.directory).toLowerCase() === path.resolve(root).toLowerCase() ||
      path.resolve(next.directory).toLowerCase().startsWith(path.resolve(root).toLowerCase() + path.sep)) throw backupError('INVALID_REQUEST');
    await mkdir(next.directory, { recursive: true, mode: 0o700 });
    await durableWrite(configFile, next); settings = next; return settings;
  }
  async function request(reason = 'manual', file = null) {
    if (busy || pending || stopping) throw backupError('CONFLICT');
    busy = true;
    operationDone = new Promise(resolve => { finishOperation = resolve; });
    try {
      if (!await isIdle()) throw backupError('SESSION_BUSY');
      if (file) await verify(file);
      if (!await isIdle()) throw backupError('SESSION_BUSY');
      if (file) {
        pending = { reason, file, requestedAt: new Date(clock()).toISOString() };
        await durableWrite(pendingFile, pending);
        status = { state: 'pending', reason }; await durableWrite(statusFile, status);
        requestRestart(); return { state: 'pending', restartsHost: true, requiresLogin: true };
      }
      status = { state: 'running', reason }; await durableWrite(statusFile, status);
      const result = await onlineSnapshot(reason);
      status = { state: 'succeeded', at: new Date(clock()).toISOString(), backup: result, appVersion };
      await durableWrite(statusFile, status);
      await prune(settings.directory, settings, clock());
      return { state: 'succeeded', restartsHost: false, requiresLogin: false, backup: result };
    } catch (error) {
      if (!file) {
        status = { state: error.code === 'BACKUP_PAUSE_TIMEOUT' || error.code === 'SESSION_BUSY' ? 'deferred' : 'failed', reason, code: error.code ?? 'STORAGE_UNAVAILABLE', at: new Date(clock()).toISOString() };
        await durableWrite(statusFile, status);
      }
      throw error;
    } finally { busy = false; finishOperation(); }
  }
  async function restore(id) {
    if (typeof id !== 'string' || path.basename(id) !== id || !id.endsWith('.wmb')) throw backupError('INVALID_REQUEST');
    return request('restore', path.join(settings.directory, id));
  }
  async function importBackup(file) {
    if (typeof file !== 'string' || !path.isAbsolute(file) || !(await lstat(file)).isFile()) throw backupError('INVALID_REQUEST');
    await verify(file); await mkdir(settings.directory, { recursive: true, mode: 0o700 });
    const id = `import-${randomUUID()}.wmb`, temp = path.join(settings.directory, `.${id}.tmp`);
    try { await cp(file, temp, { errorOnExist: true, force: false }); await verify(temp); await rename(temp, path.join(settings.directory, id)); }
    finally { await rm(temp, { force: true }); }
    return { id };
  }
  async function finishShutdown({ safe = true } = {}) {
    clearInterval(timer);
    writeBarrier.dispose();
    if (!pending) return false;
    const operation = pending;
    try {
      if (!safe) throw backupError('SERVICE_CLOSING');
      // Revalidate imported media immediately before producing the safety snapshot.
      if (operation.file) await verify(operation.file);
      const result = await snapshot({ root, directory: settings.directory, reason: operation.file ? 'before-restore' : operation.reason, now: clock() });
      // Replace data on the next cold start, after Electron releases every file
      // handle and before any host service or DSH child can open the profile.
      if (operation.file) await durableWrite(restoreRequestFile, { file: operation.file, backup: result });
      status = { state: operation.file ? 'pending' : 'succeeded', at: new Date(clock()).toISOString(), backup: result, restored: !!operation.file, appVersion };
      await durableWrite(statusFile, status);
      if (!operation.file) await prune(settings.directory, settings, clock());
    } catch (error) {
      status = { state: 'failed', at: new Date(clock()).toISOString(), code: error.code ?? 'STORAGE_UNAVAILABLE' };
      await durableWrite(statusFile, status);
    } finally { pending = null; await rm(pendingFile, { force: true }); }
    return true;
  }
  async function checkDaily() {
    if (!settings.enabled || busy || pending || !await isIdle()) return;
    const rows = (await listBackups(settings.directory)).filter(row => row.verification === 'valid');
    if (!rows.some(row => row.createdAt.slice(0, 10) === new Date(clock()).toISOString().slice(0, 10))) await request('daily');
  }
  return {
    // Only a restore stops HTTP admission; online copies queue writers briefly.
    isPending: () => pending !== null,
    isRestoredStartup: () => restoredStartup,
    configure, request, restore, importBackup, finishShutdown, checkDaily,
    async stopOnline() {
      stopping = true; clearInterval(timer);
      activeCapture?.abort(backupError('SERVICE_CLOSING'));
      await operationDone;
    },
    async prepareAccountDeletion() {
      await request('before-account-deletion');
      return { ready: true, restartsHost: false };
    },
    async view() { return { settings, status, backups: await listBackups(settings.directory), excludedCredentials: true, localUnencrypted: true }; },
    async started() {
      await commitRestore({ root, control }); restoredStartup = false;
      timer = setInterval(() => { void checkDaily().catch(() => {}); }, 60000); timer.unref();
    },
    async startupFailed() { clearInterval(timer); const restored = await rollbackRestore({ root, control }); if (restored) { status = { state: 'rolled-back', at: new Date(clock()).toISOString() }; await durableWrite(statusFile, status); } return restored; },
  };
}
