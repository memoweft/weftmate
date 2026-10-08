/** Synthetic native log/model fixture around the real personal host and production DSH projection.
 * No compiled DSH engine: this file deliberately states that boundary in the evidence. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { createDshSessionAdapter } from '../../../src/runtime/dsh-adapter/sessions.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export function syntheticBackend(root) {
  const sessions = new Map(), operations = [], approvals = [], memoryDeletes = [];
  let service;
  const runtimeId = randomUUID();
  const model = { id:'mimo',name:'合成模型',model:'mimo-v2.6-flash',configured:true,sourceKind:'cloud' };
  function append(s,type,data){const event={seq:s.events.length,time:Date.now(),type,data};s.events.push(event);return event;}
  function message(text,receipt=randomUUID()){return {id:randomUUID(),source:{kind:'user',rpcId:receipt},content:[{type:'text',text}]};}
  function start(s,m) {
    s.current=m;s.supplements=[];s.turn++;s.running=true;
    append(s,'turn/start',{turn:s.turn});
    append(s,'agent/inbox/spliced',{target:'next-turn',start:0,removedCount:1,inserted:[]});
    append(s,'user/message',m);append(s,'step/start',{turn:s.turn,step:1});
    append(s,'assistant/message',{content:[{type:'text',text:'正在处理合成目标。'}]});
    operations.push({kind:'started',sessionId:s.id,text:m.content[0].text,receiptId:m.source.rpcId});
    if(!m.content[0].text.includes('保持运行') && !m.content[0].text.includes('A5_HOLD')) setTimeout(()=>finish(s,'completed'),1200).unref();
  }
  function finish(s,reason='completed') {
    if(!s.current)return;
    append(s,'assistant/message',{content:[{type:'text',text:reason==='aborted'?'已停止当前任务。':'合成任务完成。'}]});
    append(s,'step/end',{turn:s.turn,step:1});append(s,'turn/end',{turn:s.turn,reason:{kind:reason}});
    s.running=false;s.current=null;
    if(s.queue.length){const m=s.queue.shift();start(s,m);}
  }
  const adapter=id=>createDshSessionAdapter({sessions:{list:async()=>({result:{ok:true,value:{items:[{sessionId:id,origin:'user'}]}}})},events:{}},{readLog:async()=>sessions.get(id)?.events??[]});
  const backend={
    getStatus:async()=>({runtime:'ready',referenceScan:'ready'}),listModels:async()=>[model],preflight:async()=>({ok:true}),
    createSession:async({sessionId,ownerId})=>{const folder=join(root,'workspaces',sessionId);await mkdir(folder,{recursive:true,mode:0o700});await writeFile(join(folder,'经验.md'),'合成经验');sessions.set(sessionId,{id:sessionId,ownerId,folder,title:'合成对话',events:[],queue:[],turn:0,current:null,running:false});return {sessionId};},
    sendMessage:async({sessionId,text,mode})=>{
      const s=sessions.get(sessionId),m=message(text),receiptId=m.source.rpcId;
      operations.push({kind:'send',sessionId,text,mode,receiptId});
      if(s.running&&mode==='steer') {
        append(s,'agent/inbox/spliced',{target:'next-step',start:0,removedCount:0,inserted:[m]});
        const steeredReceiptId=s.current.source.rpcId;
        append(s,'agent/inbox/spliced',{target:'next-step',start:0,removedCount:1,inserted:[]});
        append(s,'user/message',m);s.supplements.push(receiptId);
        return {accepted:true,receiptId,steeredReceiptId};
      }
      const input=await service.beginUsage({sessionId,profileId:model.id});
      await service.finishUsage({...input,usage:{prompt_tokens:1000,completion_tokens:50,prompt_tokens_details:{cached_tokens:600}},source:'openai-compatible'});
      append(s,'agent/inbox/spliced',{target:'next-turn',start:s.queue.length,removedCount:0,inserted:[m]});
      if(s.running)s.queue.push(m);else start(s,m);
      return {accepted:true,receiptId};
    },
    stopTask:async({sessionId,receiptIds,queuedOnly})=>{
      const s=sessions.get(sessionId);operations.push({kind:queuedOnly?'cancel':'stop',sessionId,receiptIds});
      const removed=[],activeTurn=s.turn,activeReceipts=s.current?[s.current.source.rpcId,...(s.supplements??[])]:[];
      for(const receipt of receiptIds){const i=s.queue.findIndex(m=>m.source.rpcId===receipt);if(i>=0){s.queue.splice(i,1);append(s,'agent/inbox/spliced',{target:'next-turn',start:i,removedCount:1,inserted:[],outcome:'canceled'});removed.push(receipt);}}
      if(queuedOnly&&removed.length===0)return {status:'unconfirmed',outcomes:receiptIds.map(receiptId=>({receiptId,status:'unconfirmed'}))};
      if(!queuedOnly&&s.current&&receiptIds.includes(s.current.source.rpcId))finish(s,'aborted');
      return {status:queuedOnly?'queue_removed':'cancel_requested',outcomes:receiptIds.map(receiptId=>({receiptId,status:removed.includes(receiptId)?'queue_removed':activeReceipts.includes(receiptId)?'cancel_requested':'unconfirmed',...(activeReceipts.includes(receiptId)?{turn:activeTurn}:{}),backgroundJobs:[]}))};
    },
    cancelSession:async({sessionId})=>{const s=sessions.get(sessionId);s.queue=[];finish(s,'aborted');return {accepted:true};},
    describeSession:async id=>{const s=sessions.get(id);return s?{sessionId:id,title:s.title,agentPreset:'personal-remote',modelProfileId:model.id,running:s.running}:null;},
    deleteSession:async({sessionId})=>{const s=sessions.get(sessionId);await rm(s.folder,{recursive:true,force:true});sessions.delete(sessionId);operations.push({kind:'deleted',sessionId});return {deleted:true};},
    readEvents:async({sessionId,...input})=>adapter(sessionId).historyPage(sessionId,input),
    readEventDetail:async({sessionId,seq})=>adapter(sessionId).historyDetail(sessionId,seq),
    getTaskReplyEvidence:async({sessionId})=>{const s=sessions.get(sessionId);return {status:s.running?'streaming':'completed',turn:s.turn,assistantChunks:0,textChunks:0,reasoningChunks:0,assistantMessages:2,toolSaveObserved:false};},
    listUserQuestions:async({sessionId})=>({runtimeId,questions:sessions.get(sessionId)?.questionFrame?[sessions.get(sessionId).questionFrame]:[]}),
    respondUserQuestion:async({sessionId})=>{sessions.get(sessionId).questionFrame.nativeState='answered';return {accepted:true};},
  };
  const memoryManager={
    status:async()=>({state:'ready',worldRevision:1,capabilities:{list:true,source:true,correct:false,mute:false,inject:true,deleteEvidence:true,deleteWorldItem:false}}),
    peek:async()=>({}),query:async(owner,kind)=>kind==='query_jobs'?{jobs:[...sessions.values()].map(s=>({acceptance:{parent_session_id:s.id,evidence_ids:['synthetic-'+s.id]}}))}:{world_revision:1,items:[{item_id:'memory-synthetic',object_kind:'cognition',current_state:'current',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),source_count:1,value:{content:'偏好简洁的中文解释。'}}]},
    listSessionEvidence:async(owner,sessionId)=>[{evidenceId:'synthetic-'+sessionId}],
    submitCommand:async(owner,command)=>{memoryDeletes.push({owner,command});return {result_state:'applied'};},
    receiptByRequest:async()=>null,retryCleanupByRequest:async()=>({}),
    list:async()=>({worldRevision:1,items:[{id:'memory-synthetic',kind:'cognition',text:'偏好简洁的中文解释。',currentState:'current',sourceCount:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}],hasMore:false,nextCursor:null,searchScope:'account_snapshot'}),
  };
  async function accepted(api,body) {const posted=await api('/commands',body);if(posted.status!==202)throw Error('Seed command failed '+JSON.stringify(posted));for(let i=0;i<100;i++){const row=(await api('/commands/'+posted.command.commandId)).command;if(row.state==='accepted_by_dsh')return row;if(row.state==='rejected'||row.state==='uncertain')throw Error(JSON.stringify(row));await pause(30);}throw Error('Seed dispatch timeout');}
  async function seed(api,hostId) {
    const ids={};
    for(const [scene,title] of Object.entries({queue:'排队与插话练习',review:'整理项目资料',deletion:'可删除的合成对话',forget:'可遗忘的合成对话'})) {
      const created=await accepted(api,{requestId:'a5-create-'+scene,kind:'session.create',targetDeviceId:hostId,modelProfileId:model.id});
      ids[scene]=created.sessionId;sessions.get(created.sessionId).title=title;
      if(scene==='review') {
        const sent=await accepted(api,{requestId:'a5-review-message',kind:'session.message',targetDeviceId:hostId,sessionId:created.sessionId,text:'保持运行，读取项目资料并整理下一步。'});
        const s=sessions.get(created.sessionId),receiptId=sent.receiptId,callId='a5-delete',approvalId=randomUUID();
        const args={command:'rm synthetic-draft.txt',description:'删除合成草稿文件'},reason='[weftmate:delete] 删除后无法撤销，只影响本次合成草稿。\n'+JSON.stringify(args);
        append(s,'tool/call',{turn:1,callId:'a5-read',name:'read',arguments:JSON.stringify({path:'notes.md'})});
        append(s,'tool/result',{turn:1,message:{source:{kind:'tool',callId:'a5-read'},content:[{type:'tool-result',toolCallId:'a5-read',isError:false,content:[{type:'text',text:'合成资料已读取。'}]}]}});
        append(s,'tool/call',{turn:1,callId,name:'shell',arguments:JSON.stringify(args)});
        const metadata={runtimeId,approvalId,sessionId:created.sessionId,turn:1,callId,rootCallId:callId,receiptId,messageHash:hash('保持运行，读取项目资料并整理下一步。'),toolName:'shell',argumentsHash:hash(JSON.stringify(args))};
        await service.trackToolApproval({...metadata,action:'register_approval',reason});
        append(s,'approval/asked',{id:approvalId,toolName:'shell',callId,reason});approvals.push(metadata);
        const questions=[{id:'format',question:'报告要采用哪种格式？',options:[{label:'简要报告'},{label:'完整记录'}]}];
        const question=append(s,'tool/call',{turn:1,callId:'a5-question',name:'ask_user_question',arguments:JSON.stringify({questions})});
        s.questionRuntime=runtimeId;s.questionFrame={sessionId:s.id,questionRpcId:randomUUID(),sourceReady:true,sourceReceiptId:receiptId,messageHash:metadata.messageHash,turn:1,sourceSeq:s.events.find(e=>e.type==='user/message').seq,observedSeq:question.seq,questions,nativeState:'pending'};
        for(const content of ['# 合成项目报告\n第一版。',' # 合成项目报告\n已读取资料，等待确认删除草稿。']) {
          const artifact=await service.submitToolArtifact({sessionId:created.sessionId,turn:1,callId:'a5-output-'+randomUUID(),messageHash:metadata.messageHash,fileName:'项目报告.md',content});
          append(s,'tool/call',{turn:1,callId:artifact.artifactId,name:'write',arguments:JSON.stringify({fileName:'项目报告.md'})});
          append(s,'tool/result',{turn:1,message:{source:{kind:'tool',callId:artifact.artifactId},content:[{type:'tool-result',toolCallId:artifact.artifactId,isError:false,content:[{type:'text',text:JSON.stringify(artifact)}]}]}});
        }
      }
    }
    return ids;
  }
  async function addApproval() {
    const source=approvals[0],s=sessions.get(source.sessionId),callId='a5-deny-'+randomUUID(),approvalId=randomUUID();
    const args={command:'rm synthetic-draft.txt',description:'删除第二份合成草稿文件'},reason='[weftmate:delete] 删除后无法撤销，只影响本次合成草稿。\n'+JSON.stringify(args);
    const metadata={...source,callId,rootCallId:callId,approvalId,argumentsHash:hash(JSON.stringify(args))};delete metadata.resolved;
    append(s,'tool/call',{turn:1,callId,name:'shell',arguments:JSON.stringify(args)});
    await service.trackToolApproval({...metadata,action:'register_approval',reason});append(s,'approval/asked',{id:approvalId,toolName:'shell',callId,reason});approvals.push(metadata);
    return {approvalId};
  }
  async function consumeApprovals() {
    for(const metadata of approvals){if(metadata.resolved)continue;const row=await service.trackToolApproval({...metadata,action:'read_approval'});if(row.status==='answered'){
      await service.trackToolApproval({...metadata,action:'resolve_approval',outcome:row.decisionOutcome});
      append(sessions.get(metadata.sessionId),'approval/decided',{id:metadata.approvalId,outcome:row.decisionOutcome});metadata.resolved=true;operations.push({kind:'approval',outcome:row.decisionOutcome});
    }}
  }
  return {backend,memoryManager,attach(value){service=value;},seed,sessions,operations,memoryDeletes,approvals,finish,consumeApprovals,addApproval};
}
