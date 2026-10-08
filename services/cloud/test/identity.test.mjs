import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { request as httpRequest } from 'node:http';
import {
  fixture,
  PASSWORD,
  NEXT_PASSWORD,
  EMAIL,
  P,
  jwtVerify,
  createLocalJWKSet,
  decodeProtectedHeader,
  generateKeyPair,
  exportJWK,
  importJWK,
  SignJWT,
} from './identity-helpers.mjs';

test('registration → verification → device-confirmed code/PKCE login → refresh → reset → new device', async (t) => {
  const app = await fixture(t);
  const registration = await app.register('  Account@EXAMPLE.COM  ');
  const pending = app.db.prepare('SELECT * FROM cloud_accounts').get();
  assert.equal(pending.active, 0);
  assert.equal(pending.email, EMAIL);
  const record = JSON.parse(pending.password);
  assert.equal(record.N, 131072);
  assert.equal(record.algorithm, 'scrypt');
  assert.equal(record.salt.length, 64);
  assert.equal(record.hash.length, 128);
  assert.ok(!pending.password.includes(PASSWORD));
  const denied = await app.login(await app.begin());
  assert.equal(denied.status, 403);
  assert.equal(denied.data.error.code, 'EMAIL_NOT_VERIFIED');
  const account = (
    await app.api(`${P}/auth/register/verify`, {
      method: 'POST',
      body: {
        challengeId: registration.challengeId,
        code: await app.mailCode(registration.challengeId),
      },
      status: 200,
    })
  ).data.account;
  assert.equal(account.cloudAccountId, pending.id);
  const interaction = await app.begin();
  const waiting = await app.login(interaction);
  assert.equal(waiting.status, 202);
  assert.equal(waiting.data.access_token, undefined);
  const completed = await app.confirm(interaction, waiting.data.challengeId);
  assert.equal(completed.status, 200);
  const first = await app.tokens(interaction, completed);
  assert.equal(first.token_type, 'Bearer');
  assert.equal(first.expires_in, 300);
  assert.ok(first.refresh_token);
  const keyset = createLocalJWKSet(app.identity.keys.publicJwks);
  const { payload, protectedHeader } = await jwtVerify(first.access_token, keyset, {
    issuer: app.config.issuer,
    audience: app.config.audience,
    algorithms: ['RS256'],
    typ: 'at+jwt',
  });
  assert.equal(payload.sub, pending.id);
  assert.equal(payload.device_id, 'test-device');
  assert.equal(payload.auth_epoch, 0);
  assert.equal(payload.exp - payload.iat, 300);
  assert.ok(payload.jti);
  assert.equal(protectedHeader.alg, 'RS256');
  assert.ok(protectedHeader.kid);
  const id = await jwtVerify(first.id_token, keyset, {
    issuer: app.config.issuer,
    audience: 'test-native',
    algorithms: ['RS256'],
  });
  assert.equal(id.payload.nonce, interaction.nonce);
  assert.equal(id.payload.sub, pending.id);
  await app.api(`${P}/account`, {
    headers: { authorization: `Bearer ${first.access_token}` },
    status: 200,
  });
  const second = (await app.refresh(first.refresh_token)).data;
  assert.notEqual(second.refresh_token, first.refresh_token);
  const recovery = (
    await app.api(`${P}/auth/password/request`, {
      method: 'POST',
      body: { email: EMAIL },
      status: 200,
    })
  ).data;
  const reset = await app.api(`${P}/auth/password/reset`, {
    method: 'POST',
    body: {
      challengeId: recovery.challengeId,
      code: await app.mailCode(recovery.challengeId),
      password: NEXT_PASSWORD,
    },
    status: 200,
  });
  assert.equal(reset.data.notificationAccepted, true);
  assert.equal(app.db.prepare('SELECT auth_epoch FROM cloud_accounts').get().auth_epoch, 1);
  await app.refresh(second.refresh_token, 400);
  await app.api(`${P}/account`, {
    headers: { authorization: `Bearer ${first.access_token}` },
    status: 401,
  });
  assert.equal((await app.login(await app.begin(), { password: PASSWORD })).status, 401);
  const fresh = await app.begin();
  const newDevice = await app.login(fresh, { password: NEXT_PASSWORD, deviceId: 'another-device' });
  assert.equal(newDevice.status, 202);
  const confirmed = await app.confirm(fresh, newDevice.data.challengeId);
  assert.equal(confirmed.status, 200);
  const newTokens = await app.tokens(fresh, confirmed);
  assert.ok(newTokens.access_token);
  await app.restart();
  await app.refresh(newTokens.refresh_token);
  assert.equal(app.db.prepare('SELECT id FROM cloud_accounts').get().id, pending.id);
  const outbox = await Promise.all(
    (await readdir(app.config.mailDir)).map(async (name) =>
      JSON.parse(await readFile(path.join(app.config.mailDir, name), 'utf8')),
    ),
  );
  assert.ok(outbox.some((mail) => mail.subject === 'WeftMate 密码已更改'));
  assert.doesNotMatch(app.logs(), /account@example|验证码|password|access_token|refresh_token/);
  if (process.platform !== 'win32')
    assert.equal(
      (await stat(path.join(app.root, 'identity-keys', 'keys.json'))).mode & 0o777,
      0o600,
    );
});

