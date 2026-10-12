/** Exposes isolated production services to Playwright; no product behavior is replaced. */
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const target=pathToFileURL(resolve(import.meta.dirname,'../../src/personal-access/index.mjs')).href;
registerHooks({load(url,context,next){if(url!==target)return next(url,context);return {format:'module',shortCircuit:true,source:readFileSync(new URL(url),'utf8').replace('  return service;','  globalThis.health2 = {service,context}; return service;')};}});
// This existing acceptance entry keeps all credentials in a process-local Map.
await import('./m2-exit-bootstrap.mjs');
