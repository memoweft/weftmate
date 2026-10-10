/** Real isolated host and repository cloud identity service, synthetic accounts/model only. */
import assert from 'node:assert/strict';
import os from 'node:os';
import { syncBuiltinESMExports, registerHooks } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fork } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
// Windows cannot fsync a directory handle. Keep file fsync and all identity logic;
// adapt only Linux cloud durability plumbing in this opt-in synthetic runner.
if (process.platform === 'win32') registerHooks({load(url, context, next) {
  if (!url.endsWith('/services/cloud/src/keys.mjs')) return next(url, context);
  return {format:'module',shortCircuit:true,source:readFileSync(new URL(url),'utf8').replace('await dir.sync();','/* directory fsync unavailable on Windows fixture */')};
}});
const { fixture, EMAIL, PASSWORD } = await import('../../services/cloud/test/identity-helpers.mjs');
const { registration, appDevice, refresh, proof } = await import('../../services/cloud/test/app-helpers.mjs');
// Only this synthetic fixture process changes the public computer label.
os.hostname = () => 'synthetic-host'; syncBuiltinESMExports();
const { createPersonalAccessService } = await import('../../src/personal-access/index.mjs');
export function androidSyntheticBackend(root) {
  const file=join(root,'synthetic-backend.json');
  const saved=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{logs:[],sends:[]};
  const logs=new Map(saved.logs),sends=saved.sends;
  const persist=()=>writeFileSync(file,JSON.stringify({logs:[...logs],sends}));
  return {
    getStatus:async()=>({runtime:'ready',referenceScan:'ready',capabilities:{chat:{available:true}}}),
    listModels:async()=>[{id:'synthetic',name:'合成模型',model:'synthetic',configured:true}],preflight:async()=>({ok:true}),
    chatRelayState:async()=>({pending:false,safe:true}),
    readEventDetail:async({sessionId,seq})=>{const event=logs.get(sessionId)?.find(row=>row.seq===seq);return {seq,type:event?.type,text:event?.data?.text};},
    createSession:async({sessionId})=>{logs.set(sessionId,[]);persist();return {sessionId};},
    describeSession:async sessionId=>logs.has(sessionId)?{sessionId,title:'合成对话',modelProfileId:'synthetic',agentPreset:'personal-remote',running:false}:null,
    sendMessage:async input=>{const rows=logs.get(input.sessionId),receiptId=randomUUID();sends.push(input.text);
      const add=(type,data)=>rows.push({seq:rows.length,type,data,at:new Date().toISOString(),sessionId:input.sessionId});
      add('turn.started',{turn:sends.length});add('user.message',{text:input.text,receiptId});
      add('assistant.message',{text:'合成回复：'+input.text,turn:sends.length});add('turn.ended',{reason:'completed',turn:sends.length});persist();return {accepted:true,receiptId};},
    readEvents:async({sessionId,afterSeq,beforeSeq,limit=100})=>{const rows=logs.get(sessionId)||[],forward=afterSeq!==undefined;
      const eligible=rows.filter(row=>forward?row.seq>afterSeq:beforeSeq===undefined||row.seq<beforeSeq),events=forward?eligible.slice(0,limit):eligible.slice(-limit);
      return {events,nextSeq:forward?events.at(-1)?.seq??afterSeq:rows.at(-1)?.seq??-1,nextBeforeSeq:events[0]?.seq??null,hasMore:forward&&eligible.length>limit,hasOlder:!forward&&eligible.length>limit};},
    cancelSession:async()=>({accepted:true}),
  };
}
export async function startAndroidLoginFixture({localMode=false} = {}) {
  const cleanup = [], cloud = await fixture({ after: fn => cleanup.push(fn) }, { env: { CLOUD_OIDC_CLIENTS: JSON.stringify([
    { client_id: 'test-native', redirect_uris: ['com.example.weftmate:/callback'] },
    { client_id: 'weftmate-android', redirect_uris: ['com.memoweft.weftmate:/oauth'] },
  ]) } });
  // The unit-test helper freezes its clock. A real native DPoP client uses wall
  // time; advance the synthetic issuer too, as in the original M3-1 fixture.
  const cloudClock=setInterval(()=>cloud.advance(Math.max(0,Date.now()-cloud.now)),100);
  await registration(cloud);
  const desktop = await appDevice(cloud, 'desktop');
  const root = await realpath(await mkdtemp(join(os.tmpdir(), 'weftmate-and2-')));
  let host, origin, hostId, port=0;
  const start=async()=>{host=fork(new URL('./and-2-host.mjs',import.meta.url),[root,cloud.config.issuer,String(port)],{windowsHide:true,silent:true});host.stderr.resume();host.stdout.resume();
    const ready=await new Promise((done,fail)=>{host.once('message',done);host.once('error',fail);host.once('exit',code=>fail(Error('Synthetic host startup exit '+code)));});
    ({origin,hostId}=ready);port=Number(new URL(origin).port);};
  const invoke=method=>new Promise(done=>{host.once('message',done);host.send({method});});
  const stop=async()=>{if(host.exitCode!==null)return;const exited=new Promise(done=>host.once('exit',done));host.kill();await exited;};
  await start();
  // Keep the ADB transport listener alive when the actual host process exits.
  // Otherwise Windows ADB reverse can wedge its server on a refused target.
  // Successful bytes and all authentication proofs pass through unchanged.
  const gate=createServer((request,response)=>{
    const upstream=httpRequest(origin+request.url,{method:request.method,headers:request.headers},reply=>{response.writeHead(reply.statusCode,reply.headers);reply.pipe(response);});
    upstream.on('error',()=>{if(!response.headersSent)response.writeHead(503,{'content-type':'application/json'});response.end(JSON.stringify({error:{code:'HOST_UNAVAILABLE'}}));});request.pipe(upstream);
  });
  await new Promise(done=>gate.listen(0,'127.0.0.1',done));
  async function request(path,body,auth,headers={}){const response=await fetch(origin+'/personal/v1'+path,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',...(auth?{cookie:auth.cookie,'x-weftmate-csrf':auth.csrfToken}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});return {...await response.json(),status:response.status,cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  let local;
  if (!localMode) {
    const nonce=await request('/auth/cloud-nonce',{});
    local=await request('/auth/cloud-desktop',{accessToken:desktop.tokens.access_token,deviceName:'synthetic-host'},null,{dpop:await proof(desktop,origin+'/personal/v1/auth/cloud-desktop',desktop.tokens.access_token,{nonce:nonce.nonce})});
    assert.equal(local.status,200,JSON.stringify(local));await invoke('syncCloudRevocations');
  }
  const grant=await invoke('issueSetupGrant');
  const credentials={username:'AndroidLocal',password:'synthetic-local-'+randomUUID(),deviceName:'Synthetic local setup'};
  // Register a second local account; the cloud account owns the host already.
  const account=await request(localMode?'/auth/setup':'/auth/register',{...credentials,...(localMode?{grant:grant.grant}:{})});assert.equal(account.status,201,JSON.stringify(account));
  if (localMode) local=account;
  return {cloud,root,credentials,email:EMAIL,password:PASSWORD,get origin(){return origin;},transportPort:gate.address().port,hostId,get sends(){const file=join(root,'synthetic-backend.json');return existsSync(file)?JSON.parse(readFileSync(file,'utf8')).sends:[];},request,local,
    stop,restart:async()=>{await stop();await start();},resume:start,
    approve:async id=>{const result=await request('/cloud/devices/'+id+'/decision',{decision:'allow'},local);assert.equal(result.status,200,JSON.stringify(result));await invoke('syncCloudRevocations');},
    close:async()=>{await stop();clearInterval(cloudClock);gate.closeAllConnections();await new Promise(done=>gate.close(done));for(const fn of cleanup.reverse())await fn();await rm(root,{recursive:true,force:true});}};
}
