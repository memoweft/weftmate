// 保护：发布引用若提前可见、旧版本被重放或清理漏掉退役块，会暴露半份副本或已遗忘内容。
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import {migrate} from '../src/database.mjs';
import {createReplicas} from '../src/replicas.mjs';
import './dependencies.mjs';
const {CompactEncrypt,compactDecrypt}=await import('jose');
import {accountDataCodec} from '../../../src/personal-cloud/directory-wire.mjs';
import {openServerReplica} from '../../../src/ui-core/server-replica.mjs';
const id=()=>randomBytes(32).toString('base64url');
async function fixture(t,limits={}){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');await migrate(db);t.after(()=>db.close());
 for(const sub of ['owner','other'])db.prepare('INSERT INTO cloud_accounts(id,email,password,active,created_at) VALUES(?,?,?,?,0)').run(sub,sub+'@example.test','null',1);
 db.prepare('INSERT INTO cloud_hosts(host_id,public_jwk,jkt,tls_spki) VALUES(?,?,?,?)').run('host','{}','jkt','tls');
 db.prepare('INSERT INTO host_claims VALUES(?,?,?,?,?,?,?,?,?)').run('claim','host','{}','jkt','tls','challenge',100000,'owner','active');
 db.prepare('INSERT INTO host_memberships(host_id,account_id,claim_id,role) VALUES(?,?,?,?)').run('host','owner','claim','owner');
 const keyId=id(),key=randomBytes(32);db.prepare('INSERT INTO account_data_keys VALUES(?,?)').run('owner',keyId);
 let now=1000,sub='owner';
 const api=createReplicas({database:db,config:{replicaEnabled:true,...limits},now:()=>now,authenticate:async(req,requireDevice)=>{assert.equal(requireDevice,true);return {id:sub};}});
 const codec=accountDataCodec({CompactEncrypt,compactDecrypt},key,['issuer','owner',keyId,'host'],'wm-server-replica+jwe');
 const publish=(action,body)=>api.publish(action,'host',{sub:'owner',keyId,...body});
 const read=body=>api.read({},{hostId:'host',...body});
 return {db,api,codec,publish,read,keyId,advance:ms=>now+=ms,as:next=>sub=next};
}
test('objects become readable only after an atomic head commit and retire immediately from reads',async t=>{
 const f=await fixture(t),chunk=id(),operation=id(),box=await f.codec.seal('body-part',{text:'synthetic'});
 f.publish('stage',{id:chunk,box});
 await assert.rejects(f.read({action:'object',id:chunk,revision:0}),{code:'REPLICA_UNAVAILABLE'});
 const head=await f.codec.seal('head',{schema:1,revision:1,hostId:'host'});
 assert.throws(()=>f.publish('commit',{expectedRevision:0,operation,box:head,refs:[id()]}),{code:'REPLICA_INCOMPLETE'});
 const data={expectedRevision:0,operation,box:head,refs:[chunk]};
 assert.deepEqual(f.publish('commit',data),{revision:1});assert.deepEqual(f.publish('commit',data),{revision:1});
 assert.equal((await f.read({action:'object',id:chunk,revision:1})).box,box);
 f.as('other');await assert.rejects(f.read({action:'head'}),{code:'FORBIDDEN'});f.as('owner');
 f.publish('commit',{expectedRevision:1,operation:id(),box:await f.codec.seal('head',{schema:1,revision:2,hostId:'host'}),refs:[]});
 await assert.rejects(f.read({action:'object',id:chunk,revision:2}),{code:'REPLICA_UNAVAILABLE'});
 f.advance(60001);f.api.prune();assert.equal(f.db.prepare('SELECT count(*) AS n FROM replica_objects').get().n,0);
});
test('conflicting writers, quotas and expired staged uploads cannot leave a partial published copy',async t=>{
 const f=await fixture(t,{replicaAccountBytes:1000}),chunk=id(),box=await f.codec.seal('body-part',{text:'synthetic'});
 f.publish('stage',{id:chunk,box});
 assert.throws(()=>f.publish('stage',{id:id(),box:awaitBox()}),{code:'REPLICA_QUOTA'});
 function awaitBox(){return 'a'.repeat(1000)+'.b.c.d.e';}
 assert.throws(()=>f.publish('commit',{expectedRevision:1,operation:id(),box,refs:[chunk]}),{code:'REPLICA_CONFLICT'});
 f.advance(86460001);f.api.prune();assert.equal(f.db.prepare('SELECT count(*) AS n FROM replica_objects').get().n,0);
});
test('a reader rejects a rolled back or renumbered encrypted head',async t=>{
 const f=await fixture(t);let stored;
 const request=body=>f.read(body);
 const reader=openServerReplica({codec:f.codec,wire:()=>f.codec,current:()=>{},hostId:'host',keyId:f.keyId,request,read:async()=>stored,write:async(old,next)=>{assert.equal(stored,old);stored=next;}});
 const first={expectedRevision:0,operation:id(),refs:[],box:await f.codec.seal('head',{schema:1,revision:1,hostId:'host'})};f.publish('commit',first);await reader.head();
 const second={expectedRevision:1,operation:id(),refs:[],box:await f.codec.seal('head',{schema:1,revision:2,hostId:'host'})};f.publish('commit',second);await reader.head();
 f.db.prepare('UPDATE replica_heads SET revision=1,box=?').run(first.box);
 await assert.rejects(reader.head(),{code:'REPLICA_REPLAY'});
 f.db.prepare('UPDATE replica_heads SET revision=3').run();
 await assert.rejects(reader.head(),{code:'REPLICA_INVALID'});
});
