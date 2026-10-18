import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash, createPublicKey, createECDH } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm, stat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ACME from '@root/acme';
import { createCertificateManager, issueHostCertificate } from '../../../src/personal-relay/certificates.mjs';
import { developmentCertificate } from '../../../src/personal-relay/tls.mjs';
const DAY = 86_400_000, domain = `h-${'b'.repeat(32)}.hosts.example.com`;
function identity() {
  const privateKey = generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey;
  const privateJwk = privateKey.export({format:'jwk'});
  const spki = createHash('sha256').update(createPublicKey(privateKey).export({format:'der',type:'spki'})).digest('base64url');
  return {tls:()=>({privateJwk,spki}),relayRequest:async()=>{}};
}

// A fixed, synthetic content key makes transport-stage injection deterministic.
// @root/csr's ASN.1 heuristic misreads some random EC points before newOrder;
// those local parser failures must not stand in for the requested CA failure.
function diagnosticContentKey() {
  const d = Buffer.alloc(32); d[31] = 1;
  const key = createECDH('prime256v1'); key.setPrivateKey(d);
  const point = key.getPublicKey(null, 'uncompressed');
  return { kty: 'EC', crv: 'P-256', d: d.toString('base64url'),
    x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') };
}

// Run the real ACME client/signing/CSR against fixed RFC8555 responses. Pebble
// rejects a second acceptance of a valid challenge, but permits POST-as-GET.
function acmeFixture({ reused = false, processing = false, fail = () => {} } = {}) {
  const base = 'https://acme.example.com', calls = [];
  const nonces = new Set();
  let validated = reused, polls = 0;
  const order = () => ({ status: validated ? 'ready' : 'pending',
    authorizations: [`${base}/authorization`], finalize: `${base}/finalize` });
  const fetcher = async (url, options) => {
    const route = new URL(url).pathname;
    const payload = options.body ? JSON.parse(options.body).payload : undefined;
    if (options.body) {
      const { nonce } = JSON.parse(Buffer.from(JSON.parse(options.body).protected, 'base64url'));
      assert.ok(nonce && !nonces.has(nonce), 'each sent JWS consumes a fresh nonce');
      nonces.add(nonce);
    }
    calls.push({ route, payload });
    const overridden = await fail(route, options);
    if (overridden) return overridden;
    let body, status = 200, location;
    if (route === '/directory') body = { newNonce: `${base}/nonce`, newAccount: `${base}/account`,
      newOrder: `${base}/order`, meta: { termsOfService: `${base}/terms` } };
    else if (route === '/nonce') body = '';
    else if (route === '/account') { body = { status: 'valid' }; location = `${base}/account/1`; }
    else if (route === '/order') { body = order(); location = `${base}/order/1`; }
    else if (route === '/authorization') body = { status: validated ? 'valid' : 'pending', identifier: { type: 'dns', value: domain },
      challenges: [{ type: 'dns-01', status: validated ? 'valid' : 'pending', url: `${base}/challenge`, token: 'synthetic-challenge-token' }] };
    else if (route === '/challenge') {
      if (validated && payload) { status = 400; body = { type: 'urn:ietf:params:acme:error:malformed',
        detail: 'Cannot update challenge with status valid, only status pending' }; }
      else { validated = true; body = { type: 'dns-01', status: 'valid' }; }
    } else if (route === '/finalize') body = { ...order(), status: processing ? 'processing' : 'valid',
      ...(processing ? {} : { certificate: `${base}/certificate` }) };
    else if (route === '/order/1') body = { ...order(), status: ++polls === 1 ? 'processing' : 'valid',
      ...(polls === 1 ? {} : { certificate: `${base}/certificate` }) };
    else if (route === '/certificate') body = '-----BEGIN CERTIFICATE-----\nsynthetic-certificate\n-----END CERTIFICATE-----';
    else throw new Error('Unexpected fixture route');
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status,
      headers: { 'content-type': typeof body === 'string' ? 'application/pem-certificate-chain' : 'application/json',
        ...(route !== '/directory' ? { 'replay-nonce': `synthetic-nonce-${calls.length}` } : {}),
        ...(location ? { location } : {}) } });
  };
  return { fetcher, calls, directoryUrl: `${base}/directory` };
}

