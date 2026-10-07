import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash, createPublicKey } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, stat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCertificateManager } from '../../../src/personal-relay/certificates.mjs';
import { developmentCertificate } from '../../../src/personal-relay/tls.mjs';
const DAY = 86_400_000, domain = `h-${'b'.repeat(32)}.hosts.example.com`;
function identity() {
  const privateKey = generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey;
  const privateJwk = privateKey.export({format:'jwk'});
  const spki = createHash('sha256').update(createPublicKey(privateKey).export({format:'der',type:'spki'})).digest('base64url');
  return {tls:()=>({privateJwk,spki}),relayRequest:async()=>{}};
}

test('certificate failures keep the last good cert; retry once a day survives restart, and mismatched key is refused before install', async t => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(),'wm-cert-test-')));t.after(()=>rm(root,{recursive:true,force:true}));
  const host = identity(), files = await developmentCertificate({root,domain,...host.tls()});
  const good = await readFile(files.certFile), certFile = path.join(root,'relay-tls/host-fullchain.pem');
  await writeFile(certFile,good);
  let calls = 0, installed = 0, clock = Date.now();
  const options = {root,domain,identity:host,now:()=>clock,onInstalled:async()=>{installed++},
    issue:async()=>{calls++;throw Object.assign(new Error('synthetic secret must never appear in status'),{code:'DNS_NOT_CONFIGURED'})}};
  let manager = await createCertificateManager(options);
  await manager.check(); assert.equal(manager.status().certificateErrorCode,'DNS_NOT_CONFIGURED');
  assert.ok(manager.status().certificateExpiresAt); assert.equal(installed,0);
  assert.deepEqual(await readFile(certFile),good);
  await manager.check();assert.equal(calls,1);await manager.close();
  manager=await createCertificateManager(options);await manager.check();assert.equal(calls,1,'restart respects daily failure backoff');
  assert.equal(manager.status().certificateErrorCode,'DNS_NOT_CONFIGURED');
  clock+=DAY;await manager.check();assert.equal(calls,2);await manager.close();
  const foreignRoot=path.join(root,'foreign'),foreign=identity();
  const wrongFiles=await developmentCertificate({root:foreignRoot,domain,...foreign.tls()});
  clock+=DAY;
  manager=await createCertificateManager({...options,issue:async()=>readFile(wrongFiles.certFile)});
  await manager.check();assert.equal(manager.status().certificateErrorCode,'CERTIFICATE_KEY_DOMAIN_MISMATCH');
  assert.deepEqual(await readFile(certFile),good);assert.equal(installed,0);await manager.close();
  clock+=DAY;
  manager=await createCertificateManager({...options,issue:async()=>good});
  await manager.check();assert.equal(manager.status().certificateErrorCode,null);assert.equal(installed,1);
  if(process.platform!=='win32')assert.equal((await stat(certFile)).mode&0o777,0o600);
  await manager.close();
});
