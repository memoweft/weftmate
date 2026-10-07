import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../src/database.mjs';
import { createAliyunDns, dnsFromEnvironment, aliyunRequest, waitForAuthoritativeTxt } from '../src/dns-aliyun.mjs';
import { fakeAliyun, TEST_ACCESS_KEY_ID as accessKeyId, TEST_ACCESS_KEY_SECRET as accessKeySecret } from './dns-aliyun-helpers.mjs';

const challenge = { name: `_acme-challenge.h-${'a'.repeat(32)}.hosts.example.com`, value: 'b'.repeat(43), ttl: 60 };
async function database(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'wm-dns-test-'));
  const opened = await openDatabase(path.join(root, 'cloud.sqlite'));
  t.after(async () => { opened.database.close(); await rm(root, { recursive: true, force: true }); });
  return opened.database;
}

test('AliDNS V3 signed requests add TXT, await publication, retry idempotently and delete only persisted owned RecordId after restart', async t => {
  const db = await database(t), fake = await fakeAliyun(t);
  let visible = false, release;
  const publication = new Promise(resolve => { release = resolve; });
  const options = { database: db, zone: 'example.com', accessKeyId, accessKeySecret, endpoint: fake.endpoint,
    waitForTxt: async data => { assert.equal(data.name, challenge.name); await publication; visible = true; } };
  const provider = createAliyunDns(options);
  const first = provider.present(challenge);
  while (!fake.calls.length) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(visible, false); release(); await first;
  await provider.present(challenge);
  const other = { ...challenge, value: 'c'.repeat(43) }; await provider.present(other);
  assert.equal(fake.calls.filter(c => c.action === 'AddDomainRecord').length, 2);
  // Recreating the provider simulates process restart; it retains ownership.
  await createAliyunDns(options).cleanup(challenge); await provider.cleanup(challenge);
  assert.ok([...fake.records.values()].some(r => r.value === other.value));
  assert.ok(fake.records.has('foreign'));
  await provider.cleanup({ ...challenge, value: 'd'.repeat(43) });
  assert.equal(fake.calls.filter(c => c.action === 'DeleteDomainRecord').length, 1);
  await provider.cleanup(other);
  assert.equal(fake.records.size, 1);
});

test('provider failures are sanitized, failed cleanup is retryable, missing remote record is idempotent, unset credentials keep DNS_NOT_CONFIGURED', async t => {
  const db = await database(t), fake = await fakeAliyun(t);
  const provider = createAliyunDns({ database: db, zone: 'example.com', accessKeyId, accessKeySecret,
    endpoint: fake.endpoint, waitForTxt: async () => {} });
  assert.equal(dnsFromEnvironment({ database: db, env: {} }), null);
  assert.equal(dnsFromEnvironment({ database: db, env: { CLOUD_DNS_PROVIDER: 'aliyun', ALIYUN_DNS_ACCESS_KEY_ID: accessKeyId } }), null);
  fake.fail('Forbidden'); await assert.rejects(provider.present(challenge), { code: 'DNS_PROVIDER_ERROR' });
  fake.fail(null); await provider.present(challenge);
  fake.fail('Forbidden'); await assert.rejects(provider.cleanup(challenge), { code: 'DNS_PROVIDER_ERROR' });
  assert.equal(db.prepare('SELECT count(*) AS count FROM relay_dns_records').get().count, 1);
  fake.fail(null); fake.records.delete('1'); await provider.cleanup(challenge);
  assert.equal(db.prepare('SELECT count(*) AS count FROM relay_dns_records').get().count, 0);
  await assert.rejects(provider.present({ ...challenge, name: '_acme-challenge.example.net' }), { code: 'DNS_ZONE_MISMATCH' });
});

test('authoritative propagation requires every server, handles split TXT strings, and reports timeout instead of successful publication', async () => {
  let queries = 0;
  await waitForAuthoritativeTxt({ ...challenge, zone: 'example.com', intervalMs: 1, timeoutMs: 100,
    resolvers: [{ resolveTxt: async () => [[challenge.value]] },
      { resolveTxt: async () => ++queries < 2 ? [] : [[challenge.value.slice(0, 20), challenge.value.slice(20)]] }] });
  assert.equal(queries, 2);
  await assert.rejects(waitForAuthoritativeTxt({ ...challenge, zone: 'example.com', intervalMs: 1, timeoutMs: 2,
    resolvers: [{ resolveTxt: async () => [] }] }), { code: 'DNS_PROPAGATION_TIMEOUT' });
});

test('V3 canonical query uses RFC3986 encoding and a deterministic signature', () => {
  const request = aliyunRequest({ endpoint: 'https://alidns.aliyuncs.com/', accessKeyId, accessKeySecret,
    action: 'AddDomainRecord', parameters: { Value: "a +/*'~", RR: '_acme-challenge.test', DomainName: 'example.com', Type: 'TXT', TTL: 600 },
    now: () => Date.parse('2026-10-07T00:00:00Z'), nonce: () => 'fixed-test-nonce' });
  assert.equal(request.url.search, '?DomainName=example.com&RR=_acme-challenge.test&TTL=600&Type=TXT&Value=a%20%2B%2F%2A%27~');
  assert.match(request.headers.authorization, /Signature=[a-f0-9]{64}$/);
});
