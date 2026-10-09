// Real personal HTTP host and real cloud DPoP authorization; synthetic Core and model.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {fixture,P} from '../../../services/cloud/test/identity-helpers.mjs';
import {registration,appDevice,control,refresh,proof} from '../../../services/cloud/test/app-helpers.mjs';
import {createPersonalAccessService} from '../../../src/personal-access/index.mjs';
import {syntheticBackend} from './a5_synthetic_backend.mjs';
process.umask(0o077);
const cleanup=[],cloud=await fixture({after:fn=>cleanup.push(fn)});
await registration(cloud);const desktop=await appDevice(cloud,'desktop'),phone=await appDevice(cloud,'phone');
const root=await realpath(await mkdtemp(join(tmpdir(),'wm-a14-'))),runtime=syntheticBackend(root);
const permissions={allow_local_read:true,allow_cloud_read:true,allow_inference:true};
const memory=(id,text)=>({item_id:id,object_kind:'cognition',current_state:'current',permissions:[permissions],value:{content:text},provenance:[{evidence_id:'source-'+id,permissions,currentness_state:'current',model_content_available:true,evidence:{content_available:true,summary:text}}],updated_at:'2026-10-09'});
let items=[memory('tea','用户喝茶喜欢茉莉花茶，不加糖。'),memory('travel','用户去青海旅行。')],ingested=[],calls=[],syncs=0,submissions=0,statusChecks=0;
const apiKey=randomBytes(32).toString('base64url');
const model=createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks));assert.equal(req.headers.authorization,'Bearer '+apiKey);assert.equal(body.tools,undefined);assert.ok(body.messages.length<=22);calls.push(body);const query=body.messages.at(-1).content;const content=query.includes('喝茶')?(body.messages[0].content.includes('茉莉花茶')?'你喜欢茉莉花茶，不加糖。':'不知道你的喝茶偏好。'):'收到，你徒步用墨绿色双肩背包。';res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({choices:[{message:{role:'assistant',content}}]}));});model.listen(0,'127.0.0.1');await once(model,'listening');
Object.assign(runtime.memoryManager,{enabled:true,query:async(_owner,_method,input)=>({world_revision:1,...(input.operation==='list'?{items}: {})}),ingest:async(_owner,boundary)=>{ingested.push(boundary);return {state:'accepted'};},discardOfflinePending:async()=>{}});
const accountModelManager=Object.fromEntries(['stageSecret','apply','inspect','hasCredential','test','disable','readSecret'].map(k=>[k,async()=>null]));
accountModelManager.readOfflineModel=async()=>({baseUrl:`http://127.0.0.1:${model.address().port}/v1`,modelId:'mimo-synthetic',apiKey});
let host,started,hostPort=0,auth;
async function start(){host=await createPersonalAccessService({root:join(root,'host'),port:hostPort,backend:runtime.backend,memoryManager:runtime.memoryManager,accountModelManager,cloudIdentity:{issuer:cloud.config.issuer,allowInsecureLoopback:true}});runtime.attach(host);started=await host.start();hostPort=Number(new URL(started.origin).port);}
await start();
async function api(path,body,credentials=auth,headers={}){const r=await fetch(started.origin+'/personal/v1'+path,{method:body===undefined?'GET':'POST',headers:{origin:started.origin,'content-type':'application/json',...(credentials?{cookie:credentials.cookie,'x-weftmate-csrf':credentials.csrfToken}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});return {...await r.json(),status:r.status,cookie:r.headers.get('set-cookie')?.split(';')[0]};}
async function exchange(device,route){const nonce=await api('/auth/cloud-nonce',{},null);return api(route,{accessToken:device.tokens.access_token,deviceName:device.deviceId},null,{dpop:await proof(device,started.origin+'/personal/v1'+route,device.tokens.access_token,{nonce:nonce.nonce})});}
auth=await exchange(desktop,'/auth/cloud-desktop');assert.equal(auth.status,200);
const selected=(await control(phone,'/hosts/connect',{hostId:started.hostId})).data;await refresh(phone,selected.resource);
let mobile=await exchange(phone,'/auth/cloud-session');assert.equal(mobile.status,202);
assert.equal((await api('/cloud/devices/'+mobile.requestId+'/decision',{decision:'allow'})).status,200);
mobile=await exchange(phone,'/auth/cloud-session');assert.equal(mobile.status,200);await refresh(phone,cloud.config.audience);
// Test device host auth is a real approved session. Swift imports it only through its existing test SPI.
const proxy=createServer(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);const path=new URL(req.url,'http://127.0.0.1').pathname;if(path.endsWith('/offline/sync'))syncs++;if(path.endsWith('/offline/turns'))submissions++;const headers={...req.headers,host:new URL(started.origin).host,origin:started.origin};delete headers['content-length'];const r=await fetch(started.origin+req.url,{method:req.method,headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});const outgoing={};for(const[k,v]of r.headers)if(!['content-length','transfer-encoding','content-encoding'].includes(k))outgoing[k]=v;res.writeHead(r.status,outgoing);res.end(Buffer.from(await r.arrayBuffer()));}catch{res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:'HOST_UNAVAILABLE'}}));}});proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
const hostOrigin=`http://127.0.0.1:${proxy.address().port}`;
let online=true;
const driver=createServer(async(req,res)=>{try{cloud.advance(Math.max(0,Date.now()-cloud.now));const path=new URL(req.url,'http://127.0.0.1').pathname;let data;
if(path==='/ready')data={host:hostOrigin,hostId:started.hostId};
else if(path==='/session')data={...mobile,hostId:started.hostId};
else if(path==='/control'){statusChecks++;const result=await control(phone,'/hosts/offline/status',{hostId:started.hostId});data=result.data;}
else if(path==='/stop'){await host.close();online=false;data={online};}
else if(path==='/start'){await start();online=true;data={online};}
else if(path==='/forget'){items=[];await host.cleanupMemoryCopies(auth.account.ownerId,{});data={forgotten:true};}
else if(path==='/report')data={syntheticOnly:true,realPersonalHTTP:true,realCloudDPoP:true,offlineRelay:'503 while the actual host process is stopped',compiledDSH:false,realCore:false,model:'deterministic substitute; Windows Machine environment unavailable on Mac',syncs,submissions,statusChecks,modelCalls:calls.length,recalledTea:calls.some(c=>c.messages[0].content.includes('茉莉花茶')),unrelatedSent:calls.some(c=>c.messages[0].content.includes('青海')),toolsSent:calls.some(c=>'tools'in c),ingested:ingested.map(b=>({eventID:b.event_id,messages:b.source_messages.map(m=>({role:m.role,content:m.content,dependencies:m.model_context_dependencies,timestamp:m.timestamp}))})),forgotten:items.length===0};
else if(path==='/needles')data={values:['茉莉花茶','墨绿色双肩背包',apiKey]};
else throw Error('Unknown route');res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));}catch(e){process.stderr.write(String(e.stack)+'\n');res.writeHead(500);res.end('{}');}});driver.listen(0,'127.0.0.1');await once(driver,'listening');
console.log(JSON.stringify({root,driver:`http://127.0.0.1:${driver.address().port}`,host:hostOrigin}));
async function close(){if(online)await host.close();for(const s of[proxy,model,driver]){s.closeAllConnections();await new Promise(r=>s.close(r));}for(const fn of cleanup.reverse())await fn();await rm(root,{recursive:true,force:true});process.exit(0);}process.on('SIGTERM',close);process.on('SIGINT',close);
