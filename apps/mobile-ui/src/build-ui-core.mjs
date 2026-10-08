/** Generate mobile assets from the shared feature layer; www/ui-core is never a source. */
import { copyFile, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { uiCoreAssets } from '../../../src/ui-core/manifest.mjs';

export const uiCoreSourceDir = fileURLToPath(new URL('../../../src/ui-core/', import.meta.url));
export const mobileWwwDir = fileURLToPath(new URL('../www/', import.meta.url));
export const mobileUiCoreDir = path.join(mobileWwwDir, 'ui-core');

async function filesUnder(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await filesUnder(path.join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`ui-core assets: unsupported generated entry ${relative}`);
  }
  return files;
}

/** Fail before packaging or publishing if the generated set or any bytes are stale. */
export async function checkUiCoreAssets({ sourceDir = uiCoreSourceDir, targetDir = mobileUiCoreDir } = {}) {
  let actual;
  try { actual = await filesUnder(targetDir); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error('ui-core assets: generated files are missing; run npm run build in apps/mobile-ui');
  }
  const expected = new Set(uiCoreAssets);
  const found = new Set(actual);
  const problems = [
    ...uiCoreAssets.filter((name) => !found.has(name)).map((name) => `missing ${name}`),
    ...actual.filter((name) => !expected.has(name)).map((name) => `unexpected ${name}`),
  ];
  for (const name of uiCoreAssets) {
    if (!found.has(name)) continue;
    const [source, generated] = await Promise.all([
      readFile(path.join(sourceDir, name)), readFile(path.join(targetDir, name)),
    ]);
    if (!source.equals(generated)) problems.push(`differs ${name}`);
  }
  if (problems.length) throw new Error(`ui-core assets: ${problems.join('; ')}; run npm run build in apps/mobile-ui`);
  return uiCoreAssets.length;
}

export async function buildUiCoreAssets({ sourceDir = uiCoreSourceDir, targetDir = mobileUiCoreDir } = {}) {
  await mkdir(targetDir, { recursive: true });
  const expected = new Set(uiCoreAssets);
  for (const name of uiCoreAssets) {
    const destination = path.join(targetDir, name);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(sourceDir, name), destination);
  }
  // Entries removed from the canonical manifest must also leave the public bundle.
  for (const name of await filesUnder(targetDir)) {
    if (!expected.has(name)) await rm(path.join(targetDir, name));
  }
  return checkUiCoreAssets({ sourceDir, targetDir });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  console.log(`[mobile-ui] generated ${await buildUiCoreAssets()} shared ui-core assets`);
}
