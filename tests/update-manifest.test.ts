import assert from 'node:assert/strict'
import test from 'node:test'
import { generateKeyPairSync } from 'node:crypto'
import { canonicalJson, compareVersions, keyId, sha256, signManifest, verifyManifest } from '../src/personal-update/manifest.mjs'

export function testKeys() {
  const pair = generateKeyPairSync('ed25519')
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' })
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' })
  return { privateKey, publicKey, trustedKeys: { [keyId(publicKey)]: publicKey } }
}
const keys = testKeys()
const base = { schemaVersion: 1, layer: 'ui', version: '0.2.0', channel: 'stable', minAppVersion: '0.1.0',
  minHostVersion: '0.1.0', bridgeVersion: 1, publishedAt: new Date().toISOString(),
  files: [{ path: 'personal-access-ui/app.js', size: 2, sha256: sha256('ok') }] }
const options = { layer: 'ui', channel: 'stable', versions: { app: '0.1.0', host: '0.1.0', bridge: 1 } }

test('Ed25519 accepts canonical signed JSON irrespective of object key insertion order', () => {
  const manifest = signManifest(base, keys.privateKey)
  assert.equal(verifyManifest(manifest, keys.trustedKeys, options).version, '0.2.0')
  const reordered = Object.fromEntries(Object.entries(manifest).reverse())
  assert.equal(verifyManifest(reordered, keys.trustedKeys, options).version, '0.2.0')
  assert.equal(canonicalJson({ b: [1, { c: '中文', a: true }], a: null }), '{"a":null,"b":[1,{"a":true,"c":"中文"}]}')
})
test('changed file hash, metadata, aliases, signature and wrong key fail authentication', () => {
  const manifest = signManifest(base, keys.privateKey)
  for (const changed of [{ ...manifest, version: '0.3.0' }, { ...manifest, channel: 'preview' },
    { ...manifest, files: [{ ...manifest.files[0], sha256: sha256('changed') }] },
    { ...manifest, signature: { ...manifest.signature, value: 'A'.repeat(86) + '==' } }]) {
    assert.throws(() => verifyManifest(changed, keys.trustedKeys, options), /signature/)
  }
  assert.throws(() => verifyManifest(manifest, testKeys().trustedKeys, options), /signature/)
  assert.throws(() => verifyManifest({ ...base }, keys.trustedKeys, options), /signature/)
})
test('authentic expired and incompatible ranges, bridge, layer, channel and unsafe paths are refused', () => {
  for (const change of [{ minAppVersion: '0.2.0' }, { maxAppVersion: '0.0.9' }, { minHostVersion: '0.2.0' },
    { bridgeVersion: 2 }, { layer: 'app' }, { channel: 'preview' }, { expiresAt: '2000-01-01T00:00:00Z' },
    { minAppVersion: '0.3.0', maxAppVersion: '0.2.0' }, { files: [{ ...base.files[0], path: '../app.js' }] },
    { files: [{ ...base.files[0], path: 'personal-access-ui/CON.js' }] }]) {
    assert.throws(() => verifyManifest(signManifest({ ...base, ...change }, keys.privateKey), keys.trustedKeys, options))
  }
  const mobile = signManifest({ ...base, layer: 'mobile-ui', minNativeVersion: '1.0.0' }, keys.privateKey)
  assert.throws(() => verifyManifest(mobile, keys.trustedKeys, { versions: { native: '0.8.8' } }), /incompatible/)
})
test('semver compatibility handles release and numeric prerelease ordering', () => {
  assert.equal(compareVersions('1.0.0-preview.10', '1.0.0-preview.2'), 1)
  assert.equal(compareVersions('1.0.0-preview.1', '1.0.0'), -1)
  assert.equal(compareVersions('1.10.0', '1.2.0'), 1)
})
