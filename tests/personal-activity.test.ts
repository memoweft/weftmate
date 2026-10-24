import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startTimelineCandidate } from './integration/bl29-rework/fixture.mjs';
import { activityState, putActivity, reconcileActivity, activityToken, readActivityToken, removeActivity } from '../src/personal-access/activity-store.mjs';
import { observeActivityEvents } from '../src/personal-access/activity.mjs';
import { eraseChatCopies } from '../src/personal-access/chat-erasure.mjs';
import { completionActivitySummary, activitySummaryEvent } from '../src/personal-access/activity-copy.mjs';

test('FIX-43 review preserves ratios and dates while shortening real file paths in completed activity',async t=>{
  const f=await startTimelineCandidate({inlineProgress:true,historyCount:0});t.after(()=>f.close());
  f.progress.call('write','fix43-ratios',{path:'C:/project/report.md'});f.progress.result('fix43-ratios','saved');
  f.progress.text('测试结果：12/15 通过。日期：2026/10/14。代码示例：`12/15`、`2026/10/14`。保存 `C:/project/report.md`、`./reports/local.md`、`../reports/parent.md`、`~/reports/home.md` 和 reports/plain.md。');
  f.progress.finish();
  const row=(await f.request('/activity?type=task')).items.find((item:any)=>item.type==='task.completed');
  assert.match(row.summary,/测试结果：12\/15 通过。/);assert.match(row.summary,/日期：2026\/10\/14。/);
  assert.match(row.summary,/代码示例：12\/15、2026\/10\/14。/);
  for(const name of ['report.md','local.md','parent.md','home.md','plain.md'])assert.ok(row.summary.includes(name),name);
  assert.doesNotMatch(row.summary,/C:\/project|\.\/reports|~\/reports|reports\/plain/);
});

test('FIX-43 review preserves literal file names through native observation, persistence and all activity responses',async t=>{
  const account:any={sessions:{s:{origin:'personal-remote'}},commands:{}};
  observeActivityEvents(account,'s',[{seq:0,type:'turn.started',data:{turn:1}},{seq:1,type:'step.completed',data:{}},
    {seq:2,type:'assistant.message',data:{text:'保存了 `C:/project/__init__.py` 和 `C:/project/_notes_.md`。'}},
    {seq:3,type:'turn.ended',at:'2026-10-14T10:00:00Z',data:{reason:'completed'}}],3);
  assert.equal((Object.values(account.activity.items)[0] as any).summary,'保存了 __init__.py 和 _notes_.md。');
  const f=await startTimelineCandidate({inlineProgress:true,historyCount:0});t.after(()=>f.close());
  f.progress.call('write','fix43-filename',{path:'C:/project/__init__.py'});f.progress.result('fix43-filename','saved');
  f.progress.text('保存了 `C:/project/__init__.py` 和 `C:/project/_notes_.md`。');f.progress.finish();
  const row=(await f.request('/activity?type=task')).items.find((item:any)=>item.type==='task.completed');
  assert.equal(row.summary,'保存了 __init__.py 和 _notes_.md。');
  assert.equal(Object.hasOwn(row,'summaryFormat'),false);
  const stored=JSON.parse(await readFile(join(f.root,'store.json'),'utf8'));
  assert.equal(Object.values(stored.accounts).flatMap((item:any)=>Object.values(item.activity.items)).find((item:any)=>item.id===row.id).summary,row.summary);
  const delta=(await f.request('/activity/changes')).upserts.find((item:any)=>item.id===row.id);assert.equal(delta.summary,row.summary);
  const read=await f.request(`/activity/${row.id}/read`,{requestId:'fix43-filename-read',read:true,attentionRevision:row.attentionRevision},'PATCH');assert.equal(read.item.summary,row.summary);
});

