import {createHash,randomUUID} from 'node:crypto';
import {open} from 'node:fs/promises';
import {failure} from '../personal-access/common.mjs';
import {candidates,reconcileDirectory} from './chat-directory.mjs';
import {readMemorySnapshot} from './memory-replica.mjs';
import {readModelSnapshot} from './model-replica.mjs';
import {settingsSnapshot} from '../ui-core/settings-replica.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
const chunkSize=256*1024;
export function createReplicaPublisher({context,hostId,keys,bindings,persist,request,bodyExchange,label}){
 let flight,last=0;
 const status=new Map();
 async function publish(binding){
  const {issuer,sub,ownerId}=binding,scope=JSON.stringify([issuer,sub]),keyId=keys.status(issuer,sub);
  if(!keyId)throw failure('ACCOUNT_KEY_INVALID',403);
  const check=()=>{
   const live=bindings()[scope];
   if(live?.status!=='active'||!live.replicaEnabled||live.ownerId!==ownerId||keys.status(issuer,sub)!==keyId)throw failure('UNAUTHORIZED',401);
   if(context.accountState(ownerId).memoryCleanupPending||context.dataControls?.isLocked(ownerId))throw failure('MEMORY_CLEANUP_PENDING',503);
  };
  check();const initial=digest(JSON.stringify(context.accountState(ownerId)));
  return keys.withReplicaCodec(issuer,sub,hostId,async codec=>{
   const old=binding.replicaBox?await codec.open('source',binding.replicaBox):null;
   const rows=candidates(context.accountState(ownerId),hostId);
   const descriptions=await context.sessionOperations.describe(ownerId,rows.filter(c=>!c.session.deleting).map(c=>c.id));
   const prior=await keys.withDataCodec('wm-chat-directory+jwe',issuer,sub,hostId,async wire=>
    binding.directoryBox?wire.open('source',binding.directoryBox):{epoch:randomUUID(),seq:0,rows:[]});
   const {feed,partial}=reconcileDirectory(prior,rows,descriptions,id=>context.sessionOperations.activityTime(ownerId,id));
   if(partial)throw failure('BODY_BUSY',409);
   const modelsPrior=await keys.withDataCodec('wm-model-replica+jwe',issuer,sub,hostId,wire=>
    binding.modelsBox?wire.open('models-source',binding.modelsBox):{rows:{}});
   const models=await readModelSnapshot(context,ownerId,modelsPrior),memory=await readMemorySnapshot(context,ownerId,check);
   const docs=[];
   for(const row of feed.rows.filter(r=>!r.deleted)){
    check();docs.push(await bodyExchange.snapshot(ownerId,row.id,check));
   }
   const payload={schema:1,hostId,directory:{...feed,label:label(ownerId)},memory,settings:settingsSnapshot(context.accountState(ownerId)),models,bodies:{}};
   const signature=digest(JSON.stringify([payload,docs]));
   const remote=await request('/hosts/replicas/state',{sub,keyId});
   if(old?.signature===signature&&old.operation===remote.operation){status.set(ownerId,{state:'current',at:old.at});return {unchanged:true,revision:remote.revision};}
   const refs=new Set();
   async function object(kind,value){
    check();const id=codec.id(JSON.stringify([kind,value]));refs.add(id);
    await request('/hosts/replicas/stage',{sub,keyId,id,box:await codec.seal(kind,value)});check();return id;
   }
   for(const doc of docs){
    const bytes=Buffer.from(JSON.stringify(doc)),parts=[];
    for(let offset=0;offset<bytes.length;offset+=chunkSize)parts.push(await object('body-part',{chatId:doc.chatId,offset,data:bytes.subarray(offset,offset+chunkSize).toString('base64')}));
    const files={};
    for(const ref of doc.attachments){
     const file=await context.attachmentStores.get(ownerId).get(ref.id);
     if(file.meta.sha256!==ref.sha256||file.meta.size!==ref.size||
        !context.commandReferencesOriginal(ownerId,file.conversationId,file.messageId,file.meta))throw failure('BODY_UNAVAILABLE',404);
     const handle=await open(file.file,'r'),fileParts=[],hashes=[],whole=createHash('sha256');
     try{
      for(let offset=0;offset<ref.size;offset+=chunkSize){
       check();const part=Buffer.alloc(Math.min(chunkSize,ref.size-offset));let done=0;
       while(done<part.length){const result=await handle.read(part,done,part.length-done,file.offset+offset+done);if(!result.bytesRead)throw failure('BODY_UNAVAILABLE',404);done+=result.bytesRead;}
       whole.update(part);hashes.push(digest(part));
       fileParts.push(await object('file-part',{chatId:doc.chatId,attachmentId:ref.id,offset,data:part.toString('base64')}));
      }
      if(whole.digest('hex')!==ref.sha256)throw failure('BODY_UNAVAILABLE',404);
     }finally{await handle.close();}
     files[ref.id]={size:ref.size,sha256:ref.sha256,parts:hashes,objects:fileParts};
    }
    payload.bodies[doc.chatId]={version:digest(bytes),size:bytes.length,contentRevision:doc.contentRevision,parts,files};
   }
   check();const head=await context.memoryManager.query(ownerId,'query_world',{operation:'revision'});
   if(head.world_revision!==memory.revision||digest(JSON.stringify(context.accountState(ownerId)))!==initial)throw failure('REVISION_CHANGED',409);
   payload.revision=remote.revision+1;
   const operation=codec.id(signature),box=await codec.seal('head',payload);
   const committed=await request('/hosts/replicas/commit',{sub,keyId,operation,expectedRevision:remote.revision,box,refs:[...refs]});
   check();const at=new Date(context.timestamp()).toISOString();
   const directoryBox=await keys.withDataCodec('wm-chat-directory+jwe',issuer,sub,hostId,wire=>wire.seal('source',feed));
   const modelsBox=await keys.withDataCodec('wm-model-replica+jwe',issuer,sub,hostId,wire=>wire.seal('models-source',{rows:models.rows}));
   await persist(scope,{replicaBox:await codec.seal('source',{signature,operation,at}),directoryBox,modelsBox},binding);
   status.set(ownerId,{state:'current',at});return committed;
  });
 }
 return {
  status:ownerId=>status.get(ownerId)??{state:'idle'},
  async run(force=false){
   if(flight){await flight;if(force)return this.run(true);return;}
   if(!force&&context.timestamp()-last<60000)return;
   last=context.timestamp();
   flight=(async()=>{
    const results=[];
    for(const binding of Object.values(bindings()).filter(b=>b.status==='active'&&b.replicaEnabled)){
     try{status.set(binding.ownerId,{state:'uploading'});results.push(await publish(binding));}
     catch(error){status.set(binding.ownerId,{state:'waiting',code:error.code??'REPLICA_UNAVAILABLE'});if(force)throw error;}
    }
    return results;
   })().finally(()=>{flight=null;});
   return flight;
  }
 };
}
