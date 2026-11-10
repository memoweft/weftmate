// 保护：创建会话不等于接续请求；恢复交接不重复执行，迟到结果不跳走当前对话。
import test from 'node:test';
import assert from 'node:assert/strict';
import {workHandoffs} from '../src/personal-access/work-and-chat.mjs';
(globalThis as any).WeftUiCore ??= {factories:{}};
await import('../src/ui-core/work-and-chat.js');

const row={approvalId:'approval-a',sessionId:'source',workSessionId:'work',workCreateCommandId:'create',
  workProjectId:'project',decisionRequestId:'decision',decisionOutcome:'allowed-once',intent:'work-switch',createdAt:'2026-10-31'};
function account(create='accepted_by_dsh',message?:string) {
  return {sessions:{source:{},work:{}},commands:{source:{toolApprovals:[{...row,...(message?{workCommandId:'message'}:{})}]},
    create:{state:create},...(message?{message:{state:message}}:{})}};
}
test('persistent projections distinguish creation, context, delivery and uncertainty',()=>{
  assert.deepEqual([account('pending'),account(),account('accepted_by_dsh','pending'),account('accepted_by_dsh','accepted_by_dsh'),account('accepted_by_dsh','uncertain')]
    .map(a=>workHandoffs(a,'source')[0].stage),['creating','context','sending','ready','uncertain']);
  assert.equal(workHandoffs(account(),'work')[0].direction,'incoming');
});
test('a different account or deleted source cannot expose a handoff; deleted work is not openable',()=>{
  const original=account(),removed={...original,sessions:{source:{}}};
  assert.deepEqual(workHandoffs({...original,sessions:{work:{}}},'work'),[]);
  assert.deepEqual(workHandoffs({sessions:{},commands:{}},'source'),[]);
  assert.equal(workHandoffs(removed,'source')[0].workExists,false);
});
test('logical conversation rollover retains the handoff and points navigation at the active segment',()=>{
  const a:any=account('accepted_by_dsh','accepted_by_dsh');workHandoffs(a,'source');
  const shifted={...a,sessions:{...a.sessions,next:{}},chatIdentity:{sessionSegments:{source:'old'},
    segments:{old:{chatId:'chat',sessionId:'source'},current:{chatId:'chat',sessionId:'next'}},chats:{chat:{activeSegmentId:'current'}}}};
  assert.equal(workHandoffs(shifted,'next')[0].sourceSessionId,'source');
  assert.equal(workHandoffs(shifted,'work')[0].sourceActiveSessionId,'next');
});
function fixture(stages=['ready']) {
  const context:any={ownerId:'owner',identity:1,deviceId:'device',source:'desktop',sessionId:'source',conversationId:'chat'};
  const transfer={...row,sourceSessionId:'source',direction:'outgoing',workExists:true,stage:'context'};
  let draft='', reads=0,selectionBlock;
  const actions:any[]=[],state:any={personalCapabilities:{workAndChat:1},activeChatSource:'desktop',selectedSessionId:'source',
    sessions:[{sessionId:'source',workHandoffs:[transfer]}]};
  const core:any={state,composerState:()=>({}),startNewConversation(){},sendDraft(){},clearSession(){},
    approvalContext:()=>({...context}),failureMessage:()=> '连接暂时不可用',
    submitApproval:async()=>{actions.push('approve');return {approval:row};},
    refreshSessions:async()=>{},
    accessApi:async(path,input)=>{if(!input){transfer.stage=stages[Math.min(reads++,stages.length-1)];actions.push(transfer.stage);return {chat:{activeSessionId:'source',workHandoffs:[transfer]}};}actions.push({path,input});return {approval:row};},
    selectSession:async(id)=>{if(selectionBlock)await selectionBlock;actions.push({selected:id,stage:transfer.stage});state.selectedSessionId=id;context.sessionId=id;}};
  Object.assign(core,(globalThis as any).WeftUiCore.factories.workAndChat(core,{paintWorkMode(){},readMessageDraft:()=>draft,toast(){}},{}));
  return {core,context,transfer,actions,setDraft:(value:string)=>draft=value,blockSelection:(promise)=>selectionBlock=promise};
}
test('work navigation waits for the original message receipt, not merely creation',async()=>{
  const f=fixture(['context','sending','ready']);await f.core.switchConversationWork({...f.context},row,'project');
  assert.deepEqual(f.actions,['approve','context','sending','ready',{selected:'work',stage:'ready'}]);
});
test('a reopened handoff reuses its persisted approval identity and concurrent retries share one attempt',async()=>{
  const f=fixture(['context','ready']);await Promise.all([f.core.resumeWorkHandoff(f.transfer),f.core.resumeWorkHandoff(f.transfer)]);
  const requests=f.actions.filter(x=>x.input);
  assert.equal(requests.length,1);
  assert.deepEqual(requests[0].input.body,{requestId:'decision',outcome:'allowed-once',workProjectId:'project'});
  assert.equal(f.actions.filter(x=>x.selected).length,1);
});
test('changing account while refreshing cannot navigate or replay the old decision',async()=>{
  const f=fixture();let release;f.core.accessApi=()=>new Promise(resolve=>release=resolve);
  const pending=f.core.resumeWorkHandoff(f.transfer);f.context.identity=2;release({chat:{activeSessionId:'source',workHandoffs:[f.transfer]}});await pending;
  assert.deepEqual(f.actions,[]);
});
test('editing a fresh draft during handoff retains the current conversation',async()=>{
  const f=fixture();const refresh=f.core.refreshSessions;
  f.core.refreshSessions=async()=>{await refresh();f.setDraft('新的问题');};
  await f.core.switchConversationWork({...f.context},row,'project');
  assert.equal(f.actions.filter(x=>x.selected).length,0);
  assert.equal(f.core.workHandoffs()[0].stage,'ready');
});
test('an uncertain delivery is checked without replaying or automatically opening work',async()=>{
  const f=fixture(['uncertain']);await f.core.resumeWorkHandoff(f.transfer);
  assert.equal(f.actions.filter(x=>x.input||x.selected).length,0);
  assert.equal(f.core.workHandoffs()[0].stage,'uncertain');
});
test('a deleted handoff cannot be opened through a stale button',async()=>{
  const f=fixture();f.core.accessApi=async()=>({chat:{activeSessionId:'source',workHandoffs:[]}});
  await assert.rejects(f.core.openWorkHandoff(f.transfer),{code:'SOURCE_UNAVAILABLE'});
  assert.equal(f.actions.filter(x=>x.selected).length,0);
});
test('history refresh does not create another transfer operation for the same approval',async()=>{
  const f=fixture(['context','ready']),request=f.core.accessApi;f.context.history=1;
  f.core.accessApi=async(...args)=>{f.context.history++;return request(...args);};
  await Promise.all([f.core.resumeWorkHandoff(f.transfer),f.core.resumeWorkHandoff(f.transfer)]);
  assert.equal(f.actions.filter(x=>x.input).length,1);
});
test('leaving and returning to the same conversation cancels the old automatic navigation',async()=>{
  const f=fixture();let release;f.core.accessApi=()=>new Promise(resolve=>release=resolve);
  const pending=f.core.resumeWorkHandoff(f.transfer);
  await f.core.selectSession('other');await f.core.selectSession('source');
  release({chat:{activeSessionId:'source',workHandoffs:[{...f.transfer,stage:'ready'}]}});await pending;
  assert.deepEqual(f.actions.filter(x=>x.selected).map(x=>x.selected),['other','source']);
  assert.equal(f.actions.filter(x=>x.input).length,0);
});
test('choosing a still-loading conversation cancels a pending handoff before session identity changes',async()=>{
  const f=fixture();let release,finishSelection;f.core.accessApi=()=>new Promise(resolve=>release=resolve);
  const pending=f.core.resumeWorkHandoff(f.transfer);
  f.blockSelection(new Promise(resolve=>finishSelection=resolve));const selecting=f.core.selectSession('loading');
  release({chat:{activeSessionId:'source',workHandoffs:[{...f.transfer,stage:'ready'}]}});await pending;
  assert.equal(f.actions.filter(x=>x.input||x.selected).length,0);
  finishSelection();await selecting;
  assert.deepEqual(f.actions.filter(x=>x.selected).map(x=>x.selected),['loading']);
});
