import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, createPublicKey, createHash, generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import CSR from '@root/csr';
import ASN1 from '@root/asn1/parser.js';
import { issueHostCertificate, createCertificateManager } from '../../../src/personal-relay/certificates.mjs';
import { developmentCertificate, tlsSpki } from '../../../src/personal-relay/tls.mjs';

const domain = `h-${'b'.repeat(32)}.hosts.example.com`, DAY = 86_400_000;
// Public, synthetic scalars; never persist randomly sampled private keys.
function scalarKey(value) {
  const d = Buffer.alloc(32); d.writeUInt32BE(value, 28);
  const ec = createECDH('prime256v1'); ec.setPrivateKey(d);
  const point = ec.getPublicKey();
  return { kty: 'EC', crv: 'P-256', d: d.toString('base64url'),
    x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') };
}
function publicKey(jwk) { return createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'der' }); }
function verifyCsr(csr, jwk, domains = [domain]) {
  // OpenSSL parses and verifies independently of both @root/csr and @root/asn1.
  // A bad signature can still exit 0 on some OpenSSL releases: require its verdict.
  const result = spawnSync('openssl', ['req', '-verify', '-noout', '-text', '-pubkey'],
    { input: csr, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  assert.equal(result.status, 0, 'OpenSSL can parse the CSR');
  assert.match(result.stdout + result.stderr, /(?:verify OK|self-signature ok)/i, 'OpenSSL validates the CSR signature');
  const output = result.stdout;
  const pem = output.match(/-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/)[0];
  assert.ok(createPublicKey(pem).export({ type: 'spki', format: 'der' }).equals(publicKey(jwk)), 'CSR keeps the exact public key');
  assert.ok(output.includes(`CN = ${domains[0]}`) || output.includes(`CN=${domains[0]}`));
  assert.deepEqual([...output.matchAll(/DNS:([^,\s]+)/g)].map(m => m[1]), domains);
  const info = CSR._info(csr);
  assert.deepEqual(info.altnames, domains);
  assert.equal(info.subject, domains[0]);
  assert.ok(publicKey(info.jwk).equals(publicKey(jwk)), 'ACME parser keeps fixed-width coordinates');
}

function caFixture(certificate = '-----BEGIN CERTIFICATE-----\nsynthetic-certificate\n-----END CERTIFICATE-----') {
  const base = 'https://acme.example.com', calls = [], csrs = [];
  const order = { status: 'ready', authorizations: [`${base}/authorization`], finalize: `${base}/finalize` };
  return { calls, csrs, directoryUrl: `${base}/directory`, fetcher: async (url, options) => {
    const route = new URL(url).pathname;
    const payload = options.body ? JSON.parse(Buffer.from(JSON.parse(options.body).payload, 'base64url').toString() || 'null') : null;
    calls.push(route);
    let body, location;
    if (route === '/directory') body = { newNonce: `${base}/nonce`, newAccount: `${base}/account`, newOrder: `${base}/order`, meta: { termsOfService: `${base}/terms` } };
    else if (route === '/nonce') body = '';
    else if (route === '/account') { body = { status: 'valid' }; location = `${base}/account/1`; }
    else if (route === '/order') { body = order; location = `${base}/order/1`; }
    else if (route === '/authorization') body = { status: 'valid', identifier: { type: 'dns', value: domain },
      challenges: [{ type: 'dns-01', status: 'valid', url: `${base}/challenge`, token: 'synthetic-token' }] };
    else if (route === '/challenge') { assert.equal(payload, null); body = { type: 'dns-01', status: 'valid' }; }
    else if (route === '/finalize') { csrs.push(Buffer.from(payload.csr, 'base64url')); body = { ...order, status: 'valid', certificate: `${base}/certificate` }; }
    else if (route === '/certificate') body = certificate;
    else assert.fail('unexpected ACME route');
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { headers: {
      'content-type': typeof body === 'string' ? 'application/pem-certificate-chain' : 'application/json',
      'replay-nonce': `synthetic-nonce-${calls.length}`, ...(location ? { location } : {}) } });
  } };
}
const issuance = (ca, jwk) => ({ ...ca, domain, privateJwk: jwk, accountKey: scalarKey(1),
  signal: new AbortController().signal, relayRequest: async () => assert.fail('reused authorization needs no DNS write') });

test('scalar 111 reaches ACME finalize and download with its original P-256 key', async () => {
  const jwk = scalarKey(111), ca = caFixture();
  await issueHostCertificate(issuance(ca, jwk));
  assert.equal(ca.csrs.length, 1);
  assert.ok(ca.calls.includes('/order') && ca.calls.includes('/certificate'));
  verifyCsr(`-----BEGIN CERTIFICATE REQUEST-----\n${ca.csrs[0].toString('base64')}\n-----END CERTIFICATE REQUEST-----`, jwk);
});

test('fixed-width EC coordinates and explicit RSA public-key decoding preserve multiple SANs', async () => {
  const domains = [domain, 'secondary.example.com'];
  for (const jwk of [scalarKey(43), generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'jwk' })]) {
    verifyCsr(await CSR.csr({ jwk, domains }), jwk, domains);
  }
});

