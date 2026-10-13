import {open,unlink,mkdir,writeFile,readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'../../..'),locks='D:/AIProjects/WeftMate/Runtime/Orchestrator';
const mode=process.argv[2],out=join(root,'.local/and5');await mkdir(out,{recursive:true});
const jobs={
  gradle:['pwsh',['-NoProfile','-File',join(import.meta.dirname,'build.ps1')]],
  required:['node',['.github/scripts/ci-unit-tests.mjs','required','--report','tests/evidence/and-5/required.json']],
  vendor:['node',['.github/scripts/ci-unit-tests.mjs','vendor','--report','tests/evidence/and-5/vendor.json']],
  mobile:['node',['--test','tests/personal-cloud-web.test.ts','apps/mobile-ui/tests/cloud-login.test.mjs','apps/mobile-ui/tests/chat-interactions.test.mjs','apps/mobile-ui/tests/visual-interactions.test.mjs','apps/mobile-ui/tests/approval-interactions.test.mjs']]
};
if(!jobs[mode])throw Error('Unknown validation mode');
let lock,child,log='';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
try {
  while(!lock){const owned=(await Promise.all([1,2,3].map(i=>readFile(join(locks,`heavy-${i}.lock`),'utf8').catch(()=>'')))).some(s=>s.startsWith('AND-5 '));if(!owned)for(let i=1;i<=3;i++){const path=join(locks,`heavy-${i}.lock`);try{const f=await open(path,'wx');await f.writeFile(`AND-5 ${new Date().toISOString()} ${mode}`);await f.close();lock=path;break;}catch(e){if(e.code!=='EEXIST')throw e;}}if(!lock){process.stdout.write('Waiting for heavy slot (2 minutes)\n');await wait(120000);}}
  process.stdout.write(`AND-5 acquired ${lock.split('/').at(-1)} for ${mode}\n`);
  const [exe,args]=jobs[mode];child=spawn(exe,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,WEFTMATE_TEST_HOST_NAME:'synthetic-host'}});
  for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{log+=b.toString();});
  const code=await new Promise((r,reject)=>{child.once('error',reject);child.once('exit',r)});
  const safe=log.replace(/C:[\\/]Users[\\/][^\\/\s]+/gi,'C:/Users/<user>').replace(/DESKTOP-[A-Z0-9-]+/gi,'<host>');
  await writeFile(join(out,`${mode}.log`),safe);process.stdout.write(safe.slice(-7000));process.exitCode=code||0;
}finally{if(lock)await unlink(lock);}
