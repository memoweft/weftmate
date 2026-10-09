// The optional baseline restores only the pre-PJ-1 cloud artifact source rejection.
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const sourceUrl = pathToFileURL(resolve(import.meta.dirname,'../../../../src/personal-access/artifacts.mjs')).href;
if (process.env.WEFTMATE_FX11_SOURCE_BASELINE === 'true') registerHooks({ load(url, context, next) {
  if(url !== sourceUrl) return next(url,context);
  const source = readFileSync(new URL(url),'utf8').replace("['password', 'cloud'].includes(device?.authKind)", "device?.authKind === 'password'");
  return {format:'module',source,shortCircuit:true};
}});
await import('../../../integration/personal-baseline-bootstrap.mjs');
