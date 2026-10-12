/** Local deterministic projection; the activity store owns durability and delivery. */
import { failure } from './common.mjs';
import { activityState, putActivity } from './activity-store.mjs';
import { notificationSettings } from './notification-policy.mjs';
import { localNotificationTime } from './notification-policy.mjs';
import { memorySuccessors, memoryItemsFormedInWindow } from '../personal-memory/world-projection.mjs';

export const MEMORY_REVIEW_DAYS = 90;
export const MEMORY_REVIEW_LIMIT = 3;
export const MEMORY_DIGEST_LIMIT = 6;
const DAY = 86400000;
const kinds = ['cognition','entity','relationship','event'];
const keyOf = row => `${row.kind}:${row.id}`;
const rawKey = row => `${row.object_kind}:${row.item_id}`;
export const memoryDigestState = account => activityState(account).memoryDigest ??= { lastUsed:{}, reviewed:{}, operations:{}, changes:[] };
const dateShift = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0,10);

/** Resolve a local minute, choosing the first occurrence on a fold and advancing a DST gap. */
export function digestLocalInstant(date, time, zone) {
  const target = Date.parse(`${date}T${time}:00Z`);
  let estimate = target;
  const format = instant => { const value=localNotificationTime(instant,zone);return Date.parse(`${value.day}T${value.time}:00Z`); };
  for(let n=0;n<4;n++) estimate += target-format(estimate);
  // Offsets before/after the day cover folds and gaps, including half-hour DST.
  const offsets = [...new Set([estimate-DAY,estimate,estimate+DAY].map(at=>format(at)-Math.floor(at/60000)*60000))];
  const candidates = offsets.map(offset=>target-offset).sort((a,b)=>a-b);
  return candidates.find(at=>format(at)===target) ?? candidates.filter(at=>format(at)>target).sort((a,b)=>format(a)-format(b))[0];
}
export function digestWindow(now, zone, settings) {
  const local=localNotificationTime(now,zone), weekday=new Date(`${local.day}T00:00:00Z`).getUTCDay();
  let date=dateShift(local.day,-((weekday-settings.memoryDigestWeekday+7)%7));
  let end=digestLocalInstant(date,settings.memoryDigestTime,zone);
  if(end>now){date=dateShift(date,-7);end=digestLocalInstant(date,settings.memoryDigestTime,zone);}
  return { key:date, from:new Date(digestLocalInstant(dateShift(date,-7),settings.memoryDigestTime,zone)).toISOString(),
    to:new Date(end).toISOString(), timeZone:zone };
}
const inWindow=(at,window)=>Number.isFinite(Date.parse(at)) && Date.parse(at)>=Date.parse(window.from)&&Date.parse(at)<Date.parse(window.to);
const current=row=>row.current_state==='current'&&!row.lifecycle?.invalid_at&&!row.lifecycle?.archived_at&&!row.lifecycle?.muted_at;
const topics={cognition:'理解与偏好',entity:'人物与事物',relationship:'关系',event:'经历与安排'};
const cognitionTopics={preference:'偏好与习惯',decision:'计划与决定',evaluation:'看法与理解',belief:'看法与理解',fact:'个人情况',commitment:'约定与安排'};
function entry(row,state,review=false){
  const kind=row.object_kind,id=row.item_id,used=state.lastUsed[`${kind}:${id}`]??row.last_used_at;
  return {kind,id,text:String(row.value?.content??row.value?.canonical_name??'内容未提供').replace(/\s+/g,' ').trim().slice(0,240),
    topic:String(row.value?.topic??(kind==='cognition'?cognitionTopics[row.value?.content_type]:null)??topics[kind]).slice(0,60),status:'current',
    ...(review?{reviewReason:used?'很久没有用到了':'很久没有更新，尚无使用记录'}:{})};
}
export function projectDigest(rows,state,window,now) {
  const chain=memorySuccessors(rows),correctionTransitions=chain.transitions;
  const added=memoryItemsFormedInWindow(rows,window.from,window.to).filter(current);
  added.sort((a,b)=>(Number(b.value?.importance??b.value?.confidence??0)-Number(a.value?.importance??a.value?.confidence??0))||String(b.created_at).localeCompare(String(a.created_at))||rawKey(a).localeCompare(rawKey(b)));
  const corrections=state.changes.filter(row=>row.operation==='correct'&&inWindow(row.at,window));
  const correctedIds=new Set(corrections.flatMap(row=>row.keys));
  for(const transition of correctionTransitions)if(inWindow(transition.occurred_at??chain.live.get(transition.replacement)?.created_at,window))correctedIds.add(transition.prior);
  const corrected=[...new Map([...correctedIds].map(key=>chain.resolve(key)).filter(row=>row&&current(row)).map(row=>[rawKey(row),row])).values()];
  const forgotten=new Set(state.changes.filter(row=>row.operation==='delete'&&inWindow(row.at,window)).flatMap(row=>row.keys)).size;
  const reviews=rows.filter(row=>current(row)&&!added.includes(row)&&!corrected.includes(row)&&
    now-Date.parse(state.lastUsed[rawKey(row)]??row.last_used_at??row.updated_at??row.created_at)>=MEMORY_REVIEW_DAYS*DAY&&
    (!state.reviewed[rawKey(row)]||now-Date.parse(state.reviewed[rawKey(row)])>=MEMORY_REVIEW_DAYS*DAY))
    .sort((a,b)=>String(state.lastUsed[rawKey(a)]??a.updated_at??a.created_at).localeCompare(String(state.lastUsed[rawKey(b)]??b.updated_at??b.created_at))||rawKey(a).localeCompare(rawKey(b)))
    .slice(0,MEMORY_REVIEW_LIMIT).map(row=>entry(row,state,true));
  return {...window,addedCount:added.length,correctedCount:correctedIds.size,forgottenCount:forgotten,
    added:added.slice(0,MEMORY_DIGEST_LIMIT).map(row=>entry(row,state)),corrected:corrected.map(row=>entry(row,state)),
    moreCount:Math.max(0,added.length-MEMORY_DIGEST_LIMIT),review:reviews};
}
export function reconcileDigests(account,rows) {
  const state=memoryDigestState(account),chain=memorySuccessors(rows);
  for(const item of Object.values(account.activity.items))if(item.memoryDigest){
    const report=structuredClone(item.memoryDigest);
    for(const list of [report.added,report.corrected,report.review])for(const ref of list){
      const row=chain.resolve(keyOf(ref));
      if(!row){ref.text='';ref.status='forgotten';}
      else if(!current(row)){ref.text='';ref.status='unavailable';ref.statusLabel=row.lifecycle?.muted_at?'已停用':row.lifecycle?.archived_at?'已归档':row.lifecycle?.invalid_at?'已失效':'当前不可用';}
      else {const replaced=keyOf(ref)!==rawKey(row);ref.kind=row.object_kind;ref.id=row.item_id;ref.text=entry(row,state).text;delete ref.statusLabel;if(ref.status!=='confirmed')ref.status=replaced||ref.status==='corrected'?'corrected':'current';}
    }
    if(JSON.stringify(report)!==JSON.stringify(item.memoryDigest)){
      item.memoryDigest=report;item.revision++;account.activity.changes.push({seq:++account.activity.sequence,id:item.id});
    }
  }
}
export function confirmDigestMemory(account,activityId,target,at) {
  const item=account.activity?.items[activityId],ref=item?.memoryDigest?.review.find(row=>row.kind===target.kind&&row.id===target.id);
  if(!ref||!['current','corrected'].includes(ref.status))throw failure('REQUEST_CONFLICT',409);
  memoryDigestState(account).reviewed[keyOf(ref)]=at;ref.status='confirmed';
  item.revision++;account.activity.changes.push({seq:++account.activity.sequence,id:item.id});
}
export function recordDigestMutation(account,{requestId,operation,keys,at}) {
  const state=memoryDigestState(account);if(state.operations[requestId])return;
  state.operations[requestId]=true;state.changes.push({operation,keys:[...new Set(keys)],at});
  if(operation==='delete'){
    for(const key of keys){delete state.lastUsed[key];delete state.reviewed[key];}
    for(const item of Object.values(account.activity.items))if(item.memoryDigest){let changed=false;
      for(const list of [item.memoryDigest.added,item.memoryDigest.corrected,item.memoryDigest.review])for(const ref of list)if(keys.includes(keyOf(ref))){ref.text='';ref.status='forgotten';changed=true;}
      if(changed){item.revision++;account.activity.changes.push({seq:++account.activity.sequence,id:item.id});}
    }
  }
}
export function createMemoryDigest(context) {
  const snapshots=new Map(),armed=new Map(),epochs=new Map();
  async function snapshot(ownerId,status){
    if(!context.memoryManager||status.state!=='ready'||status.capabilities?.list!==true)return null;
    const cached=snapshots.get(ownerId);if(cached?.revision===status.worldRevision)return cached.rows;
    const pages=await Promise.all(kinds.map(object_kind=>context.memoryManager.query(ownerId,'query_world',{operation:'list',object_kind,include_history:true})));
    if(pages.some(page=>!Array.isArray(page.items)||page.world_revision!==pages[0].world_revision))throw failure('MEMORY_REVISION_CHANGED',409);
    const revision=await context.memoryManager.query(ownerId,'query_world',{operation:'revision'});
    if(revision.world_revision!==pages[0].world_revision)throw failure('MEMORY_REVISION_CHANGED',409);
    const rows=pages.flatMap(page=>page.items);snapshots.set(ownerId,{rows,revision:pages[0].world_revision});return rows;
  }
  async function refresh(ownerId,status,{arm=true}={}){
    try{
      const account=context.accountState(ownerId),settings=notificationSettings(account);
      if(account.memoryCleanupPending||context.dataControls?.isLocked(ownerId))return;
      if(status.state==='ready'&&context.memoryManager?.receiptByRequest){
        for(const operation of Object.values(account.activity?.memoryDigest?.pending??{})){
          const result=await context.memoryManager.receiptByRequest(ownerId,operation.requestId).catch(()=>null),state=result?.receipt?.result_state;
          if(['applied','no_change','revision_conflict','rejected'].includes(state)){
            snapshots.delete(ownerId);epochs.set(ownerId,(epochs.get(ownerId)??0)+1);
            await context.serial(()=>context.mutate(ownerId,next=>{const stored=memoryDigestState(next);if(state==='applied')recordDigestMutation(next,operation);delete stored.pending[operation.requestId];}));
          }
        }
      }
      const epoch=epochs.get(ownerId)??0,rows=await snapshot(ownerId,status);if(!rows)return;
      await context.serial(()=>context.mutate(ownerId,next=>{
        if((epochs.get(ownerId)??0)!==epoch||next.memoryCleanupPending||context.dataControls?.isLocked(ownerId))return;
        reconcileDigests(next,rows);
        const settings=notificationSettings(next);if(!settings.memoryDigestEnabled)return;
        const state=memoryDigestState(next),now=context.timestamp(),window=digestWindow(now,context.usage.settings(ownerId).timeZone,settings);
        if(state.lastWindow && state.lastWindow>=window.key)return;
        if(state.lastTo&&state.lastTo>window.from&&state.lastTo<window.to)window.from=state.lastTo;
        const report=projectDigest(rows,state,window,now);
        if(report.addedCount||report.correctedCount||report.forgottenCount){
          putActivity(next,`memory-week:${window.key}`,{type:'memory.report',at:new Date(now).toISOString(),title:'这周我记住了什么',
            summary:`新记住 ${report.addedCount} 条 · 更正 ${report.correctedCount} 条 · 忘掉 ${report.forgottenCount} 条`,memoryDigest:report,
            source:{memoryWeek:window.key},actions:[{kind:'view_memory',label:'查看这一周的记忆',target:{from:window.from,to:window.to}}]});
        }
        state.lastWindow=window.key;state.lastTo=window.to;
      }));
      // Native schedules own the wake. This existing activity observation also covers
      // startup, disabled/unavailable recovery and an offline/missing runtime.
      const signature=JSON.stringify([settings.memoryDigestEnabled,settings.memoryDigestWeekday,settings.memoryDigestTime,context.usage.settings(ownerId).timeZone]);
      if(arm&&typeof context.backend.schedules==='function'&&armed.get(ownerId)!==signature){
        const main=Object.values(account.chatIdentity?.chats??{}).find(row=>row.kind==='main');
        const sessionId=main?.activeSessionId??Object.keys(account.sessions)[0];
        if(sessionId){await context.backend.schedules({ownerId,sessionId,action:'memory_digest',enabled:settings.memoryDigestEnabled,
          weekday:settings.memoryDigestWeekday,time:settings.memoryDigestTime});armed.set(ownerId,signature);}
      }
    }catch{/* Unavailable memory/runtime retries on the existing observation tick. */}
  }
  async function noteUse(ownerId,memories){
    if(!memories?.length)return;
    await context.serial(()=>context.mutate(ownerId,next=>{const state=memoryDigestState(next),at=new Date(context.timestamp()).toISOString();
      for(const row of memories)if(kinds.includes(row.kind)&&typeof row.id==='string')state.lastUsed[keyOf(row)]=at;
    }));
  }
  return {refresh,noteUse,invalidate:ownerId=>{snapshots.delete(ownerId);epochs.set(ownerId,(epochs.get(ownerId)??0)+1);}};
}
