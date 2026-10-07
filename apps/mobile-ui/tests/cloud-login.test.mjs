import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { SignJWT, jwtVerify, createLocalJWKSet, importJWK, decodeProtectedHeader } from 'jose';
const source = await readFile(new URL('../../../src/personal-access-ui/cloud-login.js', import.meta.url), 'utf8');
function fixture() {
  const context = { crypto: webcrypto, indexedDB: new IDBFactory(), btoa, atob, URL, URLSearchParams,
    TextEncoder, TextDecoder, Uint8Array, AbortSignal, location: { origin: 'https://host.example' },
    WeftCloudVendor: { SignJWT, jwtVerify, createLocalJWKSet }, localStorage: new Proxy({}, { get() { throw Error('localStorage forbidden'); } }) };
  runInNewContext(source, context);
  const requests = [];
  const client = new context.WeftCloud.Client({ request: async (url, options) => {
    requests.push({ url, options });
    return { status: 200, body: { issuer: 'https://cloud.example/personal/v1/cloud/oidc', hostId: 'host-test', clientId: 'web-test' } };
  }, launch: url => requests.push({ authorization: url }) });
  return { ...context.WeftCloud, client, requests };
}
test('browser retains a nonexportable P-256 private key in IndexedDB; DPoP binds nonce, method, URL and access token', async () => {
  const f = fixture();
  const key = await f.client.key();
  assert.equal(key.privateKey.extractable, false);
  await assert.rejects(webcrypto.subtle.exportKey('jwk', key.privateKey));
  assert.equal((await f.client.key()).deviceId, key.deviceId);
  const proof = await f.client.proof('https://host.example/personal/v1/auth/cloud-session', { token: 'opaque-test-token', nonce: 'nonce-one' });
  const header = decodeProtectedHeader(proof);
  assert.equal(header.typ, 'dpop+jwt'); assert.equal(header.jwk.d, undefined);
  const claims = (await jwtVerify(proof, await importJWK(header.jwk, 'ES256'))).payload;
  assert.equal(claims.htm, 'POST'); assert.equal(claims.nonce, 'nonce-one');
  assert.equal(claims.htu, 'https://host.example/personal/v1/auth/cloud-session');
  assert.equal(claims.ath, Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode('opaque-test-token'))).toString('base64url'));
});
test('PKCE authorization carries the device public key; state, callback path and lifetime are checked before token exchange', async () => {
  const f = fixture(); await f.client.start();
  const url = new URL(f.requests.at(-1).authorization);
  assert.equal(url.searchParams.get('response_type'), 'code'); assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('response_mode'), 'fragment'); assert.equal(JSON.parse(url.searchParams.get('wm_public_jwk')).d, undefined);
  const pending = await f.storage('pending:https://host.example');
  await assert.rejects(f.client.complete('https://host.example/personal/v1/ui/#code=test&state=wrong'), /CLOUD_TOKEN_INVALID/);
  await assert.rejects(f.client.complete(`https://host.example/other#code=test&state=${pending.state}`), /CLOUD_TOKEN_INVALID/);
  assert.equal(f.requests.filter(r => r.url?.endsWith('/token')).length, 0);
  pending.createdAt = Date.now() - 601000; await f.storage('pending:https://host.example', pending);
  await assert.rejects(f.client.complete(`https://host.example/personal/v1/ui/#code=test&state=${pending.state}`), /CLOUD_TOKEN_INVALID/);
});
test('pairing code and QR URL preserve the local challenge and TLS pin; unsafe origins are rejected', () => {
  const f = fixture(); const pair = { hostId: 'host-test', origin: 'https://host.example', challenge: 'a'.repeat(43), tlsSpki: 'b'.repeat(43), expiresIn: 120 };
  const code = f.pairingCode(pair);
  assert.deepEqual(JSON.parse(JSON.stringify(f.parsePairing(code))), pair);
  assert.deepEqual(JSON.parse(JSON.stringify(f.parsePairing('https://host.example/personal/v1/ui/#pair=' + code.slice(4)))), pair);
  assert.throws(() => f.parsePairing(f.pairingCode({ ...pair, origin: 'http://public.example' })), /INVALID_CONFIGURATION/);
});
test('refresh credentials are replaced before exchange and erased after receiving the host session', async () => {
  const f = fixture(); await f.client.configure();
  await f.storage(f.client.tokenId, { access_token: 'old', refresh_token: 'refresh-old', sub: 'subject', expiresAt: 0 });
  f.client.token = async () => ({ access_token: 'new', refresh_token: 'refresh-new', expires_in: 300, token_type: 'DPoP' });
  f.client.verify = async () => ({ sub: 'subject' });
  f.client.json = async path => {
    if (path.endsWith('nonce')) return { nonce: 'nonce' };
    assert.equal((await f.storage(f.client.tokenId)).refresh_token, 'refresh-new');
    return { account: { ownerId: 'test-owner' }, device: { id: 'device-one' }, csrfToken: 'test' };
  };
  await f.client.exchange(); assert.equal(await f.storage(f.client.tokenId), undefined);
});
