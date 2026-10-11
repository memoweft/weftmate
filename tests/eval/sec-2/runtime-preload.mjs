import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
registerHooks({ load(url, context, next) {
  if (url.endsWith('/plugins/weftmate-personal-desktop.mjs')) {
    const source = `import { install as installSec2Containment } from ${JSON.stringify(pathToFileURL(resolve(import.meta.dirname, 'sandbox.mjs')).href)};\n` + readFileSync(new URL(url), 'utf8').replace('export function apply(ctx) {', 'export function apply(ctx) { installSec2Containment(ctx);');
    if (!source.includes('apply(ctx) { installSec2Containment')) throw Error('SEC2 hook seam changed');
    return { format: 'module', source, shortCircuit: true };
  }
  return next(url, context);
} });
