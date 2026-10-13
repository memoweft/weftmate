import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { verify } from '../personal-backup/archive.mjs';
import { compareVersions } from '../personal-update/manifest.mjs';

export const CLOUD_BACKUP_VERSION = 1;
export const CLOUD_BACKUP_CHUNK_SIZE = 1024 * 1024;
export const CLOUD_BACKUP_MAX_CHUNKS = 512;
const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const keyProtocol = 'wm-cloud-key/1';
const payloadProtocol = 'wm-cloud-backup-payload/1';
const maxHeader = 8 * 1024 * 1024;
const error = (code, extra = {}) => Object.assign(new Error(code), { code, status: 409, ...extra });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const account = value => typeof value === 'string' && value.length > 0 && value.length <= 512;

function checksum(group, index) {
  const bytes = createHash('sha256').update(`wm-cloud-recovery/1\0${index + 1}\0${group}`).digest();
  return alphabet[bytes[0] >> 3] + alphabet[((bytes[0] & 7) << 2) | (bytes[1] >> 6)];
}
function encodeGroup(bytes) {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let result = '';
  for (let i = 0; i < 8; i++) { result = alphabet[Number(value & 31n)] + result; value >>= 5n; }
  return result;
}

/** Eight independently checked, 40-bit groups; no ambiguous character aliases. */
export function generateRecoveryCode() {
  return Array.from({ length: 8 }, (_, index) => {
    const group = encodeGroup(randomBytes(5));
    return group + checksum(group, index);
  }).join('-');
}

export function validateRecoveryCode(value) {
  if (typeof value !== 'string' || value.length > 256) return { valid: false, normalized: '', invalidGroups: [], reason: 'format' };
  const text = value.trim().toUpperCase();
  const separated = text.split(/[\s-]+/).filter(Boolean);
  const compact = separated.join('');
  const groups = separated.length === 8 ? separated : compact.match(/.{1,10}/g) ?? [];
  if (groups.length !== 8) return { valid: false, normalized: '', invalidGroups: [], reason: 'format' };
  const invalidGroups = [];
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index];
    if (!/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{10}$/.test(group) || group.slice(8) !== checksum(group.slice(0, 8), index)) invalidGroups.push(index + 1);
  }
  return { valid: invalidGroups.length === 0, normalized: invalidGroups.length ? '' : groups.join('-'), invalidGroups,
    ...(invalidGroups.length ? { reason: 'checksum' } : {}) };
}

function recoveryBytes(code) {
  const check = validateRecoveryCode(code);
  if (!check.valid) throw error('CLOUD_BACKUP_RECOVERY_CODE', { invalidGroups: check.invalidGroups });
  const bytes = Buffer.alloc(40);
  for (const [index, group] of check.normalized.split('-').entries()) {
    let value = 0n;
    for (const character of group.slice(0, 8)) value = (value << 5n) | BigInt(alphabet.indexOf(character));
    for (let byte = 4; byte >= 0; byte--) { bytes[index * 5 + byte] = Number(value & 255n); value >>= 8n; }
  }
  return bytes;
}
function base64(value, length, code) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw error(code);
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== length || bytes.toString('base64url') !== value) throw error(code);
  return bytes;
}
function master(value) {
  if (!Buffer.isBuffer(value) || value.length !== 32) throw error('CLOUD_BACKUP_KEY_INVALID');
  return value;
}
function wrappingKey(code, salt) {
  const bytes = recoveryBytes(code);
  try { return Buffer.from(hkdfSync('sha256', bytes, salt, 'wm-cloud-key/wrapping/1', 32)); }
  finally { bytes.fill(0); }
}
const keyAAD = (accountId, keyId) => Buffer.from(JSON.stringify([keyProtocol, 1, accountId, keyId]));

