/** Install public trust anchors only. Run before signing an initial native release. */
import { createPublicKey } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { keyId } from '../../src/personal-update/manifest.mjs';
const file = process.argv[2];
if (!file) throw new Error('usage: node scripts/release/trust-key.mjs <public-key.pem>');
const input = await readFile(file, 'utf8');
if (!/^-----BEGIN PUBLIC KEY-----/.test(input.trim())) throw new Error('provide a public SPKI PEM only; private keys are refused');
const key = createPublicKey(input);
if (key.asymmetricKeyType !== 'ed25519') throw new Error('Ed25519 public key required');
const pem = key.export({ type: 'spki', format: 'pem' });
const keys = JSON.stringify({ [keyId(pem)]: pem }, null, 2) + '\n';
await writeFile(new URL('../../src/personal-update/trusted-keys.json', import.meta.url), keys);
await writeFile(new URL('../../apps/android/app/src/updateAssets/update-trusted-keys.json', import.meta.url), keys);
console.log('Updated desktop and Android public trust anchor; rebuild the native applications.');
