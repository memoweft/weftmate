import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// Expose observation shutdown only in the test module, without a product API.
const url = pathToFileURL(resolve('src/personal-access/index.mjs'));
const source = readFileSync(url, 'utf8').replaceAll('import.meta.url', JSON.stringify(url.href))
  .replace(/from (['"])(\.\.?\/[^'"]+)\1/g, (_, quote, path) => `from '${new URL(path, url).href}'`)
  .replace('const service = {', 'const service = { __testContext: context,');
export const { createPersonalAccessService } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
