import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
export async function csrDependencyFixture(root, { patched = true } = {}) {
  const patches = JSON.parse(await readFile(new URL('../../src/personal-relay/csr-patch.json', import.meta.url), 'utf8'));
  for (const patch of patches) {
    let bytes = await readFile(require.resolve(`${patch.package}/${patch.file}`), 'utf8');
    const digest = () => createHash('sha256').update(bytes).digest('hex');
    if (digest() === patch.patchedSha256 && !patched)
      for (const [before, after] of [...patch.changes].reverse()) bytes = bytes.replace(after, before);
    if (digest() === patch.sha256 && patched)
      for (const [before, after] of patch.changes) bytes = bytes.replace(before, after);
    assert.equal(digest(), patched ? patch.patchedSha256 : patch.sha256, 'fixture uses exact dependency bytes');
    const directory = join(root, 'node_modules', patch.package);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, patch.file), bytes);
    await writeFile(join(directory, 'package.json'), await readFile(require.resolve(`${patch.package}/package.json`)));
  }
  const acme = join(root, 'node_modules/@root/acme');
  await mkdir(acme, { recursive: true });
  await writeFile(join(acme, 'package.json'), await readFile(require.resolve('@root/acme/package.json')));
  await writeFile(join(acme, 'acme.js'), 'module.exports = {};');
}
