import { app } from 'electron';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repository = resolve(import.meta.dirname, '../..');
app.getAppPath = () => repository;
registerHooks({ load(url, context, nextLoad) {
  if (url === pathToFileURL(resolve(repository, 'src/dsh-web-runtime.ts')).href) {
    const source = readFileSync(new URL(url), 'utf8');
    const seam = 'spawn(spec.command, args, {';
    assert.ok(source.includes(seam));
    return { format: 'module-typescript', shortCircuit: true, source: source.replace(seam,
      `spawn(spec.command, ['--import', ${JSON.stringify(new URL('./personal-early-stop-preload.mjs', import.meta.url).href)}, ...args], {`) };
  }
  return nextLoad(url, context);
} });
await import(pathToFileURL(resolve(repository, 'src/main.mjs')).href);
