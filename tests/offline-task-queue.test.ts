import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, randomUUID } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { taskRecipient, sealReplica, openTask } from '../src/personal-offline/crypto.mjs';
import { createOfflineTaskReceiver, offlineCommandSource } from '../src/personal-offline/tasks.mjs';
import { createCommandOperations } from '../src/personal-access/commands.mjs';
import { activityNotificationContent } from '../src/personal-access/notification-content.mjs';
import { observeActivityEvents } from '../src/personal-access/activity.mjs';
import { putActivity } from '../src/personal-access/activity-store.mjs';
import '../src/ui-core/offline.js';
import { tamperCiphertext } from './helpers/tamper-ciphertext.mjs';
const W=(globalThis as any).WeftOffline;
const identity={ownerId:'owner',hostId:'host',deviceId:'cookie'};
const secret='S7_DEVICE_ONLY_把合成项目里的说明读给我';
const recipient=taskRecipient();
const header=(id:string)=>({purpose:'offline-task',id,accountId:'account',hostId:'host',deviceId:'phone',generation:1});
test('phone encrypts using the existing replica envelope; wrong key, host and ciphertext fail without leaking text',async()=>{
  const vault=await W.browserVault('crypto',{indexedDB:new IDBFactory(),crypto:webcrypto}),id=randomUUID();
  try{const envelope=await vault.seal({text:secret,sessionId:'session'},recipient.publicJwk,header(id));
    assert.deepEqual(openTask(envelope,recipient,header(id)),{text:secret,sessionId:'session'});assert.ok(!JSON.stringify(envelope).includes(secret));
    for(const key of [taskRecipient(),{...recipient,publicJwk:taskRecipient().publicJwk}])assert.throws(()=>openTask(envelope,key,header(id)),{code:'OFFLINE_TASK_INVALID'});
    assert.throws(()=>openTask(envelope,recipient,{...header(id),hostId:'other'}),{code:'OFFLINE_TASK_INVALID'});
    assert.throws(()=>openTask({...envelope,ciphertext:tamperCiphertext(envelope.ciphertext)},recipient,header(id)),{code:'OFFLINE_TASK_INVALID'});
  }finally{vault.close();}
});
test('phone persists encrypted retry identity, closes immediately after acceptance, restores status and clears on erasure',async()=>{
  const indexedDB=new IDBFactory(),scope=JSON.stringify(['synthetic','owner']);let generation=1,lost=true,uploads:any[]=[],remote:any[]=[];
  const vault=await W.browserVault(scope,{indexedDB,crypto:webcrypto}),jwk=await vault.key();
  const host=async()=>sealReplica({generation,reset:false,remove:[],items:[],hashes:{},recent:[{id:'session',projectId:'project',messages:[]}],taskRecipient:recipient.publicJwk,control:{accountId:'account',hostId:'host',capabilities:{offlineTasks:1}}},jwk,identity);
  const control=async()=>({authorized:true,hostId:'host',accountId:'account',generation,capabilities:{offlineTasks:1}});
  const tasks=async(action:string,body:any)=>{
    if(action==='submit'){uploads.push(body);remote=[{id:body.id,hostId:'host',createdAt:Date.now(),state:'waiting'}];if(lost){lost=false;throw Error('NETWORK');}return remote[0];}
    if(action==='list')return {items:remote};if(action==='cancel'){remote[0].state='canceled';return remote[0];}if(action==='clear'){remote=[];return {deleted:true};}
  };
  let engine=await W.create({vault,identity,host,control,tasks,taskDevice:async()=> 'phone',crypto:webcrypto});await engine.sync();
  await assert.rejects(engine.submitTask(secret,'recent:session'));const task=engine.view().tasks[0];assert.equal(task.state,'sending');
  assert.equal(openTask(task.envelope,recipient,header(task.id)).projectId,'project');assert.ok(!JSON.stringify(uploads).includes(secret));
  await engine.retryTask(task.id);assert.deepEqual(uploads[1],uploads[0]);engine.close();
  engine=await W.create({vault:await W.browserVault(scope,{indexedDB,crypto:webcrypto}),identity,host,control,tasks,taskDevice:async()=> 'phone',crypto:webcrypto});
  assert.equal(engine.view().tasks[0].text,secret);remote[0].state='started';await engine.refreshTasks();assert.equal(engine.view().tasks[0].state,'started');
  remote[0].state='expired';await engine.refreshTasks();assert.equal(engine.view().tasks[0].state,'expired');
  remote=[];await engine.refreshTasks();assert.equal(engine.view().tasks[0].state,'expired','cloud metadata cleanup must not relabel an expired task as canceled');
  generation++;await assert.rejects(engine.refreshTasks(),{code:'OFFLINE_RESET_REQUIRED'});assert.equal(engine.view().tasks.length,0);engine.close();
});
test('previously connected computers retain authenticated recipient keys; explicit target is inside the authenticated envelope',async()=>{
  const indexedDB=new IDBFactory(),other=taskRecipient(),scopes=[JSON.stringify(['host-origin-one','owner-one']),JSON.stringify(['host-origin-two','owner-two'])];
  const snapshot=(hostId:string,key:any)=>({generation:1,items:[],recent:[],taskRecipient:key,control:{hostId,accountId:'account',capabilities:{offlineTasks:1}}});
  const v1=await W.browserVault(scopes[0],{indexedDB,crypto:webcrypto}),v2=await W.browserVault(scopes[1],{indexedDB,crypto:webcrypto});
  await v1.save({snapshot:snapshot('host',recipient.publicJwk),tasks:[],turns:[],conversations:[]});await v2.save({snapshot:snapshot('other-host',other.publicJwk),tasks:[],turns:[],conversations:[]});v2.close();
  let sent:any;
  const engine=await W.create({vault:v1,identity,host:async()=>{},control:async(hostId:string)=>({hostId,accountId:'account',authorized:true,generation:1,capabilities:{offlineTasks:1}}),taskDevice:async()=> 'phone',crypto:webcrypto,
    tasks:async(action:string,body:any)=>{sent=body;return {id:body.id,state:'waiting',hostId:body.hostId};}});
  assert.deepEqual(engine.view().targets.map((s:any)=>s.control.hostId),['host','other-host']);await engine.check();await engine.submitTask(secret,null,'other-host');
  assert.equal(sent.hostId,'other-host');const body=openTask(sent.envelope,other,{...header(sent.id),hostId:'other-host'});assert.equal(body.sessionId,null);assert.equal(body.text,secret);engine.close();
});

