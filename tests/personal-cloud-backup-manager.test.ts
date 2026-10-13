import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createBackupManager } from '../src/personal-backup/index.mjs';
import { createCloudBackupManager } from '../src/personal-cloud-backup/index.mjs';
import { generateRecoveryCode, wrapMasterKey } from '../src/personal-cloud-backup/crypto.mjs';
import { stageCloudVaultRestore, reconcileCloudVaultRestore, finishCloudVaultRestore } from '../src/personal-cloud-backup/vault-restore.mjs';
import { createHostCloudIdentity } from '../src/personal-cloud/index.mjs';

const ownerId = 'synthetic-owner', accountId = 'synthetic-cloud-account';
const password = 'synthetic sensitive-operation password';
const secret = 'synthetic-s4-manager-model-key-445566';
const phrase = 'Synthetic cloud backup remembered the violet teapot appointment.';
const hash = value => createHash('sha256').update(value).digest('hex');
const failure = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra });
const journalFile = root => path.join(root, 'personal-backup', 'cloud-vault-restore.json');

// This is a synthetic system vault: portable credentials are re-encrypted for
// this installation. No Electron or machine credential store is accessed.
function syntheticVault() {
  const key = randomBytes(32); let values = {}, bytes = null;
  function encrypt(document) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    return Buffer.concat([iv, cipher.update(JSON.stringify(document)), cipher.final(), cipher.getAuthTag()]);
  }
  const vault = {
    getCredential: name => values[name] ?? null,
    saveCredential(name, value) { values[name] = value; bytes = encrypt(values); },
    removeCredential(name) { delete values[name]; bytes = encrypt(values); },
    snapshotVaultBytes: () => bytes && Buffer.from(bytes),
    prepareCloudVaultBytes: credentials => encrypt({ ...values, ...credentials }),
    restoreVaultBytes(snapshot) {
      if (snapshot === null) { values = {}; bytes = null; return; }
      const cipher = createDecipheriv('aes-256-gcm', key, snapshot.subarray(0, 12)); cipher.setAuthTag(snapshot.subarray(-16));
      values = JSON.parse(Buffer.concat([cipher.update(snapshot.subarray(12, -16)), cipher.final()]).toString()); bytes = Buffer.from(snapshot);
    },
    credentialIds: () => Object.keys(values),
  };
  return vault;
}

function syntheticCloud(schema = 10) {
  const entries = new Map(), requests = [];
  let key = null, revision = 0;
  const usage = () => ({ usedBytes: [...entries.values()].reduce((sum, row) => sum + (row.state === 'complete' ? row.manifest.totalBytes : 0), 0),
    reservedBytes: [...entries.values()].reduce((sum, row) => sum + (row.state === 'uploading' ? row.manifest.totalBytes : 0), 0),
    limitBytes: 300 * 1024 * 1024, globalLimitBytes: 6 * 1024 * 1024 * 1024 });
  const server = { schema, requests, entries, generation: 0, failUploadIndex: null, quotaError: null, clearReply: null, deleteReply: null, failDownloadIndex: null,
    forget() { server.generation++; entries.clear(); },
    identity() {
      return {
        cloudBackupSupported: () => server.schema >= 10,
        backupAccount: id => id === ownerId ? { accountId, issuer: 'https://synthetic-cloud.example.invalid/personal/v1/cloud/oidc' } : null,
        async backupRequest(id, route, body = {}) {
          if (id !== ownerId) throw failure('CLOUD_NOT_BOUND');
          if (server.schema < 10) throw failure('CLOUD_BACKUP_UNAVAILABLE');
          requests.push({ route, body: structuredClone(body) });
          if (route === '/backups/key/read') return { key: key && structuredClone(key), revision, generation: server.generation, sensitiveAuthorized: body.password === password };
          if (route === '/backups/key/write') {
            if (body.expectedRevision !== revision) throw failure('CONFLICT');
            key = structuredClone(body.key); revision++; return { revision };
          }
          if (route === '/backups/list') return { items: [...entries.values()].filter(row => row.state === 'complete').map(row => structuredClone(row.manifest)).reverse(), usage: usage(), keyAvailable: !!key };
          if (route === '/backups/start') {
            if ((body.generation ?? 0) !== server.generation) throw failure('BACKUP_GENERATION_CHANGED');
            if (server.quotaError) throw failure(server.quotaError.code, { usage: server.quotaError.usage });
            if (!entries.has(body.id)) entries.set(body.id, { manifest: structuredClone(body), chunks: new Map(), state: 'uploading' });
            const entry = entries.get(body.id); return { id: body.id, state: entry.state, received: [...entry.chunks.keys()], usage: usage() };
          }
          if (route === '/backups/chunk/upload') {
            if (body.index === server.failUploadIndex) { server.failUploadIndex = null; throw failure('CLOUD_UNAVAILABLE'); }
            const bytes = Buffer.from(body.ciphertext, 'base64url'); assert.equal(hash(bytes), body.hash);
            entries.get(body.id).chunks.set(body.index, bytes); return { accepted: true };
          }
          if (route === '/backups/complete') {
            const entry = entries.get(body.id); assert.equal(entry.chunks.size, entry.manifest.chunkCount);
            entry.state = 'complete'; return { backup: structuredClone(entry.manifest), usage: usage() };
          }
          if (route === '/backups/chunk/download') {
            if (body.index === server.failDownloadIndex) { server.failDownloadIndex = null; throw failure('CLOUD_UNAVAILABLE'); }
            const bytes = entries.get(body.id).chunks.get(body.index);
            return { id: body.id, index: body.index, hash: hash(bytes), ciphertext: bytes.toString('base64url') };
          }
          if (route === '/backups/clear') {
            if (server.clearReply) return structuredClone(server.clearReply);
            entries.clear(); key = null; revision = 0;
            return { deleted: true, verification: { backups: 0, chunks: 0, keys: 0, quotaBytes: 0 }, usage: usage() };
          }
          if (route === '/backups/delete') {
            if (server.deleteReply) return structuredClone(server.deleteReply);
            if (!entries.has(body.id)) throw failure('NOT_FOUND');
            entries.delete(body.id); return { deleted: true, verification: { backups: 0, chunks: 0 }, usage: usage() };
          }
          throw failure('SYNTHETIC_UNEXPECTED_ROUTE');
        },
      };
    },
  };
  return server;
}

