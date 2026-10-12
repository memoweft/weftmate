/** MEM-1's single heavy slot. Atomically acquire and always release only our lock. */
import { open, readFile, unlink, mkdir, writeFile, appendFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { redactEvidenceText } from './process-evidence.mjs';
const root=resolve(import.meta.dirname,'../..'),phase=process.argv[2];
const commands={electron:['tests/integration/mem-1-import-history.mjs'],required:['.github/scripts/ci-unit-tests.mjs','required'],vendor:['.github/scripts/ci-unit-tests.mjs','vendor'],mobile:['--test','tests/personal-cloud-web.test.ts','apps/mobile-ui/tests/cloud-login.test.mjs','apps/mobile-ui/tests/chat-interactions.test.mjs','apps/mobile-ui/tests/visual-interactions.test.mjs','apps/mobile-ui/tests/approval-interactions.test.mjs']};
commands.resume=[...commands.electron,'--resume'];
if(!commands[phase])throw Error('Unknown MEM-1 heavy phase');
const directory='D:/AIProjects/WeftMate/Runtime/Orchestrator';let lock,identity;
while(!lock){for(const n of [1,2,3]){const file=join(directory,`heavy-${n}.lock`);let handle;try{handle=await open(file,'wx');identity=`MEM-1 ${new Date().toISOString()} ${phase}`;await handle.writeFile(identity);await handle.close();lock=file;console.log(`MEM-1 acquired heavy-${n} for ${phase}`);break;}catch(e){await handle?.close();if(e.code!=='EEXIST')throw e;}}if(!lock){console.log(`MEM-1 waiting for a heavy slot: ${phase}`);await delay(120000);}}
let output='',child,logWrites=Promise.resolve();
try{
 const logFile=join(root,'.local','mem-1',`${phase}.log`);
 await mkdir(join(root,'.local','mem-1'),{recursive:true});await writeFile(logFile,'');
 const args=commands[phase].map(value=>value.endsWith('.mjs')||value.endsWith('.ts')?resolve(root,value):value);
 child=spawn(process.execPath,args,{cwd:root,env:{...process.env,WEFTMATE_TEST_HOST_NAME:'synthetic-host'},stdio:['ignore','pipe','pipe'],windowsHide:true});
 const capture=part=>{const text=redactEvidenceText(String(part));output+=text;process.stdout.write(text);logWrites=logWrites.then(()=>appendFile(logFile,text));};child.stdout.on('data',capture);child.stderr.on('data',capture);
 const code=await new Promise((done,reject)=>{child.once('error',reject);child.once('close',code=>done(code??1));});
 await logWrites;process.exitCode=code;
}finally{if(await readFile(lock,'utf8').catch(()=>null)===identity)await unlink(lock);}
