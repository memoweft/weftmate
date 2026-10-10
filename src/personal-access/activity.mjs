/** Observation of DSH history, not a scheduler. All actions retain native receipts. */
import { digest, exactKeys, failure, validTime } from './common.mjs';
import { randomUUID } from 'node:crypto';
import { REQUEST_ID } from './constants.mjs';
import { hasPrivateContent } from './temporary-chats.mjs';
import { nativeFailureReason } from './notification-content.mjs';
import { ACTIVITY_TYPES, activityState, activityCounts, activitySource, putActivity, activityToken, readActivityToken, activityMatches, nativeTaskActivity } from './activity-store.mjs';

export function observeActivityEvents(account,sessionId,events,nextSeq,observeReminders=true) {
  const state=activityState(account), session=account.sessions[sessionId];
  if(!session || session.deleting || account.memoryCleanupPending)return;
  const scan=state.sources[sessionId]??={afterSeq:-1};
  const open=()=>({kind:'open_chat',label:'打开对话',target:activitySource(account,sessionId)});
  for(const event of events){
    if(session.forgottenSeqs?.includes(event.seq))continue;
    const data=event.data??{}, at=validTime(event.at)?event.at:new Date().toISOString();
    if(event.type==='turn.started') {scan.turn=data.turn;scan.executed=false;delete scan.summary;delete scan.failureReason;
      const commands=Object.values(account.commands).filter(c=>c.kind==='session.message'&&c.sessionId===sessionId&&c.state==='accepted_by_dsh');
      scan.taskId=commands.find(c=>c.receiptId===(data.receiptId??data.rpcId)||c.dshTurn===data.turn)?.commandId;
    }
    if(event.type==='user.message' && typeof data.receiptId==='string') {
      const command=Object.values(account.commands).find(c=>c.kind==='session.message'&&c.sessionId===sessionId&&c.receiptId===data.receiptId);
      if(command)scan.taskId=command.rootTaskId??command.commandId;
    }
    if(event.type.startsWith('step.')||event.type==='artifact.created')scan.executed=true;
    if(event.type==='step.failed'&&!hasPrivateContent(session))scan.failureReason=nativeFailureReason(data)||scan.failureReason;
    if(event.type==='assistant.message'&&!hasPrivateContent(session))scan.summary=String(data.text??'').slice(0,160);
    if(event.type==='turn.ended' && (scan.executed||account.commands[scan.taskId]?.scheduleSourceId||['failed','error','blocked','aborted'].includes(data.reason))){
      const result={completed:'completed',failed:'failed',error:'failed',blocked:'failed',aborted:'stopped'}[data.reason];
      if(result){const failureReason=result==='failed'&&!hasPrivateContent(session)?nativeFailureReason(data)||scan.failureReason:undefined;
        const terminal={at,state:result,turn:scan.turn,seq:event.seq,...(scan.taskId?{taskId:scan.taskId}:{}),...(scan.summary?{summary:scan.summary}:{}),...(failureReason?{failureReason}:{})};
        scan.terminals??={};scan.terminals[scan.taskId??event.seq]=terminal;
        if(!Object.values(account.chatResults??{}).some(row=>row.taskId===scan.taskId))nativeTaskActivity(account,sessionId,terminal);
      }
      scan.executed=false;delete scan.summary;delete scan.failureReason;
    }
    if(observeReminders&&(event.type==='assistant.message'&&data.reminder || event.type==='user.message'&&data.reminder)){
      putActivity(account,`reminder:${sessionId}:${data.messageId??data.id??event.seq}`,{at,type:'reminder.triggered',title:'提醒',summary:data.text,initiatedBy:data.initiatedBy==='assistant'?'assistant':'user',
        source:activitySource(account,sessionId,{seq:event.seq,...(data.messageId??data.id?{messageId:data.messageId??data.id}:{})}),actions:[open()],level:'important'});
    }
  }
  scan.afterSeq=Math.max(scan.afterSeq,nextSeq);
}

