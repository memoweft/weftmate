import path from 'node:path';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { copySnapshotTree } from '../runtime/dsh-adapter/snapshot-files.mjs';
import { mkdir, readdir, lstat, readFile, writeFile, open, rename, rm, cp } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createGzip, createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { durableWrite } from '../personal-access/store.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
export const backupError = code => Object.assign(new Error(code), { code, status: 409 });
// Browser sessions/cache and all host-managed credential locations are deliberately absent.
const omitted = new Set(['cloud-identity', 'personal-backup', 'Backups', 'Cache', 'Code Cache',
  'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Network', 'Session Storage', 'Local Storage',
  'IndexedDB', 'Service Worker', 'Partitions', 'Crashpad', 'blob_storage', 'SingletonLock',
  'SingletonCookie', 'SingletonSocket', 'Local State', 'Preferences', 'DevTools Extensions', 'DevToolsActivePort']);
export function included(relative) {
  const parts = relative.split('/');
  if (omitted.has(parts[0]) || relative === 'lockfile' || /^personal-access\/(?:cloud-identity|relay|relay-tls)(?:\/|$)/.test(relative)) return false;
  if (/^dsh-home\/profiles\/(?:[^/]+\/)?node_modules(?:\/|$)/.test(relative)) return false;
  if (/\.(?:sqlite3?|db)-(?:wal|shm)$/.test(relative)) return false;
  const userContent = ['conversations', 'workspace', 'desktop-artifacts'].includes(parts[0]) || relative.startsWith('personal-access/artifacts/');
  if (userContent) return true;
  return !parts.some(part => /(?:^\.env(?:\.|$)|credentials?|vault|\.enc$|\.pem$|\.key$|\.p12$|\.pfx$|(?:^|[-_.])tokens?(?:[-_.]|$))/i.test(part)) &&
    !/(?:\.(?:sqlite3?|db)-(?:wal|shm)|\.tmp)$/.test(relative) && !relative.endsWith('weftmate-host-state.json') && !relative.endsWith('weftmate-crash.log');
}
function safePath(name) {
  return typeof name === 'string' && name.length > 0 && !name.includes('\\') && !name.includes(':') &&
    !name.includes('\0') && !name.startsWith('/') && name.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part)) && included(name);
}
async function files(root, relative = '') {
  const rows = [];
  for (const name of (await readdir(path.join(root, relative))).sort()) {
    const rel = relative ? `${relative}/${name}` : name;
    if (!included(rel)) continue;
    const info = await lstat(path.join(root, rel));
    if (info.isSymbolicLink()) throw backupError('BACKUP_SYMLINK');
    if (info.isDirectory()) rows.push(...await files(root, rel));
    else if (info.isFile()) rows.push(rel);
  }
  return rows;
}
async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export function scrubStore(document) {
  const next = structuredClone(document);
  for (const state of [next, ...Object.values(next.accounts ?? {})]) {
    for (const device of Object.values(state.devices ?? {})) {
      // Commands reference device IDs. Keep revoked metadata while replacing
      // session credential hashes with fresh, unusable values.
      device.tokenHash = sha(randomUUID()); device.csrfHash = sha(randomUUID()); device.revoked = true;
      device.revokedAt = new Date().toISOString();
      for (const key of ['token', 'csrfToken', 'privateKey', 'privateJwk', 'refreshToken', 'accessToken']) delete device[key];
    }
    if ('setupGrant' in state) state.setupGrant = null;
    if ('authLimits' in state) state.authLimits = { failures: 0, lastFailureAt: 0, lockUntil: 0 };
  }
  return next;
}
// SQLite's online backup API includes committed WAL transactions; never copy live database pages.
export async function sqliteSnapshot(source, destination, check = () => {}) {
  const { DatabaseSync, backup } = await import('node:sqlite');
  const db = new DatabaseSync(source, { readOnly: true });
  try { await backup(db, destination, { rate: 100, progress: () => check() }); check(); } finally { db.close(); }
}
export async function snapshot({ root, directory, reason = 'manual', now = Date.now(), databaseBackup = sqliteSnapshot, withCapture = work => work(() => {}) }) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const id = `${new Date(now).toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.wmb`;
  const stage = path.join(directory, `.${id}.stage`), temporary = path.join(directory, `.${id}.tmp`);
  await mkdir(stage, { mode: 0o700 });
  try {
    const manifest = { format: 'weftmate-local-backup', version: 1, sourceRoot: root, createdAt: new Date(now).toISOString(), reason,
      excluded: ['model keys', 'cloud tokens and identity keys', 'device sessions and private keys', 'browser sessions/cache'], files: [] };
    // Capture ordinary files in the main event loop while atomic writers and
    // native DSH admission are paused. Copy bytes, never hard-link mutable logs.
    // Check the deadline between bounded chunks, including directory traversal.
    await withCapture(async check => {
      const databases = [];
      copySnapshotTree(root, stage, { check, included: name => included(name) &&
        // Native logs were captured in their writer's event loop, immediately
        // after flush. Do not read them a second time from this process.
        !(name === 'dsh-home/sessions' && existsSync(path.join(stage, name))),
        database: (source, target) => databases.push([source, target]) });
      // The ownership map is scrubbed before releasing the capture boundary.
      const identity = await readFile(path.join(root, 'personal-access/cloud-identity/identity.json'), 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (identity) {
        const target = path.join(stage, 'personal-access/backup-cloud-owners.json');
        const owners = Object.values(identity.bindings ?? {}).filter(row => row.desktop === true && row.status === 'active')
          .map(({ issuer, sub, ownerId }) => ({ issuer, sub, ownerId }));
        await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, JSON.stringify(owners), { mode: 0o600 });
      }
      for (const [source, target] of databases) { check(); await databaseBackup(source, target, check); }
      check();
    }, stage);
    // Hashing, sanitizing captured bytes and compression never hold the write pause.
    for (const name of await files(stage)) {
      const target = path.join(stage, name);
      if (name === 'personal-access/store.json') await writeFile(target, JSON.stringify(scrubStore(JSON.parse(await readFile(target, 'utf8')))), { mode: 0o600 });
      manifest.files.push({ path: name, size: (await lstat(target)).size, sha256: await fileHash(target) });
    }
    const header = JSON.stringify(manifest);
    async function* content() {
      yield Buffer.from(`WMB1 ${sha(header)}\n${header}\n`);
      for (const row of manifest.files) yield* createReadStream(path.join(stage, row.path));
    }
    await pipeline(Readable.from(content()), createGzip(), createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    const handle = await open(temporary, 'r+');
    try { await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, path.join(directory, id));
    return { id, createdAt: manifest.createdAt, reason, size: (await lstat(path.join(directory, id))).size, verification: 'valid' };
  } finally { await rm(stage, { recursive: true, force: true }); await rm(temporary, { force: true }); }
}

