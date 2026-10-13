import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { migrate } from '../services/cloud/src/database.mjs';
import { createCloudBackups, backupDeletionVerification } from '../services/cloud/src/cloud-backups.mjs';
import { createHosts } from '../services/cloud/src/hosts.mjs';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createBackupManager } from '../src/personal-backup/index.mjs';
import { verify } from '../src/personal-backup/archive.mjs';
import { createCloudBackupManager } from '../src/personal-cloud-backup/index.mjs';
import { decryptBackup, unwrapMasterKey, cloudBackupChunkFile } from '../src/personal-cloud-backup/crypto.mjs';
import { createOfflineService } from '../src/personal-offline/index.mjs';

const ownerId = 'synthetic-contract-owner', accountId = 'synthetic-contract-account';
const phrase = 'Synthetic S4 contract conversation: mango cloud found my copper notebook.';
const secret = 'synthetic-contract-model-api-key-123456789';
const hash = value => createHash('sha256').update(value).digest('hex');

async function fixture(t, { large = false } = {}) {
  const base = await mkdtemp(path.join(tmpdir(), 'weftmate-cloud-contract-')), root = path.join(base, 'synthetic-profile');
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON'); await migrate(db);
  for (const id of [accountId, 'synthetic-other-account']) db.prepare('INSERT INTO cloud_accounts(id,email,password,active,created_at) VALUES(?,?,?,?,?)').run(id, `${id}@example.invalid`, '{}', 1, Date.now());
  const api = createCloudBackups({ database: db, authenticate: async (request, required) => {
    assert.equal(required, true); return db.prepare('SELECT * FROM cloud_accounts WHERE id=? AND active=1').get(request.syntheticAccountId);
  } });
  const requests = [], values = new Map(); let failUploadIndex = null, manager, captured = 0;
  const vault = { getCredential: id => values.get(id) ?? null, saveCredential: (id, value) => values.set(id, value), removeCredential: id => values.delete(id) };
  const identity = {
    cloudBackupSupported: () => true,
    backupAccount: id => id === ownerId ? { accountId, issuer: 'https://synthetic-cloud.example.invalid/personal/v1/cloud/oidc' } : null,
    async backupRequest(id, route, body = {}) {
      assert.equal(id, ownerId); requests.push({ route, body: structuredClone(body) });
      if (route === '/backups/chunk/upload' && body.index === failUploadIndex) {
        failUploadIndex = null; throw Object.assign(new Error('CLOUD_UNAVAILABLE'), { code: 'CLOUD_UNAVAILABLE' });
      }
      try { return await api.handle(route, { syntheticAccountId: accountId }, body); }
      catch (error) { error.usage = error.details?.usage; throw error; }
    },
  };
  await mkdir(path.join(root, 'personal-access'), { recursive: true });
  await writeFile(path.join(root, 'personal-access', 'store.json'), JSON.stringify({ version: 3, hostId: 'synthetic-contract-host', legacyOwnerId: ownerId,
    accounts: { [ownerId]: { devices: {}, sessions: {}, commands: {}, setupGrant: null, defaultModelProfileId: 'synthetic-model', preferences: { appearance: 'dark' } } } }));
  await writeFile(path.join(root, 'weftmate-settings.json'), JSON.stringify({ models: { profiles: [{ id: 'synthetic-model', model: 'synthetic-model', provider: 'synthetic' }], activeId: 'synthetic-model' }, sessionBindings: {} }));
  const memory = path.join(root, 'personal-access', 'accounts', ownerId, 'memory-home'); await mkdir(memory, { recursive: true });
  const memoryFile = path.join(memory, 'synthetic-contract-memory.md'); await writeFile(memoryFile, phrase);
  if (large) {
    const health = path.join(root, 'personal-access', 'accounts', ownerId, 'health'); await mkdir(health, { recursive: true });
    await writeFile(path.join(health, 'synthetic-noise.bin'), randomBytes(2 * 1024 * 1024 + 4096));
  }
  const local = await createBackupManager({ root, isIdle: async () => true, requestRestart: () => {}, validate: async () => {} });
  const makeManager = () => createCloudBackupManager({ root, identity, vault, canUpload: async () => true,
    backupManager: { ...local, cloudSnapshot: async (...args) => { captured++; return local.cloudSnapshot(...args); } },
    exportCredentials: async metadata => { assert.equal(metadata.ownerId, ownerId); assert.deepEqual(metadata.modelProfileIds, ['synthetic-model']); return { 'synthetic-model-key': secret }; },
  });
  manager = await makeManager();
  t.after(async () => { await manager.close(); await local.stopOnline(); db.close(); await rm(base, { recursive: true, force: true }); });
  return { base, root, db, api, identity, requests, memoryFile,
    get manager() { return manager; }, captures: () => captured, interruptAt: index => { failUploadIndex = index; },
    reopen: async () => { await manager.close(); manager = await makeManager(); },
    request: (route, body = {}, id = accountId) => api.handle(`/backups/${route}`, { syntheticAccountId: id }, body),
  };
}

