import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function context() {
  const f:any = { WeftUiCore:{factories:{}} }; f.window=f;
  for(const file of ['timeline-model','messages','tasks'])
    runInNewContext(readFileSync(`src/ui-core/${file}.js`,'utf8'),f);
  return f;
}
test('#670 one stable process exists before thinking, tools or answer arrive',()=>{
  const f=context(), events:any[]=[{seq:0,type:'turn.started',data:{turn:1}}, {seq:1,type:'user.message',data:{text:'123'}}];
  const first=f.WeftUiCore.projectTimeline(events,[],true).groups;
  assert.equal(first.length,1);
  const position=f.WeftUiCore.progressPosition(events,first[0],true);
  events.push({seq:2,type:'step.started',data:{taskId:'turn-1',stepId:'read',toolName:'read',state:'running'}});
  const running=f.WeftUiCore.projectTimeline(events,[],true).groups;
  assert.equal(running.length,1); assert.equal(running[0].seq,first[0].seq);
  assert.equal(f.WeftUiCore.progressPosition(events,running[0],true),position);
  events.push({seq:3,type:'assistant.message',data:{text:'合成回答。'}},{seq:4,type:'turn.ended',data:{turn:1,reason:'completed'}});
  const ended=f.WeftUiCore.projectTimeline(events,[],true).groups;
  assert.equal(ended.length,1); assert.equal(ended[0].seq,first[0].seq);
  assert.equal(f.WeftUiCore.progressPosition(events,ended[0],true),position);
});
test('#671 stopped state belongs to the process, without a second instruction paragraph',()=>{
  const f=context(),core:any={state:{activeChatSource:'desktop',turnStatus:'aborted',historyHasMore:false,historyEvents:new Map()},taskStopView:()=>({terminal:true,text:'已停止'})};
  const messages=f.WeftUiCore.factories.messages(core,{},{});
  assert.equal(messages.turnStatusViewModel().message,'');
  const tasks=f.WeftUiCore.factories.tasks(core,{},{});
  assert.equal(tasks.taskControlStatus({state:'stop_requested',stopStatus:'completed'}),'已结束');
});
