import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, realpathSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { signManifest, keyId, sha256, verifyManifest } from '../src/personal-update/manifest.mjs';

test('Apple release decoration uses only the environment signing key and signs every detection field', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'upd2-release-')));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const key = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const pub = publicKey.export({ type: 'spki', format: 'pem' });
  const input = signManifest({ schemaVersion: 1, layer: 'app', version: '0.2.0', channel: 'stable',
    publishedAt: new Date().toISOString(), files: [{ path: 'App.dmg', size: 2, sha256: sha256('ok') }] }, key);
  const path = join(root, 'manifest-app.json'), secret = join(root, 'ephemeral-key.pem');
  try {
    writeFileSync(path, JSON.stringify(input)); writeFileSync(secret, key, { mode: 0o600 });
    const args = ['scripts/release/apple-manifest.mjs', '--manifest', path, '--build', '12', '--download-page', 'https://example.com/downloads/mac'];
    const env = { ...process.env, WEFTMATE_UPDATE_PRIVATE_KEY_PATH: secret };
    const result = spawnSync(process.execPath, args, { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const release = verifyManifest(JSON.parse(readFileSync(path, 'utf8')), { [keyId(pub)]: pub }, { layer: 'app' });
    assert.equal(release.nativePlatform, 'macOS'); assert.equal(release.nativeBuild, '12');
    assert.equal(release.downloadPage, 'https://example.com/downloads/mac');
    assert.ok(!readFileSync(path, 'utf8').includes('PRIVATE KEY'));
    assert.throws(() => verifyManifest({ ...release, nativeBuild: '13' }, { [keyId(pub)]: pub }), /signature/);
    const missing = spawnSync(process.execPath, args, { env: { ...env, WEFTMATE_UPDATE_PRIVATE_KEY_PATH: '' }, encoding: 'utf8' });
    assert.notEqual(missing.status, 0);
    assert.ok(!missing.stderr.includes(String(key)));
    const unsafe = spawnSync(process.execPath, [...args.slice(0, -1), 'http://example.com/downloads'], { env, encoding: 'utf8' });
    assert.notEqual(unsafe.status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
