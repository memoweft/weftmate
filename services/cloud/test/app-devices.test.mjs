import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, P, EMAIL, PASSWORD, NEXT_PASSWORD, generateKeyPair, exportJWK, SignJWT, jwtVerify, importJWK } from './identity-helpers.mjs';

import { registration, appDevice, proof, control, refresh, hostFixture } from './app-helpers.mjs';
import { calculateJwkThumbprint } from 'jose';

test('app registration verifies email before password; tickets have purpose, expiry and single-use authority', async t => {
  const f = await fixture(t);
  const { account, ticket, challenge } = await registration(f);
  assert.equal(account.email, EMAIL);
  assert.equal(f.db.prepare('SELECT active FROM cloud_accounts').get().active, 1);
  assert.doesNotMatch(f.db.prepare('SELECT password FROM cloud_accounts').get().password, new RegExp(PASSWORD));
  await f.api(`${P}/auth/registration/complete`, { method: 'POST', body: { passwordTicket: ticket.passwordTicket, password: NEXT_PASSWORD }, status: 400 });
  await f.api(`${P}/auth/registration/verify`, { method: 'POST', body: { challengeId: challenge.challengeId, code: await f.mailCode(challenge.challengeId) }, status: 400 });
  const second = (await f.api(`${P}/auth/registration/request`, { method: 'POST', body: { email: 'expire@example.com' }, status: 200 })).data;
  const expired = (await f.api(`${P}/auth/registration/verify`, { method: 'POST',
    body: { challengeId: second.challengeId, code: await f.mailCode(second.challengeId) }, status: 200 })).data;
  await f.api(`${P}/auth/recovery/complete`, { method: 'POST', body: { passwordTicket: expired.passwordTicket, password: PASSWORD }, status: 400 });
  await f.restart(); f.advance(600001);
  await f.api(`${P}/auth/registration/complete`, { method: 'POST', body: { passwordTicket: expired.passwordTicket, password: PASSWORD }, status: 400 });
});

test('app authorization has registered-origin CORS, validates redirect/key bootstrap and cannot issue a Bearer fallback', async t => {
  const f = await fixture(t, { env: { CLOUD_OIDC_CLIENTS: JSON.stringify([
    { client_id: 'test-native', redirect_uris: ['com.example.weftmate:/callback'] },
    { client_id: 'test-web', application_type: 'web', redirect_uris: ['http://127.0.0.1:18379/personal/v1/ui/'] },
  ]) } });
  await registration(f);
  const preflight = await f.api(`${P}/auth/authorization`, { method: 'OPTIONS',
    headers: { origin: 'http://127.0.0.1:18379', 'access-control-request-method': 'POST' }, status: 204 });
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://127.0.0.1:18379');
  assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
  await f.api(`${P}/auth/registration/request`, { method: 'POST', body: { email: 'bad@example.com' },
    headers: { origin: 'https://unregistered.example.com' }, status: 403 });
  await f.api(`${P}/auth/authorization/resume`, { method: 'POST', body: { resumeUrl: 'https://other.example.com/' }, status: 400 });
  const key = await generateKeyPair('ES256'), publicJwk = await exportJWK(key.publicKey);
  const request = { clientId: 'test-native', redirectUri: 'com.example.weftmate:/callback', deviceId: 'desktop',
    publicJwk, codeChallenge: 'a'.repeat(43), state: randomUUID(), nonce: randomUUID() };
  await f.api(`${P}/auth/authorization`, { method: 'POST', body: { ...request, redirectUri: 'com.example.weftmate:/wrong' }, status: 400 });
  const started = (await f.api(`${P}/auth/authorization`, { method: 'POST', body: request, status: 200 })).data;
  await f.api(`${P}/auth/login`, { method: 'POST', body: { ...started, email: EMAIL, password: PASSWORD,
    deviceId: 'desktop', publicJwk: await exportJWK((await generateKeyPair('ES256')).publicKey) }, status: 400 });
  const failed = await appDevice(f, 'no-proof', EMAIL, PASSWORD, true);
  assert.equal(failed.tokens.error, 'invalid_grant');
});

