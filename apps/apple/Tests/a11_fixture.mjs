// Isolated real personal HTTP/project store + synthetic DSH/model/Windows root inspection.
// The production Windows folder inspector is deliberately replaced only in this process.
import { registerHooks } from 'node:module';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
process.umask(0o077);
registerHooks({load(url, context, next) {
  if (url.endsWith('/src/personal-projects/index.mjs')) return {format:'module', shortCircuit:true, source:`
    export async function inspectProjectRoot(input) {
      const name = input.split(/[\\\\/]/).filter(Boolean).at(-1).replace(/[^A-Za-z0-9_-]/g, '_');
      return {rootPath:'C:\\\\Synthetic\\\\'+name, rootFinalPath:'\\\\\\\\?\\\\C:\\\\Synthetic\\\\'+name, rootIdentity:'00000001:0000000000000001'};
    }
    export async function listProjectFiles() { return {files:[],scannedCount:0,truncated:false,skippedCount:0}; }
    export async function readProjectFile() { throw Error('Synthetic root inspection fixture does not read real Windows files'); }
  `};
  return next(url, context);
}});
const { createPersonalAccessService } = await import('../../../src/personal-access/index.mjs');
const { syntheticBackend } = await import('./a5_synthetic_backend.mjs');
const root = await realpath(await mkdtemp(join(tmpdir(), 'wm-a11-')));
const synthetic = syntheticBackend(root), create = synthetic.backend.createSession;
const creates = [], reads = [];
synthetic.backend.createSession = async input => { creates.push({sessionId:input.sessionId,projectId:input.project?.projectId,permission:input.project?.permission,instructions:input.project?.instructions}); return create(input); };
const host = await createPersonalAccessService({root:join(root,'host'), port:0, backend:synthetic.backend});
synthetic.attach(host);
const started = await host.start();
const grant = await host.issueSetupGrant();
const setup = await fetch(started.origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin:started.origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,username:'a5-tester',password:'synthetic-test-only',deviceName:'A11 合成电脑'})});
const account = await setup.json();
if (!setup.ok) throw Error('Isolated setup failed');
const auth={cookie:setup.headers.get('set-cookie').split(';')[0],'x-weftmate-csrf':account.csrfToken,origin:started.origin,'content-type':'application/json'};
async function api(path,body,method=body===undefined?'GET':'POST') {
  const response=await fetch(started.origin+'/personal/v1'+path,{method,headers:auth,...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await response.json(); if(!response.ok)throw Error('Fixture request failed '+data.error?.code); return data;
}
async function settled(command) {for(let i=0;i<100;i++) {const c=(await api('/commands/by-request/'+command.requestId)).command;if(c.state==='accepted_by_dsh')return c;if(c.state==='rejected')throw Error(c.errorCode);await new Promise(r=>setTimeout(r,40));}throw Error('Fixture timeout');}
const project=(await api('/projects',{requestId:randomUUID(),name:'合成资料',rootPath:'C:\\Synthetic\\A11',instructions:'只使用合成资料。',permission:'write'})).project;
const projectSession=await settled((await api('/projects/'+project.projectId+'/sessions',{requestId:randomUUID(),modelProfileId:'mimo'})).command);
synthetic.sessions.get(projectSession.sessionId).title='项目原有对话';
const ordinary=await settled((await api('/commands',{requestId:randomUUID(),kind:'session.create',targetDeviceId:started.hostId,modelProfileId:'mimo'})).command);
synthetic.sessions.get(ordinary.sessionId).title='待移动的合成对话';
const restricted=await settled((await api('/commands',{requestId:randomUUID(),kind:'session.create',targetDeviceId:started.hostId,modelProfileId:'mimo'})).command);
synthetic.sessions.get(restricted.sessionId).title='受限聊天';
const traffic=[];
const proxy=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://127.0.0.1').pathname;
  traffic.push({path:pathname,method:req.method});
  const body=[];for await(const chunk of req)body.push(chunk);
  const headers={...req.headers,host:new URL(started.origin).host,origin:started.origin};delete headers['content-length'];
  const response=await fetch(started.origin+req.url,{method:req.method,headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(body)})});
  let bytes=Buffer.from(await response.arrayBuffer());
  if(pathname==='/personal/v1/sessions'&&response.ok){const data=JSON.parse(bytes);for(const s of data.sessions)if(s.sessionId===restricted.sessionId)s.taskAvailable=false;bytes=Buffer.from(JSON.stringify(data));}
  if(pathname.startsWith('/personal/v1/chats')&&response.ok){const data=JSON.parse(bytes);const rows=data.items??(data.chat?[data.chat]:[]);for(const c of rows)if(c.activeSessionId===restricted.sessionId)c.taskAvailable=false;bytes=Buffer.from(JSON.stringify(data));}
  const outgoing={};for(const [k,v] of response.headers)if(!['content-length','transfer-encoding','content-encoding'].includes(k))outgoing[k]=v;
  res.writeHead(response.status,outgoing);res.end(bytes);
});
proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
const origin=`http://127.0.0.1:${proxy.address().port}`;
const driver=createServer(async(req,res)=>{
 try {
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  let data;
  if(path==='/ready'){const chats=(await api('/chats?kind=side&limit=200')).items;const logical=id=>chats.find(c=>c.activeSessionId===id)?.chatId??id;data={host:origin,cloud:origin,hostId:started.hostId,projectId:project.projectId,projectSessionId:projectSession.sessionId,ordinaryId:ordinary.sessionId,restrictedId:restricted.sessionId,projectChatId:logical(projectSession.sessionId),ordinaryChatId:logical(ordinary.sessionId),restrictedChatId:logical(restricted.sessionId)};}
  else if(path==='/report')data={projects:(await api('/projects')).projects,sessions:(await api('/sessions')).sessions,operations:synthetic.operations,creates,traffic,syntheticRootInspector:true,restrictedProjection:true};
  else throw Error('Unknown route');
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(data));
 }catch(e){res.writeHead(500);res.end(JSON.stringify({error:'FIXTURE_FAILED'}));process.stderr.write(e.message+'\n');}
});
driver.listen(0,'127.0.0.1');await once(driver,'listening');
console.log(JSON.stringify({root,driver:`http://127.0.0.1:${driver.address().port}`,host:origin,hostId:started.hostId}));
async function close(){await new Promise(r=>proxy.close(r));await new Promise(r=>driver.close(r));await host.close();await rm(root,{recursive:true,force:true});}
process.once('SIGTERM',()=>close().then(()=>process.exit()));process.once('SIGINT',()=>close().then(()=>process.exit()));
