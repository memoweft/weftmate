import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, P, generateKeyPair, exportJWK, SignJWT, jwtVerify, createLocalJWKSet } from './identity-helpers.mjs';

async function enrolled(t) {
  const f = await fixture(t);
  const account = await f.verified();
  const key = await generateKeyPair('ES256');
  const publicJwk = await exportJWK(key.publicKey);
  const logged = await f.signedIn({ deviceId: 'test-device', publicJwk });
  const hostId = 'host-synthetic', claimId = randomUUID();
  const installation = await generateKeyPair('ES256');
  const request = { hostId, claimId, publicJwk: await exportJWK(installation.publicKey), tlsSpki: 'a'.repeat(43) };
  const claim = (await f.api(`${P}/hosts/claims`, { method: 'POST', body: request, status: 200 })).data;
  async function confirm(token = logged.access_token, signatureKey = installation.privateKey, sub = account.cloudAccountId) {
    const proof = await new SignJWT({ claimId, challenge: claim.challenge, sub })
      .setProtectedHeader({ alg: 'ES256', typ: 'wm-host-claim+jwt' }).setIssuer(hostId)
      .setAudience(f.config.issuer).setIssuedAt().setExpirationTime('60s').sign(signatureKey);
    return f.api(`${P}/hosts/claims/confirm`, { method: 'POST', body: { claimId, proof },
      headers: { authorization: `Bearer ${token}` } });
  }
  async function hostRequest(route, data) {
    const proof = await new SignJWT({ ...data, action: route }).setProtectedHeader({ alg: 'ES256', typ: 'wm-host-request+jwt' })
      .setIssuer(hostId).setAudience(f.config.issuer).setIssuedAt().setExpirationTime('60s').setJti(randomUUID())
      .sign(installation.privateKey);
    return f.api(`${P}${route}`, { method: 'POST', body: { hostId, proof }, status: 200 });
  }
  return Object.assign(f, { key, publicJwk, logged, account, hostId, claimId, request, claim, confirm, hostRequest });
}

test('host claim requires installation signature and verified account; claimId and memberships survive restart idempotently', async t => {
  const f = await enrolled(t);
  assert.equal((await f.confirm(f.logged.access_token, f.key.privateKey)).status, 401);
  assert.equal((await f.confirm(f.logged.access_token, undefined, 'unknown-sub')).status, 409);
  assert.equal((await f.confirm()).status, 200);
  await f.restart();
  assert.equal((await f.confirm()).status, 200);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM host_memberships').get().n, 1);
  assert.deepEqual(JSON.parse(f.db.prepare('SELECT public_jwk FROM cloud_hosts').get().public_jwk), f.request.publicJwk);
  const changed = await generateKeyPair('ES256');
  assert.equal((await f.api(`${P}/hosts/claims`, { method: 'POST', body: { ...f.request, publicJwk: await exportJWK(changed.publicKey) } })).status, 409);
});

test('registered host OIDC resource issues a DPoP access token only for a member holding the email-confirmed device key', async t => {
  const f = await enrolled(t); const confirmation = await f.confirm(); assert.equal(confirmation.status, 200, JSON.stringify(confirmation.data));
  async function hostTokens(key) {
    const interaction = await f.begin(f.browser(), { resource: `${f.config.audience}/hosts/${f.hostId}`, scope: 'openid offline_access host:session' });
    const completed = await f.login(interaction, { deviceId: 'test-device', publicJwk: f.publicJwk });
    assert.equal(completed.status, 200);
    const resumed = await interaction.client(completed.data.resumeUrl, { status: 303 });
    const callback = new URL(resumed.headers.get('location'));
    const proof = await new SignJWT({ htm: 'POST', htu: `${f.origin}${P}/oidc/token` })
      .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: await exportJWK(key.publicKey) })
      .setJti(randomUUID()).setIssuedAt().sign(key.privateKey);
    return f.api(`${P}/oidc/token`, { method: 'POST', headers: { dpop: proof }, form: {
      grant_type: 'authorization_code', client_id: 'test-native', redirect_uri: 'com.example.weftmate:/callback',
      code: callback.searchParams.get('code'), code_verifier: interaction.verifier,
    } });
  }
  const wrong = await hostTokens(await generateKeyPair('ES256'));
  assert.equal(wrong.status, 400, JSON.stringify(wrong.data));
  const result = await hostTokens(f.key);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.token_type, 'DPoP');
  const verified = await jwtVerify(result.data.access_token, createLocalJWKSet(f.identity.keys.publicJwks), {
    issuer: f.config.issuer, audience: `${f.config.audience}/hosts/${f.hostId}`, algorithms: ['RS256'], typ: 'at+jwt' });
  assert.equal(verified.payload.host_id, f.hostId); assert.ok(verified.payload.cnf.jkt);
  assert.equal(verified.payload.sub, f.account.cloudAccountId);
  assert.equal((await f.api(`${P}/account`, { headers: { authorization: `Bearer ${result.data.access_token}` } })).status, 401);
});

