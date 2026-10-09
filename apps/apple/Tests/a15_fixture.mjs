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
const root=await realpath(await mkdtemp(join(tmpdir(),'wm-a15-'))), runtime=syntheticBackend(root);
const originalModels=runtime.backend.listModels;
runtime.backend.listModels=async()=> [...(await originalModels()).map(m=>({...m,deepThinking:{supported:true,effort:'high'},apiKey:'A15_SYNTHETIC_SECRET_NEVER_DISPLAY',hiddenUserContent:'A15_SYNTHETIC_PRIVATE_BODY_NEVER_DISPLAY'})),{id:'synthetic-unpriced',name:'合成未计价模型',model:'synthetic',configured:true,sourceKind:'cloud',deepThinking:{supported:false}}];
const host=await createPersonalAccessService({root:join(root,'host'),port:0,backend:runtime.backend});runtime.attach(host);
const started=await host.start(),grant=await host.issueSetupGrant();
const setup=await fetch(started.origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin:started.origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,username:'a5-tester',password:'synthetic-test-only',deviceName:'合成执行电脑'})});
const account=await setup.json(),auth={cookie:setup.headers.get('set-cookie').split(';')[0],'x-weftmate-csrf':account.csrfToken,origin:started.origin,'content-type':'application/json'};
async function api(path,body,method=body===undefined?'GET':'POST') {const response=await fetch(started.origin+'/personal/v1'+path,{method,headers:auth,...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await response.json();if(!response.ok)throw Error(path+':'+JSON.stringify(data));return {...data,status:response.status};}
async function settled(c){for(let i=0;i<100;i++){const x=(await api('/commands/by-request/'+c.requestId)).command;if(x.state==='accepted_by_dsh')return x;if(x.state==='rejected')throw Error('Rejected synthetic create');await new Promise(r=>setTimeout(r,30));}throw Error('Create timeout');}
await api('/settings/usage',{monthlyLimit:100,timeZone:'Asia/Shanghai',profileId:'mimo',price:{input:1,cachedInput:0.5,output:2}},'PATCH');
const project=(await api('/projects',{requestId:'a15-project',name:'合成项目',rootPath:'C:\\Synthetic\\A15',permission:'write'})).project;
const projectIDs=[];
for(let i=0;i<7;i++){const c=await settled((await api('/projects/'+project.projectId+'/sessions',{requestId:'a15-create-'+i,modelProfileId:'mimo'})).command);projectIDs.push(c.sessionId);runtime.sessions.get(c.sessionId).title='合成项目对话 '+i;await api('/sessions/'+c.sessionId+'/metadata',{title:'合成项目对话 '+i,pinned:i===0},'PATCH');await settled((await api('/commands',{requestId:'a15-activity-'+i,kind:'session.message',targetDeviceId:started.hostId,sessionId:c.sessionId,text:'合成项目活动 '+i})).command);runtime.finish(runtime.sessions.get(c.sessionId));}
const flow=await runtime.prepareA8(api,started.hostId),session=runtime.sessions.get(flow.sessionId);
const unpriced=await host.beginUsage({sessionId:session.id,profileId:'synthetic-unpriced'});await host.finishUsage({...unpriced,usage:{prompt_tokens:10,completion_tokens:2},source:'openai-compatible'});
const append=(type,data)=>{session.events.push({seq:session.events.length,time:Date.now(),type,data});};
function task(name,id,background=false,failed=false){const call='a15-step-'+id;append('tool/call',{turn:session.turn,callId:call,name:'subagent',arguments:JSON.stringify({description:name})});append('tool/result',{turn:session.turn,message:{source:{kind:'tool',callId:call},content:[{type:'tool-result',toolCallId:call,isError:failed,content:[{type:'text',text:background?'started background subagent task '+id:'合成子任务完成'}]}]}});}
task('合成进行中','active',true);task('合成完成','done');task('合成失败','failed',false,true);
let loseThinking=false;const traffic=[];
const proxy=createServer(async(req,res)=>{try{const body=[];for await(const part of req)body.push(part);const path=new URL(req.url,'http://127.0.0.1');const headers={...req.headers,host:new URL(started.origin).host,origin:started.origin};delete headers['content-length'];const reply=await fetch(started.origin+req.url,{method:req.method,headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(body)})});const bytes=Buffer.from(await reply.arrayBuffer());if(path.pathname.endsWith('/usage')||path.pathname.endsWith('/thinking'))traffic.push({path:path.pathname,method:req.method,month:path.searchParams.get('month'),timeZone:path.searchParams.get('timeZone'),status:reply.status,...(path.pathname.endsWith('/usage')&&reply.ok?{summary:JSON.parse(bytes)}:{}),...(path.pathname.endsWith('/thinking')?{body:JSON.parse(bytes),...(req.method==='PATCH'?{request:JSON.parse(Buffer.concat(body))}:{})}:{})});if(loseThinking&&req.method==='PATCH'&&path.pathname.endsWith('/thinking')&&reply.ok){loseThinking=false;req.socket.destroy();return;}const outgoing={};for(const[k,v]of reply.headers)if(!['content-length','transfer-encoding','content-encoding'].includes(k))outgoing[k]=v;res.writeHead(reply.status,outgoing);res.end(bytes);}catch(e){process.stderr.write(e.message+'\n');res.writeHead(500);res.end('{}');}});proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
const driver=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://127.0.0.1').pathname;let data;if(path==='/ready')data={host:`http://127.0.0.1:${proxy.address().port}`,sessionID:session.id,activeStepSeq:session.events.find(e=>e.type==='tool/call'&&e.data.callId==='a15-step-active').seq,projectID:project.projectId,projectIDs};else if(path==='/finish'){append('user/message',{source:{form:'notice',plugin:'tool-jobs'},content:[{type:'text',text:'background job active finished [status: completed]'}]});data={ok:true};}else if(path==='/lose-next-thinking'){loseThinking=true;data={ok:true};}else if(path==='/unlimited'){await api('/settings/usage',{monthlyLimit:null},'PATCH');data={ok:true};}else if(path==='/report')data={traffic,usage:await api('/usage?timeZone=Asia/Shanghai'),operations:runtime.operations,sessions:(await api('/sessions?archived=all')).sessions};else throw Error('Unknown route');res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(data));}catch(e){process.stderr.write(e.message+'\n');res.writeHead(500);res.end('{}');}});driver.listen(0,'127.0.0.1');await once(driver,'listening');
console.log(JSON.stringify({root,driver:`http://127.0.0.1:${driver.address().port}`}));
async function close(){await host.close();proxy.close();driver.close();await rm(root,{recursive:true,force:true});process.exit(0);}process.on('SIGTERM',close);process.on('SIGINT',close);