async function fixture(t, { schema = 10, large = false } = {}) {
  const base = await mkdtemp(path.join(tmpdir(), 'weftmate-cloud-manager-')), server = syntheticCloud(schema), devices = [];
  t.after(async () => {
    for (const device of devices) { await device.cloud.close(); await device.local.stopOnline(); }
    await rm(base, { recursive: true, force: true });
  });
  let now = Date.UTC(2026, 9, 13, 8);
  async function device(name, { populated = true } = {}) {
    const root = path.join(base, name); await mkdir(path.join(root, 'personal-access'), { recursive: true });
    const account = { devices: {}, sessions: {}, commands: {}, setupGrant: null, defaultModelProfileId: 'synthetic-model', preferences: { appearance: populated ? 'dark' : 'light', density: 'comfortable' } };
    await writeFile(path.join(root, 'personal-access', 'store.json'), JSON.stringify({ version: 3, hostId: name, legacyOwnerId: ownerId, accounts: { [ownerId]: account } }));
    await writeFile(path.join(root, 'weftmate-settings.json'), JSON.stringify({ models: { profiles: [{ id: 'synthetic-model', provider: 'synthetic', model: 'synthetic-model-v1', baseUrl: 'https://synthetic-model.example.invalid/v1' }], activeId: 'synthetic-model' }, sessionBindings: {}, appearance: populated ? 'dark' : 'light' }));
    if (populated) {
      const memory = path.join(root, 'personal-access', 'accounts', ownerId, 'memory-home'); await mkdir(memory, { recursive: true });
      await writeFile(path.join(memory, 'synthetic-memory.md'), phrase);
    }
    if (large && populated) {
      const health = path.join(root, 'personal-access', 'accounts', ownerId, 'health'); await mkdir(health, { recursive: true });
      await writeFile(path.join(health, 'synthetic-health.bin'), randomBytes(2 * 1024 * 1024 + 3072));
    }
    const vault = syntheticVault(); if (populated) vault.saveCredential('synthetic-model-key', secret);
    const result = { root, vault, cloud: null, local: null, captures: 0, restarts: 0, allowUpload: true, requestError: null, exports: [] };
    const localOptions = { root, isIdle: async () => true, requestRestart: () => { result.restarts++; }, clock: () => now,
      validate: async stage => { const store = JSON.parse(await readFile(path.join(stage, 'personal-access', 'store.json'), 'utf8')); assert.ok(store.accounts[ownerId]); } };
    result.local = await createBackupManager(localOptions);
    result.makeCloud = () => createCloudBackupManager({ root, identity: server.identity(), vault, clock: () => now, canUpload: async () => result.allowUpload,
      backupManager: { ...result.local,
        cloudSnapshot: async (...args) => { result.captures++; return result.local.cloudSnapshot(...args); },
        request: async (...args) => { if (result.requestError) throw failure(result.requestError); return result.local.request(...args); },
      },
      exportCredentials: async metadata => { result.exports.push(metadata); return { 'synthetic-model-key': vault.getCredential('synthetic-model-key') ?? secret }; },
      stageCredentials: (credentials, options) => stageCloudVaultRestore(root, vault, credentials, options),
      abortCredentials: () => finishCloudVaultRestore(root, vault, false),
    });
    result.cloud = await result.makeCloud();
    result.reopenCloud = async () => { await result.cloud.close(); result.cloud = await result.makeCloud(); };
    result.coldRestore = async () => {
      await result.cloud.close(); await result.local.stopOnline(); await result.local.finishShutdown();
      result.local = await createBackupManager(localOptions);
      await reconcileCloudVaultRestore(root, vault, result.local.isRestoredStartup());
      await result.local.started(); await finishCloudVaultRestore(root, vault, true);
      result.cloud = await result.makeCloud();
    };
    devices.push(result); return result;
  }
  const source = await device('synthetic-source');
  return { base, server, source, device, advance: milliseconds => { now += milliseconds; } };
}

