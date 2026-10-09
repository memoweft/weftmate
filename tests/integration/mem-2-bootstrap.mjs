import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
registerHooks({ load(url, context, next) {
  if (url.endsWith('/src/personal-access/temporary-chats.mjs')) {
    const source = readFileSync(new URL(url), 'utf8')
      .replace('Date.parse(session.expiresAt) > context.timestamp()', 'Date.parse(session.expiresAt) > context.timestamp() + (globalThis.mem2Offset || 0)')
      .replace('  return {\n    async policy', '  globalThis.mem2Sweep = sweep;\n  return {\n    async policy');
    return { format:'module', source, shortCircuit:true };
  }
  return next(url, context);
} });
await import('./m2-exit-bootstrap.mjs');
