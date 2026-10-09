import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPersonalAccessService } from '../src/personal-access/index.mjs';
import { createChatLifecycle } from '../src/personal-access/chat-lifecycle.mjs';
import { fixture } from './helpers/chat-timeline-fixture.mjs';

test('logical lifecycle uses original side identity, revision checks and durable idempotent deletion', async () => {
  const root = await mkdtemp(join(tmpdir(),'ia2b-lifecycle-')); let deleted = 0, service;
  const backend: any = { getStatus: async()=>({}), listModels: async()=>[], preflight:async()=>({}), createSession:async()=>({}),
    sendMessage:async()=>({}), cancelSession:async()=>({}), renameSession:async({title})=>({title}),
    describeSession:async sessionId=>({sessionId,title:'synthetic',running:false}),
    deleteSession:async()=>{deleted++;return {deleted:true};}, readEvents:async()=>({events:[],nextSeq:-1,hasMore:false,hasOlder:false}) };
  try {
    service=await createPersonalAccessService({root,port:0,backend});const device=await service.enrollDevice({name:'synthetic'});
    await service.attachSession('session-00000000-0000-4000-8000-000000000001'); let {origin}=await service.start();
    const api=async(path,body?,method=body?'POST':'GET')=>{const response=await fetch(origin+'/personal/v1'+path,{method,
      headers:{authorization:`Bearer ${device.token}`,'content-type':'application/json'},body:body&&JSON.stringify(body)});return {status:response.status,body:await response.json()};};
    const chatId=(await api('/sessions/session-00000000-0000-4000-8000-000000000001/chat')).body.chatId;
    let chat=(await api(`/chats/${chatId}`)).body.chat;
    const rename={requestId:'rename',expectedRevision:chat.revision,title:'logical title'};
    let result=await api(`/chats/${chatId}/metadata`,rename,'PATCH');assert.equal(result.status,200,JSON.stringify(result));
    assert.equal(result.body.chat.title,'logical title');
    assert.deepEqual((await api(`/chats/${chatId}/metadata`,rename,'PATCH')).body,result.body);
    assert.equal((await api(`/chats/${chatId}/archive`,{requestId:'stale',expectedRevision:chat.revision})).status,409);
    chat=result.body.chat;
    result=await api(`/chats/${chatId}/archive`,{requestId:'archive',expectedRevision:chat.revision});assert.equal(result.body.chat.archived,true);
    result=await api(`/chats/${chatId}/unarchive`,{requestId:'unarchive',expectedRevision:result.body.chat.revision});assert.equal(result.body.chat.archived,false);
    const body={requestId:'delete',expectedRevision:result.body.chat.revision};
    const deletion=await api(`/chats/${chatId}`,body,'DELETE');assert.equal(deletion.status,200,JSON.stringify(deletion));assert.equal(deleted,1);
    await service.close();service=await createPersonalAccessService({root,port:0,backend});({origin}=await service.start());
    assert.equal((await api(`/chats/${chatId}`,body,'DELETE')).body.deleted,true);assert.equal(deleted,1);
    assert.equal((await api(`/chats/${chatId}`)).status,404);
  } finally {await service?.close();await rm(root,{recursive:true,force:true});}
});

test('main forget preview deduplicates original segment provenance; resource cursors bound each read and reset on erasure',async()=>{
  const f:any=fixture(3000),ctx=f.context;let calls=0;
  ctx.sessionOperations={previewSessionForget:async()=>({worldRevision:4,items:[{kind:'cognition',id:'same',text:'synthetic'}],evidenceIds:['evidence']})};
  const api=createChatLifecycle(ctx);
  try{
    const preview=await api.preview('owner',f.mainId);assert.equal(preview.sessionCount,3);assert.equal(preview.itemCount,1);assert.equal(preview.evidenceCount,1);
    let before=f.reads.calls;
    const first=await api.resources('owner',f.mainId,new URLSearchParams());assert.equal(f.reads.calls-before,1);assert.equal(first.hasMore,true);
    before=f.reads.calls;
    const second=await api.resources('owner',f.mainId,new URLSearchParams({cursor:first.nextCursor}));assert.equal(f.reads.calls-before,1);assert.notEqual(first.nextCursor,second.nextCursor);
    f.account.chatIdentity.chats[f.mainId].contentRevision++;
    await assert.rejects(api.resources('owner',f.mainId,new URLSearchParams({cursor:first.nextCursor})),{code:'CURSOR_RESET_REQUIRED'});
    ctx.sessionOperations.previewSessionForget=async()=>({worldRevision:++calls,items:[],evidenceIds:[]});
    await assert.rejects(api.preview('owner',f.mainId),{code:'MEMORY_REVISION_CHANGED'});
  }finally{await f.timeline.close();}
});
