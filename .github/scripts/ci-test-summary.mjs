import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { recoveredSummary, requiredShardPlan } from './ci-test-policy.mjs';

export function requireLatestShardJobs(jobs, { oses } = {}) {
  const expected = requiredShardPlan({ oses }).map(({ os, shard }) => `test (${os}, shard ${shard})`);
  const latest = new Map();
  for (const job of jobs) {
    if (!expected.includes(job.name)) continue;
    const previous = latest.get(job.name);
    if (!previous || job.run_attempt > previous.run_attempt || job.run_attempt === previous.run_attempt && job.id > previous.id)
      latest.set(job.name, job);
  }
  for (const name of expected) {
    const job = latest.get(name);
    if (job?.status !== 'completed' || job.conclusion !== 'success')
      throw Error(`Latest shard job did not succeed: ${name}; attempt ${job?.run_attempt ?? 'missing'}; ${job?.conclusion ?? job?.status ?? 'missing'}`);
  }
  return [...latest.values()];
}

export function aggregateReports(reports, { oses } = {}) {
  const expected = requiredShardPlan({ oses }).map(({ os, shard }) => `${os}:${shard}`);
  const keys = reports.map(report => `${report.os}:${report.shard}`);
  if (new Set(keys).size !== keys.length || expected.some(key => !keys.includes(key)) || keys.some(key => !expected.includes(key))) throw Error(`Missing, duplicate or unexpected shard report: expected ${expected}; received ${keys}`);
  const counts = reports.reduce((total, row) => ({ passed: total.passed + row.passed, failed: total.failed + row.failed, skipped: total.skipped + row.skipped }), { passed: 0, failed: 0, skipped: 0 });
  return { ...counts, exitCode: reports.some(row => row.exitCode !== 0 || row.failed > 0) ? 1 : 0,
    recovered: reports.flatMap(row => row.recovered ?? []) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = process.argv[2];
  const reports = readdirSync(directory, { recursive: true }).filter(file => file.endsWith('.json')).map(file => JSON.parse(readFileSync(join(directory, file), 'utf8')));
  const total = aggregateReports(reports, { oses: process.env.GITHUB_EVENT_NAME === 'pull_request' ? ['ubuntu-latest'] : undefined });
  const text = `### Required unit tests — all shards\nRequired gate exit status: **${total.exitCode}**. Passed: ${total.passed}; failed: ${total.failed}; skipped: ${total.skipped}.\n\n| Check | Passed | Failed | Skipped |\n|---|---:|---:|---:|\n${reports.map(row => `| ${row.os} ${row.shard} | ${row.passed} | ${row.failed} | ${row.skipped} |`).join('\n')}\n${recoveredSummary(total.recovered)}`;
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  process.exitCode = total.exitCode;
}
