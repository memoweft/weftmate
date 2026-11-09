import {CloudError,transaction} from './security.mjs';
const valid=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
const box=value=>typeof value==='string'&&value.length>80&&value.length<1600000&&/^[A-Za-z0-9_.-]+$/.test(value)&&value.split('.').length===5;
const invalid=()=>{throw new CloudError(400,'REPLICA_INVALID');};
export function createReplicas({database:db,config,authenticate,now=Date.now}) {
 const enabled=!!config.replicaEnabled,retention=config.replicaGcMs??60000;
 let lastPrune=-Infinity;
 function prune(){
  if(!enabled||now()-lastPrune<retention)return;lastPrune=now();
  const cutoff=now()-retention;
  db.exec("DELETE FROM replica_heads WHERE NOT EXISTS(SELECT 1 FROM host_memberships m WHERE m.account_id=replica_heads.account_id AND m.host_id=replica_heads.host_id AND m.role='owner')");
  db.exec("DELETE FROM replica_objects WHERE NOT EXISTS(SELECT 1 FROM host_memberships m WHERE m.account_id=replica_objects.account_id AND m.host_id=replica_objects.host_id AND m.role='owner')");

  db.prepare('DELETE FROM replica_objects WHERE retired_at IS NOT NULL AND retired_at<=? AND NOT EXISTS(SELECT 1 FROM replica_refs r WHERE r.account_id=replica_objects.account_id AND r.host_id=replica_objects.host_id AND r.id=replica_objects.id)').run(cutoff);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
 }
 function member(sub,hostId){
  if(!db.prepare("SELECT 1 FROM host_memberships WHERE account_id=? AND host_id=? AND role='owner'").get(sub,hostId))throw new CloudError(403,'FORBIDDEN');
 }
 function state(sub,hostId){return db.prepare('SELECT * FROM replica_heads WHERE account_id=? AND host_id=?').get(sub,hostId);}
 function guard(){if(!enabled)throw new CloudError(404,'NOT_FOUND');}
 return {
  enabled,prune,
  publish(action,hostId,data){
   guard();const {sub,keyId}=data;member(sub,hostId);
   if(!valid(keyId)||db.prepare('SELECT key_id FROM account_data_keys WHERE account_id=?').get(sub)?.key_id!==keyId)throw new CloudError(403,'ACCOUNT_KEY_INVALID');
   prune();
   if(action==='state'){const head=state(sub,hostId);return {revision:head?.revision??0,operation:head?.operation??null};}
   if(action==='stage'){
    if(!valid(data.id)||!box(data.box))invalid();
    const old=db.prepare('SELECT 1 FROM replica_objects WHERE account_id=? AND host_id=? AND id=?').get(sub,hostId,data.id);
    if(old)return {stored:true};
    const bytes=Buffer.byteLength(data.box),account=db.prepare('SELECT coalesce(sum(bytes),0) AS bytes FROM replica_objects WHERE account_id=?').get(sub).bytes;
    const total=db.prepare('SELECT coalesce(sum(bytes),0) AS bytes FROM replica_objects').get().bytes;
    if(account+bytes>(config.replicaAccountBytes??2*1024**3)||total+bytes>(config.replicaGlobalBytes??8*1024**3))throw new CloudError(413,'REPLICA_QUOTA');
    db.prepare('INSERT INTO replica_objects VALUES(?,?,?,?,?,?,?)').run(sub,hostId,data.id,data.box,bytes,now(),now()+86400000);
    return {stored:true};
   }
   if(action!=='commit'||!box(data.box)||!valid(data.operation)||!Number.isSafeInteger(data.expectedRevision)||data.expectedRevision<0||
      !Array.isArray(data.refs)||data.refs.length>50000||!data.refs.every(valid)||new Set(data.refs).size!==data.refs.length)invalid();
   return transaction(db,()=>{
    const old=state(sub,hostId);
    if(old?.operation===data.operation)return {revision:old.revision};
    if((old?.revision??0)!==data.expectedRevision)throw new CloudError(409,'REPLICA_CONFLICT');
    for(const id of data.refs)if(!db.prepare('SELECT 1 FROM replica_objects WHERE account_id=? AND host_id=? AND id=?').get(sub,hostId,id))throw new CloudError(409,'REPLICA_INCOMPLETE');
    const revision=data.expectedRevision+1;
    db.prepare('INSERT INTO replica_heads VALUES(?,?,?,?,?,?) ON CONFLICT(account_id,host_id) DO UPDATE SET revision=excluded.revision,operation=excluded.operation,key_id=excluded.key_id,box=excluded.box').run(sub,hostId,revision,data.operation,keyId,data.box);
    db.prepare('DELETE FROM replica_refs WHERE account_id=? AND host_id=?').run(sub,hostId);
    db.prepare('UPDATE replica_objects SET retired_at=coalesce(retired_at,?) WHERE account_id=? AND host_id=?').run(now(),sub,hostId);
    for(const id of data.refs){
     db.prepare('INSERT INTO replica_refs VALUES(?,?,?)').run(sub,hostId,id);
     db.prepare('UPDATE replica_objects SET retired_at=NULL WHERE account_id=? AND host_id=? AND id=?').run(sub,hostId,id);
    }
    return {revision};
   });
  },
  async read(req,data){
   guard();const account=await authenticate(req,true);member(account.id,data.hostId);prune();
   const head=state(account.id,data.hostId);if(!head)throw new CloudError(404,'REPLICA_UNAVAILABLE');
   if(data.action==='head')return {revision:head.revision,keyId:head.key_id,box:head.box};
   if(data.action!=='object'||!valid(data.id))invalid();
   if(data.revision!==head.revision)throw new CloudError(409,'REPLICA_CHANGED');
   const row=db.prepare('SELECT o.box FROM replica_objects o JOIN replica_refs r USING(account_id,host_id,id) WHERE o.account_id=? AND o.host_id=? AND o.id=?').get(account.id,data.hostId,data.id);
   if(!row)throw new CloudError(404,'REPLICA_UNAVAILABLE');
   return {box:row.box};
  }
 };
}
