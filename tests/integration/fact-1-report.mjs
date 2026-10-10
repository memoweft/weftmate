import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
const root=resolve('tests/evidence/fact-1');
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const median=values=>{const sorted=[...values].sort((a,b)=>a-b),n=sorted.length;return n?(sorted[Math.floor(n/2)]+sorted[Math.floor((n-1)/2)])/2:null;};
const files=directory=>readdirSync(directory,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(directory,e.name)):[join(directory,e.name)]);
const all=files(root), rows=[];
const overrides=existsSync(join(root,'adjudication.json'))?read(join(root,'adjudication.json')).overrides:[];
for(const [phase,directories] of [['before',['before/mimo']],['after',['inline/mimo-node','inline/mimo-languages','inline/mimo-web']]]) {
  for(const directory of directories) {
    const path=join(root,directory,'results.json');if(!existsSync(path))continue;
    const scores=existsSync(join(root,directory,'scores.json'))?read(join(root,directory,'scores.json')).judgements:[];
    for(const result of read(path).results) {
      const score=scores.findLast(s=>s.id===`${result.topicId}-${result.repeat}`&&!s.judgement?.parseError);
      const j=score?.judgement,scorable=Boolean(result.document&&j);
      const correction=overrides.find(o=>o.phase===phase&&o.id===`${result.topicId}-${result.repeat}`&&o.documentSha256===score?.documentSha256);
      rows.push({phase,topic:result.topicId,repeat:result.repeat,taskStatus:result.status,documentPresent:!!result.document,
        completed:result.turns?.at(-1)?.status==='completed',seconds:result.durationMs/1000,
        unsupported:scorable?j.unsupported.length:null,scope:scorable?j.scope.length:null,number:scorable?j.number.length:null,
        inappropriateUncertainty:scorable?j.uncertainty.issues.length:null,missing:scorable?j.missing.length:null,
        citations:scorable?j.citations:null,evidence:directory,...(scorable&&correction?{...correction.counts,adjudication:correction.reason}:{})});
    }
  }
}
const summary=Object.fromEntries(['before','after'].map(phase=>{
  const values=rows.filter(r=>r.phase===phase),scored=values.filter(r=>r.scope!==null),delivered=values.filter(r=>r.completed&&r.documentPresent);
  return [phase,{runs:values.length,delivered:delivered.length,scored:scored.length,
    ...Object.fromEntries(['unsupported','scope','number','inappropriateUncertainty','missing'].map(key=>[key,scored.reduce((sum,r)=>sum+r[key],0)])),
    deliveredMedianSeconds:median(delivered.map(r=>r.seconds)),maxSeconds:values.length?Math.max(...values.map(r=>r.seconds)):null}];
}));
const paired=rows.filter(r=>r.phase==='before'&&r.scope!==null).flatMap(before=>{
  const after=rows.find(r=>r.phase==='after'&&r.topic===before.topic&&r.repeat===before.repeat&&r.scope!==null);
  return after?[{topic:before.topic,repeat:before.repeat,before,after}]:[];
});
const pairedSummary={pairs:paired.length,...Object.fromEntries(['before','after'].map(phase=>[phase,
  Object.fromEntries(['unsupported','scope','number','inappropriateUncertainty'].map(key=>[key,paired.reduce((sum,p)=>sum+p[phase][key],0)]))]))};
const usage={upstreamRequests:0,knownUsage:0,missingUsage:0,input:0,cachedInput:0,output:0,judgeRequests:0,judgeInput:0,judgeOutput:0};
for(const path of all.filter(p=>p.endsWith('requests.jsonl'))) {
  const requests=new Map();for(const line of readFileSync(path,'utf8').trim().split('\n').filter(Boolean)) {
    const r=JSON.parse(line);if(r.kind!=='model'||r.origin!=='https://api.xiaomimimo.com')continue;
    requests.set(r.id,{...requests.get(r.id),...r});
  }
  for(const r of requests.values()) {usage.upstreamRequests++;if(!r.usage){usage.missingUsage++;continue;}
    usage.knownUsage++;usage.input+=r.usage.prompt_tokens||0;usage.output+=r.usage.completion_tokens||0;
    usage.cachedInput+=r.usage.prompt_tokens_details?.cached_tokens||r.usage.prompt_cache_hit_tokens||0;}
}
for(const path of all.filter(p=>p.endsWith('scores.json')))for(const r of read(path).judgements||[]) {
  if(!r.usage)continue;usage.judgeRequests++;usage.judgeInput+=r.usage.prompt_tokens||0;usage.judgeOutput+=r.usage.completion_tokens||0;
}
usage.totalKnownInput=usage.input+usage.judgeInput;usage.totalKnownOutput=usage.output+usage.judgeOutput;
writeFileSync(join(root,'summary.json'),JSON.stringify({generatedAt:new Date().toISOString(),rows,summary,pairedSummary,usage,
  scoring:'MiMo rubric judge; manually reviewed exceptions in adjudication.json take precedence. Missing documents and failed judges are unknown, not zero.'},null,2));
const cells=r=>[r.unsupported,r.scope,r.number,r.inappropriateUncertainty].map(x=>x??'—').join(' / ');
const lines=['# FACT-1 改前／改后对比','','错误列顺序：无依据断言／范围／数字／不恰当未确认。未交付或尚未评分以「—」表示，不能当作零错误。','','| 主题 | 次数 | 改前错误 | 改后错误 | 改前秒 | 改后秒 | 交付 |','|---|---:|---|---|---:|---:|---|'];
for(const topic of read('tests/fixtures/fact-1/topics.json').topics)for(const repeat of [1,2]) {
  const b=rows.find(r=>r.phase==='before'&&r.topic===topic.id&&r.repeat===repeat),a=rows.find(r=>r.phase==='after'&&r.topic===topic.id&&r.repeat===repeat);
  lines.push(`| ${topic.title} | ${repeat} | ${b?cells(b):'—'} | ${a?cells(a):'—'} | ${b?.seconds.toFixed(3)??'—'} | ${a?.seconds.toFixed(3)??'—'} | ${b?.documentPresent?'有稿':'未交付'} → ${a?.documentPresent?'有稿':'未交付'} |`);
}
writeFileSync(join(root,'comparison.md'),lines.join('\n')+'\n');console.log(JSON.stringify({summary,usage}));