async function enable(device) {
  const draft = await device.cloud.prepare(ownerId);
  await device.cloud.enable(ownerId, { draftId: draft.draftId, confirmation: draft.recoveryCode.split('-')[draft.confirmGroup - 1] });
  return draft;
}

test('S4 prepare requires saving a checked group; reveal and rotation require sensitive reauthentication', async t => {
  const { source, server } = await fixture(t), draft = await source.cloud.prepare(ownerId);
  assert.equal((await source.cloud.view(ownerId)).enabled, false);
  await assert.rejects(source.cloud.enable(ownerId, { draftId: draft.draftId, confirmation: 'SYNTHETIC-WRONG' }), { code: 'CLOUD_BACKUP_CONFIRM_GROUP', invalidGroups: [draft.confirmGroup] });
  assert.equal(server.requests.filter(row => row.route === '/backups/key/write').length, 0);
  await source.cloud.enable(ownerId, { draftId: draft.draftId, confirmation: draft.recoveryCode.split('-')[draft.confirmGroup - 1].toLowerCase() });
  assert.equal((await source.cloud.view(ownerId)).enabled, true);
  await assert.rejects(source.cloud.reveal(ownerId, { password: 'synthetic wrong password' }), { code: 'INVALID_CREDENTIALS' });
  assert.equal((await source.cloud.reveal(ownerId, { password })).recoveryCode, draft.recoveryCode);
  await assert.rejects(source.cloud.prepare(ownerId), { code: 'CONFLICT' }, 'enable cannot bypass a password by generating a replacement recovery code');
  await assert.rejects(source.cloud.prepare(ownerId, { purpose: 'rotate', password: 'synthetic wrong password' }), { code: 'INVALID_CREDENTIALS' });
  const rotated = await source.cloud.prepare(ownerId, { purpose: 'rotate', password });
  await source.cloud.enable(ownerId, { draftId: rotated.draftId, confirmation: rotated.recoveryCode.split('-')[rotated.confirmGroup - 1] });
  assert.notEqual((await source.cloud.reveal(ownerId, { password })).recoveryCode, draft.recoveryCode);
  const keyWrites = server.requests.filter(row => row.route === '/backups/key/write'); assert.equal(keyWrites[0].body.key.keyId, keyWrites[1].body.key.keyId);
});

test('S4 run resumes persisted ciphertext after reconstructing the manager, without recapturing or retransmitting received blocks', async t => {
  const { source, server } = await fixture(t, { large: true }); await enable(source);
  server.failUploadIndex = 1;
  await assert.rejects(source.cloud.run(ownerId), { code: 'CLOUD_UNAVAILABLE' });
  assert.equal(source.captures, 1);
  const started = server.requests.find(row => row.route === '/backups/start').body;
  assert.ok(started.chunkCount > 1); assert.deepEqual([...server.entries.get(started.id).chunks.keys()], [0]);
  await source.reopenCloud();
  const result = await source.cloud.run(ownerId); assert.equal(result.state, 'succeeded'); assert.equal(result.backup.id, started.id);
  assert.equal(source.captures, 1, 'resume uses the original encrypted package');
  assert.equal(server.requests.filter(row => row.route === '/backups/chunk/upload' && row.body.index === 0).length, 1);
  assert.equal(server.requests.filter(row => row.route === '/backups/start').length, 2);
  assert.equal((await source.cloud.view(ownerId)).status.state, 'succeeded');
  for (const request of server.requests) {
    const bytes = Buffer.from(JSON.stringify(request.body)); assert.equal(bytes.includes(Buffer.from(secret)), false); assert.equal(bytes.includes(Buffer.from(phrase)), false);
  }
});

test('S4 reveal refuses an obsolete local recovery code after another computer rotates the remote wrapping record', async t => {
  const { source, server } = await fixture(t), draft = await enable(source);
  const localRef = `cloud-backup-${hash(accountId)}`, local = JSON.parse(source.vault.getCredential(localRef));
  const nextCode = generateRecoveryCode(), remoteIdentity = server.identity();
  const remote = await remoteIdentity.backupRequest(ownerId, '/backups/key/read');
  const master = Buffer.from(local.masterKey, 'base64url');
  try {
    const replacement = wrapMasterKey(master, nextCode, accountId, local.keyId);
    await remoteIdentity.backupRequest(ownerId, '/backups/key/write', { key: replacement, expectedRevision: remote.revision });
  } finally { master.fill(0); }
  await assert.rejects(source.cloud.reveal(ownerId, { password }), { code: 'CLOUD_BACKUP_RECOVERY_CHANGED' });
  assert.equal(JSON.parse(source.vault.getCredential(localRef)).recoveryCode, draft.recoveryCode, 'refusing reveal does not silently rewrite this computer\'s saved code');
  assert.equal((await source.cloud.view(ownerId)).enabled, true);
});

