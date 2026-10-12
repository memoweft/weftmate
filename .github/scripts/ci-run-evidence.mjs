// Read-only capture for acceptance runs. No log or artifact contents are executed.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { redactEvidenceText } from '../../tests/helpers/process-evidence.mjs';
const execute = promisify(execFile);
const gh = async args => (await execute('gh', args, {encoding:'utf8',windowsHide:true,maxBuffer:128*1024*1024})).stdout;

export async function captureRun(id, label, directory = 'tests/evidence/ci-1/cloud') {
  const run = JSON.parse(await gh(['run','view',String(id),'--json','databaseId,headSha,status,conclusion,event,url,jobs']));
  if(run.status!=='completed')throw Error('Capture only a completed run');
  const cache=resolve('.local/ci-1/cloud-artifacts',String(id));mkdirSync(cache,{recursive:true});
  if(!readdirSync(cache).length) await gh(['run','download',String(id),'--pattern','unit-*','--dir',cache]);
  const reports=readdirSync(cache,{recursive:true}).filter(file=>file.endsWith('.json')).map(file=>JSON.parse(readFileSync(join(cache,file),'utf8')));
  const jobs=run.jobs.map(job=>({name:job.name,conclusion:job.conclusion,startedAt:job.startedAt,completedAt:job.completedAt,
    seconds:(Date.parse(job.completedAt)-Date.parse(job.startedAt))/1000,
    steps:job.steps.map(step=>({name:step.name,conclusion:step.conclusion,seconds:(Date.parse(step.completedAt)-Date.parse(step.startedAt))/1000}))}));
  const windows=jobs.filter(job=>job.name.includes('windows-latest'));
  const evidence={label,id:run.databaseId,url:run.url,sha:run.headSha,event:run.event,conclusion:run.conclusion,
    windowsMaxJobSeconds:Math.max(...windows.map(job=>job.seconds)),
    windowsSpanSeconds:(Math.max(...windows.map(job=>Date.parse(job.completedAt)))-Math.min(...windows.map(job=>Date.parse(job.startedAt))))/1000,
    jobs,reports};
  mkdirSync(directory,{recursive:true});
  writeFileSync(join(directory,`${label}.json`),redactEvidenceText(JSON.stringify(evidence,null,2))+'\n');
  const rounds=readdirSync(directory).filter(file=>/^round-\d+\.json$/.test(file)).sort().map(file=>JSON.parse(readFileSync(join(directory,file),'utf8')));
  if(rounds.length)writeFileSync(join(directory,'six-rounds.md'),[
    '# CI-1 unchanged-code acceptance runs','',
    'Job seconds include setup/cleanup. Windows span is first Windows job start to last completion, including any staggered runner availability. Max-job seconds is the longest individual Windows shard. No per-file counts are double-counted on retry; attempts remain in the JSON.','',
    '| Round | SHA | Overall | Windows 1/2/3 (s) | Windows max / span (s) | Retry recoveries |',
    '|---|---|---|---|---|---|',
    ...rounds.map(row=>`| [${row.label}](${row.url}) | ${row.sha.slice(0,8)} | ${row.conclusion} | ${[1,2,3].map(s=>row.jobs.find(j=>j.name===`test (windows-latest, shard ${s}/3)`)?.seconds??'missing').join(' / ')} | ${row.windowsMaxJobSeconds} / ${row.windowsSpanSeconds} | ${row.reports.flatMap(r=>(r.recovered??[]).map(recovered=>`${r.os}: ${recovered.names.join('; ')}`)).join('<br>')||'0'} |`), '',
    '| Round | Check | Conclusion | Passed / failed / skipped |', '|---|---|---|---|',
    ...rounds.flatMap(row=>row.jobs.map(job=>`| ${row.label} | ${job.name} | ${job.conclusion} | ${(()=>{const report=row.reports.find(r=>job.name===`test (${r.os}, shard ${r.shard})`);return report?`${report.passed} / ${report.failed} / ${report.skipped}`:'—';})()} |`)), '',
  ].join('\n'));
  console.log(JSON.stringify({label,id:run.databaseId,conclusion:run.conclusion,windowsMaxJobSeconds:evidence.windowsMaxJobSeconds,windowsSpanSeconds:evidence.windowsSpanSeconds,recovered:reports.flatMap(report=>report.recovered??[])}));
  return evidence;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await captureRun(process.argv[2],process.argv[3]);
