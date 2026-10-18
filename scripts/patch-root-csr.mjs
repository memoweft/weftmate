// Applied by npm ci/install before any host code loads the pinned ACME client.
// Fail closed on dependency drift; never silently ship an unpatched parser.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const patches = JSON.parse(await readFile(new URL('../patches/root-csr/patch.json', import.meta.url), 'utf8'));
const hash = text => createHash('sha256').update(text).digest('hex');
// Resolve from the actual consumers too: a future nested duplicate must not
// leave ACME.js using an unpatched copy while our direct CSR import is fixed.
const acmeRequire = createRequire(require.resolve('@root/acme'));
const csrFile = require.resolve('@root/csr');
if (acmeRequire.resolve('@root/csr') !== csrFile) throw new Error('Unexpected nested @root/csr; update the CSR patch');
const csrRequire = createRequire(csrFile);
if (csrRequire.resolve('@root/asn1/parser') !== require.resolve('@root/asn1/parser'))
  throw new Error('Unexpected nested @root/asn1; update the CSR patch');

// Validate all inputs before writing either file. Already-patched installs are
// idempotent; whole-file hashes bind every replacement to the lockfile versions.
const writes = [];
for (const patch of patches) {
  const directory = path.dirname(require.resolve(`${patch.package}/package.json`));
  const { version } = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  if (version !== patch.version) throw new Error(`CSR patch requires ${patch.package}@${patch.version}`);
  const file = path.join(directory, patch.file);
  const source = await readFile(file, 'utf8');
  if (hash(source) === patch.patchedSha256) continue;
  if (hash(source) !== patch.sha256) throw new Error(`Unexpected ${patch.package}/${patch.file}; update the CSR patch`);
  let patched = source;
  for (const [before, after] of patch.changes) {
    if (patched.split(before).length !== 2) throw new Error(`Nonunique CSR patch in ${patch.package}`);
    patched = patched.replace(before, after);
  }
  if (hash(patched) !== patch.patchedSha256) throw new Error(`Invalid CSR patch for ${patch.package}`);
  writes.push([file, patched]);
}
for (const [file, patched] of writes) await writeFile(file, patched);
console.log('Pinned @root/csr schema patch verified');