test('in-app authorization requires the bootstrapped key and provider DPoP; password change and recovery revoke old families', async t => {
  const f = await fixture(t); await registration(f);
  const desktop = await appDevice(f, 'desktop');
  const original = desktop.tokens.refresh_token;
  await refresh(desktop);
  assert.notEqual(desktop.tokens.refresh_token, original);
  await desktop.client(`${P}/devices`, { status: 401, headers: { authorization: `Bearer ${desktop.tokens.access_token}` } });
  await control(desktop, '/auth/password/change', { currentPassword: NEXT_PASSWORD, password: NEXT_PASSWORD }, 401);
  await control(desktop, '/auth/password/change', { currentPassword: PASSWORD, password: NEXT_PASSWORD });
  await refresh(desktop, undefined, 400);
  await control(desktop, '/devices', undefined, 401);
  const newDevice = await appDevice(f, 'second', EMAIL, NEXT_PASSWORD);
  const reset = (await f.api(`${P}/auth/recovery/request`, { method: 'POST', body: { email: EMAIL }, status: 200 })).data;
  const ticket = (await f.api(`${P}/auth/recovery/verify`, { method: 'POST', body: {
    challengeId: reset.challengeId, code: await f.mailCode(reset.challengeId),
  }, status: 200 })).data;
  await f.api(`${P}/auth/recovery/complete`, { method: 'POST', body: { passwordTicket: ticket.passwordTicket, password: PASSWORD }, status: 200 });
  await refresh(newDevice, undefined, 400);
  assert.doesNotMatch(f.logs(), /account@example|passwordTicket|access_token|refresh_token/);
});

test('device directory is account-scoped; cloud DPoP checks key, URL, hash and replay; logout only removes this device', async t => {
  const f = await fixture(t); await registration(f); await registration(f, 'other@example.com');
  const a = await appDevice(f, 'desktop'), b = await appDevice(f, 'phone'), other = await appDevice(f, 'other', 'other@example.com');
  const list = (await control(a, '/devices')).data;
  assert.deepEqual(list.devices.map(d => [d.name,d.type,d.isCurrent]).sort(), [['desktop','windows',true],['phone','ios',false]]);
  assert.ok(list.devices.every(d => d.online && d.lastUsedAt));
  assert.deepEqual((await control(other, '/devices')).data.devices.map(d => d.id), ['other']);
  const url = f.origin + P + '/devices', dpop = await proof(a, url, a.tokens.access_token, {}, 'GET');
  const headers = { authorization: `DPoP ${a.tokens.access_token}`, dpop };
  await f.api(url, { headers, status: 200 }); await f.api(url, { headers, status: 401 });
  for (const bad of [await proof(b, url, a.tokens.access_token, {}, 'GET'),
    await proof(a, url + '/wrong', a.tokens.access_token, {}, 'GET'), await proof(a, url, 'wrong-token', {}, 'GET')])
    await f.api(url, { headers: { ...headers, dpop: bad }, status: 401 });
  await control(a, '/hosts/connect', { hostId: 'unknown-host' }, 404);
  await control(a, '/auth/logout', {});
  await refresh(a, undefined, 400);
  await refresh(b);
  assert.deepEqual((await control(b, '/devices')).data.devices.map(d => d.id), ['phone']);
});

