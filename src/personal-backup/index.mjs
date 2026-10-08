import path from 'node:path';
import { mkdir, readFile, lstat, cp, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { snapshot, verify, listBackups, prune, durableWrite, backupError } from './archive.mjs';
import { beginRestore, rollbackRestore, commitRestore } from './restore.mjs';
import { validateStore } from '../personal-access/store.mjs';

export async function createBackupManager({ root, isIdle, requestRestart, clock = Date.now, appVersion = '0', validate = async stage => {
  validateStore(JSON.parse(await readFile(path.join(stage, 'personal-access', 'store.json'), 'utf8')));
} }) {
  const control = path.join(root, 'personal-backup'); await mkdir(control, { recursive: true, mode: 0o700 });
  const configFile = path.join(control, 'settings.json'), pendingFile = path.join(control, 'pending.json'), statusFile = path.join(control, 'status.json');
  const read = async (file, fallback) => readFile(file, 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return fallback; throw error; });
  let settings = await read(configFile, { enabled: true, directory: path.join(path.dirname(root), 'Backups'), dailyDays: 7, weeklyCopies: 4 });
  let pending = await read(pendingFile, null), status = await read(statusFile, null), timer, busy = false;
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
  async function configure(input) {
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
    if (busy || pending) throw backupError('CONFLICT');
    if (!await isIdle()) throw backupError('SESSION_BUSY');
    busy = true;
    try {
      if (file) await verify(file);
      if (!await isIdle()) throw backupError('SESSION_BUSY');
      pending = { reason, file, requestedAt: new Date(clock()).toISOString() };
      await durableWrite(pendingFile, pending);
      status = { state: 'pending', reason }; await durableWrite(statusFile, status);
      requestRestart(); return { state: 'pending', restartsHost: true, requiresLogin: !!file };
    } finally { busy = false; }
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
    isPending: () => busy || pending !== null,
    configure, request, restore, importBackup, finishShutdown, checkDaily,
    async prepareAccountDeletion() {
      if (status?.state === 'succeeded' && status.backup?.reason === 'before-account-deletion' && !status.deletionPrepared) {
        await verify(path.join(settings.directory, status.backup.id));
        status.deletionPrepared = true; await durableWrite(statusFile, status); return { ready: true };
      }
      return { ready: false, ...await request('before-account-deletion') };
    },
    async view() { return { settings, status, backups: await listBackups(settings.directory), excludedCredentials: true, localUnencrypted: true }; },
    async started() {
      await commitRestore({ root, control });
      timer = setInterval(() => { void checkDaily().catch(() => {}); }, 60000); timer.unref();
    },
    async startupFailed() { clearInterval(timer); const restored = await rollbackRestore({ root, control }); if (restored) { status = { state: 'rolled-back', at: new Date(clock()).toISOString() }; await durableWrite(statusFile, status); } return restored; },
  };
}
