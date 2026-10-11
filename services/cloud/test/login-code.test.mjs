import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture, P, EMAIL, PASSWORD, generateKeyPair, exportJWK, jwtVerify, createLocalJWKSet } from './identity-helpers.mjs';
import { registration, proof, control, refresh } from './app-helpers.mjs';

const sha = value => createHash('sha256').update(value).digest('base64url');
async function begin(f, deviceId = 'synthetic-phone', key = null) {
  key ??= await generateKeyPair('ES256');
  const client = f.browser(), publicJwk = await exportJWK(key.publicKey);
  const verifier = randomBytes(32).toString('base64url'), state = randomUUID();
  const interaction = (await client(`${P}/auth/authorization`, { method: 'POST', status: 200, body: {
    clientId: 'test-native', redirectUri: 'com.example.weftmate:/callback', deviceId, publicJwk,
    codeChallenge: sha(verifier), state, nonce: randomUUID(),
  } })).data;
  return { f, client, key, publicJwk, deviceId, verifier, state, interaction };
}
const requestBody = (device, email = EMAIL) => ({ interactionUid: device.interaction.interactionUid,
  csrfToken: device.interaction.csrfToken, email, deviceId: device.deviceId, publicJwk: device.publicJwk,
  deviceName: 'Synthetic phone', deviceType: 'web' });
async function request(device, email = EMAIL, status = 202) {
  return device.client(`${P}/auth/login/code/request`, { method: 'POST', body: requestBody(device, email), status });
}
async function confirm(device, challengeId, code, status = 200) {
  return device.client(`${P}/auth/login/code/confirm`, { method: 'POST', status, body: {
    interactionUid: device.interaction.interactionUid, csrfToken: device.interaction.csrfToken, challengeId, code,
  } });
}
async function finish(device, completed) {
  const resumed = (await device.client(`${P}/auth/authorization/resume`, { method: 'POST', status: 200,
    body: { resumeUrl: completed.data.resumeUrl } })).data;
  const callback = new URL(resumed.callbackUrl);
  assert.equal(callback.searchParams.get('state'), device.state);
  device.tokens = (await device.client(`${P}/oidc/token`, { method: 'POST', status: 200,
    headers: { dpop: await proof(device, `${device.f.origin}${P}/oidc/token`) }, form: {
      grant_type: 'authorization_code', client_id: 'test-native', redirect_uri: 'com.example.weftmate:/callback',
      code: callback.searchParams.get('code'), code_verifier: device.verifier,
    } })).data;
  assert.equal(device.tokens.token_type, 'DPoP');
  return device;
}
async function verifiedClaims(device, audience = device.f.config.audience) {
  return (await jwtVerify(device.tokens.access_token, createLocalJWKSet(device.f.identity.keys.publicJwks), {
    issuer: device.f.config.issuer, audience, algorithms: ['RS256'], typ: 'at+jwt',
  })).payload;
}

