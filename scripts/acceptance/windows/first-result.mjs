// Refuse to overwrite an earlier trial, including an interrupted one.
import {open,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

export async function recordFirst(root,name,run){
 if(!/^[a-zA-Z0-9-]+$/.test(name))throw Error('Invalid first-result name');
 const path=join(root,`first-${name}.json`),handle=await open(path,'wx');
 await handle.writeFile(JSON.stringify({state:'started',at:new Date().toISOString()}));await handle.close();
 let result;
 try{result={state:'completed',value:await run()};}
 catch(error){result={state:'failed',error:String(error.stack)};}
 await writeFile(path,JSON.stringify(result,null,2));return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [directory,name,code,seconds='180']=process.argv.slice(2);
 // Validate before claiming the trial so a missing action file is not a product failure.
 await readFile(resolve(code));
 for(const stream of [process.stdout,process.stderr])stream.on('error',e=>{if(e.code!=='EPIPE')throw e;});
 const result=await recordFirst(resolve(directory),name,()=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[fileURLToPath(new URL('./command.mjs',import.meta.url)),directory,name,code,seconds],{windowsHide:true,stdio:'inherit'});
  child.on('error',reject);child.on('exit',code=>code===0?resolve({exitCode:0}):reject(Error(`First action exited ${code}`)));
 }));
 console.log(JSON.stringify({name,state:result.state}));if(result.state!=='completed')process.exitCode=1;
}