test('verification expiry, replay and five wrong attempts survive restart', async (t) => {
  const app = await fixture(t);
  const a = await app.register('expire@example.com');
  const code = await app.mailCode(a.challengeId);
  app.advance(600001);
  await app.api(`${P}/auth/register/verify`, {
    method: 'POST',
    body: { challengeId: a.challengeId, code },
    status: 400,
  });
  const b = await app.register('replay@example.com');
  const body = { challengeId: b.challengeId, code: await app.mailCode(b.challengeId) };
  await app.api(`${P}/auth/register/verify`, { method: 'POST', body, status: 200 });
  await app.api(`${P}/auth/register/verify`, { method: 'POST', body, status: 400 });
  // Separate source-wide failures from this challenge's own five-attempt cap.
  app.advance(3600001);
  const c = await app.register('wrong@example.com');
  const right = await app.mailCode(c.challengeId);
  const wrong = right === '000000' ? '000001' : '000000';
  for (let i = 0; i < 5; i++)
    await app.api(`${P}/auth/register/verify`, {
      method: 'POST',
      body: { challengeId: c.challengeId, code: wrong },
      status: 400,
    });
  await app.restart();
  await app.api(`${P}/auth/register/verify`, {
    method: 'POST',
    body: { challengeId: c.challengeId, code: right },
    status: 429,
  });
  app.advance(2000);
  await app.api(`${P}/auth/register/verify`, {
    method: 'POST',
    body: { challengeId: c.challengeId, code: right },
    status: 400,
  });
  assert.equal(
    app.db.prepare('SELECT attempts FROM email_challenges WHERE id=?').get(c.challengeId).attempts,
    5,
  );
});

test('account/source backoff covers login, OTP and mail requests without trusting spoofed source', async (t) => {
  const app = await fixture(t);
  await app.verified();
  const interaction = await app.begin();
  for (let i = 0; i < 5; i++)
    assert.equal(
      (await app.login(interaction, { password: 'incorrect password with length' })).status,
      401,
    );
  const limited = await app.login(interaction);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '1');
  await app.api(`${P}/auth/password/request`, {
    method: 'POST',
    body: { email: 'other@example.com' },
    headers: { 'x-forwarded-for': '203.0.113.10' },
    status: 429,
  });
  app.advance(1001);
  assert.equal((await app.login(interaction)).status, 202);
  const limiter = app.identity.accounts.limiter;
  const accountKeys = limiter.keys('target@example.com', '203.0.113.20');
  for (let i = 0; i < 5; i++) limiter.fail(accountKeys);
  assert.throws(
    () => limiter.check(limiter.keys('target@example.com', '203.0.113.30')),
    /RATE_LIMITED/,
  );
  assert.throws(
    () => limiter.check(limiter.keys('someone@example.com', '203.0.113.20')),
    /RATE_LIMITED/,
  );
  app.advance(3600001);
  for (let i = 0; i < 5; i++)
    await app.api(`${P}/auth/password/request`, {
      method: 'POST',
      body: { email: 'unknown@example.com' },
      status: 200,
    });
  await app.api(`${P}/auth/password/request`, {
    method: 'POST',
    body: { email: 'unknown@example.com' },
    status: 429,
  });
});

