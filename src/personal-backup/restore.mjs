import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, lstat, readFile, rename, rm, cp } from 'node:fs/promises';
import { verify, included, durableWrite, backupError } from './archive.mjs';
import { rehomeSessions } from './rehome.mjs';

const exists = file => lstat(file).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
async function move(source, target) {
  for (let attempt = 0; ; attempt++) {
    try { await rename(source, target); return; }
    catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 10) throw error;
      await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}
// Preserve credentials from THIS installation, never accept them from a portable archive.
async function preserveExcluded(source, target, relative = '') {
  for (const name of await readdir(source)) {
    const rel = relative ? `${relative}/${name}` : name, from = path.join(source, name), to = path.join(target, name);
    const info = await lstat(from);
    if (info.isSymbolicLink()) throw backupError('BACKUP_SYMLINK');
    if (!included(rel)) {
      if (!relative || /^dsh-home\/profiles\/(?:[^/]+\/)?node_modules(?:\/|$)/.test(rel) || /(?:-wal|-shm|\.tmp|\.log)$/.test(rel)) continue;
      await mkdir(path.dirname(to), { recursive: true }); await cp(from, to, { recursive: true });
    }
    else if (info.isDirectory()) { await mkdir(to, { recursive: true }); await preserveExcluded(from, to, rel); }
  }
}

export async function beginRestore({ root, control, file, validate = async () => {}, afterMove = async () => {} }) {
  root = path.resolve(root); control = path.resolve(control);
  await verify(file); // Refuse corruption before touching current data.
  const transaction = path.join(control, `restore-${randomUUID()}`), stage = path.join(transaction, 'new'), old = path.join(transaction, 'old');
  await mkdir(stage, { recursive: true, mode: 0o700 }); await mkdir(old);
  const journalFile = path.join(control, 'restore.json');
  try {
    const manifest = await verify(file, stage);
    await rehomeSessions(stage, root, manifest);
    // Keep this host's installation ID so its own cloud identity remains valid.
    const store = path.join(stage, 'personal-access', 'store.json');
    if (await exists(store)) {
      const next = JSON.parse(await readFile(store, 'utf8'));
      const current = await readFile(path.join(root, 'personal-access', 'store.json'), 'utf8').then(JSON.parse).catch(() => null);
      if (current?.hostId && next.hostId !== current.hostId) {
        const previousHost = next.hostId;
        next.hostId = current.hostId;
        for (const account of [next, ...Object.values(next.accounts ?? {})]) {
          for (const command of Object.values(account.commands ?? {})) {
            if (command.targetDeviceId === previousHost) command.targetDeviceId = current.hostId;
            if (command.payload?.targetDeviceId === previousHost) {
              command.payload.targetDeviceId = current.hostId;
              command.payloadHash = createHash('sha256').update(JSON.stringify(command.payload)).digest('hex');
            }
          }
        }
      }
      await durableWrite(store, next);
    }
    await preserveExcluded(root, stage);
    // Retain this installation's private keys, but bind freshly verified cloud
    // login to the restored owner rather than a now-absent target-profile ID.
    const identityFile = path.join(stage, 'personal-access/cloud-identity/identity.json');
    if (await exists(identityFile)) {
      const identity = JSON.parse(await readFile(identityFile, 'utf8'));
      const access = JSON.parse(await readFile(path.join(stage, 'personal-access/store.json'), 'utf8'));
      const owners = await readFile(path.join(stage, 'personal-access/backup-cloud-owners.json'), 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
      for (const [key, binding] of Object.entries(identity.bindings ?? {})) {
        const recovered = owners.find(row => row.issuer === binding.issuer && row.sub === binding.sub && access.accounts?.[row.ownerId]);
        if (recovered) {
          binding.ownerId = recovered.ownerId;
          if (identity.claims?.[binding.claimId]) identity.claims[binding.claimId].ownerId = recovered.ownerId;
        } else if (!access.accounts?.[binding.ownerId]) delete identity.bindings[key];
      }
      for (const field of ['devices', 'sessions', 'nonces', 'replays', 'pairings', 'outbox']) identity[field] = {};
      await durableWrite(identityFile, identity);
    }
    await validate(stage, manifest);
    const names = [...new Set([...(await readdir(root)), ...(await readdir(stage))])].filter(included);
    const journal = { version: 1, root, transaction, state: 'applying', rows: names.map(name => ({ name, hadOld: false, installed: false })) };
    await durableWrite(journalFile, journal);
    for (const row of journal.rows) {
      // Journal intent BEFORE each rename; recovery uses directory existence, including crashes between writes.
      row.hadOld = await exists(path.join(root, row.name)); await durableWrite(journalFile, journal);
      if (row.hadOld) await move(path.join(root, row.name), path.join(old, row.name));
      if (await exists(path.join(stage, row.name))) { row.installed = true; await durableWrite(journalFile, journal); await move(path.join(stage, row.name), path.join(root, row.name)); }
      await afterMove(row.name);
    }
    journal.state = 'awaiting-start'; await durableWrite(journalFile, journal);
    return journal;
  } catch (error) {
    if (await exists(journalFile)) await rollbackRestore({ root, control });
    else await rm(transaction, { recursive: true, force: true });
    throw error;
  }
}
export async function rollbackRestore({ root, control }) {
  root = path.resolve(root); control = path.resolve(control);
  const file = path.join(control, 'restore.json');
  if (!await exists(file)) return false;
  const journal = JSON.parse(await readFile(file, 'utf8'));
  if (path.resolve(journal.root) !== root || path.resolve(path.dirname(journal.transaction)) !== control ||
    journal.rows.some(row => !included(row.name) || path.basename(row.name) !== row.name)) throw backupError('BACKUP_CORRUPT');
  for (const row of [...journal.rows].reverse()) {
    const previous = path.join(journal.transaction, 'old', row.name), target = path.join(root, row.name);
    if (await exists(previous)) { await rm(target, { recursive: true, force: true }); await move(previous, target); }
    else if (!row.hadOld && row.installed) await rm(target, { recursive: true, force: true });
  }
  await rm(file); await rm(journal.transaction, { recursive: true, force: true }); return true;
}
export async function commitRestore({ root, control }) {
  root = path.resolve(root); control = path.resolve(control);
  const file = path.join(control, 'restore.json');
  if (!await exists(file)) return;
  const journal = JSON.parse(await readFile(file, 'utf8'));
  if (path.resolve(journal.root) !== root || path.resolve(path.dirname(journal.transaction)) !== control) throw backupError('BACKUP_CORRUPT');
  await rm(file); await rm(journal.transaction, { recursive: true, force: true });
}
