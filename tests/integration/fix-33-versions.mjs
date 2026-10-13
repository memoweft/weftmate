// Actual 3062ea4a host modules, current cloud, and current phone code. Synthetic data only.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, symlink, unlink, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID, createHash} from 'node:crypto';
import {fixture} from '../../services/cloud/test/identity-helpers.mjs';
import {registration, appDevice, control, refresh, proof} from '../../services/cloud/test/app-helpers.mjs';
import {createPersonalAccessService as currentService} from '../../src/personal-access/index.mjs';
import {servePersonalAccessUi} from '../../src/personal-access-ui/index.mjs';

const root=await mkdtemp(join(tmpdir(),'weftmate-fix33-')), cleanup=[], trace=[];
const report={synthetic:true, model:'synthetic backend with durable user/assistant events', baseline:'3062ea4a', scenarios:[],trace};
const out=resolve('tests/evidence/fix-33');await mkdir(out,{recursive:true});
const baseline=process.env.FIX33_BASELINE==='1';report.baseline=baseline;
const sha=text=>createHash('sha256').update(text).digest('hex');
const wait=async(read,done)=>{const end=Date.now()+10000;while(Date.now()<end){const r=await read();if(done(r))return r;await new Promise(r=>setTimeout(r,30));}throw Error('synthetic receipt timed out');};
function backend(){const sessions=new Map(), starts=[];return {starts,
 getStatus:async()=>({runtime:'ready',referenceScan:'ready'}),listModels:async()=>[{id:'synthetic',name:'合成模型',model:'synthetic',configured:true}],preflight:async()=>({ok:true}),
 createSession:async({sessionId})=>{sessions.set(sessionId,[]);return {sessionId};},
 sendMessage:async({sessionId,text})=>{starts.push(performance.now());const rows=sessions.get(sessionId),receiptId=randomUUID(),at=new Date().toISOString();
 rows.push({seq:rows.length,type:'user.message',at,data:{text,receiptId,messageHash:sha(text)}});rows.push({seq:rows.length,type:'assistant.message',at,data:{text:'合成回复'}});rows.push({seq:rows.length,type:'turn.ended',at,data:{}});return {accepted:true,receiptId};},
 chatRelayState:async()=>({safe:false,pending:false}),cancelSession:async()=>({accepted:true}),readEvents:async({sessionId,afterSeq=-1,limit=100})=>{const rows=sessions.get(sessionId)||[];return {events:rows.filter(r=>r.seq>afterSeq).slice(0,limit),nextSeq:rows.at(-1)?.seq??-1,hasMore:false};},
 describeSession:async sessionId=>sessions.has(sessionId)?{sessionId,title:'合成对话',running:false}:null};}
