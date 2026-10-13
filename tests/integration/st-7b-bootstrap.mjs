// Isolated real app acceptance. Cloud key is read in memory and never persisted.
import { app } from 'electron';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const repo=resolve(import.meta.dirname,'../..');app.getAppPath=()=>repo;
process.env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
globalThis.st7bModelRequests=0;
const originalFetch=globalThis.fetch;
globalThis.fetch=(...args)=>{if(String(args[0]).startsWith('https://api.xiaomimimo.com/')&&String(args[0]).includes('chat/completions'))globalThis.st7bModelRequests++;return originalFetch(...args);};
registerHooks({load(url,context,next){
 if(url===pathToFileURL(resolve(repo,'src/config-store.ts')).href){
  let source='const ephemeralKeys = new Map<string,string>();\n'+readFileSync(new URL(url),'utf8');
  source=source.replace('return readSecrets().credentials[id] ?? null;','return ephemeralKeys.get(id) ?? readSecrets().credentials[id] ?? null;');
  source=source.replace('encryptedVault().save(id, apiKey);',"if (apiKey === process.env.WEFTMATE_ST7B_MODEL_KEY) ephemeralKeys.set(id, apiKey); else encryptedVault().save(id, apiKey);");
  source=source.replace('encryptedVault().remove(id);','ephemeralKeys.delete(id); encryptedVault().remove(id);');
  return {format:'module-typescript',source,shortCircuit:true};
 }
 if(url===pathToFileURL(resolve(repo,'src/personal-connectors/builtins.mjs')).href){
  // Tests trust only the two disposable fixture certificates. Certificate
  // verification remains enabled in the shipped implementation.
  let source=readFileSync(new URL(url),'utf8').replace('export function builtinConnectors()', 'function actualBuiltinConnectors()');
  source+='\nexport function builtinConnectors(){return actualBuiltinConnectors().map(item=>({...item,configure:(fields,secrets)=>{const config=item.configure(fields,secrets);config.environment={...config.environment,NODE_EXTRA_CA_CERTS:process.env.WEFTMATE_ST7B_CA};return config;}}));}\n';
  return {format:'module',source,shortCircuit:true};
 }
 return next(url,context);
}});
await import(pathToFileURL(resolve(repo,'src/main.mjs')).href);
