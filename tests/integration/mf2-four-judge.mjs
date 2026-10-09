// Reuse MF-1's direct semantic judge, leaving failed host-judge checks unchanged.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { judgeMemorySemantics } from './baseline-memory-verification.mjs';
const input = resolve(process.argv[2]);
const report = JSON.parse(readFileSync(input, 'utf8'));
const key = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  "[Console]::Out.Write([Environment]::GetEnvironmentVariable('MIMO_API_KEY','Machine'))"], { encoding: 'utf8', windowsHide: true }).trim();
const results = [];
for (const result of report.four?.rows ?? report.fourProgress ?? []) {
  const scenario = JSON.parse(readFileSync(resolve('eval/scenarios', `${result.id}.yaml`), 'utf8'));
  const semantic = await judgeMemorySemantics({ result, scenario, key });
  const behaviorChecks = result.checks.filter(c => !['memory_used', 'llm_judge'].includes(c.type));
  results.push({ id: result.id, originalStatus: result.status, originalReason: result.reason, semantic,
    behaviorPass: result.turns.length === scenario.turns.length && result.turns.every(t => t.status === 'completed' && !t.approvals.length)
      && behaviorChecks.every(c => c.status === 'passed') && ['passed', 'skipped'].includes(semantic.status),
    formalMemoryUsed: result.turns.at(-1)?.memoryUsed, answer: result.turns.at(-1)?.reply });
  writeFileSync(join(dirname(input), 'direct-semantics.json'), JSON.stringify({ input, results, behaviorPassed: results.filter(r => r.behaviorPass).length, total: results.length }, null, 2) + '\n');
  console.log(`${result.id}: behavior=${results.at(-1).behaviorPass} semantic=${semantic.status}`);
}
