import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostDiagnostics } from '../src/host-diagnostics.mjs';
import { createModelScheduler } from '../src/model-scheduler.mjs';
import { acquireModelSlot } from '../src/model-scheduler-client.mjs';
import { generateKeyPairSync } from 'node:crypto';
import { createCertificateManager } from '../src/personal-relay/certificates.mjs';
import { tlsSpki } from '../src/personal-relay/tls.mjs';
import { syntheticCertificate } from './helpers/r0-2-certificates.mjs';

test('first text, rather than thinking or later chunks, records one latency without reply content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wm-r02-metrics-'));
  const diagnostics = createHostDiagnostics(root, {version:'0.1.0'}); diagnostics.begin();
  const scheduler = await createModelScheduler({isIdle:async()=>true,
    profileFor:()=>({baseUrl:'https://synthetic.invalid/v1',model:'synthetic'}),
    credentialFor:()=>null,backgroundRoute:()=>null,
    onEvent:(event,data)=>diagnostics.write(event,data)});
  let release;
  try {
    diagnostics.write('host.ready',{durationMs:1234});
    release = await acquireModelSlot('foreground',undefined,scheduler.url,{sessionId:'synthetic-session',profileId:'synthetic'});
    const report = async phase => {
      const response = await fetch(scheduler.url+'/progress',{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({sessionId:'synthetic-session',phase,content:'synthetic-private-reply'})});
      assert.equal(response.status,204);
    };
    await report('reasoning'); assert.deepEqual(diagnostics.performance().firstTokenMs,[]);
    await report('answering'); await report('reasoning'); await report('answering');
    assert.equal(diagnostics.performance().startupMs,1234);
    assert.equal(diagnostics.performance().firstTokenMs.length,1);
    const records = diagnostics.records();
    assert.equal(records.filter(row=>row.event==='model.first_token').length,1);
    assert.ok(diagnostics.performance().firstTokenMs[0]>=0);
    assert.ok(!JSON.stringify(records).includes('synthetic-private-reply'));
    await release(); release = null; await scheduler.close();
    diagnostics.exit('user-quit');
    const next = createHostDiagnostics(root,{version:'0.1.0'}); next.begin();
    assert.equal(next.performance().firstTokenMs.length,1,'recent samples survive the next app launch');
    assert.equal(next.performance().startupMs,null,'startup always measures the current launch');
    next.exit('user-quit');
  } finally { await release?.(); await scheduler.close(); await rm(root,{recursive:true,force:true}); }
});

test('certificate repair retries issuance before its daily retry time without restarting other components', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wm-r02-certificate-'));
  const {privateKey} = generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const certificate = syntheticCertificate(false,privateKey);
  const identity = {tls:()=>({privateJwk:privateKey.export({format:'jwk'}),spki:tlsSpki(certificate)}),relayRequest:async()=>{}};
  let attempts=0,installed=0;
  const manager = await createCertificateManager({root,domain:'r0-2.invalid',identity,
    issue:async()=>{attempts++;if(attempts===1)throw Object.assign(new Error('synthetic-private-response'),{code:'CLOUD_UNAVAILABLE'});return certificate;},
    onInstalled:async()=>{installed++;}});
  try {
    await manager.check(); assert.equal(attempts,1); assert.equal(manager.status().certificateErrorCode,'CLOUD_UNAVAILABLE');
    await manager.check(); assert.equal(attempts,1,'routine check respects the existing daily retry date');
    await manager.retry(); assert.equal(attempts,2); assert.equal(installed,1);
    assert.equal(manager.status().certificateErrorCode,null);
    assert.equal(manager.status().certificateExpiresAt,'2040-01-01T00:00:00.000Z');
    assert.ok(!JSON.stringify(manager.status()).includes('synthetic-private-response'));
  } finally { await manager.close(); await rm(root,{recursive:true,force:true}); }
});
