import { createHash, randomBytes } from 'node:crypto';
import { CompactEncrypt, importJWK } from 'jose';
import { pairingJkt } from './pairing.mjs';
import { digest, failure } from '../personal-access/common.mjs';

const fingerprint = bytes => createHash('sha256').update(bytes).digest('base64url');
const scope = (issuer, sub) => JSON.stringify([issuer, sub]);
const valid = s => typeof s === 'string' && /^[A-Za-z0-9_-]{43}$/.test(s);
const conflict = () => failure('ACCOUNT_KEY_CONFLICT', 409);

function keyBytes(encoded) {
  if (!valid(encoded)) throw failure('ACCOUNT_KEY_INVALID', 400);
  const bytes = Buffer.from(encoded, 'base64url');
  if (bytes.toString('base64url') !== encoded) throw failure('ACCOUNT_KEY_INVALID', 400);
  return bytes;
}

// A proposed key survives a lost registry response but cannot issue an invitation.
export function createAccountKeys(vault) {
  function read(slot) {
    const row = vault.read(slot);
    if (row === undefined) return null;
    if (!row || !['proposed', 'active'].includes(row.state) || !valid(row.secret))
      throw failure('STORAGE_UNAVAILABLE', 503);
    const bytes = keyBytes(row.secret);
    try { return { ...row, keyId: fingerprint(bytes) }; } finally { bytes.fill(0); }
  }
  function install(issuer, sub, keyId, encoded) {
    const bytes = keyBytes(encoded);
    try {
      if (fingerprint(bytes) !== keyId) throw failure('ACCOUNT_KEY_INVALID', 400);
      const slot = scope(issuer, sub), prior = read(slot);
      if (prior?.state === 'active' && prior.keyId !== keyId) throw conflict();
      if (prior?.state !== 'active') vault.write(slot, { state: 'active', secret: encoded });
      return keyId;
    } finally { bytes.fill(0); }
  }
  return {
    status(issuer, sub) {
      const row = read(scope(issuer, sub));
      return row?.state === 'active' ? row.keyId : null;
    },
    async initialize(issuer, sub, claim) {
      const slot = scope(issuer, sub);
      let row = read(slot);
      if (row?.state === 'active') return row.keyId;
      if (!row) {
        const bytes = randomBytes(32);
        try { vault.write(slot, { state: 'proposed', secret: bytes.toString('base64url') }); }
        finally { bytes.fill(0); }
        row = read(slot);
      }
      const registered = await claim(row.keyId);
      if (!valid(registered?.keyId)) throw failure('ACCOUNT_KEY_REGISTRY_UNAVAILABLE', 503);
      if (registered.keyId !== row.keyId) {
        const pending = read(slot);
        if (pending?.state === 'proposed' && pending.keyId === row.keyId) vault.remove(slot);
        throw conflict();
      }
      if (read(slot)?.keyId !== row.keyId) throw conflict();
      return install(issuer, sub, row.keyId, row.secret);
    },
    install,
    remove(issuer, sub) { vault.remove(scope(issuer, sub)); },
    async grant(pairing, publicJwk, now) {
      if (!pairing.keyId || !['confirmed','delivered'].includes(pairing.state) || pairing.expiresAt <= now())
        throw failure('PAIRING_INVALID', 401);
      const [, issuer, sub, hostId, , , challenge] = pairing.transcript;
      const row = read(scope(issuer, sub));
      if (row?.state !== 'active' || row.keyId !== pairing.keyId) throw conflict();
      if (!publicJwk || Object.keys(publicJwk).sort().join() !== 'crv,kty,x,y' ||
          publicJwk.kty !== 'EC' || publicJwk.crv !== 'P-256' || !valid(publicJwk.x) || !valid(publicJwk.y) ||
          pairingJkt(publicJwk) !== pairing.phone.nonce)
        throw failure('PAIRING_INVALID', 401);
      if (pairing.state === 'delivered') return {envelope:pairing.envelope};
      const receipt = randomBytes(32).toString('base64url');
      const recipient = await importJWK(publicJwk, 'ECDH-ES');
      const payload = Buffer.from(JSON.stringify([issuer, sub, hostId, challenge, pairing.phone.deviceId,
        pairing.phone.jkt, row.keyId, receipt, row.secret]));
      try {
        const envelope = await new CompactEncrypt(payload).setProtectedHeader({
          alg: 'ECDH-ES', enc: 'A256GCM', typ: 'wm-account-key+jwe',
        }).encrypt(recipient);
        if (pairing.expiresAt <= now()) throw failure('PAIRING_INVALID', 401);
        pairing.receiptHash = digest(receipt);
        pairing.envelope = envelope;
        pairing.state = 'delivered';
        return {envelope};
      } finally { payload.fill(0); }
    },
  };
}
