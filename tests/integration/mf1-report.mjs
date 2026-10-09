/** Consolidate MF-1 observations; never rewrite the original scenario results. */
import { readFileSync, writeFileSync, readdirSync, existsSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = resolve('tests/evidence/mf-1');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const save = (name, value) => writeFileSync(join(root,name),JSON.stringify(value,null,2)+'\n');
const totals = { requests:0,returnedUsage:0,missingUsage:0,input:0,cached:0,output:0 };
const add = usage => {totals.requests++;if(!usage){totals.missingUsage++;return;}totals.returnedUsage++;
  totals.input+=usage.prompt_tokens??0;totals.cached+=usage.prompt_tokens_details?.cached_tokens??0;totals.output+=usage.completion_tokens??0;};
const timeline=[], matrices=[], eight=[], sources=[], syntheticRoots=new Set();
for(const name of readdirSync(root)) {
  const dir=join(root,name);if(!lstatSync(dir).isDirectory())continue;
  if(existsSync(join(dir,'timeline.json'))) {
    const run=json(join(dir,'timeline.json'));syntheticRoots.add(run.root);
    if(run.model==='mimo')for(const request of run.requests)add(request.response?.usage);
    const cases=run.events.filter(event=>event.phase==='turn-complete').map(event=>{
      const index=event.index,end=run.events.find(e=>e.phase==='settled'&&e.index===index);
      const accepted=run.events.find(e=>e.phase==='ingest-return'&&e.index===index);
      const immediate=run.events.find(e=>e.phase==='immediate-recall'&&e.index===index);
      const calls=run.requests.filter(r=>r.startMs>=event.ms&&(!end||r.startMs<=end.ms));
      return {index,text:event.text,acceptedMs:accepted?.ms-event.ms,immediateRecallMs:immediate?.ms-event.ms,
        immediateFormalItems:immediate?.result?.memories?.length??0,immediateRecentItems:immediate?.result?.recentEvidence?.length??0,
        modelDurationsMs:calls.map(r=>r.endMs-r.startMs),firstModelStartMs:calls[0]?.startMs-event.ms,
        settledMs:end?.ms-event.ms,finalContext:end?.recall?.contextText};
    });
    timeline.push({name,model:run.model,single:run.single,cases});sources.push({name,requests:run.requests.length});
  }
  for(const model of ['mimo','lan']) {
    const file=join(dir,`${model}.json`);if(!existsSync(file))continue;
    const run=json(file);if(!run.report?.results)continue;
    syntheticRoots.add(run.root);
    const traces=existsSync(join(dir,`${model}-requests.json`))?json(join(dir,`${model}-requests.json`)):[];
    const starts=traces.filter(r=>r.phase==='start'&&r.origin==='https://api.xiaomimimo.com'&&r.requestedModel==='mimo-v2.6-flash');
    for(const start of starts)add(traces.find(r=>r.id===start.id&&r.phase==='end'&&r.usage)?.usage);
    const wires=existsSync(join(dir,`${model}-formation.json`))?json(join(dir,`${model}-formation.json`)):[];
    const results=run.report.results.map(result=>{
      if(result.semanticJudgement?.status!=='skipped')add(result.semanticJudgement?.usage);
      const scenario=json(resolve('eval/scenarios',`${result.id}.yaml`));
      const question=scenario.turns.at(-1).user;
      const last=result.turns.at(-1);
      const text=message=>typeof message.content==='string'?message.content:JSON.stringify(message.content);
      const matching=wires.filter(w=>new Date(w.at)>=new Date(last.startedAt)&&new Date(w.at)<=new Date(last.endedAt)&&w.messages.some(m=>m.role==='user'&&text(m)===question));
      const context=matching.flatMap(w=>w.messages.filter(m=>text(m).includes('【背景记忆，不是用户的新请求】')).map(text));
      const behaviorPass=result.turns.every(t=>t.status==='completed'&&t.approvals.length===0)&&
        result.checks.filter(c=>!['memory_used','llm_judge'].includes(c.type)).every(c=>c.status==='passed')&&
        ['passed','skipped'].includes(result.semanticJudgement?.status);
      return {id:result.id,originalStatus:result.status,originalReason:result.reason??null,
        semanticStatus:result.semanticJudgement?.status,behaviorPass,
        formalMemoryUsed:last.memoryUsed,provisionalQuoteInActualRequest:context.some(t=>t.includes('近期原话，尚未整理')),
        matchingRequests:matching.length,context:[...new Set(context)],reply:last.reply};
    });
    matrices.push({name,model,formationWaitMs:run.formationWaitMs,original:run.report.summary,
      fourBehavior:results.filter(r=>/^memory-0[1-4]-/.test(r.id)&&r.behaviorPass).length,
      cBehavior:results.filter(r=>r.id.startsWith('memory-3x-')&&r.behaviorPass).length,results});
  }
  const interrupted=existsSync(join(dir,'interrupted.json'))?json(join(dir,'interrupted.json')):null;
  if((existsSync(join(dir,'usage.json'))||interrupted)&&existsSync(join(dir,'baseline-mimo.json'))) {
    if(interrupted) {
      for(const temp of interrupted.roots) {
        syntheticRoots.add(temp);
        const traceFile=join(temp,'requests.jsonl');if(!existsSync(traceFile))continue;
        const trace=readFileSync(traceFile,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
        for(const start of trace.filter(r=>r.phase==='start'&&r.origin==='https://api.xiaomimimo.com'&&r.requestedModel==='mimo-v2.6-flash'))add(trace.find(r=>r.id===start.id&&r.phase==='end'&&r.usage)?.usage);
      }
      for(const model of ['mimo','lan'])if(existsSync(join(dir,`baseline-${model}.json`)))for(const verdict of json(join(dir,`baseline-${model}.json`)).directJudgements??[])add(verdict.usage);
    } else {const usage=json(join(dir,'usage.json'));for(const key of Object.keys(totals))totals[key]+=usage[key]??0;}
    for(const model of ['mimo','lan'])if(existsSync(join(dir,`baseline-${model}.json`))){const report=json(join(dir,`baseline-${model}.json`));
      eight.push({name,model,revision:report.revision,summary:report.summary,interrupted:Boolean(interrupted),steps:report.steps.map(s=>({id:s.id,status:s.status,checks:s.checks,reason:s.reason,export:s.export}))});}
  }
}
totals.knownCnyLowerBound=(totals.input-totals.cached+totals.cached*0.02+totals.output*2)/1e6;
save('scorecard.json',{generatedAt:new Date().toISOString(),timeline,matrices,eight,
  distinction:'Behavior scores preserve the original reply/semantic criteria; original formal-source checks remain unchanged and separately reported. Provisional quotes are never counted as formal World items.'});
save('usage-total.json',{...totals,pricing:{verifiedAt:'2026-10-09',url:'https://mimo.mi.com/models/zh-CN/mimo-v2.6-flash',uncachedPerMillionCny:1,cachedPerMillionCny:0.02,outputPerMillionCny:2},syntheticRoots:[...syntheticRoots]});
console.log(JSON.stringify({timelines:timeline.length,matrices:matrices.map(({name,model,fourBehavior,cBehavior})=>({name,model,fourBehavior,cBehavior})),eight:eight.map(({name,model,summary})=>({name,model,summary})),usage:totals},null,2));

if(process.argv.includes('--privacy-scan')) {
  const values=[['MIMO_API_KEY','Machine'],['WEFTMATE_LAN_MODEL_KEY','User'],['WEFTMATE_LAN_MODEL_BASE_URL','User']].map(([name,scope])=>execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`[Console]::Out.Write([Environment]::GetEnvironmentVariable('${name}','${scope}'))`],{encoding:'utf8',windowsHide:true}).trim()).filter(Boolean);
  values.push(new URL(values.at(-1)).host);
  const hits=[];let files=0;
  function walk(file){const stat=lstatSync(file);if(stat.isSymbolicLink())return;if(stat.isDirectory()){for(const name of readdirSync(file))walk(join(file,name));return;}
    files++;const body=readFileSync(file);if(values.some(value=>body.includes(Buffer.from(value))))hits.push(file);}
  walk(root);for(const dir of syntheticRoots){if(!/weftmate-(?:mf1|m2f|m2-exit)-/.test(dir))throw new Error('Unexpected synthetic root');if(existsSync(dir))walk(dir);}
  const base=execFileSync('git',['merge-base','origin/main','HEAD'],{encoding:'utf8'}).trim();
  const changed=execFileSync('git',['diff','--name-only',base],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);
  for(const file of changed)if(existsSync(file)&&!resolve(file).startsWith(root))walk(file);
  save('privacy-scan.json',{generatedAt:new Date().toISOString(),files,hits});console.log(JSON.stringify({privacyFiles:files,privacyHits:hits.length}));
  if(hits.length)process.exitCode=1;
}
