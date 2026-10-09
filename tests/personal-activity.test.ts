import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startTimelineCandidate } from './integration/timeline-ui-candidate.mjs';
import { activityState, putActivity, reconcileActivity, activityToken, readActivityToken, removeActivity } from '../src/personal-access/activity-store.mjs';
import { observeActivityEvents } from '../src/personal-access/activity.mjs';
import { eraseChatCopies } from '../src/personal-access/chat-erasure.mjs';

test('activity uses stable native identities, redacts temporary task/approval/question content before persistence and prevents erasure replay',()=>{
  const account:any={sessions:{private:{origin:'personal-remote',temporary:true}},commands:{}};
  const events=[{seq:0,at:'2026-10-10T00:00:00Z',type:'turn.started',data:{turn:1}},{seq:1,type:'step.completed',data:{}},
    {seq:2,type:'assistant.message',data:{text:'TEMPORARY-SECRET-42'}},{seq:3,at:'2026-10-10T00:01:00Z',type:'turn.ended',data:{reason:'completed'}}];
  observeActivityEvents(account,'private',events,3);const first=Object.values(account.activity.items)[0] as any;
  assert.equal(first.summary,'临时对话中的任务已完成');assert.equal(first.notification.level,'normal');
  observeActivityEvents(account,'private',events,3);assert.equal(Object.keys(account.activity.items).length,1);
  assert.ok(!JSON.stringify(account.activity).includes('TEMPORARY-SECRET-42'));
  const token=activityToken(account,'owner-a',{kind:'changes',position:0});
  assert.throws(()=>readActivityToken(account,'owner-b',token,'changes'),{code:'CURSOR_RESET_REQUIRED'});
  eraseChatCopies(account,{forgotten:true});observeActivityEvents(account,'private',events,3);
  assert.equal(Object.keys(account.activity.items).length,0);assert.ok(!JSON.stringify(account.activity).includes('TEMPORARY-SECRET-42'));
  assert.equal(readActivityToken(account,'owner-a',token,'changes').position,0);
});

test('approval status updates keep one activity, native response identity and increment attention without preserving forgotten body',()=>{
  const account:any={sessions:{a:{origin:'personal-remote'}},commands:{task:{sessionId:'a',commandId:'task',toolApprovals:[{approvalId:'approve-a',taskId:'task',toolName:'pwsh',createdAt:'2026-10-10T00:00:00Z',status:'pending'}]}}};
  reconcileActivity(account);const first=structuredClone(Object.values(account.activity.items)[0]) as any;
  assert.equal(first.actions[0].target.approvalId,'approve-a');first.read=true;
  account.commands.task.toolApprovals[0].status='resolved';account.commands.task.toolApprovals[0].decisionOutcome='rejected';reconcileActivity(account);
  const row=Object.values(account.activity.items)[0] as any;assert.equal(row.id,first.id);assert.equal(row.state,'completed');assert.equal(row.actions.length,1);assert.ok(row.attentionRevision>first.attentionRevision);
  const before=account.activity.sequence;reconcileActivity(account);assert.equal(account.activity.sequence,before);
  removeActivity(account,()=>true);reconcileActivity(account);assert.equal(Object.keys(account.activity.items).length,0);
});

test('native terminal task waits for background effects and shares the IA-3 result activity identity',()=>{
  const account:any={sessions:{a:{origin:'personal-remote'}},commands:{t:{commandId:'t',sessionId:'a',kind:'session.message',state:'accepted_by_dsh',dshTurn:1,toolExecutions:[{state:'completed',jobId:'job',jobState:'running'}]}},
    chatIdentity:{sessionSegments:{a:'seg'},segments:{seg:{chatId:'side'}},chats:{side:{chatId:'side',kind:'side'}}}};
  observeActivityEvents(account,'a',[{seq:0,at:'2026-10-10T01:00:00Z',type:'turn.started',data:{turn:1}},{seq:1,type:'step.completed',data:{}},{seq:2,at:'2026-10-10T01:01:00Z',type:'turn.ended',data:{reason:'completed'}}],2);
  assert.equal(Object.keys(account.activity.items).length,0);account.commands.t.toolExecutions[0].jobState='completed';reconcileActivity(account);
  const first=Object.values(account.activity.items)[0] as any;assert.ok(first.id.startsWith('activity-result-'));assert.equal(first.source.taskId,'t');
  account.chatResults={result:{activityId:first.id,taskId:'t',sourceChatId:'side',sourceRef:{native:{sessionId:'a'}},sourceEventId:'event-source',at:first.at,state:'completed',summary:'结果已核对'}};
  reconcileActivity(account);assert.equal(Object.keys(account.activity.items).length,1);assert.equal(Object.values(account.activity.items)[0].id,first.id);
});

