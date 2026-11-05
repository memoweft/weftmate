import {createHash} from 'node:crypto';
import {open} from 'node:fs/promises';
import {failure} from '../personal-access/common.mjs';
import {hasPrivateContent} from '../personal-access/temporary-chats.mjs';
const chunkSize=256*1024;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

export function createBodyExchange(context,hostId,authorize,withCodec) {
  const documents=new Map();
  function owned(ownerId,chatId) {
    const account=context.accountState(ownerId),chat=account.chatIdentity?.chats[chatId];
    if(!chat||chat.kind!=='side')throw failure('BODY_UNAVAILABLE',404);
    const segments=Object.values(account.chatIdentity.segments).filter(row=>row.chatId===chatId);
    if(!segments.length||segments.some(row=>hasPrivateContent(account.sessions[row.sessionId])||account.sessions[row.sessionId]?.deleting||account.sessions[row.sessionId]?.phoneHistory))
      throw failure('BODY_UNAVAILABLE',404);
    if(account.memoryCleanupPending)throw failure('MEMORY_CLEANUP_PENDING',503);
    return {account,chat,segments};
  }
  async function build(ownerId,chatId,check) {
    const {chat,segments}=owned(ownerId,chatId),revision=chat.contentRevision;
    let before=null,complete=false;const events=[];
    do {
      check();const params=new URLSearchParams({limit:'200'});
      if(before)params.set('before',before);
      const page=await context.chatTimeline.query(ownerId,chatId,'events',params);
      if(owned(ownerId,chatId).chat.contentRevision!==revision)throw failure('REVISION_CHANGED',409);
      events.unshift(...page.items);
      if(!page.hasOlder){complete=true;break;}
      if(!page.olderCursor||page.olderCursor===before)throw failure('BODY_BUSY',409);
      before=page.olderCursor;
    }while(events.length<200000);
    if(!complete)throw failure('BODY_TOO_LARGE',413);
    const unique=[...new Map(events.map(row=>[row.eventId,row])).values()];
    const messages=unique.filter(row=>['user.message','assistant.message'].includes(row.type)).map(row=>({
      id:row.eventId,at:row.at,role:row.type==='user.message'?'user':'assistant',text:typeof row.data?.text==='string'?row.data.text:''}));
    const sessionIds=new Set(segments.map(row=>row.sessionId)),receipts=new Set(unique.map(row=>row.data?.receiptId).filter(Boolean));
    const attachments=[];
    for(const command of Object.values(context.accountState(ownerId).commands)){
      if(!sessionIds.has(command.sessionId)||!receipts.has(command.receiptId))continue;
      for(const ref of command.payload?.originalAttachments??[]){
        const id=ref.attachmentId;
        if(!id||attachments.some(row=>row.id===id))continue;
        if(typeof ref.name!=='string'||!Number.isSafeInteger(ref.size)||typeof ref.contentType!=='string'||!/^[a-f0-9]{64}$/.test(ref.sha256))throw failure('BODY_UNAVAILABLE',404);
        attachments.push({id,name:ref.name,size:ref.size,contentType:ref.contentType,sha256:ref.sha256});
      }
    }
    check();if(owned(ownerId,chatId).chat.contentRevision!==revision)throw failure('REVISION_CHANGED',409);
    const active=context.accountState(ownerId).sessions[context.accountState(ownerId).chatIdentity.segments[chat.activeSegmentId]?.sessionId];
    const doc={schema:1,hostId,chatId,modelProfileId:active?.modelProfileId??null,contentRevision:revision,messages,attachments,remember:false};
    const bytes=Buffer.from(JSON.stringify(doc));
    if(bytes.length>64*1024*1024)throw failure('BODY_TOO_LARGE',413);
    const version=hash(bytes);
    documents.set(ownerId+'/'+chatId,{doc,bytes,version,files:new Map()});
    if(documents.size>16)documents.delete(documents.keys().next().value);
    return {version,size:bytes.length,contentRevision:revision,messages:messages.length,attachments};
  }
  return async(request,box)=>{
    const identity=authorize(request),{ownerId,deviceId,issuer,sub,keyId}=identity;
    const check=()=>{
      const live=authorize(request);
      if(live.ownerId!==ownerId||live.deviceId!==deviceId||live.issuer!==issuer||live.sub!==sub||live.keyId!==keyId)
        throw failure('UNAUTHORIZED',401);
    };
    return withCodec(issuer,sub,hostId,async codec=>{
      let query;
      try{query=await codec.open('body-request',box);}catch{throw failure('BODY_INVALID',403);}
      if(query?.deviceId!==deviceId||typeof query.requestId!=='string'||!/^[\w-]{16,64}$/.test(query.requestId)||
         typeof query.chatId!=='string'||!/^chat-[\w-]{1,120}$/.test(query.chatId))throw failure('BODY_INVALID',403);
      const {chat}=owned(ownerId,query.chatId);let result;
      if(query.action==='manifest')result=await build(ownerId,query.chatId,check);
      else{
        const stored=documents.get(ownerId+'/'+query.chatId);
        if(!stored||stored.version!==query.version||stored.doc.contentRevision!==chat.contentRevision)throw failure('REVISION_CHANGED',409);
        if(query.action!=='file'&&(!Number.isSafeInteger(query.offset)||query.offset<0||query.offset%chunkSize!==0))throw failure('INVALID_REQUEST');
        let bytes,size;
        if(query.action==='read'){size=stored.bytes.length;bytes=stored.bytes.subarray(query.offset,query.offset+chunkSize);}
        else if(query.action==='attachment'||query.action==='file'){
          const ref=stored.doc.attachments.find(row=>row.id===query.attachmentId);
          if(!ref)throw failure('BODY_UNAVAILABLE',404);
          let file=stored.files.get(ref.id);
          if(!file||query.action==='file'){
            file=await context.attachmentStores.get(ownerId).get(ref.id);
            if(file.meta.sha256!==ref.sha256||file.meta.size!==ref.size||
              !context.commandReferencesOriginal(ownerId,file.conversationId,file.messageId,file.meta))throw failure('BODY_UNAVAILABLE',404);
          }
          size=ref.size;
          const handle=await open(file.file,'r');
          try{
            const stat=await handle.stat();
            if(file.modified!==undefined && file.modified!==stat.mtimeMs)throw failure('REVISION_CHANGED',409);
            async function readAt(offset){
              const buffer=Buffer.alloc(Math.min(chunkSize,Math.max(0,size-offset)));let done=0;
              while(done<buffer.length){const read=await handle.read(buffer,done,buffer.length-done,file.offset+offset+done);if(!read.bytesRead)throw failure('BODY_UNAVAILABLE',404);done+=read.bytesRead;}
              return buffer;
            }
            if(query.action==='file'){
              const parts=[],whole=createHash('sha256');
              for(let offset=0;offset<size;offset+=chunkSize){check();const part=await readAt(offset);whole.update(part);parts.push(hash(part));}
              if(whole.digest('hex')!==ref.sha256)throw failure('BODY_UNAVAILABLE',404);
              stored.files.set(ref.id,{...file,modified:stat.mtimeMs});
              if(owned(ownerId,query.chatId).chat.contentRevision!==stored.doc.contentRevision)throw failure('REVISION_CHANGED',409);
              check();return {box:await codec.seal('body-response',{requestId:query.requestId,action:query.action,chatId:query.chatId,
                result:{version:stored.version,size,sha256:ref.sha256,parts}})};
            }
            bytes=await readAt(query.offset);
          }finally{await handle.close();}
        }else throw failure('INVALID_REQUEST');
        if(query.offset>=size||!bytes.length)throw failure('INVALID_REQUEST');
        check();if(owned(ownerId,query.chatId).chat.contentRevision!==stored.doc.contentRevision)throw failure('REVISION_CHANGED',409);
        result={version:stored.version,offset:query.offset,size,data:bytes.toString('base64'),next:query.offset+bytes.length<size?query.offset+bytes.length:null};
      }
      check();return {box:await codec.seal('body-response',{requestId:query.requestId,action:query.action,chatId:query.chatId,result})};
    });
  };
}
