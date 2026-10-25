import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function fixture() {
  const context: any = { window: {}, WeftUiCore: { factories: {} } };
  context.window = context;
  for (const file of ['src/ui-core/timeline-model.js', 'src/ui-core/tasks.js', 'src/personal-access-ui/timeline.js'])
    runInNewContext(readFileSync(file, 'utf8'), context);
  return context;
}
test('#643 #637 thinking joins chronological steps before the answer with a stable stream identity', () => {
  const f = fixture();
  const events = [{seq:0,type:'turn.started',data:{turn:1}},
    {seq:1,type:'assistant.message',data:{streamSeq:1,text:'',modelThinking:'先核对资料。再比较结果。',thinkingActive:true}},
    {seq:2,type:'step.completed',data:{taskId:'turn-1',stepId:'read',toolName:'read',state:'completed'}}];
  const prepared = f.WeftTimeline.prepare(events);
  const groups = f.WeftUiCore.projectTimeline(prepared).groups;
  assert.equal(groups.length, 1);
  assert.equal(groups[0].steps[0].modelThinking, events[1].data.modelThinking);
  assert.equal(groups[0].steps[0].summary, '思考过程');
  assert.equal(groups[0].steps[0].modelThinking, '先核对资料。再比较结果。');
  const final = f.WeftTimeline.prepare(events.map(e => e.seq === 1 ? {...e, seq:4, data:{...e.data,text:'答案',thinkingActive:false,thinkingMs:2000}} : e));
  assert.equal(final.find(e=>e.data?.modelThinking && e.type.startsWith('step.')).data.stepId, groups[0].steps[0].stepId);
  assert.equal(final.find(e=>e.type==='assistant.message').data.text, '答案');
  assert.equal(f.WeftTimeline.prepare(events, 'hidden').some(e=>e.data?.toolName==='__thinking'), false);
});
test('#641 idle inbox acceptance is not a queue card; a message behind an active reply is', () => {
  const f = fixture(), core: any = {state:{ownerId:'synthetic',identityGeneration:1,tasks:[]},conversationTaskContext:()=>({sessionId:'s'})};
  const api = f.WeftUiCore.factories.tasks(core, {}, {});
  const queued = (seq, id) => ({seq,type:'task.queued',data:{taskId:id,text:id}});
  assert.equal(api.taskQueue([queued(0,'first')])[0].queued, false);
  const rows = api.taskQueue([queued(0,'first'),queued(1,'second')]);
  assert.equal(rows[0].queued, false);
  assert.equal(rows[1].queued, true);
  assert.equal(api.taskQueue([{seq:0,type:'turn.started'},queued(1,'next')])[0].queued, true);
  assert.equal(api.taskQueue([{seq:0,type:'turn.started'},queued(1,'cancelled'),
    {seq:2,type:'task.ended',data:{taskId:'cancelled',reason:'canceled'}},queued(3,'next')])[1].queued, true);
  assert.equal(api.taskQueue([{seq:0,type:'turn.started'},{seq:1,type:'turn.ended'},queued(2,'idle')])[0].queued, false);
});

test('reply actions belong only to the final answer of each turn, never interim commentary', () => {
  const f = fixture(), finalReply = f.WeftTimeline.isFinalReply;
  const event = (seq,type,text='') => ({seq,type,data:{text}});
  const commentary=event(1,'assistant.message','目录已经找到，接着核对用法。'),answer=event(3,'assistant.message','最终答案');
  const history=[event(0,'turn.started'),commentary,event(2,'step.completed'),answer,event(4,'turn.ended')];
  assert.equal(finalReply(history,commentary),false);
  assert.equal(finalReply(history,answer),true);
  assert.equal(finalReply(history.slice(0,2),commentary,true),false);
  assert.equal(finalReply([...history,event(5,'turn.started')],answer,true),true);
  const legacy=[event(0,'user.message','第一个问题'),commentary,event(2,'user.message','第二个问题'),answer];
  assert.equal(finalReply(legacy,commentary),true,'older message-only history retains each turn final reply');
  assert.equal(finalReply(history,{...commentary,data:{text:'独立提醒',reminder:true}},true),true);
});