for(const action of ['forget','revoke'])test(`another computer's ${action} clears its phone tasks and encrypted replica while the current computer stays connected`,async()=>{
  const indexedDB=new IDBFactory(),other=taskRecipient(),scopeA=JSON.stringify(['A','ownerA']),scopeB=JSON.stringify(['B','ownerB']);
  const vault=await W.browserVault(scopeA,{indexedDB,crypto:webcrypto}),b=await W.browserVault(scopeB,{indexedDB,crypto:webcrypto});
  const snapshot=(hostId:string,key:any)=>({generation:1,items:[],recent:[],taskRecipient:key,control:{hostId,accountId:'account',capabilities:{offlineTasks:1}}});
  await vault.save({snapshot:snapshot('host',recipient.publicJwk),tasks:[],turns:[],conversations:[]});await b.save({snapshot:snapshot('other-host',other.publicJwk),tasks:[],turns:[],conversations:[]});b.close();
  let changed=false;
  const engine=await W.create({vault,identity,host:async()=>{},control:async(hostId:string)=>({hostId,accountId:'account',authorized:!(changed&&action==='revoke'&&hostId==='other-host'),generation:changed&&hostId==='other-host'?2:1,capabilities:{offlineTasks:1}}),taskDevice:async()=> 'phone',crypto:webcrypto,
    tasks:async(action:string,body:any)=>action==='list'?{items:[]}:{id:body.id,state:'waiting',hostId:body.hostId}});
  await engine.check();await engine.submitTask(secret,null,'other-host');changed=true;await engine.refreshTasks();
  assert.equal(engine.view().tasks.length,0);assert.deepEqual(engine.view().targets.map((s:any)=>s.control.hostId),['host']);assert.equal(engine.view().taskReady,true);
  const erased=await W.browserVault(scopeB,{indexedDB,crypto:webcrypto});assert.equal((await erased.load()).snapshot,null);erased.close();engine.close();
});
function receiverFixture(){
  const rows:any[]=[],account:any={ownerId:'owner',hostId:'host',commands:{},sessions:{session:{modelProfileId:'model',approvalMode:'ask'}},devices:{cookie:{scopes:['commands:write'],authKind:'cloud',authEpoch:1,revoked:false,expiresAt:'2020-01-01'}}};
  const scheduled:string[]=[],acks:any[]=[],results:any[]=[];let queue=Promise.resolve(),cancel=false;
  const context:any={rootState:{hostId:'host'},ownerIds:()=>['owner'],accountState:()=>account,hostOwner:()=>true,timestamp:Date.now,
    offline:{generation:()=>1},messageModelUsable:()=>true,mainChat:{prepareReminder:async()=> 'session'},
    serial:(fn:Function)=>{const work=queue.then(()=>fn());queue=work.catch(()=>{});return work;},mutate:async(_owner:string,fn:Function)=>fn(account),schedule:(_owner:string,id:string)=>scheduled.push(id),activity:{record:async()=>{}},taskDetail:async()=>({replyEvidence:{}}),
    cloudIdentity:{offlineTasksSupported:()=>true,syncRevocations:async()=>{},offlineAccount:()=>({ownerId:'owner',deviceId:'cookie'}),offlineSource:()=> 'cookie',
      relayRequest:async(path:string,body:any)=>{if(path.endsWith('/claim'))return {items:rows};if(path.endsWith('/ack')){const c:any=Object.values(account.commands).find((c:any)=>c.commandId===body.receiptId);assert.ok(c,'persist before cloud deletion');if(!acks.some(a=>a.receiptId===body.receiptId))assert.equal(c.offlineSource.confirmed,false,'first ack must follow a persisted unconfirmed command');acks.push(body);return {accepted:!cancel};}results.push(body);return {accepted:true};}}};
  const add=(text=secret)=>{const id=randomUUID();rows.push({id,claimId:randomUUID(),accountId:'account',hostId:'host',deviceId:'phone',jkt:'jkt',generation:1,envelope:sealReplica({text,sessionId:'session',projectId:null,createdAt:Date.now()},recipient.publicJwk,header(id))});};
  return {context,account,rows,scheduled,acks,results,add,cancel:()=>cancel=true};
}
test('computer persists receipt before cloud ack, preserves order and deduplicates repeat pulls, two ticks and restart',async()=>{
  const f=receiverFixture();f.add('first');f.add('second');const receiver=createOfflineTaskReceiver(f.context,recipient);await Promise.all([receiver.tick(),receiver.tick()]);
  assert.deepEqual(Object.values(f.account.commands).map((c:any)=>c.payload.text),['first','second']);assert.equal(f.acks.length,2);
  await receiver.tick();await receiver.close();const restarted=createOfflineTaskReceiver(f.context,recipient);await restarted.tick();await restarted.close();assert.equal(Object.keys(f.account.commands).length,2);assert.ok(f.acks.every(row=>Object.hasOwn(f.account.commands,row.receiptId)));
  assert.ok(Object.values(f.account.commands).every((c:any)=>c.payload.mode==='queue'&&c.sourceDeviceId==='cookie'&&c.offlineSource.confirmed));
});
test('cancel racing receipt never schedules execution and removes local plaintext',async()=>{
  const f=receiverFixture();f.add();f.cancel();const receiver=createOfflineTaskReceiver(f.context,recipient);await receiver.tick();await receiver.close();
  assert.equal(f.scheduled.length,0);assert.equal(Object.values(f.account.commands)[0].state,'rejected');assert.ok(!JSON.stringify(f.account).includes(secret));
});