export function wrapMasterKey(masterKey, recoveryCode, accountId, keyId = randomUUID()) {
  master(masterKey);
  if (!account(accountId) || !id(keyId)) throw error('CLOUD_BACKUP_KEY_INVALID');
  const salt = randomBytes(32), iv = randomBytes(12), wrapping = wrappingKey(recoveryCode, salt);
  try {
    const cipher = createCipheriv('aes-256-gcm', wrapping, iv);
    cipher.setAAD(keyAAD(accountId, keyId));
    const ciphertext = Buffer.concat([cipher.update(masterKey), cipher.final()]);
    return { protocol: keyProtocol, version: 1, keyId, salt: salt.toString('base64url'), iv: iv.toString('base64url'),
      ciphertext: ciphertext.toString('base64url'), tag: cipher.getAuthTag().toString('base64url') };
  } finally { wrapping.fill(0); }
}

export function unwrapMasterKey(envelope, recoveryCode, accountId) {
  if (object(envelope) && Number.isSafeInteger(envelope.version) && envelope.version > 1) throw error('CLOUD_BACKUP_NEWER_VERSION');
  const invalid = 'CLOUD_BACKUP_KEY_CORRUPT';
  if (!object(envelope) || envelope.protocol !== keyProtocol || envelope.version !== 1 || !id(envelope.keyId) || !account(accountId)) throw error(invalid);
  const salt = base64(envelope.salt, 32, invalid), iv = base64(envelope.iv, 12, invalid);
  const ciphertext = base64(envelope.ciphertext, 32, invalid), tag = base64(envelope.tag, 16, invalid);
  const wrapping = wrappingKey(recoveryCode, salt);
  try {
    const cipher = createDecipheriv('aes-256-gcm', wrapping, iv);
    cipher.setAAD(keyAAD(accountId, envelope.keyId)); cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(ciphertext), cipher.final()]);
  } catch { throw error('CLOUD_BACKUP_RECOVERY_MISMATCH'); }
  finally { wrapping.fill(0); }
}

function backupKey(masterKey, accountId, backupId) {
  master(masterKey);
  if (!account(accountId) || !id(backupId)) throw error('CLOUD_BACKUP_KEY_INVALID');
  const salt = createHash('sha256').update(JSON.stringify([accountId, backupId])).digest();
  return Buffer.from(hkdfSync('sha256', masterKey, salt, 'wm-cloud-backup/content/1', 32));
}
const chunkAAD = (accountId, backupId, chunkCount, index) => Buffer.from(JSON.stringify(['wm-cloud-backup/1', 1, accountId, backupId, chunkCount, index]));
export const cloudBackupChunkFile = (directory, index) => {
  if(!Number.isSafeInteger(index)||index<0||index>=CLOUD_BACKUP_MAX_CHUNKS)throw error('CLOUD_BACKUP_CORRUPT');
  return path.join(directory,`${index}.chunk`);
};

async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}

