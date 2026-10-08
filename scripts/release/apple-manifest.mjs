#!/usr/bin/env node
/** Add the detection-only Mac profile to an already packaged UPD-1 app manifest. */
import { readFile, writeFile } from 'node:fs/promises';
import { createPublicKey } from 'node:crypto';
import { signManifest, verifyManifest, keyId, signingKeyFromEnvironment } from '../../src/personal-update/manifest.mjs';
const values = new Map();
for (let i = 2; i < process.argv.length; i += 2) values.set(process.argv[i], process.argv[i + 1]);
const manifestPath = values.get('--manifest'), build = values.get('--build'), page = values.get('--download-page');
if (!manifestPath || !/^[0-9]+$/.test(build || '') || !page) throw new Error('Required: --manifest <manifest-app.json> --build <integer> --download-page <https URL>');
const url = new URL(page);
if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('download page must be a public HTTPS URL');
const privateKey = await signingKeyFromEnvironment();
const trusted = { [keyId(privateKey)]: createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }) };
const manifest = verifyManifest(JSON.parse(await readFile(manifestPath, 'utf8')), trusted, { layer: 'app' });
const { signature: _signature, ...payload } = manifest;
const result = signManifest({ ...payload, nativePlatform: 'macOS', nativeBuild: build, downloadPage: url.href }, privateKey);
verifyManifest(result, trusted, { layer: 'app' });
await writeFile(manifestPath, JSON.stringify(result) + '\n');
console.log('Signed Mac detection metadata written; no private key included.');
