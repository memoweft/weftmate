// Expose the existing observer disposer to narrowly scoped deterministic fixtures.
// Production source is loaded unchanged apart from this test-only hook.
import { readFileSync } from 'node:fs';
const url = new URL('../../src/personal-access/index.mjs', import.meta.url);
const source = readFileSync(url, 'utf8').replaceAll('import.meta.url', JSON.stringify(url.href))
  .replace(/from (['"])(\.\.?\/[^'"]+)\1/g, (_, quote, path) => `from '${new URL(path, url).href}'`)
  .replace('const service = {', 'const service = { __stopBackgroundActivity: () => activity.close(),');
export const { createPersonalAccessService } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
