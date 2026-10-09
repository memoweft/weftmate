import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SignJWT, importJWK } from 'jose';
import { fixture, P } from './identity-helpers.mjs';
import { registration, appDevice, control, refresh, hostFixture } from './app-helpers.mjs';

test('offline control is DPoP/device/member scoped, monotone, and rejects revoked devices without a host', async t => {
  const f = await fixture(t); const { account } = await registration(f);
  const desktop = await appDevice(f, 'desktop'), phone = await appDevice(f, 'phone');
  const h = await hostFixture(f, t), local = await h.exchange(desktop, '/auth/cloud-desktop');
  assert.equal(local.status, 200); await h.host.syncCloudRevocations();
  const connection = (await control(phone, '/hosts/connect', { hostId: h.started.hostId })).data;
  await refresh(phone, connection.resource);
  const pending = await h.exchange(phone, '/auth/cloud-session'); assert.equal(pending.status, 202);
  assert.equal((await h.hostApi(`/cloud/devices/${pending.requestId}/decision`, { decision: 'allow' }, local)).status, 200);
  await h.host.syncCloudRevocations(); await refresh(phone, f.config.audience);
  const state = JSON.parse(await readFile(join(h.root, 'cloud-identity/identity.json'), 'utf8'));
  async function publish(generation) {
    const proof = await new SignJWT({ action: '/hosts/offline/publish', sub: account.cloudAccountId, generation })
      .setProtectedHeader({ alg: 'ES256', typ: 'wm-host-request+jwt' }).setIssuer(h.started.hostId)
      .setAudience(f.config.issuer).setIssuedAt().setExpirationTime('60s').setJti(randomUUID())
      .sign(await importJWK(state.installation.privateJwk, 'ES256'));
    return f.api(P + '/hosts/offline/publish', { method: 'POST', body: { hostId: h.started.hostId, proof }, status: 200 });
  }
  await publish(1); await publish(3); await publish(2);
  const result = await control(phone, '/hosts/offline/status', { hostId: h.started.hostId });
  assert.equal(result.data.generation, 3); assert.equal(result.data.authorized, true);
  assert.equal(result.data.accountId, account.cloudAccountId);
  assert.deepEqual(Object.keys(result.data).sort(), ['accountId', 'authorized', 'generation', 'hostId']);
  await f.api(P + '/hosts/offline/status', { method: 'POST', body: { hostId: h.started.hostId }, status: 401 });
  await control(phone, '/hosts/offline/status', { hostId: 'other' }, 403);
  await h.host.close();
  await control(desktop, '/auth/devices/revoke', { deviceId: 'phone' });
  await control(phone, '/hosts/offline/status', { hostId: h.started.hostId }, 401);
});
