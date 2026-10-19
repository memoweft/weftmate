import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn,spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDesktopRelayNetwork } from '../src/personal-relay/desktop-network.mjs';
const require=createRequire(import.meta.url);
test('relay waits for network-service proxy configuration before routing',{timeout:3000},async()=>{
 // Electron's preference write can finish before the network service applies
 // it. Model that boundary, including the bypass-only and direct sessions.
 const session={defaultSession:{},fromPartition(){
  let pending,active;
  const value={
   async setProxy(config){pending=config;},
   async forceReloadProxyConfig(){await new Promise(resolve=>setImmediate(resolve));active=pending;},
   async resolveProxy(url){
    if(!active||active.mode==='direct'||new URL(url).hostname==='localhost')return 'DIRECT';
    return active.proxyRules.includes('bypass.invalid')?'PROXY bypass.invalid:80':'PROXY proxy.invalid:8080';
   },
   async fetch(){return new Response(active?.mode==='direct'?'local':active?'proxied':'unconfigured');},
   async closeAllConnections(){},
  };
  return value;
 }};
 const network=await createDesktopRelayNetwork({session,net:{},env:{HTTP_PROXY:'http://proxy.invalid:8080'}});
 try{
  assert.equal(await network.proxyFor('http://certificate.invalid/directory'),'http://proxy.invalid:8080');
  assert.equal(await(await network.fetch('http://certificate.invalid/directory')).text(),'proxied');
  assert.equal(await(await network.fetch('http://localhost/')).text(),'local');
 }finally{await network.close();}
});
for(const mode of ['cold-start','env','system','direct','bypass','bypass-multiple','system-bypass-all','system-bypass-multiple','system-local','env-local','env-loopback','env-loopback-dot','socks-portless','auth','tls-reject','tls-reject-background','unreachable']) test(`real Electron relay network: ${mode}`,{timeout:30000},async()=>{
 const profile=await mkdtemp(join(tmpdir(),'weftmate-relay-proxy-'));
 const env={...process.env,WEFTMATE_PROXY_TEST_PROFILE:profile,WEFTMATE_PROXY_TEST_MODE:mode};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_USE_ENV_PROXY;
 let child,closed,timer;
 const stopTree=()=>{
  if(!child?.pid)return;
  if(process.platform==='win32'){
   if(child.exitCode===null&&child.signalCode===null)spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:5000});
  }else{try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}}
 };
 try{
  closed=new Promise<{code:number|null,output:string}>((resolve,reject)=>{
   child=spawn(require('electron'),[fileURLToPath(new URL('./integration/relay-network-electron.mjs',import.meta.url)),'--no-sandbox',`--user-data-dir=${profile}`],{env,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
   let output='';for(const s of [child.stdout,child.stderr])s.on('data',v=>output+=v);
   timer=setTimeout(stopTree,20000);
   child.once('error',e=>{clearTimeout(timer);reject(e)});child.once('close',code=>{clearTimeout(timer);resolve({code,output})});
  });
  const result=await closed;
  assert.equal(result.code,0,result.output);assert.match(result.output,/RELAY_PROXY_ENV_PASS/);
 }finally{clearTimeout(timer);stopTree();await closed?.catch(()=>{});await rm(profile,{recursive:true,force:true});}
});
