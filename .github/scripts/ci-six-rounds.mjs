// Explicit acceptance driver: seven existing workflows, one immutable SHA,
// six sequential rounds. No automatic workflow/job reruns or test exceptions.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdirSync,readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {redactEvidenceText} from '../../tests/helpers/process-evidence.mjs';
const execute=promisify(execFile),gh=async args=>(await execute('gh',args,{encoding:'utf8',windowsHide:true,maxBuffer:128*1024*1024})).stdout;
const branch=process.argv[2]||'wp/ci-3-steady-checks',destination='tests/evidence/ci-3/cloud',cache='.local/ci-3/cloud';
const workflows=['ci.yml','review-gallery.yml','windows-package.yml','s1c-web.yml','relay.yml','host-certs.yml','vendor-tests.yml'];
mkdirSync(destination,{recursive:true});mkdirSync(cache,{recursive:true});
const repo=(await gh(['repo','view','--json','nameWithOwner','--jq','.nameWithOwner'])).trim();
const sha=JSON.parse(await gh(['api',`repos/${repo}/commits/${branch}`])).sha;
const rounds=[];
const save=()=>{
  writeFileSync(join(destination,'six-rounds.json'),JSON.stringify({branch,sha,rounds},null,2)+'\n');
  writeFileSync(join(destination,'six-rounds.md'),[
    '# CI-3 六轮同提交全工作流验收','',`分支 ${branch}；固定提交 ${sha}。轮与轮之间不改代码；自动工作流重跑 0。所有历史尝试和清单内恢复保留。`,'',
    '| 轮次 | 工作流 | 结论 | workflow attempt（工作流尝试） | 清单内重跑才过 |', '|---|---|---|---:|---|',
    ...rounds.flatMap(r=>r.runs.map(run=>`| ${r.round} | [${run.workflow}](${run.url}) | ${run.conclusion} | ${run.run_attempt} | ${run.recovered.map(x=>x.names.join('; ')).join('<br>')||'0'} |`)),'',
    '| 轮次 | 工作流 | 检查 | 结论 | 秒 |','|---|---|---|---|---:|',
    ...rounds.flatMap(r=>r.runs.flatMap(run=>run.jobs.map(j=>`| ${r.round} | ${run.workflow} | ${j.name} | ${j.conclusion} | ${j.seconds} |`))),''
  ].join('\n'));
};
for(let round=1;round<=6;round++){
  const recordFile=join(destination,`round-${round}.json`);
  if(existsSync(recordFile)){const previous=JSON.parse(readFileSync(recordFile,'utf8'));if(previous.sha!==sha)throw Error('Acceptance SHA changed');rounds.push(previous);save();continue;}
  const indexFile=join(cache,`round-${round}-index.json`);
  let index;
  if(existsSync(indexFile))index=JSON.parse(readFileSync(indexFile,'utf8'));
  else{
    const start=new Date(Date.now()-1000).toISOString();index=[];
    for(const workflow of workflows){
      await gh(['workflow','run',workflow,'--ref',branch]);
      let run;
      while(!run){
        run=JSON.parse(await gh(['run','list','--workflow',workflow,'--branch',branch,'--event','workflow_dispatch','--limit','20','--json','databaseId,createdAt,headSha,url'])).find(r=>r.headSha===sha&&r.createdAt>=start);
        if(!run)await pause(30000);
      }
      index.push({...run,workflow});writeFileSync(indexFile,JSON.stringify(index,null,2));
    }
  }
  if(index.length!==workflows.length)throw Error('Incomplete dispatch index; inspect before resuming');
  let states;
  do{
    states=await Promise.all(index.map(async run=>({...run,...JSON.parse(await gh(['run','view',String(run.databaseId),'--json','status,conclusion,jobs,headSha']))})));
    if(states.some(r=>r.headSha!==sha))throw Error('A workflow used a different acceptance SHA');
    console.log(new Date().toISOString(),`Round ${round}:`,states.map(r=>`${r.workflow}=${r.status}/${r.conclusion}`).join(' '));
    if(states.some(r=>r.status!=='completed'))await pause(30000);
  }while(states.some(r=>r.status!=='completed'));
  const runs=[];
  for(const run of states){
    const metadata=JSON.parse(await gh(['api',`repos/${repo}/actions/runs/${run.databaseId}`]));
    let reports=[];
    if(run.workflow==='ci.yml'){
      const dir=resolve(cache,`round-${round}-unit`);mkdirSync(dir,{recursive:true});
      try{await gh(['run','download',String(run.databaseId),'--pattern','unit-*','--dir',dir]);
        reports=readdirSync(dir,{recursive:true}).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(readFileSync(join(dir,f),'utf8')));
      }catch(error){writeFileSync(join(dir,'retrieval-error.txt'),redactEvidenceText(error.message));}
    }
    const attempts=[];
    for(let attempt=1;attempt<=metadata.run_attempt;attempt++){
      const jobs=JSON.parse(await gh(['run','view',String(run.databaseId),'--attempt',String(attempt),'--json','jobs'])).jobs;
      attempts.push({attempt,jobs:jobs.map(j=>({name:j.name,conclusion:j.conclusion}))});
      if(jobs.some(j=>j.conclusion==='failure')){
        const log=await gh(['run','view',String(run.databaseId),'--attempt',String(attempt),'--log-failed']);
        writeFileSync(join(cache,`round-${round}-${run.workflow}-attempt-${attempt}.log`),log);
      }
    }
    runs.push({workflow:run.workflow,id:run.databaseId,url:run.url,sha:run.headSha,conclusion:run.conclusion,run_attempt:metadata.run_attempt,attempts,
      recovered:reports.flatMap(r=>(r.recovered??[]).map(row=>({os:r.os,...row}))),reports,
      jobs:run.jobs.map(j=>({name:j.name,conclusion:j.conclusion,seconds:(Date.parse(j.completedAt)-Date.parse(j.startedAt))/1000}))});
  }
  const row={round,sha,completedAt:new Date().toISOString(),runs};
  writeFileSync(recordFile,redactEvidenceText(JSON.stringify(row,null,2))+'\n');rounds.push(row);save();
}
console.log(JSON.stringify({sha,rounds:rounds.length,allGreen:rounds.every(r=>r.runs.every(run=>run.conclusion==='success')),recovered:rounds.flatMap(r=>r.runs.flatMap(run=>run.recovered))}));
