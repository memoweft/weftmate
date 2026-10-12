// Read-only GitHub survey. Cached logs stay local; public evidence contains redacted failure blocks only.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { redactEvidenceText } from '../../tests/helpers/process-evidence.mjs';
const execute = promisify(execFile);
const gh = async args => (await execute('gh', args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, windowsHide: true })).stdout;

export function parseFailures(log, sources = []) {
  const lines = log.split(/\r?\n/).map(line => {
    const parts = line.split('\t');
    return parts.length >= 3 ? { job: parts[0], text: parts.slice(2).join('\t').replace(/^\S+Z /, '') } : { job: '', text: line };
  });
  const failures = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*not ok \d+ - (.+)$/.exec(lines[i].text);
    if (!match) continue;
    const block = [lines[i].text];
    for (let j = i + 1; j < Math.min(lines.length, i + 180); j++) {
      block.push(lines[j].text);
      if (/^\s*\.\.\.$/.test(lines[j].text)) break;
    }
    const diagnostic = block.join('\n');
    if (/type: 'suite'|subtestsFailed/.test(diagnostic)) continue;
    const name = match[1].replace(/ # (SKIP|TODO).*$/, '');
    const file = /(?:tests|apps\/[^\s:]+\/tests)[\\/][^\s:'"]+\.(?:test|integration\.test)\.(?:ts|mjs)/.exec(diagnostic)?.[0]?.replace(/[\\/]+/g, '/')
      || sources.find(source => source.text.includes(name))?.file || /tests[\\/][^\s]+\.test\.(?:ts|mjs)/.exec(name)?.[0]?.replaceAll('\\', '/') || 'unresolved';
    const type = /testTimeoutFailure|ETIMEDOUT|timed out|TimeoutError|timeout of/i.test(diagnostic) ? 'timeout'
      : /0xC000|exitCode:|signal:|SIGABRT|process exited|Aborted|Error: spawn E[A-Z]+/.test(diagnostic) ? 'process-exit' : 'assertion';
    failures.push({ job: lines[i].job, file, name, type, diagnostic: redactEvidenceText(diagnostic) });
  }
  return failures;
}

export async function survey({ workflow = 'ci.yml', limit = 80, destination = 'tests/evidence/ci-1', cache = '.local/ci-1/survey' } = {}) {
  mkdirSync(cache, { recursive: true }); mkdirSync(destination, { recursive: true });
  const cached = async (name, args) => {
    const file = resolve(cache, name);
    if (!existsSync(file)) writeFileSync(file, await gh(args));
    return readFileSync(file, 'utf8');
  };
  const runs = JSON.parse(await cached('runs.json', ['run', 'list', '--workflow', workflow, '--limit', String(limit), '--json', 'databaseId,conclusion,status,createdAt,headSha,headBranch,url,event']));
  const sources = readdirSync('tests').filter(file => /\.test\.(ts|mjs)$/.test(file)).map(file => ({ file: `tests/${file}`, text: readFileSync(`tests/${file}`, 'utf8') }));
  const observations = [], errors = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor < runs.length) {
      const run = runs[cursor++];
      try {
        const { jobs } = JSON.parse(await cached(`${run.databaseId}.json`, ['run', 'view', String(run.databaseId), '--json', 'jobs']));
        let failures = [];
        if (run.status === 'completed' && jobs.some(job => job.conclusion === 'failure')) {
          failures = parseFailures(await cached(`${run.databaseId}.log`, ['run', 'view', String(run.databaseId), '--log-failed']), sources);
        }
        for (const job of jobs) {
          const step = job.steps.find(step => step.name === 'Required unit tests');
          const seconds = (Date.parse(job.completedAt) - Date.parse(job.startedAt)) / 1000;
          const requiredSeconds = step ? (Date.parse(step.completedAt) - Date.parse(step.startedAt)) / 1000 : null;
          const relevant = /windows-latest|ubuntu-latest|Windows package and startup smoke/.test(job.name);
          if (!relevant) continue;
          const cases = failures.filter(item => item.job === job.name);
          if (job.conclusion === 'failure' && !cases.length) {
            if (workflow === 'windows-package.yml') {
              // This smoke writes its error into the sanitized artifact rather than stdout.
              const artifact = resolve(cache, `${run.databaseId}-artifacts`);
              mkdirSync(artifact, {recursive:true});
              if (!existsSync(resolve(artifact, 'results.json'))) await gh(['run','download',String(run.databaseId),'--name','windows-package-smoke','--dir',artifact]);
              const detail = JSON.parse(readFileSync(resolve(artifact,'results.json'),'utf8'));
              const diagnostic = redactEvidenceText(detail.error ?? 'No smoke error recorded');
              cases.push({job:job.name, file:/(?:scripts|tests)[\\/][^\s:]+\.mjs/.exec(diagnostic)?.[0]?.replace(/[\\/]+/g,'/') ?? 'workflow',
                name:diagnostic.split('\n')[0],type:/Timeout|TIMEDOUT/.test(diagnostic)?'timeout':'step-failure',diagnostic});
            } else cases.push({ job: job.name, file: 'workflow', name: job.steps.find(step => step.conclusion === 'failure')?.name || 'unknown step', type: 'step-failure', diagnostic: 'No TAP leaf failure in failed log.' });
          }
          if (job.conclusion === 'cancelled' && seconds > 3600) cases.push({ job: job.name, file: 'workflow', name: 'cancelled after >60 minutes (suspected hang; not proven)', type: 'hang-suspected', diagnostic: `Job ran ${seconds}s before cancellation.` });
          observations.push({ runId: run.databaseId, url: run.url, sha: run.headSha, createdAt: run.createdAt, job: job.name, conclusion: job.conclusion, seconds, requiredSeconds, failures: cases });
        }
        console.log(`Survey ${run.databaseId}: ${run.conclusion}`);
      } catch (error) { errors.push({ runId: run.databaseId, error: redactEvidenceText(error.message).slice(0, 400) }); }
    }
  }));
  observations.sort((a, b) => b.runId - a.runId || a.job.localeCompare(b.job));
  const grouped = new Map();
  for (const item of observations) for (const failure of item.failures) {
    const key = JSON.stringify([failure.job, failure.file, failure.name, failure.type]);
    if (!grouped.has(key)) grouped.set(key, { job: failure.job, file: failure.file, name: failure.name, type: failure.type, count: 0, runIds: [], examples: [] });
    const entry = grouped.get(key);
    if (entry.runIds.includes(item.runId)) continue;
    entry.count++; entry.runIds.push(item.runId);
    if (entry.examples.length < 3) entry.examples.push({ runId: item.runId, diagnostic: failure.diagnostic });
  }
  const table = [...grouped.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const durations = [...new Set(observations.map(item => item.job))].map(job => {
    const successful = observations.filter(item => item.job === job && item.conclusion === 'success');
    const stats = key => { const values = successful.map(item => item[key]).filter(value => value > 0).sort((a,b) => a-b); return { samples: values.length, median: values[Math.floor(values.length / 2)] ?? null, p95: values[Math.min(values.length-1, Math.floor(values.length * .95))] ?? null, max: values.at(-1) ?? null }; };
    return { job, jobSeconds: stats('seconds'), requiredSeconds: stats('requiredSeconds') };
  });
  const result = { generatedAt: new Date().toISOString(), workflow, limit, runs, errors, durations, table, observations };
  writeFileSync(`${destination}/flaky-table.json`, JSON.stringify(result, null, 2) + '\n');
  const cell = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
  writeFileSync(`${destination}/flaky-table.md`, [
    '# CI-1 failure survey', '', `Snapshot: ${result.generatedAt}; ${runs.length} most recent ${workflow} runs (including cancellations and in-progress runs). Read-only gh run list / view --log-failed; counts are distinct runs, not log duplicates.`, '',
    'Historical failures are observations, not proof of flakiness. Cancelled runs without a TAP failure are not counted as assertions. A >60-minute cancellation is a suspected hang only. Non-unit failing steps are listed separately. Logs are cached locally; public diagnostic excerpts are redacted.', '',
    '| Check | Successful samples | Job median / p95 / max (s) | Required median / p95 / max (s) |', '|---|---:|---|---|',
    ...durations.map(item => `| ${cell(item.job)} | ${item.jobSeconds.samples} | ${item.jobSeconds.median} / ${item.jobSeconds.p95} / ${item.jobSeconds.max} | ${item.requiredSeconds.median} / ${item.requiredSeconds.p95} / ${item.requiredSeconds.max} |`), '',
    '| Check | File | Failed test / step | Type | Runs | Run IDs |', '|---|---|---|---|---:|---|',
    ...table.map(item => `| ${cell(item.job)} | ${cell(item.file)} | ${cell(item.name)} | ${item.type} | ${item.count} | ${item.runIds.join(', ')} |`), '',
    `Retrieval errors: ${errors.length}. Full metadata, diagnostic examples and run URLs: flaky-table.json.`, '',
  ].join('\n'));
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await survey();
  console.log(JSON.stringify({ runs: result.runs.length, errors: result.errors, durations: result.durations, table: result.table.map(({ examples, ...row }) => row) }, null, 2));
}
