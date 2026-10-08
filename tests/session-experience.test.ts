import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sessionWorkspace } from '../src/personal-access/session-workspace.mjs';
import { createSessionOperations } from '../src/personal-access/sessions.mjs';
import { createPersonalAccessBackend } from '../src/personal-access-backend.mjs';

test('workspaces isolate accounts and sessions using the native cwd creation payload', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'weftmate-m2-4-'));
  try {
    const a=sessionWorkspace(root,'owner-a','session-a'),b=sessionWorkspace(root,'owner-b','session-a'),c=sessionWorkspace(root,'owner-a','session-b');
    assert.notEqual(a,b);assert.notEqual(a,c);assert.throws(()=>sessionWorkspace(root,'owner-a','../bad'));
    const requests:any[]=[],items:any[]=[];
    const backend=createPersonalAccessBackend({currentOrigin:()=> 'http://fixture',referenceScan:()=>({}),profiles:()=>[{id:'model',model:'synthetic'}],hasCredential:()=>true,
      routeForProfile:()=>({provider:'fixture'}),listSessions:async()=>({items}),resolveSession:async()=>({}),ensureKnownSession:async()=>{},queue:(fn:any)=>fn(),bindSession:()=>{},sessionWorkspaceRoot:root,
      gateway:async(p:string,options:any)=>{if(p==='/models')return {groups:[{id:'fixture',models:[{id:'synthetic'}]}]};if(p==='/sessions'){const body=JSON.parse(options.body);requests.push(body);items.push(body);return {sessionId:body.sessionId}}return {deleted:true}}});
    await backend.createSession({sessionId:'session-a',modelProfileId:'model',ownerId:'owner-a'});
    assert.equal(requests[0].cwd,a);await writeFile(path.join(a,'经验.md'),'method');
    await backend.deleteSession({sessionId:'session-a',ownerId:'owner-a'});await assert.rejects(access(a));
  } finally {await rm(root,{recursive:true,force:true})}
});
function fixture(root:string) {
  const account:any={ownerId:'owner',sessions:{'session-a':{ownerId:'owner',origin:'personal-remote'}},commands:{},toolApprovals:{},userQuestions:{}};
  let running=false,cancelled=false,deleted=false;
  const calls:any[]=[];
  const context:any={root,accountState:(owner:string)=>{assert.equal(owner,'owner');return account},serial:(fn:any)=>fn(),mutate:async(owner:string,fn:any)=>fn(account),callBackend:(fn:any)=>fn(),
    backend:{describeSession:async()=>({running}),cancelSession:async()=>{cancelled=true;running=false},deleteSession:async()=>{deleted=true;return {deleted:true}}},
    memoryManager:{status:async()=>({capabilities:{deleteEvidence:true}}),query:async(_owner:string,method:string)=>method==='query_jobs'?{jobs:[{acceptance:{parent_session_id:'session-a',evidence_ids:['e-a']}},{acceptance:{parent_session_id:'session-other',evidence_ids:['e-other']}}]}:{world_revision:2},
      submitCommand:async(owner:string,command:any)=>{calls.push({owner,command});return {result_state:'applied',storage_cleanup:{state:'complete'}}}}};
  return {account,operations:createSessionOperations(context),calls,context,start:()=>{running=true},get cancelled(){return cancelled},get deleted(){return deleted}};
}
test('archive preserves experience and restores without changing ownership',async()=>{
  const f=fixture('unused');await f.operations.archiveSession('owner','session-a',true);assert.equal(f.account.sessions['session-a'].archived,true);
  await f.operations.archiveSession('owner','session-a',false);assert.equal(f.account.sessions['session-a'].archived,false);
  await assert.rejects(f.operations.archiveSession('owner','missing',true),{code:'SESSION_UNAVAILABLE'});
});
test('default deletion stops the running session and removes its records and files while retaining memory',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'weftmate-m2-4-'));
  try{const f=fixture(root);f.start();f.account.commands.c={commandId:'c',kind:'session.message',state:'accepted_by_dsh',sessionId:'session-a'};
    const dir=path.join(root,'artifacts','owner','c');await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'note'),'experience');
    await f.operations.deleteSession('owner','session-a');assert.ok(f.cancelled&&f.deleted);assert.deepEqual(f.account.sessions,{});assert.deepEqual(f.account.commands,{});assert.equal(f.calls.length,0);await assert.rejects(access(dir));
  }finally{await rm(root,{recursive:true,force:true})}
});
test('forget option calls MemoWeft true delete only for this account/session source evidence',async()=>{
  const f=fixture('unused');const result=await f.operations.deleteSession('owner','session-a',{forgetMemories:true});
  assert.equal(result.forgottenEvidenceCount,1);assert.equal(f.calls[0].owner,'owner');assert.equal(f.calls[0].command.operation,'delete_evidence');assert.equal(f.calls[0].command.targetId,'e-a');
});
test('unavailable or rejected true forgetting keeps the conversation available for retry',async()=>{
  const f=fixture('unused');f.context.memoryManager.status=async()=>({capabilities:{deleteEvidence:false}});
  await assert.rejects(f.operations.deleteSession('owner','session-a',{forgetMemories:true}),{code:'MEMORY_DELETE_UNAVAILABLE'});assert.ok(f.account.sessions['session-a']);assert.equal(f.deleted,false);
});
import { createPersonalAccessService } from '../src/personal-access/index.mjs';
test('HTTP contract hides archived sessions, denies send, restores and deletes durably',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'weftmate-m2-4-api-')),known=new Set<string>();
  const backend:any={getStatus:async()=>({runtime:'ready'}),listModels:async()=>[{id:'local',name:'Local',model:'test',configured:true}],preflight:async()=>({ok:true}),
    createSession:async({sessionId}:any)=>{known.add(sessionId);return {sessionId}},sendMessage:async()=>({accepted:true}),cancelSession:async()=>({accepted:true}),readEvents:async()=>({events:[],nextSeq:-1,hasMore:false}),
    describeSession:async(sessionId:string)=>({sessionId,title:'Test',agentPreset:'personal-remote',running:false}),deleteSession:async({sessionId}:any)=>{known.delete(sessionId);return {deleted:true}}};
  let service=await createPersonalAccessService({root,port:0,backend});
  try{const {origin,hostId}=await service.start(),device=await service.enrollDevice({name:'test'});
    const request=async(route:string,method='GET',body?:any)=>{const r=await fetch(origin+'/personal/v1'+route,{method,headers:{authorization:`Bearer ${device.token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()}};
    const sent=await request('/commands','POST',{requestId:'create',kind:'session.create',targetDeviceId:hostId,modelProfileId:'local'});assert.equal(sent.status,202);
    let command;for(let i=0;i<100;i++){command=(await request('/commands/'+sent.body.command.commandId)).body.command;if(command.state==='accepted_by_dsh')break;await new Promise(r=>setTimeout(r,20))}assert.equal(command.state,'accepted_by_dsh');
    const id=command.sessionId;assert.equal((await request(`/sessions/${id}/archive`,'POST',{})).status,200);assert.equal((await request('/sessions')).body.sessions.length,0);
    assert.equal((await request('/sessions?archived=true')).body.sessions[0].archived,true);
    assert.equal((await request('/commands','POST',{requestId:'denied',kind:'session.message',targetDeviceId:hostId,sessionId:id,text:'hello'})).body.error.code,'SESSION_ARCHIVED');
    assert.equal((await request(`/sessions/${id}/unarchive`,'POST',{})).status,200);assert.equal((await request('/sessions')).body.sessions.length,1);
    assert.equal((await request(`/sessions/${id}`,'DELETE',{forgetMemories:true})).status,403,'device token cannot forget account memory');
    assert.equal((await request(`/sessions/${id}`,'DELETE',{})).status,200);assert.equal((await request('/sessions?archived=all')).body.sessions.length,0);
    await service.close();service=await createPersonalAccessService({root,port:0,backend});await service.start();
    const store=JSON.parse(await readFile(path.join(root,'store.json'),'utf8'));assert.equal(Object.keys(store.accounts[store.legacyOwnerId].sessions).length,0);
  }finally{await service.close();await rm(root,{recursive:true,force:true})}
});
test('uncertain dispatch and rejected true forgetting do not claim deletion',async()=>{
  const f=fixture('unused');f.account.commands.c={sessionId:'session-a',state:'uncertain'};
  await assert.rejects(f.operations.deleteSession('owner','session-a'),{code:'SESSION_BUSY'});assert.equal(f.deleted,false);
  f.account.commands={};f.context.memoryManager.submitCommand=async()=>({result_state:'rejected'});
  await assert.rejects(f.operations.deleteSession('owner','session-a',{forgetMemories:true}),{code:'MEMORY_DELETE_CONFLICT'});assert.ok(f.account.sessions['session-a']);assert.equal(f.account.sessions['session-a'].deleting,undefined);
});
