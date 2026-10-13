import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash, createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import { migrate } from '../src/database.mjs';
import { createCloudBackups, BACKUP_LIMITS, pruneCloudBackups, backupDeletionVerification } from '../src/cloud-backups.mjs';
import { fixture as identityFixture, P, PASSWORD, generateKeyPair, exportJWK, SignJWT } from './identity-helpers.mjs';
import { registration, appDevice, control } from './app-helpers.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const keyEnvelope = keyId => ({ protocol:'wm-cloud-key/1',version:1,keyId,
  salt:randomBytes(32).toString('base64url'),iv:randomBytes(12).toString('base64url'),
  ciphertext:randomBytes(32).toString('base64url'),tag:randomBytes(16).toString('base64url') });
function packageOf(keyId, count = 2, length = 32, text) {
  const buffers = Array.from({ length:count }, (_, index) => {
    if (!text) return randomBytes(length);
    const c = createCipheriv('aes-256-gcm', randomBytes(32), randomBytes(12));
    return Buffer.concat([c.update(`${text}-${index}`),c.final(),c.getAuthTag()]);
  });
  const manifest = { id:randomUUID(),version:1,keyId,createdAt:new Date(1000).toISOString(),totalBytes:buffers.reduce((n,b)=>n+b.length,0),chunkCount:count,
    packageHash:sha(Buffer.concat(buffers)),chunks:buffers.map((b,index)=>({index,size:b.length,hash:sha(b),iv:randomBytes(12).toString('base64url')})) };
  return { manifest,buffers,upload:index=>({id:manifest.id,index,ciphertext:buffers[index].toString('base64url'),hash:manifest.chunks[index].hash}) };
}
async function fixture(t, config = {}) {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON'); await migrate(db); t.after(()=>db.close());
  for (const account of ['account','other']) db.prepare('INSERT INTO cloud_accounts(id,email,password,active,created_at) VALUES(?,?,?,?,?)')
    .run(account,`${account}@example.com`,'{}',1,0);
  let now=1000, accountId='account', deviceChecks=0;
  const options={ database:db,config,now:()=>now,authenticate:async (req,required)=>{assert.equal(required,true);deviceChecks++;return {id:accountId};} };
  let api=createCloudBackups(options);
  const request=(action,body={})=>api.handle('/backups/'+action,{},body);
  const key=keyEnvelope(randomUUID()); await request('key/write',{key,expectedRevision:0});
  return {db,key,request,advance:ms=>now+=ms,account:value=>accountId=value,checked:()=>deviceChecks,
    restart:()=>{api=createCloudBackups(options);},fill:async p=>{await request('start',p.manifest);for(let i=0;i<p.buffers.length;i++)await request('chunk/upload',p.upload(i));return request('complete',{id:p.manifest.id});} };
}

test('migration 010 adds only backup tables; key CAS and recovery code rotation preserve backup identity',async t=>{
  const f=await fixture(t);
  assert.deepEqual((await f.request('key/read')).key,f.key);
  await assert.rejects(f.request('key/write',{key:f.key,expectedRevision:0}),{code:'KEY_CHANGED'});
  const p=packageOf(f.key.keyId);await f.fill(p);
  const rotated=keyEnvelope(f.key.keyId);assert.deepEqual(await f.request('key/write',{key:rotated,expectedRevision:1}),{revision:2});
  assert.deepEqual((await f.request('key/read')).key,rotated);
  await assert.rejects(f.request('key/write',{key:keyEnvelope(randomUUID()),expectedRevision:2}),{code:'KEY_IN_USE'});
  assert.ok(f.checked()>0);
});

