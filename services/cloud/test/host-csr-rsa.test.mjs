import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import CSR from '@root/csr';
import { seededRsa } from './host-csr-rsa-fixture.mjs';
import { verifyCsr } from './host-csr-helpers.mjs';

test('independent verification accepts a valid RSA CSR whose raw signature looks like ASN.1', async () => {
  const jwk = seededRsa();
  const domains = ['h-cf33af18441bb92d9ab0c46ce3515a9c.hosts.example.com', 'secondary.example.com'];
  const der = await CSR.csr({jwk,domains,encoding:'der'});
  // Pin the actual regression input, not a random RSA key that usually passes.
  assert.equal(createHash('sha256').update(der).digest('hex'), 'dceca060455d4fa29f8d8cdc3e61bc04c51ba53302f0120fab4b0df9526f52ac');
  verifyCsr(`-----BEGIN CERTIFICATE REQUEST-----\n${Buffer.from(der).toString('base64')}\n-----END CERTIFICATE REQUEST-----`,jwk,domains);
});
