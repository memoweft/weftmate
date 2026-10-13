import { randomUUID, createHash } from 'node:crypto';
import { CloudError, transaction } from './security.mjs';
import { cloudPush } from './push.mjs';

export const TASK_LIMITS = Object.freeze({ bytes: 64 * 1024, count: 100, ttl: 7 * 86400000, lease: 30000 });
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const fields = (body, names) => { if (!body || Object.keys(body).sort().join() !== names.sort().join()) throw new CloudError(400,'INVALID_REQUEST'); };
const binary = (value, size) => typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value) && (!size || Buffer.from(value,'base64url').length === size);
const projection = row => ({ id:row.id, hostId:row.host_id, createdAt:row.created_at, expiresAt:row.expires_at, state:row.state });
export function pruneOfflineTasks(db, now) {
  db.prepare('DELETE FROM removed_computer_tasks WHERE expires_at<=?').run(now - TASK_LIMITS.ttl);
  db.prepare("UPDATE offline_tasks SET ciphertext=NULL,state='expired',claim_id=NULL WHERE expires_at<=? AND state IN ('waiting','claimed')").run(now);
  db.prepare("DELETE FROM offline_tasks WHERE expires_at<=? AND ciphertext IS NULL AND state IN ('completed','failed','expired','canceled')").run(now - TASK_LIMITS.ttl);
}
export function createOfflineTasks({ database:db, authenticate, now, push = cloudPush(db,now) }) {
  function trusted(hostId, accountId, deviceId, jkt) {
    return db.prepare("SELECT 1 FROM host_device_status WHERE host_id=? AND account_id=? AND device_id=? AND jkt=? AND status='trusted'").get(hostId,accountId,deviceId,jkt);
  }
  function generation(hostId, accountId) { return db.prepare('SELECT generation FROM offline_controls WHERE host_id=? AND account_id=?').get(hostId,accountId)?.generation; }
  function limit(key, maximum=120) {
    const window = Math.floor(now()/60000)*60000;
    const old = db.prepare('SELECT * FROM failure_limits WHERE key=?').get(key);
    const n = old?.window_start===window ? old.failures+1 : 1;
    if(n>maximum)throw new CloudError(429,'RATE_LIMITED',60);
    db.prepare('INSERT INTO failure_limits VALUES(?,?,?,0) ON CONFLICT(key) DO UPDATE SET failures=excluded.failures,window_start=excluded.window_start,blocked_until=0').run(key,n,window);
  }
  return {
    async device(route, req, body) {
      const account = await authenticate(req,true), token = req.cloudToken;
      limit(`offline-tasks:${account.id}`); pruneOfflineTasks(db,now());
      const suffix = route.slice('/hosts/offline/tasks/'.length);
      if(suffix==='clear') {
        fields(body,[]);
        db.prepare('DELETE FROM offline_tasks WHERE account_id=? AND fingerprint=?').run(account.id,token.device_fingerprint);
        db.prepare('DELETE FROM removed_computer_tasks WHERE account_id=? AND fingerprint=?').run(account.id,token.device_fingerprint);
        return {deleted:true};
      }
      const removed = id(body.hostId) && db.prepare('SELECT 1 FROM removed_computers WHERE account_id=? AND host_id=?').get(account.id,body.hostId);
      if(!id(body.hostId)||!removed&&!trusted(body.hostId,account.id,token.device_id,token.cnf.jkt))throw new CloudError(403,'DEVICE_NOT_TRUSTED');
      if(suffix==='list') {
        fields(body,['hostId']);
        const canceled = db.prepare('SELECT * FROM removed_computer_tasks WHERE host_id=? AND account_id=? AND fingerprint=?').all(body.hostId,account.id,token.device_fingerprint)
          .map(row=>({...projection({...row,state:'canceled'}),reason:'COMPUTER_REMOVED'}));
        return {items:[...db.prepare('SELECT * FROM offline_tasks WHERE host_id=? AND account_id=? AND fingerprint=? ORDER BY seq').all(body.hostId,account.id,token.device_fingerprint).map(projection),...canceled]};
      }
      if(removed)throw new CloudError(410,'COMPUTER_REMOVED');
      if(suffix==='cancel') {
        fields(body,['hostId','id']); if(!id(body.id))throw new CloudError(400,'INVALID_REQUEST');
        const row=db.prepare('SELECT * FROM offline_tasks WHERE id=? AND host_id=? AND account_id=? AND fingerprint=?').get(body.id,body.hostId,account.id,token.device_fingerprint);
        if(!row)throw new CloudError(404,'NOT_FOUND');
        if(!['waiting','claimed','canceled','expired'].includes(row.state))throw new CloudError(409,'TASK_ALREADY_RECEIVED');
        db.prepare("UPDATE offline_tasks SET ciphertext=NULL,state='canceled',claim_id=NULL WHERE id=? AND state IN ('waiting','claimed')").run(body.id);
        return projection(db.prepare('SELECT * FROM offline_tasks WHERE id=?').get(body.id));
      }
      if(suffix!=='submit')throw new CloudError(404,'NOT_FOUND');
      fields(body,['hostId','id','generation','envelope']);
      const e=body.envelope;
      if(!id(body.id)||!Number.isSafeInteger(body.generation)||body.generation!==generation(body.hostId,account.id))throw new CloudError(409,'OFFLINE_RESET_REQUIRED');
      fields(e,['version','algorithm','aad','wrappedKey','iv','ciphertext']);
      if(e.version!==1||e.algorithm!=='RSA-OAEP-256+A256GCM'||!binary(e.aad)||e.aad.length>2048||!binary(e.wrappedKey,256)||!binary(e.iv,12)||!binary(e.ciphertext)||e.ciphertext.length<22)throw new CloudError(400,'INVALID_REQUEST');
      let header;try{header=JSON.parse(Buffer.from(e.aad,'base64url').toString());}catch{throw new CloudError(400,'INVALID_REQUEST');}
      fields(header,['version','purpose','accountId','hostId','deviceId','generation','id','keyId']);
      if(header.version!==1||header.purpose!=='offline-task'||header.id!==body.id||header.hostId!==body.hostId||header.accountId!==account.id||header.deviceId!==token.device_id||header.generation!==body.generation||!/^[a-f0-9]{64}$/.test(header.keyId))throw new CloudError(400,'INVALID_REQUEST');
      const ciphertext=JSON.stringify(e),size=Buffer.byteLength(ciphertext),ciphertextHash=createHash('sha256').update(ciphertext).digest('hex');
      if(size>TASK_LIMITS.bytes)throw new CloudError(413,'BODY_TOO_LARGE');
      return transaction(db,()=>{
        const prior=db.prepare('SELECT * FROM offline_tasks WHERE id=?').get(body.id);
        if(prior){
          if(prior.account_id!==account.id||prior.fingerprint!==token.device_fingerprint||prior.host_id!==body.hostId||prior.ciphertext_hash!==ciphertextHash)throw new CloudError(409,'REQUEST_CONFLICT');
          return projection(prior);
        }
        if(db.prepare("SELECT count(*) AS n FROM offline_tasks WHERE account_id=? AND state IN ('waiting','claimed','received','started')").get(account.id).n>=TASK_LIMITS.count)throw new CloudError(429,'CAPACITY_LIMIT');
        db.prepare("INSERT INTO offline_tasks(id,host_id,account_id,fingerprint,device_id,jkt,generation,ciphertext,ciphertext_hash,size,created_at,expires_at,state) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'waiting')")
          .run(body.id,body.hostId,account.id,token.device_fingerprint,token.device_id,token.cnf.jkt,body.generation,ciphertext,ciphertextHash,size,now(),now()+TASK_LIMITS.ttl);
        return projection(db.prepare('SELECT * FROM offline_tasks WHERE id=?').get(body.id));
      });
    },
    async host(route, hostId, payload) {
      pruneOfflineTasks(db,now()); limit(`offline-tasks-host:${hostId}`,600);
      if(route.endsWith('/claim'))return transaction(db,()=>{
        if(db.prepare("SELECT 1 FROM offline_tasks WHERE host_id=? AND state='claimed' AND lease_until>?").get(hostId,now()))return {items:[]};
        const rows=db.prepare("SELECT * FROM offline_tasks WHERE host_id=? AND (state='waiting' OR state='claimed' AND lease_until<=?) ORDER BY seq LIMIT 20").all(hostId,now());
        const claimId=randomUUID();
        const items=[];
        for(const row of rows){
          if(!trusted(hostId,row.account_id,row.device_id,row.jkt)||generation(hostId,row.account_id)!==row.generation){db.prepare('DELETE FROM offline_tasks WHERE id=?').run(row.id);continue;}
          db.prepare("UPDATE offline_tasks SET state='claimed',claim_id=?,lease_until=? WHERE id=?").run(claimId,now()+TASK_LIMITS.lease,row.id);
          items.push({...projection(row),claimId,accountId:row.account_id,deviceId:row.device_id,jkt:row.jkt,generation:row.generation,envelope:JSON.parse(row.ciphertext)});
        }
        return {items};
      });
      if(!id(payload.id))throw new CloudError(400,'INVALID_REQUEST');
      const row=db.prepare('SELECT * FROM offline_tasks WHERE host_id=? AND id=?').get(hostId,payload.id);
      if(!row)return {accepted:false};
      if(!trusted(hostId,row.account_id,row.device_id,row.jkt)||generation(hostId,row.account_id)!==row.generation)return {accepted:false};
      if(route.endsWith('/ack')) {
        if(!id(payload.claimId)||!id(payload.receiptId))throw new CloudError(400,'INVALID_REQUEST');
        if(row.receipt_id===payload.receiptId&&['received','started','completed','failed'].includes(row.state))return {accepted:true};
        if(row.state==='claimed'&&row.claim_id!==payload.claimId)return {accepted:false,reason:'LEASE_LOST'};
        if(row.state!=='claimed')return {accepted:false};
        db.prepare("UPDATE offline_tasks SET ciphertext=NULL,state='received',receipt_id=? WHERE id=?").run(payload.receiptId,row.id);
        return {accepted:true};
      }
      if(route.endsWith('/result')) {
        if(!['started','completed','failed'].includes(payload.state)||payload.receiptId!==row.receipt_id)throw new CloudError(409,'REQUEST_CONFLICT');
        if(row.state===payload.state)return {accepted:true};
        if(['completed','failed'].includes(row.state))return {accepted:row.state===payload.state};
        if(!['received','started'].includes(row.state))return {accepted:false};
        db.prepare('UPDATE offline_tasks SET state=?,expires_at=? WHERE id=?').run(payload.state,['completed','failed'].includes(payload.state)?now():row.expires_at,row.id);
        await push.send(row.account_id,{eventId:`offline-${row.id}-${payload.state}`,type:`task.${payload.state}`});
        return {accepted:true};
      }
      throw new CloudError(404,'NOT_FOUND');
    },
  };
}
