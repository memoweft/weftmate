import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
const context:any={WeftUiCore:{factories:{}}};runInNewContext(readFileSync('src/ui-core/timeline-model.js','utf8'),context);
const api=context.WeftUiCore, plain=(value:any)=>JSON.parse(JSON.stringify(value));
const failed={stepId:'search',toolName:'grep',ordinal:17,state:'failed',summary:'搜索资料',exitCode:1};
const done={stepId:'write',toolName:'write',state:'completed',summary:'写入报告'};
const complete={terminal:true,reason:'completed'};
test('UX-3 completed rounds preserve each failed attempt without failing the whole reply',()=>{
 for(const steps of [[failed,done],[done,failed],[{...failed,endReasonKind:'timeout'},done]]){
  const copy=JSON.stringify(steps),view=api.progressText(steps,complete);
  assert.equal(view.failed,undefined);assert.equal(view.running,false);assert.match(view.text,/中途有 1 步重试/);
  assert.equal(api.stepPresentation(steps.find(s=>s.state==='failed'),complete).state,'failed');assert.equal(JSON.stringify(steps),copy);
 }
});
test('UX-3 user interrupt and assistant termination before rerun take precedence over failed state',()=>{
 for(const step of [{...failed,jobState:'killed'},{...failed,reason:'interrupted'},{...failed,signal:'SIGINT'},{...failed,exitCode:130},{...failed,interrupted:true}]){
  assert.equal(api.executionState(step),'cancelled');assert.equal(api.stepPresentation(step,complete).statusText,'已中断');
  assert.equal(api.progressText([step,done],complete).failed,undefined);
 }
 assert.equal(api.progressText([failed],{terminal:true,reason:'aborted'}).text,'已中断');
 assert.equal(api.interruptionFromDetail(JSON.stringify({arguments:{command:'echo SIGINT'},output:'normal'})),false);
 assert.equal(api.interruptionFromDetail(JSON.stringify({output:'Command interrupted by user (SIGINT)'})),true);
});
test('UX-3 only terminal error or blocked round gets an actionable failure',()=>{
 for(const reason of ['error','failed','blocked'])for(const steps of [[done,failed],[]]){
  const view=api.progressText(steps,{terminal:true,reason});assert.equal(view.failed,true);assert.match(view.text,/未能完成/);assert.match(view.text,/重试或补充说明/);assert.doesNotMatch(view.text,/第.*步失败/);
 }
});
test('UX-3 in-progress failure retains its result while the round continues',()=>{
 const view=api.progressText([failed,done],{terminal:false});assert.equal(view.failed,undefined);assert.equal(view.running,true);assert.equal(view.text,'第 17 步遇到问题，正在继续');
 assert.equal(api.stepPresentation(failed,{}).state,'failed');
});
test('UX-3 historical replay uses terminal facts for every earlier tool block without changing stored events',()=>{
 const events=[{seq:1,type:'turn.started',data:{turn:1}},{seq:2,type:'step.completed',data:{...failed,taskId:'turn-1'}},{seq:3,type:'assistant.message',data:{text:'换一种办法。'}},{seq:4,type:'step.completed',data:{...done,taskId:'turn-1'}},{seq:5,type:'turn.ended',data:{turn:1,reason:'completed'}}];
 const copy=JSON.stringify(events),result=api.projectTimeline(events),outcome=api.turnOutcome(result.ordered,'turn-1');
 assert.deepEqual(plain(outcome),complete);assert.equal(result.groups.length,2);
 for(const block of result.groups)assert.equal(api.progressText(block.steps,outcome).failed,undefined);
 assert.equal(JSON.stringify(events),copy);
});
test('UX-3 output summary gathers one turn once, retains all delivered versions/formats, discards explicit intermediates and read/move/rename',()=>{
 const files=['季度总结-v1.md','季度总结-v2.docx','季度总结-v2.pdf','文件索引.csv','整理说明.txt'].map((fileName,i)=>({artifactId:`file-${i}`,fileName,size:100}));
 const input=[...files,{artifactId:'old',fileName:'文件索引.csv',state:'superseded'},{artifactId:'read',fileName:'输入.txt',operation:'read'},{artifactId:'move',fileName:'移动.txt',operation:'move'},{artifactId:'rename',fileName:'改名.txt',operation:'rename'},{artifactId:'tmp',fileName:'临时.txt',state:'deleted'}];
 assert.equal(api.finalArtifacts(input).length,5);const families=api.artifactFamilies(input);assert.equal(families.length,3);assert.equal(families[0].length,3);
 const events=[{seq:1,type:'turn.started',data:{turn:1}},...files.map((file,i)=>({seq:i+2,type:'artifact.created',data:{...file,taskId:'turn-1'}})),{seq:7,type:'turn.ended',data:{turn:1,reason:'completed'}}];
 const copy=JSON.stringify(events),cards=api.projectTimeline(events).cards.filter(e=>e.type==='artifact.created');assert.equal(cards.length,1);assert.equal(cards[0].data.artifacts.length,5);assert.equal(cards[0].seq,6);assert.equal(JSON.stringify(events),copy);
 const repeated=api.finalArtifacts([{artifactId:'old',fileName:'最终.pdf',filePath:'/synthetic/最终.pdf'},{artifactId:'new',fileName:'最终.pdf',filePath:'/synthetic/最终.pdf'}]);assert.equal(repeated[0].artifactId,'new');
});

