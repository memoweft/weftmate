import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPersonalAccessService } from '../src/personal-access/index.mjs';
import { selectProjectContext, routeProjectTool, projectToolDecision, installProjectSandbox, inheritProjectContext, projectContextNotice, insideProject } from '../src/plugins/personal-project-context.mjs';

test('folder CRUD, session membership, legacy migration and removal preserve data without exposing paths', {skip:process.platform!=='win32'}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pj1-service-')), data = path.join(root,'project'); await mkdir(data);
  await writeFile(path.join(data,'brief.md'),'synthetic project');
  const sessions = new Set<string>(), received:any[]=[]; let running=false;
  const backend = {
    listModels:async()=>[{id:'m',name:'Synthetic',model:'synthetic',configured:true}],
    getStatus:async()=>({runtime:'ready',referenceScan:'ready'}), preflight:async()=>({ok:true}),
    createSession:async(input:any)=>{sessions.add(input.sessionId);received.push(input);return {sessionId:input.sessionId};},
    describeSession:async(sessionId:string)=>sessions.has(sessionId)?{sessionId,agentPreset:'personal-remote',modelProfileId:'m',running}:null,
    sendMessage:async()=>({accepted:true,receiptId:randomUUID()}),cancelSession:async()=>({accepted:true}),
    readEvents:async()=>({events:[],nextSeq:-1,hasMore:false}),
  };
  let service = await createPersonalAccessService({root:path.join(root,'host'),backend,port:0});
  let origin='',hostId='',auth:any;
  async function request(method:string, route:string, body?:any) {
    const response=await fetch(origin+'/personal/v1'+route,{method,headers:{...auth,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
    return {status:response.status,body:await response.json()};
  }
  async function login() {
    const response=await fetch(origin+'/personal/v1/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({username:'PJ1Synthetic',password:'synthetic-folder-password',deviceName:'Synthetic phone'})});
    auth={origin,cookie:response.headers.get('set-cookie')!.split(';')[0],'x-weftmate-csrf':(await response.json()).csrfToken};
  }
  async function settled(command:any) {
    for(let i=0;i<100;i++){const row=(await request('GET','/commands/'+command.commandId)).body.command;
      if(!['pending','dispatching'].includes(row.state)){assert.equal(row.state,'accepted_by_dsh',JSON.stringify(row));return row;}
      await new Promise(resolve=>setTimeout(resolve,20));}
    throw Error('fixture dispatch timeout');
  }
  try {
    ({origin,hostId}=await service.start()); const setup=await service.issueSetupGrant();
    auth={origin}; assert.equal((await request('POST','/auth/setup',{grant:setup.grant,username:'PJ1Synthetic',password:'synthetic-folder-password',deviceName:'Synthetic desktop'})).status,201);
    await login();
    const registration={requestId:randomUUID(),name:'合成项目',rootPath:data,permission:'write',instructions:'Use Chinese.'};
    const created=await request('POST','/projects',registration);assert.equal(created.status,201,JSON.stringify(created.body));let project=created.body.project;
    assert.equal(project.permission,'write');assert.equal(project.instructions,'Use Chinese.');
    assert.ok(!JSON.stringify(created.body).includes(data));assert.ok(!('rootPath' in project));
    assert.equal((await request('POST','/projects',registration)).body.project.projectId,project.projectId);
    const ordinary=await settled((await request('POST','/commands',{requestId:randomUUID(),kind:'session.create',targetDeviceId:hostId,modelProfileId:'m'})).body.command);
    const projectSession=await settled((await request('POST',`/projects/${project.projectId}/sessions`,{requestId:randomUUID(),modelProfileId:'m'})).body.command);
    assert.equal(received.at(-1).project.rootPath,data);
    assert.equal(service.getApprovalPolicy({sessionId:projectSession.sessionId}).project.permission,'write');
    const binding=await request('PATCH',`/sessions/${ordinary.sessionId}/metadata`,{projectId:project.projectId});assert.equal(binding.status,200,JSON.stringify(binding.body));
    assert.match(binding.body.projectNotice,/下一回合/);assert.ok(!JSON.stringify(binding.body).includes(data));
    assert.equal((await request('GET','/sessions')).body.sessions.filter((s:any)=>s.projectId===project.projectId).length,2);
    assert.equal((await request('PATCH',`/projects/${project.projectId}`,{expectedRevision:0,name:'stale'})).status,409);
    running=true;assert.equal((await request('PATCH',`/projects/${project.projectId}`,{expectedRevision:1,permission:'read-only'})).status,409);
    assert.equal((await request('PATCH',`/sessions/${ordinary.sessionId}/metadata`,{projectId:null})).status,409);running=false;
    project=(await request('PATCH',`/projects/${project.projectId}`,{expectedRevision:1,name:'合成资料',permission:'read-only',instructions:'Read only.'})).body.project;
    assert.equal(project.revision,2);assert.equal(service.getApprovalPolicy({sessionId:ordinary.sessionId}).project.permission,'read-only');
    assert.ok((await request('GET','/sessions')).body.sessions.every((s:any)=>s.sendAvailable));
    assert.equal((await request('PATCH',`/sessions/${ordinary.sessionId}/metadata`,{projectId:null})).status,200);
    // Old persisted registrations lacked both fields. The startup migration is durable and idempotent.
    await service.close();const file=path.join(root,'host','store.json'),store=JSON.parse(await readFile(file,'utf8'));
    const persisted:any=Object.values(store.accounts)[0];delete persisted.projects[project.projectId].permission;delete persisted.projects[project.projectId].instructions;
    await writeFile(file,JSON.stringify(store)); service=await createPersonalAccessService({root:path.join(root,'host'),backend,port:0});({origin,hostId}=await service.start());await login();
    const list=(await request('GET','/projects')).body;project=list.projects[0];assert.equal(project.projectId,created.body.project.projectId);assert.equal(project.permission,'read-only');assert.equal(project.instructions,'');assert.ok(!JSON.stringify(list).includes(data));
    assert.equal((await request('DELETE',`/projects/${project.projectId}`,{expectedRevision:project.revision})).status,200);
    assert.equal((await request('GET','/projects')).body.projects.length,0);assert.equal((await request('GET','/sessions')).body.sessions.some((s:any)=>s.projectId===project.projectId),false);
    assert.equal(await readFile(path.join(data,'brief.md'),'utf8'),'synthetic project');
    assert.equal((await request('DELETE',`/projects/${project.projectId}`,{expectedRevision:project.revision})).status,404);
  } finally { await service.close(); await rm(root,{recursive:true,force:true}); }
});

test('native project context routes new calls, confines writes, rejects readonly escalation and inherits into children', async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'pj1-boundary-')),folder=path.join(root,'project'),old=path.join(root,'old');await mkdir(folder);await mkdir(old);
  const session:any={header:Object.freeze({cwd:old}),events:[]},agent:any={session};
  const service:any={resolve:(request:any)=>({mode:request.mode??'danger-full-access',workspaceRoot:request.session.header.cwd})};
  const release=installProjectSandbox(service);
  try {
    await selectProjectContext(agent,{project:{rootPath:folder,name:'Synthetic',permission:'write',instructions:'Test',revision:1}});
    const read:any={agent,name:'read',arguments:Object.freeze({file_path:'brief.md'})};routeProjectTool(read);assert.equal(read.arguments.file_path,path.join(folder,'brief.md'));assert.equal(session.header.cwd,old);
    const shell:any={agent,name:'pwsh',arguments:{command:'Get-Location'}};routeProjectTool(shell);assert.equal(shell.arguments.workdir,folder);
    assert.equal(service.resolve({session}).mode,'workspace-write');assert.equal(service.resolve({session}).workspaceRoot,folder);
    const write:any={agent,name:'write',arguments:{file_path:'new/sub/file.md'}};routeProjectTool(write);assert.equal(await projectToolDecision(write),null);
    write.arguments.file_path=path.join(root,'escaped.md');assert.equal((await projectToolDecision(write))?.kind,'deny');
    assert.equal(await insideProject(folder,path.join(root,'project-other','file')),false);
    const outside=path.join(root,'outside');await mkdir(outside);await symlink(outside,path.join(folder,'link'),process.platform==='win32'?'junction':'dir');assert.equal(await insideProject(folder,path.join(folder,'link','new.md')),false);
    const search:any={agent,name:'glob',arguments:{pattern:'*.md'}};routeProjectTool(search);assert.equal(search.arguments.path,folder);
    const child:any={session:{header:{cwd:old},events:[]}};inheritProjectContext(child,agent);assert.equal(service.resolve({session:child.session}).mode,'workspace-write');assert.match(projectContextNotice(child.session),/Test/);
    await selectProjectContext(agent,{project:{rootPath:folder,name:'Synthetic',permission:'read-only',instructions:'',revision:2}});
    assert.equal((await projectToolDecision({agent,name:'write',arguments:{file_path:'new.md'}}))?.kind,'deny');
    assert.equal((await projectToolDecision({agent,name:'pwsh',arguments:{sandbox_permissions:'danger-full-access'}}))?.kind,'deny');
    assert.equal(service.resolve({session,mode:'danger-full-access'}).mode,'read-only');
    await selectProjectContext(agent,{projectNotice:'Removed',conversationWorkspace:old});assert.equal(service.resolve({session}).mode,'danger-full-access');
    await assert.rejects(access(path.join(root,'escaped.md')));
  } finally { release();await rm(root,{recursive:true,force:true}); }
});