test('refresh rotation detects reuse and revokes descendants; authorization codes are one-use', async (t) => {
  const app = await fixture(t);
  await app.verified();
  const first = await app.signedIn();
  const second = (await app.refresh(first.refresh_token)).data;
  const third = (await app.refresh(second.refresh_token)).data;
  const replay = await app.refresh(first.refresh_token, 400);
  assert.equal(replay.data.error, 'invalid_grant');
  await app.refresh(third.refresh_token, 400);
  const codeReplay = await app.api(`${P}/oidc/token`, {
    method: 'POST',
    form: {
      grant_type: 'authorization_code',
      client_id: 'test-native',
      redirect_uri: 'com.example.weftmate:/callback',
      code: first.code,
      code_verifier: first.interaction.verifier,
    },
    status: 400,
  });
  assert.equal(codeReplay.data.error, 'invalid_grant');
});

test('token verifier pins issuer/audience/algorithm/type/expiry and rejects ID tokens', async (t) => {
  const app = await fixture(t);
  await app.verified();
  const tokens = await app.signedIn();
  const keys = createLocalJWKSet(app.identity.keys.publicJwks);
  await assert.rejects(
    jwtVerify(tokens.access_token, keys, {
      issuer: 'https://wrong.example.com',
      audience: app.config.audience,
      algorithms: ['RS256'],
    }),
    /iss/,
  );
  await assert.rejects(
    jwtVerify(tokens.access_token, keys, {
      issuer: app.config.issuer,
      audience: 'wrong',
      algorithms: ['RS256'],
    }),
    /aud/,
  );
  await assert.rejects(jwtVerify(tokens.access_token, keys, { algorithms: ['ES256'] }), /alg/);
  const { payload } = await jwtVerify(tokens.access_token, keys, { algorithms: ['RS256'] });
  await assert.rejects(
    jwtVerify(tokens.access_token, keys, { currentDate: new Date((payload.exp + 1) * 1000) }),
    { code: 'ERR_JWT_EXPIRED' },
  );
  await app.api(`${P}/account`, {
    headers: { authorization: `Bearer ${tokens.id_token}` },
    status: 401,
  });
  const secret = Buffer.alloc(32);
  const fake = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' })
    .sign(secret);
  await app.api(`${P}/account`, { headers: { authorization: `Bearer ${fake}` }, status: 401 });
  const signingKey = await importJWK(app.identity.keys.privateJwks.keys[0], 'RS256');
  const header = { alg: 'RS256', kid: app.identity.keys.publicJwks.keys[0].kid, typ: 'at+jwt' };
  const expired = await new SignJWT({ ...payload, exp: 1 })
    .setProtectedHeader(header)
    .sign(signingKey);
  await app.api(`${P}/account`, { headers: { authorization: `Bearer ${expired}` }, status: 401 });
  for (const changed of [
    { iss: 'https://wrong.example.com' },
    { aud: 'https://host.example.com' },
  ]) {
    const forged = await new SignJWT({ ...payload, ...changed })
      .setProtectedHeader(header)
      .sign(signingKey);
    await app.api(`${P}/account`, { headers: { authorization: `Bearer ${forged}` }, status: 401 });
  }
});