try{
 const archive=join(root,'old.tar');execFileSync('git',['archive','--format=tar','--output',archive,'3062ea4a','src','package.json'],{windowsHide:true});
 const old=join(root,'old');await mkdir(old);execFileSync('tar',['-xf',archive,'-C',old],{windowsHide:true});await rm(archive);
 const link=join(old,'node_modules');await symlink(resolve('node_modules'),link,'junction');cleanup.push(()=>unlink(link));
 const oldService=(await import(pathToFileURL(join(old,'src/personal-access/index.mjs')).href)).createPersonalAccessService;
 const f=await fixture({after:fn=>cleanup.push(fn)});
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(url,options={})=>{
  const response=await originalFetch(url,options);
  if(String(url).startsWith(f.origin+'/')) {
   let fields=[];try{fields=Object.keys(JSON.parse(options.body||'{}'));}catch{fields=[...new URLSearchParams(options.body).keys()];}
   const data=await response.clone().json().catch(()=>({}));
   trace.push({host:'cloud',method:options.method||'GET',path:new URL(url).pathname,status:response.status,requestFields:fields,responseFields:Object.keys(data),code:data.error?.code||data.error});
  }
  return response;
 };cleanup.push(async()=>{globalThis.fetch=originalFetch;});await registration(f);
 const desktop=await appDevice(f,'desktop'), phone=await appDevice(f,'phone');
 for(const [version,create] of [['old',oldService],['current',currentService]]){
  const b=backend(),data=join(root,version+'-data');await mkdir(data);
  const host=await create({root:data,port:0,backend:b,uiHandler:servePersonalAccessUi,cloudIdentity:{issuer:f.config.issuer,allowInsecureLoopback:true}});cleanup.push(()=>host.close());
  const started=await host.start();
  async function api(path,body,auth,headers={}){const begin=performance.now(),response=await fetch(started.origin+'/personal/v1'+path,{method:body===undefined?'GET':'POST',headers:{origin:started.origin,'content-type':'application/json',...(auth?{cookie:auth.cookie,'x-weftmate-csrf':auth.csrfToken}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();trace.push({host:version,method:body===undefined?'GET':'POST',path,status:response.status,ms:Math.round(performance.now()-begin),requestFields:Object.keys(body||{}),responseFields:Object.keys(data),commandFields:Object.keys(data.command||{}),code:data.error?.code});return {...data,status:response.status,cookie:response.headers.get('set-cookie')?.split(';')[0]||auth?.cookie};}
  const native=await api('/auth/desktop',{deviceName:'synthetic-host'},null,{'x-weftmate-desktop':host.libraryDesktopToken});assert.equal(native.status,200);
  const exchange=async(device,path,auth)=>{const nonce=await api('/auth/cloud-nonce',{});return api(path,{accessToken:device.tokens.access_token,deviceName:device.deviceId},auth,{dpop:await proof(device,started.origin+'/personal/v1'+path,device.tokens.access_token,{nonce:nonce.nonce}),...(auth?{'x-weftmate-desktop':host.libraryDesktopToken}:{})});};
  if(version==='current')await refresh(desktop,f.config.audience);
  const bound=await exchange(desktop,'/auth/cloud-desktop',native);assert.equal(bound.status,200,JSON.stringify(bound));await host.syncCloudRevocations();
  await refresh(phone,f.config.audience);await control(phone,'/hosts/connect',{hostId:started.hostId});await refresh(phone,f.config.audience+'/hosts/'+started.hostId);
  const auth=await exchange(phone,'/auth/cloud-session');assert.equal(auth.status,200,JSON.stringify(auth));
  const scenario={version,config:await api('/cloud/config'),status:await api('/status',undefined,auth),messages:[]};
  // Keep no credentials or account ids in evidence.
  scenario.config={fields:Object.keys(scenario.config),capabilities:scenario.config.capabilities};scenario.status={fields:Object.keys(scenario.status),personalCapabilities:scenario.status.personalCapabilities};
  const created=await api('/commands',{requestId:randomUUID(),targetDeviceId:started.hostId,kind:'session.create',modelProfileId:'synthetic'},auth);
  const complete=await wait(()=>api('/commands/by-request/'+created.command.requestId,undefined,auth),r=>r.command?.state==='accepted_by_dsh');
  const sessionId=complete.command.sessionId,main=(await api('/chats/main',undefined,auth)).chat,side=await api('/sessions/'+sessionId+'/chat',undefined,auth);
  for(const [kind,chat] of [['main',main],['side',side]]) {
  for(let i=0;i<4;i++){
   const requestId='native-'+randomUUID(),begin=performance.now(),start=b.starts.length;await api('/commands/by-request/'+requestId,undefined,auth);
   const payload=kind==='main'||baseline?{kind:'chat.message',chatId:chat.chatId,modelProfileId:'synthetic'}:{kind:'session.message',sessionId};
   const sent=await api('/commands',{requestId,targetDeviceId:started.hostId,...payload,text:'你好',mode:'queue'},auth);
   const result=sent.command?await wait(()=>api('/commands/by-request/'+requestId,undefined,auth),r=>['accepted_by_dsh','rejected','observed'].includes(r.command?.state)):sent;
   scenario.messages.push({kind,index:i+1,status:sent.status,state:result.command?.state,error:result.command?.errorCode||result.error?.code,commandFields:Object.keys(result.command||{}),toModelStartMs:b.starts[start]===undefined?null:Math.round(b.starts[start]-begin)});
   if(!baseline)assert.equal(result.command?.state,'accepted_by_dsh');
   if(baseline&&kind==='side')assert.equal(result.error?.code,'CHAT_UNAVAILABLE');
  }
  }
  report.scenarios.push(scenario);await host.close();cleanup.pop();
 }
}finally{
 for(const close of cleanup.reverse())await close();
 assert.ok(resolve(root).startsWith(resolve(tmpdir())+'\\')||resolve(root).startsWith(resolve(tmpdir())+'/'));await rm(root,{recursive:true,force:true});
 await writeFile(join(out,baseline?'versions-before.json':'versions-after.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({scenarios:report.scenarios,requests:trace.length}));
}
