import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  fixture, P, generateKeyPair, exportJWK, createLocalJWKSet, jwtVerify,
} from './identity-helpers.mjs';
import { proof, control } from './app-helpers.mjs';

const sha = value => createHash('sha256').update(value).digest('base64url');
const randomPassword = length => randomBytes(length).toString('base64url').slice(0, length);

async function bootstrap(f, deviceId, { clientId = 'test-native', redirectUri = 'com.example.weftmate:/callback', client = f.browser() } = {}) {
  const key = await generateKeyPair('ES256');
  const publicJwk = await exportJWK(key.publicKey);
  const verifier = randomBytes(32).toString('base64url'), state = randomUUID(), nonce = randomUUID();
  const started = await client(`${P}/auth/authorization`, {
    method: 'POST', status: 200, body: {
      clientId, redirectUri,
      deviceId, publicJwk, codeChallenge: sha(verifier), state, nonce,
    },
  });
  const resumeCookies = started.headers.getSetCookie().filter(cookie => /^wm_cloud_resume(?:\.sig)?=/.test(cookie));
  assert.equal(resumeCookies.length, 2, 'app authorization issues the resume cookie and its signature');
  for (const cookie of resumeCookies) {
    assert.equal(/;\s*path=([^;]+)/i.exec(cookie)?.[1], '/personal/v1/cloud');
    assert.ok(/;\s*httponly(?:;|$)/i.test(cookie), 'resume cookie stays HttpOnly');
  }
  const interaction = started.data;
  assert.equal(interaction.appLogin, true);
  return { f, client, key, publicJwk, deviceId, verifier, state, nonce, interaction, clientId, redirectUri };
}

async function register(f, client, email, password) {
  const challenge = (await client(`${P}/auth/registration/request`, {
    method: 'POST', body: { email }, status: 200,
  })).data;
  const ticket = (await client(`${P}/auth/registration/verify`, {
    method: 'POST', body: { challengeId: challenge.challengeId, code: await f.mailCode(challenge.challengeId) }, status: 200,
  })).data;
  const result = (await client(`${P}/auth/registration/complete`, {
    method: 'POST', body: { passwordTicket: ticket.passwordTicket, password }, status: 200,
  })).data;
  assert.equal(result.verified, true);
  assert.equal(result.account.email, email);
  return result.account;
}

async function login(device, email, password, status) {
  return device.client(`${P}/auth/login`, {
    method: 'POST', status, body: {
      interactionUid: device.interaction.interactionUid, csrfToken: device.interaction.csrfToken,
      email, password, deviceId: device.deviceId, publicJwk: device.publicJwk,
      deviceName: 'Synthetic desktop', deviceType: 'windows',
    },
  });
}

async function exchange(device, result, account) {
  const resumedResponse = await device.client(`${P}/auth/authorization/resume`, {
    method: 'POST', body: { resumeUrl: result.data.resumeUrl }, status: 200,
  });
  const deleted = resumedResponse.headers.getSetCookie().filter(cookie => /^wm_cloud_resume(?:\.sig)?=/.test(cookie));
  assert.equal(deleted.length, 2, 'resume clears the cookie and its signature');
  for (const cookie of deleted) {
    assert.equal(/;\s*path=([^;]+)/i.exec(cookie)?.[1], '/personal/v1/cloud');
    const expires = /;\s*expires=([^;]+)/i.exec(cookie)?.[1];
    assert.ok(expires && Date.parse(expires) < Date.now(), 'resume expires the broadened cookie');
    if (cookie.startsWith('wm_cloud_resume='))
      assert.ok(cookie.startsWith('wm_cloud_resume=;'), 'resume clears the interaction identifier');
  }
  const resumed = resumedResponse.data;
  const callback = new URL(resumed.callbackUrl);
  const expectedCallback = new URL(device.redirectUri);
  assert.equal(callback.origin, expectedCallback.origin);
  assert.equal(callback.protocol, expectedCallback.protocol);
  assert.equal(callback.pathname, expectedCallback.pathname);
  assert.equal(callback.searchParams.get('state'), device.state);
  assert.equal(callback.searchParams.get('error'), null);
  assert.ok(callback.searchParams.get('code'));
  device.tokens = (await device.client(`${P}/oidc/token`, {
    method: 'POST', status: 200,
    headers: { dpop: await proof(device, device.f.origin + P + '/oidc/token') },
    form: {
      grant_type: 'authorization_code', client_id: device.clientId,
      redirect_uri: device.redirectUri, code: callback.searchParams.get('code'),
      code_verifier: device.verifier,
    },
  })).data;
  assert.equal(device.tokens.token_type, 'DPoP');
  assert.ok(device.tokens.refresh_token);
  const jwks = (await device.f.api(`${P}/oidc/jwks`, { status: 200 })).data;
  const keyset = createLocalJWKSet(jwks);
  const access = await jwtVerify(device.tokens.access_token, keyset, {
    issuer: device.f.config.issuer, audience: device.f.config.audience,
    algorithms: ['RS256'], typ: 'at+jwt',
  });
  assert.equal(access.payload.sub, account.cloudAccountId);
  assert.equal(access.payload.device_id, device.deviceId);
  assert.ok(access.payload.cnf.jkt);
  const id = await jwtVerify(device.tokens.id_token, keyset, {
    issuer: device.f.config.issuer, audience: device.clientId, algorithms: ['RS256'],
  });
  assert.equal(id.payload.nonce, device.nonce);
  assert.equal(id.payload.sub, account.cloudAccountId);
  const directory = (await control(device, '/devices')).data;
  assert.ok(directory.devices.some(entry => entry.id === device.deviceId && entry.isCurrent));
}

