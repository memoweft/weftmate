import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const reports=[];
for(const name of ['models','d36','orphan','scroll-focused','ux-1-consistency','legacy']){
 const startedAt=new Date().toISOString(),t=Date.now();
 console.log('START',name,startedAt);
 const run=spawnSync(process.execPath,[`tests/evidence/qa-3/runners/${name}.mjs`],{env:{...process.env,TEMP:'C:\\Temp',TMP:'C:\\Temp'},encoding:'utf8',windowsHide:true,timeout:15*60*1000,maxBuffer:8*1024*1024});
 reports.push({name,startedAt,durationMs:Date.now()-t,exitCode:run.status,error:run.error?.message,stdout:run.stdout,stderr:run.stderr});
 writeFileSync('tests/evidence/qa-3/ui-batch.json',JSON.stringify(reports,null,2));
 console.log('END',name,run.status,(run.stderr||'').slice(-700));
}
