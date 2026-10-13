import path from 'node:path';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID, randomInt } from 'node:crypto';
import { durableWrite, verify } from '../personal-backup/archive.mjs';
import { generateRecoveryCode, validateRecoveryCode, wrapMasterKey, unwrapMasterKey, encryptBackup, decryptBackup, cloudBackupChunkFile, validateCloudBackupManifest } from './crypto.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const error=(code,extra={})=>Object.assign(new Error(code),{code,status:409,...extra});
const read=async(file,fallback)=>readFile(file,'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return fallback;throw e;});
export async function createCloudBackupManager({root,identity,backupManager,vault,exportCredentials=async()=>({}),stageCredentials=async()=>{},abortCredentials=async()=>{},canUpload=async()=>false,clock=Date.now,appVersion=null}) {
  const control=path.join(root,'personal-backup','cloud'); await mkdir(control,{recursive:true,mode:0o700});
  let busy=false,active=null,stopping=false,timer;
  const stateFile=account=>path.join(control,`${sha(account.accountId)}.json`);
  const keyRef=account=>`cloud-backup-${sha(account.accountId)}`;
  const draftRef=account=>`${keyRef(account)}-draft`;
  function account(ownerId) {
    if(!identity?.cloudBackupSupported())throw error('CLOUD_BACKUP_UNAVAILABLE');
    const result=identity.backupAccount(ownerId); if(!result)throw error('CLOUD_NOT_BOUND'); return result;
  }
  const call=(ownerId,route,body={})=>identity.backupRequest(ownerId,`/backups/${route}`,body);
  const localKey=acc=>{const value=vault.getCredential(keyRef(acc));return value?JSON.parse(value):null;};
  async function exclusive(work) {
    if(busy||stopping)throw error('CONFLICT'); busy=true;
    active=Promise.resolve().then(work);
    try{return await active;}finally{active=null;busy=false;}
  }
  async function view(ownerId) {
    if(!identity?.cloudBackupSupported())return {available:false,reason:'CLOUD_BACKUP_UNAVAILABLE'};
    const acc=identity.backupAccount(ownerId);if(!acc)return {available:false,reason:'CLOUD_NOT_BOUND'};
    const state=await read(stateFile(acc),{});
    try {
      const listing=await call(ownerId,'list');
      const enabled=!!localKey(acc);
      return {available:true,enabled,busy,lastBackupAt:state.lastBackupAt??null,status:state.status??null,items:listing.items,usage:listing.usage,
        recoveryAvailable:enabled,keyAvailable:listing.keyAvailable,restoreSuggested:!enabled&&listing.items.length>0&&state.dismissedId!==listing.items[0].id};
    }catch(e){return {available:true,enabled:!!localKey(acc),busy,status:{state:'failed',code:e.code??'CLOUD_UNAVAILABLE'}};}
  }
  async function prepare(ownerId,{password,purpose='enable'}={}) {return exclusive(async()=>{
    const acc=account(ownerId),existing=localKey(acc),remote=await call(ownerId,'key/read',purpose==='rotate'?{password}:{});
    if(!['enable','rotate'].includes(purpose))throw error('INVALID_REQUEST');
    if(existing&&purpose==='enable')throw error('CONFLICT');
    if(purpose==='rotate'&&(!existing||remote.sensitiveAuthorized!==true))throw error('INVALID_CREDENTIALS');
    if(purpose!=='rotate'&&remote.key&&!existing)throw error('CLOUD_BACKUP_RECOVERY_REQUIRED');
    const masterKey=existing?Buffer.from(existing.masterKey,'base64url'):randomBytes(32),recoveryCode=generateRecoveryCode();
    const envelope=wrapMasterKey(masterKey,recoveryCode,acc.accountId,existing?.keyId??randomUUID());
    const draft={masterKey:masterKey.toString('base64url'),recoveryCode,keyId:envelope.keyId,envelope,revision:remote.revision,draftId:randomUUID(),
      confirmGroup:randomInt(1,9),expiresAt:clock()+900000,purpose};
    vault.saveCredential(draftRef(acc),JSON.stringify(draft));masterKey.fill(0);
    return {recoveryCode,draftId:draft.draftId,confirmGroup:draft.confirmGroup,purpose};
  });}
  async function enable(ownerId,{draftId,confirmation}) {return exclusive(async()=>{
    const acc=account(ownerId),raw=vault.getCredential(draftRef(acc)),draft=raw&&JSON.parse(raw);
    if(!draft||draft.draftId!==draftId||draft.expiresAt<clock())throw error('CLOUD_BACKUP_CONFIRM_EXPIRED');
    if(String(confirmation).trim().toUpperCase()!==draft.recoveryCode.split('-')[draft.confirmGroup-1])throw error('CLOUD_BACKUP_CONFIRM_GROUP',{invalidGroups:[draft.confirmGroup]});
    const result=await call(ownerId,'key/write',{key:draft.envelope,expectedRevision:draft.revision});
    vault.saveCredential(keyRef(acc),JSON.stringify({masterKey:draft.masterKey,recoveryCode:draft.recoveryCode,keyId:draft.keyId,revision:result.revision}));
    vault.removeCredential(draftRef(acc));
    const state=await read(stateFile(acc),{});await durableWrite(stateFile(acc),{...state,status:{state:'enabled'},dismissedId:null});
    return {enabled:true};
  });}
  async function reveal(ownerId,{password}) {return exclusive(async()=>{
    const acc=account(ownerId),remote=await call(ownerId,'key/read',{password});
    if(remote.sensitiveAuthorized!==true)throw error('INVALID_CREDENTIALS');
    const key=localKey(acc);if(!key||remote.key?.keyId!==key.keyId)throw error('CLOUD_BACKUP_RECOVERY_REQUIRED');
    if(remote.revision!==key.revision)throw error('CLOUD_BACKUP_RECOVERY_CHANGED');
    return {recoveryCode:key.recoveryCode};
  });}
  async function run(ownerId,{automatic=false}={}) {return exclusive(async()=>{
    const acc=account(ownerId),key=localKey(acc);if(!key)throw error('CLOUD_BACKUP_RECOVERY_REQUIRED');
    let state=await read(stateFile(acc),{}),capture;
    if(automatic&&state.lastCheckedAt&&clock()-Date.parse(state.lastCheckedAt)<86400000&&!state.pending)return {state:'unchanged'};
    if(automatic&&!await canUpload())return {state:'deferred',code:'CLOUD_BACKUP_POWER_NETWORK'};
    try {
      const remote=await call(ownerId,'key/read');
      const generation=remote.generation??0;
      if((state.generation??0)!==generation) {
        if(state.pending)await rm(state.pending.directory,{recursive:true,force:true});
        state={...state,pending:null,contentHash:null,generation};await durableWrite(stateFile(acc),state);
      }
      if(!remote.key || remote.key.keyId!==key.keyId)throw error('CLOUD_BACKUP_RECOVERY_REQUIRED');
      if(!state.pending) {
        capture=await backupManager.cloudSnapshot(ownerId,{captureSecrets:exportCredentials});
        const credentials=capture.credentials??await exportCredentials({ownerId,modelProfileIds:capture.manifest?.cloud?.modelProfileIds??[],connectors:[]});
        const contentHash=sha(capture.contentHash+'\n'+JSON.stringify(credentials));
        if(contentHash===state.contentHash){state.lastCheckedAt=new Date(clock()).toISOString();await durableWrite(stateFile(acc),state);return {state:'unchanged'};}
        const directory=path.join(control,sha(acc.accountId),randomUUID());await mkdir(directory,{recursive:true,mode:0o700});
        const masterKey=Buffer.from(key.masterKey,'base64url');let manifest;
        try{manifest=await encryptBackup({archiveFile:capture.file,credentials,accountId:acc.accountId,backupId:randomUUID(),keyId:key.keyId,masterKey,directory,appVersion});}finally{masterKey.fill(0);}
        manifest.generation=generation;
        state={...state,pending:{manifest,directory,contentHash},status:{state:'uploading',uploaded:0,total:manifest.chunkCount}};
        await durableWrite(stateFile(acc),state);
      }
      const {manifest,directory,contentHash}=state.pending;
      if(manifest.totalBytes>1048576&&!await canUpload())throw error('CLOUD_BACKUP_POWER_NETWORK');
      const started=await call(ownerId,'start',manifest),received=new Set(started.received);
      for(const chunk of manifest.chunks) {
        if(stopping)throw error('SERVICE_CLOSING');
        if(!received.has(chunk.index))await call(ownerId,'chunk/upload',{id:manifest.id,index:chunk.index,hash:chunk.hash,ciphertext:(await readFile(cloudBackupChunkFile(directory,chunk.index))).toString('base64url')});
        state.status={state:'uploading',uploaded:chunk.index+1,total:manifest.chunkCount};await durableWrite(stateFile(acc),state);
      }
      const result=await call(ownerId,'complete',{id:manifest.id});
      state={...state,pending:null,contentHash,lastBackupAt:manifest.createdAt,lastCheckedAt:new Date(clock()).toISOString(),status:{state:'succeeded'}};
      await durableWrite(stateFile(acc),state);await rm(directory,{recursive:true,force:true});
      return {state:'succeeded',backup:result.backup,usage:result.usage};
    }catch(e){state.status={state:['SESSION_BUSY','BACKUP_PAUSE_TIMEOUT','CLOUD_BACKUP_POWER_NETWORK'].includes(e.code)?'deferred':'failed',code:e.code??'CLOUD_UNAVAILABLE',usage:e.usage};await durableWrite(stateFile(acc),state);throw e;}
    finally{if(capture?.file)await rm(capture.file,{force:true});}
  });}
  async function restore(ownerId,{id,recoveryCode,confirm}) {return exclusive(async()=>{
    if(confirm!==true)throw error('INVALID_REQUEST');
    const check=validateRecoveryCode(recoveryCode);if(!check.valid)throw error('CLOUD_BACKUP_RECOVERY_CODE',{invalidGroups:check.invalidGroups});
    const acc=account(ownerId),remote=await call(ownerId,'key/read'),listing=await call(ownerId,'list'),manifest=listing.items.find(row=>row.id===id);
    if(!manifest||!remote.key)throw error('NOT_FOUND');
    validateCloudBackupManifest(manifest);
    const masterKey=unwrapMasterKey(remote.key,recoveryCode,acc.accountId),directory=path.join(control,sha(acc.accountId),`restore-${id}`);
    await mkdir(directory,{recursive:true,mode:0o700});const outputFile=path.join(directory,'restored.wmb');
    try {
      for(const chunk of manifest.chunks) {
        const file=cloudBackupChunkFile(directory,chunk.index);
        if(await readFile(file).then(bytes=>sha(bytes)===chunk.hash).catch(()=>false))continue;
        const reply=await call(ownerId,'chunk/download',{id,index:chunk.index});
        const bytes=Buffer.from(reply.ciphertext,'base64url');if(bytes.length!==chunk.size||sha(bytes)!==chunk.hash)throw error('CLOUD_BACKUP_CORRUPT');
        await writeFile(file,bytes,{mode:0o600});
      }
      const credentials=await decryptBackup({manifest,directory,accountId:acc.accountId,masterKey,outputFile,appVersion});
      await verify(outputFile);
      credentials[keyRef(acc)]=JSON.stringify({masterKey:masterKey.toString('base64url'),recoveryCode:check.normalized,keyId:remote.key.keyId,revision:remote.revision});
      await stageCredentials(credentials,{outputFile});
      let result;
      try{result=await backupManager.request('cloud-restore',outputFile);}
      catch(error){await abortCredentials();await rm(outputFile,{force:true});throw error;}
      return {...result,restoring:true};
    }finally{masterKey.fill(0);}
  });}
  async function clear(ownerId) {return exclusive(async()=>{
    const acc=account(ownerId),result=await call(ownerId,'clear');
    if(result.deleted!==true||['backups','chunks','keys','quotaBytes'].some(field=>result.verification?.[field]!==0))throw error('CLOUD_BACKUP_DELETE_UNVERIFIED');
    vault.removeCredential(keyRef(acc));vault.removeCredential(draftRef(acc));
    await rm(path.join(control,sha(acc.accountId)),{recursive:true,force:true});await rm(stateFile(acc),{force:true});
    return result;
  });}
  async function dismiss(ownerId,{id}) {const acc=account(ownerId),state=await read(stateFile(acc),{});await durableWrite(stateFile(acc),{...state,dismissedId:id});return {dismissed:true};}
  async function remove(ownerId,{id,confirm}) {return exclusive(async()=>{
    account(ownerId);if(confirm!==true)throw error('INVALID_REQUEST');
    const result=await call(ownerId,'delete',{id});
    if(result.deleted!==true||result.verification?.backups!==0||result.verification?.chunks!==0)throw error('CLOUD_BACKUP_DELETE_UNVERIFIED');
    return result;
  });}
  return {view,prepare,enable,reveal,run,restore,clear,dismiss,remove,
    start(ownerIds){timer=setInterval(()=>{if(!busy&&!stopping&&identity?.cloudBackupSupported())void(async()=>{for(const id of ownerIds()){if(stopping)break;const acc=identity.backupAccount(id);if(acc&&localKey(acc))try{await run(id,{automatic:true});}catch{/* Each account retries independently on the next idle tick. */}}})();},60000);timer.unref();},
    async close(){stopping=true;clearInterval(timer);await active?.catch(()=>{});},
  };
}
