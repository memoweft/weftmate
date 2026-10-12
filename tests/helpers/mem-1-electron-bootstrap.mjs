/** Only reroute the synthetic test's network transport; real runtime, permissions and Core stay intact. */
import { app } from 'electron';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const repository=resolve(import.meta.dirname,'../..');app.getAppPath=()=>repository;
await import('./mem-1-cloud-route.mjs');
registerHooks({load(url,context,next){
 if(url===pathToFileURL(resolve(repository,'src/dsh-web-runtime.ts')).href){
  const source=readFileSync(new URL(url),'utf8').replace('spawn(spec.command, args, {',
    `spawn(spec.command, ['--import', ${JSON.stringify(pathToFileURL(resolve(import.meta.dirname,'mem-1-cloud-route.mjs')).href)}, ...args], {`);
  return{format:'module-typescript',source,shortCircuit:true};
 }
 return next(url,context);
}});
await import(pathToFileURL(resolve(repository,'src/main.mjs')).href);
