import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { snapshot } from '../src/personal-backup/archive.mjs';
import { generateRecoveryCode, validateRecoveryCode, wrapMasterKey, unwrapMasterKey, encryptBackup, decryptBackup,
  cloudBackupChunkFile, CLOUD_BACKUP_CHUNK_SIZE } from '../src/personal-cloud-backup/crypto.mjs';

const accountId = 'synthetic-cloud-owner';
const phrase = 'Synthetic conversation: my unique woven memory is cobalt apricot 314159.';
const apiKey = 'synthetic-secret-model-and-connector-key-271828';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t, large = false) {
  const base = await mkdtemp(path.join(tmpdir(), 'weftmate-cloud-crypto-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'profile'), local = path.join(base, 'local'), directory = path.join(base, 'encrypted');
  await mkdir(root); await mkdir(local);
  await writeFile(path.join(root, 'setting.json'), JSON.stringify({ title: phrase, models: ['synthetic-model'] }));
  if (large) await writeFile(path.join(root, 'synthetic-payload.bin'), randomBytes(CLOUD_BACKUP_CHUNK_SIZE * 2 + 3072));
  const row = await snapshot({ root, directory: local });
  const archiveFile = path.join(local, row.id), masterKey = randomBytes(32), backupId = randomUUID(), keyId = randomUUID();
  const credentials = { model: { key: apiKey }, connectors: { synthetic: { authorization: apiKey } } };
  const manifest = await encryptBackup({ archiveFile, credentials, accountId, backupId, keyId, masterKey, directory });
  const outputFile = path.join(base, 'restored.wmb');
  return { base, archiveFile, masterKey, keyId, credentials, manifest, directory, outputFile,
    decrypt: extra => decryptBackup({ manifest, directory, accountId, masterKey, outputFile, ...extra }) };
}

test('S4 recovery code has eight 40-bit groups with checked, unambiguous characters', () => {
  const codes = Array.from({ length: 30 }, generateRecoveryCode);
  assert.equal(new Set(codes).size, codes.length);
  for (const code of codes) {
    assert.match(code, /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{10}(?:-[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{10}){7}$/);
    assert.deepEqual(validateRecoveryCode(code), { valid: true, normalized: code, invalidGroups: [] });
    assert.equal(validateRecoveryCode(code.toLowerCase().replaceAll('-', ' \n ')).normalized, code);
    assert.equal(validateRecoveryCode(code.replaceAll('-', '')).normalized, code);
  }
});

test('S4 chunk file paths accept only integer indices within the protocol bound', () => {
  const directory = path.join('synthetic-cloud-data', 'synthetic-backup');
  assert.equal(cloudBackupChunkFile(directory, 0), path.join(directory, '0.chunk'));
  assert.equal(cloudBackupChunkFile(directory, 511), path.join(directory, '511.chunk'));
  for (const index of ['0', '../synthetic-escape', '0/../synthetic-escape', -1, 512, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null]) {
    assert.throws(() => cloudBackupChunkFile(directory, index), { code: 'CLOUD_BACKUP_CORRUPT' });
  }
});

test('S4 recovery code identifies each mistyped group before decryption', () => {
  const code = generateRecoveryCode(), groups = code.split('-');
  for (let index = 0; index < groups.length; index++) {
    const changed = [...groups]; changed[index] = changed[index].slice(0, 9) + (changed[index][9] === '0' ? '1' : '0');
    const result = validateRecoveryCode(changed.join('-'));
    assert.equal(result.valid, false); assert.deepEqual(result.invalidGroups, [index + 1]);
    changed[index] = 'O' + groups[index].slice(1);
    assert.deepEqual(validateRecoveryCode(changed.join('-')).invalidGroups, [index + 1], 'ambiguous aliases are rejected');
    changed[index] = groups[index].slice(1);
    assert.deepEqual(validateRecoveryCode(changed.join('-')).invalidGroups, [index + 1], 'separated group length errors remain localized');
  }
  const malformed = ['', null, 'a'.repeat(257), groups.slice(0, 7).join('-')];
  for (const value of malformed) assert.equal(validateRecoveryCode(value).valid, false);
});

test('S4 key envelope authenticates recovery code, account, key ID and protocol', () => {
  const master = randomBytes(32), code = generateRecoveryCode(), envelope = wrapMasterKey(master, code, accountId);
  assert.deepEqual(unwrapMasterKey(envelope, code, accountId), master);
  assert.throws(() => unwrapMasterKey(envelope, generateRecoveryCode(), accountId), { code: 'CLOUD_BACKUP_RECOVERY_MISMATCH' });
  assert.throws(() => unwrapMasterKey(envelope, code, 'another-synthetic-account'), { code: 'CLOUD_BACKUP_RECOVERY_MISMATCH' });
  assert.throws(() => unwrapMasterKey({ ...envelope, keyId: randomUUID() }, code, accountId), { code: 'CLOUD_BACKUP_RECOVERY_MISMATCH' });
  assert.throws(() => unwrapMasterKey({ ...envelope, version: 2 }, code, accountId), { code: 'CLOUD_BACKUP_NEWER_VERSION' });
  assert.throws(() => unwrapMasterKey({ ...envelope, protocol: 'another-protocol' }, code, accountId), { code: 'CLOUD_BACKUP_KEY_CORRUPT' });
  for (const field of ['iv', 'salt', 'tag', 'ciphertext']) {
    assert.throws(() => unwrapMasterKey({ ...envelope, [field]: 'x' }, code, accountId), { code: 'CLOUD_BACKUP_KEY_CORRUPT' });
  }
  const groups = code.split('-'); groups[3] = 'I' + groups[3].slice(1);
  assert.throws(() => unwrapMasterKey(envelope, groups.join('-'), accountId), { code: 'CLOUD_BACKUP_RECOVERY_CODE', invalidGroups: [4] });
  const tag = Buffer.from(envelope.tag, 'base64url'); tag[0] ^= 1;
  assert.throws(() => unwrapMasterKey({ ...envelope, tag: tag.toString('base64url') }, code, accountId), { code: 'CLOUD_BACKUP_RECOVERY_MISMATCH' });
});

test('S4 rotating recovery code preserves master key and invalidates old code against current envelope', () => {
  const master = randomBytes(32), code = generateRecoveryCode(), old = wrapMasterKey(master, code, accountId);
  const replacementCode = generateRecoveryCode(), current = wrapMasterKey(master, replacementCode, accountId, old.keyId);
  assert.equal(current.keyId, old.keyId);
  assert.deepEqual(unwrapMasterKey(current, replacementCode, accountId), master);
  assert.throws(() => unwrapMasterKey(current, code, accountId), { code: 'CLOUD_BACKUP_RECOVERY_MISMATCH' });
  assert.deepEqual(unwrapMasterKey(old, code, accountId), master, 'changing a code cannot revoke a previously stolen envelope');
});

test('S4 encrypted upload bytes contain neither synthetic conversation nor synthetic credentials', async t => {
  const f = await fixture(t, true), code = generateRecoveryCode(), envelope = wrapMasterKey(f.masterKey, code, accountId, f.keyId);
  assert.equal(f.manifest.chunkCount, 3);
  const uploaded = [Buffer.from(JSON.stringify(f.manifest)), Buffer.from(JSON.stringify(envelope))];
  for (const row of f.manifest.chunks) {
    const bytes = await readFile(cloudBackupChunkFile(f.directory, row.index)); uploaded.push(bytes);
    assert.equal(bytes.length, row.size); assert.equal(hash(bytes), row.hash);
    assert.ok(row.size <= CLOUD_BACKUP_CHUNK_SIZE + 16);
  }
  const completeUpload = Buffer.concat(uploaded);
  for (const secret of [phrase, apiKey, code, f.masterKey]) {
    assert.equal(completeUpload.includes(Buffer.isBuffer(secret) ? secret : Buffer.from(secret)), false);
  }
  assert.equal(hash(Buffer.concat(uploaded.slice(2))), f.manifest.packageHash);
  const credentials = await f.decrypt(); assert.deepEqual(credentials, f.credentials);
  assert.deepEqual(await readFile(f.outputFile), await readFile(f.archiveFile));
  assert.ok(gunzipSync(await readFile(f.outputFile)).includes(Buffer.from(phrase)));
  assert.equal(gunzipSync(await readFile(f.outputFile)).includes(Buffer.from(apiKey)), false, 'secret credentials are a separately encrypted mapping');
  assert.ok(!(await readdir(f.base)).some(name => name.endsWith('.cloud-tmp')));
});

test('S4 tampered chunk, ciphertext hash, IV, account, master key and backup ID fail without publishing data', async t => {
  const f = await fixture(t), bytes = await readFile(cloudBackupChunkFile(f.directory, 0));
  const prior = Buffer.from('synthetic current archive must survive failed recovery'); await writeFile(f.outputFile, prior);
  const corrupt = Buffer.from(bytes); corrupt[0] ^= 128;
  await writeFile(cloudBackupChunkFile(f.directory, 0), corrupt);
  await assert.rejects(f.decrypt(), { code: 'CLOUD_BACKUP_CORRUPT' });
  const forged = structuredClone(f.manifest); forged.chunks[0].hash = hash(corrupt); forged.packageHash = hash(corrupt);
  await assert.rejects(f.decrypt({ manifest: forged }), { code: 'CLOUD_BACKUP_CORRUPT' }, 'changing server-visible hashes cannot forge GCM authentication');
  await writeFile(cloudBackupChunkFile(f.directory, 0), bytes);
  for (const changed of [
    { accountId: 'another-synthetic-account' }, { masterKey: randomBytes(32) },
    { manifest: { ...f.manifest, id: randomUUID() } },
    { manifest: { ...f.manifest, packageHash: 'f'.repeat(64) } },
    { manifest: { ...f.manifest, chunks: [{ ...f.manifest.chunks[0], iv: randomBytes(12).toString('base64url') }] } },
  ]) await assert.rejects(f.decrypt(changed), { code: 'CLOUD_BACKUP_CORRUPT' });
  assert.deepEqual(await readFile(f.outputFile), prior);
  assert.ok(!(await readdir(f.base)).some(name => name.endsWith('.cloud-tmp')));
});

test('S4 missing, reordered, duplicated, truncated and newer chunks are rejected', async t => {
  const f = await fixture(t, true), original = await readFile(cloudBackupChunkFile(f.directory, 1));
  await rm(cloudBackupChunkFile(f.directory, 1));
  await assert.rejects(f.decrypt(), { code: 'CLOUD_BACKUP_CHUNKS_MISSING' });
  await writeFile(cloudBackupChunkFile(f.directory, 1), original);
  const reordered = structuredClone(f.manifest); reordered.chunks.reverse();
  await assert.rejects(f.decrypt({ manifest: reordered }), { code: 'CLOUD_BACKUP_CORRUPT' });
  const duplicated = structuredClone(f.manifest); duplicated.chunks[1] = duplicated.chunks[0];
  await assert.rejects(f.decrypt({ manifest: duplicated }), { code: 'CLOUD_BACKUP_CORRUPT' });
  const missing = structuredClone(f.manifest); missing.chunks.pop();
  await assert.rejects(f.decrypt({ manifest: missing }), { code: 'CLOUD_BACKUP_CORRUPT' });
  await writeFile(cloudBackupChunkFile(f.directory, 1), original.subarray(0, -1));
  await assert.rejects(f.decrypt(), { code: 'CLOUD_BACKUP_CORRUPT' });
  await assert.rejects(f.decrypt({ manifest: { ...f.manifest, version: 2 } }), { code: 'CLOUD_BACKUP_NEWER_VERSION' });
  await assert.rejects(readFile(f.outputFile), { code: 'ENOENT' });
  assert.ok(!(await readdir(f.base)).some(name => name.endsWith('.cloud-tmp')));
});

test('S4 swapping chunk bytes and metadata cannot change authenticated chunk order', async t => {
  const f = await fixture(t, true), manifest = structuredClone(f.manifest);
  const first = await readFile(cloudBackupChunkFile(f.directory, 0)), second = await readFile(cloudBackupChunkFile(f.directory, 1));
  await writeFile(cloudBackupChunkFile(f.directory, 0), second); await writeFile(cloudBackupChunkFile(f.directory, 1), first);
  manifest.chunks[0] = { ...f.manifest.chunks[1], index: 0 }; manifest.chunks[1] = { ...f.manifest.chunks[0], index: 1 };
  const all = [];
  for (const row of manifest.chunks) all.push(await readFile(cloudBackupChunkFile(f.directory, row.index)));
  manifest.packageHash = hash(Buffer.concat(all));
  await assert.rejects(f.decrypt({ manifest }), { code: 'CLOUD_BACKUP_CORRUPT' });
  await assert.rejects(readFile(f.outputFile), { code: 'ENOENT' });
});

test('S4 decrypted archive must pass BK-1 verification before it can replace a destination', async t => {
  const f = await fixture(t); await writeFile(f.archiveFile, 'synthetic broken local archive');
  const nextDirectory = path.join(f.base, 'broken-encrypted');
  const manifest = await encryptBackup({ archiveFile: f.archiveFile, credentials: f.credentials, accountId,
    backupId: randomUUID(), keyId: f.keyId, masterKey: f.masterKey, directory: nextDirectory });
  const prior = Buffer.from('synthetic prior data'); await writeFile(f.outputFile, prior);
  await assert.rejects(f.decrypt({ manifest, directory: nextDirectory }), { code: 'CLOUD_BACKUP_CORRUPT' });
  assert.deepEqual(await readFile(f.outputFile), prior);
});

test('S4 backups from a newer application require upgrading without replacing existing data; same/newer applications and legacy packages restore', async t => {
  const f = await fixture(t), directory = path.join(f.base, 'versioned-encrypted');
  const manifest = await encryptBackup({ archiveFile: f.archiveFile, credentials: f.credentials, accountId,
    backupId: randomUUID(), keyId: f.keyId, masterKey: f.masterKey, directory, appVersion: '9.2.0' });
  const prior = Buffer.from('synthetic existing data remains while an upgrade is required'); await writeFile(f.outputFile, prior);
  assert.equal(JSON.stringify(manifest).includes('appVersion'), false, 'application version remains inside the authenticated encrypted header');
  await assert.rejects(f.decrypt({ manifest, directory, appVersion: '9.1.99' }), { code: 'CLOUD_BACKUP_NEWER_VERSION' });
  assert.deepEqual(await readFile(f.outputFile), prior);
  assert.ok(!(await readdir(f.base)).some(name => name.endsWith('.cloud-tmp')));
  for (const appVersion of ['9.2.0', '10.0.0']) {
    assert.deepEqual(await f.decrypt({ manifest, directory, appVersion }), f.credentials);
    assert.deepEqual(await readFile(f.outputFile), await readFile(f.archiveFile));
  }
  assert.deepEqual(await f.decrypt({ appVersion: '0.1.0' }), f.credentials, 'old packages without an application version remain compatible');
  assert.deepEqual(await readFile(f.outputFile), await readFile(f.archiveFile));
});