test('UX-3 missing intermediates disappear while explicitly delivered missing files retain a warning row',()=>{
 const files=[{artifactId:'intermediate',fileName:'草稿.md',exists:false,finalDelivery:false},{artifactId:'delivered',fileName:'最终报告.pdf',exists:false,finalDelivery:true},{artifactId:'unknown',fileName:'历史结果.pdf',exists:false}];
 assert.deepEqual(plain(api.finalArtifacts(files).map(file=>file.artifactId)),['delivered','unknown']);
});

test('UX-3 main-chat scoped tasks cannot borrow another session ending and read sources remain outside outputs',()=>{
 const ending={seq:9,sessionId:'session-b',type:'turn.ended',data:{turn:1,reason:'error'}};
 assert.equal(api.turnOutcome([ending],'session-a:turn-1').terminal,false);
 assert.equal(api.turnOutcome([ending],'session-b:turn-1').reason,'error');
 const events=[{seq:1,type:'artifact.created',data:{artifactId:'read-output',fileName:'输入.txt',completedStep:{taskId:'turn-1',stepId:'read',toolName:'read',state:'completed'}}}];
 const result=api.projectTimeline(events);assert.equal(result.groups.length,1);assert.equal(result.cards.filter(event=>event.type==='artifact.created').length,0);
});

test('UX-3 timeline borrows observed killed job state only from the matching session/turn/call, leaving records intact',()=>{
 const step={...failed,sessionId:'synthetic-session',turn:1,callId:'search'},records=[{callId:'search',sessionId:'synthetic-session',turn:1,jobState:'killed'}],copy=JSON.stringify([step,records]);
 assert.equal(api.executionState(api.executionPresentation(step,records)),'cancelled');
 assert.equal(api.executionState(api.executionPresentation({...step,sessionId:'other'},records)),'failed');
 assert.equal(api.executionState(api.executionPresentation({...step,turn:2},records)),'failed');assert.equal(JSON.stringify([step,records]),copy);
});

test('UX-3 recovered failed writes never count as successfully modified files',()=>{
 const view=api.progressText([{toolName:'write',state:'failed',summary:'写入文件'}],complete);assert.equal(view.text,'已完成 · 中途有 1 步重试');assert.doesNotMatch(view.text,/修改了/);
});

test('UX-3 confirmed user stop overrides an error generated during cancellation but never changes a completed round',()=>{
 const ending=(reason:string)=>[{seq:5,type:'turn.ended',data:{turn:1,reason}}],stop={terminal:true,text:'已停止'};
 assert.equal(api.turnOutcome(ending('error'),'turn-1',stop).reason,'aborted');assert.equal(api.turnOutcome(ending('completed'),'turn-1',stop).reason,'completed');assert.equal(api.turnOutcome(ending('error'),'turn-1').reason,'error');
});

test('UX-3 same filename without a recorded location never drops an ambiguous final delivery',()=>{
 assert.equal(api.finalArtifacts([{artifactId:'a',fileName:'最终报告.pdf'},{artifactId:'b',fileName:'最终报告.pdf'}]).length,2);
 assert.equal(api.finalArtifacts([{artifactId:'a',fileName:'最终报告.pdf',filePath:'/one/最终报告.pdf'},{artifactId:'b',fileName:'最终报告.pdf',filePath:'/two/最终报告.pdf'}]).length,2);
});

test('UX-3 signal words in filenames never invent an interruption, but structured tool signals do',()=>{
 assert.equal(api.interruptionFromDetail(JSON.stringify({output:'Could not read SIGINT-notes.md'})),false);
 assert.equal(api.interruptionFromDetail(JSON.stringify({output:[{type:'text',text:JSON.stringify({signal:'SIGTERM'})}]})),true);
 assert.equal(api.interruptionFromDetail(JSON.stringify({output:{exitCode:130}})),true);
 assert.equal(api.interruptionFromDetail(JSON.stringify({output:{value:{signal:'SIGINT'}}})),true);
});

test('UX-3 successful reads of JSON status data never become interrupted steps when their details expand',()=>{
 const raw=JSON.stringify({output:[{type:'text',text:JSON.stringify({signal:'SIGTERM',status:'killed'})}]});
 assert.equal(api.interruptionFromDetail(raw,{toolName:'read',state:'completed'}),false);
 assert.equal(api.interruptionFromDetail(raw,{toolName:'pwsh',state:'failed'}),true);
});
