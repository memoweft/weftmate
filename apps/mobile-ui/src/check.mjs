import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { checkUiCoreAssets, mobileWwwDir } from './build-ui-core.mjs';

async function javascriptFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await javascriptFiles(file));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(file);
  }
  return files;
}

export async function checkMobileUi({ wwwDir = mobileWwwDir, sourceDir } = {}) {
  await checkUiCoreAssets({ sourceDir, targetDir: path.join(wwwDir, 'ui-core') });
  const files = await javascriptFiles(wwwDir);
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`mobile UI syntax check failed: ${file}\n${result.stderr || result.stdout}`);
  }
  return files.length;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  console.log(`[mobile-ui] checked ui-core copies and ${await checkMobileUi()} JavaScript files`);
}
