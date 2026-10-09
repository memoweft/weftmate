/** Synthetic API-layer budget probe. Native recovery and UI frame/memory budgets
 * are explicitly separate; no user's profile, network model or fixed port. */
import { performance } from 'node:perf_hooks';
import { cpus, platform, release } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { fixture } from '../tests/helpers/chat-timeline-fixture.mjs';

const p95 = values => [...values].sort((a,b) => a-b)[Math.ceil(values.length * .95)-1];
const measure = async fn => { const start = performance.now(); await fn(); return performance.now()-start; };
const results = [];
for (const count of [10_000, 100_000]) {
  const f = fixture(count), cold = [], warm = [], older = [], dates = [], searches = [];
  try {
    const before = { ...f.reads }, coldMs = await measure(() => f.query('events'));
    const firstPageReads = Object.fromEntries(Object.keys(before).map(key => [key, f.reads[key]-before[key]]));
    const buildMs = await measure(() => f.timeline.ready('owner', f.mainId));
    for (let run = 0; run < 30; run++) {
      const tail = await f.query('events');
      warm.push(await measure(() => f.query('events')));
      older.push(await measure(() => f.query('events', { before: tail.olderCursor })));
      dates.push(await measure(() => f.query('locate', { date: '2026-10-09' })));
      searches.push(await measure(() => f.query('search', { q: run % 2 ? '中文纸船' : '无结果关键词', from: '2026-10-08', to: '2026-10-10' })));
    }
    for (let run = 0; run < 30; run++) {
      f.timeline.invalidate('owner', f.mainId);
      cold.push(await measure(() => f.query('events')));
    }
    results.push({ requestedMessages: count, segments: 3, pageSize: 50, iterations: 30, coldMs, buildMs, firstPageReads,
      p95Ms: { coldIndexTail: p95(cold), warmTail: p95(warm), older: p95(older), locate: p95(dates), search: p95(searches) } });
  } finally { await f.timeline.close(); }
}
const report = { checkedAt: new Date().toISOString(), environment: { platform: platform(), release: release(), node: process.version,
  cpu: cpus()[0].model }, transport: 'in-process synthetic projected history; RTT=0', results,
  exclusions: ['DSH cold log inspection/recovery is not simulated by this probe; native integration records that separately.',
    'No renderer is modified in IA-2a. First readable/input, 60-second scroll/frame and renderer memory budgets are IA-3/IA-4/IA-5 acceptance.',
    'Synthetic backend reports projected bytes/rows, not physical disk I/O.'] };
await mkdir('tests/evidence/ia-2a', { recursive: true });
await writeFile('tests/evidence/ia-2a/history-performance.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