test('renewal reuses a valid authorization without accepting its completed challenge or publishing TXT again', async () => {
  const ca = acmeFixture({ reused: true }), dns = [];
  const certificate = await issueHostCertificate({ ...ca, domain, accountKey: identity().tls().privateJwk,
    privateJwk: identity().tls().privateJwk, signal: new AbortController().signal,
    relayRequest: async route => { dns.push(route); } });
  assert.ok(certificate.includes('synthetic-certificate'));
  assert.deepEqual(dns, [], 'valid authorization needs no TXT publication/cleanup');
  assert.equal(ca.calls.filter(c => c.route === '/challenge' && c.payload).length, 0, 'never accept a completed challenge again');
  assert.equal(ca.calls.filter(c => c.route === '/finalize').length, 1);
  assert.equal(ca.calls.filter(c => c.route === '/certificate').length, 1);
});

test('fresh DNS authorization and processing orders preserve publication, signed polling, download and cleanup', async () => {
  const ca = acmeFixture({ processing: true }), dns = [];
  const certificate = await issueHostCertificate({ ...ca, domain, accountKey: identity().tls().privateJwk,
    privateJwk: identity().tls().privateJwk, signal: new AbortController().signal,
    relayRequest: async route => { dns.push(route); } });
  assert.ok(certificate.includes('synthetic-certificate'));
  assert.deepEqual(dns, ['/hosts/relay/dns/present', '/hosts/relay/dns/cleanup']);
  assert.equal(ca.calls.filter(c => c.route === '/finalize').length, 1);
  const polls = ca.calls.filter(c => c.route === '/order/1');
  assert.equal(polls.length, 2);
  assert.ok(polls.every(c => c.payload === ''), 'order polling uses signed POST-as-GET');
});

test('issuance diagnostics identify ACME and DNS failure stages without reflecting secrets', async t => {
  const secret = 'synthetic-private-data';
  const response = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const cases = [
    { route: '/directory', stage: 'directory', error: Object.assign(new TypeError(secret), { cause: { code: 'ECONNREFUSED', address: secret } }), causeCode: 'ECONNREFUSED' },
    { route: '/nonce', stage: 'nonce', status: 503 },
    { route: '/account', stage: 'account', status: 403 },
    { route: '/order', stage: 'order', status: 429 },
    { route: '/authorization', stage: 'authorization', status: 500 },
    { route: '/challenge', stage: 'validation', status: 400 },
    { route: '/finalize', stage: 'finalize', status: 503 },
    { route: '/order/1', stage: 'order_poll', status: 502, processing: true },
    { route: '/certificate', stage: 'download', status: 502 },
    { route: '/directory', stage: 'directory', status: 200, invalidJson: true },
    { dns: true, stage: 'dns_publish', code: 'DNS_PROVIDER_ERROR' },
    { dns: true, stage: 'dns_propagation', code: 'DNS_PROPAGATION_TIMEOUT' },
    { cleanup: true, stage: 'dns_cleanup', code: 'CLOUD_UNAVAILABLE' },
  ];
  for (const entry of cases) await t.test(entry.stage + (entry.invalidJson ? ' invalid JSON' : ''), async () => {
    const diagnostics = [], dns = [];
    const ca = acmeFixture({ processing: entry.processing, fail: route => {
      if (route !== entry.route) return;
      if (entry.error) throw entry.error;
      if (entry.invalidJson) return new Response(secret, { headers: { 'content-type': 'application/json' } });
      return response(entry.status, { type: 'urn:ietf:params:acme:error:malformed', detail: secret,
        token: secret, privateJwk: { d: secret }, url: `https://example.com/${secret}` });
    } });
    await assert.rejects(issueHostCertificate({ ...ca, domain, accountKey: identity().tls().privateJwk,
      privateJwk: diagnosticContentKey(), signal: new AbortController().signal,
      diagnostic: error => diagnostics.push(error), relayRequest: async route => {
        dns.push(route);
        if (entry.dns && route.endsWith('/present') || entry.cleanup && route.endsWith('/cleanup'))
          throw Object.assign(new Error(secret), { code: entry.code, cause: { code: secret } });
      } }));
    if (entry.route) assert.ok(ca.calls.some(({ route }) => route === entry.route), 'injected failure route was reached');
    assert.equal(diagnostics.length, 1);
    const diagnostic = diagnostics[0];
    assert.equal(diagnostic.code, 'CERTIFICATE_ISSUANCE_FAILED');
    assert.equal(diagnostic.stage, entry.stage);
    assert.equal(diagnostic.target, entry.dns || entry.cleanup ? 'cloud_dns' : 'acme');
    assert.equal(diagnostic.httpStatus, entry.status);
    assert.equal(diagnostic.causeCode, entry.causeCode);
    if (entry.code) assert.equal(diagnostic.errorCode, entry.code);
    if (entry.status && !entry.invalidJson) assert.equal(diagnostic.acmeProblem, 'malformed');
    assert.ok(!JSON.stringify(diagnostic).includes(secret));
    assert.ok(!diagnostic.message.includes(secret));
    assert.ok(!diagnostic.stack.includes(secret));
    if (entry.dns) assert.deepEqual(dns, ['/hosts/relay/dns/present', '/hosts/relay/dns/cleanup']);
  });
});

