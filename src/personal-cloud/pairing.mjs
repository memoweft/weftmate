import { createHash } from 'node:crypto';
import { hash } from './proofs.mjs';

export const PAIRING_MS = 120_000;
// JSON arrays, UTF-8, no whitespace; thumbprints use RFC 7638 member order.
export const pairingJkt = jwk => hash(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }));
export const hostCommitment = (transcript, nonce) => hash(JSON.stringify(['wm-pair-host-v2', ...transcript, nonce]));
export const phoneCommitment = (challenge, deviceId, jkt, nonce) =>
  hash(JSON.stringify(['wm-pair-phone-v2', challenge, deviceId, jkt, nonce]));
export const verificationCode = pairing => (createHash('sha256').update(JSON.stringify([
  'wm-pair-sas-v2', ...pairing.transcript, pairing.hostNonce,
  pairing.phone.deviceId, pairing.phone.jkt, pairing.phone.nonce,
])).digest().readUInt32BE(0) % 1_000_000).toString().padStart(6, '0');
export const pairingState = (pairing, now) =>
  ['completed', 'cancelled'].includes(pairing.state) ? pairing.state : pairing.expiresAt <= now ? 'expired' : pairing.state;
export const pairingStatus = (pairing, now) => ({ state: pairingState(pairing, now), expiresAt: pairing.expiresAt,
  ...(pairing.phone ? { deviceName: pairing.phone.name } : {}),
  ...(['comparing', 'confirmed', 'completed'].includes(pairingState(pairing, now)) ? { verificationCode: verificationCode(pairing) } : {}) });