test('encrypted upload resumes after service restart; duplicate chunks and completion are idempotent',async t=>{
  const f=await fixture(t),p=packageOf(f.key.keyId);
  assert.deepEqual((await f.request('start',p.manifest)).received,[]);
  await f.request('chunk/upload',p.upload(1));f.restart();
  assert.deepEqual((await f.request('start',p.manifest)).received,[1]);
  await f.request('chunk/upload',p.upload(1));assert.equal(f.db.prepare('SELECT count(*) AS n FROM cloud_backup_chunks').get().n,1);
  await assert.rejects(f.request('complete',{id:p.manifest.id}),{code:'BACKUP_INCOMPLETE'});
  await f.request('chunk/upload',p.upload(0));const complete=await f.request('complete',{id:p.manifest.id});
  assert.equal(complete.usage.usedBytes,p.manifest.totalBytes);assert.equal(complete.usage.reservedBytes,0);
  assert.deepEqual(await f.request('complete',{id:p.manifest.id}),complete);
  assert.deepEqual((await f.request('list')).items,[complete.backup]);
  for(let index=0;index<2;index++)assert.equal((await f.request('chunk/download',{id:p.manifest.id,index})).ciphertext,p.upload(index).ciphertext);
});

test('modified, missing, reordered and contradictory chunk metadata cannot complete a backup',async t=>{
  const f=await fixture(t),p=packageOf(f.key.keyId);await f.request('start',p.manifest);
  await assert.rejects(f.request('start',{...p.manifest,chunks:[...p.manifest.chunks].reverse()}),{code:'INVALID_REQUEST'});
  await assert.rejects(f.request('start',{...p.manifest,totalBytes:p.manifest.totalBytes+1}),{code:'INVALID_REQUEST'});
  await assert.rejects(f.request('start',{...p.manifest,packageHash:'a'.repeat(64)}),{code:'REQUEST_CONFLICT'});
  const damaged={...p.upload(0),ciphertext:randomBytes(p.buffers[0].length).toString('base64url')};
  await assert.rejects(f.request('chunk/upload',damaged),{code:'CHUNK_MISMATCH'});
  await assert.rejects(f.request('chunk/upload',{...p.upload(0),index:1}),{code:'CHUNK_MISMATCH'});
  await assert.rejects(f.request('chunk/download',{id:p.manifest.id,index:0}),{code:'BACKUP_INCOMPLETE'});
  await assert.rejects(f.request('complete',{id:p.manifest.id}),{code:'BACKUP_INCOMPLETE'});
  for(let i=0;i<2;i++)await f.request('chunk/upload',p.upload(i));
  f.db.prepare('UPDATE cloud_backup_chunks SET ciphertext=? WHERE chunk_index=0').run(randomBytes(32));
  await assert.rejects(f.request('complete',{id:p.manifest.id}),{code:'CHUNK_MISMATCH'});
  assert.equal((await f.request('list')).items.length,0);
});

test('whole ciphertext reservation enforces account and shared quotas, releases on deletion, and cannot race',async t=>{
  const f=await fixture(t,{backupAccountBytes:100,backupGlobalBytes:120}),p=packageOf(f.key.keyId);
  const first=await f.request('start',p.manifest);assert.equal(first.usage.reservedBytes,64);
  const concurrent=await Promise.allSettled([f.request('start',packageOf(f.key.keyId).manifest),f.request('start',packageOf(f.key.keyId).manifest)]);
  assert.ok(concurrent.every(v=>v.status==='rejected'&&v.reason.code==='UPLOAD_IN_PROGRESS'));
  for(let i=0;i<2;i++)await f.request('chunk/upload',p.upload(i));await f.request('complete',{id:p.manifest.id});
  await assert.rejects(f.request('start',packageOf(f.key.keyId).manifest),e=>e.code==='BACKUP_QUOTA_EXCEEDED'&&e.details.usage.usedBytes===64);
  f.account('other');const otherKey=keyEnvelope(randomUUID());await f.request('key/write',{key:otherKey,expectedRevision:0});
  await assert.rejects(f.request('start',packageOf(otherKey.keyId).manifest),{code:'BACKUP_GLOBAL_QUOTA_EXCEEDED'});
  f.account('account');await f.request('delete',{id:p.manifest.id});f.account('other');
  assert.equal((await f.request('start',packageOf(otherKey.keyId).manifest)).usage.reservedBytes,64);
});