test('activity HTTP snapshots, filtered all-read, version conflicts, restart, native actions and deletion changes',async t=>{
  const f=await startTimelineCandidate({interactive:true,historyCount:0});t.after(()=>f.close());
  assert.equal((await fetch(`${f.origin}/personal/v1/activity`)).status,401);
  await f.recordActivity({key:'pause',type:'memory.paused',title:'记忆已暂停',summary:'测试状态',level:'normal'});
  const initial=await f.request('/activity?limit=1');assert.ok(initial.hasMore);assert.ok(initial.unreadCount>=3);
  const memory=await f.request('/activity?type=memory');assert.equal(memory.items.length,1);
  await assert.rejects(()=>f.request('/activity/read',{requestId:42,through:memory.snapshotCursor}),/INVALID_REQUEST/);
  const readId=randomUUID();await f.request('/activity/read',{requestId:readId,through:memory.snapshotCursor});
  await f.request('/activity/read',{requestId:readId,through:memory.snapshotCursor});
  assert.equal((await f.request('/activity?type=memory')).items[0].read,true);
  assert.ok((await f.request('/activity/unread')).unreadCount>0);
  await assert.rejects(()=>f.request('/activity/read',{requestId:readId,through:initial.snapshotCursor}),/REQUEST_CONFLICT/);
  await f.recordActivity({key:'new',type:'memory.submission.completed',title:'补交完成',summary:'已经同步',level:'silent'});
  const older=await f.request(`/activity?limit=1&cursor=${encodeURIComponent(initial.nextCursor)}`);assert.equal(older.items.some((r:any)=>r.title==='补交完成'),false);
  await f.request('/activity/read',{requestId:randomUUID(),through:initial.snapshotCursor});
  const newRow=(await f.request('/activity?type=memory')).items.find((r:any)=>r.title==='补交完成');assert.equal(newRow.read,false);
  await assert.rejects(()=>f.request(`/activity/${newRow.id}/read`,{requestId:randomUUID(),read:true,attentionRevision:newRow.attentionRevision-1},'PATCH'),/REQUEST_CONFLICT/);
  const approval=(await f.request('/activity?filter=actionable')).items.find((r:any)=>r.type==='approval.pending');assert.ok(approval);
  const action=approval.actions.find((a:any)=>a.kind==='respond_approval');const answer=await f.request(`/sessions/${action.target.sessionId}/approvals/${action.target.approvalId}`,{requestId:'activity-native-approve',outcome:'allowed-once'});
  assert.equal(answer.approval.decisionOutcome,'allowed-once');
  const resolved=(await f.request('/activity')).items.find((r:any)=>r.id===approval.id);assert.equal(resolved.state,'completed');
  const before=(await f.request('/activity')).syncCursor;
  await f.request(`/sessions/${f.sessionId}`,{},'DELETE');
  const delta=await f.request(`/activity/changes?cursor=${encodeURIComponent(before)}`);assert.ok(delta.removals.includes(approval.id));
  assert.equal((await f.request('/activity')).items.some((row:any)=>row.source.sessionId===f.sessionId),false);
  await f.restartWithCloud(null);
  const restored=await f.request('/activity');assert.ok(restored.items.some((r:any)=>r.id===newRow.id));assert.equal(restored.items.some((r:any)=>r.source.sessionId===f.sessionId),false);
  const persisted=JSON.parse(await readFile(join(f.root,'store.json'),'utf8'));assert.equal(Object.keys(persisted.accounts).length,1);
});

test('MEM-D formation pending does not masquerade as pause; model unavailability creates one event per real transition',async t=>{
  let status:any={state:'degraded',reasonCode:'MEMORY_FORMATION_PENDING'};
  const memoryManager={enabled:false,peek:()=>status.state,status:async()=>status,query:async()=>({}),submitCommand:async()=>({}),receiptByRequest:async()=>({}),retryCleanupByRequest:async()=>({})};
  const f=await startTimelineCandidate({interactive:true,historyCount:0,memoryManager});t.after(()=>f.close());
  assert.equal((await f.request('/activity?type=memory')).items.length,0);
  status={state:'degraded',reasonCode:'MEMORY_MODEL_UNAVAILABLE'};
  const paused=(await f.request('/activity?type=memory')).items;assert.equal(paused.length,1);assert.equal(paused[0].type,'memory.paused');
  assert.equal((await f.request('/activity?type=memory')).items.length,1);
  status={state:'degraded',reasonCode:'MEMORY_FORMATION_PENDING'};await f.request('/activity');
  status={state:'unavailable',reasonCode:'MEMORY_MODEL_UNAVAILABLE'};assert.equal((await f.request('/activity?type=memory')).items.length,2);
});
