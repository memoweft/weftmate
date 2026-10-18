// Explicit S2b-only exhaustive coverage; outside test/*.test.mjs discovery.
import test from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import CSR from '@root/csr';
import { domain, verifyCsr, verifyHostCsr } from '../test/host-csr-helpers.mjs';
import { createCsr } from '../../../src/personal-relay/csr.mjs';

test('10,000 random P-256 CSRs preserve public key, domains and valid signatures', { timeout: 600_000 }, async t => {
  for (let i = 0; i < 10_000; i++) {
    const jwk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' });
    const csr = await createCsr({ jwk, domains: [domain], encoding: 'pem' });
    verifyHostCsr(csr, jwk);
    if ((i + 1) % 1000 === 0) t.diagnostic(`${i + 1}/10000 independently verified`);
  }
});

test('32 random RSA CSRs preserve key, multiple SANs and signatures with independent verification', { timeout: 60_000 }, async () => {
  const domains = [domain, 'secondary.example.com'];
  for (let i = 0; i < 32; i++) {
    const jwk = generateKeyPairSync('rsa', {modulusLength:2048}).privateKey.export({format:'jwk'});
    verifyCsr(await CSR.csr({jwk,domains}),jwk,domains);
  }
});
