import {jwtVerify,importJWK} from 'jose';
import * as opaque from '@serenity-kit/opaque';
import {readFile,open,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes,createHmac,createHash} from 'node:crypto';
import {CloudError,normalizeEmail,transaction} from './security.mjs';
const token=()=>randomBytes(32).toString('base64url');
const valid=(s,n)=>typeof s==='string'&&s.length===n&&/^[A-Za-z0-9_-]+$/.test(s);
const invalid=()=>{throw new CloudError(401,'INVALID_CREDENTIALS');};
export async function createPasswordVault({database:db,config,accounts,secret,now=Date.now}){
 const enabled=!!config.replicaEnabled,flows=new Map();
 let setup;
 if(enabled){
  await opaque.ready;
  const dir=join(config.dataDir,'identity-keys');await mkdir(dir,{recursive:true,mode:0o700});
  const file=join(dir,'opaque-setup');
  try{setup=await readFile(file,'utf8');}catch(error){
   if(error.code!=='ENOENT')throw error;
   const created=opaque.server.createSetup();
   try{const f=await open(file,'wx',0o600);try{await f.writeFile(created);await f.sync();}finally{await f.close();}setup=created;}
   catch(error){if(error.code!=='EEXIST')throw error;setup=await readFile(file,'utf8');}
  }
  opaque.server.getPublicKey(setup);
 }
 const credential=id=>db.prepare('SELECT * FROM opaque_credentials WHERE account_id=?').get(id);
 function guard(){if(!enabled)throw new CloudError(404,'NOT_FOUND');}
 function save(value){
  for(const [id,row]of flows)if(row.expires<=now())flows.delete(id);
  if(flows.size>=1000)throw new CloudError(429,'RATE_LIMITED');
  const id=token();flows.set(id,{...value,expires:now()+300000});return id;
 }
 function take(id,kind,scope){
  const flow=flows.get(id);flows.delete(id);
  if(!flow||flow.expires<=now()||flow.kind!==kind||flow.scope!==scope)invalid();
  const account=accounts.get(flow.accountId);
  if(!account?.active||account.auth_epoch!==flow.epoch||(credential(account.id)?.version??0)!==flow.version)invalid();
  return {flow,account};
 }
 function identifiers(id){return {client:id,server:config.issuer};}
 function start(body,from,scope,authenticated){
  guard();const email=normalizeEmail(authenticated?.email??body.email);accounts.check(email,from);
  const attempts=accounts.limiter.keys(email,from,'opaque-start');accounts.limiter.check(attempts);accounts.limiter.fail(attempts);
  const account=authenticated??accounts.byEmail(email),record=account?.active&&credential(account.id);
  const fake=createHmac('sha256',secret).update(email).digest('hex');
  const sub=record?account.id:[fake.slice(0,8),fake.slice(8,12),fake.slice(12,16),fake.slice(16,20),fake.slice(20,32)].join('-');
  let result;
  try{result=opaque.server.startLogin({serverSetup:setup,userIdentifier:sub,registrationRecord:record?.record??null,startLoginRequest:body.startLoginRequest,identifiers:identifiers(sub)});}
  catch{invalid();}
  const flowId=save({kind:'login',scope,accountId:record?account.id:null,epoch:account?.auth_epoch,version:record?.version??0,serverLoginState:result.serverLoginState,email,from});
  return {flowId,loginResponse:result.loginResponse,identifiers:identifiers(sub)};
 }
 function finish(body,from,scope){
  guard();const saved=flows.get(body.flowId);const keys=accounts.check(saved?.email??'opaque-login',from);
  let flow,account;
  try{
   ({flow,account}=take(body.flowId,'login',scope));
   opaque.server.finishLogin({serverLoginState:flow.serverLoginState,finishLoginRequest:body.finishLoginRequest});
  }catch{accounts.limiter.fail(keys);invalid();}
  for(const key of accounts.limiter.keys(flow.email,flow.from,'opaque-start'))db.prepare('DELETE FROM failure_limits WHERE key=?').run(key);
  const proof=save({kind:'proof',scope:account.id,accountId:account.id,epoch:account.auth_epoch,version:flow.version});
  return {account,proof};
 }
 return {enabled,credential,start,finish,
  verifyProof(proof,account){guard();return take(proof,'proof',account.id).account.id===account.id;},
  capabilities(){return {enabled,...(enabled?{serverPublicKey:opaque.server.getPublicKey(setup),keyStretching:'memory-constrained'}:{})};},
  async registration(body,from,authenticated){
   guard();let account,purpose,version;
   if(body.passwordTicket){
    purpose=body.purpose;
    if(!['register','reset'].includes(purpose))invalid();
    ({account}=accounts.passwordTicket(body.passwordTicket,purpose,from));version=credential(account.id)?.version??0;
   }else{
    account=authenticated;if(!account)invalid();const current=credential(account.id);version=current?.version??0;
    if(current){const verified=take(body.proof,'proof',account.id);if(verified.account.id!==account.id)invalid();}
    else if(!db.prepare('SELECT 1 FROM account_data_keys WHERE account_id=?').get(account.id))throw new CloudError(409,'ACCOUNT_KEY_INVALID');
    purpose=current?'change':'activate';
   }
   let response;
   try{response=opaque.server.createRegistrationResponse({serverSetup:setup,userIdentifier:account.id,registrationRequest:body.registrationRequest});}
   catch{throw new CloudError(400,'INVALID_REQUEST');}
   const flowId=save({kind:'register',scope:purpose,accountId:account.id,epoch:account.auth_epoch,version,purpose,passwordTicket:body.passwordTicket});
   return {...response,flowId,identifiers:identifiers(account.id),version};
  },
  async commit(body,from,authenticated){
   guard();const flow=flows.get(body.flowId);
   if(!flow||flow.kind!=='register'||flow.expires<=now())invalid();
   const account=accounts.get(flow.accountId);
   if(!account||account.auth_epoch!==flow.epoch||(credential(account.id)?.version??0)!==flow.version)invalid();
   if(['activate','change'].includes(flow.purpose)&&authenticated?.id!==account.id)invalid();
   if(flow.passwordTicket)accounts.passwordTicket(flow.passwordTicket,flow.purpose,from);
   if(!valid(body.registrationRecord,256))throw new CloudError(400,'INVALID_REQUEST');
   let wrapped=null;
   if(flow.purpose==='reset'&&body.wrappedKey)throw new CloudError(400,'ACCOUNT_KEY_INVALID');
   if(body.wrappedKey!==null&&body.wrappedKey!==undefined){
    const w=body.wrappedKey,registered=db.prepare('SELECT key_id FROM account_data_keys WHERE account_id=?').get(account.id)?.key_id;
    if(Object.keys(w).sort().join()!=='box,keyId,salt,schema'||w.schema!==1||w.keyId!==registered||!valid(w.salt,22)||
       typeof w.box!=='string'||w.box.length>4096||w.box.split('.').length!==5)throw new CloudError(400,'ACCOUNT_KEY_INVALID');
    wrapped=JSON.stringify(w);
   }
   if(['activate','change'].includes(flow.purpose)&&!wrapped)throw new CloudError(400,'ACCOUNT_KEY_INVALID');
   if(flow.purpose==='activate'){
    const activation=body.activationProof,host=activation&&db.prepare("SELECT h.* FROM cloud_hosts h JOIN host_memberships m USING(host_id) WHERE h.host_id=? AND m.account_id=? AND m.role='owner'").get(activation.hostId,account.id);
    if(!host)throw new CloudError(403,'LOCAL_KEY_REQUIRED');
    let payload;
    try{({payload}=await jwtVerify(activation.proof,await importJWK(JSON.parse(host.public_jwk),'ES256'),{
      algorithms:['ES256'],typ:'wm-host-request+jwt',issuer:host.host_id,audience:config.issuer,maxTokenAge:'60s',clockTolerance:30,currentDate:new Date(now()),requiredClaims:['iat','exp','jti']}));}
    catch{throw new CloudError(403,'LOCAL_KEY_REQUIRED');}
    const hash=value=>createHash('sha256').update(value).digest('base64url');
    if(payload.action!=='password-activate'||payload.sub!==account.id||payload.flowId!==body.flowId||
       payload.recordHash!==hash(body.registrationRecord)||payload.wrappedHash!==hash(wrapped)||
       db.prepare('SELECT 1 FROM host_proof_replays WHERE jti=?').get(payload.jti))throw new CloudError(403,'LOCAL_KEY_REQUIRED');
    db.prepare('INSERT INTO host_proof_replays VALUES(?,?)').run(payload.jti,now()+120000);
    if(accounts.get(account.id)?.auth_epoch!==account.auth_epoch||(credential(account.id)?.version??0)!==flow.version)invalid();
   }
   transaction(db,()=>{
    db.prepare('INSERT INTO opaque_credentials VALUES(?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET record=excluded.record,version=excluded.version,wrapped_key=excluded.wrapped_key').run(account.id,body.registrationRecord,flow.version+1,wrapped);
    db.prepare("UPDATE cloud_accounts SET password='null',active=1,auth_epoch=auth_epoch+1 WHERE id=?").run(account.id);
    accounts.revoke(account.id);flows.delete(body.flowId);
   });
   return {passwordChanged:true,version:flow.version+1,account:accounts.public(accounts.get(account.id)),keyAvailable:!!wrapped};
  },
  read(account){guard();const row=credential(account.id);return {version:row?.version??0,wrappedKey:row?.wrapped_key?JSON.parse(row.wrapped_key):null};}
 };
}
