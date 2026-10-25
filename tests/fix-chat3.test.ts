import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function timeline() {
  const context:any={WeftUiCore:{factories:{}}};context.window=context;
  for(const file of ['src/ui-core/timeline-model.js','src/personal-access-ui/timeline.js'])
    runInNewContext(readFileSync(file,'utf8'),context);
  return context;
}
test('#660 one process per turn contains thinking, interim prose and steps before the answer',()=>{
  const f=timeline(), events=[
    {seq:0,type:'turn.started',data:{turn:1}},
    {seq:1,type:'user.message',data:{text:'整理资料'}},
    {seq:2,type:'assistant.message',data:{text:'先核对资料。',modelThinking:'Now read the file.'}},
    {seq:3,type:'step.completed',data:{taskId:'turn-1',stepId:'read',toolName:'read',summary:'Read file'}},
    {seq:4,type:'assistant.message',data:{text:'已经找到，接着整理。'}},
    {seq:5,type:'step.completed',data:{taskId:'turn-1',stepId:'write',toolName:'write'}},
    {seq:6,type:'assistant.message',data:{text:'这是正式回答。',memoryUsed:[{id:'synthetic'}]}},
    {seq:7,type:'turn.ended',data:{turn:1,reason:'completed'}},
  ];
  const prepared=f.WeftTimeline.prepare(events), p=f.WeftUiCore.projectTimeline(prepared,[],true);
  assert.equal(p.groups.length,1);
  assert.deepEqual(Array.from(p.cards.filter(e=>e.type==='assistant.message'),e=>e.data.text),['这是正式回答。']);
  assert.equal(p.groups[0].steps.filter(s=>s.toolName==='__progress').length,2);
  assert.equal(p.groups[0].steps.find(s=>s.toolName==='__thinking').summary,'思考过程');
  assert.ok(f.WeftUiCore.progressPosition(prepared,p.groups[0],true)<6);
  assert.equal(f.WeftTimeline.prepare([{seq:1,type:'assistant.message',data:{text:''}}]).length,0);
});
test('#660 refusal copy names the action without repeating an internal approval question',()=>{
  const f=timeline(), result=f.WeftUiCore.progressText([{toolName:'write',approvalOutcome:'rejected',approvalSummary:'这件事需要在电脑上做。要切换到工作吗？'}],{terminal:true,reason:'completed'});
  assert.equal(result.text,'写入文件被你拒绝了');
});
test('#660 English interim reasoning stays behind the thinking disclosure in a Chinese turn',()=>{
  const f=timeline(),events=[{seq:0,type:'turn.started',data:{turn:1}},
    {seq:1,type:'user.message',data:{text:'请整理资料。'}},
    {seq:2,type:'assistant.message',data:{text:'Now write the file.'}},
    {seq:3,type:'step.completed',data:{taskId:'turn-1',stepId:'write',toolName:'write'}},
    {seq:4,type:'assistant.message',data:{text:'已经整理好了。'}}];
  const prepared=f.WeftTimeline.prepare(events);
  assert.equal(prepared.some(e=>e.data?.toolName==='__progress' && /Now write/.test(e.data.progressText)),false);
  assert.equal(prepared.find(e=>e.data?.modelThinking==='Now write the file.').data.summary,'思考过程');
});
test('#660 late tool completion stays above the final reply rather than swallowing it',()=>{
  const f=timeline(),events=[{seq:0,type:'turn.started',data:{turn:1}},
    {seq:1,type:'user.message',data:{text:'查一下天气。'}},
    {seq:2,type:'assistant.message',data:{text:'今天多云。'}},
    {seq:3,type:'step.completed',data:{taskId:'turn-1',stepId:'weather',toolName:'web_fetch'}},
    {seq:4,type:'turn.ended',data:{turn:1,reason:'completed'}}];
  const prepared=f.WeftTimeline.prepare(events),projected=f.WeftUiCore.projectTimeline(prepared,[],true);
  assert.equal(prepared.find(e=>e.type==='assistant.message')?.data.text,'今天多云。');
  assert.ok(f.WeftUiCore.progressPosition(prepared,projected.groups[0],true)<2);
  assert.equal(f.WeftTimeline.isFinalReply(events,events[2]),true);
});
test('#660 artifact completion updates its existing process step and result reference',()=>{
  const f=timeline(),events=[{seq:0,type:'turn.started',data:{turn:1}},
    {seq:1,type:'step.started',data:{taskId:'turn-1',stepId:'write',toolName:'write',state:'running',detailRef:{seq:1}}},
    {seq:2,type:'artifact.created',data:{artifactId:'file-one',completedStep:{taskId:'turn-1',stepId:'write',toolName:'write',state:'completed',detailRef:{seq:2}}}},
    {seq:3,type:'turn.ended',data:{turn:1,reason:'completed'}}];
  const block=f.WeftUiCore.projectTimeline(events,[],true).groups[0];
  const selected=f.WeftUiCore.progressEvents(events,block);
  const step=f.WeftUiCore.projectTimeline(selected,[],true).groups[0].steps[0];
  assert.equal(step.state,'completed');assert.equal(step.detailRef.seq,2);
});
test('legacy messages without a native turn boundary keep their separate answer bodies',()=>{
  const f=timeline(),events=[{seq:1,type:'step.completed',data:{taskId:'turn-1',stepId:'read',toolName:'read'}},
    {seq:2,type:'assistant.message',data:{text:'第一段报告。'}},{seq:3,type:'assistant.message',data:{text:'下一段报告。'}}];
  assert.equal(f.WeftTimeline.prepare(events).filter(e=>e.type==='assistant.message').length,2);
});
test('#660 receipt task events do not split commentary from the native turn steps',()=>{
  const f=timeline(),events=[{seq:0,type:'turn.started',data:{turn:1}},
    {seq:1,type:'task.started',data:{taskId:'command-one',turn:1}},
    {seq:2,type:'assistant.message',data:{text:'先读取资料。'}},
    {seq:3,type:'step.completed',data:{taskId:'turn-1',stepId:'read',toolName:'read',state:'completed'}},
    {seq:4,type:'assistant.message',data:{text:'资料已经整理好了。'}},{seq:5,type:'turn.ended',data:{turn:1,reason:'completed'}}];
  const p=f.WeftUiCore.projectTimeline(f.WeftTimeline.prepare(events),[],true);
  assert.equal(p.groups.length,1);assert.equal(p.groups[0].steps.length,2);
});