test('S4 unchanged account data and credentials skip upload; changing only a stored credential produces a new independent backup', async t => {
  const { source, server } = await fixture(t); await enable(source); assert.equal((await source.cloud.run(ownerId)).state, 'succeeded');
  const before = server.requests.length;
  assert.equal((await source.cloud.run(ownerId)).state, 'unchanged');
  assert.deepEqual(server.requests.slice(before).map(row => row.route), ['/backups/key/read'], 'only the deletion generation is checked; no new start, chunk or completion request');
  assert.equal(source.exports[0].ownerId, ownerId); assert.deepEqual(source.exports[0].modelProfileIds, ['synthetic-model']);
  source.vault.saveCredential('synthetic-model-key', 'synthetic-updated-key-778899');
  assert.equal((await source.cloud.run(ownerId)).state, 'succeeded'); assert.equal(server.entries.size, 2);
});

test('S4 a deletion generation change discards interrupted ciphertext and recaptures current data before resuming', async t => {
  const { source, server } = await fixture(t, { large: true }); await enable(source); server.failUploadIndex = 1;
  await assert.rejects(source.cloud.run(ownerId), { code: 'CLOUD_UNAVAILABLE' });
  const oldManifest = server.requests.find(row => row.route === '/backups/start').body;
  const stateFile = path.join(source.root, 'personal-backup', 'cloud', `${hash(accountId)}.json`);
  const oldPending = JSON.parse(await readFile(stateFile, 'utf8')).pending;
  assert.equal(oldManifest.generation, 0); assert.equal(source.captures, 1);
  server.forget();
  await rm(path.join(source.root, 'personal-access', 'accounts', ownerId, 'memory-home', 'synthetic-memory.md'));
  const requestBoundary = server.requests.length; await source.reopenCloud();
  const result = await source.cloud.run(ownerId); assert.equal(result.state, 'succeeded'); assert.equal(source.captures, 2);
  assert.notEqual(result.backup.id, oldManifest.id); assert.equal(result.backup.generation, 1);
  const newRequests = server.requests.slice(requestBoundary);
  assert.equal(newRequests[0].route, '/backups/key/read');
  assert.equal(newRequests.filter(row => row.route === '/backups/start').length, 1);
  assert.ok(newRequests.filter(row => ['/backups/start', '/backups/chunk/upload', '/backups/complete'].includes(row.route)).every(row => row.body.id === result.backup.id));
  assert.equal(server.entries.has(oldManifest.id), false);
  await assert.rejects(readFile(path.join(oldPending.directory, '0.chunk')), { code: 'ENOENT' }, 'stale local ciphertext is deleted rather than reuploaded');
});

test('S4 automatic backups defer on unsafe power/network and honor the daily interval', async t => {
  const { source, server, advance } = await fixture(t); await enable(source); source.allowUpload = false;
  const before = server.requests.length;
  assert.deepEqual(await source.cloud.run(ownerId, { automatic: true }), { state: 'deferred', code: 'CLOUD_BACKUP_POWER_NETWORK' });
  assert.equal(source.captures, 0); assert.equal(server.requests.length, before);
  source.allowUpload = true; assert.equal((await source.cloud.run(ownerId, { automatic: true })).state, 'succeeded');
  const captured = source.captures; assert.equal((await source.cloud.run(ownerId, { automatic: true })).state, 'unchanged'); assert.equal(source.captures, captured);
  advance(86400001); assert.equal((await source.cloud.run(ownerId, { automatic: true })).state, 'unchanged'); assert.equal(source.captures, captured + 1);
});

test('S4 large manual uploads preserve pending ciphertext when power/network postpones transmission', async t => {
  const { source, server } = await fixture(t, { large: true }); await enable(source); source.allowUpload = false;
  const before = server.requests.length;
  await assert.rejects(source.cloud.run(ownerId), { code: 'CLOUD_BACKUP_POWER_NETWORK' });
  assert.deepEqual(server.requests.slice(before).map(row => row.route), ['/backups/key/read'], 'no upload starts or chunks are sent while power/network postpones the transfer');
  assert.equal(source.captures, 1); source.allowUpload = true;
  assert.equal((await source.cloud.run(ownerId)).state, 'succeeded'); assert.equal(source.captures, 1);
});

test('S4 account and global quota failures propagate size information and retain a resumable pending backup', async t => {
  const { source, server } = await fixture(t); await enable(source);
  const usage = { usedBytes: 300, reservedBytes: 0, limitBytes: 300, globalUsedBytes: 600, globalLimitBytes: 600 };
  for (const code of ['BACKUP_QUOTA_EXCEEDED', 'BACKUP_GLOBAL_QUOTA_EXCEEDED']) {
    server.quotaError = { code, usage };
    await assert.rejects(source.cloud.run(ownerId), error => error.code === code && assert.deepEqual(error.usage, usage) === undefined);
    const view = await source.cloud.view(ownerId); assert.equal(view.status.state, 'failed'); assert.equal(view.status.code, code); assert.deepEqual(view.status.usage, usage);
  }
  assert.equal(source.captures, 1); server.quotaError = null; assert.equal((await source.cloud.run(ownerId)).state, 'succeeded'); assert.equal(source.captures, 1);
});

