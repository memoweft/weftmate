import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
registerHooks({load(url,context,next){if(url===new URL('../../src/main.mjs',import.meta.url).href){const source=readFileSync(new URL(url),'utf8').replace('personalDesktop = createPersonalDesktop({','globalThis.st4Access = personalAccessService; personalDesktop = createPersonalDesktop({');return {format:'module',source,shortCircuit:true};}return next(url,context);}});
globalThis.st4SeedCredentials=async()=>{const vault=await import('../../src/config-store.ts'),routes=await import('../../src/harness-model-routes.ts'),official=await import('../../src/dsh-settings-migration.ts');vault.saveCredential(official.officialCredentialRef(routes.routeForProfile('synthetic-st4').provider),'synthetic-st4-key');};
await import('./personal-baseline-bootstrap.mjs');
