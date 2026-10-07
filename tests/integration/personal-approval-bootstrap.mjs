// Isolated integration entry only. Real model keys never enter the disk vault.
import { app } from 'electron';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const repository = resolve(import.meta.dirname, '../..');
app.getAppPath = () => repository;
registerHooks({ load(url, context, nextLoad) {
  if (url === pathToFileURL(resolve(repository, 'src/config-store.ts')).href) {
    let source = readFileSync(new URL(url), 'utf8');
    source = 'const ephemeralKeys = new Map<string, string>();\n' + source;
    source = source.replace('return readSecrets().credentials[id] ?? null;', 'return ephemeralKeys.get(id) ?? null;');
    source = source.replace('encryptedVault().save(id, apiKey);', 'ephemeralKeys.set(id, apiKey);');
    source = source.replace('encryptedVault().remove(id);', 'ephemeralKeys.delete(id);');
    return { format: 'module-typescript', source, shortCircuit: true };
  }
  return nextLoad(url, context);
} });
await import(pathToFileURL(resolve(repository, 'src/main.mjs')).href);