async function enable(f) {
  const draft = await f.manager.prepare(ownerId);
  await f.manager.enable(ownerId, { draftId: draft.draftId, confirmation: draft.recoveryCode.split('-')[draft.confirmGroup - 1] });
  return draft;
}

async function downloadAndDecrypt(f, manifest, recoveryCode) {
  const directory = path.join(f.base, `download-${manifest.id}`); await mkdir(directory, { recursive: true });
  for (const chunk of manifest.chunks) {
    const reply = await f.request('chunk/download', { id: manifest.id, index: chunk.index });
    const bytes = Buffer.from(reply.ciphertext, 'base64url'); assert.equal(hash(bytes), chunk.hash);
    await writeFile(cloudBackupChunkFile(directory, chunk.index), bytes);
  }
  const envelope = await f.request('key/read'), masterKey = unwrapMasterKey(envelope.key, recoveryCode, accountId), outputFile = path.join(directory, 'restored.wmb');
  try {
    const credentials = await decryptBackup({ manifest, directory, accountId, masterKey, outputFile });
    return { outputFile, credentials, rawArchive: gunzipSync(await readFile(outputFile)), innerManifest: await verify(outputFile) };
  } finally { masterKey.fill(0); }
}

async function desktopOnlyOffline(f) {
  const hostId = 'synthetic-desktop-only-host', issuer = 'https://synthetic-cloud.example.invalid/personal/v1/cloud/oidc';
  const installation = await generateKeyPair('ES256'), publicJwk = await exportJWK(installation.publicKey), keyText = JSON.stringify(publicJwk);
  f.db.prepare('INSERT INTO cloud_hosts(host_id,public_jwk,jkt,tls_spki) VALUES(?,?,?,?)').run(hostId, keyText, 'synthetic-desktop-jkt', 'synthetic-desktop-spki');
  f.db.prepare('INSERT INTO host_claims(claim_id,host_id,public_jwk,jkt,tls_spki,challenge,expires_at,account_id,status) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('synthetic-desktop-claim', hostId, keyText, 'synthetic-desktop-jkt', 'synthetic-desktop-spki', 'synthetic-challenge', Date.now() + 600000, accountId, 'active');
  f.db.prepare('INSERT INTO host_memberships(host_id,account_id,claim_id) VALUES(?,?,?)').run(hostId, accountId, 'synthetic-desktop-claim');
  const hosts = createHosts({ database: f.db, config: { issuer }, keys: {}, authenticate: async () => { throw new Error('synthetic host publication must use its installation proof'); }, now: Date.now });
  const publications = [];
  f.identity.publishOffline = async (owner, generation) => {
    assert.equal(owner, ownerId); publications.push(generation);
    const route = '/hosts/offline/publish';
    const proof = await new SignJWT({ sub: accountId, generation, action: route }).setProtectedHeader({ alg: 'ES256', typ: 'wm-host-request+jwt' })
      .setIssuer(hostId).setAudience(issuer).setIssuedAt().setExpirationTime('60s').setJti(randomUUID()).sign(installation.privateKey);
    const reply = await hosts.handle(route, {}, { hostId, proof }); assert.equal(reply.updated, true);
    return { ...reply, hostId, accountId, generation };
  };
  const context = { root: path.join(f.root, 'personal-access'), rootState: { hostId }, timestamp: Date.now,
    cloudIdentity: f.identity, accountState: () => ({ commands: {}, sessions: {} }), backend: {},
    memoryManager: { discardOfflinePending: async () => {} } };
  const offline = await createOfflineService(context);
  return { offline, publications, publishInitial: () => f.identity.publishOffline(ownerId, 1),
    metadata: () => readFile(path.join(context.root, 'offline-metadata.json'), 'utf8').then(JSON.parse) };
}

test('S4 actual manager, crypto, migration and cloud API agree on ISO dates and encrypted backup roundtrip', async t => {
  const f = await fixture(t, { large: true }), draft = await enable(f), result = await f.manager.run(ownerId);
  assert.equal(result.state, 'succeeded'); assert.match(result.backup.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(result.backup.generation, 0); assert.ok(result.backup.chunkCount >= 3);
  const started = f.requests.find(row => row.route === '/backups/start').body;
  assert.equal(typeof started.createdAt, 'string'); assert.equal(started.createdAt, result.backup.createdAt);
  const stored = f.db.prepare('SELECT * FROM cloud_backups WHERE id=?').get(result.backup.id);
  assert.equal(stored.created_at, Date.parse(started.createdAt)); assert.equal(JSON.parse(stored.descriptor).createdAt, started.createdAt);
  assert.equal(result.usage.usedBytes, result.backup.totalBytes); assert.equal(result.usage.reservedBytes, 0);
  const listing = await f.request('list'); assert.equal(listing.items.length, 1); assert.deepEqual(listing.items[0], result.backup);
  const restored = await downloadAndDecrypt(f, listing.items[0], draft.recoveryCode);
  assert.deepEqual(restored.credentials, { 'synthetic-model-key': secret }); assert.ok(restored.rawArchive.includes(Buffer.from(phrase)));
  assert.equal(restored.innerManifest.cloud.ownerId, ownerId);
  assert.equal((await f.request('list', {}, 'synthetic-other-account')).items.length, 0);
  await assert.rejects(f.request('chunk/download', { id: result.backup.id, index: 0 }, 'synthetic-other-account'), { code: 'NOT_FOUND' });
  const allCloudBytes = [Buffer.from(JSON.stringify(listing)), Buffer.from(JSON.stringify((await f.request('key/read')).key))];
  for (const row of f.db.prepare('SELECT ciphertext FROM cloud_backup_chunks').all()) allCloudBytes.push(Buffer.from(row.ciphertext));
  for (const marker of [phrase, secret, draft.recoveryCode]) assert.equal(Buffer.concat(allCloudBytes).includes(Buffer.from(marker)), false);
});

test('S4 actual deletion control removes ciphertext and quota, rejects old pending generations, and the manager recaptures without forgotten memory', async t => {
  const f = await fixture(t, { large: true }), draft = await enable(f); f.interruptAt(1);
  await assert.rejects(f.manager.run(ownerId), { code: 'CLOUD_UNAVAILABLE' });
  const old = f.requests.find(row => row.route === '/backups/start').body;
  assert.equal(old.generation, 0); assert.equal(f.db.prepare('SELECT count(*) AS n FROM cloud_backup_chunks').get().n, 1);
  const oldCiphertext = Buffer.from(f.db.prepare('SELECT ciphertext FROM cloud_backup_chunks').get().ciphertext);
  f.db.prepare('INSERT INTO cloud_hosts(host_id,public_jwk,jkt,tls_spki) VALUES(?,?,?,?)').run('synthetic-forget-host', '{}', 'synthetic-jkt', 'synthetic-tls-spki');
  f.db.prepare('INSERT INTO offline_controls(host_id,account_id,generation) VALUES(?,?,?)').run('synthetic-forget-host', accountId, 1);
  f.db.prepare('UPDATE offline_controls SET generation=generation+1 WHERE host_id=? AND account_id=?').run('synthetic-forget-host', accountId);
  assert.deepEqual(backupDeletionVerification(f.db, accountId), { backups: 0, chunks: 0, keys: 1, quotaBytes: 0 }, 'forgetting removes content but preserves its owner-held wrapping record');
  assert.equal((await f.request('key/read')).generation, 1);
  await assert.rejects(f.request('start', old), { code: 'BACKUP_GENERATION_CHANGED' });
  const legacyOld = { ...old }; delete legacyOld.generation;
  await assert.rejects(f.request('start', legacyOld), { code: 'BACKUP_GENERATION_CHANGED' }, 'legacy manifests default to generation zero');
  await assert.rejects(f.request('chunk/upload', { id: old.id, index: 0, ciphertext: oldCiphertext.toString('base64url'), hash: old.chunks[0].hash }), { code: 'NOT_FOUND' });
  await rm(f.memoryFile); const boundary = f.requests.length; await f.reopen();
  const result = await f.manager.run(ownerId); assert.equal(result.state, 'succeeded'); assert.equal(f.captures(), 2);
  assert.notEqual(result.backup.id, old.id); assert.equal(result.backup.generation, 1);
  const newTransfers = f.requests.slice(boundary).filter(row => ['/backups/start', '/backups/chunk/upload', '/backups/complete'].includes(row.route));
  assert.ok(newTransfers.length > 0); assert.ok(newTransfers.every(row => row.body.id === result.backup.id));
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM cloud_backups WHERE id=?').get(old.id).n, 0);
  const restored = await downloadAndDecrypt(f, result.backup, draft.recoveryCode); assert.equal(restored.rawArchive.includes(Buffer.from(phrase)), false);
  assert.deepEqual(restored.credentials, { 'synthetic-model-key': secret });
});

test('S4 a desktop-only account forgetting memory publishes its first invalidation and truly deletes complete and interrupted cloud backups', async t => {
  const f = await fixture(t, { large: true }), draft = await enable(f), desktop = await desktopOnlyOffline(f);
  t.after(() => desktop.offline.close());
  const completed = await f.manager.run(ownerId); assert.equal(completed.state, 'succeeded');
  await writeFile(f.memoryFile, phrase + ' A second synthetic memory was captured.'); f.interruptAt(1);
  await assert.rejects(f.manager.run(ownerId), { code: 'CLOUD_UNAVAILABLE' });
  const pending = f.requests.filter(row => row.route === '/backups/start').at(-1).body;
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM cloud_backups').get().n, 2);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM offline_controls').get().n, 0, 'no phone has synchronized or created an offline control');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM cloud_devices').get().n, 0);
  await rm(f.memoryFile);
  const forgotten = await desktop.offline.invalidate(ownerId); assert.equal(forgotten.generation, 2); assert.deepEqual(desktop.publications, [2]);
  assert.deepEqual((await desktop.metadata()).owners[ownerId].devices, {});
  assert.deepEqual(backupDeletionVerification(f.db, accountId), { backups: 0, chunks: 0, keys: 1, quotaBytes: 0 });
  assert.equal((await f.request('key/read')).generation, 1);
  await assert.rejects(f.request('start', pending), { code: 'BACKUP_GENERATION_CHANGED' });
  await assert.rejects(f.request('chunk/download', { id: completed.backup.id, index: 0 }), { code: 'NOT_FOUND' });
  const boundary = f.requests.length; await f.reopen(); const replacement = await f.manager.run(ownerId);
  assert.equal(replacement.state, 'succeeded'); assert.equal(replacement.backup.generation, 1); assert.notEqual(replacement.backup.id, pending.id); assert.equal(f.captures(), 3);
  assert.ok(f.requests.slice(boundary).filter(row => ['/backups/start', '/backups/chunk/upload', '/backups/complete'].includes(row.route)).every(row => row.body.id === replacement.backup.id));
  const restored = await downloadAndDecrypt(f, replacement.backup, draft.recoveryCode); assert.equal(restored.rawArchive.includes(Buffer.from(phrase)), false);
  await desktop.offline.invalidate(ownerId); assert.deepEqual(desktop.publications, [2, 3]);
  assert.deepEqual(backupDeletionVerification(f.db, accountId), { backups: 0, chunks: 0, keys: 1, quotaBytes: 0 });
  assert.equal((await f.request('key/read')).generation, 2);
});

test('S4 initial generation-one preparation preserves cloud backups and repeated publication does not invalidate unchanged data', async t => {
  const f = await fixture(t), draft = await enable(f), completed = await f.manager.run(ownerId), desktop = await desktopOnlyOffline(f);
  t.after(() => desktop.offline.close());
  const before = backupDeletionVerification(f.db, accountId);
  await desktop.publishInitial(); await desktop.publishInitial();
  assert.deepEqual(backupDeletionVerification(f.db, accountId), before); assert.equal((await f.request('key/read')).generation, 0);
  const restored = await downloadAndDecrypt(f, completed.backup, draft.recoveryCode); assert.ok(restored.rawArchive.includes(Buffer.from(phrase)));
  await desktop.offline.invalidate(ownerId);
  assert.deepEqual(desktop.publications, [1, 1, 2]); assert.equal((await f.request('key/read')).generation, 1);
  assert.deepEqual(backupDeletionVerification(f.db, accountId), { backups: 0, chunks: 0, keys: 1, quotaBytes: 0 });
});
