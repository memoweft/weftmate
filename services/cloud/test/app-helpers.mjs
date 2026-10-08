import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, P, EMAIL, PASSWORD, NEXT_PASSWORD, generateKeyPair, exportJWK, SignJWT, jwtVerify, importJWK } from './identity-helpers.mjs';

const sha = v => createHash('sha256').update(v).digest('base64url');
export async function registration(f, email = EMAIL) {
  const challenge = (await f.api(`${P}/auth/registration/request`, { method: 'POST', body: { email }, status: 200 })).data;
  const ticket = (await f.api(`${P}/auth/registration/verify`, { method: 'POST',
    body: { challengeId: challenge.challengeId, code: await f.mailCode(challenge.challengeId) }, status: 200 })).data;
  const account = (await f.api(`${P}/auth/registration/complete`, { method: 'POST',
    body: { passwordTicket: ticket.passwordTicket, password: PASSWORD }, status: 200 })).data.account;
  return { account, ticket, challenge };
}
export async function appDevice(f, deviceId, email = EMAIL, password = PASSWORD, withoutProof = false) {
  const client = f.browser(), key = await generateKeyPair('ES256'), publicJwk = await exportJWK(key.publicKey);
  const verifier = randomBytes(32).toString('base64url'), state = randomUUID(), nonce = randomUUID();
  const started = await client(`${P}/auth/authorization`, { method: 'POST', status: 200, body: {
    clientId: 'test-native', redirectUri: 'com.example.weftmate:/callback', deviceId, publicJwk,
    codeChallenge: sha(verifier), state, nonce,
  } });
  const interaction = { ...started.data, client };
  assert.equal(interaction.appLogin, true);
  const device = { f, client, key, publicJwk, deviceId, interaction };
  let login = await client(`${P}/auth/login`, { method: 'POST', body: {
    interactionUid: interaction.interactionUid, csrfToken: interaction.csrfToken,
    email, password, deviceId, publicJwk, deviceName: deviceId, deviceType: deviceId === 'desktop' ? 'windows' : 'ios',
  } });
  if (login.status === 202) login = await f.confirm(interaction, login.data.challengeId);
  assert.equal(login.status, 200, JSON.stringify(login.data));
  const resumed = (await client(`${P}/auth/authorization/resume`, { method: 'POST', status: 200,
    body: { resumeUrl: login.data.resumeUrl } })).data;
  const callback = new URL(resumed.callbackUrl);
  assert.equal(callback.searchParams.get('state'), state);
  assert.equal(callback.searchParams.get('error'), null, resumed.callbackUrl);
  device.tokens = (await client(`${P}/oidc/token`, { method: 'POST', status: withoutProof ? 400 : 200,
    headers: withoutProof ? {} : { dpop: await proof(device, `${f.origin}${P}/oidc/token`) }, form: {
      grant_type: 'authorization_code', client_id: 'test-native', redirect_uri: 'com.example.weftmate:/callback',
      code: callback.searchParams.get('code'), code_verifier: verifier,
    } })).data;
  if (!withoutProof) assert.equal(device.tokens.token_type, 'DPoP');
  return device;
}
export async function proof(device, url, token, extra = {}, method = 'POST', now = Date.now()) {
  return new SignJWT({ htm: method, htu: url, ...(token ? { ath: sha(token) } : {}), ...extra })
    .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: device.publicJwk })
    .setIssuedAt(Math.floor(now / 1000)).setJti(randomUUID()).sign(device.key.privateKey);
}
export async function control(device, route, body, status = 200) {
  const url = device.f.origin + P + route, method = body === undefined ? 'GET' : 'POST';
  return device.client(url, { method, body, status, headers: { authorization: `DPoP ${device.tokens.access_token}`,
    dpop: await proof(device, url, device.tokens.access_token, {}, method, device.f.now) } });
}
export async function refresh(device, resource, status = 200) {
  const result = await device.client(`${P}/oidc/token`, { method: 'POST', status,
    headers: { dpop: await proof(device, device.f.origin + P + '/oidc/token') },
    form: { grant_type: 'refresh_token', client_id: 'test-native', refresh_token: device.tokens.refresh_token,
      ...(resource ? { resource } : {}) } });
  if (status === 200) device.tokens = result.data;
  return result;
}
export async function hostFixture(f, t) {
  const { createPersonalAccessService } = await import('../../../src/personal-access/index.mjs');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'wm-s1d-host-')));
  const host = await createPersonalAccessService({ root, port: 0,
    cloudIdentity: { issuer: f.config.issuer, allowInsecureLoopback: true },
    backend: { getStatus: async () => ({}), listModels: async () => [], preflight: async () => ({ ok: true }),
      createSession: async () => ({}), sendMessage: async () => ({}), cancelSession: async () => ({}),
      readEvents: async () => ({ events: [], nextSeq: -1, hasMore: false }), describeSession: async () => null } });
  t.after(async () => { await host.close(); await rm(root, { recursive: true, force: true }); });
  const started = await host.start();
  async function hostApi(route, body, auth, headers = {}) {
    const response = await fetch(started.origin + '/personal/v1' + route, {
      method: body === undefined ? 'GET' : 'POST', headers: { origin: started.origin,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(auth ? { cookie: auth.cookie, 'x-weftmate-csrf': auth.csrfToken } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    return { ...data, data, status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  async function exchange(device, route, body = {}) {
    const nonce = await hostApi('/auth/cloud-nonce', {});
    return hostApi(route, { accessToken: device.tokens.access_token, deviceName: device.deviceId, ...body }, undefined,
      { dpop: await proof(device, started.origin + '/personal/v1' + route, device.tokens.access_token, { nonce: nonce.nonce }) });
  }
  return { host, root, started, hostApi, exchange };
}