test('PKCE S256, registered redirect URI, interaction cookie, Origin and CSRF are required', async (t) => {
  const app = await fixture(t);
  await app.verified();
  const params = new URLSearchParams({
    client_id: 'test-native',
    redirect_uri: 'com.example.weftmate:/callback',
    response_type: 'code',
    scope: 'openid',
    state: 'test',
  });
  const missing = await app.api(`${P}/oidc/auth?${params}`, { status: 303 });
  assert.match(missing.headers.get('location'), /error=invalid_request/);
  params.set('code_challenge', 'x'.repeat(43));
  params.set('code_challenge_method', 'plain');
  const plain = await app.api(`${P}/oidc/auth?${params}`, { status: 303 });
  assert.match(plain.headers.get('location'), /error=invalid_request/);
  params.set('redirect_uri', 'com.example.evil:/callback');
  await app.api(`${P}/oidc/auth?${params}`, { status: 400 });
  const interaction = await app.begin();
  await interaction.client(`${P}/auth/login`, {
    method: 'POST',
    body: { ...interaction, password: PASSWORD, email: EMAIL, deviceId: 'a', csrfToken: 'invalid' },
    status: 403,
  });
  await app.browser()(`${P}/auth/login`, {
    method: 'POST',
    body: {
      interactionUid: interaction.interactionUid,
      csrfToken: interaction.csrfToken,
      email: EMAIL,
      password: PASSWORD,
      deviceId: 'a',
    },
    status: 400,
  });
  await app.api(`${P}/auth/register`, {
    method: 'POST',
    body: { email: 'origin@example.com', password: PASSWORD },
    headers: { origin: 'https://evil.example.com' },
    status: 403,
  });
  await app.api(`${P}/auth/password/request`, {
    method: 'POST',
    body: { email: EMAIL },
    headers: { origin: '' },
    status: 403,
  });
  const valid = await app.signedIn();
  await app.api(`${P}/oidc/token`, {
    method: 'POST',
    form: {
      grant_type: 'authorization_code',
      client_id: 'test-native',
      redirect_uri: 'com.example.weftmate:/callback',
      code: valid.code,
      code_verifier: 'wrong'.repeat(10),
    },
    status: 400,
  });
});

test('JWKS rotation keeps old verification keys, switches kid, and persists refresh families', async (t) => {
  const app = await fixture(t);
  await app.verified();
  const first = await app.signedIn();
  const oldKid = decodeProtectedHeader(first.access_token).kid;
  await app.restart({ rotate: true });
  const jwks = (await app.api(`${P}/oidc/jwks`, { status: 200 })).data;
  assert.equal(jwks.keys.length, 2);
  assert.ok(jwks.keys.some((key) => key.kid === oldKid));
  assert.ok(jwks.keys.every((key) => !('d' in key)));
  await jwtVerify(first.access_token, createLocalJWKSet(jwks), {
    issuer: app.config.issuer,
    audience: app.config.audience,
    algorithms: ['RS256'],
  });
  const second = (await app.refresh(first.refresh_token)).data;
  assert.notEqual(decodeProtectedHeader(second.access_token).kid, oldKid);
  assert.notEqual(decodeProtectedHeader(second.id_token).kid, oldKid);
  await app.restart();
  await app.refresh(second.refresh_token);
  const pruned = await (
    await import('../src/keys.mjs')
  ).loadKeys(app.root, { now: Date.now() + 400000 });
  assert.equal(pruned.publicJwks.keys.length, 1);
});

test('known identifiers login, changed public key requires confirmation, cross-interaction OTP fails', async (t) => {
  const app = await fixture(t);
  await app.verified();
  await app.signedIn();
  const known = await app.begin();
  assert.equal((await app.login(known)).status, 200);
  const { publicKey } = await generateKeyPair('ES256');
  const publicJwk = await exportJWK(publicKey);
  const newer = await app.begin();
  const login = await app.login(newer, { publicJwk });
  assert.equal(login.status, 202);
  const other = await app.begin();
  assert.equal((await app.confirm(other, login.data.challengeId)).status, 400);
  assert.equal((await app.confirm(newer, login.data.challengeId)).status, 200);
  const again = await app.begin();
  assert.equal((await app.login(again, { publicJwk })).status, 200);
  const sso = await app.begin(newer.client);
  assert.ok(sso.interactionUid);
});

