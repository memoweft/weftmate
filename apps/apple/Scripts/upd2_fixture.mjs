#!/usr/bin/env node
// Local detection-only demo. The signing key exists in memory and is never written or printed.
import { generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import { signManifest } from '../../../src/personal-update/manifest.mjs';
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
let reads = 0;
const server = createServer((request, response) => {
  response.setHeader('content-type', 'application/json');
  const address = server.address();
  const manifest = signManifest({ schemaVersion: 1, layer: 'app', channel: 'stable', version: '0.2.0',
    nativePlatform: 'macOS', nativeBuild: '12', downloadPage: `http://127.0.0.1:${address.port}/downloads`,
    publishedAt: new Date().toISOString(), files: [{ path: 'WeftMate.dmg', size: 123, sha256: 'a'.repeat(64) }],
    releaseNotes: '合成新版 / 不下载执行代码', compatibility: { enabled: true },
  }, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  if (request.url === '/manifest-app.json') { reads++; response.end(JSON.stringify(manifest)); }
  else if (request.url === '/bad.json') { reads++; manifest.nativeBuild = '999'; response.end(JSON.stringify(manifest)); }
  else if (request.url === '/state') response.end(JSON.stringify({ manifestReads: reads, archiveDownloads: 0 }));
  else { response.statusCode = 404; response.end('{}'); }
});
server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  console.log(JSON.stringify({ feed: `http://127.0.0.1:${port}/manifest-app.json`, publicKey: publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64') }));
});
