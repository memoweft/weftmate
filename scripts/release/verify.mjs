import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { sha256, verifyManifest } from '../../src/personal-update/manifest.mjs';
export async function verifyRelease({ manifest, trustedKeys, directory, versions = {} }) {
  verifyManifest(manifest, trustedKeys, { layer: manifest.layer, versions });
  for (const file of manifest.files) {
    const bytes = await readFile(join(directory, file.path));
    if (bytes.length !== file.size || sha256(bytes) !== file.sha256) throw new Error('hash release mismatch');
  }
  return manifest;
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const [manifestPath, directory, publicKeysPath] = process.argv.slice(2);
  if (!manifestPath || !directory || !publicKeysPath) throw new Error('usage: node scripts/release/verify.mjs <manifest.json> <files-dir> <trusted-keys.json>');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await verifyRelease({ manifest, directory, trustedKeys: JSON.parse(await readFile(publicKeysPath, 'utf8')) });
  console.log(`Verified ${manifest.layer} ${manifest.version}`);
}
