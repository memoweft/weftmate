/** Signed update contract shared by the host, release tools and desktop. */
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const signedBytes = manifest => Buffer.from(canonicalJson(Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'signature'))));
export const keyId = key => sha256(createPublicKey(key).export({ type: 'spki', format: 'der' })).slice(0, 32);
export function signManifest(manifest, privateKey) {
  const key = createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('signature requires Ed25519');
  return { ...manifest, signature: { algorithm: 'Ed25519', keyId: keyId(privateKey), value: sign(null, signedBytes(manifest), key).toString('base64') } };
}
export async function signingKeyFromEnvironment() {
  const file = process.env.WEFTMATE_UPDATE_PRIVATE_KEY_PATH;
  if (!file) throw new Error('WEFTMATE_UPDATE_PRIVATE_KEY_PATH is required');
  return readFile(file, 'utf8');
}
export const safeAssetPath = value => typeof value === 'string' && /^[A-Za-z0-9_-][A-Za-z0-9_.\/-]{0,239}$/.test(value) &&
  value.split('/').every(part => part.length && !part.startsWith('.') && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
const versionPattern = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;
export function compareVersions(a, b) {
  if (!versionPattern.test(a) || !versionPattern.test(b)) throw new Error('incompatible version');
  const split = value => { const index = value.indexOf('-'); return index < 0 ? [value, undefined] : [value.slice(0, index), value.slice(index + 1)]; };
  const [an, ap] = split(a), [bn, bp] = split(b);
  const av = an.split('.').map(Number), bv = bn.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (av[i] !== bv[i]) return av[i] > bv[i] ? 1 : -1;
  if (ap === bp) return 0;
  if (!ap || !bp) return ap ? -1 : 1;
  const as = ap.split('.'), bs = bp.split('.');
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    if (as[i] === bs[i]) continue;
    if (as[i] === undefined || bs[i] === undefined) return as[i] === undefined ? -1 : 1;
    const ad = /^\d+$/.test(as[i]), bd = /^\d+$/.test(bs[i]);
    if (ad && bd) return Number(as[i]) > Number(bs[i]) ? 1 : -1;
    if (ad !== bd) return ad ? -1 : 1;
    return as[i] > bs[i] ? 1 : -1;
  }
  return 0;
}
export function validateManifest(manifest, { layer, channel, versions = {}, now = Date.now() } = {}) {
  if (!manifest || manifest.schemaVersion !== 1 || !['ui', 'app', 'mobile-ui'].includes(manifest.layer) ||
      (layer && layer !== manifest.layer) || !versionPattern.test(manifest.version) ||
      !['stable', 'preview'].includes(manifest.channel) || (channel && manifest.channel !== channel) ||
      !Number.isFinite(Date.parse(manifest.publishedAt)) || Date.parse(manifest.publishedAt) > now + 300000 ||
      (manifest.expiresAt !== undefined && (!Number.isFinite(Date.parse(manifest.expiresAt)) || Date.parse(manifest.expiresAt) <= now))) throw new Error('incompatible manifest');
  for (const name of ['App', 'Host', 'Native']) {
    const actual = versions[name.toLowerCase()];
    for (const bound of ['min', 'max']) {
      const value = manifest[`${bound}${name}Version`];
      if (value !== undefined && (!versionPattern.test(value) || (actual !== undefined &&
          (bound === 'min' ? compareVersions(actual, value) < 0 : compareVersions(actual, value) > 0)))) throw new Error('incompatible version range');
    }
    if (manifest[`min${name}Version`] && manifest[`max${name}Version`] &&
        compareVersions(manifest[`min${name}Version`], manifest[`max${name}Version`]) > 0) throw new Error('incompatible version range');
  }
  if (manifest.bridgeVersion !== undefined && (!Number.isSafeInteger(manifest.bridgeVersion) || manifest.bridgeVersion < 1 ||
      (versions.bridge !== undefined && versions.bridge !== manifest.bridgeVersion))) throw new Error('incompatible bridge');
  const paths = new Set();
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error('invalid files');
  for (const file of manifest.files) {
    if (!file || !safeAssetPath(file.path) || paths.has(file.path) || !Number.isSafeInteger(file.size) || file.size < 0 ||
        !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('invalid file hash or path');
    paths.add(file.path);
  }
  return manifest;
}
export function verifyManifest(manifest, trustedKeys, options = {}) {
  const signature = manifest?.signature;
  const pem = trustedKeys?.[signature?.keyId];
  if (signature?.algorithm !== 'Ed25519' || typeof signature.value !== 'string' || !pem ||
      !/^[A-Za-z0-9+/]{86}==$/.test(signature.value)) throw new Error('signature key is untrusted');
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== 'ed25519' || !verify(null, signedBytes(manifest), key, Buffer.from(signature.value, 'base64'))) throw new Error('signature invalid');
  return validateManifest(manifest, options);
}
