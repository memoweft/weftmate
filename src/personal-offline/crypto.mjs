import { createCipheriv, createHash, createPublicKey, publicEncrypt, randomBytes, constants } from 'node:crypto';

export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export function publicDeviceKey(jwk) {
  if (!jwk || jwk.kty !== 'RSA' || jwk.e !== 'AQAB' || typeof jwk.n !== 'string' ||
      Buffer.from(jwk.n, 'base64url').length !== 256 || Object.keys(jwk).some(k => !['kty', 'n', 'e', 'alg', 'key_ops', 'ext'].includes(k)))
    throw Object.assign(new Error('INVALID_REQUEST'), { code: 'INVALID_REQUEST', status: 400 });
  return { kty: 'RSA', n: jwk.n, e: jwk.e };
}
export function sealReplica(payload, jwk, identity) {
  const key = randomBytes(32), iv = randomBytes(12);
  const aad = Buffer.from(JSON.stringify({ version: 1, ...identity, keyId: hash(publicDeviceKey(jwk)) }));
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  const wrappedKey = publicEncrypt({ key: createPublicKey({ key: jwk, format: 'jwk' }),
    padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key);
  key.fill(0);
  return { version: 1, algorithm: 'RSA-OAEP-256+A256GCM', aad: aad.toString('base64url'),
    wrappedKey: wrappedKey.toString('base64url'), iv: iv.toString('base64url'), ciphertext: ciphertext.toString('base64url') };
}
