import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { createHostRelay } from '../src/personal-relay/index.mjs';
import { buildSystemStatus } from '../src/system-diagnostics.mjs';
import { createDesktopRelayNetwork } from '../src/personal-relay/desktop-network.mjs';
import { createPersonalAccessService } from '../src/personal-access/index.mjs';
import { createHostCloudIdentity } from '../src/personal-cloud/index.mjs';

for(const proxy of ['proxy.invalid:8080','http://user:%@proxy.invalid:8080'])test(`invalid proxy configuration remains offline while local service starts: ${proxy}`,{timeout:15000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'weftmate-invalid-proxy-'));
 let network,service,identity,relay;
 try{
  network=await createDesktopRelayNetwork({session:{},net:{},env:{HTTPS_PROXY:proxy}});
  await assert.rejects(network.fetch('https://certificate.invalid'),e=>e.code==='PROXY_CONFIGURATION_INVALID'&&!e.message.includes(proxy));
  await assert.rejects(network.proxyFor('https://relay.invalid'),e=>e.code==='PROXY_CONFIGURATION_INVALID');
  const backend={getStatus:async()=>({runtime:'ready'}),listModels:async()=>[],preflight:async()=>({ok:true}),
   createSession:async()=>{throw Error('unused')},sendMessage:async()=>{throw Error('unused')},cancelSession:async()=>{},
   readEvents:async()=>({events:[],nextSeq:0,hasMore:false}),describeSession:async()=>null};
  service=await createPersonalAccessService({root,port:0,backend,cloudIdentity:{issuer:'https://cloud.invalid/personal/v1/cloud/oidc',fetcher:network.fetch}});
  const {origin}=await service.start();const device=await service.enrollDevice({name:'synthetic-local-device'});
  const response=await fetch(`${origin}/personal/v1/status`,{headers:{authorization:`Bearer ${device.token}`},signal:AbortSignal.timeout(3000)});
  assert.equal(response.status,200);assert.equal((await response.json()).backend.runtime,'ready');
  identity=await createHostCloudIdentity({root,rootState:{hostId:service.status().hostId},timestamp:Date.now},
   {issuer:'https://cloud.invalid/personal/v1/cloud/oidc',fetcher:network.fetch});
  await assert.rejects(identity.relayRequest('/hosts/relay',{}),e=>e.code==='PROXY_CONFIGURATION_INVALID');
  relay=await createHostRelay({root,identity:{...identity,relayReady:()=>true},options:{binary:'synthetic',transportCaFile:'synthetic',acme:{}},executeCommand:async()=>({stdout:'0.71.0'}),pollMs:60000});
  await relay.reconnect();assert.equal(relay.status().state,'offline');assert.match(relay.status().message,/代理设置有问题/);
  const sessions=await fetch(`${origin}/personal/v1/sessions`,{headers:{authorization:`Bearer ${device.token}`},signal:AbortSignal.timeout(3000)});
  assert.equal(sessions.status,200,'local history remains available after cloud/relay failure');
 }finally{await relay?.close();await identity?.close();await service?.close();await network?.close();await rm(root,{recursive:true,force:true});}
});

for(const code of ['NETWORK_UNAVAILABLE','PROXY_CONFIGURATION_INVALID'])test(`${code} becomes offline with a safe actionable message, without reading a missing cert`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'weftmate-proxy-status-'));
 const key=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({format:'jwk'});
 const diagnostics=[];let calls=0;
 const fetcher=async()=>{calls++;throw Object.assign(Error('synthetic-private-proxy-credential'),{code});};
 const relay=await createHostRelay({root,identity:{tls:()=>({privateJwk:key,spki:'synthetic'}),relayRequest:async()=>({baseUrl:'https://r0-2.invalid',serverName:'relay.invalid',serverPort:443})},
  options:{binary:'synthetic',transportCaFile:'synthetic',acme:{fetcher,issue:async input=>input.fetcher('https://certificate.invalid')},diagnostic:e=>diagnostics.push(e)},
  executeCommand:async()=>({stdout:'0.71.0'}),pollMs:60000});
 try{
  await relay.reconnect();const status=relay.status();assert.equal(calls,1);assert.equal(status.state,'offline');assert.equal(status.certificateErrorCode,code==='NETWORK_UNAVAILABLE'?'CERTIFICATE_NETWORK_UNAVAILABLE':code);
  assert.equal(status.message,code==='NETWORK_UNAVAILABLE'?'网络连不上证书服务。请检查网络或代理设置，再点重试。':'代理设置有问题，暂时连不上云端和远程连接服务。请检查代理设置后重启应用。');assert.ok(!diagnostics.some(e=>e.code==='ENOENT'));
  assert.ok(!JSON.stringify(status).includes('synthetic-private'));
  const row=buildSystemStatus({relay:status}).components.find(r=>r.id==='certificate');assert.equal(row.state,'problem');assert.match(row.description,code==='NETWORK_UNAVAILABLE'?/网络连不上证书服务/:/代理设置有问题/);
 }finally{await relay.close();await rm(root,{recursive:true,force:true});}
});
