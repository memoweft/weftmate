// Test-only replay of the exact pre-FACT-1 prompt/provider files. Never shipped.
import { registerHooks } from 'node:module';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
if (process.env.FACT1_PHASE === 'before') {
  const root = resolve(import.meta.dirname, '../..');
  const files = ['src/plugins/personal-prompt.mjs', 'src/plugins/personal-personalization.mjs',
    'src/plugins/personal-web-fetch.mjs', 'src/plugins/weftmate-compaction.mjs', 'src/personal-access/native-browser.mjs', 'src/ui-core/personalization.js'];
  const sources = new Map(files.map(file => [pathToFileURL(resolve(root, file)).href,
    execFileSync('git', ['show', '56f08f58ce447b3e3b7f872de25b5bf62ba9b956:' + file], {cwd:root,encoding:'utf8',windowsHide:true})]));
  registerHooks({load(url, context, next) {
    const file = files.find(file => url.endsWith('/' + file.replace(/^src\//, '')));
    return file ? {format:'module',source:sources.get(pathToFileURL(resolve(root,file)).href),shortCircuit:true} : next(url,context);
  }});
}