test('real provider: app registration confirms its initial device once, then eight-character password logs in with PKCE and DPoP', { timeout: 60000 }, async t => {
  const f = await fixture(t, { realProcess: true });
  const email = `${randomUUID()}@example.com`, password = randomPassword(8);
  const desktop = await bootstrap(f, 'registration-desktop');
  const account = await register(f, desktop.client, email, password);
  assert.equal(f.db.prepare('SELECT count(*) AS total FROM cloud_devices').get().total, 1);
  const initial = await login(desktop, email, password, 200);
  assert.equal(initial.data.challengeId, undefined);
  assert.equal(f.db.prepare("SELECT count(*) AS total FROM email_challenges WHERE purpose='device'").get().total, 0);
  await exchange(desktop, initial, account);

  const second = await bootstrap(f, 'second-desktop');
  const waiting = await login(second, email, password, 202);
  assert.equal(waiting.data.confirmationRequired, true);
  assert.equal(waiting.data.resumeUrl, undefined);
  const completed = await f.confirm({ ...second.interaction, client: second.client }, waiting.data.challengeId);
  assert.equal(completed.status, 200);
  await exchange(second, completed, account);
  assert.equal(f.db.prepare('SELECT count(*) AS total FROM cloud_devices').get().total, 2);
  assert.doesNotMatch(f.logs(), new RegExp(email));
  assert.ok(!f.logs().includes(password));
});

test('web callback: app registration and provider resume stay inside the app', async t => {
  const redirectUri = 'http://127.0.0.1:0/personal/v1/ui/';
  const f = await fixture(t, { env: { CLOUD_OIDC_CLIENTS: JSON.stringify([
    { client_id: 'test-web', application_type: 'web', redirect_uris: [redirectUri] },
  ]) } });
  const email = `${randomUUID()}@example.com`, password = randomPassword(8);
  const desktop = await bootstrap(f, 'web-registration-desktop', { clientId: 'test-web', redirectUri });
  const account = await register(f, desktop.client, email, password);
  const completed = await login(desktop, email, password, 200);
  await exchange(desktop, completed, account);
});

test('standalone registration remains compatible and requires device confirmation at its first app login', async t => {
  const f = await fixture(t), email = `${randomUUID()}@example.com`, password = randomPassword(8);
  const account = await register(f, f.api, email, password);
  assert.equal(f.db.prepare('SELECT count(*) AS total FROM cloud_devices').get().total, 0);
  const desktop = await bootstrap(f, 'standalone-desktop');
  const waiting = await login(desktop, email, password, 202);
  const completed = await f.confirm({ ...desktop.interaction, client: desktop.client }, waiting.data.challengeId);
  assert.equal(completed.status, 200);
  await exchange(desktop, completed, account);
});

test('seven- and 129-character registration passwords reject without activating the account or consuming its ticket', async t => {
  const f = await fixture(t), email = `${randomUUID()}@example.com`;
  const desktop = await bootstrap(f, 'password-boundary-desktop');
  const challenge = (await desktop.client(`${P}/auth/registration/request`, {
    method: 'POST', body: { email }, status: 200,
  })).data;
  const ticket = (await desktop.client(`${P}/auth/registration/verify`, {
    method: 'POST', body: { challengeId: challenge.challengeId, code: await f.mailCode(challenge.challengeId) }, status: 200,
  })).data;
  for (const length of [7, 129]) {
    const rejected = await desktop.client(`${P}/auth/registration/complete`, {
      method: 'POST', body: { passwordTicket: ticket.passwordTicket, password: randomPassword(length) }, status: 400,
    });
    assert.equal(rejected.data.error.code, 'INVALID_PASSWORD');
    assert.equal(f.db.prepare('SELECT active FROM cloud_accounts').get().active, 0);
    assert.equal(f.db.prepare('SELECT count(*) AS total FROM cloud_devices').get().total, 0);
    assert.equal(f.db.prepare('SELECT count(*) AS total FROM password_tickets').get().total, 1);
  }
  const password = randomPassword(8);
  const result = (await desktop.client(`${P}/auth/registration/complete`, {
    method: 'POST', body: { passwordTicket: ticket.passwordTicket, password }, status: 200,
  })).data;
  await exchange(desktop, await login(desktop, email, password, 200), result.account);
});

test('FX-9 one app cookie jar can log into a second synthetic account and return to the first without reusing its OIDC subject', async t => {
  const f=await fixture(t),client=f.browser();
  const emailA='fx9-first@example.com',emailB='fx9-second@example.com',password=randomPassword(24);
  const accountA=await register(f,client,emailA,password),accountB=await register(f,client,emailB,password);
  for (const [index,email,account] of [[1,emailA,accountA],[2,emailB,accountB],[3,emailA,accountA]]) {
    const device=await bootstrap(f,'fx9-desktop-'+index,{client});
    const begun=await login(device,email,password,202);
    const confirmed=await client(`${P}/auth/device/confirm`,{method:'POST',status:200,body:{
      interactionUid:device.interaction.interactionUid,csrfToken:device.interaction.csrfToken,
      challengeId:begun.data.challengeId,code:await f.mailCode(begun.data.challengeId)}});
    await exchange(device,confirmed,account);
  }
});