test('installation-authenticated revocation feed carries only member device/epoch events and deduplicates local revoke requests', async t => {
  const f = await enrolled(t); const confirmation = await f.confirm(); assert.equal(confirmation.status, 200, JSON.stringify(confirmation.data));
  const requestId = randomUUID();
  for (let i = 0; i < 2; i++) await f.hostRequest('/hosts/devices/revoke', {
    sub: f.account.cloudAccountId, deviceId: 'test-device', jkt: 'synthetic-thumbprint', requestId });
  f.db.prepare('UPDATE cloud_accounts SET auth_epoch=auth_epoch+1 WHERE id=?').run(f.account.cloudAccountId);
  const result = await f.hostRequest('/hosts/revocations', { afterSeq: 0 });
  const { payload } = await jwtVerify(result.data.eventToken, createLocalJWKSet(f.identity.keys.publicJwks), {
    issuer: f.config.issuer, audience: `${f.config.audience}/hosts/${f.hostId}`, algorithms: ['RS256'], typ: 'wm-cloud-revocations+jwt' });
  assert.equal(payload.events.length, 2); assert.equal(payload.events[0].kind, 'device'); assert.equal(payload.events[1].kind, 'epoch');
  assert.doesNotMatch(JSON.stringify(payload), /email|password|title|health/);
  const invalid = await f.api(`${P}/hosts/revocations`, { method: 'POST', body: { hostId: f.hostId, proof: 'forged' } });
  assert.equal(invalid.status, 401);
});


test('real cloud OIDC → local-approved binding → pending device → approved host Cookie → cloud revoke → local login survives', async t => {
  const f = await fixture(t);
  await f.verified();
  const key = await generateKeyPair('ES256'), publicJwk = await exportJWK(key.publicKey);
  const control = await f.signedIn({ deviceId: 'test-device', publicJwk });
  const { createPersonalAccessService } = await import('../../../src/personal-access/index.mjs');
  const { hash } = await import('../../../src/personal-cloud/proofs.mjs');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'wm-cloud-host-e2e-')));
  const host = await createPersonalAccessService({ root, port: 0,
    cloudIdentity: { issuer: f.config.issuer, allowInsecureLoopback: true },
    backend: { getStatus: async () => ({}), listModels: async () => [], preflight: async () => ({ ok: true }),
      createSession: async () => ({}), sendMessage: async () => ({}), cancelSession: async () => ({}),
      readEvents: async () => ({ events: [], nextSeq: -1, hasMore: false }), describeSession: async () => null } });
  t.after(async () => { await host.close(); await rm(root, { recursive: true, force: true }); });
  const started = await host.start();
  const api = async (route, body, auth, headers = {}) => {
    const response = await fetch(started.origin + '/personal/v1' + route, { method: body ? 'POST' : 'GET',
      headers: { ...(body ? { origin: started.origin, 'content-type': 'application/json' } : {}),
        ...(auth ? { cookie: auth.cookie, 'x-weftmate-csrf': auth.csrfToken } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { data: await response.json(), status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const grant = await host.issueSetupGrant();
  const setup = await api('/auth/setup', { grant: grant.grant, username: 'synthetic-local', password: 'synthetic local password', deviceName: 'Computer' });
  assert.equal(setup.status, 201);
  const local = { cookie: setup.cookie, csrfToken: setup.data.csrfToken };
  const claim = await api('/cloud/claims', {}, local);
  assert.equal(claim.status, 200);
  const bound = await api('/cloud/binding', { claimId: claim.data.claimId, accessToken: control.access_token }, local);
  assert.equal(bound.status, 200, JSON.stringify(bound.data));
  const interaction = await f.begin(f.browser(), { resource: `${f.config.audience}/hosts/${started.hostId}`, scope: 'openid offline_access host:session' });
  const completed = await f.login(interaction, { deviceId: 'test-device', publicJwk });
  const resumed = await interaction.client(completed.data.resumeUrl, { status: 303 });
  const callback = new URL(resumed.headers.get('location'));
  const oauthProof = await new SignJWT({ htm: 'POST', htu: `${f.origin}${P}/oidc/token` })
    .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: publicJwk }).setJti(randomUUID()).setIssuedAt().sign(key.privateKey);
  const tokens = await f.api(`${P}/oidc/token`, { method: 'POST', headers: { dpop: oauthProof }, status: 200,
    form: { grant_type: 'authorization_code', client_id: 'test-native', redirect_uri: 'com.example.weftmate:/callback',
      code: callback.searchParams.get('code'), code_verifier: interaction.verifier } });
  const exchange = async () => {
    const nonce = await api('/auth/cloud-nonce', {});
    const proof = await new SignJWT({ htm: 'POST', htu: started.origin + '/personal/v1/auth/cloud-session',
      nonce: nonce.data.nonce, ath: hash(tokens.data.access_token) }).setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: publicJwk })
      .setJti(randomUUID()).setIssuedAt().sign(key.privateKey);
    return api('/auth/cloud-session', { accessToken: tokens.data.access_token, deviceName: 'New device' }, undefined, { dpop: proof });
  };
  const pending = await exchange();
  assert.equal(pending.status, 202, JSON.stringify(pending.data)); assert.equal(pending.cookie, undefined);
  assert.equal((await api('/cloud/devices/pending', undefined, local)).data.devices.length, 1);
  assert.equal((await api(`/cloud/devices/${pending.data.requestId}/decision`, { decision: 'allow' }, local)).status, 200);
  const session = await exchange();
  assert.equal(session.status, 200);
  const trusted = { cookie: session.cookie, csrfToken: session.data.csrfToken };
  assert.equal((await api('/sessions', undefined, trusted)).status, 200);
  await f.api(`${P}/auth/devices/revoke`, { method: 'POST', body: { deviceId: 'test-device' }, headers: { authorization: `Bearer ${control.access_token}` }, status: 200 });
  await host.syncCloudRevocations();
  assert.equal((await api('/sessions', undefined, trusted)).status, 401);
  assert.equal((await api('/auth/me', undefined, local)).status, 200);
});
