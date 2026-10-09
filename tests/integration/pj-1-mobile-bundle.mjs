/** Fast visual/interaction regression of the Android bundle; synthetic backend, real authenticated HTTP. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { verifyMobileProjects } from './pj-1-mobile-projects.mjs';
const root=await mkdtemp(join(tmpdir(),'pj1-mobile-bundle-')),folder=join(root,'project');await mkdir(folder);
const credentials={username:'PJ1MobileSynthetic',password:'synthetic-mobile-password'},sessions=new Map();
const backend={listModels:async()=>[{id:'m',name:'合成模型',model:'synthetic',configured:true}],getStatus:async()=>({runtime:'ready',referenceScan:'ready'}),preflight:async()=>({ok:true}),
  createSession:async({sessionId})=>{sessions.set(sessionId,'新对话');return{sessionId}},describeSession:async sessionId=>({sessionId,title:sessions.get(sessionId),running:false,agentPreset:'personal-remote',modelProfileId:'m'}),
  renameSession:async({sessionId,title})=>{sessions.set(sessionId,title);return{title}},readEvents:async()=>({events:[],nextSeq:-1,hasMore:false}),sendMessage:async()=>({accepted:true}),cancelSession:async()=>({accepted:true})};
const service=await createPersonalAccessService({root:join(root,'host'),backend,port:0});let auth;
try{
  const {origin}=await service.start(),grant=await service.issueSetupGrant();
  const request=async(path,body,method=body?'POST':'GET')=>{const r=await fetch(origin+'/personal/v1'+path,{method,headers:{origin,'content-type':'application/json',...auth},body:body?JSON.stringify(body):undefined});return{status:r.status,body:await r.json()}};
  assert.equal((await request('/auth/setup',{grant:grant.grant,...credentials,deviceName:'Synthetic desktop'})).status,201);
  const login=await fetch(origin+'/personal/v1/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({...credentials,deviceName:'Synthetic desktop'})});auth={cookie:login.headers.get('set-cookie').split(';')[0],'x-weftmate-csrf':(await login.json()).csrfToken};
  const project=(await request('/projects',{requestId:randomUUID(),name:'社区图书角',rootPath:folder,permission:'write',instructions:'合成界面回归项目'})).body.project;
  const created=(await request(`/projects/${project.projectId}/sessions`,{requestId:randomUUID(),modelProfileId:'m'})).body.command;
  for(let i=0;i<100;i++){const command=(await request('/commands/'+created.commandId)).body.command;if(command.state==='accepted_by_dsh')break;await new Promise(done=>setTimeout(done,20));}
  assert.equal((await request(`/sessions/${created.sessionId}/metadata`,{title:'借阅说明总结'},'PATCH')).status,200);
  await verifyMobileProjects({origin,credentials,project,sessionId:created.sessionId,api:request,evidence:resolve(import.meta.dirname,'../evidence/pj-1')});
  console.log('PJ-1 mobile bundle geometry, project creation and move menu passed (synthetic DSH backend)');
}finally{await service.close();await rm(root,{recursive:true,force:true});}
