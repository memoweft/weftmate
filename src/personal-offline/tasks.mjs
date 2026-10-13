import { randomUUID } from 'node:crypto';
import { openTask, hash } from './crypto.mjs';
import { canonicalCommand } from '../personal-access/command-policy.mjs';
import { MAX_COMMANDS, MAX_UNRECONCILED_TEXT_BYTES } from '../personal-access/constants.mjs';
import { failure, digest } from '../personal-access/common.mjs';
import { hasPrivateContent } from '../personal-access/temporary-chats.mjs';
import { activitySource } from '../personal-access/activity-store.mjs';

export function offlineCommandSource(context, ownerId, command) {
  const source=command?.offlineSource;
  return !!source && source.confirmed===true && source.generation===context.offline?.generation(ownerId) &&
    context.offline?.canDispatch?.(ownerId,command.commandId)!==false &&
    context.cloudIdentity?.offlineSource(ownerId,source.deviceId,source.jkt)===command.sourceDeviceId;
}

export function createOfflineTaskReceiver(context, recipient) {
  let flight, timer, closed=false;
  const validated=new Set(),key=(ownerId,commandId)=>`${ownerId}:${commandId}`;
  const request=(suffix,data)=>context.cloudIdentity.relayRequest('/hosts/offline/tasks/'+suffix,data);
  async function resume(ownerId,commandId) {
    const command=context.accountState(ownerId).commands[commandId],source=command?.offlineSource;
    if(!source||command.state!=='pending')return;
    if(source.confirmed&&validated.has(key(ownerId,commandId))&&offlineCommandSource(context,ownerId,command))return;
    const result=await request('ack',{id:source.id,claimId:source.claimId,receiptId:commandId});
    if(result.reason==='LEASE_LOST')return;
    await context.serial(()=>context.mutate(ownerId,next=>{
      const row=next.commands[commandId];if(!row?.offlineSource)return;
      if(!result.accepted){row.state='rejected';row.errorCode='OFFLINE_TASK_CANCELED';row.payload.text='[已取消或过期]';row.payloadHash=digest(JSON.stringify(row.payload));}
      else row.offlineSource.confirmed=true;
    }));
    if(result.accepted){validated.add(key(ownerId,commandId));context.schedule(ownerId,commandId);}
  }
  async function receive(row) {
    const source=context.cloudIdentity.offlineAccount(row.accountId,row.deviceId,row.jkt);
    if(!source)throw failure('FORBIDDEN',403); // No executable capability is manufactured for an unknown device.
    const {ownerId,deviceId}=source;
    if(!context.hostOwner(ownerId))throw failure('FORBIDDEN',403);
    if(!context.accountState(ownerId).devices[deviceId]?.scopes?.includes('commands:write'))throw failure('FORBIDDEN',403);
    if(row.generation!==context.offline.generation(ownerId))throw failure('OFFLINE_RESET_REQUIRED',409);
    const prior=Object.values(context.accountState(ownerId).commands).find(c=>c.offlineSource?.id===row.id);
    if(prior){
      if(prior.offlineSource.ciphertextHash!==hash(row.envelope))throw failure('OFFLINE_TASK_INVALID');
      if(prior.offlineSource.confirmed){
        if((await request('ack',{id:row.id,claimId:row.claimId,receiptId:prior.commandId})).accepted&&prior.offlineSource.reportedState)
          await request('result',{id:row.id,receiptId:prior.commandId,state:prior.offlineSource.reportedState});
        return;
      }
      if(prior.state==='pending'&&!prior.offlineSource.confirmed)await context.serial(()=>context.mutate(ownerId,next=>{next.commands[prior.commandId].offlineSource.claimId=row.claimId;}));
      await resume(ownerId,prior.commandId);return;
    }
    const body=openTask(row.envelope,typeof recipient==='function'?await recipient():recipient,{purpose:'offline-task',id:row.id,accountId:row.accountId,hostId:context.rootState.hostId,deviceId:row.deviceId,generation:row.generation});
    if(!body||Object.keys(body).some(k=>!['text','sessionId','projectId','createdAt'].includes(k))||typeof body.text!=='string'||!body.text.trim()||body.text.length>8192||!Number.isSafeInteger(body.createdAt)||body.createdAt<0||body.createdAt>8640000000000000||
      [body.sessionId,body.projectId].some(id=>id!==null&&id!==undefined&&(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id))))throw failure('OFFLINE_TASK_INVALID');
    let sessionId=body.sessionId;
    if(!sessionId)sessionId=await context.mainChat.prepareReminder(ownerId);
    const session=context.accountState(ownerId).sessions[sessionId];
    if(!Object.hasOwn(context.accountState(ownerId).sessions,sessionId)||!session||session.deleting||session.archived||hasPrivateContent(session)||session.projectId!==(body.projectId??undefined))throw failure('SESSION_UNAVAILABLE');
    if(context.usage){const model=(await context.backend.listModels({ownerId})).find(row=>row.id===session.modelProfileId);if(model)context.usage.assertAllowed(ownerId,model);}
    const payload=canonicalCommand({requestId:'offline-'+row.id,kind:'session.message',targetDeviceId:context.rootState.hostId,sessionId,text:body.text,mode:'queue',
      ...(session.projectId?{projectId:session.projectId,projectRevision:session.projectRevision}:{}),
      ...(session.conversationId?{conversationId:session.conversationId}:{})},context.rootState.hostId,true);
    const commandId=await context.serial(()=>context.mutate(ownerId,next=>{
      const existing=Object.values(next.commands).find(command=>command.offlineSource?.id===row.id);
      if(existing){
        if(existing.offlineSource.ciphertextHash!==hash(row.envelope))throw failure('OFFLINE_TASK_INVALID');
        if(existing.state==='pending'&&!existing.offlineSource.confirmed)existing.offlineSource.claimId=row.claimId;
        return existing.commandId;
      }
      if(next.memoryCleanupPending||row.generation!==context.offline.generation(ownerId))throw failure('OFFLINE_RESET_REQUIRED');
      if(!next.devices[deviceId]?.scopes.includes('commands:write')||next.devices[deviceId].revoked)throw failure('FORBIDDEN',403);
      if(Object.keys(next.commands).length>=MAX_COMMANDS||Object.values(next.commands).reduce((n,c)=>n+Buffer.byteLength(c.payload.text??''),0)+Buffer.byteLength(body.text)>MAX_UNRECONCILED_TEXT_BYTES)throw failure('CAPACITY_LIMIT',429);
      const commandId='cmd-'+randomUUID(),at=new Date(context.timestamp()).toISOString();
      next.commands[commandId]={commandId,ownerId,requestId:payload.requestId,payload,payloadHash:digest(JSON.stringify(payload)),sourceDeviceId:deviceId,sourceAuthEpoch:next.devices[deviceId].authEpoch,
        targetDeviceId:payload.targetDeviceId,kind:payload.kind,sessionId,state:'pending',createdAt:at,updatedAt:at,
        offlineSource:{id:row.id,deviceId:row.deviceId,jkt:row.jkt,generation:row.generation,claimId:row.claimId,ciphertextHash:hash(row.envelope),confirmed:false,submittedAt:new Date(body.createdAt).toISOString(),receivedAt:at}};
      return commandId;
    }));
    await resume(ownerId,commandId);
  }
  async function results() {
    for(const ownerId of context.ownerIds())for(const command of Object.values(context.accountState(ownerId).commands)){
      const source=command.offlineSource;if(!source?.confirmed)continue;
      if(!offlineCommandSource(context,ownerId,command))continue;
      if(command.state==='pending'){context.schedule(ownerId,command.commandId);continue;}
      const terminal=context.accountState(ownerId).activity?.sources?.[command.sessionId]?.terminals?.[command.commandId];
      const detail=command.state==='accepted_by_dsh'?await context.taskDetail(context.accountState(ownerId),command.commandId):null;
      const started=detail?.replyEvidence?.startedAt||source.startedAt;
      if(started&&!source.startReported){
        if(!(await request('result',{id:source.id,receiptId:command.commandId,state:'started'})).accepted)continue;
        await context.serial(()=>context.mutate(ownerId,next=>{const source=next.commands[command.commandId]?.offlineSource;if(source){source.startReported=true;source.startedAt=started;}}));
      }
      const state=terminal?terminal.state==='completed'?'completed':'failed':command.state==='rejected'?'failed':started?'started':null;
      if(!state||state===source.reportedState)continue;
      await request('result',{id:source.id,receiptId:command.commandId,state});
      await context.serial(()=>context.mutate(ownerId,next=>{const source=next.commands[command.commandId]?.offlineSource;if(source){source.reportedState=state;if(started)source.startedAt=started;}}));
      const eventSource=activitySource(context.accountState(ownerId),command.sessionId,{taskId:command.commandId});
      if(state==='started')await context.activity.record(ownerId,{key:'offline-start:'+source.id,type:'task.started',title:'电脑已开始',summary:'你交代的一件事已经开始。',source:eventSource,actions:[{kind:'open_chat',label:'打开对话',target:eventSource}]});
      if(state==='failed'&&!terminal)await context.activity.record(ownerId,{key:'offline-failed:'+source.id,type:'task.failed',title:'没做成',summary:'你交代的一件事没做成，打开对话查看原因。',source:eventSource,actions:[{kind:'open_chat',label:'打开对话',target:eventSource}]});
    }
  }
  function tick(){
    if(closed||flight||!context.cloudIdentity)return flight;
    if(context.cloudIdentity.offlineTasksSupported?.()!==true){validated.clear();return Promise.resolve();}
    flight=(async()=>{
      await context.cloudIdentity.syncRevocations();
      if(context.cloudIdentity.offlineTasksSupported?.()!==true){validated.clear();return;}
      for(const ownerId of context.ownerIds())for(const command of Object.values(context.accountState(ownerId).commands))await resume(ownerId,command.commandId);
      const result=await request('claim',{});
      for(const row of result.items){
        try{await receive(row);}catch(error){
          if(['OFFLINE_TASK_INVALID','INVALID_REQUEST','BODY_TOO_LARGE','REQUEST_CONFLICT','MODEL_UNAVAILABLE','SESSION_UNAVAILABLE','FORBIDDEN'].includes(error.code)){
            const receiptId='invalid-'+hash(row.id).slice(0,40);
            if((await request('ack',{id:row.id,claimId:row.claimId,receiptId})).accepted)await request('result',{id:row.id,receiptId,state:'failed'});
          }else throw error;
        }
      }
      await results();
    })().finally(()=>{flight=null;});return flight;
  }
  return {tick,canDispatch:(ownerId,commandId)=>context.cloudIdentity.offlineTasksSupported?.()===true&&validated.has(key(ownerId,commandId)),start(){if(!context.cloudIdentity)return;void tick().catch(()=>{});timer=setInterval(()=>void tick().catch(()=>{}),5000);timer.unref();},async close(){closed=true;clearInterval(timer);await flight?.catch(()=>{});}};
}
