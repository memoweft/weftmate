import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,relative} from 'node:path';
const root='tests/evidence/qa-3',groups=[],requests=new Map();
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?walk(join(dir,d.name)):[join(dir,d.name)]);}
for(const file of walk(root).filter(p=>p.endsWith('requests.jsonl')&&!p.endsWith('memory-requests.jsonl'))){
 const rows=readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).filter(r=>r.kind==='model'&&r.origin==='https://api.xiaomimimo.com');
 const map=new Map();for(const row of rows){const prior=map.get(row.id)||{};map.set(row.id,{...prior,...row,firstAt:prior.firstAt||row.at,usage:row.usage||prior.usage});}
 for(const [id,row] of map)requests.set(id+'|'+row.firstAt,row);
 groups.push({source:relative(root,file).replaceAll('\\','/'),requests:map.size});
}
const total={requests:requests.size,returnedUsage:0,missingUsage:0,input:0,cached:0,output:0};
function add(u){total.returnedUsage++;total.input+=u.prompt_tokens||0;total.cached+=u.prompt_tokens_details?.cached_tokens||0;total.output+=u.completion_tokens||0;}
for(const row of requests.values())row.usage?add(row.usage):total.missingUsage++;
// IA identity has a separate in-memory provider trace, not a requests.jsonl duplicate.
const ia=JSON.parse(readFileSync(root+'/ia-2a/identity-native.json'));for(const u of ia.usage){total.requests++;add(u);}groups.push({source:'ia-2a/identity-native.json',requests:ia.usage.length});
for(const platform of ['web','android']){
 const report=JSON.parse(readFileSync(root+`/offline/verification-${platform}.json`));
 for(const entry of report.usage){if(entry.usage){total.requests++;add(entry.usage);}else if(entry.total){const u=entry.total;total.requests+=u.requests;total.returnedUsage+=u.requests-u.unknownRequests;total.missingUsage+=u.unknownRequests;total.input+=u.inputTokens;total.cached+=u.cachedInputTokens;total.output+=u.outputTokens;}}
 groups.push({source:`offline/verification-${platform}.json`,method:'direct phone usage plus separate host account aggregate; unavailable probe usage not invented'});
}
total.knownCnyLowerBound=(total.input-total.cached+total.cached*.02+total.output*2)/1e6;
writeFileSync(root+'/usage.json',JSON.stringify({checkedPriceUrl:'https://mimo.mi.com/models/zh-CN/mimo-v2.6-flash',priceCnyPerMillion:{uncachedInput:1,cachedInput:.02,output:2},total,groups,limitations:['Known lower bound, not a bill. Early Android/cloud harness failures did not retain complete provider traces; their unknown usage is not free.','Missing response usage includes cancellation/timeouts. No extra model inference for installed/backup tests.']},null,2));console.log(JSON.stringify(total));
