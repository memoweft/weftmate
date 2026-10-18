import assert from 'node:assert/strict';
import { createECDH, createPublicKey } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import CSR from '@root/csr';

export const domain = `h-${'b'.repeat(32)}.hosts.example.com`;
// Public, synthetic scalars; never persist randomly sampled private keys.
export function scalarKey(value) {
  const d = Buffer.alloc(32); d.writeUInt32BE(value, 28);
  const ec = createECDH('prime256v1'); ec.setPrivateKey(d);
  const point = ec.getPublicKey();
  return { kty: 'EC', crv: 'P-256', d: d.toString('base64url'),
    x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') };
}
export function publicKey(jwk) { return createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'der' }); }
export function verifyCsr(csr, jwk, domains = [domain]) {
  // OpenSSL parses and verifies independently of both @root/csr and @root/asn1.
  // A bad signature can still exit 0 on some OpenSSL releases: require its verdict.
  const result = spawnSync('openssl', ['req', '-verify', '-noout', '-text', '-pubkey'],
    { input: csr, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, timeout: 30_000, killSignal: 'SIGKILL' });
  assert.equal(result.status, 0, 'OpenSSL can parse the CSR');
  assert.match(result.stdout + result.stderr, /(?:verify OK|self-signature ok)/i, 'OpenSSL validates the CSR signature');
  const output = result.stdout;
  const pem = output.match(/-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/)[0];
  assert.ok(createPublicKey(pem).export({ type: 'spki', format: 'der' }).equals(publicKey(jwk)), 'CSR keeps the exact public key');
  const subject = output.match(/^\s*Subject:\s*CN\s*=\s*([^\r\n]+)$/m)?.[1].trim();
  assert.equal(subject, domains[0], 'independent parser keeps the exact common name');
  assert.deepEqual([...output.matchAll(/DNS:([^,\s]+)/g)].map(m => m[1]), domains);
}

// ACME.js uses _info for the product's P-256 CSRs. Keep that consumer contract
// separate from the independent OpenSSL oracle: _info guesses RSA signatures.
export function verifyHostCsr(csr, jwk, domains = [domain]) {
  assert.equal(jwk.kty, 'EC'); assert.equal(jwk.crv, 'P-256');
  verifyCsr(csr, jwk, domains);
  const info = CSR._info(csr);
  assert.deepEqual(info.altnames, domains);
  assert.equal(info.subject, domains[0]);
  assert.ok(publicKey(info.jwk).equals(publicKey(jwk)), 'ACME parser keeps fixed-width coordinates');
}
