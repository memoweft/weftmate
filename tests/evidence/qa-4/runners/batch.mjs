import {spawn} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,openSync,closeSync} from 'node:fs';
import {resolve} from 'node:path';
const out=resolve('tests/evidence/qa-4');mkdirSync(out+'/logs',{recursive:true});
const report={startedAt:new Date().toISOString(),batches:[]};
const save=()=>writeFileSync(out+'/batches.json',JSON.stringify(report,null,2));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
console.log('Waiting for the first independent 30 desktop rounds.');
while(true){let r;try{r=JSON.parse(readFileSync(out+'/desktop/results.json','utf8'));}catch{}if(r?.checks?.length>=30)break;await pause(10000);}
async function run(name,args,env={}){const row={name,startedAt:new Date().toISOString(),args};report.batches.push(row);save();console.log('START',name);const fd=openSync(out+'/logs/'+name+'.log','w');const child=spawn(process.execPath,args,{cwd:resolve('.'),env:{...process.env,...env},stdio:['ignore',fd,fd],windowsHide:true});row.pid=child.pid;save();row.exitCode=await new Promise(r=>child.on('exit',r));closeSync(fd);row.finishedAt=new Date().toISOString();save();console.log('END',name,row.exitCode);}
await run('daily-synthetic',['tests/evidence/qa-4/runners/daily.mjs','--faults','--restart','--slow-switch','--verify','--groups','7','--turns','6','--out','tests/evidence/qa-4/daily-synthetic']);
await run('daily-mimo',['tests/evidence/qa-4/runners/daily.mjs','--model','mimo','--faults','--restart','--verify','--groups','3','--turns','5','--out','tests/evidence/qa-4/daily-mimo']);
await run('backfill',['tests/evidence/qa-4/runners/daily.mjs','--backfill','--verify','--groups','3','--turns','2','--out','tests/evidence/qa-4/backfill']);
await run('wang-eight',['tests/integration/m2-exit-desktop.mjs','--model','mimo','--eight-only','--recall-trace','--memory-core-source','C:/Temp/weftmate-mem-d-core/py/src','--lock-owner','QA-4','--out','tests/evidence/qa-4/wang-eight']);
for(const name of ['offline-transport-proof','project-dialog','ia-3-main-chat','ia-3-controls','ux-2-sidebar-account','ux-3-composer-menu'])await run(name,['tests/evidence/qa-4/runners/'+name+'.mjs']);
await run('stream-timeout',['--test','tests/integration/model-stream-timeout.ts']);
await run('motion',['--test','tests/personal-desktop-motion.test.ts']);
await run('web-document',['tests/evidence/qa-4/runners/m1.mjs','--mimo','--mimo-machine','--only','action-02-web-document','--memory-core-source','C:/Temp/weftmate-mem-d-core/py/src']);
await run('mobile-web',['tests/evidence/qa-4/runners/android-all.mjs','--phase','mobile-web','--visual-smoke']);
await run('relay-phone',['tests/evidence/qa-4/runners/relay-task.mjs','--phase','relay-phone','--visual-smoke']);
await run('build-installed',['tests/evidence/qa-4/runners/build-installed.mjs']);
await run('migration',['tests/evidence/qa-4/runners/migration.mjs','D:/AIProjects/WeftMate/Runtime/Backups/pre-upgrade-20261009b/personal-account-20260926','.local/qa-4/releases']);
report.finishedAt=new Date().toISOString();save();