test('S4 a fresh computer can dismiss discovery, recover using only its saved code, and restore settings, memory and encrypted credentials', async t => {
  const { source, server, device } = await fixture(t), draft = await enable(source), result = await source.cloud.run(ownerId);
  const target = await device('synthetic-new-computer', { populated: false });
  const discovery = await target.cloud.view(ownerId); assert.equal(discovery.restoreSuggested, true); assert.equal(discovery.items[0].id, result.backup.id);
  await target.cloud.dismiss(ownerId, { id: result.backup.id }); assert.equal((await target.cloud.view(ownerId)).restoreSuggested, false);
  const before = server.requests.length;
  await assert.rejects(target.cloud.restore(ownerId, { id: result.backup.id, recoveryCode: 'bad', confirm: true }), { code: 'CLOUD_BACKUP_RECOVERY_CODE' });
  assert.equal(server.requests.length, before); assert.equal(target.restarts, 0);
  await assert.rejects(target.cloud.restore(ownerId, { id: result.backup.id, recoveryCode: generateRecoveryCode(), confirm: true }), { code: 'CLOUD_BACKUP_RECOVERY_MISMATCH' });
  assert.equal(target.restarts, 0); assert.equal(target.vault.getCredential('synthetic-model-key'), null);
  const restored = await target.cloud.restore(ownerId, { id: result.backup.id, recoveryCode: draft.recoveryCode, confirm: true });
  assert.equal(restored.restoring, true); assert.equal(target.restarts, 1); assert.equal(target.vault.getCredential('synthetic-model-key'), null, 'credentials stay staged until cold restore');
  const journal = JSON.parse(await readFile(journalFile(target.root), 'utf8')); assert.equal(journal.state, 'prepared');
  assert.equal(Buffer.from(journal.after, 'base64').includes(Buffer.from(secret)), false);
  await target.coldRestore();
  assert.equal(target.vault.getCredential('synthetic-model-key'), secret);
  const store = JSON.parse(await readFile(path.join(target.root, 'personal-access', 'store.json'), 'utf8'));
  assert.equal(store.hostId, 'synthetic-new-computer'); assert.equal(store.accounts[ownerId].preferences.appearance, 'dark');
  assert.equal(await readFile(path.join(target.root, 'personal-access', 'accounts', ownerId, 'memory-home', 'synthetic-memory.md'), 'utf8'), phrase);
  const settings = JSON.parse(await readFile(path.join(target.root, 'weftmate-settings.json'), 'utf8')); assert.equal(settings.models.profiles[0].id, 'synthetic-model');
  assert.equal((await target.cloud.view(ownerId)).enabled, true);
  await assert.rejects(readFile(journalFile(target.root)), { code: 'ENOENT' });
  const safety = (await target.local.view()).backups.find(row => row.reason === 'before-restore'); assert.ok(safety); assert.equal(safety.verification, 'valid');
});

test('S4 interrupted downloads resume verified blocks and a refused restore removes its staged credentials', async t => {
  const { source, server, device } = await fixture(t, { large: true }), draft = await enable(source), uploaded = await source.cloud.run(ownerId);
  const target = await device('synthetic-restore-interruption', { populated: false }); server.failDownloadIndex = 1;
  await assert.rejects(target.cloud.restore(ownerId, { id: uploaded.backup.id, recoveryCode: draft.recoveryCode, confirm: true }), { code: 'CLOUD_UNAVAILABLE' });
  target.requestError = 'SESSION_BUSY';
  await assert.rejects(target.cloud.restore(ownerId, { id: uploaded.backup.id, recoveryCode: draft.recoveryCode, confirm: true }), { code: 'SESSION_BUSY' });
  assert.equal(server.requests.filter(row => row.route === '/backups/chunk/download' && row.body.index === 0).length, 1);
  await assert.rejects(readFile(journalFile(target.root)), { code: 'ENOENT' });
  assert.equal(target.vault.getCredential('synthetic-model-key'), null); assert.equal(target.restarts, 0);
});

