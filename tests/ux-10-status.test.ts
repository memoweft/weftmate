import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createSessionMetadata } from '../src/personal-access/session-metadata.mjs';
import { aggregateStatus, statusRank, terminalOutcome } from '../src/personal-access/session-status.mjs';
import { createPersonalAccessService } from '../src/personal-access/index.mjs';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDshSessionAdapter } from '../src/runtime/dsh-adapter/sessions.mjs';

const at = '2026-10-10T00:00:00Z';
const event = (seq:number,reason:string) => ({seq,type:'turn.ended',at,data:{reason}});
function fixture() {
  let account:any={sessions:{s:{readMessageSeq:-1},other:{readMessageSeq:-1,projectId:'p'}},commands:{}};
  let history:any[]=[];let reads=0;
  const context:any={accountState:()=>account,timestamp:()=>Date.parse(at),callBackend:async(fn:any)=>fn(),serial:async(fn:any)=>fn(),
    mutate:async(_:any,fn:any)=>{account=structuredClone(account);fn(account);},backend:{readEvents:async()=>{reads++;return {events:history};}}};
  const summaries=createSessionMetadata(context);
  return {summaries,get account(){return account;},replace:(value:any)=>{account=value;},history:(value:any[])=>{history=value;},reads:()=>reads};
}
test('D55 desktop/mobile/search and host agree on every priority including stopped',()=>{
  const global:any={WeftUiCore:{factories:{}}};runInNewContext(readFileSync('src/ui-core/sessions.js','utf8'),global);
  const rows=[{}, {unread:true,lastOutcome:'stopped'}, {unread:true,lastOutcome:'failed'}, {unread:true,running:true},
    {attention:'question',running:true,unread:true}, {attention:'approval',running:true,unread:true}];
  rows.forEach((row,index)=>assert.equal(global.WeftUiCore.sessionStatus(row).rank,statusRank(row)));
  for(let i=0;i<rows.length;i++) assert.equal(statusRank(aggregateStatus(rows.slice(0,i+1))),i);
  assert.equal(global.WeftUiCore.sessionStatus(rows[1]).label,'已完成，未读');
  assert.equal(terminalOutcome(event(1,'aborted')),'stopped');
  assert.equal(terminalOutcome(event(2,'max-tokens')),null); // Only the adapter's normalized error is a failure fact.
});
test('D55 observed terminal without an assistant message is unread and read snapshots clear it',async()=>{
  const f=fixture();f.history([event(8,'failed')]);await f.summaries.initialize('o');
  assert.equal((await f.summaries.summary('o','s')).lastOutcome,'failed');assert.equal((await f.summaries.summary('o','s')).unread,true);
  await f.summaries.metadata('o','s',{unread:false});assert.equal((await f.summaries.summary('o','s')).unread,false);
  f.summaries.observe('o','s',[event(12,'aborted'),event(3,'failed')]);
  assert.equal((await f.summaries.summary('o','s')).lastOutcome,'stopped');assert.equal((await f.summaries.summary('o','s')).unread,true);
  const reads=f.reads();await f.summaries.summary('o','s');await f.summaries.summary('o','s');assert.equal(f.reads(),reads);
});
test('D55 read covers messages before the tail but never consumes a terminal observed after its native snapshot',async()=>{
  let account:any={sessions:{s:{readMessageSeq:-1}},commands:{}};let release:any;
  const context:any={accountState:()=>account,serial:async(fn:any)=>fn(),callBackend:async(fn:any)=>fn(),mutate:async(_:any,fn:any)=>{account=structuredClone(account);fn(account);},
    backend:{readEvents:async()=>new Promise(resolve=>release=resolve)}};
  const f=createSessionMetadata(context);f.observe('o','s',[{seq:3,type:'assistant.message',at},event(5,'failed')]);
  const reading=f.metadata('o','s',{unread:false});await Promise.resolve();f.observe('o','s',[event(250,'completed')]);
  release({events:[{seq:200,type:'step.started',at}],nextSeq:200});await reading;
  assert.equal(account.sessions.s.readMessageSeq,200);assert.equal((await f.summary('o','s')).unread,true);
  context.backend.readEvents=async()=>({events:[{seq:260,type:'step.started',at}],nextSeq:260});await f.metadata('o','s',{unread:false});
  assert.equal((await f.summary('o','s')).unread,false);
});
test('D55 pending native interactions update with account snapshots and disappear on answer, timeout or restart',async()=>{
  const f=fixture();f.replace({...f.account,commands:{c:{toolApprovals:[{sessionId:'s',status:'pending',createdAt:at,runtimeId:'live'}],userQuestions:[{sessionId:'s',status:'pending',runtimeId:'live'}]}}});
  assert.equal((await f.summaries.summary('o','s')).attention,'approval');
  const next=structuredClone(f.account);next.commands.c.toolApprovals[0].status='answered';f.replace(next);
  assert.equal((await f.summaries.summary('o','s')).attention,'question');
  const final=structuredClone(f.account);final.commands.c.userQuestions[0].status='resolved';f.replace(final);
  assert.equal((await f.summaries.summary('o','s')).attention,null);
  const restarted=createSessionMetadata({accountState:()=>next,closedToolRuntimeIds:new Set(['live']),timestamp:()=>Date.parse(at)} as any);
  assert.equal((await restarted.summary('o','s')).attention,null);
  const timedOut=createSessionMetadata({accountState:()=>({sessions:{s:{}},commands:{c:{toolApprovals:[{sessionId:'s',status:'pending',createdAt:at}]}}}),timestamp:()=>Date.parse(at)+600000} as any);
  assert.equal((await timedOut.summary('o','s')).attention,null);
  let checks=0;const commands={c:{toolApprovals:[{sessionId:'s',runtimeId:'live',status:'pending',createdAt:at}]}};
  const closed=new Set();const wrappers=createSessionMetadata({accountState:()=>({sessions:{s:{}},commands}),timestamp:()=>Date.parse(at),closedToolRuntimeIds:closed,
    approvalUnavailableReason:()=>{checks++;return null;}} as any);
  await wrappers.summary('o','s');await wrappers.summary('o','s');assert.equal(checks,1,'fresh account wrappers share the same command snapshot cache');
  closed.add('live');assert.equal((await wrappers.summary('o','s')).attention,null);
});
test('D55 summary includes children beyond the first 100 rows and excludes archived/deleting sessions',async()=>{
  const account:any={sessions:Object.fromEntries(Array.from({length:500},(_,i)=>['s'+i,{readMessageSeq:-1,groupId:'g',...(i>250?{projectId:'p'}:{})}])),commands:{}};
  account.commands.pending={toolApprovals:[{sessionId:'s499',status:'pending',createdAt:at}],userQuestions:[{sessionId:'s200',status:'pending'}]};
  const f=createSessionMetadata({accountState:()=>account,timestamp:()=>Date.parse(at)} as any);
  const summary=await f.statusSummary('o',new Map([['s1',{running:true}]]));
  assert.equal(summary.projects.p.attention,'approval');assert.equal(summary.groups.g.attention,'question');assert.equal(summary.main.attention,'question');assert.equal(summary.all.attention,'approval');
  account.sessions.s499.archived=true;account.sessions.s200.deleting=true;
  const excluded=await f.statusSummary('o',new Map([['s1',{running:true}]]));assert.equal(excluded.all.attention,null);assert.equal(excluded.all.running,true);
});
test('D55 invalidate/forget/deletion cannot revive terminal facts and account summaries cover hidden pages',async()=>{
  const f=fixture();f.summaries.observe('o','s',[event(10,'completed')]);f.summaries.observe('o','other',[event(20,'failed')]);
  let summary=await f.summaries.statusSummary('o',new Map());assert.equal(summary.projects.p.lastOutcome,'failed');assert.equal(summary.main.lastOutcome,'completed');
  f.summaries.invalidate('o','s');f.account.sessions.s.forgottenSeqs=[10];f.summaries.observe('o','s',[event(10,'completed')]);
  assert.equal((await f.summaries.summary('o','s')).lastOutcome,null);
  f.summaries.invalidate('o','other');delete f.account.sessions.other;f.summaries.observe('o','other',[event(20,'failed')]);
  await assert.rejects(f.summaries.summary('o','other'),{code:'SESSION_UNAVAILABLE'});
  summary=await f.summaries.statusSummary('o',new Map());assert.deepEqual(summary.projects,{});
});
test('D55 restart finds a terminal behind a long current turn outside the list request',async()=>{
  const account:any={sessions:{s:{readMessageSeq:-1}},commands:{}};let reads=0;
  const f=createSessionMetadata({accountState:()=>account,callBackend:async(fn:any)=>fn(),backend:{readEvents:async(input:any)=>{
    reads++;return input.beforeSeq===200 ? {events:[event(3,'failed')],hasMore:false,hasOlder:false} : {events:[{seq:210,type:'step.started',at}],hasMore:false,hasOlder:true,nextBeforeSeq:200};}}} as any);
  await f.initialize('o');assert.equal(reads,2);assert.equal((await f.summary('o','s')).lastOutcome,'failed');assert.equal(reads,2);
});
test('D55 native adapter backward pages recover the previous terminal behind 250 current tool calls',async()=>{
  const raw:any[]=[{seq:0,type:'turn/start',time:Date.parse(at),data:{turn:1}},{seq:1,type:'turn/end',time:Date.parse(at),data:{turn:1,reason:{kind:'error'}}},
    {seq:2,type:'turn/start',time:Date.parse(at),data:{turn:2}}];
  for(let i=0;i<250;i++)raw.push({seq:raw.length,type:'tool/call',time:Date.parse(at),data:{turn:2,callId:'call-'+i,name:'read',arguments:'{"paths":["synthetic.md"]}'}});
  const adapter=createDshSessionAdapter({sessions:{list:async()=>({result:{ok:true,value:{items:[{sessionId:'s',origin:'user'}]}}})},events:{}} as any,{readLog:async()=>raw});
  let reads=0;const f=createSessionMetadata({accountState:()=>({sessions:{s:{}},commands:{}}),callBackend:async(fn:any)=>fn(),backend:{readEvents:async(input:any)=>{reads++;return adapter.historyPage(input.sessionId,input);}}} as any);
  await f.initialize('o');assert.equal((await f.summary('o','s')).lastOutcome,'failed');assert.equal(reads,2);
});
test('D55 real host API rebuilds outcome after restart, clears read and removes deleted/private-source status copies',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'weftmate-ux10-api-'))),logs=new Map<string,any[]>();
  let host:any,origin:string,auth:any,cookie:string,sessionId:string;
  const adapter=createDshSessionAdapter({sessions:{list:async()=>({result:{ok:true,value:{items:[...logs.keys()].map(sessionId=>({sessionId,origin:'user'}))}}})},events:{}} as any,{readLog:async(id:string)=>logs.get(id)});
  const backend:any={getStatus:async()=>({runtime:'ready'}),listModels:async()=>[{id:'local',model:'synthetic',configured:true}],preflight:async()=>({ok:true}),
    createSession:async(input:any)=>{logs.set(input.sessionId,[{seq:0,type:'turn/start',time:Date.parse(at),data:{turn:1}},{seq:1,type:'turn/end',time:Date.parse(at),data:{turn:1,reason:{kind:'error'}}}]);return {sessionId:input.sessionId};},
    sendMessage:async()=>({accepted:true}),cancelSession:async()=>({accepted:true}),deleteSession:async({sessionId}:any)=>{logs.delete(sessionId);return {deleted:true};},
    describeSession:async(id:string)=>logs.has(id)?{sessionId:id,agentPreset:'personal-remote',modelProfileId:'local',running:false,title:'合成失败任务'}:null,
    readEvents:async(input:any)=>adapter.historyPage(input.sessionId,input)};
  async function request(path:string,body?:any,method=body?'POST':'GET'){
    const response=await fetch(origin+'/personal/v1'+path,{method,headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{}),...(auth?{'x-weftmate-csrf':auth.csrfToken}:{})},body:body?JSON.stringify(body):undefined});
    const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result as any;
  }
  try {
    host=await createPersonalAccessService({root,port:0,backend});const started=await host.start();origin=started.origin;
    const grant=await host.issueSetupGrant();const setup=await fetch(origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,username:'synthetic-ux10',password:'synthetic-'+randomUUID(),deviceName:'Synthetic'})});
    assert.equal(setup.status,201);auth=await setup.json();cookie=setup.headers.get('set-cookie')!.split(';')[0];
    let command=(await request('/commands',{requestId:randomUUID(),kind:'session.create',modelProfileId:'local',targetDeviceId:started.hostId})).command;
    while(command.state!=='accepted_by_dsh'){assert.notEqual(command.state,'rejected');await new Promise(done=>setTimeout(done,10));command=(await request('/commands/'+command.commandId)).command;}
    sessionId=command.sessionId;await request(`/sessions/${sessionId}/events`);
    let row=(await request('/sessions')).sessions.find((row:any)=>row.sessionId===sessionId);
    assert.equal(row.lastOutcome,'failed');assert.equal(row.unread,true);
    const chat=(await request('/chats?limit=100')).items.find((row:any)=>row.activeSessionId===sessionId);
    assert.equal(chat.lastOutcome,'failed');assert.equal(chat.unread,true);
    await host.close();host=await createPersonalAccessService({root,port:0,backend});origin=(await host.start()).origin;
    row=(await request('/sessions')).sessions.find((row:any)=>row.sessionId===sessionId);
    assert.equal(row.lastOutcome,'failed');assert.equal(row.unread,true);
    await request(`/sessions/${sessionId}/metadata`,{unread:false,memoryMode:'off'},'PATCH');
    row=(await request('/sessions')).sessions.find((row:any)=>row.sessionId===sessionId);
    assert.equal(row.lastOutcome,'failed');assert.equal(row.unread,false);assert.equal(row.attention,null);
    assert.equal(row.memoryMode,'off');assert.equal(JSON.stringify((await request('/sessions')).statusSummary).includes('读取项目资料'),false);
    await request(`/sessions/${sessionId}`,{},'DELETE');
    assert.ok(!(await request('/sessions')).sessions.some((row:any)=>row.sessionId===sessionId));
    assert.ok(!(await request('/chats?limit=100')).items.some((row:any)=>row.activeSessionId===sessionId));
  } finally {await host?.close();await rm(root,{recursive:true,force:true});}
});
test('D55 latest main read uses the existing metadata route, respects newer history and identity, and requires exact capability 1',async()=>{
  const context:any={WeftUiCore:{factories:{},ChatWindow:{create:()=>({state:{hasNewer:false},reset:()=>{}})}}};
  runInNewContext(readFileSync('src/ui-core/main-chat.js','utf8'),context);
  const chat={chatId:'main',activeSessionId:'s',unread:true,revision:1};let writes=0,refreshes=0,release:any;
  const core:any={state:{ownerId:'o',identityGeneration:0,historyGeneration:0,selectedChatId:'main',activeChatSource:'desktop',sessions:[],mainChat:chat,personalCapabilities:{sessionStatus:1}},
    refreshSessions:async()=>{refreshes++;},accessApi:async(path:string,options:any)=>{writes++;assert.equal(path,'/chats/main/metadata');assert.equal(options.body.unread,false);return new Promise(resolve=>release=resolve);}};
  const noop=()=>{};const effects=new Proxy({}, {get:()=>noop});
  const actions=context.WeftUiCore.factories.mainChat(core,effects,{crypto:{randomUUID:()=> 'synthetic-read'}});
  core.state.chatWindow.hasNewer=true;await actions.markLatestChatRead();assert.equal(writes,0);
  core.state.chatWindow.hasNewer=false;const reading=actions.markLatestChatRead();await actions.markLatestChatRead();assert.equal(writes,1);
  release({chat:{...chat,unread:false,revision:2}});await reading;assert.equal(core.state.mainChat.unread,false);assert.equal(refreshes,1);
  core.state.mainChat={...chat};core.state.personalCapabilities.sessionStatus=2;await actions.markLatestChatRead();assert.equal(writes,1);
  core.state.personalCapabilities.sessionStatus=1;const late=actions.markLatestChatRead();core.state.identityGeneration++;core.state.mainChat={...chat,chatId:'new-owner'};
  release({chat:{...chat,unread:false}});await late;assert.equal(core.state.mainChat.chatId,'new-owner');assert.equal(refreshes,1);
});