test('real cloud process + isolated host: native owner → cloud bind → verified phone login → desktop-confirmed QR + signed host handoff', { timeout: 90000 }, async t => {
  const f = await fixture(t, { realProcess: true }); await registration(f);
  const desktop = await appDevice(f, 'desktop');
  const { host, started, hostApi, exchange } = await hostFixture(f, t);
  const local = await exchange(desktop, '/auth/cloud-desktop');
  assert.equal(local.status, 200, JSON.stringify(local));
  await host.syncCloudRevocations();
  const binding = await hostApi('/cloud/binding', undefined, local);
  assert.equal(binding.status,200,JSON.stringify(binding));
  assert.equal(binding.data.status, 'active');
  const directory = (await control(desktop, '/devices')).data;
  assert.equal(directory.hosts[0].hostId, started.hostId);
  assert.equal(directory.hosts[0].isCurrent, true);
  assert.equal(directory.hosts[0].online, true);
  assert.doesNotMatch(JSON.stringify(directory), /tlsSpki|publicJwk|pin|credential/);
  const phone = await appDevice(f, 'phone');
  const selected = (await control(phone, '/hosts/connect', { hostId: started.hostId })).data;
  assert.equal(selected.approval, 'trusted'); assert.equal(selected.pairingRequired,false);
  await refresh(phone, selected.resource);
  const remote = await exchange(phone, '/auth/cloud-session');
  assert.equal(remote.status, 200); assert.ok(remote.cookie);
  assert.equal((await hostApi('/sessions')).status, 401);
  assert.equal((await hostApi('/cloud/devices/pending', undefined, local)).data.devices.length,0);
  await host.syncCloudRevocations();
  // Refresh back to cloud to use the settings directory; the same rotating
  // refresh family selects a different resource, without another password.
  await refresh(phone, f.config.audience);
  assert.equal((await control(phone, '/devices')).data.hosts[0].hostId, started.hostId);
  const connect = (await control(phone, '/hosts/connect', { hostId: started.hostId })).data;
  assert.equal(connect.approval, 'trusted'); assert.equal(connect.pairingRequired, false);
  const handoff = remote.hostTrust;
  assert.ok(handoff.trustToken);
  const verified = await jwtVerify(handoff.trustToken, await importJWK(handoff.publicJwk, 'ES256'), {
    issuer: started.hostId, audience: handoff.jkt, algorithms: ['ES256'], typ: 'wm-host-trust+jwt' });
  assert.equal(verified.payload.deviceId, 'phone'); assert.equal(verified.payload.tlsSpki, handoff.tlsSpki);
  const { verifyHostTrust } = await import('../../../src/personal-cloud/trust.mjs');
  const trustInput = { trustToken: handoff.trustToken, trustedPublicJwk: handoff.publicJwk,
    hostId: started.hostId, sub: verified.payload.sub, deviceId: 'phone', jkt: handoff.jkt };
  assert.equal((await verifyHostTrust(trustInput)).tlsSpki, handoff.tlsSpki);
  for (const overrides of [{ trustedPublicJwk: phone.publicJwk }, { deviceId: 'desktop' }, { sub: 'other' },
    { jkt: 'other-key' }, { now: Date.now() + 121000 }, { trustToken: handoff.trustToken.slice(0, -8) + 'invalidx' }])
    await assert.rejects(verifyHostTrust({ ...trustInput, ...overrides }), /HOST_TRUST_INVALID/);
  await assert.rejects(jwtVerify(handoff.trustToken, await importJWK(phone.publicJwk, 'ES256')));
  assert.equal((await hostApi(`/cloud/devices/${randomUUID()}/trust`, {})).status, 401);
  const pairing = await hostApi('/cloud/pairings', {}, local);
  assert.equal(pairing.status, 201); assert.equal(pairing.tlsSpki, handoff.tlsSpki);
  const qr = `wm1.${Buffer.from(JSON.stringify(pairing.data)).toString('base64url')}`;
  const scanned = JSON.parse(Buffer.from(qr.slice(4), 'base64url'));
  await refresh(phone, connect.resource);
  const phoneNonce=randomBytes(32).toString('base64url'),jkt=await calculateJwkThumbprint(phone.publicJwk);
  const H=value=>createHash('sha256').update(JSON.stringify(value)).digest();
  const joined=await exchange(phone,'/cloud/pairings/join',{challenge:scanned.challenge,
    phoneCommitment:H(['wm-pair-phone-v2',scanned.challenge,phone.deviceId,jkt,phoneNonce]).toString('base64url')});
  assert.equal(joined.status,200,JSON.stringify(joined));assert.equal(joined.csrfToken,undefined);
  const transcript=[2,scanned.issuer,scanned.sub,scanned.hostId,scanned.tlsSpki,await calculateJwkThumbprint(scanned.publicJwk),
    scanned.challenge,scanned.expiresAt,scanned.origin,scanned.relay?.baseUrl||''];
  assert.equal(H(['wm-pair-host-v2',...transcript,joined.hostNonce]).toString('base64url'),scanned.hostCommitment);
  assert.equal((await exchange(phone,'/cloud/pairings/reveal',{challenge:scanned.challenge,phoneNonce})).status,200);
  const sas=(H(['wm-pair-sas-v2',...transcript,joined.hostNonce,phone.deviceId,jkt,phoneNonce]).readUInt32BE(0)%1000000).toString().padStart(6,'0');
  assert.equal((await hostApi('/cloud/pairings/status',{challenge:scanned.challenge},local)).verificationCode,sas);
  assert.equal((await exchange(phone,'/cloud/pairings/redeem',{challenge:scanned.challenge})).status,403);
  assert.equal((await hostApi('/cloud/pairings/decision',{challenge:scanned.challenge,decision:'confirm',verificationCode:sas},local)).status,200);
  const session = await exchange(phone, '/cloud/pairings/redeem', { challenge: scanned.challenge });
  assert.equal(session.status, 200, JSON.stringify(session));
  assert.equal(session.account.ownerId, local.account.ownerId);
  assert.equal((await exchange(phone, '/cloud/pairings/redeem', { challenge: scanned.challenge })).status, 401);
  assert.equal((await hostApi('/cloud/pairings', {}, session)).status, 403, 'phone is not the local desktop');
  assert.equal((await exchange(desktop, '/auth/cloud-desktop')).account.ownerId, local.account.ownerId, 'repeat desktop login keeps the same owner');
  await registration(f, 'stranger@example.com');
  const stranger = await appDevice(f, 'stranger', 'stranger@example.com');
  assert.equal((await control(stranger, '/devices')).data.hosts.length, 0);
  await control(stranger, '/hosts/connect', { hostId: started.hostId }, 404);
  const otherLocal = await exchange(stranger, '/auth/cloud-desktop');
  assert.equal(otherLocal.status, 409,'a different cloud account cannot substitute the selected local owner');
  assert.equal((await hostApi('/auth/me', undefined, local)).account.ownerId,local.account.ownerId);
  assert.equal((await hostApi('/cloud/emergency-password', { password: NEXT_PASSWORD }, session)).status, 403);
  assert.equal((await hostApi('/cloud/emergency-password', { password: NEXT_PASSWORD }, local)).status, 200);
  await host.syncCloudRevocations();
  // The host's secondary password remains local and works without cloud.
  const offline = await hostApi('/auth/cloud-offline', { cloudAccountId: verified.payload.sub,
    password: NEXT_PASSWORD, deviceName: 'Offline desktop' });
  assert.equal(offline.status, 200); assert.equal(offline.account.ownerId, local.account.ownerId);
  assert.equal((await hostApi('/auth/cloud-offline', { cloudAccountId: verified.payload.sub,
    password: PASSWORD, deviceName: 'Offline desktop' })).status, 401);
  assert.doesNotMatch(f.logs(), /account@example|password|access_token|refresh_token|tlsSpki/);
});

