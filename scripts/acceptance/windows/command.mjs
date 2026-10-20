// Run one installed-UI action against the active controller; results stay outside git.
import {readFile,writeFile,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

const [directory,name,codeFile,seconds='180']=process.argv.slice(2),timeout=Number(seconds)*1000;
if(!directory||!codeFile||!name||!/^[a-zA-Z0-9-]+$/.test(name)||!Number.isFinite(timeout)||timeout<1000||timeout>1800000)
 throw Error('Usage: command.mjs EVIDENCE CASE CODE_FILE [TIMEOUT_SECONDS<=1800]');
for(const stream of [process.stdout,process.stderr])stream.on('error',e=>{if(e.code!=='EPIPE')throw e;});
const root=resolve(directory),id=randomUUID(),code=await readFile(resolve(codeFile),'utf8');
await writeFile(join(root,'request.tmp'),JSON.stringify({id,code}));
await rename(join(root,'request.tmp'),join(root,'request.json'));
const deadline=Date.now()+timeout;
let response;
while(Date.now()<deadline){
 response=await readFile(join(root,'response.json'),'utf8').then(JSON.parse).catch(()=>null);
 if(response?.id===id)break;
 const fatal=await readFile(join(root,'fatal.json'),'utf8').then(JSON.parse).catch(()=>null);
 if(fatal)throw Error('Controller stopped; inspect fatal.json');
 await new Promise(r=>setTimeout(r,300));
}
if(response?.id!==id)throw Error(`Scenario timeout: ${name}`);
await writeFile(join(root,`case-${name}.json`),JSON.stringify(response,null,2));
if(!response.ok){
 const snapshot=await readFile(join(root,'snapshot.json'),'utf8').catch(()=>null);
 if(snapshot)await writeFile(join(root,`case-${name}-snapshot.json`),snapshot);
}
console.log(JSON.stringify({case:name,ok:response.ok,...(!response.ok?{error:response.error}:{})}));
if(!response.ok)process.exitCode=1;
