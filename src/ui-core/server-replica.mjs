import {settingsHeads} from './settings-replica.mjs';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const bytes=data=>Uint8Array.from(atob(data),x=>x.charCodeAt(0));
const hash=async data=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(x=>x.toString(16).padStart(2,'0')).join('');
export function openServerReplica({codec,wire,directoryPage,request,read,write,current,hostId,keyId}){
 async function head(){
  current();const result=await request({action:'head',hostId});current();
  if(result.keyId!==keyId)fail('ACCOUNT_KEY_INVALID');
  const value=await codec.open('head',result.box);
  if(value.schema!==1||value.hostId!==hostId||value.revision!==result.revision)fail('REPLICA_INVALID');
  const oldBox=await read(),old=oldBox?await codec.open('watermark',oldBox):null;
  if(old&&(value.revision<old.revision||value.revision===old.revision&&old.box!==result.box))fail('REPLICA_REPLAY');
  if(!old||old.revision!==value.revision)await write(oldBox,await codec.seal('watermark',{revision:value.revision,box:result.box}));
  current();return value;
 }
 async function object(snapshot,id,kind){
  current();const result=await request({action:'object',hostId,id,revision:snapshot.revision});current();
  return codec.open(kind,result.box);
 }
 return {
  head,
  async exchange(type,queryBox,source){
   try{return await source({box:queryBox});}catch(error){
    if(!['NETWORK','CONNECTION_LOST','HOST_OFFLINE','APP_NOT_CONNECTED','HOST_UNREACHABLE','CLOUD_TRANSPORT_UNAVAILABLE','CLOUD_TIMEOUT','HOST_UNAVAILABLE','REQUEST_FAILED'].includes(error.code)&&!(error.status>=500))throw error;
   }
   const types={directory:['wm-chat-directory+jwe','pull','page'],models:['wm-model-replica+jwe','models-request','models-response'],
    settings:['wm-settings-replica+jwe','settings-request','settings-response'],memory:['wm-memory-replica+jwe','memory-request','memory-response']};
   const [typ,input,output]=types[type],crypt=wire(typ),q=await crypt.open(input,queryBox),snapshot=await head();
   let result;
   if(type==='directory'){
    if(q.epoch!==null&&q.epoch!==snapshot.directory.epoch)fail('DIRECTORY_RESET');
    result={...directoryPage(snapshot.directory,q.cursor),label:snapshot.directory.label,partial:false,requestId:q.requestId};
   }else if(type==='models'){
    if(q.action!=='sync')fail('HOST_OFFLINE');
    result={requestId:q.requestId,rows:snapshot.models.rows,heads:settingsHeads(snapshot.models.rows),local:snapshot.models.local};
   }else if(type==='settings'){
    if(Object.keys(q.changes??{}).length)fail('HOST_OFFLINE');
    result={requestId:q.requestId,rows:snapshot.settings,heads:settingsHeads(snapshot.settings)};
   }else{
    const memory=snapshot.memory;let value;
    if(q.op==='manifest')value={revision:memory.revision,index:memory.items.map(({key,stamp})=>({key,stamp})),retired:memory.retired};
    else if(q.op==='items'){
     if(q.revision!==memory.revision)fail('MEMORY_REVISION_CHANGED');
     const items=q.keys.map(key=>memory.items.find(row=>row.key===key));if(items.some(row=>!row))fail('MEMORY_REVISION_CHANGED');
     value={revision:memory.revision,items};
    }else fail('HOST_OFFLINE');
    result={op:q.op,requestId:q.requestId,result:value};
   }
   current();return {box:await crypt.seal(output,result)};
  },
  async body(chatId,metadataOnly=false){
   const snapshot=await head(),meta=snapshot.bodies[chatId];if(!meta)return null;
   if(metadataOnly)return {size:meta.size};
   if(meta.size>64*1024*1024||meta.parts.length!==Math.ceil(meta.size/(256*1024)))fail('REPLICA_INVALID');
   const data=new Uint8Array(meta.size);
   for(const [index,id]of meta.parts.entries()){
    const part=await object(snapshot,id,'body-part'),offset=index*256*1024,chunk=bytes(part.data);
    if(part.chatId!==chatId||part.offset!==offset||chunk.length!==Math.min(256*1024,meta.size-offset))fail('REPLICA_INVALID');
    data.set(chunk,offset);
   }
   if(await hash(data)!==meta.version)fail('REPLICA_INVALID');
   return {doc:JSON.parse(new TextDecoder().decode(data)),version:meta.version};
  },
  async file(chatId,attachmentId,sha256){
   const snapshot=await head(),body=snapshot.bodies[chatId],file=body?.files[attachmentId];
   if(!file||file.sha256!==sha256)return null;
   return {manifest:{version:body.version,size:file.size,sha256,parts:file.parts},readPart:async offset=>{
    const id=file.objects[offset/(256*1024)];if(!id)fail('REPLICA_INVALID');
    const part=await object(snapshot,id,'file-part');
    if(part.chatId!==chatId||part.attachmentId!==attachmentId||part.offset!==offset)fail('REPLICA_INVALID');
    return {offset,size:file.size,version:body.version,data:part.data};
   }};
  }
 };
}
