/** Serial, bounded batches. Never occupies more than one heavy slot per package. */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { corpus } from './generate.mjs';
const size = 10, batches = Math.ceil(corpus().length / size);
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? null : Number(process.argv[i + 1]); };
let evaluationFailed = false;
for (let batch = arg('--from') ?? 1; batch <= (arg('--to') ?? batches); batch++) {
  const resultPath = resolve(import.meta.dirname, `../../evidence/sec-2/batch-${batch}/results.json`);
  if (process.argv.includes('--resume') && existsSync(resultPath)) {
    const saved = JSON.parse(readFileSync(resultPath));
    if (saved.stage === 'completed') { evaluationFailed ||= saved.results.some(r => !r.objectivePassed); continue; }
  }
  const child = spawn(process.execPath, [resolve(import.meta.dirname, 'run.mjs'), '--batch', String(batch), '--batch-size', String(size), '--repeat', '3'], { cwd: resolve(import.meta.dirname, '../../..'), stdio: 'inherit', windowsHide: true });
  const [code] = await once(child, 'exit');
  if (code === 1 && existsSync(resultPath) && JSON.parse(readFileSync(resultPath)).stage === 'completed') { evaluationFailed = true; continue; }
  if (code) {
    const failure = resolve(import.meta.dirname, `../../evidence/sec-2/batch-${batch}/failure.json`);
    if (existsSync(failure) && JSON.parse(readFileSync(failure)).message.startsWith('HEAVY_SLOTS_OCCUPIED')) { console.log(`SEC-2 batch ${batch}: waiting two minutes for a heavy slot`); await new Promise(r => setTimeout(r, 120000)); batch--; continue; }
    console.error(`SEC-2 batch ${batch} stopped (${code}); completed evidence retained. Resume with run.mjs --batch ${batch}.`); process.exitCode = code; break;
  }
}
if (!process.exitCode && evaluationFailed) process.exitCode = 1;
