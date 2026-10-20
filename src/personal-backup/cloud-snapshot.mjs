import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, readdir, lstat, rm, mkdir, rename } from 'node:fs/promises';
import { readNativeHeader } from './native-header.mjs';
import { createRequire } from 'node:module';
import { routeForProfile } from '../harness-model-routes.ts';
import { officialCredentialRef } from '../dsh-settings-migration.ts';
import { hasPrivateContent } from '../personal-access/temporary-chats.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const error = code => Object.assign(new Error(code), { code, status: 409 });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const segment = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const put = (stage, name, value) => writeFile(path.join(stage, name), JSON.stringify(value), { mode: 0o600 });
const read = (stage, name) => readFile(path.join(stage, name), 'utf8').then(JSON.parse).catch(cause => { if (cause.code === 'ENOENT') return null; throw cause; });
export function createNativeSettingsReader({ requireModule = createRequire, resourcesPath = process.resourcesPath } = {}) {
  let nativeSettingsParser;
  return async function readNativeSettings(root) {
    const text = await readFile(path.join(root, 'dsh-home/settings.yaml'), 'utf8').catch(cause => { if (cause.code === 'ENOENT') return null; throw cause; });
    if (text === null) return null;
    // Use the pinned DSH provider's own YAML parser. No second YAML dialect and
    // no unscoped namespace copying; JSON output is accepted by this parser too.
    if (!nativeSettingsParser) {
      const locations = [
        [path.join(root, 'dsh-home/profiles/node_modules/@deepseek-ai/dsh-settings-file/package.json'), 'yaml'],
        [import.meta.url, '../../vendor/dsh-runtime/node_modules/yaml'],
      ];
      if (typeof resourcesPath === 'string' && resourcesPath.length) locations.push([path.join(resourcesPath, 'dsh-runtime/package.json'), 'yaml']);
      for (const [anchor, module] of locations) {
        try { nativeSettingsParser = requireModule(anchor)(module); break; }
        catch { /* Try the next existing runtime location. */ }
      }
      if (!nativeSettingsParser) throw error('RUNTIME_UNAVAILABLE');
    }
    const document = nativeSettingsParser.parseDocument(text);
    if (document.errors.length) throw error('BACKUP_CORRUPT');
    const value = document.toJS() ?? {};
    if (!object(value)) throw error('BACKUP_CORRUPT');
    return value;
  };
}
export const readNativeSettings = createNativeSettingsReader();

