import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { migrate } from '../src/database.mjs';
import { createOfflineTasks, TASK_LIMITS, pruneOfflineTasks } from '../src/offline-tasks.mjs';
import { sealReplica, taskRecipient } from '../../../src/personal-offline/crypto.mjs';
import { fixture as identityFixture, P } from './identity-helpers.mjs';
import { registration, appDevice, control, refresh, hostFixture } from './app-helpers.mjs';

const secret='S7_PRIVATE_TASK_BODY_不得出现在云端';
async function fixture(t){
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');await migrate(db);await migrate(db);t.after(()=>db.close());
  db.prepare('INSERT INTO cloud_accounts(id,email,password,active,created_at) VALUES(?,?,?,?,?)').run('account','synthetic@example.com','{}',1,0);
  db.prepare('INSERT INTO cloud_hosts(host_id,public_jwk,jkt,tls_spki) VALUES(?,?,?,?)').run('host','{}','host-jkt','synthetic-pin');
  db.prepare('INSERT INTO host_claims(claim_id,host_id,public_jwk,jkt,tls_spki,challenge,expires_at,status) VALUES(?,?,?,?,?,?,?,?)').run('claim','host','{}','host-jkt','synthetic-pin','challenge',0,'active');
  db.prepare('INSERT INTO host_memberships(host_id,account_id,claim_id) VALUES(?,?,?)').run('host','account','claim');
  db.prepare('INSERT INTO cloud_devices(account_id,fingerprint,device_id,confirmed_at) VALUES(?,?,?,?)').run('account','fingerprint','phone',0);
  db.prepare('INSERT INTO host_device_status VALUES(?,?,?,?,?)').run('host','account','phone','jkt','trusted');
  db.prepare('INSERT INTO offline_controls VALUES(?,?,?)').run('host','account',1);
  let now=1000;const notifications=[],recipient=taskRecipient();
  const api=createOfflineTasks({database:db,now:()=>now,authenticate:async req=>{req.cloudToken={device_id:'phone',device_fingerprint:'fingerprint',cnf:{jkt:'jkt'}};return {id:'account'};},push:{send:async(account,payload)=>notifications.push({account,payload})}});
  const device=(action,body)=>api.device('/hosts/offline/tasks/'+action,{},body);
  const host=(action,body={})=>api.host('/hosts/offline/tasks/'+action,'host',body);
  const body=(id=randomUUID())=>({id,hostId:'host',generation:1,envelope:sealReplica({text:secret},recipient.publicJwk,{purpose:'offline-task',accountId:'account',hostId:'host',deviceId:'phone',generation:1,id})});
  return {db,api,device,host,body,notifications,advance:ms=>now+=ms};
}
test('cloud retains ciphertext only; submit retry, cancel, identity and metadata are bounded',async t=>{
  const f=await fixture(t),body=f.body();const first=await f.device('submit',body);assert.equal(first.state,'waiting');assert.deepEqual(await f.device('submit',body),first);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM offline_tasks').get().n,1);
  assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM offline_tasks').all()).includes(secret));
  assert.deepEqual(Object.keys(first).sort(),['createdAt','expiresAt','hostId','id','state']);
  await assert.rejects(f.device('submit',{...body,text:secret}),{code:'INVALID_REQUEST'});
  await assert.rejects(f.device('submit',{...body,envelope:{...body.envelope,ciphertext:'a'.repeat(100000)}}),{code:'BODY_TOO_LARGE'});
  await assert.rejects(f.device('submit',{...body,hostId:'other'}),{code:'DEVICE_NOT_TRUSTED'});
  await f.device('cancel',{hostId:'host',id:body.id});assert.equal(f.db.prepare('SELECT ciphertext FROM offline_tasks').get().ciphertext,null);
});
test('claims keep submission order and exclude concurrent connections; restart leases and ack retries are idempotent',async t=>{
  const f=await fixture(t),a=f.body(),b=f.body();await f.device('submit',a);await f.device('submit',b);
  const [first,second]=await Promise.all([f.host('claim'),f.host('claim')]);assert.deepEqual(first.items.map(r=>r.id),[a.id,b.id]);assert.equal(second.items.length,0);
  const c=f.body();await f.device('submit',c);assert.equal((await f.host('claim')).items.length,0);
  f.advance(TASK_LIMITS.lease+1);const next=await f.host('claim');assert.deepEqual(next.items.map(r=>r.id),[a.id,b.id,c.id]);
  assert.equal((await f.host('ack',{id:a.id,claimId:first.items[0].claimId,receiptId:'receipt'})).accepted,false);
  const ack={id:a.id,claimId:next.items[0].claimId,receiptId:'receipt'};assert.equal((await f.host('ack',ack)).accepted,true);assert.equal((await f.host('ack',ack)).accepted,true);
  assert.equal(f.db.prepare('SELECT ciphertext FROM offline_tasks WHERE id=?').get(a.id).ciphertext,null);
  assert.equal((await f.device('submit',a)).state,'received','late phone retries use the retained ciphertext hash, not the deleted envelope');
  await assert.rejects(f.device('cancel',{hostId:'host',id:a.id}),{code:'TASK_ALREADY_RECEIVED'});
  await f.host('result',{id:a.id,receiptId:'receipt',state:'started'});await f.host('result',{id:a.id,receiptId:'receipt',state:'completed'});
  await f.host('result',{id:a.id,receiptId:'receipt',state:'completed'});assert.equal(f.notifications.length,2);
  assert.equal(new Set(f.notifications.map(n=>n.payload.eventId)).size,2,'start and completion wake identities must be distinct');
  assert.ok(f.notifications.every(n=>Object.keys(n.payload).sort().join()==='eventId,type'));assert.ok(!JSON.stringify(f.notifications).includes(secret));
});
test('cancel beats receipt; expiration deletes ciphertext and prevents execution; metadata expires too',async t=>{
  const f=await fixture(t),a=f.body(),b=f.body();await f.device('submit',a);const claim=(await f.host('claim')).items[0];
  await f.device('cancel',{hostId:'host',id:a.id});assert.equal((await f.host('ack',{id:a.id,claimId:claim.claimId,receiptId:'receipt'})).accepted,false);
  await f.device('submit',b);f.advance(TASK_LIMITS.ttl);assert.equal((await f.host('claim')).items.length,0);
  const result=await f.device('list',{hostId:'host'});assert.equal(result.items.find(r=>r.id===b.id).state,'expired');assert.equal(f.db.prepare('SELECT ciphertext FROM offline_tasks WHERE id=?').get(b.id).ciphertext,null);
  f.advance(TASK_LIMITS.ttl);pruneOfflineTasks(f.db,1000+TASK_LIMITS.ttl*2);assert.equal(f.db.prepare('SELECT count(*) AS n FROM offline_tasks').get().n,0);
});
test('account capacity and operation rate limits apply to authenticated device calls',async t=>{
  const f=await fixture(t);for(let i=0;i<TASK_LIMITS.count;i++)await f.device('submit',f.body());
  await assert.rejects(f.device('submit',f.body()),{code:'CAPACITY_LIMIT'});
  for(let i=0;i<19;i++)await f.device('list',{hostId:'host'});await assert.rejects(f.device('list',{hostId:'host'}),{code:'RATE_LIMITED'});
  f.advance(60000);assert.equal((await f.device('list',{hostId:'host'})).items.length,100);
});
for(const action of ['generation','revoke','logout','unbind','clear'])test(`pending ciphertext disappears on ${action}`,async t=>{
  const f=await fixture(t);await f.device('submit',f.body());
  if(action==='generation')f.db.prepare('UPDATE offline_controls SET generation=2').run();
  if(action==='revoke')f.db.prepare("UPDATE host_device_status SET status='revoked'").run();
  if(action==='logout')f.db.prepare('DELETE FROM cloud_devices').run();
  if(action==='unbind')f.db.prepare('DELETE FROM host_memberships').run();
  if(action==='clear')await f.device('clear',{});
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM offline_tasks').get().n,0);
});
test('HTTP requires DPoP and trusted membership; logs and database never receive task text; old status contract stays intact',async t=>{
  const f=await identityFixture(t);await registration(f);const desktop=await appDevice(f,'desktop'),phone=await appDevice(f,'phone');const h=await hostFixture(f,t),local=await h.exchange(desktop,'/auth/cloud-desktop');
  const connect=(await control(phone,'/hosts/connect',{hostId:h.started.hostId})).data;await refresh(phone,connect.resource);const auth=await h.exchange(phone,'/auth/cloud-session');assert.equal(auth.status,200);await h.host.syncCloudRevocations();await refresh(phone,f.config.audience);
  // Publishing the replica control through the actual host keeps legacy callers unchanged.
  await h.hostApi('/offline/sync',{publicJwk:taskRecipient().publicJwk,generation:0,hashes:{}},local).catch(()=>{});
  await f.api(P+'/hosts/offline/tasks/submit',{method:'POST',body:{hostId:h.started.hostId,text:secret},status:401});
  await control(phone,'/hosts/offline/tasks/submit',{hostId:h.started.hostId,text:secret},400);
  assert.ok(!f.logs().includes(secret));assert.equal(f.db.prepare('SELECT count(*) AS n FROM offline_tasks').get().n,0);
});
