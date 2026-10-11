import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const dir=resolve('tests/evidence/bl-29/rework');mkdirSync(dir,{recursive:true});
const scrub=s=>s.replaceAll(process.env.USERPROFILE||'no-profile','C:\\Users\\<user>').replaceAll(process.env.COMPUTERNAME||'no-host','<host>');
const jobs=[
 ['rework-final',['--test','--test-concurrency=1','tests/bl-29-rework.test.ts','tests/bl-29-wait.test.ts','tests/m3-1-presence.test.ts','tests/stream-live.test.ts']],
 ['review-probes',['tests/integration/bl29-rework/run.mjs']],
 ['census',['tests/integration/bl-29-requests.mjs','--logical']],
 ['responsiveness',['tests/integration/bl-29-requests.mjs','--logical','--latency']],
];
for(const [name,args] of jobs.filter(([name])=>process.argv.length<=2||process.argv.slice(2).includes(name))){
 console.log('START',name);const at=Date.now();let output='';
 const env={...process.env,WEFTMATE_TEST_HOST_NAME:'synthetic-host',BL29_EVIDENCE_DIR:`${dir}/after`,WEFTMATE_BL29_EVIDENCE_DIR:dir};delete env.ELECTRON_RUN_AS_NODE;
 const p=spawn(process.execPath,args,{env,windowsHide:true});p.stdout.on('data',b=>{output+=b;writeFileSync(`${dir}/${name}.log`,scrub(output));});p.stderr.on('data',b=>{output+=b;writeFileSync(`${dir}/${name}.log`,scrub(output));});
 const code=await new Promise(r=>p.on('exit',r));console.log('END',name,code,Date.now()-at);
 const results=JSON.parse(readFileSync(`${dir}/validation.json`,'utf8'));results.push({name,code,ms:Date.now()-at,passed:Number(/^ℹ pass (\d+)/m.exec(output)?.[1]||0),failed:Number(/^ℹ fail (\d+)/m.exec(output)?.[1]||0)});writeFileSync(`${dir}/validation.json`,JSON.stringify(results,null,2));
 if(code!==0){process.exitCode=code||1;break;}
}
