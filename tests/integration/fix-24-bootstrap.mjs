import {boundaryForCompletedTurn} from '../../src/plugins/weftmate-personal-memory.mjs';
globalThis.fix24Boundary=boundaryForCompletedTurn;
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const target=pathToFileURL(resolve(import.meta.dirname,'../../src/personal-access/index.mjs')).href;
registerHooks({load(url,context,next){if(url!==target)return next(url,context);return {format:'module',shortCircuit:true,source:readFileSync(new URL(url),'utf8').replace('  return service;','  globalThis.fix24 = {service,context}; return service;')};}});
await import('./m2-exit-bootstrap.mjs');
