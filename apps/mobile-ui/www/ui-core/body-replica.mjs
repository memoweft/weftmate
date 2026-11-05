const invalid=code=>Object.assign(new Error(code),{code});
const bytes=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),b=>b.toString(16).padStart(2,'0')).join('');

export function openBodyReplica({codec,store,current,exchange,directory,syncDirectory,readCopy,readFileCopy,deviceId,random}) {
  async function load(kind,id){
    const box=await store.read(kind,id);current();
    return {box,value:box===undefined?null:await codec.open(kind,box)};
  }
  async function save(kind,id,old,value,guard){
    const box=await codec.seal(kind,value);current();await store.write(kind,id,old,box,guard);
    return value;
  }
  async function ask(action,chatId,fields={}){
    const requestId=random(),box=await codec.seal('body-request',{action,chatId,deviceId,requestId,...fields});
    current();const response=await exchange({box}),reply=await codec.open('body-response',response.box);current();
    if(reply.requestId!==requestId||reply.chatId!==chatId||reply.action!==action)throw invalid('BODY_INVALID');
    return reply.result;
  }
  async function guard(chatId){
    const state=await directory(),row=state.cache?.rows.find(row=>row.id===chatId);
    if(!row||row.deleted)throw invalid('BODY_UNAVAILABLE');
    return {row,dependencies:await store.guard(state.box)};
  }
  async function chunks(action,chatId,manifest,attachmentId){
    const parts=[];let offset=0,total=0;
    do{
      const part=await ask(action,chatId,{version:manifest.version,offset,...(attachmentId?{attachmentId}:{})});
      if(part.offset!==offset||part.version!==manifest.version||part.size!==manifest.size)throw invalid('BODY_INVALID');
      const content=bytes(part.data);
      if(!content.length||content.length>256*1024||offset+content.length>manifest.size||
         part.next!==(offset+content.length<manifest.size?offset+content.length:null))throw invalid('BODY_INVALID');
      parts.push(content);total+=content.length;offset=part.next;
    }while(offset!==null);
    const data=new Uint8Array(total);let position=0;
    for(const part of parts){data.set(part,position);position+=part.length;}
    if(await digest(data)!==manifest.sha256)throw invalid('BODY_INVALID');
    return data;
  }
  async function read(chatId){
    const state=await guard(chatId),cached=await load('body-cache',chatId),local=await load('body-local',chatId);
    const valid=cached.value?.doc.contentRevision===(state.row.contentRevision??1);
    if(cached.value&&!valid)await store.remove(chatId,false);
    return {doc:valid?cached.value.doc:null,version:valid?cached.value.version:null,local:local.value??[]};
  }
  async function open(chatId){
    const cached=await read(chatId);
    if(cached.doc)return cached;
    const state=await guard(chatId);
    let copy;
    try{copy=await readCopy?.(chatId);}catch{/* Try the source when its copy cannot be read. */}
    let doc,version;
    if(copy){doc=copy.doc;version=copy.version;if(await digest(new TextEncoder().encode(JSON.stringify(doc)))!==version)throw invalid('BODY_INVALID');}
    else{
      const manifest=await ask('manifest',chatId);
      if(manifest.size<1||manifest.size>64*1024*1024)throw invalid('BODY_TOO_LARGE');
      const data=await chunks('read',chatId,{...manifest,sha256:manifest.version});
      doc=JSON.parse(new TextDecoder().decode(data));version=manifest.version;
    }
    if(doc?.schema!==1||doc.chatId!==chatId||doc.contentRevision!==(state.row.contentRevision??1)||!Array.isArray(doc.messages)||!Array.isArray(doc.attachments))throw invalid('BODY_INVALID');
    const old=await load('body-cache',chatId);
    await save('body-cache',chatId,old.box,{doc,version},state.dependencies);
    return {...cached,doc,version};
  }
  async function refresh(){
    await syncDirectory();const state=await directory();
    for(const row of state.cache?.rows??[]){
      if(row.deleted){await store.remove(row.id,true);continue;}
      const cached=await load('body-cache',row.id);
      if(cached.value&&cached.value.doc.contentRevision!==(row.contentRevision??1))await store.remove(row.id,false);
    }
  }
  return {read,open,refresh,
    async list(){
      const state=await directory(),items=[];
      for(const row of state.cache?.rows??[]){
        if(row.deleted)continue;
        const cached=await read(row.id);items.push({...row,...cached,device:state.cache.label});
      }
      return items;
    },
    async size(chatId){
      const state=await guard(chatId),prior=await load('body-size',chatId);
      if(prior.value?.sequence===state.row.seq)return prior.value.size;
      let result;try{result=await readCopy?.(chatId,true);}catch{}
      if(!result)result=await ask('manifest',chatId);
      await save('body-size',chatId,prior.box,{sequence:state.row.seq,size:result.size},state.dependencies);
      return result.size;
    },
    async append(chatId,message){
      const state=await guard(chatId),before=await load('body-local',chatId),cached=await read(chatId);
      if(!cached.doc)throw invalid('BODY_NOT_READY');
      return save('body-local',chatId,before.box,[...(before.value??[]),message],state.dependencies);
    },
    async attachment(chatId,id){
      const state=await guard(chatId),body=await open(chatId),ref=body.doc.attachments.find(item=>item.id===id);
      if(!ref)throw invalid('BODY_UNAVAILABLE');
      const key=chatId+'/'+id,meta=await load('body-file',key+'/index');
      let manifest=meta.value,provider;
      try{provider=await readFileCopy?.(chatId,id,ref.sha256);}catch{}
      if(manifest?.sha256!==ref.sha256){
        if(provider)manifest=provider.manifest;
        else{
          const current=await ask('manifest',chatId);
          if(current.version!==body.version)throw invalid('REVISION_CHANGED');
          manifest=await ask('file',chatId,{version:body.version,attachmentId:id});
        }
        if(manifest.sha256!==ref.sha256||manifest.size!==ref.size||!Array.isArray(manifest.parts)||manifest.parts.length!==Math.ceil(ref.size/(256*1024)))throw invalid('BODY_INVALID');
      }
      const parts=[];
      for(let part=0;part<manifest.parts.length;part++){
        const slot=key+'/'+part,cached=await load('body-file',slot);
        let data;
        if(cached.value?.sha256===manifest.parts[part])data=bytes(cached.value.data);
        else{
          const offset=part*256*1024;
          const result=provider?await provider.readPart(offset):await ask('attachment',chatId,{version:body.version,attachmentId:id,offset});
          if(result.offset!==offset||result.version!==body.version||result.size!==ref.size)throw invalid('BODY_INVALID');
          data=bytes(result.data);
          if(data.length!==Math.min(256*1024,ref.size-offset)||await digest(data)!==manifest.parts[part])throw invalid('BODY_INVALID');
          await save('body-file',slot,cached.box,{sha256:manifest.parts[part],data:result.data},state.dependencies);
        }
        parts.push(data);
      }
      if(meta.value?.sha256!==manifest.sha256)await save('body-file',key+'/index',meta.box,manifest,state.dependencies);
      return {blob:new Blob(parts,{type:ref.contentType}),...ref};
    },
    clear:()=>store.clear(),
  };
}