/** Stream validation/extraction. No archive path is trusted; all bytes and the manifest are hashed. */
export async function verify(file, destination = null) {
  const input = createReadStream(file), unzip = createGunzip();
  input.on('error', error => unzip.destroy(error)); input.pipe(unzip);
  const iterator = unzip[Symbol.asyncIterator](); let buffer = Buffer.alloc(0), ended = false;
  async function more() { const item = await iterator.next(); ended = item.done; if (!ended) buffer = Buffer.concat([buffer, item.value]); }
  async function line() {
    while (!buffer.includes(10) && !ended) await more();
    const end = buffer.indexOf(10); if (end < 0) throw backupError('BACKUP_CORRUPT');
    const value = buffer.subarray(0, end).toString('utf8'); buffer = buffer.subarray(end + 1); return value;
  }
  try {
    const signature = await line(), header = await line();
    if (signature !== `WMB1 ${sha(header)}`) throw backupError('BACKUP_CORRUPT');
    const manifest = JSON.parse(header), names = new Set();
    if (manifest.format !== 'weftmate-local-backup' || manifest.version !== 1 || !Array.isArray(manifest.files) ||
      !Number.isFinite(Date.parse(manifest.createdAt))) throw backupError('BACKUP_CORRUPT');
    for (const row of manifest.files) {
      const canonical = row.path?.toLowerCase();
      if (!safePath(row.path) || names.has(canonical) || !Number.isSafeInteger(row.size) || row.size < 0 ||
        !/^[a-f0-9]{64}$/.test(row.sha256)) throw backupError('BACKUP_CORRUPT');
      names.add(canonical); const hash = createHash('sha256'); let remaining = row.size, handle;
      try {
        if (destination) { const target = path.join(destination, row.path); await mkdir(path.dirname(target), { recursive: true }); handle = await open(target, 'wx', 0o600); }
        while (remaining > 0) {
          if (!buffer.length && !ended) await more();
          if (!buffer.length) throw backupError('BACKUP_CORRUPT');
          const chunk = buffer.subarray(0, Math.min(remaining, buffer.length)); buffer = buffer.subarray(chunk.length);
          hash.update(chunk); if (handle) await handle.writeFile(chunk); remaining -= chunk.length;
        }
        if (hash.digest('hex') !== row.sha256) throw backupError('BACKUP_CORRUPT');
        if (handle) await handle.sync();
      } finally { await handle?.close(); }
    }
    if (!ended) await more();
    if (buffer.length || !ended) throw backupError('BACKUP_CORRUPT');
    return manifest;
  } catch (error) { if (error.code === 'ENOENT') throw error; throw backupError('BACKUP_CORRUPT'); }
  finally { input.destroy(); unzip.destroy(); }
}

export function retainedBackups(rows, { dailyDays = 7, weeklyCopies = 4 } = {}, now = Date.now()) {
  const keep = new Set(), weeks = new Set();
  for (const row of [...rows].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))) {
    const at = Date.parse(row.createdAt);
    if (now - at < dailyDays * 86400000) keep.add(row.id);
    // Calendar weeks anchored on Monday UTC, independent of machine locale.
    const week = Math.floor((at - 4 * 86400000) / (7 * 86400000));
    if (!weeks.has(week) && weeks.size < weeklyCopies) { weeks.add(week); keep.add(row.id); }
  }
  if (rows.length) keep.add([...rows].sort((a,b) => Date.parse(b.createdAt)-Date.parse(a.createdAt))[0].id);
  return keep;
}
export async function listBackups(directory) {
  const rows = [];
  for (const id of await readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
    if (!id.endsWith('.wmb')) continue;
    const file = path.join(directory, id), info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) continue;
    try { const manifest = await verify(file); rows.push({ id, createdAt: manifest.createdAt, reason: manifest.reason, size: info.size, verification: 'valid' }); }
    catch { rows.push({ id, createdAt: info.mtime.toISOString(), size: info.size, verification: 'invalid' }); }
  }
  return rows.sort((a,b) => Date.parse(b.createdAt)-Date.parse(a.createdAt));
}
export async function prune(directory, settings, now) {
  const rows = (await listBackups(directory)).filter(row => row.verification === 'valid'), keep = retainedBackups(rows, settings, now);
  for (const row of rows) if (!keep.has(row.id)) await rm(path.join(directory, row.id));
}
export { durableWrite };