test('accounts cannot list, read, change or delete another account backup or wrapped key',async t=>{
  const f=await fixture(t),p=packageOf(f.key.keyId);await f.fill(p);f.account('other');
  assert.deepEqual(await f.request('key/read'),{key:null,revision:0,generation:0});assert.deepEqual((await f.request('list')).items,[]);
  for(const action of ['complete','delete'])await assert.rejects(f.request(action,{id:p.manifest.id}),{code:'NOT_FOUND'});
  for(const action of ['chunk/download','chunk/upload'])await assert.rejects(f.request(action,action==='chunk/download'?{id:p.manifest.id,index:0}:p.upload(0)),{code:'NOT_FOUND'});
  await f.request('clear');f.account('account');assert.equal((await f.request('list')).items.length,1);
});

test('retention keeps newest three complete snapshots; stale partial upload expires without losing complete data',async t=>{
  const f=await fixture(t),ids=[];
  for(let i=0;i<4;i++){const p=packageOf(f.key.keyId);await f.fill(p);ids.push(p.manifest.id);f.advance(1);}
  assert.deepEqual((await f.request('list')).items.map(i=>i.id),ids.slice(1).reverse());
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM cloud_backup_chunks').get().n,6);
  const pending=packageOf(f.key.keyId);await f.request('start',pending.manifest);await f.request('chunk/upload',pending.upload(0));
  f.advance(BACKUP_LIMITS.pendingTtl);pruneCloudBackups(f.db,1000+4+BACKUP_LIMITS.pendingTtl);
  assert.equal((await f.request('list')).items.length,3);assert.equal((await f.request('list')).usage.reservedBytes,0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM cloud_backup_chunks WHERE backup_id=?').get(pending.manifest.id).n,0);
});

test('true deletion removes wrapped key, all ciphertext and bookkeeping; account cascade applies same contract',async t=>{
  const f=await fixture(t);await f.fill(packageOf(f.key.keyId));
  assert.deepEqual((await f.request('clear')).verification,{backups:0,chunks:0,keys:0,quotaBytes:0});
  await f.request('key/write',{key:f.key,expectedRevision:0});await f.fill(packageOf(f.key.keyId));
  f.db.prepare('DELETE FROM cloud_accounts WHERE id=?').run('account');
  assert.deepEqual(backupDeletionVerification(f.db,'account'),{backups:0,chunks:0,keys:0,quotaBytes:0});
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM cloud_backup_chunks').get().n,0);
});

test('chunk sizes/counts, JSON fields, canonical binary and metadata frequency are bounded',async t=>{
  const f=await fixture(t),p=packageOf(f.key.keyId);
  await assert.rejects(f.request('start',{...p.manifest,chunkCount:513}),{code:'INVALID_REQUEST'});
  await assert.rejects(f.request('start',{...p.manifest,version:2}),{code:'INVALID_REQUEST'});
  await assert.rejects(f.request('start',{...p.manifest,chunks:p.manifest.chunks.map(c=>({...c,size:BACKUP_LIMITS.chunkBytes+1}))}),{code:'INVALID_REQUEST'});
  await assert.rejects(f.request('key/write',{key:{...f.key,salt:f.key.salt+'='},expectedRevision:1}),{code:'INVALID_REQUEST'});
  await assert.rejects(f.request('list',{accountId:'other'}),{code:'INVALID_REQUEST'});
  for(let i=0;i<114;i++)await f.request('list');await assert.rejects(f.request('list'),{code:'RATE_LIMITED'});
  f.advance(60000);assert.equal((await f.request('list')).items.length,0);
});

test('HTTP DPoP login uploads opaque bytes, password authorizes sensitive reveal, and logs contain no data',async t=>{
  const f=await identityFixture(t);const {account}=await registration(f);const device=await appDevice(f,'desktop');
  const key=keyEnvelope(randomUUID()),secret='S4_SYNTHETIC_CONVERSATION_AND_SAVED_KEY';
  const p=packageOf(key.keyId,2,32,secret);
  await f.api(P+'/backups/list',{method:'POST',body:{},status:401});
  await control(device,'/backups/key/write',{key,expectedRevision:0});
  assert.equal((await control(device,'/backups/key/read',{})).data.sensitiveAuthorized,undefined);
  await control(device,'/backups/key/read',{password:'wrong-synthetic-password'},401);
  assert.equal((await control(device,'/backups/key/read',{password:PASSWORD})).data.sensitiveAuthorized,true);
  await control(device,'/backups/start',p.manifest);
  for(let i=0;i<2;i++)await control(device,'/backups/chunk/upload',p.upload(i));
  await control(device,'/backups/complete',{id:p.manifest.id});
  const cloudBytes=Buffer.concat(f.db.prepare('SELECT ciphertext FROM cloud_backup_chunks').all().map(c=>Buffer.from(c.ciphertext)));
  assert.ok(!cloudBytes.includes(Buffer.from(secret)));assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM cloud_backups').all()).includes(secret));
  assert.ok(!f.logs().includes(secret));assert.ok(!f.logs().includes(key.ciphertext));assert.ok(!f.logs().includes(PASSWORD));
  const deleted=(await control(device,'/auth/account/delete',{password:PASSWORD})).data;
  assert.deepEqual(deleted.cloudBackupVerification,{backups:0,chunks:0,keys:0,quotaBytes:0});
  assert.deepEqual(backupDeletionVerification(f.db,account.cloudAccountId),deleted.cloudBackupVerification);
});

test('HTTP host signing binds account membership, exact action and replay; unbound host cannot impersonate an account',async t=>{
  const f=await identityFixture(t);const {account}=await registration(f),key=await generateKeyPair('ES256'),jwk=await exportJWK(key.publicKey);
  f.db.prepare('INSERT INTO cloud_hosts(host_id,public_jwk,jkt,tls_spki) VALUES(?,?,?,?)').run('host',JSON.stringify(jwk),'synthetic','synthetic');
  f.db.prepare('INSERT INTO host_claims(claim_id,host_id,public_jwk,jkt,tls_spki,challenge,expires_at,status) VALUES(?,?,?,?,?,?,?,?)')
    .run('claim','host',JSON.stringify(jwk),'synthetic','synthetic','synthetic',0,'active');
  f.db.prepare('INSERT INTO host_memberships(host_id,account_id,claim_id) VALUES(?,?,?)').run('host',account.cloudAccountId,'claim');
  async function signed(route,body={},sub=account.cloudAccountId) {
    return {hostId:'host',proof:await new SignJWT({...body,sub,action:route})
      .setProtectedHeader({alg:'ES256',typ:'wm-host-request+jwt'}).setIssuer('host').setAudience(f.config.issuer)
      .setIssuedAt(Math.floor(f.now/1000)).setExpirationTime(Math.floor(f.now/1000)+60).setJti(randomUUID()).sign(key.privateKey)};
  }
  const body=await signed('/backups/list');assert.equal((await f.api(P+'/backups/list',{method:'POST',body,status:200})).data.items.length,0);
  await f.api(P+'/backups/list',{method:'POST',body,status:401});
  await f.api(P+'/backups/clear',{method:'POST',body:await signed('/backups/list'),status:401});
  await f.api(P+'/backups/list',{method:'POST',body:await signed('/backups/list',{},'unbound'),status:401});
  const envelope=keyEnvelope(randomUUID()),p=packageOf(envelope.keyId,1,1024*1024+16);
  await f.api(P+'/backups/key/write',{method:'POST',body:await signed('/backups/key/write',{key:envelope,expectedRevision:0}),status:200});
  await f.api(P+'/backups/start',{method:'POST',body:await signed('/backups/start',p.manifest),status:200});
  await f.api(P+'/backups/chunk/upload',{method:'POST',body:await signed('/backups/chunk/upload',p.upload(0)),status:200});
  await f.api(P+'/backups/complete',{method:'POST',body:await signed('/backups/complete',{id:p.manifest.id}),status:200});
  f.db.prepare('DELETE FROM host_memberships').run();
  await f.api(P+'/backups/list',{method:'POST',body:await signed('/backups/list'),status:401});
});
