import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createMessageBranches } from '../src/personal-access/message-branches.mjs';
import { createSessionOperations } from '../src/personal-access/sessions.mjs';
import { eraseChatCopies } from '../src/personal-access/chat-erasure.mjs';
import { createAttachmentStore } from '../src/personal-sync/attachments.mjs';
import { createSharedAttachmentStore } from '../src/personal-access/shared-attachments.mjs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createDshSessionAdapter } from '../src/runtime/dsh-adapter/sessions.mjs';
function fixture() {
  const account:any = { sessions: { source: { ownerId: 'a', origin: 'personal-remote', modelProfileId: 'm', title: '合成', approvalMode: 'ask', projectId: 'project', projectRevision: 2 } }, commands: {} };
  const events = [{ seq: 1, type: 'user.message', data: {text:'旧目标'} }, {seq:2,type:'assistant.message',data:{text:'旧回复'}},
    {seq:3,type:'turn.ended'}, {seq:5,type:'turn.started'}, {seq:7,type:'user.message',data:{text:'这次目标',receiptId:'r'}},
    {seq:9,type:'assistant.message',data:{text:'这次回复'}}, {seq:11,type:'turn.ended'}];
  const calls:any[] = []; let running = false;
  const context:any = { accountState: (owner:string)=>owner==='a'?account:{sessions:{},commands:{}},
    serial: (fn:any)=>fn(), mutate: async(_owner:string, fn:any)=>fn(account), callBackend:(fn:any)=>fn(),
    requestIdUsed:()=>false, modelVisible:(_owner:string,id:string)=>['m','other'].includes(id),
    backend:{describeSession:async()=>({running}),readEvents:async()=>({events,hasMore:false,nextSeq:11}),
      forkSession:async(input:any)=>{calls.push(input);return {title:'合成（分叉）',latestSeq:3}}}};
  return { account, calls, context, operations: createMessageBranches(context), run:()=>{running=true} };
}
test('edit and regeneration fork at a native turn boundary, preserve source, inherit project and approval, and select a new model',async()=>{
  const f=fixture(); const source=structuredClone(f.account.sessions.source);
  const edit=await f.operations.create('a','source',{requestId:'edit',seq:7,action:'edit'});
  const regen=await f.operations.create('a','source',{requestId:'regen',seq:9,action:'regenerate',modelProfileId:'other'});
  assert.equal(f.calls[0].beforeSeq,5);assert.equal(f.calls[1].beforeSeq,5);
  assert.equal(regen.modelProfileId,'other');assert.equal(regen.text,'这次目标');
  assert.deepEqual(f.account.sessions.source,source);assert.equal(f.account.sessions[edit.sessionId].approvalMode,'ask');
  assert.equal(f.account.sessions[edit.sessionId].projectId,'project');
  assert.deepEqual(await f.operations.create('a','source',{requestId:'edit',seq:7,action:'edit'}),edit);
  assert.equal(f.calls.length,2);
  await assert.rejects(f.operations.create('a','source',{requestId:'edit',seq:9,action:'regenerate'}),{code:'REQUEST_CONFLICT'});
  assert.equal(f.operations.versions('a','source').groups[0].versions.length,2);
});
test('message actions reject running, queued, foreign, unavailable model and non-message anchors',async()=>{
  const f=fixture();f.run();await assert.rejects(f.operations.create('a','source',{requestId:'a',seq:7,action:'edit'}),{code:'SESSION_BUSY'});
  const g=fixture();g.account.commands.c={sessionId:'source',state:'uncertain'};
  await assert.rejects(g.operations.create('a','source',{requestId:'a',seq:7,action:'edit'}),{code:'SESSION_BUSY'});
  const h=fixture();await assert.rejects(h.operations.create('b','source',{requestId:'a',seq:7,action:'edit'}),{code:'SESSION_UNAVAILABLE'});
  await assert.rejects(h.operations.create('a','source',{requestId:'a',seq:7,action:'edit',modelProfileId:'private'}),{code:'MODEL_UNAVAILABLE'});
  await assert.rejects(h.operations.create('a','source',{requestId:'a',seq:5,action:'edit'}),{code:'SOURCE_UNAVAILABLE'});
  assert.equal(h.calls.length,0);
});
test('editing a historical steer preserves the earlier user goal in that native turn',async()=>{
  const f=fixture();f.context.backend.readEvents=async()=>({hasMore:false,nextSeq:11,events:[
    {seq:3,type:'turn.ended'}, {seq:5,type:'turn.started'}, {seq:6,type:'user.message',data:{text:'原目标'}},
    {seq:7,type:'user.message',data:{text:'补充约束'}}, {seq:9,type:'assistant.message',data:{text:'答复'}}]});
  await f.operations.create('a','source',{requestId:'steer',seq:7,action:'edit'});assert.equal(f.calls[0].beforeSeq,7);
});
test('version ordering uses creation order even for numeric request IDs, and archived originals remain switchable',async()=>{
  const f=fixture(),first=await f.operations.create('a','source',{requestId:'10',seq:7,action:'edit'}),second=await f.operations.create('a','source',{requestId:'2',seq:7,action:'edit'});
  f.account.sessions.source.archived=true;
  assert.deepEqual(f.operations.versions('a','source').groups[0].versions.map(row=>row.sessionId),['source',first.sessionId,second.sessionId]);
});
test('main chat cannot use full-history message branching',async()=>{
  const f=fixture();f.account.chatIdentity={sessionSegments:{source:'s'},segments:{s:{chatId:'main'}},chats:{main:{kind:'main'}}};
  await assert.rejects(f.operations.create('a','source',{requestId:'a',seq:7,action:'edit'}),{code:'MAIN_CHAT_PROTECTED'});
});
test('phone-adopted host branches retain the original chat-only native origin',async()=>{
  const f=fixture();f.account.sessions.source.origin='shared-chat';
  const branch=await f.operations.create('a','source',{requestId:'phone',seq:7,action:'edit'});
  assert.equal(f.account.sessions[branch.sessionId].origin,'shared-chat');
});
test('released attachment material is reconstructed from the uploaded original, copied under the child, and cleaned on failed fork',async()=>{
  const root=await mkdtemp(join(tmpdir(),'weftmate-ux4-attachments-'));
  try {
    const f=fixture(),source='session-'+randomUUID(),referenceId='attachment-'+randomUUID(),messageId=randomUUID();
    f.account.sessions[source]=f.account.sessions.source;delete f.account.sessions.source;
    const originals=await createAttachmentStore({root:join(root,'originals')}),staging=await createSharedAttachmentStore({root:join(root,'staging')});
    f.context.attachmentStores=new Map([['a',originals]]);f.context.sharedAttachmentStores=new Map([['a',staging]]);
    const bytes=Buffer.from('synthetic original file'),stagedBytes=bytes.subarray(0,9),hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
    const reference=(await originals.put({attachmentId:referenceId,conversationId:source,messageId,name:'合成.txt',contentType:'text/plain',sha256:hash(bytes),bytes})).attachment;
    const staged=(await staging.put({sessionId:source,requestId:'original-send',attachmentId:referenceId,name:'合成.txt',contentType:'text/plain',sha256:hash(stagedBytes),bytes:stagedBytes})).attachment;
    f.account.commands.c={kind:'session.message',sessionId:source,requestId:'original-send',receiptId:'r',payload:{text:'这次目标',attachments:[staged],originalAttachments:[reference],attachmentMessageId:messageId}};
    await staging.release({sessionId:source,requestId:'original-send',attachments:[staged]});
    const branch=await f.operations.create('a',source,{requestId:'copy',seq:7,action:'edit'});
    assert.equal(branch.originalAttachments[0].attachmentId,branch.attachments[0].attachmentId);
    assert.notEqual(branch.attachments[0].attachmentId,referenceId);
    assert.equal((await originals.get(branch.originalAttachments[0].attachmentId)).conversationId,branch.sessionId);
    assert.equal((await staging.resolve({sessionId:branch.sessionId,requestId:branch.sendRequestId,attachments:branch.attachments}))[0].bytes.toString(),'synthetic');
    const count=(await readdir(join(root,'originals'))).length;
    f.context.backend.forkSession=async()=>{throw Object.assign(new Error(),{code:'BACKEND_UNAVAILABLE'})};
    await assert.rejects(f.operations.create('a',source,{requestId:'fail',seq:7,action:'edit'}),{code:'BACKEND_UNAVAILABLE'});
    assert.equal((await readdir(join(root,'originals'))).length,count);
  } finally {await rm(root,{recursive:true,force:true})}
});
test('native constructor seed queue insertions are historical input and never become child tasks; erasure removes branch copies',async()=>{
  const f=fixture(),branch=await f.operations.create('a','source',{requestId:'edit',seq:7,action:'edit'});
  const operations=createSessionOperations(f.context);
  const inherited=operations.publicHistoryEvent('a',branch.sessionId,{seq:2,type:'task.queued',data:{receiptId:'old',text:'old'}});
  assert.equal(inherited.data.inherited,true);
  const live=operations.publicHistoryEvent('a',branch.sessionId,{seq:5,type:'task.queued',data:{receiptId:'new',text:'new'}});
  assert.equal(live.data.inherited,undefined);
  eraseChatCopies(f.account,{sessionId:'source'});assert.deepEqual(f.account.messageBranches,{});
});
test('the editor receives exact owner-bound original user text, including paths, only after matching the native receipt and input hash',()=>{
  const f=fixture(),text='请读取 C:\\Synthetic\\document.md';
  f.account.commands.c={kind:'session.message',sessionId:'source',receiptId:'r',state:'accepted_by_dsh',payload:{text}};
  const operations=createSessionOperations(f.context),event={seq:7,type:'user.message',data:{receiptId:'r',text:'请读取 [local path]',messageHash:createHash('sha256').update(text).digest('hex')}};
  assert.equal(operations.publicHistoryEvent('a','source',event).data.text,text);
  assert.equal(operations.publicHistoryEvent('b','source',event).data.text,'请读取 [local path]');
  assert.equal(operations.publicHistoryEvent('a','foreign',event).data.text,'请读取 [local path]');
  f.account.sessions.copy={parentSessionId:'source'};assert.equal(operations.publicHistoryEvent('a','copy',event).data.text,text);
});
test('full message detail recovers a long visible reply without exposing reasoning or injected context',async()=>{
  const text='完整长回复。'.repeat(1000),events=[{seq:0,time:1,type:'assistant/message',data:{content:[{type:'reasoning',text:'private-hidden-reasoning'},{type:'text',text}]}},
    {seq:1,time:2,type:'user/message',data:{source:{kind:'plugin',plugin:'private-context'},content:[{type:'text',text:'private-injected-context'}]}}];
  const adapter=createDshSessionAdapter({sessions:{list:async()=>({result:{ok:true,value:{items:[{sessionId:'s',origin:'user'}]}}})},events:{}},{readLog:async()=>events});
  const detail=await adapter.historyDetail('s',0);assert.equal(detail.type,'assistant.message');assert.equal(detail.text,text);assert.doesNotMatch(detail.text,/private/);
  await assert.rejects(adapter.historyDetail('s',1));
  const sandbox:any={WeftUiCore:{factories:{}},setTimeout,TextEncoder,Uint8Array,Date};runInNewContext(readFileSync(new URL('../src/ui-core/message-actions.js',import.meta.url),'utf8'),sandbox);
  const core:any={state:{ownerId:'a',identityGeneration:1},readTimelineDetail:async()=>detail};
  Object.assign(core,sandbox.WeftUiCore.factories.messageActions(core,{},{}));
  const complete=await core.completeMessageEvent('s',{seq:0,type:'assistant.message',data:{text:text.slice(0,4000),truncated:true}});
  assert.equal(complete.data.text,text);assert.equal(complete.data.truncated,false);
});
test('main edit uses bounded side-chat source references across segments and the same delivery receipt, never a full-history fork',async()=>{
  const sandbox:any={WeftUiCore:{factories:{}},setTimeout,TextEncoder,Uint8Array,Date};runInNewContext(readFileSync(new URL('../src/ui-core/message-actions.js',import.meta.url),'utf8'),sandbox);
  const store=new Map(),calls:any[]=[],user={eventId:'event-user',sourceRef:{kind:'native',sessionId:'old-segment',seq:7},type:'user.message',data:{text:'原目标'}};
  const reply={eventId:'event-reply',sourceRef:{kind:'native',sessionId:'new-segment',seq:2},seq:2,type:'assistant.message',data:{text:'原回复'}};
  const core:any={state:{ownerId:'a',identityGeneration:1,sessions:[],online:true,hostId:'host'},readMainChat:async()=>({chat:{chatId:'main'}}),readChat:async()=>({chat:{modelProfileId:'m',running:false}}),
    readChatEvents:async()=>({items:[user,reply],hasOlder:false}),readCommand:async()=>({command:{state:'accepted_by_dsh',sessionId:'side'}}),refreshSessions:async()=>{},selectSession:async()=>{},
    createSideChat:async(body:any)=>{calls.push(body);return {command:{state:'accepted_by_dsh',sessionId:'side'}}},accessApi:async(path:string,options:any)=>{
      if(path.endsWith('/chat'))return {kind:'main',chatId:'main'};
      if(path.includes('/sessions/old-segment/events?'))return {events:[{...user,seq:7}]};
      if(path.includes('/commands/by-request/'))throw {code:'NOT_FOUND'};
      if(path==='/commands'){calls.push(options.body);return {command:{state:'accepted_by_dsh'}}}
      throw new Error('Unexpected route '+path);
    }};
  Object.assign(core,sandbox.WeftUiCore.factories.messageActions(core,{}, {storage:{getItem:(k:string)=>store.get(k),setItem:(k:string,v:string)=>store.set(k,v),removeItem:(k:string)=>store.delete(k)}}));
  await core.branchMessage('new-segment',reply,'regenerate',null,null,'request');
  assert.equal(calls[0].originChatId,'main');assert.equal(calls[0].originEventId,'event-reply');assert.equal(calls[0].parent.kind,'main');
  assert.equal(calls[1].text,'原目标');assert.equal(calls[1].requestId,'request.send');assert.equal(store.size,0);
});
test('export sanitizes credentials and paths before preview/files; tools are opt-in and Markdown/plain copy differ',async()=>{
  const sandbox:any={WeftUiCore:{factories:{}}};runInNewContext(readFileSync(new URL('../src/ui-core/message-actions.js',import.meta.url),'utf8'),sandbox);
  const raw='api_key="a secret with spaces"\nBearer abcsecret\nsk-abcdefghijklmnop\nC:\\Users\\Synthetic\\secret.txt\n/home/synthetic/key\n/workspace/local/output.md\n[链接](https://example.com/docs)\n**粗体**';
  const redacted=sandbox.WeftUiCore.redactExport(raw);
  assert.doesNotMatch(redacted,/abcsecret|abcdefghijklmnop|a secret|Synthetic|\/home\/synthetic|\/workspace\/local/);
  assert.match(redacted,/https:\/\/example.com\/docs/);
  assert.equal(sandbox.WeftUiCore.messagePlainText('**粗体**\n[链接](https://example.com)'),'粗体\n链接');
  assert.equal(sandbox.WeftUiCore.messagePlainText('```python\nx ** 2\n```'),'x ** 2\n');
  const store=new Map(),core:any={state:{ownerId:'a',identityGeneration:1,sessions:[],online:true},interfaceText:(x:any)=>x};
  Object.assign(core,sandbox.WeftUiCore.factories.messageActions(core,{}, {storage:{getItem:(k:string)=>store.get(k),setItem:(k:string,v:string)=>store.set(k,v)}}));
  const events=[{type:'assistant.message',data:{text:raw}},{type:'step.completed',data:{summary:'读取 C:\\private\\file.txt'}}];
  assert.doesNotMatch(core.messageExport(events,'合成'),/读取/);assert.match(core.messageExport(events,'合成',true),/读取 \[本机路径已隐藏\]/);
  await core.saveMessageFeedback('s',7,'unhelpful','不准确','请核对');assert.equal(core.readMessageFeedback()[0].note,'请核对');
  core.state.ownerId='b';assert.equal(core.readMessageFeedback().length,0);core.state.ownerId='a';assert.equal(core.readMessageFeedback().length,1);
});
test('desktop feedback survives a new loopback origin and waits for a native durable save before reporting success',async()=>{
  const sandbox:any={WeftUiCore:{factories:{}},setTimeout,TextEncoder,Uint8Array,Date};runInNewContext(readFileSync(new URL('../src/ui-core/message-actions.js',import.meta.url),'utf8'),sandbox);
  const native=new Map();
  const create=()=>{const store=new Map(),core:any={state:{ownerId:'owner',identityGeneration:1}};Object.assign(core,sandbox.WeftUiCore.factories.messageActions(core,{}, {
    storage:{getItem:(k:string)=>store.get(k),setItem:(k:string,v:string)=>store.set(k,v)},
    feedbackStorage:async(k:string,v?:string)=>v===undefined?native.get(k):native.set(k,v)}));return core;};
  const first=create();await first.saveMessageFeedback('s',7,'unhelpful','不准确','核对原文');
  const newOrigin=create();await newOrigin.loadMessageFeedback();assert.equal(newOrigin.readMessageFeedback()[0].note,'核对原文');
  newOrigin.state.ownerId='other';await newOrigin.loadMessageFeedback();assert.equal(newOrigin.readMessageFeedback().length,0);
});