test('email-code login binds the verified mailbox to the interaction key, grants ordinary PKCE/DPoP tokens, and allows later password login', async t => {
  const f = await fixture(t); const { account } = await registration(f);
  const device = await begin(f), challenge = (await request(device)).data;
  assert.deepEqual(Object.keys(challenge).sort(), ['challengeId','confirmationRequired','expiresIn']);
  assert.equal(challenge.expiresIn, 600);
  const code = await f.mailCode(challenge.challengeId);
  const completed = await confirm(device, challenge.challengeId, code);
  assert.equal(completed.data.account.cloudAccountId, account.cloudAccountId);
  await finish(device, completed);
  const claims = await verifiedClaims(device);
  assert.equal(claims.device_verified, true); assert.equal(claims.device_id, device.deviceId); assert.ok(claims.cnf.jkt);
  assert.doesNotMatch(JSON.stringify(claims), /account@example|password/);
  assert.equal((await control(device, '/devices')).data.devices[0].firstUsedAt,
    new Date(f.db.prepare('SELECT confirmed_at FROM cloud_devices').get().confirmed_at).toISOString());
  await refresh(device); assert.equal((await verifiedClaims(device)).device_verified, true);
  // A registered installation may select the ordinary refresh family after
  // mailbox verification; no second-device approval is needed. Seed only
  // synthetic control-plane rows, never user content or a real host.
  const hostId='synthetic-code-host';
  f.db.prepare('INSERT INTO host_claims VALUES(?,?,?,?,?,?,?,?,?)').run('synthetic-code-claim',hostId,
    JSON.stringify(device.publicJwk),claims.cnf.jkt,'a'.repeat(43),'synthetic-challenge',f.now+600000,account.cloudAccountId,'active');
  f.db.prepare('INSERT INTO cloud_hosts(host_id,public_jwk,jkt,tls_spki) VALUES(?,?,?,?)')
    .run(hostId,JSON.stringify(device.publicJwk),claims.cnf.jkt,'a'.repeat(43));
  f.db.prepare('INSERT INTO host_memberships VALUES(?,?,?,?)').run(hostId,account.cloudAccountId,'owner','synthetic-code-claim');
  f.db.prepare('INSERT INTO host_device_status VALUES(?,?,?,?,?)').run(hostId,account.cloudAccountId,device.deviceId,claims.cnf.jkt,'pending');
  const selected=(await control(device,'/hosts/connect',{hostId})).data;
  assert.equal(selected.approval,'trusted'); assert.equal(selected.pairingRequired,false);
  assert.equal(f.db.prepare('SELECT status FROM host_device_status').get().status,'pending','connect does not bulk-rewrite history');
  await refresh(device,selected.resource);
  assert.equal((await verifiedClaims(device,selected.resource)).device_verified,true);
  await refresh(device,f.config.audience);
  f.db.prepare("UPDATE host_device_status SET status='revoked'").run();
  await control(device,'/hosts/connect',{hostId},403);
  assert.equal(f.db.prepare('SELECT status FROM host_device_status').get().status,'revoked');
  const later = await begin(f, device.deviceId, device.key);
  const login = await later.client(`${P}/auth/login`, { method: 'POST', status: 200,
    body: { ...requestBody(later), password: PASSWORD } });
  await finish(later, login);
  assert.equal((await verifiedClaims(later)).device_verified, true);
  // A changed key is a new device even when its display ID is reused.
  const changed = await begin(f, device.deviceId);
  const newKey = await changed.client(`${P}/auth/login`, { method: 'POST', status: 202,
    body: { ...requestBody(changed), password: PASSWORD } });
  assert.equal(newKey.data.confirmationRequired, true);
});

test('email-code request and invalid confirmation cannot enumerate active, unknown or unverified accounts; delivery failure stays opaque', async t => {
  const f = await fixture(t); await registration(f);
  await f.register('pending@example.com');
  const requests = [];
  for (const email of [EMAIL,'unknown@example.com','pending@example.com']) {
    const device = await begin(f, `synthetic-${requests.length}`), response = await request(device,email);
    requests.push({ device, response });
  }
  assert.deepEqual(requests.map(({response}) => [response.status, Object.keys(response.data).sort(), response.data.expiresIn]),
    Array(3).fill([202, ['challengeId','confirmationRequired','expiresIn'],600]));
  assert.equal(new Set(requests.map(({response}) => response.data.challengeId)).size,3);
  for (const {device,response} of requests) {
    const result = await confirm(device,response.data.challengeId,'invalid',400);
    assert.equal(result.data.error.code,'INVALID_LOGIN_CODE');
  }
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM email_challenges WHERE purpose='device'").get().n,1);
  f.advance(600001);
  const failing = await begin(f,'synthetic-failed-mail');
  f.identity.accounts.mailer = {send: async () => {throw new Error('synthetic failure');}};
  const opaque = await request(failing);
  assert.equal(opaque.status,202); assert.equal(opaque.data.expiresIn,600);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM cloud_devices").get().n,0);
});

test('email-code responses do not wait for account-dependent mail delivery, and shutdown owns all in-flight sends', async t => {
  const f=await fixture(t); await registration(f);
  const device=await begin(f), mailer=f.identity.accounts.mailer;
  let release, entered;
  const held=new Promise(resolve=>{release=resolve;}), ready=new Promise(resolve=>{entered=resolve;});
  f.identity.accounts.mailer={...mailer,send:async message=>{entered(); await held; return mailer.send(message);}};
  const pending=request(device); await ready;
  let response;
  try {
    response=await Promise.race([pending,delay(1000).then(()=>{throw new Error('mail delivery must not gate login-code response');})]);
    assert.equal(response.status,202);
    assert.equal(f.identity.accounts.pendingMail.size,1);
    const unknown=await request(await begin(f,'synthetic-unknown'),'unknown@example.com');
    assert.deepEqual(Object.keys(unknown.data).sort(),Object.keys(response.data).sort());
    assert.equal(unknown.data.expiresIn,response.data.expiresIn);
  } finally { release(); }
  await f.identity.accounts.settleMail(); assert.equal(f.identity.accounts.pendingMail.size,0);
  await finish(device,await confirm(device,response.data.challengeId,await f.mailCode(response.data.challengeId)));
});

