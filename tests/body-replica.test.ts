import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as jose from 'jose';
import {accountDataCodec} from '../src/personal-cloud/directory-wire.mjs';
import {createBodyExchange} from '../src/personal-cloud/body-replica.mjs';
import {openBodyReplica} from '../src/ui-core/body-replica.mjs';
async function fixture(t:any){
  const root=await mkdtemp(join(tmpdir(),'body-copy-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const raw=Buffer.from('synthetic attachment '.repeat(30000)),file=join(root,'original');
  await writeFile(file,raw);const sha256=createHash('sha256').update(raw).digest('hex');
  const chatId='chat-synthetic',attachment={attachmentId:'file',name:'synthetic.txt',size:raw.length,sha256,contentType:'text/plain'};
  const account:any={chatIdentity:{chats:{[chatId]:{kind:'side',contentRevision:1,activeSegmentId:'segment'}},segments:{segment:{chatId,sessionId:'session'}}},
    sessions:{session:{modelProfileId:'profile'}},commands:{command:{sessionId:'session',receiptId:'receipt',payload:{originalAttachments:[attachment]}}}};
  const state={text:'synthetic original',online:true,replay:false,reads:0,fileReads:0,epoch:0,failWrite:false,failPart:false,wait:undefined as Promise<void>|undefined};
  let directory:any={label:'computer',rows:[{id:chatId,title:'chat',contentRevision:1,seq:1}]},lastReply:any;
  const codec=accountDataCodec(jose,randomBytes(32),['issuer','sub','key','source'],'wm-body-replica+jwe');
  const context={accountState:()=>account,attachmentStores:new Map([['owner',{get:async()=>{state.fileReads++;return {file,offset:0,conversationId:'session',messageId:'message',meta:attachment};}}]]),
    commandReferencesOriginal:()=>true,chatTimeline:{query:async()=>({items:[{eventId:'message',type:'user.message',at:'2026-11-05',data:{text:state.text,receiptId:'receipt'}}],hasOlder:false})}};
  const auth=()=>({ownerId:'owner',deviceId:'device',issuer:'issuer',sub:'sub',keyId:'key'});
  const source=createBodyExchange(context,'source',auth,(_i:any,_s:any,_h:any,fn:any)=>fn(codec));
  const records=new Map<string,string>();
  const store={read:async(kind:string,id:string)=>records.get(kind+':'+id),guard:async()=>({epoch:state.epoch}),
    write:async(kind:string,id:string,old:string,next:string,guard:any)=>{if(state.failWrite||records.get(kind+':'+id)!==old||guard.epoch!==state.epoch)throw Error('write failed');records.set(kind+':'+id,next);},
    remove:async(id:string,all:boolean)=>{state.epoch++;for(const key of records.keys())if(key==='body-cache:'+id||key.startsWith('body-file:'+id+'/')||all&&key==='body-local:'+id)records.delete(key);},
    clear:async()=>{state.epoch++;for(const key of records.keys())if(!key.startsWith('body-local:'))records.delete(key);}};
  const make=(deviceId='device',readCopy?:any)=>openBodyReplica({codec,store,current:()=>{},deviceId,random:randomUUID,
    directory:async()=>({box:'directory',cache:directory}),syncDirectory:async()=>{},readCopy,
    exchange:async({box}:any)=>{
      if(!state.online)throw Object.assign(Error('offline'),{code:'NETWORK'});
      const input=await codec.open('body-request',box);state.reads++;
      if(state.failPart&&input.offset>0)throw Error('interrupted');
      if(state.replay&&lastReply)return lastReply;
      const response=await source({},box);lastReply=response;if(input.action==='read'&&state.wait)await state.wait;return response;
    }});
  return {client:make(),make,state,records,account,chatId,raw,setDirectory:(value:any)=>{directory=value;}};
}
test('body data is cached only after complete verified retrieval; files are fetched on demand in chunks',async t=>{
  const f=await fixture(t);const loaded=await f.client.open(f.chatId);
  assert.equal(loaded.doc.messages[0].text,'synthetic original');assert.equal(f.state.fileReads,0);
  assert.ok(!f.records.get('body-cache:'+f.chatId)?.includes('synthetic original'));
  const before=f.state.reads;await f.client.open(f.chatId);assert.equal(f.state.reads,before);
  const attachment=await f.client.attachment(f.chatId,'file');assert.deepEqual(Buffer.from(await attachment.blob.arrayBuffer()),f.raw);
  f.state.online=false;
  assert.equal((await f.client.open(f.chatId)).doc.messages.length,1);
  assert.deepEqual(Buffer.from(await(await f.client.attachment(f.chatId,'file')).blob.arrayBuffer()),f.raw);
});
test('erasure revisions and tombstones remove imported copies while explicit cache clearing retains new local messages',async t=>{
  const f=await fixture(t);await f.client.open(f.chatId);
  await f.client.append(f.chatId,{role:'user',text:'own new message'});
  await f.client.clear();assert.equal((await f.client.read(f.chatId)).doc,null);assert.equal((await f.client.read(f.chatId)).local.length,1);
  await f.client.open(f.chatId);
  f.account.chatIdentity.chats[f.chatId].contentRevision=2;f.state.text='redacted';
  f.setDirectory({label:'computer',rows:[{id:f.chatId,title:'chat',seq:2,contentRevision:2}]});
  await f.client.refresh();assert.equal((await f.client.read(f.chatId)).doc,null);
  assert.equal((await f.client.open(f.chatId)).doc.messages[0].text,'redacted');
  f.setDirectory({rows:[{id:f.chatId,deleted:true,seq:3}]});await f.client.refresh();
  await assert.rejects(f.client.read(f.chatId),{code:'BODY_UNAVAILABLE'});
  assert.equal(f.records.has('body-local:'+f.chatId),false);
});
test('private source, another device, interrupted chunks and failed writes cannot create a valid copy',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.make('other').open(f.chatId),{code:'BODY_INVALID'});
  f.account.sessions.session.memoryMode='off';await assert.rejects(f.client.open(f.chatId),{code:'BODY_UNAVAILABLE'});
  delete f.account.sessions.session.memoryMode;
  f.state.text='text'.repeat(100000);f.state.failPart=true;await assert.rejects(f.client.open(f.chatId),/interrupted/);
  assert.equal(f.records.size,0);f.state.failPart=false;f.state.failWrite=true;
  await assert.rejects(f.client.open(f.chatId),/write failed/);assert.equal(f.records.size,0);
});
test('a verified replica provider is consulted before the source and stale responses never become a body',async t=>{
  const f=await fixture(t),source=await f.client.open(f.chatId);await f.client.clear();f.state.online=false;
  const copy=f.make('device',async()=>source);assert.equal((await copy.open(f.chatId)).doc.messages[0].text,'synthetic original');
  await f.client.clear();f.state.online=true;f.state.replay=true;
  await assert.rejects(f.client.open(f.chatId),{code:'BODY_INVALID'});assert.equal(f.records.has('body-cache:'+f.chatId),false);
});

test('clearing local copies while a body response is in flight prevents it being written back',async t=>{
  const f=await fixture(t);let release:()=>void;
  f.state.wait=new Promise<void>(done=>{release=done;});
  const opening=f.client.open(f.chatId);
  while(f.state.reads<2)await new Promise(done=>setTimeout(done,1));
  await f.client.clear();release!();
  await assert.rejects(opening,/write failed/);
  assert.equal(f.records.has('body-cache:'+f.chatId),false);
});
