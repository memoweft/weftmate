import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createServer, connect } from 'node:net';
import { once } from 'node:events';
import { fixture, P, generateKeyPair, exportJWK, SignJWT } from './identity-helpers.mjs';
import { createRelay, createRelayIngress } from '../src/relay.mjs';

test('relay credentials belong to an installation, restrict HTTPS/domain, rotate idempotently and remain revoked after restart', async t => {
  const f = await fixture(t, { env: { CLOUD_RELAY_DOMAIN: 'hosts.example.com' } });
  const account = await f.verified(), logged = await f.signedIn();
  const installation = await generateKeyPair('ES256');
  const hostId = 'host-relay-test', claimId = randomUUID();
  const claim = await f.api(`${P}/hosts/claims`, { method: 'POST', status: 200,
    body: { hostId, claimId, publicJwk: await exportJWK(installation.publicKey), tlsSpki: 'a'.repeat(43) } });
  const proof = await new SignJWT({ claimId, challenge: claim.data.challenge, sub: account.cloudAccountId })
    .setProtectedHeader({ alg: 'ES256', typ: 'wm-host-claim+jwt' }).setIssuer(hostId)
    .setAudience(f.config.issuer).setIssuedAt().setExpirationTime('60s').sign(installation.privateKey);
  await f.api(`${P}/hosts/claims/confirm`, { method: 'POST', status: 200, body: { claimId, proof },
    headers: { authorization: `Bearer ${logged.access_token}` } });
  async function call(route, payload = {}, status = 200) {
    const proof = await new SignJWT({ action: `/hosts/relay/${route}`, ...payload }).setProtectedHeader({ alg: 'ES256', typ: 'wm-host-request+jwt' })
      .setIssuer(hostId).setAudience(f.config.issuer).setIssuedAt().setExpirationTime('60s').setJti(randomUUID()).sign(installation.privateKey);
    return (await f.api(`${P}/hosts/relay/${route}`, { method: 'POST', body: { hostId, proof }, status })).data;
  }
  const first = await call('credentials');
  assert.match(first.baseUrl, /^https:\/\/h-[a-f0-9]{32}\.hosts\.example\.com$/);
  assert.equal((await call('credentials')).credential, first.credential);
  assert.equal(f.db.prepare('SELECT role FROM host_memberships WHERE host_id=?').get(hostId).role, 'owner');
  const user = { user: hostId, metas: { credential: first.credential } };
  const relay = f.identity.relay;
  assert.deepEqual(relay.plugin('NewProxy', { user, proxy_name: first.proxyName, proxy_type: 'https', custom_domains: [new URL(first.baseUrl).hostname] }), { reject: false, unchange: true });
  for (const override of [{ proxy_type: 'tcp' }, { custom_domains: ['h-' + 'b'.repeat(32) + '.hosts.example.com'] },
    { group: 'share' }, { subdomain: 'foreign' }, { custom_domains: [new URL(first.baseUrl).hostname.toUpperCase()] },
    { proxy_name: 'another.content' }]) assert.throws(() => relay.plugin('NewProxy', { user,
      proxy_name: first.proxyName, proxy_type: 'https', custom_domains: [new URL(first.baseUrl).hostname], ...override }), /RELAY_PROXY_FORBIDDEN/);
  assert.throws(() => relay.plugin('Login', { ...user, client_address: '127.0.0.1:1' }), /RELAY_INGRESS_REQUIRED/);
  const rotated = await call('rotate', { requestId: 'rotate-once' });
  assert.notEqual(first.credential, rotated.credential); assert.equal(rotated.baseUrl, first.baseUrl);
  assert.equal((await call('rotate', { requestId: 'rotate-once' })).credential, rotated.credential);
  assert.throws(() => relay.plugin('Ping', { user }), /RELAY_UNAUTHORIZED/);
  assert.deepEqual(relay.plugin('Ping', { user: { ...user, metas: { credential: rotated.credential } } }), { reject: false, unchange: true });
  await call('dns/present', { value: 'a'.repeat(43) }, 503);
  await call('dns/present', { value: 'a'.repeat(43), name: '_acme-challenge.api.example.com' }, 400);
  const updates = [];
  const dnsRelay = createRelay({ database: f.db, config: f.config, secret: f.identity.keys.cookieSecret,
    dns: { present: async data => updates.push(data), cleanup: async data => updates.push(data) } });
  await dnsRelay.hostRequest('/hosts/relay/dns/present', hostId, { value: 'a'.repeat(43) });
  await dnsRelay.hostRequest('/hosts/relay/dns/cleanup', hostId, { value: 'a'.repeat(43) });
  assert.deepEqual(updates, Array(2).fill({ name: `_acme-challenge.${new URL(first.baseUrl).hostname}`, value: 'a'.repeat(43), ttl: 60 }));
  await f.api(`${P}/hosts/relay/account-revoke`, { method: 'POST', status: 200, body: { hostId }, headers: { authorization: `Bearer ${logged.access_token}` } });
  await call('credentials', {}, 403);
  await assert.rejects(dnsRelay.hostRequest('/hosts/relay/dns/present', hostId, { value: 'a'.repeat(43) }));
  await f.restart(); await call('credentials', {}, 403);
  assert.doesNotMatch(f.logs(), new RegExp(`${first.credential}|${rotated.credential}`));
});

test('opaque ingress binds only reported loopback sockets and closes one host while another stays connected', async () => {
  const echo = createServer(socket => socket.pipe(socket));
  echo.listen(0, '127.0.0.1'); await once(echo, 'listening');
  const ingress = createRelayIngress(echo.address().port);
  ingress.server.listen(0, '127.0.0.1'); await once(ingress.server, 'listening');
  const a = connect(ingress.server.address().port, '127.0.0.1'), b = connect(ingress.server.address().port, '127.0.0.1');
  let addresses = [];
  echo.on('connection', socket => addresses.push(`${socket.remoteAddress}:${socket.remotePort}`));
  try {
    await Promise.all([once(a, 'connect'), once(b, 'connect')]);
    a.write('a'); b.write('b'); await Promise.all([once(a, 'data'), once(b, 'data')]);
    assert.equal(ingress.associate(addresses[0], 'host-a'), true);
    assert.equal(ingress.associate(addresses[0], 'host-b'), false);
    assert.equal(ingress.associate(addresses[1], 'host-b'), true);
    assert.equal(ingress.associate('203.0.113.1:1', 'host-a'), false);
    const closed = once(a, 'close'); assert.equal(ingress.disconnect('host-a'), 1); await closed;
    b.write('still-private'); assert.equal((await once(b, 'data'))[0].toString(), 'still-private');
  } finally { a.destroy(); b.destroy(); await ingress.close(); await new Promise(resolve => echo.close(resolve)); }
});
