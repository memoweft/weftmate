/** Presentation fixture on stock Android; real cloud authority and real approval API. */
process.env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createPersonalAccessService} from '../../src/personal-access/index.mjs';
import {servePersonalAccessUi} from '../../src/personal-access-ui/index.mjs';
import {digestAuthFixture} from '../helpers/memory-digest-auth-fixture.mjs';
import {managedMkdtempSync} from '../helpers/managed-temp.mjs';
import {sec1SystemBars} from './sec-1-system-bars.mjs';
const out=resolve('tests/evidence/sec-1');await mkdir(out,{recursive:true});
const root=managedMkdtempSync('weftmate-sec1-phone-'),sessions=new Map(),hash=text=>createHash('sha256').update(text).digest('hex');
let service,bars,cloud,mode='agree',auth,cookie,origin;
const backend={getStatus:async()=>({runtime:'ready',capabilities:{chat:{available:true}}}),
 listModels:async()=>[{id:'local',name:'合成模型',model:'synthetic',configured:true}],preflight:async()=>({ok:true}),
 createSession:async({sessionId})=>{sessions.set(sessionId,[]);return{sessionId};},cancelSession:async()=>({accepted:true}),
 sendMessage:async({sessionId,text})=>{const receiptId=randomUUID();sessions.set(sessionId,[{seq:0,type:'turn.started',data:{turn:1}},{seq:1,type:'user.message',data:{receiptId,messageHash:hash(text),text}}]);return{accepted:true,receiptId};},
 describeSession:async sessionId=>sessions.has(sessionId)?{sessionId,running:true,agentPreset:'personal-remote',modelProfileId:'local',title:'合成审批'}:null,
 readEvents:async({sessionId,afterSeq=-1})=>({events:(sessions.get(sessionId)??[]).filter(row=>row.seq>afterSeq),nextSeq:(sessions.get(sessionId)??[]).length-1,hasMore:false}),
 readSourceEvents:async({sessionId})=>({current:true,events:sessions.get(sessionId)??[]}),
 modelCompletion:async({onStart,signal})=>{await onStart();if(mode==='timeout'){await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('timeout')),{once:true}));}if(mode==='unavailable')throw Error('offline');return Response.json({choices:[{message:{content:JSON.stringify(mode==='warning'?{alignment:'对不上',externalInfluence:'有',reason:'你让它总结这份文件，但这一步要删除另一个文件。'}:{alignment:'对得上',externalInfluence:'没有',reason:'本人明确要求覆盖文件。'})}}],usage:{prompt_tokens:20,completion_tokens:10}});}};
try{
 cloud=await digestAuthFixture();service=await createPersonalAccessService({root,port:0,backend,uiHandler:servePersonalAccessUi,cloudIdentity:cloud.cloudIdentity});const started=await service.start();origin=started.origin;
 ({auth,cookie}=await cloud.authenticate({service,...started}));assert.equal(auth.device.authKind,'cloud');
 const api=async(path,body,method=body?'POST':'GET')=>{const response=await fetch(origin+'/personal/v1'+path,{method,headers:{origin,cookie,'x-weftmate-csrf':auth.csrfToken,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;};
 const command=async body=>{let {command}=await api('/commands',{targetDeviceId:started.hostId,requestId:randomUUID(),...body});for(let n=0;n<100&&command.state!=='accepted_by_dsh';n++){await new Promise(done=>setTimeout(done,20));command=(await api('/commands/'+command.commandId)).command;}assert.equal(command.state,'accepted_by_dsh');return command;};
 bars=process.env.WEFTMATE_SEC1_PHONE_SMOKE==='1'?{capture:async()=>{},close:async()=>{}}:await sec1SystemBars({origin,cookie,out});
 for(const scenario of ['agree','warning','timeout','unavailable']){
  mode=scenario;const sessionId=(await command({kind:'session.create',modelProfileId:'local'})).sessionId;
  const text=mode==='warning'?'请读取 source.txt，用一句话告诉我观测样本数和状态。':'请覆盖 notes.txt，写入合成更新。';
  const source=await command({kind:'session.message',sessionId,text});const args=mode==='warning'?{command:"Remove-Item -LiteralPath 'notes.txt'"}:{command:"Set-Content -LiteralPath 'notes.txt' -Value '合成更新'"};
  const risk=mode==='warning'?'delete':'overwrite',identity={sessionId,turn:1,callId:'call-'+randomUUID(),rootCallId:'call-'+randomUUID(),receiptId:source.receiptId,messageHash:hash(text),toolName:'pwsh',argumentsHash:hash(JSON.stringify(args)),runtimeId:randomUUID(),approvalId:randomUUID()};identity.rootCallId=identity.callId;
  const row=await service.trackToolApproval({...identity,action:'register_approval',reason:`[weftmate:${risk}] ${mode==='warning'?'删除已有文件':'覆盖已有文件'}\n${JSON.stringify(args)}`,reviewEvidence:{arguments:args,risks:[risk],sources:mode==='warning'?['source.txt']:['notes.txt']}});
  assert.equal(row.status,'pending');assert.equal(!!row.secondOpinion,['agree','warning'].includes(mode));
  sessions.get(sessionId).push({seq:2,type:'step.started',data:{turn:1,stepId:identity.callId,callId:identity.callId,toolName:'pwsh',state:'running',summary:mode==='warning'?'删除 notes.txt':'覆盖 notes.txt'}},
    {seq:3,type:'approval.requested',data:{turn:1,stepId:identity.callId,toolName:'pwsh',approvalId:identity.approvalId,summary:row.reason}});
  await bars.capture(mode,sessionId);
  await api(`/sessions/${sessionId}/approvals/${row.approvalId}`,{requestId:randomUUID(),outcome:'rejected'});
  await service.trackToolApproval({...identity,action:'resolve_approval',outcome:'rejected'});
 }
}finally{await bars?.close();await service?.close();await cloud?.close();await rm(root,{recursive:true,force:true});}
