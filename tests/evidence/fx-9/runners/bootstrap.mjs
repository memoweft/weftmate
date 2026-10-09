// Reproduce the pre-fix host without changing the working tree.
import { registerHooks } from 'node:module';
import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,options)=>{const result=await originalFetch(input,options);if(result.status>=400){try{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(url.pathname.includes('/cloud/')){const body=await result.clone().json();appendFileSync(process.env.WEFTMATE_BASELINE_TRACE,JSON.stringify({kind:'auth-error',path:url.pathname,status:result.status,code:body.error?.code})+'\n');}}catch{}}return result;};
const repository = resolve(import.meta.dirname, '../../../..');
if (process.env.WEFTMATE_FX9_BASELINE === 'true') {
  const sources = new Map(['src/main.mjs', 'src/personal-cloud/index.mjs',
    'src/personal-access/index.mjs', 'src/personal-access/authentication.mjs', 'src/personal-access/store.mjs']
    .map(file => [pathToFileURL(resolve(repository, file)).href,
      execFileSync('git', ['show', `cf211f4:${file}`], { cwd: repository, encoding: 'utf8', windowsHide: true })]));
  registerHooks({ load(url, context, next) {
    return sources.has(url) ? { format: 'module', source: sources.get(url), shortCircuit: true } : next(url, context);
  } });
}
await import('../../../integration/personal-baseline-bootstrap.mjs');