test('email-code challenge expires in ten minutes, is single use, is tied to its interaction, and cannot substitute a bootstrap key or bypass CSRF', async t => {
  const f = await fixture(t); await registration(f);
  const a = await begin(f,'synthetic-a'), b = await begin(f,'synthetic-b');
  const challenge = (await request(a)).data, code = await f.mailCode(challenge.challengeId);
  await confirm(b,challenge.challengeId,code,400);
  await a.client(`${P}/auth/login/code/request`, { method:'POST',status:403,
    body:{...requestBody(a),csrfToken:'invalid'} });
  await a.client(`${P}/auth/login/code/request`, { method:'POST',status:400,
    body:{...requestBody(a),publicJwk:b.publicJwk} });
  f.advance(600000);
  assert.equal((await confirm(a,challenge.challengeId,code,400)).data.error.code,'INVALID_LOGIN_CODE');
  const c = await begin(f,'synthetic-c'), valid = (await request(c)).data;
  const validCode = await f.mailCode(valid.challengeId);
  await finish(c,await confirm(c,valid.challengeId,validCode));
  // Completion consumes the interaction as well as the challenge.
  await confirm(c,valid.challengeId,validCode,400);
  assert.equal(f.db.prepare('SELECT consumed FROM email_challenges WHERE id=?').get(valid.challengeId).consumed,1);
});

test('five wrong email-code attempts exhaust the challenge, with durable account/source backoff and request delivery limits', async t => {
  const f = await fixture(t); await registration(f);
  const device = await begin(f), challenge = (await request(device)).data, code = await f.mailCode(challenge.challengeId);
  const wrong = code === '000000' ? '000001' : '000000';
  for(let i=0;i<5;i++) await confirm(device,challenge.challengeId,wrong,400);
  assert.equal(f.db.prepare('SELECT attempts FROM email_challenges WHERE id=?').get(challenge.challengeId).attempts,5);
  const blocked = await confirm(device,challenge.challengeId,code,429);
  assert.equal(blocked.data.error.code,'RATE_LIMITED'); assert.ok(Number(blocked.headers.get('retry-after'))>0);
  f.advance(1001);
  assert.equal((await confirm(device,challenge.challengeId,code,400)).data.error.code,'INVALID_LOGIN_CODE');
  f.advance(3600001); await f.restart();
  const sender = await begin(f,'synthetic-delivery');
  for(let i=0;i<5;i++) await request(sender,'unknown@example.com');
  const rate = await request(sender,'unknown@example.com',429);
  assert.equal(rate.data.error.code,'RATE_LIMITED'); assert.equal(rate.headers.get('retry-after'),'600');
  // Source limits also stop rotating the target email to evade the send cap.
  await request(sender,'another-unknown@example.com',429);
  assert.ok((await readdir(f.config.mailDir)).length>0);
});

test('email-code login preserves logout/revocation and challenge cancellation instead of restoring a logged-out grant', async t => {
  const f = await fixture(t); await registration(f);
  const a = await begin(f,'synthetic-current'), first = (await request(a)).data;
  await finish(a,await confirm(a,first.challengeId,await f.mailCode(first.challengeId)));
  const b = await begin(f,'synthetic-pending'), pending = (await request(b)).data, code = await f.mailCode(pending.challengeId);
  await control(a,'/auth/logout/others',{});
  await confirm(b,pending.challengeId,code,400);
  assert.equal(f.db.prepare('SELECT * FROM email_challenges WHERE id=?').get(pending.challengeId),undefined);
  await control(a,'/auth/logout',{});
  await control(a,'/devices',undefined,401); await refresh(a,undefined,400);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM cloud_devices').get().n,0);
});
