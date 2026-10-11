import {spawn} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync, existsSync} from 'node:fs';
import {resolve} from 'node:path';
const dir = resolve('tests/evidence/bl-29/rework');mkdirSync(dir,{recursive:true});
const mobile = ['--test','--test-concurrency=1','tests/personal-cloud-web.test.ts','apps/mobile-ui/tests/cloud-login.test.mjs','apps/mobile-ui/tests/chat-interactions.test.mjs','apps/mobile-ui/tests/visual-interactions.test.mjs','apps/mobile-ui/tests/approval-interactions.test.mjs'];
const jobs = [['required',['.github/scripts/ci-unit-tests.mjs','required','--report',`${dir}/required.json`]],['vendor',['.github/scripts/ci-unit-tests.mjs','vendor','--report',`${dir}/vendor.json`]]];
for(let i=1;i<=10;i++)jobs.push([`approval-${i}`,['--test','apps/mobile-ui/tests/approval-interactions.test.mjs']]);
for(let i=1;i<=3;i++)jobs.push([`mobile-${i}`,mobile]);
for(let i=1;i<=3;i++)jobs.push([`interactions-${i}`,['tests/integration/stream-1b-interactions.mjs']]);
for(let i=1;i<=3;i++)jobs.push([`timeline-${i}`,['tests/integration/stream-1b-timeline.mjs','--budgets']]);
const scrub=s=>s.replaceAll(process.env.USERPROFILE||'no-profile','C:\\Users\\<user>').replaceAll(process.env.COMPUTERNAME||'no-host','<host>');
const results=existsSync(`${dir}/validation.json`)?JSON.parse(readFileSync(`${dir}/validation.json`,'utf8')):[];
for(const [name,args] of jobs.filter(([name])=>process.argv.length<=2||process.argv.slice(2).includes(name))){
 const outputDir=`${dir}/${name}`;mkdirSync(outputDir,{recursive:true});const at=Date.now();let output='';
 console.log('START',name,new Date().toISOString());
 const env={...process.env,WEFTMATE_TEST_HOST_NAME:'synthetic-host',WEFTMATE_STREAM_EVIDENCE_DIR:outputDir};delete env.ELECTRON_RUN_AS_NODE;
 const p=spawn(process.execPath,args,{windowsHide:true,env});
 p.stdout.on('data',b=>{output+=b;writeFileSync(`${dir}/${name}.log`,scrub(output));});p.stderr.on('data',b=>{output+=b;writeFileSync(`${dir}/${name}.log`,scrub(output));});
 const code=await new Promise(r=>p.on('exit',r));
 if(existsSync(`${dir}/${name}.json`))writeFileSync(`${dir}/${name}.json`,scrub(readFileSync(`${dir}/${name}.json`,'utf8')));
 const row={name,code,ms:Date.now()-at,passed:Number(/(?:^# pass |^ℹ pass )(\d+)/m.exec(output)?.[1]||0),failed:Number(/(?:^# fail |^ℹ fail )(\d+)/m.exec(output)?.[1]||0)};
 results.push(row);writeFileSync(`${dir}/validation.json`,JSON.stringify(results,null,2));console.log('END',JSON.stringify(row));
 if(/CreateProcess[^\n]*1455|800705af|paging file is too small|页面文件太小/i.test(output)){console.log('MEMORY PAUSE');await new Promise(r=>setTimeout(r,20000));}
 if(code!==0){console.log('FAILED; investigate before continuing');process.exitCode=1;break;}
 if(name==='vendor'){
  writeFileSync('tests/evidence/bl-29/vendor.json',scrub(readFileSync(`${dir}/vendor.json`,'utf8')));
  writeFileSync('tests/evidence/bl-29/vendor.txt',scrub(output));
 }
}
