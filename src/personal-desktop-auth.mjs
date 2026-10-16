/** System-encrypted desktop identity. Private keys never cross the bridge. */
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createHash, generateKeyPairSync, createPrivateKey, randomUUID, sign } from 'node:crypto';
export function desktopAuthStorage(file, encryption) {
  const read = () => {
    if (!encryption.isEncryptionAvailable()) throw new Error('STORAGE_UNAVAILABLE');
    try { return JSON.parse(encryption.decryptString(readFileSync(file))); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw new Error('STORAGE_UNAVAILABLE'); }
  };
  const edit = change => {
    const data = read(), result = change(data);
    writeFileSync(file + '.tmp', encryption.encryptString(JSON.stringify(data)), { mode: 0o600 }); renameSync(file + '.tmp', file);
    return result;
  };
  const id = value => createHash('sha256').update(value).digest('hex');
  return {
    cloudCredentialsPresent(ownerIds = []) {
      const data = read();
      if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(ownerIds) || ownerIds.some(owner => typeof owner !== 'string')) throw new Error('STORAGE_UNAVAILABLE');
      // Names are hashed on disk. Exclude only namespaces whose preimages are
      // known from the trusted local account directory, plus recognized public
      // caches. Unknown historical records must never be reported as absent.
      const shape = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(field => fields.includes(field));
      const caches = new Set(ownerIds.flatMap(owner => ['message-mode', 'message-feedback', 'sent-feedback']
        .map(kind => 'credential:' + id(`weftmate:${kind}:${owner}`))));
      const offlineAccount = 'credential:' + id('offline-account'), remembered = data[offlineAccount];
      if (shape(remembered, ['sub', 'email', 'deviceName']) && typeof remembered.sub === 'string') {
        caches.add(offlineAccount); caches.add('credential:' + id('draft:' + remembered.sub));
      }
      for (const [name, value] of Object.entries(data)) {
        if (/^key:[a-f0-9]{64}$/.test(name) || caches.has(name)) continue;
        if (!/^credential:[a-f0-9]{64}$/.test(name)) throw new Error('STORAGE_UNAVAILABLE');
        if (value && typeof value === 'object' && ['refreshToken', 'refresh_token', 'access_token', 'id_token', 'cloud', 'host'].some(field => Object.hasOwn(value, field))) return true;
        if (shape(value, ['issuer', 'clientId', 'hostId', 'capabilities', 'nativeEmailCodeLogin']) &&
          typeof value.issuer === 'string' && typeof value.clientId === 'string' && typeof value.hostId === 'string') continue;
        if (shape(value, ['tlsSpki', 'publicJwk', 'origin', 'relay']) &&
          typeof value.tlsSpki === 'string' && value.publicJwk && typeof value.origin === 'string') continue;
        throw new Error('STORAGE_UNAVAILABLE');
      }
      return false;
    },
    credentials(key, value, remove = false) {
      if (typeof key !== 'string' || key.length > 4096) throw new Error('STORAGE_UNAVAILABLE');
      const name = 'credential:' + id(key);
      if (value === undefined && !remove) return read()[name];
      return edit(data => { if (remove) delete data[name]; else data[name] = value; });
    },
    key(scope) {
      const name = 'key:' + id(scope);
      return edit(data => {
        if (!data[name]) {
          const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
          data[name] = { privateJwk: pair.privateKey.export({ format: 'jwk' }), publicJwk: pair.publicKey.export({ format: 'jwk' }), deviceId: 'desktop-' + randomUUID() };
        }
        return { publicJwk: data[name].publicJwk, deviceId: data[name].deviceId };
      });
    },
    sign(scope, input) {
      if (typeof input !== 'string' || input.length > 16384) throw new Error('INVALID_REQUEST');
      const record = read()['key:' + id(scope)];
      if (!record) throw new Error('STORAGE_UNAVAILABLE');
      return sign('sha256', Buffer.from(input), { key: createPrivateKey({ key: record.privateJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }).toString('base64url');
    },
    resetKey(scope) { return edit(data => { delete data['key:' + id(scope)]; }); },
  };
}
