// Publish only checks, decisions and aggregate upstream usage, never account data.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [label, root] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(label ?? '') || !root) throw new Error('Usage: node collect.mjs <label> <isolated-root>');
const read = file => JSON.parse(readFileSync(join(root, file), 'utf8'));
const report = read('eval/results.json');
const decisions = [];
function visit(value) {
  if (Array.isArray(value)) value.forEach(visit);
  else if (value && typeof value === 'object') {
    if (value.approvalId && value.riskCategories) decisions.push(value);
    Object.values(value).forEach(visit);
  }
}
visit(read('profile/personal-access/store.json'));
const requests = new Map();
for (const row of readFileSync(join(root, 'requests.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)) {
  if (row.kind !== 'model' || row.origin !== 'https://api.xiaomimimo.com') continue;
  const request = requests.get(row.id) ?? {};
  if (row.phase === 'start') request.started = true;
  if (row.status === 429) request.rejected429 = true;
  if (row.usage) request.usage = row.usage;
  requests.set(row.id, request);
}
const upstream = [...requests.values()].filter(request => request.started);
const usage = { requests: upstream.length, requestsWithUsage: 0, requestsWithoutUsage: 0, rejected429: 0, input: 0, cachedInput: 0, output: 0 };
for (const request of upstream) {
  if (request.rejected429) usage.rejected429++;
  if (!request.usage) { usage.requestsWithoutUsage++; continue; }
  usage.requestsWithUsage++;
  usage.input += request.usage.prompt_tokens ?? 0;
  usage.cachedInput += request.usage.prompt_tokens_details?.cached_tokens ?? 0;
  usage.output += request.usage.completion_tokens ?? 0;
}
usage.knownEstimatedCny = ((usage.input - usage.cachedInput) * 100 + usage.cachedInput * 2 + usage.output * 200) / 1e8;
usage.kind = 'Known usage estimate; lower bound when requests have no usage; not an account invoice';
usage.priceSource = 'https://mimo.mi.com/models/zh-CN/mimo-v2.6-flash';
const snapshot = Object.fromEntries(['personal-write-targets.mjs', 'personal-approval-policy.mjs'].map(file => [file,
  createHash('sha256').update(readFileSync(join(root, 'profile/dsh-home/profiles/weftmate/plugins', file))).digest('hex')]));
const output = {
  label, startedAt: report.startedAt, model: 'mimo-v2.6-flash', policySnapshotSha256: snapshot, summary: report.summary,
  scenarios: report.results.map(result => ({
    id: result.id, status: result.status, durationMs: result.durationMs, reason: result.reason ?? null, checks: result.checks,
    turns: result.turns.map(turn => ({ status: turn.status, durationMs: turn.durationMs,
      approvals: decisions.filter(decision => decision.sessionId === turn.sessionId && decision.sourceCommandId === turn.commandId).map(decision => ({
        toolName: decision.toolName, riskCategories: decision.riskCategories, status: decision.status, outcome: decision.outcome,
      })),
    })),
  })), credentialScan: read('credential-scan.json'), usage,
};
writeFileSync(new URL(`./${label}.json`, import.meta.url), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ label, summary: output.summary, usage }));
