import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSessionMetadata } from '../src/personal-access/session-metadata.mjs';
import { createPersonalAccessBackend } from '../src/personal-access-backend.mjs';
import { sessionWorkspace } from '../src/personal-access/session-workspace.mjs';
import { createPersonalAccessService } from '../src/personal-access/index.mjs';

function fixture() {
  const accounts:any = {a:{sessions:{'session-a':{ownerId:'a',origin:'personal-remote',modelProfileId:'m'}}},b:{sessions:{}}};
  const events:any[]=[]; const calls:any[]=[];
  const context:any={accountState:(owner:string)=>accounts[owner],serial:(fn:any)=>fn(),mutate:async(owner:string,fn:any)=>fn(accounts[owner]),callBackend:(fn:any)=>fn(),
    backend:{readEvents:async()=>({events}),renameSession:async(args:any)=>{calls.push(args);return {title:args.title}},
      forkSession:async(args:any)=>{calls.push(args);return {title:'原对话（分叉）',latestSeq:events.at(-1)?.seq,modelProfileId:'m'}}}};
  return {operations:createSessionMetadata(context),accounts,events,calls};
}
test('pin, manual unread/read, arrival unread and native user title persist independently',async()=>{
  const f=fixture();await f.operations.metadata('a','session-a',{pinned:true,unread:true,title:'  合成标题  '});
  assert.equal(f.accounts.a.sessions['session-a'].title,'合成标题');assert.equal((await f.operations.summary('a','session-a')).unread,true);
  f.events.push({seq:9,type:'assistant.message'});await f.operations.metadata('a','session-a',{unread:false});assert.equal((await f.operations.summary('a','session-a')).unread,false);
  f.events.push({seq:15,type:'assistant.message'});assert.equal((await f.operations.summary('a','session-a')).unread,true);
  assert.equal((await f.operations.summary('a','session-a')).pinned,true);assert.equal(f.calls[0].ownerId,'a');
  await assert.rejects(f.operations.metadata('a','session-a',{pinned:'yes'}),{code:'INVALID_REQUEST'});
  await assert.rejects(f.operations.metadata('a','session-a',{title:'  '}),{code:'INVALID_REQUEST'});
  await assert.rejects(f.operations.metadata('a','session-a',{ownerId:'b'}),{code:'INVALID_REQUEST'});
});
test('groups create, rename, move and delete restore membership without losing sessions',async()=>{
  const f=fixture(),result=await f.operations.groups('a','POST',null,{name:'合成资料'}),id=result.group.id;
  await f.operations.metadata('a','session-a',{groupId:id});await f.operations.groups('a','PATCH',id,{name:'合成项目'});
  assert.equal((await f.operations.groups('a','GET',null,{})).groups[0].name,'合成项目');
  assert.equal((await f.operations.summary('a','session-a')).groupId,id);
  await f.operations.metadata('a','session-a',{groupId:null});assert.equal((await f.operations.summary('a','session-a')).groupId,null);
  await f.operations.metadata('a','session-a',{groupId:id});await f.operations.groups('a','DELETE',id,{});
  assert.ok(f.accounts.a.sessions['session-a']);assert.equal((await f.operations.summary('a','session-a')).groupId,null);
});
test('all metadata, groups and forks deny another account; fork leaves source and memory bindings unchanged',async()=>{
  const f=fixture(),before=structuredClone(f.accounts.a.sessions['session-a']);
  for(const action of [()=>f.operations.metadata('b','session-a',{pinned:true}),()=>f.operations.fork('b','session-a'),()=>f.operations.summary('b','session-a')])await assert.rejects(action(),{code:'SESSION_UNAVAILABLE'});
  await assert.rejects(f.operations.metadata('a','constructor',{pinned:true}),{code:'SESSION_UNAVAILABLE'});
  await assert.rejects(f.operations.metadata('a','session-a',{groupId:'constructor'}),{code:'INVALID_REQUEST'});
  await assert.rejects(f.operations.groups('a','DELETE','constructor',{}),{code:'NOT_FOUND'});
  const group=await f.operations.groups('a','POST',null,{name:'A'});await assert.rejects(f.operations.groups('b','PATCH',group.group.id,{name:'B'}),{code:'NOT_FOUND'});
  const child=await f.operations.fork('a','session-a');assert.deepEqual(f.accounts.a.sessions['session-a'],before);
  assert.equal(f.accounts.a.sessions[child.sessionId].parentSessionId,'session-a');assert.equal(f.accounts.a.sessions[child.sessionId].conversationId,undefined);
  assert.equal(Object.keys(f.accounts.b.sessions).length,0);
});
test('menu names, shortcuts and archived taxonomy are shared across renderers',()=>{
  const context:any={WeftUiCore:{factories:{}}};for(const file of ['sessions.js','settings-registry.js'])runInNewContext(readFileSync(new URL('../src/ui-core/'+file,import.meta.url),'utf8'),context);
  const core=context.WeftUiCore;
  assert.deepEqual(Array.from(core.sessionMenuItems({}), (item:any)=>item.id),['pin','unread','rename','fork','project','group','archive','delete']);
  for(const [key,action] of Object.entries({P:'pin',U:'unread',R:'rename',F:'fork',A:'archive',D:'delete'})){assert.equal(core.sessionMenuKey(key),action);assert.equal(core.sessionMenuKey(key.toLowerCase()),action);}
  assert.equal(core.sessionMenuKey('x'),undefined);assert.equal(core.sessionMenuItems({unread:true})[1].label,'标记为已读');
  assert.equal(core.settingsRegistry().list({query:'已归档'})[0].id,'archived');
  const ordered = [{id:'loose'}, {id:'group-b',groupId:'group-b'}, {id:'pinned',pinned:true}, {id:'group-a',groupId:'group-a'}].sort(core.compareSessionGroups);
  assert.deepEqual(ordered.map(row=>row.id),['pinned','group-a','group-b','loose'],'ungrouped stays below groups independently of locale punctuation order');
});
test('backend fork copies workspace and experience independently, binds model and pins native title',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'weftmate-ui5-fork-')),calls:any[]=[];
  try{
    const source=sessionWorkspace(root,'a','session-a'),child=sessionWorkspace(root,'a','session-b');await mkdir(source,{recursive:true});await writeFile(path.join(source,'经验.md'),'合成经验');await writeFile(path.join(source,'script.txt'),'original');
    const backend=createPersonalAccessBackend({currentOrigin:()=> 'http://fixture',referenceScan:()=>({}),profiles:()=>[{id:'m',model:'synthetic'}],hasCredential:()=>true,
      routeForProfile:()=>({provider:'fixture'}),listSessions:async()=>({items:[{sessionId:'session-a',agentPreset:'personal-remote',title:'合成标题'}]}),resolveSession:async()=>({profile:{id:'m'}}),ensureKnownSession:async()=>{},queue:(fn:any)=>fn(),bindSession:(...args:any[])=>calls.push(args),sessionWorkspaceRoot:root,
      gateway:async(p:string,options:any)=>{const body=JSON.parse(options.body);calls.push({p,body});return p.endsWith('/fork')?{sessionId:body.sessionId,latestSeq:7}:p.endsWith('/rename')?{title:body.title}:{deleted:true}}});
    const result=await backend.forkSession({sessionId:'session-a',childId:'session-b',ownerId:'a',modelProfileId:'m'});
    assert.equal(result.title,'合成标题（分叉）');assert.equal(await readFile(path.join(child,'经验.md'),'utf8'),'合成经验');await writeFile(path.join(child,'script.txt'),'child');assert.equal(await readFile(path.join(source,'script.txt'),'utf8'),'original');
    assert.equal(calls.find(row=>row.p?.endsWith('/fork')).body.cwd,child);assert.ok(!calls.some(row=>row.p?.includes('memory')));
  }finally{await rm(root,{recursive:true,force:true})}
});
test('HTTP metadata and groups enforce cookie CSRF, account isolation and durable restart',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'weftmate-ui5-api-')),titles=new Map<string,string>();
  const backend:any={getStatus:async()=>({runtime:'ready'}),listModels:async()=>[{id:'local',model:'test',configured:true}],preflight:async()=>({ok:true}),
    createSession:async({sessionId}:any)=>({sessionId}),sendMessage:async()=>({accepted:true}),cancelSession:async()=>({accepted:true}),readEvents:async()=>({events:[],nextSeq:-1,hasMore:false}),
    describeSession:async(sessionId:string)=>({sessionId,title:titles.get(sessionId)||'Synthetic',agentPreset:'personal-remote',running:false}),
    renameSession:async({sessionId,title}:any)=>{titles.set(sessionId,title);return {title}},forkSession:async()=>({title:'Synthetic（分叉）',modelProfileId:'local'})};
  let service=await createPersonalAccessService({root,port:0,backend});
  try{
    let {origin,hostId}=await service.start();const grant=await service.issueSetupGrant();
    const request=async(route:string,method='GET',body?:any,identity?:any,csrf=true)=>{const response=await fetch(origin+'/personal/v1'+route,{method,headers:{origin,'content-type':'application/json',...(identity?{cookie:identity.cookie,...(csrf?{'x-weftmate-csrf':identity.csrf}:{})}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]}};
    const setup=await request('/auth/setup','POST',{grant:grant.grant,username:'SyntheticOwner',password:'synthetic ui5 password 123',deviceName:'test'});assert.equal(setup.status,201);
    const a={cookie:setup.cookie,csrf:setup.body.csrfToken};
    const registered=await request('/auth/register','POST',{username:'SyntheticOther',password:'synthetic ui5 other password 123',deviceName:'test'});assert.equal(registered.status,201);const b={cookie:registered.cookie,csrf:registered.body.csrfToken};
    const created=await request('/commands','POST',{requestId:'create',kind:'session.create',targetDeviceId:hostId,modelProfileId:'local'},a);assert.equal(created.status,202);let command:any;
    for(let i=0;i<100;i++){command=(await request('/commands/'+created.body.command.commandId,'GET',undefined,a)).body.command;if(command.state==='accepted_by_dsh')break;await new Promise(done=>setTimeout(done,20));}assert.equal(command.state,'accepted_by_dsh');const id=command.sessionId;
    assert.equal((await request(`/sessions/${id}/metadata`,'PATCH',{pinned:true},a,false)).status,403);
    assert.equal((await request(`/sessions/${id}/metadata`,'PATCH',{pinned:true},b)).status,404);
    assert.equal((await request(`/sessions/${id}/fork`,'POST',{},b)).status,404);
    const group=await request('/session-groups','POST',{name:'合成分组'},a);assert.equal(group.status,201);
    assert.equal((await request('/session-groups','GET',undefined,b)).body.groups.length,0);
    assert.equal((await request('/session-groups/'+group.body.group.id,'DELETE',{},b)).status,404);
    assert.equal((await request(`/sessions/${id}/metadata`,'PATCH',{pinned:true,unread:true,title:'合成改名',groupId:group.body.group.id},a)).status,200);
    assert.equal((await request('/sessions?archived=all','GET',undefined,a)).body.sessions[0].pinned,true);
    await service.close();service=await createPersonalAccessService({root,port:0,backend});({origin}=await service.start());
    const list=(await request('/sessions?archived=all','GET',undefined,a)).body;assert.equal(list.sessions[0].title,'合成改名');assert.equal(list.sessions[0].unread,true);assert.equal(list.groups[0].name,'合成分组');
  }finally{await service.close();await rm(root,{recursive:true,force:true})}
});
