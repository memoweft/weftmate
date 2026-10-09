import assert from 'node:assert/strict';
import { mkdtemp, mkdir, stat, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import { Context } from '../vendor/dsh-runtime/node_modules/@deepseek-ai/cordis/lib/index.js';
import Sessions, { Session } from '../vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-session/lib/index.js';
import Persistence from '../vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js';
import { nativeTimelineLog } from '../src/runtime/dsh-adapter/timeline.mjs';
import { createDshSessionAdapter } from '../src/runtime/dsh-adapter/sessions.mjs';

const child = process.argv[2] === '--cold';
if (child) {
  const ctx = new Context();
  try {
    await ctx.plugin(Sessions);
    await ctx.plugin(Persistence, { root: process.argv[3], compression: 'none', packChunks: true });
    const adapter = createDshSessionAdapter({ sessions: { list: async () => ({ result: { ok: true, value: { items: [{ sessionId: 'synthetic-history' }] } } }) }, events: {} }, { readLog: nativeTimelineLog(ctx) });
    const start = performance.now(), page = await adapter.historyPage('synthetic-history', { limit: 50 });
    const coldMs = performance.now() - start;
    assert.equal(page.events.length, 50);
    const warm = [];
    for (let i = 0; i < 30; i++) { const start = performance.now(); await adapter.historyPage('synthetic-history', { limit: 50 }); warm.push(performance.now()-start); }
    console.log(JSON.stringify({ coldMs, warmP95Ms: warm.sort((a,b)=>a-b)[28], returned: page.events.length }));
  } finally { await ctx.fiber.dispose(); }
} else {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-ia-2a-native-perf-')), results = [];
  try {
    for (const count of [10000,100000]) {
      const directory = join(root, String(count)), ctx = new Context(); let bytes;
      try {
        await ctx.plugin(Sessions);
        await ctx.plugin(Persistence, { root: directory, compression: 'none', packChunks: true });
        const session = Session.create('synthetic-history');
        for (let i = 0; i < count; i++) {
          const message = { id: `message-${i}`, role: i % 2 ? 'assistant' : 'user', source: i % 2 ? { kind: 'model', provider: 'synthetic', model: 'fixture' } : { kind: 'user' },
            content: [{ type: 'text', text: `合成纸船 ${i} ${'消息正文'.repeat(40)}` }] };
          session.append(i % 2 ? 'assistant/message' : 'user/message', i % 2 ? { message } : message, { surfaceOp: 'append' });
        }
        await ctx.sessionPersistence.create(session.header);
        await ctx.sessionPersistence.append(session.id, session.events);
        bytes = (await stat(ctx.sessionPersistence.locate(session.header).path)).size;
      } finally { await ctx.fiber.dispose(); }
      const runs = [];
      for (let i = 0; i < 30; i++) {
        const { stdout } = await promisify(execFile)(process.execPath, [import.meta.filename, '--cold', directory], { windowsHide: true });
        runs.push(JSON.parse(stdout.trim()));
      }
      results.push({ messages: count, freshProcesses: runs.length, physicalLogBytes: bytes, inspectedNativeRows: count,
        coldP95Ms: runs.map(r=>r.coldMs).sort((a,b)=>a-b)[28], warmP95Ms: Math.max(...runs.map(r=>r.warmP95Ms)),
        tailBudgetMet: runs.map(r=>r.coldMs).sort((a,b)=>a-b)[28] <= 200 });
    }
    const report = { checkedAt: new Date().toISOString(), fixedDsh: true, synthetic: true, pageSize: 50, results,
      limitation: 'Pinned DSH inspect reads the full stored log before projection. Cold native read bytes grow linearly; logical indexing alone does not meet the non-linear cold-read budget. IA-2b must close this with a native range-read seam; no private log decoder is introduced here.' };
    await mkdir('tests/evidence/ia-2a', { recursive: true });
    await writeFile('tests/evidence/ia-2a/history-native-performance.json', JSON.stringify(report, null, 2)+'\n');
    console.log(JSON.stringify(report, null, 2));
  } finally { await rm(root, { recursive: true, force: true }); }
}
