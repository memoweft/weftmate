import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {timelineCore,progressEvents} from './helpers/fix-36-timeline.mjs';

function approvalCore() {
  const context:any={WeftUiCore:{factories:{}},URL};
  for(const file of ['timeline-model','approvals'])runInNewContext(readFileSync(`src/ui-core/${file}.js`,'utf8'),context);
  const core:any=context.WeftUiCore;
  Object.assign(core,core.factories.approvals(core,{},{}));return core;
}
test('FIX-46 common approvals explain the action and preserve originals in details',()=>{
  const core=approvalCore();
  for(const [toolName,args,expected] of [
    ['write',{file_path:'C:/Downloads/report.md',content:'RAW_FILE_CONTENT'},/写入.*report.md/],
    ['pwsh',{command:'Get-ChildItem -LiteralPath C:/Downloads',description:'列出这个文件夹里的文件'},/^运行一条命令：列出这个文件夹里的文件$/],
    ['list_directory',{path:'C:/Downloads'},/^读取文件夹：Downloads$/],
    ['web_fetch',{url:'https://example.com/private?raw_token=123'},/^访问网页 example.com$/],
  ] as const){
    const reason=`[weftmate:execute] 操作：${toolName}\n${JSON.stringify(args)}`;
    const value=core.approvalPresentation({toolName,reason});
    assert.match(value.summary,expected);assert.equal(value.reason,'');
    assert.doesNotMatch(value.summary,/weftmate:|pwsh|Get-ChildItem|file_path|raw_token|RAW_FILE_CONTENT|[{}]/);
    assert.ok(value.raw.includes(reason));
  }
  const malformed=core.approvalPresentation({toolName:'pwsh',reason:'[weftmate:execute] pwsh\n{"command":"unfinished'});
  assert.equal(malformed.summary,'运行一条命令');assert.equal(malformed.reason,'');
  const historical=core.approvalPresentation({toolName:'shell',reason:'运行命令：npm run release'});
  assert.equal(historical.summary,'运行一条命令');assert.match(historical.raw,/npm run release/);
});
test('FIX-46 a rejected step is never a retry or a completed operation',()=>{
  const core:any=timelineCore(),events=progressEvents('failed');
  const failed=events.find(e=>e.type==='step.completed'&&e.data.state==='failed')!;
  failed.data.toolName='write';failed.data.arguments={file_path:'C:/Downloads/report.md'};
  events.at(-1)!.data.reason='completed';
  const row={approvalId:'rejected-write',sessionId:'synthetic-session',callId:failed.data.callId,turn:1,status:'resolved',outcome:'rejected'};
  const projected=core.nativeTimelineRows(events,[row]).find(r=>r.type==='native.progress');
  assert.match(projected.data.summary,/写入.*report.md.*被你拒绝了/);
  assert.doesNotMatch(projected.data.summary,/重试|换办法|修改了/);
  assert.match(projected.data.steps.find(s=>s.callId===row.callId).summary,/写入.*report.md/);
  assert.equal(projected.data.steps.find(s=>s.callId===row.callId).statusText,'你拒绝了，没有做');
  assert.equal(projected.data.steps.find(s=>s.callId===row.callId).attention,false);
  // Historical event receipts produce the same wording without an approval snapshot.
  events.splice(events.length-2,0,{seq:100,type:'approval.requested',data:{approvalId:row.approvalId,callId:row.callId}},
    {seq:101,type:'approval.resolved',data:{approvalId:row.approvalId,outcome:'rejected'}} as any);
  assert.match(core.nativeTimelineRows(events).find(r=>r.type==='native.progress').data.summary,/写入.*被你拒绝了/);
});

const refused = {toolName:'write',state:'failed',approvalOutcome:'rejected',arguments:{file_path:'report.md'}};
for (const [name,outcome] of [
  ['model error',{terminal:true,reason:'error'}],
  ['output limit',{terminal:true,reason:'error',endReasonKind:'max-tokens'}],
  ['user stop',{terminal:true,reason:'aborted'}],
] as const) test(`FIX-46 refusal preserves the whole reply status: ${name}`,()=>{
  const core:any=timelineCore(),baseline=core.progressText([],outcome),value=core.progressText([refused],outcome);
  assert.match(value.text,/写入.*report.md.*被你拒绝了/);
  assert.ok(value.text.includes(baseline.text),`missing reply status: ${baseline.text}`);
  assert.equal(value.failed,baseline.failed);assert.equal(value.running,baseline.running);
  if(outcome.reason==='error')assert.equal(value.failed,true);
  const rows=core.nativeTimelineRows([
    {seq:0,type:'turn.started',data:{turn:1}},
    {seq:1,type:'step.completed',data:{...refused,taskId:'turn-1',stepId:'refused-1',callId:'refused-1'}},
    {seq:2,type:'turn.ended',data:{turn:1,...outcome}},
  ],[{approvalId:'refused-approval',callId:'refused-1',turn:1,status:'resolved',outcome:'rejected'}]);
  const view=rows.find(row=>row.type==='native.progress').data;
  assert.ok(view.summary.includes(baseline.text));assert.equal(view.failed,!!baseline.failed);
});
test('FIX-46 refusal keeps another failed step and the reply failure marker',()=>{
  const core:any=timelineCore(),other={toolName:'web_fetch',state:'failed',summary:'读取网页'},outcome={terminal:true,reason:'error'};
  const baseline=core.progressText([other],outcome),value=core.progressText([refused,other],outcome);
  assert.match(value.text,/写入.*report.md.*被你拒绝了/);
  assert.ok(value.text.includes(baseline.text));assert.equal(value.failed,true);
  assert.equal(core.classifyProgress([refused,other],outcome).retries,1);
});
