// Review mutation: keep the read gate but renew the actual phone timer at 0.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { outputPath } from './evidence.mjs';
const original=pathToFileURL(resolve('apps/mobile-ui/tests/chat-interactions.test.mjs'));
let code=readFileSync(original,'utf8').replaceAll('import.meta.url',JSON.stringify(original.href));
const mutate="originalSource.replace('uiCore.historyPollDelay(result)', '0')"+
  (process.argv.includes('--old-storm')?".replaceAll('!core.historyReadAllowed()', 'false')":'');
code=code.replace("import {mobileSource as source,mobileHtml as html} from './load-page.mjs';",
  `import {mobileSource as originalSource,mobileHtml as html} from '${new URL('./load-page.mjs',original).href}';\nconst source=${mutate};`);
writeFileSync(outputPath('zero-delay.test.mjs'),code);
