import path from 'node:path';
import { cp, lstat, readdir, readFile } from 'node:fs/promises';
import { generateKeyPair, exportJWK, exportSPKI } from 'jose';
import { ensurePrivateDirectory, ensurePrivateFile } from '../private-host-storage.mjs';
import { durableWrite } from '../personal-access/store.mjs';
import { failure, plainObject } from '../personal-access/common.mjs';
import { hash, publicKey } from './proofs.mjs';

// Run before the access store's existing legacy migrations, and only once.
export async function backupBeforeCloud(root) {
  const dir = path.join(root, 'cloud-identity');
  await ensurePrivateDirectory(dir);
  const marker = path.join(dir, 'backup-complete.json');
  try { await ensurePrivateFile(marker); return; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const destination = path.join(dir, 'backup');
  await ensurePrivateDirectory(destination);
  for (const name of await readdir(root)) {
    if (name === 'cloud-identity') continue;
    const source = path.join(root, name);
    if ((await lstat(source)).isSymbolicLink()) throw failure('STORE_CORRUPT', 500);
    await cp(source, path.join(destination, name), { recursive: true, force: true, dereference: false });
  }
  await durableWrite(marker, { version: 1, completedAt: new Date().toISOString() });
}

export function validateIdentity(state, hostId) {
  if (!plainObject(state) || state.version !== 1 || state.hostId !== hostId ||
      !state.installation?.privateJwk?.d || !publicKey(state.installation.publicJwk) ||
      !state.tls?.privateJwk?.d || typeof state.tls.spki !== 'string' ||
      !Number.isSafeInteger(state.watermark) || state.watermark < 0 ||
      ['claims', 'bindings', 'devices', 'sessions', 'nonces', 'replays', 'pairings', 'epochs', 'outbox']
        .some(key => !plainObject(state[key]))) throw failure('STORE_CORRUPT', 500);
  for (const binding of Object.values(state.bindings)) {
    if (!['pending', 'active', 'unbound'].includes(binding.status) || typeof binding.ownerId !== 'string' ||
        typeof binding.sub !== 'string' || typeof binding.issuer !== 'string' ||
        typeof binding.claimId !== 'string') throw failure('STORE_CORRUPT', 500);
  }
  for (const device of Object.values(state.devices)) {
    if (!['pending', 'trusted', 'denied', 'revoked'].includes(device.status) ||
        !publicKey(device.publicJwk) || typeof device.ownerId !== 'string' ||
        typeof device.jkt !== 'string' || typeof device.bindingKey !== 'string') throw failure('STORE_CORRUPT', 500);
  }
  return state;
}

export async function openIdentity(root, hostId) {
  const file = path.join(root, 'cloud-identity', 'identity.json');
  let state;
  try {
    await ensurePrivateFile(file);
    state = validateIdentity(JSON.parse(await readFile(file, 'utf8')), hostId);
  } catch (error) {
    if (error.code !== 'ENOENT') throw failure('STORE_CORRUPT', 500);
    const installation = await generateKeyPair('ES256', { extractable: true });
    const tls = await generateKeyPair('ES256', { extractable: true });
    state = { version: 1, hostId, installation: {
      privateJwk: await exportJWK(installation.privateKey), publicJwk: await exportJWK(installation.publicKey),
    }, tls: { privateJwk: await exportJWK(tls.privateKey), spki: hash(Buffer.from(
      (await exportSPKI(tls.publicKey)).replace(/-----[^-]+-----|\s/g, ''), 'base64')) },
    watermark: 0, claims: {}, bindings: {}, devices: {}, sessions: {}, nonces: {},
    replays: {}, pairings: {}, epochs: {}, outbox: {} };
    await durableWrite(file, state);
  }
  return { get state() { return state; }, async write(next) {
    validateIdentity(next, hostId);
    await durableWrite(file, next);
    state = next;
  } };
}
