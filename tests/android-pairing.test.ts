import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import * as jose from 'jose';
import { syntheticCloudBinding } from './helpers/synthetic-cloud-binding.mjs';
import { startTimelineCandidate } from './integration/timeline-ui-candidate.mjs';

const source = readFileSync(new URL('../src/ui-core/cloud-auth.js', import.meta.url), 'utf8');
const vector = JSON.parse(readFileSync(new URL('./fixtures/pairing-v2.json', import.meta.url), 'utf8'));
function client(options: any = {}) {
  const scope: any = { WeftUiCore: {}, URL, URLSearchParams, btoa, atob, TextEncoder, TextDecoder, AbortSignal, setTimeout };
  runInNewContext(source, scope);
  return new scope.WeftUiCore.CloudAuthClient({ host: 'https://host.example.test', crypto: webcrypto, vendor: jose, ...options });
}
test('Android pairing uses the cross-language vector and unsigned big endian SAS', async () => {
  const c = client();
  assert.equal(await c.pairingDigest(['wm-pair-host-v2', ...vector.transcript, vector.hostNonce]), vector.hostCommitment);
  assert.equal(await c.pairingDigest(['wm-pair-phone-v2', vector.transcript[6], vector.deviceId, vector.phoneJkt, vector.phoneNonce]), vector.phoneCommitment);
  assert.equal(await c.pairingCode(vector.transcript, vector.hostNonce, vector.deviceId, vector.phoneJkt, vector.phoneNonce), vector.verificationCode);
});
async function fixture(t: any) {
  const cloud = await syntheticCloudBinding(); t.after(() => cloud.close());
  const host = await startTimelineCandidate({ cloudIdentity: cloud.configuration, historyCount: 0 }); t.after(() => host.close());
  await cloud.bind(host.request);
  const binding = await host.request('/cloud/binding');
  const pair = await jose.generateKeyPair('ES256', { extractable: true });
  const key = { privateKey: pair.privateKey, publicJwk: await jose.exportJWK(pair.publicKey), deviceId: 'pairing-android-synthetic' };
  const token = await cloud.access(binding.hostId, pair, key.deviceId);
  const records = new Map(), calls: any[] = [];
  const c = client({ host: host.origin, fetch: async (url: string, options: any) => { calls.push({ url, options }); return fetch(url, { ...options, headers: { ...options.headers, origin: new URL(url).origin } }); },
    credentials: async (id: string, value: any) => value === undefined ? records.get(id) : records.set(id, value) });
  await c.configure(); c.key = async () => key; c.saved = async () => ({ sub: 'fix8-cloud-synthetic', deviceName: '合成安卓' });
  c.access = async () => token;
  const material = () => host.request('/cloud/pairings', {});
  return { c, host, material, records, calls };
}
test('phone commit/reveal computes its own code, waits for desktop and redeems exactly once', async t => {
  const f = await fixture(t), p = await f.material(); let code = '';
  const result = await f.c.pair(p, { onComparison: async (value: any) => {
    code = value.verificationCode;
    const status = await f.host.request('/cloud/pairings/status', { challenge: p.challenge });
    assert.equal(code, status.verificationCode);
    assert.equal(f.records.has('trusted-host:' + p.hostId), false);
  }, wait: async () => f.host.request('/cloud/pairings/decision', { challenge: p.challenge, decision: 'confirm', verificationCode: code }) });
  assert.ok(result.account); assert.ok(f.records.get('trusted-host:' + p.hostId));
  const requests = f.calls.filter(row => /pairings\//.test(row.url));
  assert.deepEqual(requests.map(row => row.url.split('/').at(-1)), ['join', 'reveal', 'redeem', 'redeem']);
  for (const row of requests) {
    const proof = jose.decodeJwt(row.options.headers.DPoP);
    assert.equal(proof.htu, row.url); assert.equal(proof.htm, 'POST'); assert.ok(proof.nonce); assert.ok(proof.ath);
    assert.equal(f.calls[f.calls.indexOf(row) - 1].url.endsWith('/auth/cloud-nonce'), true);
  }
  assert.equal(new Set(requests.map(row => jose.decodeJwt(row.options.headers.DPoP).jti)).size, requests.length);
  await assert.rejects(f.c.pair(p), (error: any) => error.code === 'PAIRING_INVALID');
});
test('host commitment mismatch stops before revealing the phone secret', async t => {
  const f = await fixture(t), p = await f.material(); p.hostCommitment = 'A'.repeat(43);
  await assert.rejects(f.c.pair(p), (e: any) => e.code === 'PAIRING_HOST_MISMATCH');
  assert.equal(f.calls.some(row => row.url.endsWith('/reveal')), false);
  assert.equal(f.records.size, 1); // configure cache only; no host trust
});
test('desktop cancellation and local expiry terminate without granting trust', async t => {
  const f = await fixture(t), p = await f.material();
  await assert.rejects(f.c.pair(p, { onComparison: () => f.host.request('/cloud/pairings/decision', { challenge: p.challenge, decision: 'cancel' }) }),
    (e: any) => e.code === 'PAIRING_INVALID');
  assert.equal(f.records.has('trusted-host:' + p.hostId), false);
  const expired = await f.material(); expired.expiresAt = Date.now() - 1;
  const count = f.calls.length;
  await assert.rejects(f.c.pair(expired), (e: any) => e.code === 'PAIRING_EXPIRED');
  assert.equal(f.calls.length, count);
});
test('QR validation rejects foreign account, issuer, target, invalid key, origin and excessive lifetime before join', async t => {
  const f = await fixture(t), p = await f.material();
  for (const change of [{version:1}, {issuer:'https://foreign.test/personal/v1/cloud/oidc'}, {sub:'other-account'}, {hostId:'other-host'},
    {publicJwk:{...p.publicJwk,x:'bad'}}, {origin:'http://evil.example'}, {origin:p.origin+'/path'},
    {relay:{baseUrl:'http://evil.example'}}, {expiresAt:Date.now()+121000}]) {
    const count = f.calls.length;
    await assert.rejects(f.c.pair({...p,...change}), (e: any) => e.code === 'PAIRING_INVALID');
    assert.equal(f.calls.length, count);
  }
});
test('a phone identity different from the signed cloud token cannot join', async t => {
  const f = await fixture(t), p = await f.material(), key = await f.c.key();
  key.deviceId = 'different-local-device';
  await assert.rejects(f.c.pair(p), (e: any) => e.code === 'CLOUD_TOKEN_INVALID');
  assert.equal(f.calls.some(row => row.url.endsWith('/join')), false);
});
test('phone uses validated HTTPS discovery while retaining computer loopback origin in the transcript', async t => {
  const f = await fixture(t), p = await f.material();
  const scope: any = { WeftUiCore: { factories: {} }, URL, URLSearchParams, btoa, atob, TextEncoder, TextDecoder, AbortSignal, setTimeout, clearTimeout };
  runInNewContext(source + '\n' + readFileSync(new URL('../src/ui-core/cloud-account.js', import.meta.url), 'utf8'), scope);
  const opened: any[] = [], accepted: any[] = [];
  const core: any = { state: { identityGeneration: 1 }, acceptSession: (session: any) => accepted.push(session) };
  Object.assign(core, scope.WeftUiCore.factories.cloudAccount(core, { openCloudHost: async (connection: any) => { opened.push(connection); return connection; } },
    { hostOrigin: 'https://cloud.example.test', crypto: webcrypto, cloudVendor: jose, cloudCredentials: async () => undefined }));
  const c = core.initializeCloudAccount();
  c.config = { issuer: 'https://cloud.example.test/personal/v1/cloud/oidc', hostId: 'unconnected', clientId: 'synthetic-client' };
  c.saved = async () => ({ sub: p.sub });
  p.issuer = c.config.issuer; p.relay = { baseUrl: 'https://relay.example.test' };
  c.authorized = async () => ({ hostId: p.hostId, status: 'online', baseUrl: p.relay.baseUrl });
  c.request = async (url: string) => { assert.equal(url, p.relay.baseUrl + '/personal/v1/cloud/config'); return { issuer: p.issuer, hostId: p.hostId }; };
  c.pair = async (material: any) => {
    assert.equal(c.host, p.relay.baseUrl);
    const transcript = await c.checkPairing(material);
    assert.equal(transcript[8], f.host.origin); assert.equal(transcript[9], p.relay.baseUrl);
    return { account: { ownerId: 'synthetic-owner' }, device: { id: 'synthetic-device' } };
  };
  const encode = (value: any) => 'wm1.' + Buffer.from(JSON.stringify(value)).toString('base64url');
  await core.cloudRedeemPairing(encode(p)); assert.equal(accepted.length, 1); assert.equal(opened.length, 1);
  assert.equal(c.host, p.relay.baseUrl);
  c.authorized = async () => ({ hostId: p.hostId, status: 'online', baseUrl: p.origin });
  await assert.rejects(core.cloudRedeemPairing(encode(p)), (e: any) => e.code === 'PAIRING_INVALID');
  assert.equal(opened.length, 1, 'a production HTTPS cloud must not route to the phones loopback');
  assert.equal(c.host, p.relay.baseUrl, 'refused pairing preserves the previous connection');
});