test('S4 malformed cloud metadata fails before downloading or changing any restore path', async t => {
  const { source, server, device } = await fixture(t), draft = await enable(source), uploaded = await source.cloud.run(ownerId);
  const target = await device('synthetic-metadata-target', { populated: false }), entry = server.entries.get(uploaded.backup.id);
  const control = path.join(target.root, 'personal-backup', 'cloud'), safe = path.join(control, 'synthetic-safe'); await mkdir(safe);
  const sentinel = path.join(safe, 'sentinel.wmb'), prior = Buffer.from('synthetic existing restore data must remain untouched'); await writeFile(sentinel, prior);
  const beforeFiles = (await readdir(control, { recursive: true })).sort();
  const cases = [
    { ...uploaded.backup, id: '../synthetic-escape' },
    { ...uploaded.backup, chunks: [{ ...uploaded.backup.chunks[0], index: '../synthetic-escape' }] },
    { ...uploaded.backup, chunkCount: 513 },
    { ...uploaded.backup, totalBytes: uploaded.backup.totalBytes + 1 },
    { ...uploaded.backup, chunks: [{ ...uploaded.backup.chunks[0], size: 1024 * 1024 + 17 }] },
    { ...uploaded.backup, chunks: [{ ...uploaded.backup.chunks[0], hash: 'synthetic-invalid-hash' }] },
    { ...uploaded.backup, version: 2 },
  ];
  for (const manifest of cases) {
    entry.manifest = manifest; const boundary = server.requests.length;
    await assert.rejects(target.cloud.restore(ownerId, { id: manifest.id, recoveryCode: draft.recoveryCode, confirm: true }),
      { code: manifest.version > 1 ? 'CLOUD_BACKUP_NEWER_VERSION' : 'CLOUD_BACKUP_CORRUPT' });
    assert.deepEqual(server.requests.slice(boundary).map(row => row.route), ['/backups/key/read', '/backups/list'], 'untrusted metadata is rejected before any chunk request');
    assert.deepEqual((await readdir(control, { recursive: true })).sort(), beforeFiles, 'invalid IDs or chunk indices cannot create files or directories');
    assert.deepEqual(await readFile(sentinel), prior);
    assert.equal(target.restarts, 0); assert.equal(target.vault.getCredential('synthetic-model-key'), null);
  }
  entry.manifest = uploaded.backup;
});

test('S4 downloaded ciphertext length must match authenticated manifest metadata before any chunk is persisted', async t => {
  const { source, server, device } = await fixture(t), draft = await enable(source), uploaded = await source.cloud.run(ownerId);
  const target = await device('synthetic-length-target', { populated: false }), entry = server.entries.get(uploaded.backup.id);
  assert.equal(uploaded.backup.chunkCount, 1);
  entry.manifest = { ...uploaded.backup, totalBytes: uploaded.backup.totalBytes + 1, chunks: [{ ...uploaded.backup.chunks[0], size: uploaded.backup.chunks[0].size + 1 }] };
  const directory = path.join(target.root, 'personal-backup', 'cloud', hash(accountId), `restore-${uploaded.backup.id}`); await mkdir(directory, { recursive: true });
  const outputFile = path.join(directory, 'restored.wmb'), prior = Buffer.from('synthetic preexisting recovered archive'); await writeFile(outputFile, prior);
  const boundary = server.requests.length;
  await assert.rejects(target.cloud.restore(ownerId, { id: uploaded.backup.id, recoveryCode: draft.recoveryCode, confirm: true }), { code: 'CLOUD_BACKUP_CORRUPT' });
  assert.equal(server.requests.slice(boundary).filter(row => row.route === '/backups/chunk/download').length, 1);
  await assert.rejects(readFile(path.join(directory, '0.chunk')), { code: 'ENOENT' }, 'a matching hash alone cannot authorize a ciphertext of the wrong size');
  assert.deepEqual(await readFile(outputFile), prior); assert.equal(target.restarts, 0);
  await assert.rejects(readFile(journalFile(target.root)), { code: 'ENOENT' });
});

test('S4 cloud deletion requires a complete zero-count receipt before discarding this computer\'s recovery key', async t => {
  const { source, server } = await fixture(t); await enable(source); await source.cloud.run(ownerId);
  for (const reply of [ {}, { deleted: true, verification: {} }, { deleted: true, verification: { backups: 0, chunks: 0, keys: 0 } },
    { deleted: true, verification: { backups: 0, chunks: 1, keys: 0, quotaBytes: 0 } },
    { deleted: false, verification: { backups: 0, chunks: 0, keys: 0, quotaBytes: 0 } } ]) {
    server.clearReply = reply; await assert.rejects(source.cloud.clear(ownerId), { code: 'CLOUD_BACKUP_DELETE_UNVERIFIED' }); assert.equal((await source.cloud.view(ownerId)).enabled, true);
  }
  server.clearReply = null;
  const cleared = await source.cloud.clear(ownerId); assert.deepEqual(cleared.verification, { backups: 0, chunks: 0, keys: 0, quotaBytes: 0 });
  const view = await source.cloud.view(ownerId); assert.equal(view.enabled, false); assert.equal(view.items.length, 0); assert.equal(view.keyAvailable, false);
  assert.equal(source.vault.credentialIds().some(id => id.startsWith('cloud-backup-')), false);
});

