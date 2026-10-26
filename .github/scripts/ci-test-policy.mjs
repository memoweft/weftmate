import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
let ts;

export const REQUIRED_SHARD_SEED = 'required-v5190';
export const WINDOWS_REQUIRED_SHARD_SEED = 'required-windows-v10760';
export const REQUIRED_SHARD_COUNTS = Object.freeze({ 'ubuntu-latest': 3, 'windows-latest': 5 });
// Pull requests run the Linux shards; pushes to main run every OS.
export function requiredShardPlan({ oses = Object.keys(REQUIRED_SHARD_COUNTS) } = {}) {
  return Object.entries(REQUIRED_SHARD_COUNTS).filter(([os]) => oses.includes(os))
    .flatMap(([os, count]) => Array.from({ length: count }, (_, i) => ({ os, shard: `${i + 1}/${count}` })));
}
export function shardForFile(file, count, seed = REQUIRED_SHARD_SEED) {
  if (!Number.isInteger(count) || count < 1) throw Error('Shard count must be a positive integer');
  // Fixed seed measured against CI-1's first complete cloud file reports; new files never move existing files.
  return createHash('sha256').update(seed + '\n' + file.replaceAll('\\', '/')).digest().readUInt32BE(0) % count;
}
export function selectShard(files, value, seed = REQUIRED_SHARD_SEED) {
  if (!value) return files;
  const match = /^(\d+)\/(\d+)$/.exec(value);
  const index = Number(match?.[1]), count = Number(match?.[2]);
  if (!match || index < 1 || index > count || count < 1) throw Error('Use --shard <1-based index>/<count>');
  return files.filter(file => shardForFile(file, count, seed) === index - 1);
}
export function selectRequiredShard(files, value, platform = process.platform) {
  return selectShard(files, value, platform === 'win32' ? WINDOWS_REQUIRED_SHARD_SEED : REQUIRED_SHARD_SEED);
}
export function declaredTests(source, file = 'test.ts') {
  ts ??= createRequire(import.meta.url)('typescript');
  const names = new Set();
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const visit = node => {
    if (ts.isCallExpression(node) && /^(?:test|it)(?:\.(?:only|skip|todo))?$/.test(node.expression.getText(tree))) {
      const name = node.arguments[0];
      if (name && (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name))) names.add(name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree); return names;
}
export function validateTimingTests(entries, read = file => readFileSync(file, 'utf8')) {
  if (!Array.isArray(entries)) throw Error('Timing manifest tests must be an array');
  const seen = new Set();
  for (const entry of entries) {
    const key = `${entry.file}\n${entry.name}`;
    if (!entry.reason || !Number.isInteger(entry.failureCount) || entry.failureCount < 1 || seen.has(key)) throw Error(`Invalid timing entry: ${key}`);
    seen.add(key);
    if (!declaredTests(read(entry.file), entry.file).has(entry.name)) throw Error(`Timing test does not exist: ${entry.file} / ${entry.name}`);
  }
}
export function parseTap(output) {
  const count = name => Number([...output.matchAll(new RegExp(`^# ${name} (\\d+)$`, 'gm'))].at(-1)?.[1] || 0);
  const failures = [...output.matchAll(/^\s*not ok \d+ - ([^\r\n]+)\r?\n([\s\S]*?)^\s*\.\.\.$/gm)]
    .filter(match => /^\s*type: 'test'\s*$/m.test(match[2]) && !/failureType: 'subtestsFailed'/.test(match[2]))
    .map(match => match[1]);
  return { passed: count('pass'), failed: count('fail'), skipped: count('skipped'), cancelled: count('cancelled'), failures };
}
export function canRetryFile(file, attempt, entries, { ci, mode, event, strict } = {}) {
  return ci === 'true' && mode === 'required' && event !== 'schedule' && strict !== 'true'
    && attempt.status !== 0 && !attempt.error && !attempt.signal && !attempt.timedOut && !attempt.cancelled
    && attempt.failed > 0 && attempt.failures.length === attempt.failed
    && attempt.failures.every(name => entries.some(entry => entry.file === file && entry.name === name));
}
export async function runFileGate(files, { execute, entries, policy, onRecovered = () => {} }) {
  const results = [], recovered = [];
  for (const file of files) {
    const first = await execute(file, 1);
    let final = first, attempts = [first];
    if (canRetryFile(file, first, entries, policy)) {
      final = await execute(file, 2); attempts.push(final);
      if (final.status === 0 && !final.failed && !final.cancelled && !final.error && !final.timedOut) {
        const row = { file, names: first.failures };
        recovered.push(row); onRecovered(row);
      }
    }
    results.push({ file, attempts, ...final });
  }
  return { results, recovered,
    exitCode: results.some(row => row.status !== 0 || row.failed || row.cancelled || row.error || row.timedOut) ? 1 : 0,
    passed: results.reduce((n,row) => n + row.passed, 0),
    failed: results.reduce((n,row) => n + row.failed + row.cancelled + (row.status !== 0 && !row.failed && !row.cancelled ? 1 : 0), 0),
    skipped: results.reduce((n,row) => n + row.skipped, 0),
    failures: results.filter(row => row.status !== 0 || row.failed || row.cancelled).flatMap(row => row.failures.length ? row.failures : [`${row.file}: file process failed`]),
  };
}
export function recoveredSummary(rows) {
  return rows.length ? `\n### ⚠️ 本次重跑才通过的用例 / Passed only on retry\n${rows.flatMap(row => row.names.map(name => `- \`${row.file}\` — ${name}`)).join('\n')}\n`
    : '\nTiming-sensitive retry recoveries: **0**.\n';
}
