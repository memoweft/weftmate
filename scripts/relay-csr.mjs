import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHostCsr } from '../src/personal-relay/tls.mjs';
const [root, domain] = process.argv.slice(2);
if (!root || !path.isAbsolute(root)) throw new Error('Usage: node scripts/relay-csr.mjs <absolute personal-access root> <claimed host domain>');
const state = JSON.parse(await readFile(path.join(root, 'cloud-identity', 'identity.json'), 'utf8'));
const files = await createHostCsr({ root, domain, privateJwk: state.tls.privateJwk });
console.log(files.csrFile);
