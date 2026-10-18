import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn,spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require=createRequire(import.meta.url);
for(const mode of ['env','system','direct','bypass','bypass-multiple','socks-portless','auth','tls-reject','unreachable']) test(`real Electron relay network: ${mode}`,{timeout:30000},async()=>{
 const profile=await mkdtemp(join(tmpdir(),'weftmate-relay-proxy-'));
 const env={...process.env,WEFTMATE_PROXY_TEST_PROFILE:profile,WEFTMATE_PROXY_TEST_MODE:mode};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_USE_ENV_PROXY;
 let child;
 try{
  const result=await new Promise<{code:number|null,output:string}>((resolve,reject)=>{
   child=spawn(require('electron'),[fileURLToPath(new URL('./integration/relay-network-electron.mjs',import.meta.url)),'--no-sandbox'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
   let output='';for(const s of [child.stdout,child.stderr])s.on('data',v=>output+=v);
   const timer=setTimeout(()=>{if(process.platform==='win32')spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:5000});else child.kill('SIGKILL');},20000);
   child.once('error',e=>{clearTimeout(timer);reject(e)});child.once('close',code=>{clearTimeout(timer);resolve({code,output})});
  });
  assert.equal(result.code,0,result.output);assert.match(result.output,/RELAY_PROXY_ENV_PASS/);
 }finally{if(child&&child.exitCode===null)child.kill('SIGKILL');await rm(profile,{recursive:true,force:true});}
});