export function createActivity(context) {
  const flights=new Map(), bootId=randomUUID();let timer,closed=false;
  async function refresh(ownerId){
    if(flights.has(ownerId))return flights.get(ownerId);
    const work=(async()=>{
      const account=context.accountState(ownerId);if(account.memoryCleanupPending)return;
      try {
        const status=await context.callBackend(()=>context.backend.getStatus({ownerId}));
        await context.serial(()=>context.mutate(ownerId,next=>{
          const state=activityState(next);
          if(status.runtime==='ready'){
            if(state.runtimeWasReady&&(state.bootId!==bootId||state.runtimeOfflineAt))putActivity(next,`reconnected:${state.bootId!==bootId?bootId:state.runtimeOfflineAt}`,{
              at:new Date(context.timestamp()).toISOString(),type:'system.reconnected',title:'电脑已恢复连接',summary:'可以继续查看结果和处理电脑上的任务。',level:'silent',source:{hostId:next.hostId}});
            state.bootId=bootId;state.runtimeWasReady=true;delete state.runtimeOfflineAt;
          }else if(state.runtimeWasReady)state.runtimeOfflineAt??=new Date(context.timestamp()).toISOString();
        }));
      } catch {await context.serial(()=>context.mutate(ownerId,next=>{const state=activityState(next);if(state.runtimeWasReady)state.runtimeOfflineAt??=new Date(context.timestamp()).toISOString();}));}
      for(const [sessionId,session] of Object.entries(account.sessions)){
        if(session.origin!=='personal-remote'||session.deleting)continue;
        try{
          const generation=context.accountState(ownerId).activity?.generation??0;
          // Continue from a durable watermark; each round is bounded to one native page.
          const afterSeq=context.accountState(ownerId).activity?.sources[sessionId]?.afterSeq??-1;
          const page=await context.callBackend(()=>context.backend.readEvents({ownerId,sessionId,afterSeq,limit:200}));
          if(!Array.isArray(page.events)||!Number.isSafeInteger(page.nextSeq)||page.nextSeq<afterSeq)throw failure('BACKEND_UNAVAILABLE',503);
          if (page.nextSeq > afterSeq || page.events.length) await context.serial(()=>context.mutate(ownerId,next=>observeActivityEvents(next,sessionId,page.events.map(event=>context.publicHistoryEvent(ownerId,sessionId,event)),page.nextSeq,!context.backend.schedules),()=>{
            const live=context.accountState(ownerId);if(!live.sessions[sessionId]||live.sessions[sessionId].deleting||live.memoryCleanupPending||(live.activity?.generation??0)!==generation)throw failure('SOURCE_UNAVAILABLE',404);
          }));
          if(context.backend.schedules){const notices=await context.backend.schedules({ownerId,sessionId,action:'notifications'});
            if (notices.items?.length) await context.serial(()=>context.mutate(ownerId,next=>{if(!next.sessions[sessionId]||next.sessions[sessionId].deleting||next.memoryCleanupPending||(next.activity?.generation??0)!==generation)return;
              for(const notice of notices.items??[]){if(Object.values(next.activity?.items??{}).some(row=>row.type==='reminder.triggered'&&row.source.sessionId===sessionId&&row.source.messageId===notice.messageId))continue;putActivity(next,`reminder:${sessionId}:${notice.messageId??notice.id}`,{at:notice.createdAt,type:'reminder.triggered',title:notice.kind==='task'?'定时任务触发':'提醒',summary:notice.text,initiatedBy:notice.initiatedBy==='assistant'?'assistant':'user',
                source:activitySource(next,sessionId,{messageId:notice.messageId,scheduleId:notice.id,...(Number.isSafeInteger(notice.seq)?{seq:notice.seq}:{})}),actions:[{kind:'open_chat',label:'打开对话',target:activitySource(next,sessionId,{messageId:notice.messageId,...(Number.isSafeInteger(notice.seq)?{seq:notice.seq}:{})})}],level:'important'});}
            }));}
          await context.refreshToolApprovals(ownerId,sessionId);await context.syncUserQuestions(ownerId,sessionId);
        }catch(error){if(['SERVICE_CLOSING','STORAGE_UNAVAILABLE'].includes(error.code))throw error; /* Offline source keeps its durable watermark. */}
      }
      if(context.memoryManager){const memory=await context.memoryManager.status(ownerId);
        await context.serial(()=>context.mutate(ownerId,next=>{const state=activityState(next);
          const job=next.memoryBackfillJob, backfillPaused=job?.state==='paused';
          for(const issue of memory.formationIssues??[]) putActivity(next,`memory-formation:${issue.jobId}`,{
            at:issue.createdAt,type:'memory.report',title:issue.intent==='correction'?'有 1 条纠正没有生效':'有 1 条记忆没有形成',
            summary:'原话已保存，可在记忆中查看原话并重试形成。',source:activitySource(next,issue.sessionId,{memoryJobId:issue.jobId}),level:'important',state:'pending',
            actions:[{kind:'view_memory',label:'查看原话与重试',target:{}}]});
          for(const row of Object.values(state.items)) if(row.type==='memory.report'&&row.state==='pending'&&row.source?.memoryJobId&&
            !(memory.formationIssues??[]).some(issue=>issue.jobId===row.source.memoryJobId)) {
              putActivity(next,`memory-formation:${row.source.memoryJobId}`,{...row,title:'记忆纠正状态已更新',
                summary:'这条记录已重新处理或撤回，请查看记忆中的最新状态。',state:'completed',level:'silent',
                actions:[{kind:'view_memory',label:'查看记忆',target:{}}]});
          }
          const recoveryKey='memory-recovery';
          if(memory.state==='recovering') putActivity(next,recoveryKey,{
            at:new Date(context.timestamp()).toISOString(),type:'memory.report',title:'正在继续整理上次没做完的记忆',
            summary:'原话已保存，整理完成后会自动恢复正常。',level:'silent',state:'completed',
            actions:[{kind:'view_memory',label:'查看记忆',target:{}}]});
          else if(memory.state==='ready'&&Object.values(state.items).some(row=>row.type==='memory.report'&&row.title==='正在继续整理上次没做完的记忆')) putActivity(next,recoveryKey,{
            at:new Date(context.timestamp()).toISOString(),type:'memory.report',title:'上次没做完的记忆已整理完成',
            summary:'记忆已恢复正常。',level:'silent',state:'completed',
            actions:[{kind:'view_memory',label:'查看记忆',target:{}}]});
          const paused=['paused','unavailable','failed'].includes(memory.state)||memory.reasonCode==='MEMORY_MODEL_UNAVAILABLE';
          const healthKey=backfillPaused?`backfill:${job.id}:paused`:paused?`paused:${memory.reasonCode??memory.state}`:`available:${memory.state}`;
          if(state.memoryState!==healthKey&&(paused||backfillPaused)){state.memoryTransition=(state.memoryTransition??0)+1;putActivity(next,`memory-paused:${state.memoryTransition}`,{
            at:new Date(context.timestamp()).toISOString(),type:'memory.paused',title:backfillPaused?'记忆补整理已暂停':'记忆已暂停',
            summary:backfillPaused?'已提交的回合仍会继续形成，可在记忆页继续补整理。':'记忆暂时无法更新，可在记忆页查看状态。',
            ...(backfillPaused?{source:{memoryJobId:job.id}}:{}),level:'normal',actions:[{kind:'view_memory',label:'查看记忆',target:{}}]});}
          if(job?.state==='completed'&&job.cursor>(job.skipped??0))putActivity(next,`backfill-completed:${job.id}`,{at:new Date(context.timestamp()).toISOString(),type:'memory.submission.completed',title:'历史对话补交完成',
            summary:'历史对话已提交整理，形成进度可在记忆页查看。',source:{memoryJobId:job.id},level:'silent',actions:[{kind:'view_memory',label:'查看记忆',target:{}}]});
          state.memoryState=healthKey;
        }));}
      const update=await context.updateStatus();
      for(const layer of update?.layers??[])if(layer.availableVersion&&layer.availableVersion!==layer.currentVersion)await record(ownerId,{key:`update:${layer.layer}:${layer.availableVersion}`,type:'system.update.available',title:'更新可用',summary:`新版本 ${layer.availableVersion} 已可用。`,level:'normal',actions:[{kind:'view_settings',label:'查看更新',target:{category:'about'}}]});
      await context.sideChats.reconcile(ownerId);
      await context.serial(()=>context.mutate(ownerId,()=>{}));
    })().finally(()=>flights.delete(ownerId));flights.set(ownerId,work);return work;
  }
  async function record(ownerId,input){
    if(!ACTIVITY_TYPES.includes(input.type)||!input.key|| ['system.dnd.summary','system.notification.test'].includes(input.type)|| (input.initiatedBy!==undefined&&!['user','assistant'].includes(input.initiatedBy)) ||!['memory.','system.','companion.'].some(prefix=>input.type.startsWith(prefix)))throw failure('INVALID_REQUEST');
    return context.serial(()=>context.mutate(ownerId,next=>putActivity(next,`${input.type}:${input.key}`,{...input,at:input.at??new Date(context.timestamp()).toISOString()})));
  }
  function counts(ownerId){return activityCounts(context.accountState(ownerId));}
  function watermark(ownerId){const account=context.accountState(ownerId);return {...counts(ownerId),cursor:activityToken(account,ownerId,{kind:'changes',position:activityState(account).sequence})};}
  async function handleHttp(request,response,url,ownerId,deviceId){
    if(!/^\/personal\/v1\/activity(?:\/|$)/.test(url.pathname))return false;
    const write=request.method!=='GET';context.authenticate(request,write?'commands:write':'sessions:read');
    await refresh(ownerId);
    const authorize=()=>{const current=context.authenticate(request,write?'commands:write':'sessions:read');if(current.ownerId!==ownerId||current.deviceId!==deviceId)throw failure('UNAUTHORIZED',401);};authorize();
    const path=url.pathname.slice('/personal/v1/activity'.length), account=context.accountState(ownerId),state=activityState(account);
    const reply=value=>{authorize();context.json(response,200,value);return true;};
    if(!write){
      if(path==='/unread'){if(url.search)throw failure('INVALID_REQUEST');return reply(counts(ownerId));}
      if(path==='/changes'){
        if([...url.searchParams.keys()].some(k=>!['cursor','limit','filter','type'].includes(k))||[...url.searchParams.keys()].some(k=>url.searchParams.getAll(k).length!==1))throw failure('INVALID_REQUEST');
        const filter=url.searchParams.get('filter')??'all',type=url.searchParams.get('type')??'';
        if(!['all','unread','actionable'].includes(filter)||type&&!['task','reminder','memory','approval','question','system',...ACTIVITY_TYPES].includes(type))throw failure('INVALID_REQUEST');
        const limit=pageLimit(url),position=url.searchParams.has('cursor')?readActivityToken(account,ownerId,url.searchParams.get('cursor'),'changes').position:0;
        const changes=state.changes.filter(c=>c.seq>position).slice(0,limit),end=changes.at(-1)?.seq??position;
        const ids=[...new Set(changes.map(c=>c.id))],upserts=ids.flatMap(id=>state.items[id]?[state.items[id]]:[]),removals=ids.filter(id=>!state.items[id]);
        return reply({upserts,removals,nextCursor:activityToken(account,ownerId,{kind:'changes',position:end}),hasMore:end<state.sequence,
          snapshotCursor:activityToken(account,ownerId,{kind:'snapshot',through:end,filter,type}),...counts(ownerId)});
      }
      if(path!=='')throw failure('NOT_FOUND',404);
      if([...url.searchParams.keys()].some(k=>!['filter','type','cursor','limit'].includes(k))||[...url.searchParams.keys()].some(k=>url.searchParams.getAll(k).length!==1))throw failure('INVALID_REQUEST');
      const filter=url.searchParams.get('filter')??'all',type=url.searchParams.get('type')??'',limit=pageLimit(url);
      if(!['all','unread','actionable'].includes(filter)||type&&!['task','reminder','memory','approval','question','system',...ACTIVITY_TYPES].includes(type))throw failure('INVALID_REQUEST');
      const token=url.searchParams.has('cursor')?readActivityToken(account,ownerId,url.searchParams.get('cursor'),'page'):null;
      if(token&&(token.filter!==filter||token.type!==type))throw failure('CURSOR_RESET_REQUIRED',409);
      const through=token?.through??state.sequence, before=token?.before;
      const rows=Object.values(state.items).filter(row=>row.createdSequence<=through&&activityMatches(row,filter,type)&&(!before||`${row.at}/${row.id}`<before)).sort((a,b)=>b.at.localeCompare(a.at)||b.id.localeCompare(a.id));
      const items=rows.slice(0,limit),hasMore=rows.length>limit;
      return reply({items,timeZone:context.usage.settings(ownerId).timeZone,nextCursor:hasMore?activityToken(account,ownerId,{kind:'page',filter,type,through,before:`${items.at(-1).at}/${items.at(-1).id}`}):null,hasMore,
        snapshotCursor:activityToken(account,ownerId,{kind:'snapshot',through,filter,type}),syncCursor:activityToken(account,ownerId,{kind:'changes',position:through}),...counts(ownerId)});
    }
    if(url.search)throw failure('INVALID_REQUEST');
    const body=await context.readJson(request),readMatch=/^\/(activity-[A-Za-z0-9_-]+)\/read$/.exec(path);
    if(request.method==='PATCH'&&readMatch){exactKeys(body,['requestId','read','attentionRevision'],['requestId','read','attentionRevision']);if(typeof body.read!=='boolean'||!Number.isSafeInteger(body.attentionRevision))throw failure('INVALID_REQUEST');}
    else if(request.method==='POST'&&path==='/read')exactKeys(body,['requestId','through'],['requestId','through']);
    else throw failure('INVALID_REQUEST');
    if(typeof body.requestId!=='string'||!REQUEST_ID.test(body.requestId))throw failure('INVALID_REQUEST');
    const fingerprint=digest(JSON.stringify({path,body}));
    await context.serial(()=>context.mutate(ownerId,next=>{
      authorize();const store=activityState(next),prior=store.operations[body.requestId];
      if(prior){if(prior!==fingerprint)throw failure('REQUEST_CONFLICT',409);return;}
      if(context.requestIdUsed(next,body.requestId))throw failure('REQUEST_CONFLICT',409);
      const token=readMatch?null:readActivityToken(next,ownerId,body.through,'snapshot');
      const rows=readMatch?[store.items[readMatch[1]]]:Object.values(store.items).filter(row=>row.attentionRevision<=token.through&&activityMatches(row,token.filter,token.type));
      if(readMatch&&!rows[0])throw failure('NOT_FOUND',404);
      if(readMatch&&rows[0].attentionRevision!==body.attentionRevision)throw failure('REQUEST_CONFLICT',409);
      for(const row of rows)if(row.read!==(readMatch?body.read:true)){row.read=readMatch?body.read:true;row.revision++;store.changes.push({seq:++store.sequence,id:row.id});}
      store.operations[body.requestId]=fingerprint;
    },authorize));
    return reply(readMatch?{item:context.accountState(ownerId).activity.items[readMatch[1]]}:counts(ownerId));
  }
  async function tick(){try{for(const ownerId of context.ownerIds())if(!closed)await refresh(ownerId);}catch{/* Next observation retries; no task is dispatched. */}finally{if(!closed){timer=setTimeout(tick,2000);timer.unref?.();}}}
  return {refresh,record,counts,watermark,handleHttp,start(){closed=false;void tick();},async close(){closed=true;clearTimeout(timer);await Promise.allSettled([...flights.values()]);}};
}
function pageLimit(url){const text=url.searchParams.get('limit')??'50';if(!/^\d+$/.test(text)||Number(text)<1||Number(text)>200)throw failure('INVALID_REQUEST');return Number(text);}