test('S4 deleting one backup requires confirmation and verified removal while keeping its key and remaining backups', async t => {
  const { source, server } = await fixture(t); await enable(source);
  const first = (await source.cloud.run(ownerId)).backup;
  source.vault.saveCredential('synthetic-model-key', 'synthetic-second-backup-model-key');
  const second = (await source.cloud.run(ownerId)).backup;
  const keyRef = `cloud-backup-${hash(accountId)}`, savedKey = source.vault.getCredential(keyRef), before = server.requests.length;
  await assert.rejects(source.cloud.remove(ownerId, { id: first.id, confirm: false }), { code: 'INVALID_REQUEST' });
  assert.equal(server.requests.length, before); assert.equal(server.entries.size, 2);
  for (const reply of [{}, { deleted: true }, { deleted: true, verification: {} }, { deleted: true, verification: { backups: 0 } },
    { deleted: true, verification: { backups: 0, chunks: 1 } }, { deleted: true, verification: { backups: 1, chunks: 0 } },
    { deleted: false, verification: { backups: 0, chunks: 0 } }]) {
    server.deleteReply = reply;
    await assert.rejects(source.cloud.remove(ownerId, { id: first.id, confirm: true }), { code: 'CLOUD_BACKUP_DELETE_UNVERIFIED' });
    assert.equal(source.vault.getCredential(keyRef), savedKey); assert.equal(server.entries.size, 2);
  }
  server.deleteReply = null;
  const result = await source.cloud.remove(ownerId, { id: first.id, confirm: true });
  assert.deepEqual(result.verification, { backups: 0, chunks: 0 }); assert.equal(server.entries.has(first.id), false); assert.equal(server.entries.has(second.id), true);
  assert.equal(source.vault.getCredential(keyRef), savedKey);
  const view = await source.cloud.view(ownerId); assert.equal(view.enabled, true); assert.equal(view.keyAvailable, true); assert.deepEqual(view.items.map(row => row.id), [second.id]);
  assert.equal(view.usage.usedBytes, second.totalBytes);
});

test('S4 schema 9 makes zero new cloud requests; schema 10 enables requests only after its capability is advertised', async t => {
  const { source, server } = await fixture(t, { schema: 9 });
  assert.deepEqual(await source.cloud.view(ownerId), { available: false, reason: 'CLOUD_BACKUP_UNAVAILABLE' });
  for (const operation of [() => source.cloud.prepare(ownerId), () => source.cloud.run(ownerId), () => source.cloud.reveal(ownerId, { password }),
    () => source.cloud.restore(ownerId, { id: 'synthetic-backup', recoveryCode: generateRecoveryCode(), confirm: true }), () => source.cloud.clear(ownerId),
    () => source.cloud.dismiss(ownerId, { id: 'synthetic-backup' }), () => source.cloud.remove(ownerId, { id: 'synthetic-backup', confirm: true })]) await assert.rejects(operation(), { code: 'CLOUD_BACKUP_UNAVAILABLE' });
  assert.equal(server.requests.length, 0);
  server.schema = 10; assert.equal((await source.cloud.view(ownerId)).available, true); assert.equal(server.requests.length, 1);
  await assert.rejects(source.cloud.prepare('another-synthetic-owner'), { code: 'CLOUD_NOT_BOUND' }); assert.equal(server.requests.length, 1);
});

