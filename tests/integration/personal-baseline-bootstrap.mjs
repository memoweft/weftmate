// Isolated baseline entry: memory-only vault and a timing-only DSH preload.
import { app } from 'electron';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const repository = resolve(import.meta.dirname, '../..');
app.getAppPath = () => repository;
await import('./baseline-request-trace.mjs');
registerHooks({ load(url, context, nextLoad) {
  if (url === pathToFileURL(resolve(repository, 'src/config-store.ts')).href) {
    let source = 'const ephemeralKeys = new Map<string, string>();\n' + readFileSync(new URL(url), 'utf8');
    source = source.replace('return readSecrets().credentials[id] ?? null;', 'return ephemeralKeys.get(id) ?? null;')
      .replace('encryptedVault().save(id, apiKey);', 'ephemeralKeys.set(id, apiKey);')
      .replace('encryptedVault().remove(id);', 'ephemeralKeys.delete(id);');
    return { format: 'module-typescript', source, shortCircuit: true };
  }
  if (url === pathToFileURL(resolve(repository, 'src/dsh-web-runtime.ts')).href) {
    const source = readFileSync(new URL(url), 'utf8').replace('spawn(spec.command, args, {',
      `spawn(spec.command, ['--import', ${JSON.stringify(pathToFileURL(resolve(import.meta.dirname, 'baseline-request-trace.mjs')).href)}, ...args], {`);
    return { format: 'module-typescript', source, shortCircuit: true };
  }
  return nextLoad(url, context);
} });
await import(pathToFileURL(resolve(repository, 'src/main.mjs')).href);