test('email is a mutable verified login name, unique, with an immutable public subject', async (t) => {
  const app = await fixture(t);
  const account = await app.verified();
  const auth = await app.signedIn();
  app.advance(3600001);
  await app.verified('taken@example.com');
  const headers = { authorization: `Bearer ${auth.access_token}` };
  const oldReset = (
    await app.api(`${P}/auth/password/request`, {
      method: 'POST',
      body: { email: EMAIL },
      status: 200,
    })
  ).data;
  const oldCode = await app.mailCode(oldReset.challengeId);
  await app.api(`${P}/auth/email/request`, {
    method: 'POST',
    headers,
    body: { email: 'taken@example.com', password: PASSWORD },
    status: 409,
  });
  const request = (
    await app.api(`${P}/auth/email/request`, {
      method: 'POST',
      headers,
      body: { email: 'new@example.com', password: PASSWORD },
      status: 200,
    })
  ).data;
  const changed = await app.api(`${P}/auth/email/confirm`, {
    method: 'POST',
    headers,
    body: { challengeId: request.challengeId, code: await app.mailCode(request.challengeId) },
    status: 200,
  });
  assert.equal(changed.data.account.cloudAccountId, account.cloudAccountId);
  assert.equal(changed.data.account.email, 'new@example.com');
  assert.equal(changed.data.account.auth_epoch, 1);
  await app.api(`${P}/auth/password/reset`, {
    method: 'POST',
    body: { challengeId: oldReset.challengeId, code: oldCode, password: NEXT_PASSWORD },
    status: 400,
  });
  await app.api(`${P}/account`, { headers, status: 401 });
  assert.equal((await app.login(await app.begin())).status, 401);
  assert.equal((await app.login(await app.begin(), { email: 'new@example.com' })).status, 200);
  assert.throws(
    () =>
      app.db
        .prepare('UPDATE cloud_accounts SET id=? WHERE id=?')
        .run('replacement', account.cloudAccountId),
    /immutable/,
  );
  assert.notEqual(
    JSON.parse(
      app.db.prepare('SELECT password FROM cloud_accounts WHERE email=?').get('taken@example.com')
        .password,
    ).salt,
    JSON.parse(
      app.db.prepare('SELECT password FROM cloud_accounts WHERE id=?').get(account.cloudAccountId)
        .password,
    ).salt,
  );
});

test('concurrent refresh replay cannot create two usable descendants; expired refresh is rejected', async (t) => {
  const app = await fixture(t);
  await app.verified();
  const first = await app.signedIn();
  const requests = await Promise.all([
    app.refresh(first.refresh_token, null),
    app.refresh(first.refresh_token, null),
  ]);
  assert.ok(requests.every((response) => [200, 400].includes(response.status)));
  assert.ok(requests.filter((response) => response.status === 200).length <= 1);
  for (const response of requests.filter((response) => response.status === 200))
    await app.refresh(response.data.refresh_token, 400);
  const fresh = await app.signedIn();
  const row = app.db
    .prepare("SELECT * FROM oidc_records WHERE model='RefreshToken' AND consumed IS NULL")
    .get();
  const payload = JSON.parse(row.payload);
  payload.exp = Math.floor(Date.now() / 1000) - 1;
  app.db
    .prepare('UPDATE oidc_records SET payload=? WHERE model=? AND id=?')
    .run(JSON.stringify(payload), row.model, row.id);
  await app.refresh(fresh.refresh_token, 400);
});

test('wrong PKCE verifier cannot redeem an unused code; discovery and audience stay cloud-only', async (t) => {
  const app = await fixture(t);
  await app.verified();
  const interaction = await app.begin();
  let result = await app.login(interaction);
  result = await app.confirm(interaction, result.data.challengeId);
  const resumed = await interaction.client(result.data.resumeUrl, { status: 303 });
  const code = new URL(resumed.headers.get('location')).searchParams.get('code');
  const response = await app.api(`${P}/oidc/token`, {
    method: 'POST',
    form: {
      grant_type: 'authorization_code',
      client_id: 'test-native',
      redirect_uri: 'com.example.weftmate:/callback',
      code,
      code_verifier: 'w'.repeat(43),
    },
    status: 400,
  });
  assert.equal(response.data.error, 'invalid_grant');
  const discovery = (await app.api(`${P}/oidc/.well-known/openid-configuration`, { status: 200 }))
    .data;
  assert.equal(discovery.issuer, app.config.issuer);
  assert.equal(discovery.jwks_uri, `${app.config.issuer}/jwks`);
  assert.deepEqual(discovery.code_challenge_methods_supported, ['S256']);
  assert.deepEqual(discovery.response_types_supported, ['code']);
  assert.ok(!discovery.grant_types_supported.includes('password'));
  const query = new URLSearchParams({
    client_id: 'test-native',
    redirect_uri: 'com.example.weftmate:/callback',
    response_type: 'code',
    scope: 'openid cloud:account',
    code_challenge: 'a'.repeat(43),
    code_challenge_method: 'S256',
    resource: 'https://host.example.com',
  });
  const badResource = await app.api(`${P}/oidc/auth?${query}`, { status: 303 });
  assert.match(badResource.headers.get('location'), /error=invalid_target/);
  const hostStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(
      `${app.origin}${P}/account`,
      { headers: { host: 'evil.example.com' } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on('error', reject);
    req.end();
  });
  assert.equal(hostStatus, 400);
});

