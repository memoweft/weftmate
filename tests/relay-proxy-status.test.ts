import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { createHostRelay } from '../src/personal-relay/index.mjs';
import { buildSystemStatus } from '../src/system-diagnostics.mjs';

test('an unreachable proxy/certificate request becomes offline with a safe actionable message, without reading a missing cert',async()=>{
 const root=await mkdtemp(join(tmpdir(),'weftmate-proxy-status-'));
 const key=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({format:'jwk'});
 const diagnostics=[];let calls=0;
 const fetcher=async()=>{calls++;throw Object.assign(Error('synthetic-private-proxy-credential'),{code:'NETWORK_UNAVAILABLE'});};
 const relay=await createHostRelay({root,identity:{tls:()=>({privateJwk:key,spki:'synthetic'}),relayRequest:async()=>({baseUrl:'https://r0-2.invalid',serverName:'relay.invalid',serverPort:443})},
  options:{binary:'synthetic',transportCaFile:'synthetic',acme:{fetcher,issue:async input=>input.fetcher('https://certificate.invalid')},diagnostic:e=>diagnostics.push(e)},
  executeCommand:async()=>({stdout:'0.71.0'}),pollMs:60000});
 try{
  await relay.reconnect();const status=relay.status();assert.equal(calls,1);assert.equal(status.state,'offline');assert.equal(status.certificateErrorCode,'CERTIFICATE_NETWORK_UNAVAILABLE');
  assert.equal(status.message,'网络连不上证书服务。请检查网络或代理设置，再点重试。');assert.ok(!diagnostics.some(e=>e.code==='ENOENT'));
  assert.ok(!JSON.stringify(status).includes('synthetic-private'));
  const row=buildSystemStatus({relay:status}).components.find(r=>r.id==='certificate');assert.equal(row.state,'problem');assert.match(row.description,/网络连不上证书服务/);
 }finally{await relay.close();await rm(root,{recursive:true,force:true});}
});