test('host makes zero task requests without explicit cloud support, and enables after a fresh supported receipt',async()=>{
  const f=receiverFixture();let supported=false;f.context.cloudIdentity.offlineTasksSupported=()=>supported;f.add();
  const request=f.context.cloudIdentity.relayRequest,requests:string[]=[];f.context.cloudIdentity.relayRequest=async(path:string,body:any)=>{requests.push(path);return request(path,body);};
  const receiver=createOfflineTaskReceiver(f.context,recipient);await receiver.tick();assert.equal(requests.length,0);assert.equal(f.acks.length,0);assert.equal(Object.keys(f.account.commands).length,0);
  supported=true;await receiver.tick();assert.equal(f.acks.length,1);assert.equal(Object.keys(f.account.commands).length,1);
  const supportedRequests=requests.length;supported=false;await receiver.tick();assert.equal(requests.length,supportedRequests);assert.equal(receiver.canDispatch('owner',Object.keys(f.account.commands)[0]),false);await receiver.close();
});

test('phone ignores cached task keys until cloud advertises support; refresh can enable and disable without any 404 probe',async()=>{
  const vault=await W.browserVault('cloud-capability',{indexedDB:new IDBFactory(),crypto:webcrypto});
  await vault.save({snapshot:{generation:1,items:[],recent:[],model:{modelId:'synthetic'},taskRecipient:recipient.publicJwk,control:{accountId:'account',hostId:'host',capabilities:{offlineTasks:1}}},tasks:[],conversations:[],turns:[]});
  let supported=false,requests=0,chats=0;vault.complete=async()=>{chats++;return {choices:[{message:{content:'合成聊天回复'}}]};};
  const engine=await W.create({vault,identity,host:async()=>{},control:async()=>({authorized:true,hostId:'host',accountId:'account',generation:1,...(supported?{capabilities:{offlineTasks:1}}:{})}),tasks:async()=>{requests++;return {items:[]};},crypto:webcrypto});
  await engine.refreshTasks();assert.equal(engine.view().taskReady,false);assert.equal(requests,0);await engine.send('普通聊天');assert.equal(chats,1);assert.equal(requests,0);
  supported=true;await engine.refreshTasks();assert.equal(engine.view().taskReady,true);assert.equal(requests,1);
  supported=false;await engine.refreshTasks();assert.equal(engine.view().taskReady,false);assert.equal(requests,1);await engine.clearTasks();assert.equal(requests,1);engine.close();
});