test('native cloud login keeps the selected owner, admits only email-verified keys, and rejects nonce replay or forwarded bootstrap', { timeout: 60000 }, async t => {
  const f = await fixture(t); const { account } = await registration(f);
  const desktop = await appDevice(f, 'desktop');
  const { host, started, hostApi, exchange } = await hostFixture(f, t);
  const local = await exchange(desktop, '/auth/cloud-desktop');
  assert.equal(local.status, 200);
  const next = await appDevice(f, 'new-desktop');
  const nextLogin = await exchange(next, '/auth/cloud-desktop');
  assert.equal(nextLogin.status, 200); assert.equal(nextLogin.account.ownerId,local.account.ownerId);
  assert.equal((await exchange(next, '/auth/cloud-desktop')).account.ownerId, local.account.ownerId);
  const nonce = await hostApi('/auth/cloud-nonce', {});
  const url = started.origin + '/personal/v1/auth/cloud-desktop';
  const dpop = await proof(desktop, url, desktop.tokens.access_token, { nonce: nonce.nonce });
  const body = { accessToken: desktop.tokens.access_token, deviceName: 'desktop' };
  const nativeHeader = { 'x-weftmate-desktop': host.libraryDesktopToken };
  assert.equal((await hostApi('/auth/cloud-desktop', body, local, { ...nativeHeader,dpop, 'x-forwarded-for': '127.0.0.1' })).status, 403);
  assert.equal((await hostApi('/auth/cloud-desktop', body, local, { ...nativeHeader,dpop })).status, 200);
  assert.equal((await hostApi('/auth/cloud-desktop', body, local, { ...nativeHeader,dpop })).status, 401);
  assert.equal((await hostApi('/cloud/emergency-password', { password: NEXT_PASSWORD }, local)).status, 200);
  await host.syncCloudRevocations();
  await f.api(`${P}/auth/logout`, { method: 'POST', body: {}, headers: {
    authorization: `DPoP ${desktop.tokens.access_token}`,
    dpop: await proof(desktop, f.origin + P + '/auth/logout', desktop.tokens.access_token),
  }, status: 200 });
  await host.syncCloudRevocations();
  await host.syncCloudRevocations();
  assert.equal((await hostApi('/sessions', undefined, local)).status, 200,'cloud logout preserves native local use');
  await f.offline();
  const offline = await hostApi('/auth/cloud-offline', { cloudAccountId: account.cloudAccountId,
    password: NEXT_PASSWORD, deviceName: 'Offline desktop' });
  assert.equal(offline.status, 200); assert.equal(offline.account.ownerId, local.account.ownerId);
});
