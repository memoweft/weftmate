import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,relative} from 'node:path';
const root='tests/evidence/fx-16',requests=new Map(),groups=[];
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?walk(join(dir,d.name)):[join(dir,d.name)]);}
function add(id,u,source){requests.set(id,{usage:u||requests.get(id)?.usage,source});}
for(const file of walk(root).filter(f=>f.endsWith('requests.jsonl')&&!f.endsWith('memory-requests.jsonl'))){
 const rows=readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).filter(r=>r.kind==='model'&&r.origin==='https://api.xiaomimimo.com');
 const map=new Map();for(const r of rows){const prior=map.get(r.id)||{};map.set(r.id,{...prior,...r,firstAt:prior.firstAt||r.at,usage:r.usage||prior.usage});}
 for(const [id,row] of map)add(id+'|'+row.firstAt,row.usage,relative(root,file));groups.push({source:relative(root,file),requests:map.size});
}
for(const file of walk(root).filter(f=>f.endsWith('results.json'))){let r;try{r=JSON.parse(readFileSync(file));}catch{continue;}if(r.model!=='mimo'||!Array.isArray(r.requests))continue;for(const q of r.requests)add('daily|'+r.startedAt+'|'+q.id,q.usage,relative(root,file));groups.push({source:relative(root,file),requests:r.requests.length});}
const total={requests:requests.size,returnedUsage:0,missingUsage:0,inputTokens:0,cachedInputTokens:0,outputTokens:0};for(const {usage:u}of requests.values()){if(!u){total.missingUsage++;continue;}total.returnedUsage++;total.inputTokens+=u.prompt_tokens||0;total.cachedInputTokens+=u.prompt_tokens_details?.cached_tokens||0;total.outputTokens+=u.completion_tokens||0;}
writeFileSync(root+'/usage.json',JSON.stringify({total,groups,method:'Actual MiMo upstream responses, deduplicated provider trace; daily single-slot proxy counted from direct upstream request records. Includes failed attempts, excludes synthetic/LAN. Missing usage is not zero usage. No price or bill inferred.'},null,2));console.log(JSON.stringify(total));
