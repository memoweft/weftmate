/** Consolidate evidence without rewriting any measured response or verdict. */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
const root = resolve('tests/evidence/mf-2');
const json = p => JSON.parse(readFileSync(p, 'utf8'));
const lines = p => existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const walk = p => readdirSync(p, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(p, e.name)) : [join(p, e.name)]);
const save = (name, value) => writeFileSync(join(root, name), JSON.stringify(value, null, 2) + '\n');
const files = walk(root), roots = new Set(['C:/Temp/weftmate-m2f-mimo-782dfe8d-e5dd-4310-8aa6-7161b545b24e', 'C:/Temp/weftmate-m2f-mimo-aacd6018-a849-4286-864b-e3df60edf8a7']);
for (const p of files.filter(p => p.endsWith('run-roots.json'))) for (const r of json(p)) roots.add(r);
for (const p of files.filter(p => p.endsWith('results.json'))) { const rs = json(p); if (Array.isArray(rs)) for (const r of rs) if (r.root) roots.add(r.root); }
const requests = new Map();
for (const p of [...files.filter(p => /requests\.jsonl$/.test(p) && !/memory-requests/.test(p)), ...[...roots].map(r => join(r, 'requests.jsonl'))]) {
  const trace = lines(p);
  for (const start of trace.filter(r => r.phase === 'start' && r.origin === 'https://api.xiaomimimo.com' && r.requestedModel === 'mimo-v2.6-flash')) {
    const end = trace.find(r => r.id === start.id && r.phase === 'end' && r.at >= start.at);
    const id = `${start.id}:${start.at}`;
    if (!requests.get(id)?.usage) requests.set(id, { id, at: start.at, usage: end?.usage ?? null });
  }
}
for (const p of files.filter(p => /baseline-(mimo|lan)\.json$/.test(p))) {
  for (const [i, judgement] of (json(p).directJudgements ?? []).entries()) requests.set(`${p}:${i}`, { id: `${p}:${i}`, usage: judgement.usage ?? null });
}
const total = { requests: requests.size, returnedUsage: 0, missingUsage: 0, input: 0, cached: 0, output: 0 };
for (const { usage } of requests.values()) {
  if (!usage) { total.missingUsage++; continue; }
  total.returnedUsage++; total.input += usage.prompt_tokens ?? 0;
  total.cached += usage.prompt_tokens_details?.cached_tokens ?? 0; total.output += usage.completion_tokens ?? 0;
}
save('usage-total.json', { ...total, knownCnyLowerBound: (total.input - total.cached + total.cached * .02 + total.output * 2) / 1e6,
  pricing: { verifiedAt: '2026-10-09', source: 'https://mimo.mi.com/models/zh-CN/mimo-v2.6-flash', uncachedPerMillion: 1, cachedPerMillion: .02, outputPerMillion: 2 },
  note: 'External MiMo wire calls counted once by request ID and start time; local proxies excluded. Includes failed/interrupted runs and direct semantic judges. Missing usage is not treated as free.', requestsDetail: [...requests.values()], syntheticRoots: [...roots] });
const injections = [];
for (const p of files.filter(p => p.endsWith('results.json'))) {
  const reports = json(p); if (!Array.isArray(reports)) continue;
  for (const report of reports) {
    if (report.turns.length !== 3 || !report.answer) continue;
    const dir = p.slice(0, -'results.json'.length), third = report.turns[2];
    const recalls = lines(join(dir, report.id, 'recall.jsonl')).filter(r => r.sessionId === third.sessionId);
    const worlds = report.finalStorage ?? {};
    injections.push({ run: dir.slice(root.length + 1), id: report.id, model: report.model, settledMode: report.settledMode,
      answer: report.answer, automaticPass: report.automaticPass,
      actualInjection: recalls.map(r => ({ contextText: r.contextText, worldRevision: r.world?.world_revision,
        recentEvidence: r.world?.preview?.recent_evidence, formalItems: r.memories })),
      formation: (worlds.memory_world_job ?? []).map(j => ({ state: j.state, outcome: j.world_result_json ? JSON.parse(j.world_result_json) : null })),
      currentCognitions: (worlds.cognition ?? []).filter(c => !c.invalid_at).map(c => c.content),
      currentEntities: (worlds.entity ?? []).filter(c => !c.invalid_at).map(c => c.canonical_name),
      forget: report.forget ? { passed: report.forget.passed, files: report.forget.backupFiles, byteHits: report.forget.byteHits,
        tables: report.forget.databaseScan?.tableCount, databaseHits: report.forget.databaseScan?.hitCount, contextAfterForget: report.forget.contextAfterForget } : undefined });
  }
}
save('injection-and-formation.json', injections);
console.log(JSON.stringify({ ...total, knownCnyLowerBound: (total.input - total.cached + total.cached * .02 + total.output * 2) / 1e6, completedCases: injections.length }));
