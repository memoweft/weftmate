import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import { createServer as tcpServer } from 'node:net';
import { createServer as httpsServer, request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { checkServerIdentity } from 'node:tls';
import { createHash, createPrivateKey, randomUUID, generateKeyPairSync } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import path from 'node:path';
import { fixture, P, generateKeyPair, exportJWK, SignJWT } from './identity-helpers.mjs';
import { createPersonalAccessService } from '../../../src/personal-access/index.mjs';
import { publishMobileUi } from '../../../src/personal-access/mobile-ui-release.mjs';
import { keyId } from '../../../src/personal-update/manifest.mjs';
import { frpcConfig } from '../../../src/personal-relay/index.mjs';
import { tlsSpki } from '../../../src/personal-relay/tls.mjs';

const enabled = process.env.WEFTMATE_RELAY_E2E === 'true';
import { relayFixture, freePort, waitFor, processChild } from './relay-fixture.mjs';
const run = promisify(execFile);
test('S2 real frp + cloud + host + HAProxy on 443: private content, browser auth, SSE, history, attachments, reconnect, pin and revoke',
  { skip: !enabled && 'Run with WEFTMATE_RELAY_E2E=true and official frp + HAProxy paths', timeout: 120_000 }, async t => {
    const { f, root, infra, frontPort, ports, frpDir, procs, frps } = await relayFixture(t);
    const updatePair = generateKeyPairSync('ed25519');
    const updatePrivateKey = updatePair.privateKey.export({ type: 'pkcs8', format: 'pem' });
    const updatePublicKey = updatePair.publicKey.export({ type: 'spki', format: 'pem' });
    const mobileUiTrustedKeys = { [keyId(updatePublicKey)]: updatePublicKey };
    let host, stream, fakeTls; const fakeSockets = new Set();
    const wireChunks = [];
    // Capture only the content-plane listener, after HAProxy and before frps.
    f.identity.relay.content.server.on('connection', socket => {
      socket.on('data', chunk => wireChunks.push(Buffer.from(chunk)));
      const write = socket.write;
      socket.write = function(chunk, ...args) { wireChunks.push(Buffer.from(chunk)); return write.call(this, chunk, ...args); };
    });
    try {
      const account = await f.verified(), logged = await f.signedIn();
      const source = path.join(root,'ui-source'), bundles = path.join(root,'ui-bundles'); await mkdir(source);
      const marker = 'WM_PRIVATE_SYNTHETIC_CONTENT_S2_7fbd214e';
      await writeFile(path.join(source,'index.html'),`<!doctype html><p>${marker}</p>`);
      await publishMobileUi({ sourceDir: source, outputDir: bundles, uiVersion: '0.2.0', privateKey: updatePrivateKey });
      const history = Array.from({ length: 2200 }, (_,seq) => ({ seq, type:'assistant.message', data:{ text: `${marker} ${seq}` } }));
      const backend = { getStatus: async()=>({runtime:'ready'}), listModels:async()=>[], preflight:async()=>({ok:true}),
        createSession:async()=>({}), sendMessage:async()=>({}), cancelSession:async()=>({}),
        describeSession:async sessionId=>({sessionId,title:'Synthetic history',running:false}),
        readEvents:async({beforeSeq,afterSeq,limit})=> {
          const page = afterSeq !== undefined ? history.filter(e=>e.seq>afterSeq).slice(0,limit)
            : history.filter(e=>e.seq<(beforeSeq??history.length)).slice(-limit);
          return { events:page,nextSeq:page.at(-1)?.seq??afterSeq??-1,hasMore:false,nextBeforeSeq:page[0]?.seq??null,
            hasOlder:(page[0]?.seq??0)>0,latestSeq:history.length-1 };
        } };
      host = await createPersonalAccessService({ root:path.join(root,'host'), port:0, backend, mobileUiDir:bundles, mobileUiTrustedKeys,
        cloudIdentity:{issuer:f.config.issuer,allowInsecureLoopback:true},
        relay:{binary:path.join(frpDir,'frpc'),transportCaFile:path.join(infra,'cert.pem'),developmentTls:true,connectAddress:'127.0.0.1',connectPort:frontPort,diagnostic:error=>t.diagnostic(error.message)} });
      const started = await host.start();
      assert.match(started.origin,/^http:\/\/127\.0\.0\.1:/);
      for(const listener of [f.identity.relay.control.server,f.identity.relay.content.server])assert.equal(listener.address().address,'127.0.0.1');
      const direct = async(route,body,auth)=> {
        const response = await fetch(started.origin+'/personal/v1'+route,{method:body!==undefined?'POST':'GET',headers:{
          ...(body!==undefined?{origin:started.origin,'content-type':'application/json'}:{}),
          ...(auth?{cookie:auth.cookie,'x-weftmate-csrf':auth.csrfToken}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
        return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
      };
      const password = 'synthetic relay local password';
      const setup = await direct('/auth/setup',{grant:(await host.issueSetupGrant()).grant,username:'synthetic-relay',password,deviceName:'Computer'});
      assert.equal(setup.status,201,JSON.stringify(setup));
      const local = {cookie:setup.cookie,csrfToken:setup.data.csrfToken};
      const claim = await direct('/cloud/claims',{},local);
      assert.equal((await direct('/cloud/binding',{claimId:claim.data.claimId,accessToken:logged.access_token},local)).status,200);
      await waitFor(()=>host.relayStatus().state==='online', 'frpc did not become online: '+JSON.stringify(host.relayStatus()));
      const pairing = await direct('/cloud/pairings',{},local); assert.equal(pairing.status,201);
      const base = host.relayStatus().baseUrl, domain = new URL(base).hostname;
      const ca = await readFile(path.join(root,'host','relay-tls','development-ca.pem'));
      const peerCert = await readFile(path.join(root,'host','relay-tls','development-host.pem'));
      assert.equal(tlsSpki(peerCert),pairing.data.tlsSpki); assert.equal(pairing.data.relay.baseUrl,base);
      function request(route,{method='GET',body,raw,headers={},pin=pairing.data.tlsSpki,port=frontPort,streaming=false}={}) {
        return new Promise((resolve,reject)=> {
          const req = httpsRequest({hostname:'127.0.0.1',port,servername:domain,path:'/personal/v1'+route,method,ca,agent:false,
            checkServerIdentity:(name,cert)=>checkServerIdentity(name,cert)??(tlsSpki(cert.raw)===pin?undefined:Object.assign(new Error('TLS_PIN_MISMATCH'),{code:'TLS_PIN_MISMATCH'})),
            headers:{host:domain,...(body!==undefined?{origin:base,'content-type':'application/json'}:{}),...headers}},res=> {
              if(streaming){res.on('error',()=>{});resolve({req,res});return;}
              const chunks=[]; res.on('data',c=>chunks.push(c)); res.on('error',reject);
              res.on('end',()=>{const bytes=Buffer.concat(chunks);let data;try{data=JSON.parse(bytes)}catch{data=bytes.toString()}
                resolve({status:res.statusCode,data,bytes,headers:res.headers});});
            });
          req.on('error',reject); req.setTimeout(10_000,()=>req.destroy(new Error('request timeout')));
          req.end(raw??(body===undefined?undefined:JSON.stringify(body)));
        });
      }
      const login = await request('/auth/login',{method:'POST',body:{username:'synthetic-relay',password,deviceName:'Remote Browser'}});
      assert.equal(login.status,200,JSON.stringify(login.data)); assert.match(login.headers['set-cookie'][0],/Secure/);
      const cookie = login.headers['set-cookie'][0].split(';')[0], csrf = login.data.csrfToken;
      const auth = {cookie,'x-weftmate-csrf':csrf};
      assert.equal((await request('/status',{headers:auth})).data.relay.state,'online');
      assert.equal((await request('/auth/setup',{method:'POST',body:{},headers:auth})).status,403);
      assert.equal((await request('/cloud/pairings',{method:'POST',body:{},headers:auth})).status,403);
      assert.equal((await request('/auth/logout',{method:'POST',body:{},headers:{cookie}})).status,403);
      assert.equal((await request('/status',{headers:{...auth,'x-forwarded-host':domain}})).status,403);
      assert.equal((await request('/status',{headers:{...auth,forwarded:'proto=https'}})).status,403);
      assert.equal((await request('/status',{headers:{...auth,origin:'https://api.example.com'}})).status,403);
      const curl = await run('curl',['--silent','--show-error','--fail','--noproxy','*','--cacert',path.join(root,'host','relay-tls','development-ca.pem'),
        '--resolve',`${domain}:${frontPort}:127.0.0.1`,'-H',`Host: ${domain}`,'-H',`Cookie: ${cookie}`,`${base}:${frontPort}/personal/v1/status`]);
      assert.equal(JSON.parse(curl.stdout).state,'ready');
      await host.attachSession('session-relay-history');
      const latest = await request('/sessions/session-relay-history/events?limit=100',{headers:auth});
      assert.equal(latest.data.events[0].seq,2100); assert.equal(latest.data.latestSeq,2199);
      const older = await request(`/sessions/session-relay-history/events?beforeSeq=${latest.data.nextBeforeSeq}&limit=100`,{headers:auth});
      assert.equal(older.data.events[0].seq,2000); assert.equal(older.data.events.at(-1).seq,2099);
      const conversationId=randomUUID(),messageId=randomUUID(),attachmentId=`attachment-${randomUUID()}`;
      const bytes=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.from(marker.repeat(1600)),Buffer.from('0000000049454e44ae426082','hex')]);
      const sha=createHash('sha256').update(bytes).digest('hex');
      const uploaded=await request(`/sync/attachments/${attachmentId}?conversationId=${conversationId}&messageId=${messageId}&name=image.png`,
        {method:'PUT',raw:bytes,headers:{...auth,origin:base,'content-type':'image/png','x-weftmate-sha256':sha}});
      assert.equal(uploaded.status,201,JSON.stringify(uploaded.data));
      const ref=await request('/sync/events',{method:'POST',headers:auth,body:{events:[{eventId:randomUUID(),conversationId,clientSeq:1,kind:'message.created',
        occurredAt:new Date().toISOString(),payload:{messageId,role:'user',text:marker,attachments:[uploaded.data.attachment]}}]}});
      assert.equal(ref.status,200,JSON.stringify(ref.data));
      const downloaded=await request(`/sync/attachments/${attachmentId}`,{headers:auth});
      assert.equal(downloaded.status,200); assert.equal(createHash('sha256').update(downloaded.bytes).digest('hex'),sha);
      stream=await request('/app/updates',{headers:auth,streaming:true});
      assert.equal(stream.res.statusCode,200); let events=''; stream.res.on('data',chunk=>events+=chunk);
      await waitFor(()=>events.includes('connected'),'SSE initial frame');
      await publishMobileUi({sourceDir:source,outputDir:bundles,uiVersion:'0.2.1',privateKey:updatePrivateKey});
      await waitFor(()=>events.includes('0.2.1'),'SSE update did not arrive');
      const closed=new Promise(r=>stream.res.once('close',r)); f.identity.relay.control.disconnect(started.hostId); await closed;
      await waitFor(()=>host.relayStatus().state==='online' && frps.logs().split('login').length>2,'Reconnect did not succeed',40_000);
      await waitFor(async()=>{try{return (await request('/status',{headers:auth})).status===200}catch{return false}},'Reconnected route missing');
      // A separately claimed host attempts the existing domain with its own credential.
      const other=await generateKeyPair('ES256'), otherId='host-relay-other', otherClaim=randomUUID();
      const otherChallenge=await f.api(`${P}/hosts/claims`,{method:'POST',status:200,body:{hostId:otherId,claimId:otherClaim,publicJwk:await exportJWK(other.publicKey),tlsSpki:'b'.repeat(43)}});
      const otherProof=await new SignJWT({claimId:otherClaim,challenge:otherChallenge.data.challenge,sub:account.cloudAccountId})
        .setProtectedHeader({alg:'ES256',typ:'wm-host-claim+jwt'}).setIssuer(otherId).setAudience(f.config.issuer).setIssuedAt().setExpirationTime('60s').sign(other.privateKey);
      await f.api(`${P}/hosts/claims/confirm`,{method:'POST',status:200,body:{claimId:otherClaim,proof:otherProof},headers:{authorization:`Bearer ${logged.access_token}`}});
      const otherCredential=await f.identity.relay.hostRequest('/hosts/relay/credentials',otherId,{});
      const rogueAdmin=await freePort(), rogueFile=path.join(infra,'rogue.toml');
      await writeFile(rogueFile,frpcConfig({credentials:{...otherCredential,serverAddr:'127.0.0.1',serverPort:frontPort,baseUrl:base},localPort:1,
        transportCaFile:path.join(infra,'cert.pem'),adminPort:rogueAdmin,adminPassword:'isolated-admin'}));
      const rogue=processChild(path.join(frpDir,'frpc'),['-c',rogueFile]);procs.push(rogue);
      await waitFor(async()=>{try{const r=await fetch(`http://127.0.0.1:${rogueAdmin}/api/status`,{headers:{authorization:`Basic ${Buffer.from('relay:isolated-admin').toString('base64')}`}});
        return (await r.json()).https?.some(p=>p.status==='start error')}catch{return false}},'Foreign domain was not rejected');
      assert.equal((await request('/status',{headers:auth})).status,200); await rogue.close();
      await assert.rejects(request('/status',{headers:auth,pin:'a'.repeat(43)}),/TLS_PIN_MISMATCH/);
      // Forge a same-domain certificate signed by the trusted development CA.
      await run('openssl',['req','-new','-newkey','rsa:2048','-nodes','-keyout',path.join(infra,'fake-key.pem'),'-out',path.join(infra,'fake.csr'),'-subj',`/CN=${domain}`]);
      await run('openssl',['x509','-req','-in',path.join(infra,'fake.csr'),'-CA',path.join(root,'host','relay-tls','development-ca.pem'),
        '-CAkey',path.join(root,'host','relay-tls','development-ca-key.pem'),'-CAcreateserial','-out',path.join(infra,'fake-cert.pem'),'-days','1',
        '-extfile',path.join(root,'host','relay-tls','csr.cnf'),'-extensions','ext']);
      fakeTls=httpsServer({cert:await readFile(path.join(infra,'fake-cert.pem')),key:await readFile(path.join(infra,'fake-key.pem'))},(_,res)=>res.end('forged'));
      fakeTls.on('connection',socket=>{fakeSockets.add(socket);socket.once('close',()=>fakeSockets.delete(socket));});
      fakeTls.listen(0,'127.0.0.1');await once(fakeTls,'listening');
      await assert.rejects(request('/status',{headers:auth,port:fakeTls.address().port}),/TLS_PIN_MISMATCH/);
      const certPath=path.join(root,'host','relay-tls','development-host.pem');
      await writeFile(certPath,await readFile(path.join(infra,'fake-cert.pem')));
      await assert.rejects(host.reloadRelayCertificate(),/TLS renewal changed key/);
      await writeFile(certPath,peerCert);await host.reloadRelayCertificate();
      assert.equal((await request('/status',{headers:auth})).status,200);
      // Rotate while live: old sockets close, same origin and pin, fresh frpc resumes.
      const beforeRotate=f.db.prepare('SELECT generation FROM host_relays WHERE host_id=?').get(started.hostId).generation;
      await host.rotateRelayCredential('rotation-e2e');
      await waitFor(()=>host.relayStatus().state==='online','Credential rotation did not reconnect');
      assert.equal(f.db.prepare('SELECT generation FROM host_relays WHERE host_id=?').get(started.hostId).generation,beforeRotate+1);
      stream=await request('/app/updates',{headers:auth,streaming:true});stream.res.resume();
      const revoked=new Promise(r=>stream.res.once('close',r));
      const revokeAt=Date.now();
      const result=await f.api(`${P}/hosts/relay/account-revoke`,{method:'POST',status:200,body:{hostId:started.hostId},headers:{authorization:`Bearer ${logged.access_token}`}});
      await revoked; const revokeMs=Date.now()-revokeAt; assert.ok(result.data.closedConnections>=2);
      await assert.rejects(request('/status',{headers:auth}));
      assert.equal((await direct('/status',undefined,local)).status,200,'Direct local access survives relay revocation');
      const captured=Buffer.concat(wireChunks);
      assert.ok(captured.length>bytes.length); assert.equal(captured.includes(Buffer.from(marker)),false);
      assert.equal(captured.includes(Buffer.from(password)),false); assert.equal(captured.includes(Buffer.from(cookie)),false);
      assert.doesNotMatch(f.logs()+frps.logs(),new RegExp(marker+'|'+password));
      const proofReport={port:frontPort,frpVersion:'0.71.0',capturedTlsBytes:captured.length,plaintextMarkerFound:false,
        login:true,sse:true,history2200:true,attachmentSha256:true,reconnect:true,foreignDomainRejected:true,
        spkiReplacementRejected:true,forgedCertificateRejected:true,credentialRotation:true,revokeMs,loopbackOnly:true};
      if(process.env.WEFTMATE_RELAY_REPORT)await writeFile(process.env.WEFTMATE_RELAY_REPORT,JSON.stringify(proofReport,null,2)+'\n');
      t.diagnostic(JSON.stringify(proofReport));
    } catch (error) {
      for (const proc of procs) t.diagnostic(`sidecar exit=${proc.child.exitCode}; log bytes=${proc.logs().length}`);
      t.diagnostic(JSON.stringify(host?.relayStatus()));
      throw error;
    } finally {
      stream?.req.destroy(); await host?.close();
      for(const socket of fakeSockets)socket.destroy();
      if(fakeTls)await new Promise(r=>{fakeTls.close(r);fakeTls.closeAllConnections()});
    }
  });