test('two receiver connections racing the same delivered task persist one original command',async()=>{
  const f=receiverFixture();f.add();const a=createOfflineTaskReceiver(f.context,recipient),b=createOfflineTaskReceiver(f.context,recipient);
  await Promise.all([a.tick(),b.tick()]);await a.close();await b.close();
  assert.equal(Object.keys(f.account.commands).length,1);assert.equal(new Set(f.acks.map(row=>row.receiptId)).size,1);
});
test('restart keeps confirmed-but-unissued work blocked until authoritative cloud revalidation',async()=>{
  const f=receiverFixture();f.add();const first=createOfflineTaskReceiver(f.context,recipient);await first.tick();await first.close();
  const command:any=Object.values(f.account.commands)[0],restarted=createOfflineTaskReceiver(f.context,recipient);f.context.offline.canDispatch=restarted.canDispatch;
  let sends=0;Object.assign(f.context,{closing:false,storageFault:false,backend:{sendMessage:()=>sends++}});
  await createCommandOperations(f.context).dispatch('owner',command.commandId);assert.equal(command.state,'pending');assert.equal(sends,0);
  f.cancel();await restarted.tick();await restarted.close();assert.equal(command.state,'rejected');assert.equal(sends,0);assert.ok(!JSON.stringify(f.account).includes(secret));
});
test('offline source uses current physical device authorization and same generation, without broadening approval mode',async()=>{
  const f=receiverFixture();f.add();const receiver=createOfflineTaskReceiver(f.context,recipient);await receiver.tick();await receiver.close();const command:any=Object.values(f.account.commands)[0];
  assert.ok(offlineCommandSource(f.context,'owner',command));assert.equal(f.account.sessions.session.approvalMode,'ask');
  f.context.offline.generation=()=>2;assert.equal(offlineCommandSource(f.context,'owner',command),false);
  let sends=0;Object.assign(f.context,{closing:false,storageFault:false,backend:{sendMessage:()=>{sends++;}},scheduled:new Set(),active:new Set(),activeByCommand:new Map()});
  await createCommandOperations(f.context).dispatch('owner',command.commandId);assert.equal(sends,0);assert.equal(command.state,'rejected');
});
test('unavailable computer model is rejected through normal dispatch and reports a generic failure in the original conversation',async()=>{
  const f=receiverFixture(),notices:any[]=[];f.add();f.context.activity.record=async(_owner:string,row:any)=>notices.push(row);
  const receiver=createOfflineTaskReceiver(f.context,recipient);await receiver.tick();const command:any=Object.values(f.account.commands)[0];
  Object.assign(f.context,{closing:false,storageFault:false,messageModelUsable:()=>false});await createCommandOperations(f.context).dispatch('owner',command.commandId);
  assert.equal(command.state,'rejected');assert.equal(command.errorCode,'MODEL_UNAVAILABLE');await receiver.tick();await receiver.close();
  assert.ok(f.results.some(row=>row.state==='failed'));assert.equal(notices[0].type,'task.failed');assert.equal(notices[0].source.sessionId,'session');assert.ok(!JSON.stringify(notices).includes(secret));
});
test('offline completion is observed even for a text-only native task, and notifications including approvals omit task content',()=>{
  const f=receiverFixture(),command:any={commandId:'cmd',sessionId:'session',kind:'session.message',state:'accepted_by_dsh',receiptId:'receipt',payload:{text:secret},offlineSource:{id:'offline'}};f.account.commands.cmd=command;
  observeActivityEvents(f.account,'session',[{seq:0,type:'turn.started',data:{turn:1,receiptId:'receipt'}},{seq:1,type:'user.message',data:{receiptId:'receipt'}},{seq:2,type:'assistant.message',data:{text:secret}},{seq:3,type:'turn.ended',data:{reason:'completed'}}],3);
  assert.equal(f.account.activity.sources.session.terminals.cmd.state,'completed');
  for(const type of ['task.started','task.completed','task.failed','approval.pending']){const notification=activityNotificationContent(f.account,{type,title:secret,summary:secret,approvalOperation:secret,state:'pending',source:{sessionId:'session',taskId:'cmd'}});assert.ok(!JSON.stringify(notification).includes(secret));}
});
test('start and completion keep different activity IDs so native persistent notification deduplication can show both',()=>{
  const f=receiverFixture();f.account.commands.cmd={offlineSource:{},payload:{text:secret}};
  const source={sessionId:'session',taskId:'cmd'};
  const start=putActivity(f.account,'offline-start',{type:'task.started',title:'电脑已开始',summary:'你交代的一件事已经开始。',at:new Date().toISOString(),source});
  const done=putActivity(f.account,'task:cmd',{type:'task.completed',title:'做完了',summary:secret,at:new Date().toISOString(),source});
  assert.notEqual(start.id,done.id);assert.equal(Object.values(f.account.activity.items).filter((r:any)=>r.type==='task.started').length,1);
  assert.equal(putActivity(f.account,'task:cmd',{type:'task.completed',title:'做完了',summary:secret,at:done.at,source}).id,done.id);
});