test('S4 the actual host identity reads capability from signed schema 9/10 control receipts', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'weftmate-cloud-capability-')), signing = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(signing.publicKey), kid: 'synthetic-capability-key', alg: 'RS256', use: 'sig' };
  let backupRequests = 0;
  const cloud = createServer((request, response) => {
    if (request.url.endsWith('/jwks')) { response.end(JSON.stringify({ keys: [jwk] })); return; }
    if (request.url.includes('/backups/')) backupRequests++;
    request.resume(); response.end(JSON.stringify({ items: [], usage: {}, keyAvailable: false }));
  });
  await new Promise(resolve => cloud.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${cloud.address().port}/personal/v1/cloud`, issuer = `${base}/oidc`, hostId = 'synthetic-capability-host';
  let identity;
  t.after(async () => { identity?.close(); await new Promise(resolve => { cloud.close(resolve); cloud.closeAllConnections(); }); await rm(root, { recursive: true, force: true }); });
  const context = { root, rootState: { hostId, accounts: { [ownerId]: { devices: {} } } }, timestamp: Date.now, serial: work => work() };
  identity = await createHostCloudIdentity(context, { issuer, allowInsecureLoopback: true }); identity.close();
  const identityFile = path.join(root, 'cloud-identity', 'identity.json'), document = JSON.parse(await readFile(identityFile, 'utf8'));
  document.bindings[JSON.stringify([issuer, accountId])] = { ownerId, sub: accountId, issuer, claimId: 'synthetic-claim', desktop: false, status: 'active' };
  await writeFile(identityFile, JSON.stringify(document)); identity = await createHostCloudIdentity(context, { issuer, allowInsecureLoopback: true });
  assert.deepEqual(identity.backupAccount(ownerId), { accountId, issuer }, 'an active legacy claim binding does not require a desktop flag');
  assert.equal(identity.backupAccount('another-synthetic-owner'), null);
  async function receipt(schema, capabilities = undefined) {
    return new SignJWT({ events: [], watermark: 0, schema, ...(capabilities ? { capabilities } : {}) })
      .setProtectedHeader({ alg: 'RS256', typ: 'wm-cloud-revocations+jwt', kid: jwk.kid }).setIssuer(issuer).setAudience(`${base}/hosts/${hostId}`)
      .setIssuedAt().setExpirationTime('300s').sign(signing.privateKey);
  }
  await identity.applyEvents(await receipt(9)); assert.equal(identity.cloudBackupSupported(), false);
  await assert.rejects(identity.backupRequest(ownerId, '/backups/list'), { code: 'CLOUD_BACKUP_UNAVAILABLE' }); assert.equal(backupRequests, 0);
  await identity.applyEvents(await receipt(10, { cloudBackup: 1 })); assert.equal(identity.cloudBackupSupported(), true);
  await identity.backupRequest(ownerId, '/backups/list'); assert.equal(backupRequests, 1);
  await assert.rejects(identity.backupRequest('another-synthetic-owner', '/backups/list'), { code: 'CLOUD_NOT_BOUND' }); assert.equal(backupRequests, 1);
  await identity.applyEvents(await receipt(10)); assert.equal(identity.cloudBackupSupported(), false);
  await assert.rejects(identity.backupRequest(ownerId, '/backups/list'), { code: 'CLOUD_BACKUP_UNAVAILABLE' }); assert.equal(backupRequests, 1);
});

test('S4 local vault journal rolls back a failed or interrupted restore and commits only after successful startup', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'weftmate-cloud-vault-')), vault = syntheticVault();
  t.after(() => rm(root, { recursive: true, force: true })); await mkdir(path.join(root, 'personal-backup'));
  vault.saveCredential('synthetic-existing-key', 'synthetic-before-restore-key');
  const before = vault.snapshotVaultBytes();
  await stageCloudVaultRestore(root, vault, { 'synthetic-restored-key': secret });
  const staged = JSON.parse(await readFile(journalFile(root), 'utf8'));
  assert.equal(Buffer.from(staged.after, 'base64').includes(Buffer.from(secret)), false); assert.deepEqual(vault.snapshotVaultBytes(), before);
  await reconcileCloudVaultRestore(root, vault, true); assert.equal(vault.getCredential('synthetic-restored-key'), secret);
  await finishCloudVaultRestore(root, vault, false); assert.deepEqual(vault.snapshotVaultBytes(), before); assert.equal(vault.getCredential('synthetic-restored-key'), null);
  await stageCloudVaultRestore(root, vault, { 'synthetic-restored-key': secret }); await reconcileCloudVaultRestore(root, vault, true);
  await reconcileCloudVaultRestore(root, vault, false); assert.deepEqual(vault.snapshotVaultBytes(), before);
  await stageCloudVaultRestore(root, vault, { 'synthetic-restored-key': secret }); await reconcileCloudVaultRestore(root, vault, false);
  assert.deepEqual(vault.snapshotVaultBytes(), before);
  await stageCloudVaultRestore(root, vault, { 'synthetic-restored-key': secret }); await reconcileCloudVaultRestore(root, vault, true); await finishCloudVaultRestore(root, vault, true);
  assert.equal(vault.getCredential('synthetic-restored-key'), secret); await assert.rejects(readFile(journalFile(root)), { code: 'ENOENT' });
});

test('S4 finishing credential restore removes only its decrypted archive within the cloud restore directory', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'weftmate-cloud-vault-cleanup-')), vault = syntheticVault();
  t.after(() => rm(root, { recursive: true, force: true })); await mkdir(path.join(root, 'personal-backup'));
  const control = path.join(root, 'personal-backup', 'cloud'), restore = path.join(control, 'synthetic-restore'); await mkdir(restore, { recursive: true });
  const kept = path.join(restore, 'synthetic-ciphertext.chunk'); await writeFile(kept, 'synthetic remaining ciphertext');
  vault.saveCredential('synthetic-existing-key', 'synthetic-original-key');
  for (const success of [true, false]) {
    const outputFile = path.join(restore, 'restored.wmb'); await writeFile(outputFile, 'synthetic decrypted restore archive');
    await stageCloudVaultRestore(root, vault, { 'synthetic-restored-key': secret }, { outputFile });
    await reconcileCloudVaultRestore(root, vault, true); await finishCloudVaultRestore(root, vault, success);
    await assert.rejects(readFile(outputFile), { code: 'ENOENT' });
    assert.equal(await readFile(kept, 'utf8'), 'synthetic remaining ciphertext');
    await assert.rejects(readFile(journalFile(root)), { code: 'ENOENT' });
  }
  for (const outputFile of [path.join(root, 'synthetic-user-files', 'restored.wmb'),
    path.join(root, 'personal-backup', 'cloud-adjacent', 'restored.wmb'), path.join(restore, 'synthetic-user-archive.wmb')]) {
    await mkdir(path.dirname(outputFile), { recursive: true }); await writeFile(outputFile, 'synthetic unrelated file');
    await stageCloudVaultRestore(root, vault, { 'synthetic-restored-key': secret }, { outputFile });
    await reconcileCloudVaultRestore(root, vault, true); await finishCloudVaultRestore(root, vault, false);
    assert.equal(await readFile(outputFile, 'utf8'), 'synthetic unrelated file', 'cleanup cannot delete adjacent paths or arbitrary filenames');
  }
});
