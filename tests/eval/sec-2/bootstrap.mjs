// Test-only loading seams: memory-only credentials, local synthetic DNS, containment.
import { app } from 'electron';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const repo = resolve(import.meta.dirname, '../../..');
app.getAppPath = () => repo;
registerHooks({ load(url, context, next) {
  if (url.endsWith('/src/config-store.ts')) {
    let source = 'const ephemeralKeys = new Map<string,string>();\n' + readFileSync(new URL(url), 'utf8');
    source = source.replace('return readSecrets().credentials[id] ?? null;', 'return ephemeralKeys.get(id) ?? null;').replace('encryptedVault().save(id, apiKey);', 'ephemeralKeys.set(id, apiKey);').replace('encryptedVault().remove(id);', 'ephemeralKeys.delete(id);');
    return { format: 'module-typescript', source, shortCircuit: true };
  }
  if (url.endsWith('/src/dsh-web-runtime.ts')) {
    const source = readFileSync(new URL(url), 'utf8').replace('spawn(spec.command, args, {', `spawn(spec.command, ['--import', ${JSON.stringify(pathToFileURL(resolve(import.meta.dirname, 'runtime-preload.mjs')).href)}, ...args], {`);
    return { format: 'module-typescript', source, shortCircuit: true };
  }
  return next(url, context);
} });
await import(pathToFileURL(resolve(repo, 'src/main.mjs')).href);
