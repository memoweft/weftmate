// Isolated acceptance only: real model key remains in memory. Synthetic
// connector credentials still use the product's real encrypted vault.
import { app } from 'electron';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const repo = resolve(import.meta.dirname, '../..'); app.getAppPath = () => repo;
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
globalThis.st7ModelRequests = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (...args) => { if (String(args[0]).startsWith('https://api.xiaomimimo.com/') && String(args[0]).includes('chat/completions')) globalThis.st7ModelRequests++; return originalFetch(...args); };
registerHooks({ load(url, context, next) {
  if (url === pathToFileURL(resolve(repo,'src/config-store.ts')).href) {
    let source = 'const ephemeralKeys = new Map<string,string>();\n' + readFileSync(new URL(url),'utf8');
    source = source.replace('return readSecrets().credentials[id] ?? null;', 'return ephemeralKeys.get(id) ?? readSecrets().credentials[id] ?? null;');
    source = source.replace('encryptedVault().save(id, apiKey);', "if (apiKey === process.env.WEFTMATE_ST7A_MODEL_KEY) ephemeralKeys.set(id, apiKey); else encryptedVault().save(id, apiKey);");
    source = source.replace('encryptedVault().remove(id);', 'ephemeralKeys.delete(id); encryptedVault().remove(id);');
    return { format:'module-typescript', source, shortCircuit:true };
  }
  return next(url,context);
} });
await import(pathToFileURL(resolve(repo,'src/main.mjs')).href);
