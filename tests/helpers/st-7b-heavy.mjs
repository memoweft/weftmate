import { open, readFile, unlink, mkdir, writeFile, appendFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { redactEvidenceText } from './process-evidence.mjs';
const root=resolve(import.meta.dirname,'../..'),phase=process.argv[2];
const commands={electron:['tests/integration/st-7b-electron.mjs'],required:['.github/scripts/ci-unit-tests.mjs','required'],vendor:['.github/scripts/ci-unit-tests.mjs','vendor'],mobile:['--test','tests/personal-cloud-web.test.ts','apps/mobile-ui/tests/cloud-login.test.mjs','apps/mobile-ui/tests/chat-interactions.test.mjs','apps/mobile-ui/tests/visual-interactions.test.mjs','apps/mobile-ui/tests/approval-interactions.test.mjs'],package:['scripts/nightly/installed-smoke.mjs','--out','.local/package-smoke']};
commands.visual=commands.electron;
if(!commands[phase])throw Error('Unknown ST-7b heavy phase');
const directory='D:/AIProjects/WeftMate/Runtime/Orchestrator';let lock,identity;
while(!lock){for(const n of [1,2,3]){const file=join(directory,`heavy-${n}.lock`);let handle;try{handle=await open(file,'wx');identity=`ST-7b ${new Date().toISOString()} ${phase}`;await handle.writeFile(identity);await handle.close();lock=file;console.log(`ST-7b acquired heavy-${n} for ${phase}`);break;}catch(e){await handle?.close();if(e.code!=='EEXIST')throw e;}}if(!lock){console.log(`ST-7b waiting for heavy slot: ${phase}`);await delay(120000);}}
let child,logWrites=Promise.resolve();
try{
 const logFile=join(root,'.local','st-7b',`${phase}.log`);await mkdir(join(root,'.local','st-7b'),{recursive:true});await writeFile(logFile,'');
 const args=commands[phase].map(value=>value.endsWith('.mjs')||value.endsWith('.ts')?resolve(root,value):value);
 child=spawn(process.execPath,args,{cwd:root,env:{...process.env,WEFTMATE_TEST_HOST_NAME:'synthetic-host',...(phase==='visual'?{WEFTMATE_ST7B_VISUAL_ONLY:'1'}:{})},stdio:['ignore','pipe','pipe'],windowsHide:true});
 const capture=part=>{const text=redactEvidenceText(String(part));process.stdout.write(text);logWrites=logWrites.then(()=>appendFile(logFile,text));};child.stdout.on('data',capture);child.stderr.on('data',capture);
 const code=await new Promise((done,reject)=>{child.once('error',reject);child.once('close',code=>done(code??1));});await logWrites;process.exitCode=code;
}finally{if(await readFile(lock,'utf8').catch(()=>null)===identity)await unlink(lock);}
