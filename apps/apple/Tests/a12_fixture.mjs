// Real isolated personal host, authentication, durable approval and execution receipts.
// The task planner is deterministic; approved operations delete real synthetic files.
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, realpath, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createPersonalAccessService } from '../../../src/personal-access/index.mjs';
import { syntheticBackend } from './a5_synthetic_backend.mjs';
process.umask(0o077);
const root = await realpath(await mkdtemp(join(tmpdir(), 'wm-a12-')));
const runtime = syntheticBackend(root), exec = promisify(execFile);
const host = await createPersonalAccessService({root:join(root,'host'),port:0,backend:runtime.backend});
runtime.attach(host);
const started = await host.start();
const grant = await host.issueSetupGrant();
const setup = await fetch(started.origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin:started.origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,username:'a5-tester',password:'synthetic-test-only',deviceName:'A12 合成 Mac 宿主'})});
const account = await setup.json();
if (!setup.ok) throw Error('Isolated setup failed');
const auth={cookie:setup.headers.get('set-cookie').split(';')[0],'x-weftmate-csrf':account.csrfToken,origin:started.origin,'content-type':'application/json'};
async function api(path,body) {
  const response=await fetch(started.origin+'/personal/v1'+path,{method:body===undefined?'GET':'POST',headers:auth,...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await response.json();if(!response.ok)throw Error('Host '+path+': '+data.error?.code);return data;
}
async function accepted(body) {
  await api('/commands',body);
  for(let i=0;i<100;i++) { const {command}=await api('/commands/by-request/'+body.requestId); if(command.state==='accepted_by_dsh')return command;if(command.state==='rejected')throw Error(command.errorCode);await new Promise(r=>setTimeout(r,40)); }
  throw Error('Dispatch timeout');
}
const created = await accepted({requestId:randomUUID(),kind:'session.create',targetDeviceId:started.hostId,modelProfileId:'mimo'});
const s=runtime.sessions.get(created.sessionId);s.title='A12 手表实时审批';
const events=[], receipts=[], scenarios=[];
const add=(type,data)=>s.events.push({seq:s.events.length,time:Date.now(),type,data});
const log=(event,fields={})=>events.push({time:new Date().toISOString(),event,...fields});
const hash=value=>createHash('sha256').update(value).digest('hex');
let active, consuming=false;
async function begin(name) {
  if(s.running)throw Error('Previous task is still running');
  const filename='synthetic-'+name+'-draft.txt';
  await writeFile(join(s.folder,filename),'A12 synthetic content only.');
  const text='A5_HOLD：请删除 '+filename+'，等待手表决定。';
  const command=await accepted({requestId:randomUUID(),kind:'session.message',targetDeviceId:started.hostId,sessionId:s.id,text});
  const args={command:'rm '+filename}, reason='[weftmate:delete] 删除本次合成草稿，无法撤销。\n'+JSON.stringify(args);
  const metadata={runtimeId:randomUUID(),approvalId:randomUUID(),sessionId:s.id,turn:s.turn,callId:'a12-'+name,rootCallId:'a12-'+name,receiptId:command.receiptId,messageHash:hash(text),toolName:'shell',argumentsHash:hash(JSON.stringify(args))};
  add('tool/call',{turn:s.turn,callId:metadata.callId,name:'shell',arguments:JSON.stringify(args)});
  const registered=await host.trackToolApproval({...metadata,action:'register_approval',reason});
  add('approval/asked',{id:metadata.approvalId,toolName:'shell',callId:metadata.callId,reason});
  active={name,filename,metadata,commandId:command.commandId};scenarios.push(active);
  log('approval.requested',{scenario:name,approvalId:metadata.approvalId,commandId:command.commandId,tool:'shell',object:filename,status:registered.status});
  return {approvalId:metadata.approvalId,filename};
}
async function consume() {
 if(!active||active.done||consuming)return;
 consuming=true;
 try {
  const row=await host.trackToolApproval({...active.metadata,action:'read_approval'});
  if(row.status!=='answered')return;
  receipts.push({scenario:active.name,stage:'answered',...row});
  log('approval.answered',{scenario:active.name,outcome:row.decisionOutcome,requestId:row.decisionRequestId});
  if(row.decisionOutcome==='allowed-once') {
    await rm(join(s.folder,active.filename));
    add('tool/result',{turn:s.turn,message:{source:{kind:'tool',callId:active.metadata.callId},content:[{type:'tool-result',toolCallId:active.metadata.callId,isError:false,content:[{type:'text',text:'已删除合成草稿，并读回确认文件不存在。'}]}]}});
    log('step.executed',{scenario:active.name,object:active.filename,operation:'delete'});
  } else log('step.stopped',{scenario:active.name,object:active.filename,operation:'delete',executed:false});
  const resolved=await host.trackToolApproval({...active.metadata,action:'resolve_approval',outcome:row.decisionOutcome});
  receipts.push({scenario:active.name,stage:'resolved',...resolved});
  add('approval/decided',{id:active.metadata.approvalId,outcome:row.decisionOutcome});
  runtime.finish(s,row.decisionOutcome==='allowed-once'?'completed':'aborted');
  active.done=true;active.outcome=row.decisionOutcome;active.fileExists=await access(join(s.folder,active.filename)).then(()=>true,()=>false);
  log('task.ended',{scenario:active.name,outcome:active.outcome,fileExists:active.fileExists,reason:active.outcome==='allowed-once'?'completed':'aborted'});
 } finally { consuming=false; }
}
const timer=setInterval(()=>consume().catch(e=>process.stderr.write(e.message+'\n')),100);
const traffic=[];
// Observe real app POST responses without replacing any host route or response.
const proxy=createServer(async(req,res)=>{
 try {
  const body=[];for await(const chunk of req)body.push(chunk);
  const pathname=new URL(req.url,'http://127.0.0.1').pathname;
  const headers={...req.headers,host:new URL(started.origin).host,origin:started.origin};delete headers['content-length'];
  const response=await fetch(started.origin+req.url,{method:req.method,headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(body)})});
  const bytes=Buffer.from(await response.arrayBuffer());
  if(req.method==='POST' && /\/approvals\//.test(pathname))traffic.push({path:pathname,status:response.status,request:JSON.parse(Buffer.concat(body)),reply:JSON.parse(bytes)});
  const outgoing={};for(const [k,v]of response.headers)if(!['content-length','transfer-encoding','content-encoding'].includes(k))outgoing[k]=v;
  res.writeHead(response.status,outgoing);res.end(bytes);
 }catch {res.writeHead(500);res.end('{}');}
});proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
const origin=`http://127.0.0.1:${proxy.address().port}`;
const report=()=>({host:'Mac local isolated personal host',realAuthentication:true,realApprovalAPI:true,deterministicPlanner:true,compiledDSH:false,realSyntheticFileOperation:true,events,receipts,approvalHTTP:traffic,scenarios:scenarios.map(({name,filename,metadata,commandId,done,outcome,fileExists})=>({name,filename,approvalId:metadata.approvalId,commandId,done:!!done,outcome,fileExists}))});
const driver=createServer(async(req,res)=>{
 try {
  const path=new URL(req.url,'http://127.0.0.1').pathname;let data;
  if(path==='/ready')data={host:origin,sessionID:s.id};
  else if(path==='/approve/start')data=await begin('approve');
  else if(path==='/reject/start')data=await begin('reject');
  else if(path==='/report')data=report();
  else if(path.startsWith('/capture/')) {
    const scene=path.split('/')[2];if(!/^(approve|reject)-(pending|ended)$/.test(scene))throw Error('Unknown capture');
    const dir=process.env.WEFTMATE_A12_CAPTURE_DIR;
    for(const [platform,key] of [['iphone','WEFTMATE_A12_PHONE'],['watch','WEFTMATE_A12_WATCH']])await exec('xcrun',['simctl','io',process.env[key],'screenshot',join(dir,scene+'-'+platform+'.png')]);
    await writeFile(join(dir,scene+'-host.json'),JSON.stringify(report(),null,2)+'\n');data={captured:true};
  } else throw Error('Unknown route');
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(data));
 }catch(e){res.writeHead(500);res.end(JSON.stringify({error:'FIXTURE_FAILED'}));process.stderr.write(e.message+'\n');}
});driver.listen(0,'127.0.0.1');await once(driver,'listening');
console.log(JSON.stringify({root,driver:`http://127.0.0.1:${driver.address().port}`,host:origin,sessionID:s.id}));
async function close(){clearInterval(timer);await new Promise(r=>proxy.close(r));await new Promise(r=>driver.close(r));await host.close();await rm(root,{recursive:true,force:true});}
process.once('SIGTERM',()=>close().then(()=>process.exit()));process.once('SIGINT',()=>close().then(()=>process.exit()));