/** Resolve account ownership while the same BK-1 write/capture fence is held. */
export async function cloudScope(root, ownerId, { nativeSettingsReader = readNativeSettings } = {}) {
  if (!path.isAbsolute(root) || !segment(ownerId)) throw error('INVALID_REQUEST');
  if ((await lstat(root)).isSymbolicLink()) throw error('BACKUP_SYMLINK');
  const store = await read(root, 'personal-access/store.json');
  if (!object(store?.accounts) || !Object.hasOwn(store.accounts, ownerId)) throw error('ACCOUNT_LOGIN_REQUIRED');
  const account = structuredClone(store.accounts[ownerId]);
  const privateSessions = new Set(Object.entries(account.sessions ?? {}).filter(([, row]) => hasPrivateContent(row)).map(([id]) => id));
  const sessions = new Set(Object.keys(account.sessions ?? {}).filter(id => !privateSessions.has(id)));
  const chats = new Set(sessions);
  for (const [id, row] of Object.entries(account.sessions ?? {})) if (!privateSessions.has(id) && segment(row.workspaceChatId)) chats.add(row.workspaceChatId);
  const privateChats = new Set(Object.values(account.chatIdentity?.segments ?? {}).filter(row => privateSessions.has(row.sessionId)).map(row => row.chatId));
  for (const id of Object.keys(account.chatIdentity?.chats ?? {})) if (segment(id) && !privateChats.has(id)) chats.add(id);
  const modelIds = new Set();
  for (const record of Object.values(account.accountModels ?? {})) for (const row of Object.values(record.revisions ?? {})) if (typeof row.profileId === 'string') modelIds.add(row.profileId);
  for (const row of Object.values(account.sessions ?? {})) if (typeof row.modelProfileId === 'string') modelIds.add(row.modelProfileId);
  for (const field of ['defaultModelProfileId', 'backgroundModelProfileId', 'lastChatModelProfileId']) if (typeof account[field] === 'string') modelIds.add(account[field]);
  const settings = await read(root, 'weftmate-settings.json');
  // The execution owner is the authority for legacy global model routes.
  // Other accounts' hashed private-model routes always need an account record.
  if ((store.executionOwnerId ?? store.legacyOwnerId) === ownerId) for (const row of settings?.models?.profiles ?? []) if (typeof row.id === 'string' && !row.id.startsWith('private-model-')) modelIds.add(row.id);
  // A durable binding proves the route used by this account's native session.
  for (const [id, row] of Object.entries(settings?.sessionBindings ?? {})) if (sessions.has(id) && typeof row.profileId === 'string') modelIds.add(row.profileId);
  const connectors = await read(root, 'personal-access/connectors.json');
  const connectorRows = Object.values(connectors?.accounts?.[ownerId] ?? {}).map(row => ({ id: row.id, slots: [...(row.slots ?? [])] }));
  const nativeSettings = await nativeSettingsReader(root), providerIds = new Set([...modelIds].map(id => routeForProfile(id).provider));
  const providers = Object.fromEntries(Object.entries(nativeSettings?.['llm-pi-ai']?.providers ?? {}).filter(([id]) => providerIds.has(id)));
  const metadata = { ownerId, modelProfileIds: [...modelIds].sort(),
    modelCredentialRefs: [...modelIds].sort().map(profileId => {
      const provider = routeForProfile(profileId).provider;
      return { profileId, provider, credentialRef: providers[provider]?.apiKeyEnv ?? officialCredentialRef(provider) };
    }), connectors: connectorRows.sort((a, b) => a.id.localeCompare(b.id)) };
  const ownerHash = digest(ownerId);
  const allowed = relative => {
    const parts = relative.split('/');
    if (parts[0] === 'personal-access') {
      if (parts.length === 1) return true;
      if (['store.json', 'usage.json', 'connectors.json', 'backup-cloud-owners.json'].includes(parts[1])) return parts.length === 2;
      if (parts[1] === 'accounts') {
        if (parts.length === 2) return true;
        if (parts[2] !== ownerId) return false;
        if (parts.length === 3) return true;
        if (parts[3] === 'sync') return parts.length === 4 || parts.length === 5 && parts[4] === 'events.json';
        return ['memory-home', 'health', 'data-erased.json'].includes(parts[3]);
      }
      return parts[1] === 'sync' && store.legacyOwnerId === ownerId && (parts.length === 2 || parts.length === 3 && parts[2] === 'events.json');
    }
    if (parts[0] === 'dsh-home') {
      if (parts.length === 1) return true;
      if (parts[1] === 'sessions') return !parts.some(part => /^(?:session_projcache|weftmate-history\.sqlite|attachments?|artifacts?)$/i.test(part));
      return parts.length === 2 && ['personal-schedules.json', 'personal-goal-requests.json', 'settings.yaml', 'weftmate-stage2-official-routes-migration.json'].includes(parts[1]);
    }
    if (parts[0] === 'conversations') {
      if (parts.length === 1) return true;
      if (parts[1] === ownerHash) return parts.length === 2 || chats.has(parts[2]) && (parts.length === 3 || parts.length === 4 && ['经验.md', 'experience.md'].includes(parts[3]));
      // Pre-account releases used a session-only working directory.
      return sessions.has(parts[1]) && (parts.length === 2 || parts.length === 3 && ['经验.md', 'experience.md'].includes(parts[2]));
    }
    return relative === 'weftmate-settings.json';
  };
  return { root, ownerId, store, account, sessions, modelIds, nativeSettings, providers, providerIds, metadata, allowed };
}

async function paths(stage, relative = '') {
  const names = [];
  for (const name of (await readdir(path.join(stage, relative))).sort()) {
    const rel = relative ? `${relative}/${name}` : name, info = await lstat(path.join(stage, rel));
    if (info.isSymbolicLink()) throw error('BACKUP_SYMLINK');
    if (info.isDirectory()) names.push(...await paths(stage, rel));
    else if (info.isFile()) names.push(rel);
  }
  return names;
}
export const nativeHeader = file => readNativeHeader(file, { maxBytes: 1024 * 1024 });

