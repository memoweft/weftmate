import path from 'node:path';
import { mkdir, readFile, readdir, lstat, cp, writeFile, rename } from 'node:fs/promises';
import { cloudScope, nativeHeader, readNativeSettings } from './cloud-snapshot.mjs';
import { routeForProfile } from '../harness-model-routes.ts';
import { sqliteWorkerLease } from './archive.mjs';

const read = file => readFile(file, 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
const error = code => Object.assign(new Error(code), { code, status: 409 });
const put = async (stage, relative, value) => { const file = path.join(stage, relative); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(value), { mode: 0o600 }); };
async function copy(source, target, profileRoot = null) {
  if(profileRoot && sqliteWorkerLease(path.relative(profileRoot,source).replaceAll('\\','/')))return;
  const info = await lstat(source).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!info) return;
  if (info.isSymbolicLink()) throw error('BACKUP_SYMLINK');
  if (info.isDirectory()) {
    await mkdir(target, { recursive: true });
    for (const name of await readdir(source)) await copy(path.join(source, name), path.join(target, name), profileRoot);
  } else if (info.isFile()) { await mkdir(path.dirname(target), { recursive: true }); await cp(source, target, { force: false, errorOnExist: false }); }
}
async function nativeFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; }), files = [];
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw error('BACKUP_SYMLINK');
    if (entry.isDirectory()) files.push(...await nativeFiles(file));
    else if (entry.isFile() && /\.jsonl(?:\.zstd)?$/.test(entry.name)) files.push(file);
  }
  return files;
}