/** The directory is a caller-owned, unique staging directory. Only ciphertext is saved there. */
export async function encryptBackup({ archiveFile, credentials = {}, accountId, backupId, keyId, masterKey, directory, appVersion = null }) {
  if (!object(credentials) || !id(keyId)) throw error('CLOUD_BACKUP_KEY_INVALID');
  const encryptionKey = backupKey(masterKey, accountId, backupId), published = [];
  try {
    const archiveSize = (await stat(archiveFile)).size;
    if (!Number.isSafeInteger(archiveSize) || archiveSize < 1) throw error('CLOUD_BACKUP_CORRUPT');
    const header = Buffer.from(JSON.stringify({ protocol: payloadProtocol, version: 1, archiveSize, archiveHash: await fileHash(archiveFile), credentials,
      ...(appVersion?{appVersion}:{}) }));
    if (header.length > maxHeader) throw error('CLOUD_BACKUP_TOO_LARGE');
    const prefix = Buffer.alloc(4); prefix.writeUInt32BE(header.length);
    const payloadSize = 4 + header.length + archiveSize;
    const chunkCount = Math.ceil(payloadSize / CLOUD_BACKUP_CHUNK_SIZE);
    if (chunkCount > CLOUD_BACKUP_MAX_CHUNKS) throw error('CLOUD_BACKUP_TOO_LARGE');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const manifest = { id: backupId, version: 1, keyId, createdAt: new Date().toISOString(), totalBytes: payloadSize + chunkCount * 16,
      chunkCount, packageHash: '', chunks: [] };
    const packageHash = createHash('sha256');
    let index = 0, buffered = Buffer.alloc(0), processed = 0;
    async function emit(bytes) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
      cipher.setAAD(chunkAAD(accountId, backupId, chunkCount, index));
      const encrypted = Buffer.concat([cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
      const target = cloudBackupChunkFile(directory, index);
      await writeFile(target, encrypted, { flag: 'wx', mode: 0o600 }); published.push(target);
      packageHash.update(encrypted);
      manifest.chunks.push({ index, size: encrypted.length, hash: sha(encrypted), iv: iv.toString('base64url') });
      processed += bytes.length; index++;
    }
    async function consume(bytes) {
      let offset = 0;
      while (offset < bytes.length) {
        const take = Math.min(CLOUD_BACKUP_CHUNK_SIZE - buffered.length, bytes.length - offset);
        buffered = Buffer.concat([buffered, bytes.subarray(offset, offset + take)]); offset += take;
        if (buffered.length === CLOUD_BACKUP_CHUNK_SIZE) { await emit(buffered); buffered.fill(0); buffered = Buffer.alloc(0); }
      }
    }
    await consume(prefix); await consume(header);
    for await (const bytes of createReadStream(archiveFile, { highWaterMark: 256 * 1024 })) await consume(bytes);
    if (buffered.length) { await emit(buffered); buffered.fill(0); }
    header.fill(0);
    if (processed !== payloadSize || index !== chunkCount) throw error('CLOUD_BACKUP_CORRUPT');
    manifest.packageHash = packageHash.digest('hex');
    return manifest;
  } catch (caught) {
    for (const file of published) await rm(file, { force: true });
    throw caught;
  } finally { encryptionKey.fill(0); }
}

export function validateCloudBackupManifest(manifest) {
  if (object(manifest) && Number.isSafeInteger(manifest.version) && manifest.version > 1) throw error('CLOUD_BACKUP_NEWER_VERSION');
  const invalid = 'CLOUD_BACKUP_CORRUPT';
  if (!object(manifest) || manifest.version !== 1 || !id(manifest.id) || !id(manifest.keyId) ||
    typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt)) ||
    !Number.isSafeInteger(manifest.chunkCount) || manifest.chunkCount < 1 || manifest.chunkCount > CLOUD_BACKUP_MAX_CHUNKS ||
    !Array.isArray(manifest.chunks) || manifest.chunks.length !== manifest.chunkCount ||
    !/^[a-f0-9]{64}$/.test(manifest.packageHash) || !Number.isSafeInteger(manifest.totalBytes)) throw error(invalid);
  let total = 0;
  for (let index = 0; index < manifest.chunkCount; index++) {
    const row = manifest.chunks[index];
    if (!object(row) || row.index !== index || !Number.isSafeInteger(row.size) || row.size < 17 || row.size > CLOUD_BACKUP_CHUNK_SIZE + 16 ||
      (index < manifest.chunkCount - 1 && row.size !== CLOUD_BACKUP_CHUNK_SIZE + 16) || !/^[a-f0-9]{64}$/.test(row.hash)) throw error(invalid);
    base64(row.iv, 12, invalid); total += row.size;
  }
  if (total !== manifest.totalBytes) throw error(invalid);
}

