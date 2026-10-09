/** Supplement failed optional judge transport without changing saved desktop evidence. */
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { judgeMemorySemantics } from './baseline-memory-verification.mjs';
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Pass original desktop report and separate output path');
const report = JSON.parse(readFileSync(resolve(input)));
const key = (await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  "[Console]::Out.Write([Environment]::GetEnvironmentVariable('MIMO_API_KEY','Machine'))"], { windowsHide: true })).stdout.trim();
const results = [];
for (const step of report.steps) {
  const previous = step.semantic ? Array.isArray(step.semantic) ? step.semantic : [step.semantic] : [];
  const verdicts = [];
  for (const original of previous) {
    if (!original.prompt || !original.turn) continue;
    const turn = report.turns[original.turn - 1];
    const verdict = await judgeMemorySemantics({ result: { turns: [turn] },
      scenario: { turns: [{ user: turn.user }], checks: [{ type: 'llm_judge', prompt: original.prompt }] }, key });
    verdicts.push({ ...verdict, prompt: original.prompt, turn: original.turn });
  }
  const deterministic = Object.entries(step.checks).filter(([name]) => name !== 'semanticAccepted');
  results.push({ id: step.id, originalStatus: step.status, originalSemantic: previous,
    deterministicPassed: deterministic.length > 0 && deterministic.every(([, value]) => value === true), verdicts,
    supplementaryStatus: deterministic.length > 0 && deterministic.every(([, value]) => value === true) &&
      verdicts.every(v => v.status === 'passed') ? 'passed' : 'failed' });
  writeFileSync(resolve(output), JSON.stringify({ originalReport: resolve(input), results }, null, 2) + '\n');
  console.log(`${step.id}: ${results.at(-1).supplementaryStatus}`);
}