/** Remove everything that cannot be attributed to the selected account. */
export async function filterCloudStage(stage, scope) {
  const { ownerId, store, account, sessions, modelIds } = scope;
  const owned = new Set(sessions), native = [];
  for (const name of await paths(stage)) if (name.startsWith('dsh-home/sessions/')) {
    if (!/\.jsonl(?:\.zstd)?$/.test(name)) { await rm(path.join(stage, name)); continue; }
    try { native.push({ name, ...(await nativeHeader(path.join(stage, name))) }); }
    catch (cause) {
      if (name.split('/').some(part => sessions.has(part))) throw error('BACKUP_CORRUPT');
      await rm(path.join(stage, name));
    }
  }
  let changed;
  do {
    changed = false;
    for (const { header } of native) if (segment(header.id) && owned.has(header.parentSession) && !owned.has(header.id)) { owned.add(header.id); changed = true; }
  } while (changed);
  for (const { name, header } of native) if (header.type !== 'session' || !owned.has(header.id)) await rm(path.join(stage, name));
  const filtered = {
    version: store.version, hostId: store.hostId, legacyOwnerId: ownerId,
    unknownAuthLimits: { failures: 0, lastFailureAt: 0, lockUntil: 0 },
    sharedModelProfiles: (store.sharedModelProfiles ?? []).filter(row => modelIds.has(row.id)),
    accounts: { [ownerId]: account },
  };
  if (store.executionOwnerId === ownerId) filtered.executionOwnerId = ownerId;
  if (store.onboarding && (!store.onboarding.ownerId || store.onboarding.ownerId === ownerId)) filtered.onboarding = structuredClone(store.onboarding);
  await put(stage, 'personal-access/store.json', filtered);
  for (const name of ['personal-access/usage.json', 'personal-access/connectors.json']) {
    const data = await read(stage, name);
    if (data) { data.accounts = Object.hasOwn(data.accounts ?? {}, ownerId) ? { [ownerId]: data.accounts[ownerId] } : {}; await put(stage, name, data); }
  }
  const settings = await read(stage, 'weftmate-settings.json');
  if (settings) {
    settings.models = { profiles: (settings.models?.profiles ?? []).filter(row => modelIds.has(row.id)), activeId: modelIds.has(settings.models?.activeId) ? settings.models.activeId : null };
    settings.sessionBindings = Object.fromEntries(Object.entries(settings.sessionBindings ?? {}).filter(([id]) => sessions.has(id)));
    if (!modelIds.has(settings.legacyCompatibilityProfileId)) settings.legacyCompatibilityProfileId = null;
    await put(stage, 'weftmate-settings.json', settings);
  }
  if (scope.nativeSettings) {
    await put(stage, 'dsh-home/settings.yaml', { 'llm-pi-ai': { providers: scope.providers } });
    const marker = await read(stage, 'dsh-home/weftmate-stage2-official-routes-migration.json');
    if (marker?.schemaVersion === 1 && marker.authority === 'official-dsh-user-settings' && Array.isArray(marker.routes)) {
      // Retain an empty marker too: intentional official Models deletions must
      // not resurrect stale compatibility profiles during restore startup.
      marker.routes = marker.routes.filter(id => scope.providerIds.has(id));
      await put(stage, 'dsh-home/weftmate-stage2-official-routes-migration.json', marker);
    } else await rm(path.join(stage, 'dsh-home/weftmate-stage2-official-routes-migration.json'), { force: true });
  } else await rm(path.join(stage, 'dsh-home/weftmate-stage2-official-routes-migration.json'), { force: true });
  const schedules = await read(stage, 'dsh-home/personal-schedules.json');
  if (schedules) { schedules.sessions = Object.fromEntries(Object.entries(schedules.sessions ?? {}).filter(([id]) => owned.has(id))); await put(stage, 'dsh-home/personal-schedules.json', schedules); }
  const goals = await read(stage, 'dsh-home/personal-goal-requests.json');
  if (goals) await put(stage, 'dsh-home/personal-goal-requests.json', Object.fromEntries(Object.entries(goals).filter(([id]) => [...owned].some(sessionId => id.startsWith(`${sessionId}:`)))));
  // Native capture ran before this process's filter and may have included side files.
  for (const name of await paths(stage)) if (!scope.allowed(name)) await rm(path.join(stage, name));
  // The portable one-account store makes this owner the legacy account, whose
  // sync store lives directly under personal-access/sync on first restored boot.
  if (store.legacyOwnerId !== ownerId) {
    const source = path.join(stage, 'personal-access/accounts', ownerId, 'sync/events.json');
    if (await lstat(source).catch(cause => { if (cause.code === 'ENOENT') return null; throw cause; })) {
      await mkdir(path.join(stage, 'personal-access/sync'), { recursive: true });
      await rename(source, path.join(stage, 'personal-access/sync/events.json'));
    }
  }
}

function canonical(value, root) {
  if (typeof value === 'string') return value.replaceAll(root, '<profile>').replaceAll(root.replaceAll('\\', '/'), '<profile>');
  if (Array.isArray(value)) return value.map(row => canonical(row, root));
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key], root)]));
  return value;
}
/** A content change detector, independent of capture time and fresh scrub values. */
export async function cloudContentHash(stage, root, credentials) {
  const rows = [];
  for (const name of await paths(stage)) {
    const file = path.join(stage, name);
    let hash;
    if (name.endsWith('.json') || name === 'dsh-home/settings.yaml') {
      const value = JSON.parse(await readFile(file, 'utf8'));
      if (name === 'personal-access/store.json') {
        delete value.unknownAuthLimits;
        for (const account of Object.values(value.accounts ?? {})) for (const field of ['devices', 'authLimits', 'setupGrant']) delete account[field];
      }
      hash = digest(JSON.stringify(canonical(value, root)));
    } else {
      const state = createHash('sha256'); let offset = 0;
      if (name.startsWith('dsh-home/sessions/') && /\.jsonl(?:\.zstd)?$/.test(name)) {
        const captured = await nativeHeader(file); offset = captured.offset;
        state.update(JSON.stringify(canonical(captured.header, root)) + '\n');
      }
      for await (const bytes of createReadStream(file, { start: offset })) state.update(bytes);
      hash = state.digest('hex');
    }
    rows.push({ path: name, hash });
  }
  return digest(JSON.stringify({ files: rows, credentials: canonical(credentials ?? null, root) }));
}
