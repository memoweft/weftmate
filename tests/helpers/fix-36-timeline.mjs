import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
export function timelineCore() {
  const context={WeftUiCore:{factories:{}},URL};
  runInNewContext(readFileSync(new URL('../../src/ui-core/timeline-model.js',import.meta.url),'utf8'),context);
  return context.WeftUiCore;
}
export function progressEvents(mode='completed',session='synthetic-session',turn=1) {
  const events=[],at='2026-10-14T05:20:00.000Z',taskId=`turn-${turn}`;
  const add=(type,data)=>events.push({eventId:`${session}:${events.length+1}`,seq:events.length+1,type,at,sessionId:session,sourceRef:{sessionId:session,seq:events.length+1},data});
  add('user.message',{text:'现在几点？顺便查一下今天的日历和健康记录。'});
  add('turn.started',{turn});
  const names=['load_tools','load_tools','mcp__health__health_query','mcp__calendar__calendar_list_events','mcp__clock__read_local_time','unknown_extension','load_tools','load_tools','weftmod_script','unknown_extension','weftmod_script','mcp__mail__mail_read'];
  names.forEach((toolName,index)=>{
    const data={taskId,stepId:`step-${index}`,callId:`step-${index}`,toolName,summary:toolName==='load_tools'?'准备可用工具':'调用扩展服务',state:'running'};
    add('step.started',data);
    if(mode==='approval' && index===names.length-1) add('approval.requested',{taskId,callId:data.callId,approvalId:'synthetic-approval'});
    if(index!==names.length-1 || !['running','approval'].includes(mode)) add('step.completed',{...data,state:mode==='failed'&&index===8?'failed':'completed'});
  });
  if(!['running','approval'].includes(mode)) {
    add('assistant.message',{text:'现在是下午 1 点 20 分。今天有一项日程，健康记录已查到。',turn,taskId});
    add('turn.ended',{turn,reason:mode==='failed'?'error':'completed'});
  }
  return events;
}