/** Cloud restore replaces one verified cloud identity, retaining local files and other users. */
export async function preserveCloudTarget({ root, stage, manifest, next }) {
  if (!manifest.cloud) return next;
  const sourceOwner = manifest.cloud.ownerId, sourceAccount = next.accounts?.[sourceOwner];
  if (!sourceAccount || Object.keys(next.accounts).length !== 1) throw error('BACKUP_CORRUPT');
  const current = await read(path.join(root, 'personal-access/store.json'));
  const identity = await read(path.join(root, 'personal-access/cloud-identity/identity.json'));
  const owners = await read(path.join(stage, 'personal-access/backup-cloud-owners.json')) ?? [];
  const binding = Object.values(identity?.bindings ?? {}).find(row => row.status === 'active' && owners.some(owner => owner.ownerId === sourceOwner && owner.issuer === row.issuer && owner.sub === row.sub));
  const replacedOwner = binding?.ownerId ?? (current?.accounts?.[sourceOwner] ? sourceOwner : null);
  if (replacedOwner !== sourceOwner && current?.accounts?.[sourceOwner]) throw error('BACKUP_CORRUPT');
  const preserved = Object.fromEntries(Object.entries(current?.accounts ?? {}).filter(([id]) => id !== replacedOwner));
  const preservedSessions = new Set(Object.values(preserved).flatMap(account => Object.keys(account.sessions ?? {})));
  const replacedScope = replacedOwner && current?.accounts?.[replacedOwner] ? await cloudScope(root, replacedOwner) : null;
  const replacedModels = replacedScope?.modelIds ?? new Set();
  next.accounts = { ...preserved, [sourceOwner]: sourceAccount };
  next.legacyOwnerId = current?.legacyOwnerId && Object.hasOwn(preserved, current.legacyOwnerId) ? current.legacyOwnerId : sourceOwner;
  if (next.legacyOwnerId !== sourceOwner) {
    const source = path.join(stage, 'personal-access/sync/events.json');
    if (await lstat(source).catch(cause => { if (cause.code === 'ENOENT') return null; throw cause; })) {
      const target = path.join(stage, 'personal-access/accounts', sourceOwner, 'sync/events.json'); await mkdir(path.dirname(target), { recursive: true }); await rename(source, target);
    }
  }
  if (current?.executionOwnerId) next.executionOwnerId = current.executionOwnerId === replacedOwner ? sourceOwner : current.executionOwnerId;
  next.sharedModelProfiles = [...new Map([...(current?.sharedModelProfiles ?? []).filter(row => !replacedModels.has(row.id)), ...(next.sharedModelProfiles ?? [])].map(row => [row.id, row])).values()];
  // Originals were never part of the cloud package; leave them on this computer.
  for (const relative of ['workspace', 'desktop-artifacts', 'conversations', 'personal-access/artifacts', 'personal-access/sync/attachments', 'personal-access/sync/shared-attachments']) await copy(path.join(root, relative), path.join(stage, relative));
  for (const id of Object.keys(current?.accounts ?? {})) {
    if (Object.hasOwn(preserved, id)) await copy(path.join(root, 'personal-access/accounts', id), path.join(stage, 'personal-access/accounts', id), root);
    else for (const kind of ['attachments', 'shared-attachments']) await copy(path.join(root, 'personal-access/accounts', id, 'sync', kind), path.join(stage, 'personal-access/accounts', id, 'sync', kind));
  }
  for (const name of ['usage.json', 'connectors.json']) {
    const before = await read(path.join(root, 'personal-access', name)), restored = await read(path.join(stage, 'personal-access', name));
    if (before || restored) await put(stage, `personal-access/${name}`, { ...(before ?? restored), accounts: { ...Object.fromEntries(Object.entries(before?.accounts ?? {}).filter(([id]) => Object.hasOwn(preserved, id))), ...(restored?.accounts ?? {}) } });
  }
  if (current?.legacyOwnerId && Object.hasOwn(preserved, current.legacyOwnerId)) await copy(path.join(root, 'personal-access/sync/events.json'), path.join(stage, 'personal-access/sync/events.json'));
  const beforeSettings = await read(path.join(root, 'weftmate-settings.json')), restoredSettings = await read(path.join(stage, 'weftmate-settings.json'));
  if (beforeSettings || restoredSettings) {
    const profiles = [...new Map([...(beforeSettings?.models?.profiles ?? []).filter(row => !replacedModels.has(row.id)), ...(restoredSettings?.models?.profiles ?? [])].map(row => [row.id, row])).values()];
    await put(stage, 'weftmate-settings.json', { ...(beforeSettings ?? {}), ...(restoredSettings ?? {}),
      models: { profiles, activeId: restoredSettings?.models?.activeId ?? beforeSettings?.models?.activeId ?? null },
      sessionBindings: { ...Object.fromEntries(Object.entries(beforeSettings?.sessionBindings ?? {}).filter(([id]) => preservedSessions.has(id))), ...(restoredSettings?.sessionBindings ?? {}) } });
  }
  const beforeNative = await readNativeSettings(root), restoredNative = await readNativeSettings(stage);
  if (beforeNative || restoredNative) {
    const replacedProviders = new Set([...replacedModels].map(id => routeForProfile(id).provider));
    await put(stage, 'dsh-home/settings.yaml', { ...(beforeNative ?? {}), ...(restoredNative ?? {}), 'llm-pi-ai': { ...(beforeNative?.['llm-pi-ai'] ?? {}), ...(restoredNative?.['llm-pi-ai'] ?? {}), providers: { ...Object.fromEntries(Object.entries(beforeNative?.['llm-pi-ai']?.providers ?? {}).filter(([id]) => !replacedProviders.has(id))), ...(restoredNative?.['llm-pi-ai']?.providers ?? {}) } } });
  }
  const retainedLogs = [];
  for (const file of await nativeFiles(path.join(root, 'dsh-home/sessions'))) {
    try { retainedLogs.push({ file, ...(await nativeHeader(file)) }); }
    catch { if (file.split(path.sep).some(id => preservedSessions.has(id))) throw error('BACKUP_CORRUPT'); }
  }
  let changed;
  do { changed = false; for (const { header } of retainedLogs) if (preservedSessions.has(header.parentSession) && !preservedSessions.has(header.id)) { preservedSessions.add(header.id); changed = true; } } while (changed);
  for (const { file, header } of retainedLogs) if (preservedSessions.has(header.id)) await copy(file, path.join(stage, path.relative(root, file)));
  const beforeSchedules = await read(path.join(root, 'dsh-home/personal-schedules.json')), restoredSchedules = await read(path.join(stage, 'dsh-home/personal-schedules.json'));
  if (beforeSchedules || restoredSchedules) await put(stage, 'dsh-home/personal-schedules.json', { ...(beforeSchedules ?? restoredSchedules), sessions: { ...Object.fromEntries(Object.entries(beforeSchedules?.sessions ?? {}).filter(([id]) => preservedSessions.has(id))), ...(restoredSchedules?.sessions ?? {}) } });
  const beforeGoals = await read(path.join(root, 'dsh-home/personal-goal-requests.json')), restoredGoals = await read(path.join(stage, 'dsh-home/personal-goal-requests.json'));
  if (beforeGoals || restoredGoals) await put(stage, 'dsh-home/personal-goal-requests.json', { ...Object.fromEntries(Object.entries(beforeGoals ?? {}).filter(([id]) => [...preservedSessions].some(session => id.startsWith(`${session}:`)))), ...(restoredGoals ?? {}) });
  return next;
}
