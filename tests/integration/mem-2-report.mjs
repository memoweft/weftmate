import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
const evidence=resolve('tests/evidence/mem-2');
const roots=readdirSync(tmpdir()).filter(name=>name.startsWith('weftmate-mem2-real-')).map(name=>join(tmpdir(),name));
const report={requests:0,knownUsage:0,unknownUsage:0,inputTokens:0,cachedInputTokens:0,outputTokens:0,hostRecordedCost:0,runs:[]};
for(const root of roots){
 const file=join(root,'requests.jsonl');if(!existsSync(file))continue;
 const rows=readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
 const starts=rows.filter(r=>r.kind==='model'&&r.phase==='start'&&r.origin==='https://api.xiaomimimo.com');
 const usage=starts.map(start=>rows.find(row=>row.id===start.id&&row.phase==='end')?.usage);
 const tokens={inputTokens:0,cachedInputTokens:0,outputTokens:0};let known=0;
 for(const u of usage){if(!u)continue;known++;tokens.inputTokens+=u.prompt_tokens??0;tokens.cachedInputTokens+=u.prompt_tokens_details?.cached_tokens??0;tokens.outputTokens+=u.completion_tokens??0;}
 const ledgerFile=join(root,'profile/personal-access/usage.json');
 const ledger=existsSync(ledgerFile)?JSON.parse(readFileSync(ledgerFile,'utf8')):{accounts:{}};
 const cost=Object.values(ledger.accounts).flatMap(a=>a.records).reduce((sum,r)=>sum+(r.cost??0),0);
 report.runs.push({run:root.split(/[\\/]/).at(-1),requests:starts.length,knownUsage:known,unknownUsage:starts.length-known,...tokens,hostRecordedCost:cost});
 report.requests+=starts.length;report.knownUsage+=known;report.unknownUsage+=starts.length-known;report.hostRecordedCost+=cost;
 for(const k of Object.keys(tokens))report[k]+=tokens[k];
}
writeFileSync(join(evidence,'usage-total.json'),JSON.stringify({...report,costBasis:'Existing host price configuration, known recorded costs only; not a supplier invoice. Missing usage is not zero.'},null,2)+'\n');
const key=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"[Console]::Out.Write([Environment]::GetEnvironmentVariable('MIMO_API_KEY','Machine'))"],{encoding:'utf8',windowsHide:true}).trim();
if(!key)throw Error('credential scan requires environment key');
let files=0;const hits=[];
function scan(dir){for(const e of readdirSync(dir,{withFileTypes:true})){const file=join(dir,e.name);if(e.isDirectory())scan(file);else if(e.isFile()){files++;const bytes=readFileSync(file);if(bytes.includes(Buffer.from(key))||bytes.includes(Buffer.from(key,'utf16le')))hits.push(file.slice(evidence.length+1));}}}
scan(evidence);writeFileSync(join(evidence,'privacy-scan.json'),JSON.stringify({files,actualProviderCredentialHits:hits},null,2)+'\n');
if(hits.length)throw Error('private credential in public evidence');
console.log(JSON.stringify({...report,runs:report.runs.length,publicFiles:files}));
