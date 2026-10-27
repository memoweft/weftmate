import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer as netServer } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { Resolver } from 'node:dns/promises';
import { X509Certificate } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { FlattenedSign, importJWK } from 'jose';
import { fixture } from './identity-helpers.mjs';
import { appDevice, control, refresh, proof } from './app-helpers.mjs';
import { createAliyunDns, waitForAuthoritativeTxt } from '../src/dns-aliyun.mjs';
import { fakeAliyun, TEST_ACCESS_KEY_ID as accessKeyId, TEST_ACCESS_KEY_SECRET as accessKeySecret } from './dns-aliyun-helpers.mjs';
import { createPersonalAccessService } from '../../../src/personal-access/index.mjs';
import { createHostCloudIdentity } from '../../../src/personal-cloud/index.mjs';
import { createCertificateManager, issueHostCertificate } from '../../../src/personal-relay/certificates.mjs';
import { tlsSpki } from '../../../src/personal-relay/tls.mjs';

async function port() {
  const s = netServer(); await new Promise(r => s.listen(0, '127.0.0.1', r));
  const p = s.address().port; await new Promise(r => s.close(r)); return p;
}
async function waitFor(check, label) {
  const until = Date.now() + 30_000;
  do { if (await check()) return; await new Promise(r => setTimeout(r, 30)); } while (Date.now() < until);
  throw new Error(`Timed out: ${label}`);
}
function child(binary, args, env) {
  const process = spawn(binary, args, { env: { ...globalThis.process.env, ...env }, stdio: ['ignore','pipe','pipe'] });
  let output = ''; process.stdout.on('data', c => output += c); process.stderr.on('data', c => output += c);
  return { process, output: () => output, close: () => new Promise(resolve => {
    if (process.exitCode !== null || process.signalCode !== null) return resolve();
    process.once('exit', resolve); process.kill('SIGTERM');
  }) };
}

