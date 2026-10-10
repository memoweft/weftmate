import { createHmac, randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { digest, failure } from './common.mjs';
import { chatForSession } from './chat-identity.mjs';
import { hasPrivateContent } from './temporary-chats.mjs';
import { activityNotificationContent } from './notification-content.mjs';

export const ACTIVITY_TYPES = ['reminder.triggered','task.completed','task.failed','task.stopped','approval.pending','question.pending','memory.paused','memory.submission.completed','memory.report','system.update.available','system.reconnected','system.dnd.summary','system.notification.test','companion.greeting'];
const short = value => Array.from(String(value ?? '').replace(/\s+/g, ' ').trim()).slice(0,160).join('');
export function activityState(account) {
  return account.activity ??= { version:1, secret:randomBytes(32).toString('hex'), sequence:0, generation:0, items:{}, changes:[], sources:{}, operations:{},suppressed:{} };
}
export function activityCounts(account) {
  const rows = Object.values(account.activity?.items ?? {});
  return { unreadCount:rows.filter(row=>!row.read).length, actionableCount:rows.filter(row=>row.state==='pending').length };
}
export function activitySource(account, sessionId, extra={}) {
  const chat = chatForSession(account, sessionId), session=account.sessions[sessionId];
  const segment=account.chatIdentity?.segments[account.chatIdentity?.sessionSegments[sessionId]];
  return { ...(chat ? {chatId:chat.chatId,chatKind:chat.kind} : {}), sessionId, ...(session?.projectId ? {projectId:session.projectId}:{}),
    ...(Number.isSafeInteger(extra.seq)&&segment?.hostId ? {eventId:`event-${digest(`${segment.hostId}/${sessionId}/${extra.seq}`)}`} : {}), ...extra };
}
export function nativeTaskActivity(account,sessionId,terminal){
  if(!terminal)return;
  const task=terminal.taskId&&account.commands[terminal.taskId];
  if(task){const commands=Object.values(account.commands).filter(row=>row.commandId===task.commandId||row.rootTaskId===task.commandId);
    if(commands.some(row=>['dispatching','uncertain','pending'].includes(row.state)||row.toolExecutions?.some(exec=>['running','uncertain'].includes(exec.state)||exec.jobId&&!['completed','failed','killed'].includes(exec.jobState))))return;
  }
  const chat=chatForSession(account,sessionId);
  const source=activitySource(account,sessionId,{seq:terminal.seq,...(terminal.taskId?{taskId:terminal.taskId}:{})});
  const id=terminal.taskId&&chat?.kind==='side'?`activity-result-${digest(`${chat.chatId}/${terminal.taskId}`).slice(0,40)}`:undefined;
  return putActivity(account,terminal.taskId?`task:${terminal.taskId}`:`turn:${sessionId}:${terminal.turn??terminal.seq}`,{id,at:terminal.at,type:`task.${terminal.state}`,
    title:{completed:'任务完成',failed:'任务失败',stopped:'任务已停止'}[terminal.state],summary:terminal.summary??'打开对话查看结果。',failureReason:terminal.failureReason,
    source,actions:[{kind:'open_chat',label:'打开对话',target:source}],level:terminal.state==='failed'?'important':'normal'});
}
export function putActivity(account, key, input) {
  const state=activityState(account);
  const priorTask=input.source?.taskId && input.type?.startsWith('task.') ? Object.values(state.items).find(row=>row.source.taskId===input.source.taskId&&row.type.startsWith('task.')) : null;
  const id=priorTask?.id ?? input.id ?? `activity-${digest(key)}`, previous=state.items[id];
  if(state.suppressed?.[id] || input.source?.taskId&&state.suppressed?.[`task:${input.source.taskId}`])return null;
  if(input.source?.sessionId&&state.erasedBefore?.[input.source.sessionId]&&input.at<=state.erasedBefore[input.source.sessionId])return null;
  const privateSource=input.source?.sessionId && hasPrivateContent(account.sessions[input.source.sessionId]);
  const row={ id, at:previous?.at ?? input.at, type:input.type, title:short(input.title), summary:short(input.summary), source:input.source ?? {},
    actions:input.actions ?? [], state:input.state ?? 'completed', notification:{level:input.level ?? 'normal',type:input.type,initiatedBy:input.initiatedBy ?? previous?.notification.initiatedBy ?? (['memory','system','companion'].includes(input.type.split('.')[0])?'assistant':'user'),...(input.test?{test:true}:{})},
    ...(privateSource ? {temporary:true}: {}) };
  if (privateSource) { row.title=input.type.startsWith('task.') ? '临时对话中的任务' : input.type==='approval.pending' ? '临时对话需要审批' : input.type==='question.pending' ? '临时对话需要回答' : '临时对话动态';
    row.summary=input.type==='task.completed' ? '临时对话中的任务已完成' : input.type==='task.failed' ? '临时对话中的任务失败' : input.type==='task.stopped' ? '临时对话中的任务已停止' : '打开临时对话查看。'; }
  Object.assign(row.notification, activityNotificationContent(account, {...row,...(!privateSource?{failureReason:input.failureReason,approvalOperation:input.approvalOperation}:{})}));
  if (previous && isDeepStrictEqual({...row,notification:undefined},Object.fromEntries(Object.keys(row).map(k=>[k,k==='notification'?undefined:previous[k]]))) && row.notification.level===previous.notification.level && row.notification.initiatedBy===previous.notification.initiatedBy && row.notification.title===previous.notification.title && row.notification.body===previous.notification.body) return previous;
  // Keep the original decision for content edits; resolving a pending item is silent.
  if(previous && Object.hasOwn(previous.notification,'notify')) row.notification={...previous.notification,...row.notification,
    ...(row.notification.level==='silent'?{notify:false,sound:false,decision:'activity',reason:'silent'}:{})};
  const seq=++state.sequence;
  state.items[id]={...row, revision:(previous?.revision??0)+1,attentionRevision:seq,createdSequence:previous?.createdSequence??seq,read:false};
  state.changes.push({seq,id}); return state.items[id];
}
export function removeActivity(account, predicate) {
  const state=account.activity; if(!state)return;
  let removed=false;
  for(const row of Object.values(state.items)) if(predicate(row)){delete state.items[row.id];state.suppressed??={};state.suppressed[row.id]=true;
    if(row.source.taskId)state.suppressed[`task:${row.source.taskId}`]=true;
    state.changes.push({seq:++state.sequence,id:row.id,removed:true});removed=true;}
  if(removed){state.generation++;state.operations={};}
}
export function reconcileActivity(account) {
  const state=activityState(account);
  if(state) removeActivity(account,row=>row.source.sessionId && (!account.sessions[row.source.sessionId] ||
    account.sessions[row.source.sessionId].forgottenSeqs?.includes(row.source.seq)));
  for(const command of Object.values(account.commands)) {
    if(!command.sessionId || !account.sessions[command.sessionId] || account.sessions[command.sessionId].deleting)continue;
    for(const [kind,rows] of [['approval',command.toolApprovals??[]],['question',command.userQuestions??[]]])for(const row of rows){
      const source=activitySource(account,command.sessionId,{taskId:row.taskId??command.commandId,...(row.observedSeq!==undefined?{seq:row.observedSeq}:{})});
      const pending=row.status==='pending', type=`${kind}.pending`, target={sessionId:command.sessionId,taskId:source.taskId,
        ...(kind==='approval'?{approvalId:row.approvalId}:{questionRpcId:row.questionRpcId})};
      putActivity(account,`${kind}:${command.sessionId}:${row.approvalId??row.questionRpcId}`,{at:row.createdAt,type,source,
        title:kind==='approval'?'需要审批':'需要回答',approvalOperation:kind==='approval'?(row.reason||row.toolName||'这项操作'):undefined,summary:pending ? (kind==='approval'?row.reason??`允许 ${row.toolName??'这项操作'}？`:row.questions?.[0]?.question??'补充信息后继续。') :
          row.status==='unavailable'?'已失效':kind==='approval'?(row.decisionOutcome==='deny'?'已拒绝':'已处理'):'已回答',state:pending?'pending':row.status==='unavailable'?'unavailable':'completed',level:pending?'important':'silent',
        actions:[...(pending?[{kind:kind==='approval'?'respond_approval':'answer_question',label:kind==='approval'?'审批':'回答',target}]:[]),{kind:'open_chat',label:'打开对话',target:source}]});
    }
  }
  for(const result of Object.values(account.chatResults??{})){
    if(result.deleted){removeActivity(account,row=>row.source.taskId===result.taskId || row.id===result.activityId);continue;}
    if(!result.taskId)continue; // Sharing ordinary text does not prove task completion.
    const source=activitySource(account,result.sourceRef?.native?.sessionId??result.sourceRef?.sessionId,{chatId:result.sourceChatId,taskId:result.taskId,eventId:result.sourceEventId});
    if(!source.sessionId)delete source.sessionId;
    putActivity(account,`task:${result.taskId??result.resultId}`,{id:result.activityId,at:result.at,type:`task.${result.state}`,source,
      title:{completed:'任务完成',failed:'任务失败',stopped:'任务已停止'}[result.state],summary:result.summary,failureReason:state.sources[source.sessionId]?.terminals?.[result.taskId]?.failureReason,actions:[{kind:'open_chat',label:'打开旁聊',target:source}]});
  }
  for(const [sessionId,scan]of Object.entries(account.activity?.sources??{}))if(account.sessions[sessionId]&&!account.sessions[sessionId].deleting){
    for(const terminal of Object.values(scan.terminals??{}))if(!Object.values(account.chatResults??{}).some(result=>result.taskId===terminal.taskId))nativeTaskActivity(account,sessionId,terminal);
  }
}
export function activityToken(account,ownerId,value) {
  const body=Buffer.from(JSON.stringify({ownerId,generation:activityState(account).generation,...value})).toString('base64url');
  return `${body}.${createHmac('sha256',account.activity.secret).update(body).digest('base64url')}`;
}
export function readActivityToken(account,ownerId,token,kind) {
  try{const [body,sig,extra]=token.split('.');if(extra||sig!==createHmac('sha256',activityState(account).secret).update(body).digest('base64url'))throw 0;
    const value=JSON.parse(Buffer.from(body,'base64url'));if(value.ownerId!==ownerId||kind!=='changes'&&value.generation!==account.activity.generation||value.kind!==kind)throw 0;return value;
  }catch{throw failure('CURSOR_RESET_REQUIRED',409);}
}
export function activityMatches(row,filter,type){return (!type||row.type===type||row.type.startsWith(`${type}.`)) && (filter==='all'||filter==='unread'&&!row.read||filter==='actionable'&&row.state==='pending');}