test('order failures retain their request context when a second signed account request interleaves', async t => {
  const create = ACME.create;
  let client;
  t.mock.method(ACME, 'create', options => (client = create(options)));
  const cases = [
    { name: 'ordinary 429 has no account retry', interleave: false },
    { name: 'interleaved account before 429', interleave: true },
    { name: 'interleaved account before transport failure', interleave: true, transport: true },
  ];
  for (const { name, interleave, transport } of cases) await t.test(name, async () => {
    const accountKey = identity().tls().privateJwk, diagnostics = [];
    const transportError = Object.assign(new TypeError('synthetic transport failure'), { cause: { code: 'ECONNRESET' } });
    const ca = acmeFixture({ fail: async route => {
      if (route !== '/order') return;
      // Use the real library, JWS signing and transport. Hold the order's
      // failure until another request on this same client has completed.
      if (interleave) {
        await client.request({ method: 'HEAD', url: 'https://acme.example.com/nonce' });
        await client.accounts.create({ accountKey, agreeToTerms: true });
      }
      if (transport) throw transportError;
      return new Response(JSON.stringify({ type: 'urn:ietf:params:acme:error:rateLimited', detail: 'synthetic' }),
        { status: 429, headers: { 'content-type': 'application/json' } });
    } });
    await assert.rejects(issueHostCertificate({ ...ca, domain, accountKey,
      privateJwk: diagnosticContentKey(), signal: new AbortController().signal,
      relayRequest: async () => {}, diagnostic: error => { diagnostics.push(error); throw new Error('observer failed'); } }),
    transport ? error => { assert.equal(error, transportError); return true; } : { code: 'E_ACME', status: 429 });
    assert.deepEqual(ca.calls.filter(({ route }) => ['/account', '/order'].includes(route)).map(({ route }) => route),
      interleave ? ['/account', '/order', '/account'] : ['/account', '/order']);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].stage, 'order');
    assert.equal(diagnostics[0].target, 'acme');
    assert.equal(diagnostics[0].httpStatus, transport ? undefined : 429);
    assert.equal(diagnostics[0].acmeProblem, transport ? undefined : 'rateLimited');
    assert.equal(diagnostics[0].causeCode, transport ? 'ECONNRESET' : undefined);
  });
});

test('a recovered badNonce does not suppress a later authorization or DNS failure diagnostic', async t => {
  for (const stage of ['authorization', 'dns_publish']) await t.test(stage, async () => {
    const diagnostics = [], dns = [];
    const failure = Object.assign(new Error('synthetic later failure'),
      { code: stage === 'authorization' ? 'ECONNRESET' : 'DNS_PROVIDER_ERROR' });
    let orders = 0;
    const ca = acmeFixture({ fail: route => {
      if (route === '/order' && ++orders === 1) return new Response(JSON.stringify({
        type: 'urn:ietf:params:acme:error:badNonce', detail: 'synthetic rejected nonce',
      }), { status: 400, headers: { 'content-type': 'application/json', 'replay-nonce': 'synthetic-recovery-nonce' } });
      if (route === '/authorization' && stage === 'authorization') throw failure;
    } });
    await assert.rejects(issueHostCertificate({ ...ca, domain,
      accountKey: identity().tls().privateJwk, privateJwk: diagnosticContentKey(),
      signal: new AbortController().signal, diagnostic: error => diagnostics.push(error),
      relayRequest: async route => {
        dns.push(route);
        if (route.endsWith('/present')) throw failure;
      } }), error => { assert.equal(error, failure); return true; });
    assert.equal(orders, 2, 'real ACME library recovered the first badNonce');
    assert.ok(ca.calls.some(({ route }) => route === '/authorization'));
    assert.deepEqual(dns, stage === 'dns_publish' ? ['/hosts/relay/dns/present', '/hosts/relay/dns/cleanup'] : []);
    assert.deepEqual(diagnostics.map(error => ({ stage: error.stage, target: error.target,
      httpStatus: error.httpStatus, acmeProblem: error.acmeProblem, errorCode: error.errorCode })), [
      { stage: 'order', target: 'acme', httpStatus: 400, acmeProblem: 'badNonce', errorCode: 'E_ACME' },
      { stage, target: stage === 'authorization' ? 'acme' : 'cloud_dns', httpStatus: undefined,
        acmeProblem: undefined, errorCode: failure.code },
    ], 'each distinct failure is reported exactly once, even across recovery');
  });
});