// Pebble 2.10.1 uses rand.Intn(100) > reusePercent, so even 0 permits
// reuse 1% of the time. Exercise both paths deliberately, keeping all original
// fresh-DNS assertions: deactivate the first authz only in that scenario.
const reports = [];
for (const reuseAuthorization of [false, true])
test(`Pebble DNS-01: real host proof → AliDNS API/TXT → issuance → installed TLS/pairing pin → daily renewal without adapter restart (${reuseAuthorization ? 'reused authorization' : 'fresh authorization'})`,
  { skip: process.env.WEFTMATE_PEBBLE_E2E !== 'true', timeout: 120_000 }, async t => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'wm-pebble-')));
    const tools = path.resolve('.local/pebble');
    const [acmePort, managementPort, dnsPort, dnsManagementPort, unusedRelayPort] = await Promise.all(Array.from({ length: 5 }, port));
    const directoryUrl = `https://localhost:${acmePort}/dir`;
    const management = `http://127.0.0.1:${dnsManagementPort}`;
    const config = path.join(root, 'pebble.json');
    await writeFile(config, JSON.stringify({ pebble: {
      listenAddress: `127.0.0.1:${acmePort}`, managementListenAddress: `127.0.0.1:${managementPort}`,
      certificate: path.join(tools,'certs/localhost/cert.pem'), privateKey: path.join(tools,'certs/localhost/key.pem'),
      httpPort: 5002, tlsPort: 5001, retryAfter: { authz: 0, order: 0 },
    } }));
    const dns = child(path.join(tools,'bin/pebble-challtestsrv'), ['-dnsserver', `127.0.0.1:${dnsPort}`, '-management', `127.0.0.1:${dnsManagementPort}`,
      '-http01','','-https01','','-tlsalpn01','','-doh','']);
    const pebble = child(path.join(tools,'bin/pebble'), ['-config', config, '-dnsserver', `127.0.0.1:${dnsPort}`],
      { PEBBLE_VA_NOSLEEP: '1', PEBBLE_AUTHZREUSE: '100', PEBBLE_WFE_NONCEREJECT: '0' });
    t.after(async () => { await pebble.close(); await dns.close(); await rm(root,{recursive:true,force:true}); });
    await waitFor(async () => { try { return (await fetch(directoryUrl)).ok; } catch { return false; } }, 'Pebble directory');
    const resolver = new Resolver({ timeout: 1000, tries: 1 }); resolver.setServers([`127.0.0.1:${dnsPort}`]);
    const fake = await fakeAliyun(t, { onUpdate: async (records, name) => {
      const values = [...records.values()].filter(r => r.name === name).map(r => r.value);
      await fetch(`${management}/clear-txt`, { method:'POST', body:JSON.stringify({ host:`${name}.` }) });
      for (const value of values) await fetch(`${management}/set-txt`, { method:'POST', body:JSON.stringify({ host:`${name}.`, value }) });
    } });
    const f = await fixture(t, { env: { CLOUD_RELAY_DOMAIN:'hosts.example.com' }, relayDns: database => createAliyunDns({
      database, zone:'example.com', accessKeyId, accessKeySecret, endpoint:fake.endpoint,
      waitForTxt: data => waitForAuthoritativeTxt({ ...data, resolvers:[resolver], intervalMs:10, timeoutMs:2000 }),
    }) });
    const clockTimer = setInterval(() => f.advance(Date.now() - f.now),250);
    t.after(() => clearInterval(clockTimer));
    await f.verified(); const logged = await f.signedIn();
    let host, renewal;
    const diagnostic = error => t.diagnostic(JSON.stringify(error.stage ? error : { code: error.code ?? 'RELAY_UNAVAILABLE' }));
    async function initialIssuance(options) {
      let directory, accountUrl, authorizationUrl;
      const certificate = await issueHostCertificate({ ...options, fetcher: async (url, init) => {
        const response = await fetch(url, init);
        if (url === directoryUrl) directory = await response.clone().json();
        if (url === directory?.newAccount) accountUrl = response.headers.get('location');
        if (url === directory?.newOrder) authorizationUrl = (await response.clone().json()).authorizations[0];
        return response;
      } });
      if (!reuseAuthorization) {
        const nonce = await fetch(directory.newNonce, { method: 'HEAD' });
        const proof = await new FlattenedSign(Buffer.from(JSON.stringify({ status: 'deactivated' })))
          .setProtectedHeader({ alg: 'ES256', kid: accountUrl, nonce: nonce.headers.get('replay-nonce'), url: authorizationUrl })
          .sign(await importJWK(options.accountKey, 'ES256'));
        const response = await fetch(authorizationUrl, { method: 'POST',
          headers: { 'content-type': 'application/jose+json', 'user-agent': 'weftmate-test/0.1.0' }, body: JSON.stringify(proof) });
        assert.ok(response.ok, 'fixture deactivates the first authorization before fresh-DNS renewal');
        assert.equal((await response.json()).status, 'deactivated');
      }
      return certificate;
    }
    try {
      const hostRoot = path.join(root,'host');
      const backend = { getStatus:async()=>({runtime:'ready'}),listModels:async()=>[],preflight:async()=>({ok:true}),
        createSession:async()=>({}),sendMessage:async()=>({}),cancelSession:async()=>({}),readEvents:async()=>({events:[],nextSeq:-1,hasMore:false}),describeSession:async()=>({}) };
      host = await createPersonalAccessService({ root:hostRoot,port:0,backend,
        cloudIdentity:{issuer:f.config.issuer,allowInsecureLoopback:true},
        relay:{binary:process.env.WEFTMATE_FRPC_FILE,transportCaFile:path.join(tools,'certs/pebble.minica.pem'),
          connectAddress:'127.0.0.1',connectPort:unusedRelayPort,acme:{directoryUrl,issue:initialIssuance},diagnostic} });
      const started = await host.start();
      async function direct(route, body, auth) {
        const response = await fetch(`${started.origin}/personal/v1${route}`, { method:body!==undefined?'POST':'GET',headers:{
          ...(body!==undefined?{origin:started.origin,'content-type':'application/json'}:{}),
          ...(auth?{cookie:auth.cookie,'x-weftmate-csrf':auth.csrfToken}:{}) },body:body!==undefined?JSON.stringify(body):undefined });
        const data = await response.json(); assert.ok(response.ok, JSON.stringify(data));
        return {data,cookie:response.headers.get('set-cookie')?.split(';')[0]};
      }
      const setup = await direct('/auth/setup',{grant:(await host.issueSetupGrant()).grant,username:'cert-test',password:'synthetic certificate password',deviceName:'Test host'});
      const auth = {cookie:setup.cookie,csrfToken:setup.data.csrfToken};
      const claim = await direct('/cloud/claims',{},auth);
      await direct('/cloud/binding',{claimId:claim.data.claimId,accessToken:logged.access_token},auth);
      const certFile = path.join(hostRoot,'relay-tls/host-fullchain.pem');
      await waitFor(async () => {
        if (host.relayStatus().certificateErrorCode) throw new Error(host.relayStatus().certificateErrorCode);
        try { return (await readFile(path.join(hostRoot,'relay/frpc.toml'),'utf8')).includes('localPort'); } catch { return false; }
      }, 'certificate and TLS adapter installed');
      const pairing = (await direct('/cloud/pairings',{},auth)).data;
      // Certificate preview must not leave an active desktop-confirmation gate.
      assert.equal((await direct('/cloud/pairings/decision',{challenge:pairing.challenge,decision:'cancel'},auth)).data.state,'cancelled');
      const domain = new URL(pairing.relay.baseUrl).hostname;
      const original = await readFile(certFile);
      assert.equal(tlsSpki(original),pairing.tlsSpki);
      const cloudCalls = fake.calls.filter(c=>c.action==='AddDomainRecord');
      assert.equal(cloudCalls.length,1); assert.equal(cloudCalls[0].parameters.RR,`_acme-challenge.${domain.slice(0,-12)}`);
      assert.equal(fake.records.size,1,'only unrelated record remains after cleanup');
      const contentCa = await (await fetch(`https://localhost:${managementPort}/roots/0`)).text();
      const configBefore = await readFile(path.join(hostRoot,'relay/frpc.toml'),'utf8');
      const adapterPort = Number(/^localPort = (\d+)$/m.exec(configBefore)[1]);
      async function tlsRequest(route,{method='GET',body,headers={}}={}) {
        return new Promise((resolve,reject)=> {
          const request = httpsRequest({hostname:'127.0.0.1',port:adapterPort,servername:domain,ca:contentCa,agent:false,
            path:'/personal/v1'+route,method,headers:{host:domain,
              ...(body!==undefined?{origin:pairing.relay.baseUrl,'content-type':'application/json'}:{}),...headers}}, response=> {
            const cert = response.socket.getPeerCertificate().raw;
            const chunks=[];response.on('data',c=>chunks.push(c));response.on('end',()=>resolve({
              cert,status:response.statusCode,headers:response.headers,data:JSON.parse(Buffer.concat(chunks).toString())}));
          });request.on('error',reject);request.end(body===undefined?undefined:JSON.stringify(body));
        });
      }
      const localReplay = await tlsRequest('/status',{headers:{cookie:auth.cookie}});
      assert.equal(localReplay.status,403,JSON.stringify(localReplay.data));
      assert.equal(localReplay.data.error.code,'CLOUD_LOGIN_REQUIRED');
      assert.equal(tlsSpki(localReplay.cert),pairing.tlsSpki,'rejected local credentials still traverse the original validated host certificate');
      const remote = await appDevice(f,'synthetic-certificate-browser');
      const selected = (await control(remote,'/hosts/connect',{hostId:started.hostId})).data;
      assert.equal(selected.approval,'trusted'); assert.equal(selected.pairingRequired,false);
      await refresh(remote,selected.resource);
      const nonce = await tlsRequest('/auth/cloud-nonce',{method:'POST',body:{}}); assert.equal(nonce.status,200);
      const dpop = await proof(remote,pairing.relay.baseUrl+'/personal/v1/auth/cloud-session',remote.tokens.access_token,{nonce:nonce.data.nonce});
      const session = await tlsRequest('/auth/cloud-session',{method:'POST',headers:{dpop},
        body:{accessToken:remote.tokens.access_token,deviceName:'Synthetic certificate browser'}});
      assert.equal(session.status,200,JSON.stringify(session.data)); assert.ok(session.data.hostTrust?.trustToken);
      assert.equal(session.data.account.ownerId,setup.data.account.ownerId);
      assert.match(session.headers['set-cookie'][0],/Secure/); assert.match(session.headers['set-cookie'][0],/HttpOnly/);
      const remoteCookie = session.headers['set-cookie'][0].split(';')[0];
      const tlsStatus = () => tlsRequest('/status',{headers:{cookie:remoteCookie}});
      const first = await tlsStatus(); assert.equal(first.status,200); assert.equal(tlsSpki(first.cert),pairing.tlsSpki);
      assert.equal(first.data.relay.certificateExpiresAt,new Date(new X509Certificate(original).validTo).toISOString());
      assert.equal(first.data.relay.certificateErrorCode,null);
      const existingTls = (await import('node:tls')).connect({host:'127.0.0.1',port:adapterPort,servername:domain,ca:contentCa});
      await new Promise((resolve,reject)=>{existingTls.once('secureConnect',resolve);existingTls.once('error',reject)});
      let existingClosed = false; existingTls.once('close',()=>{existingClosed=true});
      t.after(()=>existingTls.destroy());
      // A second manager models restart at 29 days remaining, reading the same
      // persisted account and cert; callback reloads the *existing* adapter.
      const identity = await createHostCloudIdentity({root:hostRoot,rootState:{hostId:started.hostId},timestamp:Date.now},
        {issuer:f.config.issuer,allowInsecureLoopback:true});
      const identityBefore = JSON.parse(await readFile(path.join(hostRoot,'cloud-identity/identity.json'),'utf8'));
      let clock = Date.parse(new X509Certificate(original).validTo) - 29*86_400_000;
      renewal = await createCertificateManager({root:hostRoot,domain,identity,directoryUrl,now:()=>clock,diagnostic,
        onInstalled:()=>host.reloadRelayCertificate()});
      await renewal.check(); assert.equal(renewal.status().certificateErrorCode,null);
      const renewed = await tlsStatus(); assert.equal(renewed.status,200); assert.equal(tlsSpki(renewed.cert),pairing.tlsSpki);
      assert.notEqual(new X509Certificate(first.cert).serialNumber,new X509Certificate(renewed.cert).serialNumber);
      assert.equal(existingClosed,false,'hot reload preserves live TLS connections');
      assert.equal(await readFile(path.join(hostRoot,'relay/frpc.toml'),'utf8'),configBefore,'adapter port and sidecar config unchanged');
      const identityAfter = JSON.parse(await readFile(path.join(hostRoot,'cloud-identity/identity.json'),'utf8'));
      // Trusted-device status may finish publishing while the certificate renews.
      // Compare actual key material, not the legitimately changing outbox; use
      // boolean deep comparisons so a failure never prints private JWK fields.
      assert.ok(isDeepStrictEqual(identityAfter.tls.privateJwk,identityBefore.tls.privateJwk),'content private key unchanged');
      assert.equal(identityAfter.tls.spki,identityBefore.tls.spki,'content key fingerprint unchanged');
      assert.ok(isDeepStrictEqual(identityAfter.installation.privateJwk,identityBefore.installation.privateJwk),'installation private key unchanged');
      assert.ok(isDeepStrictEqual(identityAfter.installation.publicJwk,identityBefore.installation.publicJwk),'installation public key unchanged');
      assert.equal(identityAfter.hostId,identityBefore.hostId,'installation host identity unchanged');
      if (reuseAuthorization) {
        assert.equal(fake.calls.filter(c=>c.action==='AddDomainRecord').length,1,'reused valid authorization needs no new TXT');
        await renewal.check(); assert.equal(fake.calls.filter(c=>c.action==='AddDomainRecord').length,1,'no retry before tomorrow');
      } else {
        assert.equal(fake.calls.filter(c=>c.action==='AddDomainRecord').length,2);
        await renewal.check(); assert.equal(fake.calls.filter(c=>c.action==='AddDomainRecord').length,2,'no retry before tomorrow');
      }
      assert.equal(fake.records.size,1);
      const report={ca:'Pebble 2.10.1',authorization:reuseAuthorization?'reused':'fresh',signedHostDns:true,aliDnsV3:true,dns01:true,hotReload:true,pairingPinUnchanged:true,
        renewal:true,liveConnectionPreserved:true,ownedTxtCleaned:true,cloudVerifiedDpop:true,localCookieReplayRejected:true};
      reports.push(report);
      if(process.env.WEFTMATE_PEBBLE_REPORT)await writeFile(process.env.WEFTMATE_PEBBLE_REPORT,JSON.stringify({scenarios:reports},null,2)+'\n');
      t.diagnostic(JSON.stringify(report));
    } catch(error) { t.diagnostic(pebble.output());t.diagnostic(dns.output());t.diagnostic(JSON.stringify(host?.relayStatus()));throw error; }
    finally { await renewal?.close();await host?.close(); }
  });