/** Authenticate the complete package, validate BK-1, then atomically publish its archive. */
export async function decryptBackup({ manifest, directory, accountId, masterKey, outputFile, appVersion = null }) {
  validateCloudBackupManifest(manifest);
  const encryptionKey = backupKey(masterKey, accountId, manifest.id);
  const temporary = path.join(path.dirname(outputFile), `.${path.basename(outputFile)}.${randomUUID()}.cloud-tmp`);
  let handle, headerBytes = Buffer.alloc(0), headerLength = null, header = null, archiveBytes = 0;
  const archiveHash = createHash('sha256'), packageHash = createHash('sha256');
  try {
    await mkdir(path.dirname(outputFile), { recursive: true, mode: 0o700 });
    handle = await open(temporary, 'wx', 0o600);
    for (const row of manifest.chunks) {
      let encrypted;
      try {
        if ((await stat(cloudBackupChunkFile(directory, row.index))).size !== row.size) throw error('CLOUD_BACKUP_CORRUPT');
        encrypted = await readFile(cloudBackupChunkFile(directory, row.index));
      } catch (caught) {
        if (caught.code === 'ENOENT') throw error('CLOUD_BACKUP_CHUNKS_MISSING');
        throw caught;
      }
      if (encrypted.length !== row.size || sha(encrypted) !== row.hash) throw error('CLOUD_BACKUP_CORRUPT');
      packageHash.update(encrypted);
      const cipher = createDecipheriv('aes-256-gcm', encryptionKey, base64(row.iv, 12, 'CLOUD_BACKUP_CORRUPT'));
      cipher.setAAD(chunkAAD(accountId, manifest.id, manifest.chunkCount, row.index));
      cipher.setAuthTag(encrypted.subarray(-16));
      let plaintext;
      try { plaintext = Buffer.concat([cipher.update(encrypted.subarray(0, -16)), cipher.final()]); }
      catch { throw error('CLOUD_BACKUP_CORRUPT'); }
      try {
        if (!header) {
          headerBytes = Buffer.concat([headerBytes, plaintext]);
          if (headerLength === null && headerBytes.length >= 4) {
            headerLength = headerBytes.readUInt32BE(0);
            if (headerLength < 1 || headerLength > maxHeader) throw error('CLOUD_BACKUP_CORRUPT');
          }
          if (headerLength === null || headerBytes.length < 4 + headerLength) continue;
          try { header = JSON.parse(headerBytes.subarray(4, 4 + headerLength).toString('utf8')); }
          catch { throw error('CLOUD_BACKUP_CORRUPT'); }
          if (object(header) && Number.isSafeInteger(header.version) && header.version > 1) throw error('CLOUD_BACKUP_NEWER_VERSION');
          if (header?.appVersion && appVersion) {
            let newer;try{newer=compareVersions(header.appVersion,appVersion)>0;}catch{throw error('CLOUD_BACKUP_CORRUPT');}
            if(newer)throw error('CLOUD_BACKUP_NEWER_VERSION');
          }
          if (!object(header) || header.protocol !== payloadProtocol || header.version !== 1 || !object(header.credentials) ||
            !Number.isSafeInteger(header.archiveSize) || header.archiveSize < 1 || !/^[a-f0-9]{64}$/.test(header.archiveHash)) throw error('CLOUD_BACKUP_CORRUPT');
          plaintext.fill(0); plaintext = Buffer.from(headerBytes.subarray(4 + headerLength)); headerBytes.fill(0); headerBytes = Buffer.alloc(0);
        }
        archiveBytes += plaintext.length;
        if (archiveBytes > header.archiveSize) throw error('CLOUD_BACKUP_CORRUPT');
        archiveHash.update(plaintext); await handle.writeFile(plaintext);
      } finally { plaintext.fill(0); }
    }
    if (!header || archiveBytes !== header.archiveSize || archiveHash.digest('hex') !== header.archiveHash || packageHash.digest('hex') !== manifest.packageHash) throw error('CLOUD_BACKUP_CORRUPT');
    await handle.sync(); await handle.close(); handle = null;
    try { await verify(temporary); } catch { throw error('CLOUD_BACKUP_CORRUPT'); }
    await rename(temporary, outputFile);
    return header.credentials;
  } finally {
    encryptionKey.fill(0); headerBytes.fill(0); await handle?.close(); await rm(temporary, { force: true });
  }
}
