import { createCipheriv, createDecipheriv, createHash, createPublicKey, createPrivateKey, publicEncrypt, privateDecrypt, randomBytes, constants, generateKeyPairSync } from 'node:crypto';

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

// S7 uses the same device envelope as replicas, with the computer as recipient.
export function taskRecipient() {
  const pair = generateKeyPairSync('rsa', {modulusLength:2048});
  return {publicJwk:publicDeviceKey(pair.publicKey.export({format:'jwk'})),privateJwk:pair.privateKey.export({format:'jwk'})};
}
export function openTask(envelope, recipient, identity) {
  let key;
  try {
    if(envelope.version!==1||envelope.algorithm!=='RSA-OAEP-256+A256GCM')throw new Error();
    const aad=Buffer.from(envelope.aad,'base64url'), header=JSON.parse(aad.toString());
    if(header.version!==1||header.keyId!==hash(recipient.publicJwk)||Object.entries(identity).some(([k,v])=>header[k]!==v))throw new Error();
    key=privateDecrypt({key:createPrivateKey({key:recipient.privateJwk,format:'jwk'}),padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(envelope.wrappedKey,'base64url'));
    const ciphertext=Buffer.from(envelope.ciphertext,'base64url'),cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64url'));
    cipher.setAAD(aad);cipher.setAuthTag(ciphertext.subarray(-16));
    return JSON.parse(Buffer.concat([cipher.update(ciphertext.subarray(0,-16)),cipher.final()]).toString());
  }catch{throw Object.assign(new Error('OFFLINE_TASK_INVALID'),{code:'OFFLINE_TASK_INVALID',status:400});}
  finally{key?.fill(0);}
}
