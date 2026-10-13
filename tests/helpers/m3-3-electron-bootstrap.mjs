/** Real application, with only OS credential storage substituted in this test process. */
import { app } from 'electron';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const repository = resolve(import.meta.dirname, '../..');
app.disableHardwareAcceleration();
app.getAppPath = () => repository;
const vaultUrl = new URL('./m3-3-safe-storage.mjs', import.meta.url).href;
// Import now and delete the random test key before any managed child exists.
await import(vaultUrl);
registerHooks({ load(url, context, next) {
  if (url === pathToFileURL(resolve(repository, 'src/config-store.ts')).href ||
      url === pathToFileURL(resolve(repository, 'src/personal-desktop.mjs')).href) {
    const source = readFileSync(new URL(url), 'utf8')
      .replace('app, safeStorage }', 'app }').replace('safeStorage, dialog', 'dialog');
    return { format: url.endsWith('.ts') ? 'module-typescript' : 'module',
      source: `import { fixtureSafeStorage as safeStorage } from ${JSON.stringify(vaultUrl)};\n${source}`, shortCircuit: true };
  }
  return next(url, context);
} });
await import(pathToFileURL(resolve(repository, 'src/main.mjs')).href);