test('certificate validation and hot reload failures emit safe local diagnostics and preserve public error codes', async t => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'wm-cert-diagnostic-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const host = identity(), files = await developmentCertificate({ root, domain, ...host.tls() });
  const good = await readFile(files.certFile), diagnostics = [];
  let clock = Date.now();
  const options = { root, domain, identity: host, now: () => clock, diagnostic: error => diagnostics.push(error) };
  const malformed = await createCertificateManager({ ...options, issue: async () => 'synthetic-invalid-certificate' });
  await malformed.check();
  assert.equal(malformed.status().certificateErrorCode, 'CERTIFICATE_ISSUANCE_FAILED');
  assert.equal(diagnostics[0].stage, 'validate_certificate');
  await malformed.close();
  clock += DAY;
  const manager = await createCertificateManager({ ...options, issue: async () => good,
    onInstalled: async () => { throw Object.assign(new Error('synthetic-private-data'), { code: 'EACCES' }); } });
  await manager.check();
  assert.equal(manager.status().certificateErrorCode, 'CERTIFICATE_ISSUANCE_FAILED');
  assert.equal(diagnostics[1].stage, 'reload');
  assert.equal(diagnostics[1].errorCode, 'EACCES');
  assert.ok(!JSON.stringify(diagnostics).includes('synthetic-private-data'));
  await manager.close();
  clock += DAY;
  const blocked = await createCertificateManager({ ...options, issue: async () => {
    // Inspect succeeds first; a directory at the destination then makes the
    // real atomic rename fail deterministically on both Windows and Linux.
    await rm(manager.certFile); await mkdir(manager.certFile); return good;
  } });
  await blocked.check();
  assert.equal(blocked.status().certificateErrorCode, 'CERTIFICATE_ISSUANCE_FAILED');
  assert.equal(diagnostics[2].stage, 'install');
  await blocked.close();
});

test('certificate failures keep the last good cert; retry once a day survives restart, and mismatched key is refused before install', async t => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(),'wm-cert-test-')));t.after(()=>rm(root,{recursive:true,force:true}));
  const host = identity(), files = await developmentCertificate({root,domain,...host.tls()});
  const good = await readFile(files.certFile), certFile = path.join(root,'relay-tls/host-fullchain.pem');
  await writeFile(certFile,good);
  let calls = 0, installed = 0, clock = Date.now();
  const options = {root,domain,identity:host,now:()=>clock,onInstalled:async()=>{installed++},
    issue:async()=>{calls++;throw Object.assign(new Error('synthetic secret must never appear in status'),{code:'DNS_NOT_CONFIGURED'})}};
  let manager = await createCertificateManager(options);
  await manager.check(); assert.equal(manager.status().certificateErrorCode,'DNS_NOT_CONFIGURED');
  assert.ok(manager.status().certificateExpiresAt); assert.equal(installed,0);
  assert.deepEqual(await readFile(certFile),good);
  await manager.check();assert.equal(calls,1);await manager.close();
  manager=await createCertificateManager(options);await manager.check();assert.equal(calls,1,'restart respects daily failure backoff');
  assert.equal(manager.status().certificateErrorCode,'DNS_NOT_CONFIGURED');
  clock+=DAY;await manager.check();assert.equal(calls,2);await manager.close();
  const foreignRoot=path.join(root,'foreign'),foreign=identity();
  const wrongFiles=await developmentCertificate({root:foreignRoot,domain,...foreign.tls()});
  clock+=DAY;
  manager=await createCertificateManager({...options,issue:async()=>readFile(wrongFiles.certFile)});
  await manager.check();assert.equal(manager.status().certificateErrorCode,'CERTIFICATE_KEY_DOMAIN_MISMATCH');
  assert.deepEqual(await readFile(certFile),good);assert.equal(installed,0);await manager.close();
  clock+=DAY;
  manager=await createCertificateManager({...options,issue:async()=>good});
  await manager.check();assert.equal(manager.status().certificateErrorCode,null);assert.equal(installed,1);
  if(process.platform!=='win32')assert.equal((await stat(certFile)).mode&0o777,0o600);
  await manager.close();
});