test('HTTPS issuer behind an explicitly trusted loopback proxy issues host-only Secure HttpOnly cookies', async (t) => {
  const app = await fixture(t, {
    env: {
      CLOUD_ISSUER: 'https://api.example.com/personal/v1/cloud/oidc',
      CLOUD_TRUST_PROXY: 'true',
    },
  });
  const query = new URLSearchParams({
    client_id: 'test-native',
    redirect_uri: 'com.example.weftmate:/callback',
    response_type: 'code',
    scope: 'openid',
    code_challenge: 'a'.repeat(43),
    code_challenge_method: 'S256',
  });
  const response = await app.api(`${P}/oidc/auth?${query}`, {
    headers: { 'x-forwarded-host': 'api.example.com', 'x-forwarded-proto': 'https' },
    status: 303,
  });
  const cookies = response.headers.getSetCookie();
  assert.ok(cookies.length);
  for (const cookie of cookies) {
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /Secure/i);
    assert.doesNotMatch(cookie, /Domain=/i);
    assert.match(cookie, /SameSite=None/i);
  }
});

test('reset challenge replay and an old pending device confirmation fail after auth_epoch changes', async (t) => {
  const app = await fixture(t);
  await app.verified();
  const interaction = await app.begin();
  const pending = await app.login(interaction);
  const deviceCode = await app.mailCode(pending.data.challengeId);
  const challenge = (
    await app.api(`${P}/auth/password/request`, {
      method: 'POST',
      body: { email: EMAIL },
      status: 200,
    })
  ).data;
  const body = {
    challengeId: challenge.challengeId,
    code: await app.mailCode(challenge.challengeId),
    password: NEXT_PASSWORD,
  };
  await app.api(`${P}/auth/password/reset`, { method: 'POST', body, status: 200 });
  await app.api(`${P}/auth/password/reset`, { method: 'POST', body, status: 400 });
  assert.equal((await app.confirm(interaction, pending.data.challengeId, deviceCode)).status, 400);
});

test('scrypt cost is measured on the actual runner and notification failures preserve a committed reset', async (t) => {
  const app = await fixture(t);
  const start = performance.now();
  const before = process.memoryUsage().rss;
  await app.verified();
  t.diagnostic(
    `scrypt N=131072,r=8,p=1,maxmem=192MiB; runner=${process.platform}/${process.arch}; registration_ms=${Math.round(performance.now() - start)}; rss_delta_mib=${Math.round((process.memoryUsage().rss - before) / 1024 / 1024)}`,
  );
  const request = (
    await app.api(`${P}/auth/password/request`, {
      method: 'POST',
      body: { email: EMAIL },
      status: 200,
    })
  ).data;
  app.identity.accounts.mailer = {
    send: async () => {
      throw new Error('fixture-mail-unavailable');
    },
  };
  const response = await app.api(`${P}/auth/password/reset`, {
    method: 'POST',
    body: {
      challengeId: request.challengeId,
      code: await app.mailCode(request.challengeId),
      password: NEXT_PASSWORD,
    },
    status: 200,
  });
  assert.equal(response.data.passwordChanged, true);
  assert.equal(response.data.notificationAccepted, false);
  assert.equal(app.db.prepare('SELECT auth_epoch FROM cloud_accounts').get().auth_epoch, 1);
});