test('FIX-43 completion receipt becomes readable activity copy before truncation',async t=>{
  const f=await startTimelineCandidate({goals:true,inlineProgress:true,historyCount:0});t.after(()=>f.close());
  const created=await f.request('/goals',{requestId:'fix43-create',sessionId:f.sessionId,title:'整理周报'});
  await f.request(`/goals/${f.sessionId}/complete`,{requestId:'fix43-complete',ref:created.ref});
  const receipt='goal revision 2, phase: complete, disarmed';
  f.progress.call('update_goal','fix43-goal',{id:created.ref.id,revision:1,phase:'complete'});
  f.progress.result('fix43-goal',receipt);
  f.progress.text(`${(receipt+'\n').repeat(110)}\n## 目标「整理周报」已完成\n- **核对了 3 份资料**\n- 保存了 [周报](file:///C:/Temp/weekly/report.md) 和 \`C:/Temp/weekly/summary.txt\`。`);
  f.progress.finish();
  const row=(await f.request('/activity?type=task')).items.find((item:any)=>item.type==='task.completed');
  assert.ok(row);
  assert.doesNotMatch(row.summary,/goal revision|phase\s*:|disarmed|\*\*|##|`|C:\\|file:\/\/|\[周报\]/i);
  assert.match(row.summary,/目标「整理周报」已完成/);
  assert.match(row.summary,/核对了 3 份资料/);
  assert.match(row.summary,/report\.md/);
  assert.match(row.summary,/summary\.txt/);
  assert.equal((await f.request('/goals')).items[0].phase,'complete');
  assert.equal(row.actions[0].kind,'open_chat');
  const history=(await f.request(`/sessions/${f.sessionId}/events`)).events.findLast((event:any)=>event.type==='assistant.message');
  const detail=await f.request(`/sessions/${f.sessionId}/events/${history.seq}/detail`);
  assert.match(detail.text,/goal revision 2, phase: complete, disarmed/);
  assert.match(detail.text,/C:\/Temp\/weekly\/summary.txt/);
});

test('FIX-43 plain completion copy preserves outcomes, file names and web sources across Markdown forms',()=>{
  const raw='## 目标「整理报告」已完成（goal revision 2, phase: complete, disarmed）。\n'+
    '```json\n{"goal":{"id":"native-goal","revision":2,"phase":"complete","activation":"disarmed"}}\n```\n'+
    '- [x] **核对资料**\n- 保存 `C:\\Temp\\Weekly Report.md`、`\\\\host\\share\\notes.txt`、输出/report.csv 和 [报告](file:///tmp/report.md)。\n'+
    '见 [资料](https://example.com/docs/phase)。';
  const copy=completionActivitySummary(raw);
  assert.match(copy,/目标「整理报告」已完成。/);assert.match(copy,/核对资料/);
  for(const name of ['Weekly Report.md','notes.txt','report.csv','报告（report.md）','资料'])assert.ok(copy.includes(name),name);
  assert.doesNotMatch(copy,/revision|phase:|activation|disarmed|native-goal|C:\\|host|share|输出\/|\*|`|\[x\]|```/);
  assert.equal(completionActivitySummary('goal revision 2, phase: complete, disarmed'),'已完成，打开对话查看结果。');
  assert.equal(completionActivitySummary('已保存报告。{"goal":{"id":"native-goal","revision":2,"phase":"complete","activation":"disarmed"}}'),'已保存报告。');
  assert.equal(completionActivitySummary('修复了 phase parser，见 https://example.com/docs/phase。'),'修复了 phase parser，见 https://example.com/docs/phase。');
});

test('FIX-43 truncated summary uses existing details and skips private or forgotten events',async()=>{
  let reads=0;const account:any={sessions:{s:{}}},event={seq:3,type:'assistant.message',data:{text:'保存 [local path]',truncated:true}};
  const context:any={accountState:()=>account,callBackend:(work:any)=>work(),backend:{readEventDetail:async()=>{reads++;return {type:'assistant.message',text:'已保存 `C:/Temp/report.md`。'};}}};
  const summary=await activitySummaryEvent(context,'owner','s',event);
  assert.equal(summary.data.text,'已保存 `C:/Temp/report.md`。');
  account.sessions.s.temporary=true;assert.equal(await activitySummaryEvent(context,'owner','s',event),event);
  delete account.sessions.s.temporary;account.sessions.s.forgottenSeqs=[3];assert.equal(await activitySummaryEvent(context,'owner','s',event),event);
  assert.equal(reads,1);
});

test('FIX-43 stored completion copy is cleaned in snapshot, delta and read response without changing receipts',async t=>{
  const f=await startTimelineCandidate({inlineProgress:true,historyCount:0});t.after(()=>f.close());
  const context=f.debug.service.__reviewContext,raw='**已完成**（goal revision 2, phase: complete, disarmed）：保存 `/tmp/work/report.md`。';
  await context.serial(()=>context.mutate(f.debug.auth.account.ownerId,(account:any)=>{
    const row=putActivity(account,'fix43-legacy',{type:'task.completed',title:'任务完成',summary:'占位',at:new Date().toISOString(),source:{sessionId:f.sessionId},actions:[]});
    row.summary=raw;delete row.summaryFormat;
  }));
  const row=(await f.request('/activity?type=task')).items.find((item:any)=>item.summary.includes('report.md'));
  assert.equal(row.summary,'已完成：保存 report.md。');
  const delta=(await f.request('/activity/changes')).upserts.find((item:any)=>item.id===row.id);
  assert.equal(delta.summary,row.summary);
  const read=await f.request(`/activity/${row.id}/read`,{requestId:'fix43-read',read:true,attentionRevision:row.attentionRevision},'PATCH');
  assert.equal(read.item.summary,row.summary);
});

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
  // A startup activity flight may have sampled listUserQuestions before the
  // fixture exposes its completed question frame. Commit that native frame
  // through the real read path before asserting approval + question + memory.
  await f.request(`/sessions/${f.sessionId}/questions`);
  await f.recordActivity({key:'pause',type:'memory.paused',title:'记忆已暂停',summary:'测试状态',level:'normal'});
  const initial=await f.request('/activity?limit=1');assert.ok(initial.hasMore);assert.ok(initial.unreadCount>=2);
  const memory=await f.request('/activity?type=memory');assert.equal(memory.items.length,1);assert.equal(memory.items[0].read,true);
  await assert.rejects(()=>f.request('/activity/read',{requestId:42,through:memory.snapshotCursor}),/INVALID_REQUEST/);
  const readId=randomUUID();await f.request('/activity/read',{requestId:readId,through:memory.snapshotCursor});
  await f.request('/activity/read',{requestId:readId,through:memory.snapshotCursor});
  assert.equal((await f.request('/activity?type=memory')).items[0].read,true);
  assert.ok((await f.request('/activity/unread')).unreadCount>0);
  await assert.rejects(()=>f.request('/activity/read',{requestId:readId,through:initial.snapshotCursor}),/REQUEST_CONFLICT/);
  await f.recordActivity({key:'new',type:'memory.submission.completed',title:'补交完成',summary:'已经同步',level:'silent'});
  const older=await f.request(`/activity?limit=1&cursor=${encodeURIComponent(initial.nextCursor)}`);assert.equal(older.items.some((r:any)=>r.title==='补交完成'),false);
  await f.request('/activity/read',{requestId:randomUUID(),through:initial.snapshotCursor});
  const newRow=(await f.request('/activity?type=memory')).items.find((r:any)=>r.title==='补交完成');assert.equal(newRow.read,true);
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
  await f.debug.service.__reviewContext.activity.close();
  assert.equal((await f.request('/activity?type=memory')).items.length,0);
  status={state:'degraded',reasonCode:'MEMORY_MODEL_UNAVAILABLE'};
  const paused=(await f.request('/activity?type=memory')).items;assert.equal(paused.length,1);assert.equal(paused[0].type,'memory.paused');
  assert.equal((await f.request('/activity?type=memory')).items.length,1);
  status={state:'degraded',reasonCode:'MEMORY_FORMATION_PENDING'};await f.request('/activity');
  status={state:'unavailable',reasonCode:'MEMORY_MODEL_UNAVAILABLE'};assert.equal((await f.request('/activity?type=memory')).items.length,2);
});


test('FX-18 recovered memory appears as one quiet progress event and completes without a pause',async t=>{
  let status:any={state:'recovering',reasonCode:'MEMORY_FORMATION_RECOVERING'};
  const memoryManager={enabled:false,peek:()=>status.state,status:async()=>status,query:async()=>({}),submitCommand:async()=>({}),receiptByRequest:async()=>({}),retryCleanupByRequest:async()=>({})};
  const f=await startTimelineCandidate({interactive:true,historyCount:0,memoryManager});t.after(()=>f.close());
  const rows=(await f.request('/activity?type=memory')).items;
  assert.equal(rows.length,1);assert.equal(rows[0].title,'正在继续整理上次没做完的记忆');
  assert.equal(rows[0].state,'completed');assert.equal(rows[0].notification.level,'silent');
  assert.equal((await f.request('/activity?type=memory')).items.length,1);
  status={state:'ready'};
  const complete=(await f.request('/activity?type=memory')).items;
  assert.equal(complete.length,1);assert.equal(complete[0].id,rows[0].id);
  assert.equal(complete[0].title,'上次没做完的记忆已整理完成');assert.equal(complete[0].state,'completed');
});