test('independent CSR verification rejects a changed signature, key or domain', async () => {
  const jwk = scalarKey(1), csr = await CSR.csr({ jwk, domains: [domain] });
  assert.throws(() => verifyCsr(csr, scalarKey(43)), /exact public key/);
  assert.throws(() => verifyCsr(csr, jwk, ['different.example.com']));
  const der = await CSR.csr({ jwk, domains: [domain], encoding: 'der' });
  der[der.length - 1] ^= 1;
  assert.throws(() => verifyCsr(`-----BEGIN CERTIFICATE REQUEST-----\n${Buffer.from(der).toString('base64')}\n-----END CERTIFICATE REQUEST-----`, jwk));
});

test('10,000 random P-256 CSRs preserve public key, domains and valid signatures', { timeout: 600_000 }, async t => {
  for (let i = 0; i < 10_000; i++) {
    const jwk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' });
    const csr = await CSR.csr({ jwk, domains: [domain], encoding: 'pem' });
    verifyCsr(csr, jwk);
    if ((i + 1) % 1000 === 0) t.diagnostic(`${i + 1}/10000 independently verified`);
  }
});

test('a failed legacy scalar-111 host recovers on the next daily check after restart without replacing its key', async t => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'wm-csr-recovery-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const privateJwk = scalarKey(111), original = JSON.stringify(privateJwk);
  const spki = createHash('sha256').update(publicKey(privateJwk)).digest('base64url');
  const identity = { tls: () => ({ privateJwk, spki }), relayRequest: async () => {} };
  let clock = Date.now(), attempts = 0, installed = 0;
  const options = { root, domain, identity, now: () => clock, onInstalled: async () => { installed++; } };
  // Replay the exact old parser defect, rather than an arbitrary injected error.
  const legacyIssue = async ({ privateJwk }) => {
    attempts++;
    const der = await CSR.csr({ jwk: privateJwk, domains: [domain], encoding: 'der' });
    const parsed = ASN1.parse({ der, verbose: true, json: false });
    return parsed.children[0].children[2].children[1].value.slice(1);
  };
  let manager = await createCertificateManager({ ...options, issue: legacyIssue });
  await manager.check();
  assert.equal(manager.status().certificateErrorCode, 'CERTIFICATE_ISSUANCE_FAILED');
  assert.equal(attempts, 1); assert.equal(installed, 0);
  await manager.close();
  const files = await developmentCertificate({ root, domain, privateJwk });
  const certificate = await readFile(files.certFile, 'utf8'), ca = caFixture(certificate);
  manager = await createCertificateManager({ ...options, issue: options => {
    attempts++;
    return issueHostCertificate({ ...options, ...ca });
  } });
  t.after(() => manager.close());
  clock += DAY - 1; await manager.check();
  assert.equal(attempts, 1, 'persisted retry date is respected across restart');
  clock++; await manager.check();
  assert.equal(attempts, 2); assert.equal(installed, 1);
  assert.equal(manager.status().certificateErrorCode, null);
  assert.ok(manager.status().certificateExpiresAt);
  assert.equal(tlsSpki(await readFile(manager.certFile)), spki);
  assert.equal(JSON.stringify(privateJwk), original);
  assert.equal(ca.csrs.length, 1); verifyCsr(`-----BEGIN CERTIFICATE REQUEST-----\n${ca.csrs[0].toString('base64')}\n-----END CERTIFICATE REQUEST-----`, privateJwk);
  await manager.check(); assert.equal(attempts, 2, 'no extra retry after recovery');
});
