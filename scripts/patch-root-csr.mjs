// Applied by npm ci/install before any host code loads the pinned ACME client.
// Fail closed on dependency drift; never silently ship an unpatched parser.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { csrPatches, csrHash, csrIntegrityError, resolveCsrDependencies, verifyPatchedCsrBytes } from '../src/personal-relay/csr-integrity.mjs';

export async function applyRootCsrPatch({ requireFrom = import.meta.url } = {}) {
  const { file: dependencyFile, read } = resolveCsrDependencies(requireFrom);
  // Validate all inputs before writing either file. Already-patched installs are
  // idempotent; whole-file hashes bind every replacement to the lockfile versions.
  const writes = [];
  for (const patch of csrPatches) {
    const base = `node_modules/${patch.package}`;
    const metadata = JSON.parse(read(`${base}/package.json`));
    if (patch.package === '@root/csr' && metadata.main !== patch.file) throw csrIntegrityError('@root/csr entry mismatch');
    if (metadata.version !== patch.version) throw csrIntegrityError(`${patch.package} version mismatch`);
    const file = dependencyFile(`${base}/${patch.file}`);
    const source = await readFile(file, 'utf8');
    if (csrHash(source) === patch.patchedSha256) continue;
    if (csrHash(source) !== patch.sha256) throw csrIntegrityError(`${patch.package}/${patch.file} unknown SHA256`);
    let patched = source;
    for (const [before, after] of patch.changes) {
      if (patched.split(before).length !== 2) throw csrIntegrityError(`${patch.package} nonunique patch`);
      patched = patched.replace(before, after);
    }
    if (csrHash(patched) !== patch.patchedSha256) throw csrIntegrityError(`${patch.package} invalid patch`);
    writes.push([file, patched]);
  }
  for (const [file, patched] of writes) await writeFile(file, patched);
  return verifyPatchedCsrBytes(read);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await applyRootCsrPatch();
  console.log('Pinned @root/csr schema patch verified');
}
