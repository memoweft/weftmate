import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// Carried in src so the same trusted hashes ship in app.asar. The archive
// checker uses its own build copy, never a manifest supplied by the artifact.
export const csrPatches = JSON.parse(readFileSync(new URL('./csr-patch.json', import.meta.url), 'utf8'));
export const csrHash = bytes => createHash('sha256').update(bytes).digest('hex');
export function csrIntegrityError(reason) {
  return Object.assign(new Error(`CSR dependency integrity failed: ${reason}. Rebuild with the pinned patch; after dependency upgrades, re-evaluate the patch and hashes.`),
    { code: 'CSR_PATCH_INVALID' });
}

export function verifyPatchedCsrBytes(read) {
  for (const patch of csrPatches) {
    const base = `node_modules/${patch.package}`;
    let metadata, bytes;
    try {
      metadata = JSON.parse(read(`${base}/package.json`).toString());
      bytes = read(`${base}/${patch.file}`);
    } catch { throw csrIntegrityError(`${patch.package} files missing or unreadable`); }
    if (metadata.version !== patch.version) throw csrIntegrityError(`${patch.package} version mismatch`);
    if (patch.package === '@root/csr' && metadata.main !== patch.file)
      throw csrIntegrityError('@root/csr entry mismatch');
    if (csrHash(bytes) !== patch.patchedSha256) throw csrIntegrityError(`${patch.package}/${patch.file} patched SHA256 mismatch`);
  }
  return { verifiedFiles: csrPatches.length };
}

export function resolveCsrDependencies(requireFrom = import.meta.url) {
  const require = createRequire(requireFrom);
  try {
    const csrFile = require.resolve('@root/csr/csr.js');
    if (require.resolve('@root/csr') !== csrFile || createRequire(require.resolve('@root/acme')).resolve('@root/csr') !== csrFile)
      throw csrIntegrityError('unexpected @root/csr entry or nested copy');
    if (createRequire(csrFile).resolve('@root/asn1/parser') !== require.resolve('@root/asn1/parser'))
      throw csrIntegrityError('unexpected nested @root/asn1 copy');
    const directories = new Map(csrPatches.map(p => [p.package, dirname(require.resolve(`${p.package}/package.json`))]));
    const file = relative => {
      for (const [name, directory] of directories) {
        const prefix = `node_modules/${name}/`;
        if (relative.startsWith(prefix)) return join(directory, relative.slice(prefix.length));
      }
      throw csrIntegrityError('unexpected dependency file');
    };
    return { file, read: relative => readFileSync(file(relative)) };
  } catch (error) {
    if (error.code === 'CSR_PATCH_INVALID') throw error;
    throw csrIntegrityError('dependencies missing or unresolved');
  }
}

let verified = false;
export function ensureCsrPatched() {
  if (verified) return;
  verifyPatchedCsrBytes(resolveCsrDependencies().read);
  verified = true; // Only successful first-use checks are cached. Never repair at runtime.
}
