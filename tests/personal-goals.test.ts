import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoalOperations } from '../src/personal-access/goals.mjs';
import { createNativeGoalManager } from '../src/personal-access/goals-native.mjs';
import { nextCalendarInput } from '../src/personal-access/schedules-calendar.mjs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { eraseSessionMemoryArtifact } from '../src/runtime/dsh-adapter/memory-erasure.mjs';
import { observeActivityEvents } from '../src/personal-access/activity.mjs';
import { eraseChatCopies } from '../src/personal-access/chat-erasure.mjs';
import { runInNewContext } from 'node:vm';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('overview keeps background work active, redacts temporary names, honors seven days and erasure generation',async()=>{
  const now=Date.parse('2026-10-10T08:00:00Z'),at=new Date(now-60000).toISOString();
  const make=(id:string,sessionId='side')=>({commandId:id,kind:'session.message',sessionId,state:'accepted_by_dsh',createdAt:at,updatedAt:at,payload:{text:`secret-${id}`}});
  const account:any={ownerId:'owner',sessions:{side:{origin:'personal-remote',title:'旁聊'},private:{origin:'personal-remote',temporary:true,title:'secret-title'}},commands:{running:make('running'),done:make('done'),approval:{...make('approval'),toolApprovals:[{status:'pending'}]},private:make('private','private'),old:make('old')},activity:{generation:0,items:{old:{source:{taskId:'old'},type:'task.completed',at:'2026-10-01T08:00:00Z'}}}};
  const context:any={accountState:()=>account,timestamp:()=>now,usage:{settings:()=>({timeZone:'Asia/Shanghai'})},taskDetail:async(_a:any,id:string)=>({replyEvidence:{status:id==='approval'?'streaming':'completed',terminalAt:at,step:2},control:{state:'active',canStop:true,backgroundJobs:{active:id==='running'?1:0,unconfirmed:0}}})};
  const ops=createGoalOperations(context),value=await ops.overview('owner');
  assert.equal(value.items.find(r=>r.taskId==='running')?.status,'running');assert.equal(value.items.find(r=>r.taskId==='approval')?.status,'approval');
  assert.ok(value.recent.some(r=>r.taskId==='done'));assert.ok(!value.recent.some(r=>r.taskId==='old'));assert.ok(!JSON.stringify(value).includes('secret-private'));
  account.activity.erasedBefore={side:new Date(now).toISOString()};assert.ok((await ops.overview('owner')).items.every(r=>r.source.sessionId!=='side'));
  delete account.activity.erasedBefore;context.taskDetail=async()=>{account.activity.generation++;return {replyEvidence:{status:'completed',terminalAt:at},control:{state:'active',canStop:true,backgroundJobs:{active:0,unconfirmed:0}}};};
  await assert.rejects(ops.overview('owner'),{code:'CURSOR_RESET_REQUIRED'});
});

test('monthly calendar skips absent month dates and preserves local time',()=>{
  assert.deepEqual(nextCalendarInput({kind:'monthly',day:31,time:'09:00:00'},'Asia/Shanghai',Date.parse('2026-01-31T02:00:00Z')),{date:'2026-03-31',time:'09:00:00',time_zone:'Asia/Shanghai'});
});

test('native goal adapter replays exact receipts, rejects conflicts and persists no objective copies',async t=>{
  const root=await mkdtemp(join(tmpdir(),'weftmate-tb2-unit-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let creates=0,clears=0;const goal={id:'native-goal',revision:1,objective:'TB2-PRIVATE-SECRET',phase:'active'};
  const agent:any={id:'session',session:{events:[]}},ctx:any={get:(name:string)=>name==='agentPresets'?null:({create:()=>{creates++;return goal;},get:()=>goal,clear:()=>{clears++;return {id:goal.id,revision:2};}}),sessions:{flush:async()=>{}}};
  const file=join(root,'requests.json'),manager=await createNativeGoalManager({ctx,foldGoal:()=>({goal,roundsStarted:0}),file});
  const input={action:'create',requestId:'request-create',objective:goal.objective};assert.deepEqual(await manager.manage(agent,input),await manager.manage(agent,input));assert.equal(creates,1);
  await assert.rejects(manager.manage(agent,{...input,objective:'different'}),{status:409});assert.ok(!(await readFile(file,'utf8')).includes(goal.objective));
  const restored=await createNativeGoalManager({ctx,foldGoal:()=>({goal}),file});await restored.manage(agent,input);assert.equal(creates,1);
  await restored.manage(agent,{action:'erase'});assert.equal(clears,1);assert.equal(await readFile(file,'utf8'),'{}');
});

test('D33 removes selected native goal and schedule derived text while preserving original human text and unrelated arrangements',async t=>{
  const root=await mkdtemp(join(tmpdir(),'weftmate-tb2-erasure-'));t.after(()=>rm(root,{recursive:true,force:true}));const file=join(root,'session.jsonl'),secret='TB2-forgotten-source';
  const rows=[{id:'session'},{type:'user/message',seq:0,data:{content:[{type:'text',text:secret}]}},
    {type:'goal/change',seq:1,data:{goal:{id:'goal-private',objective:`目标：${secret}`,blockedReason:{code:'blocked',message:secret}}}},
    {type:'schedule/change',seq:2,data:{operation:'create',schedule:{id:'schedule-private',prompt:secret}}},
    {type:'schedule/change',seq:3,data:{operation:'create',schedule:{id:'schedule-other',prompt:'无关安排'}}}];
  await writeFile(file,rows.map(row=>JSON.stringify(row)).join('\n'));
  const persistence:any={config:{root},readRaw:async()=>({meta:{id:'session'},content:await readFile(file,'utf8')}),locate:()=>({path:file})};
  await eraseSessionMemoryArtifact(persistence,'session',{sourceTexts:[secret],deleteConversationSnippets:false,goalIds:['goal-private'],scheduleIds:['schedule-private']});
  const cleaned=(await readFile(file,'utf8')).split('\n').map(line=>JSON.parse(line));
  assert.equal(cleaned[1].data.content[0].text,secret);assert.ok(!JSON.stringify(cleaned.slice(2)).includes(secret));assert.equal(cleaned[4].data.schedule.prompt,'无关安排');
});

test('scheduled text result produces one native task dynamic while ordinary plain replies do not',()=>{
  const account:any={sessions:{side:{origin:'personal-remote'}},commands:{scheduled:{commandId:'scheduled',kind:'session.message',sessionId:'side',receiptId:'receipt',dshTurn:1,state:'accepted_by_dsh',scheduleSourceId:'ui-schedule'}},activity:undefined};
  const events=[{type:'turn.started',seq:0,at:'2026-10-10T00:00:00Z',data:{turn:1}},{type:'user.message',seq:1,at:'2026-10-10T00:00:00Z',data:{receiptId:'receipt'}},{type:'assistant.message',seq:1,at:'2026-10-10T00:00:01Z',data:{text:'提醒内容已经整理。'}},{type:'turn.ended',seq:2,at:'2026-10-10T00:00:02Z',data:{reason:'completed'}}];
  observeActivityEvents(account,'side',events,2);assert.equal(Object.values(account.activity.items).length,1);assert.equal((Object.values(account.activity.items)[0] as any).type,'task.completed');
  const ordinary:any=structuredClone(account);delete ordinary.commands.scheduled.scheduleSourceId;delete ordinary.activity;observeActivityEvents(ordinary,'side',events,2);assert.equal(Object.values(ordinary.activity.items).length,0);
});

test('shared goal page resets old account data before new reads and ignores late responses',async()=>{
  let resets=0;const factories:any={},environment:any={crypto:{randomUUID:()=> 'fixture'}},reads:any[]=[];
  runInNewContext(await readFile(new URL('../src/ui-core/goals.js',import.meta.url),'utf8'),{globalThis:{WeftUiCore:{factories}},URLSearchParams,Set});
  const core:any={state:{identityGeneration:1,ownerId:'one',personalCapabilities:{taskOverview:1,scheduleEditing:1,goals:1}},accessApi:(path:string)=>new Promise(resolve=>reads.push({path,owner:core.state.ownerId,resolve})),failureMessage:()=> '读取失败'};
  Object.assign(core,factories.goals(core,{resetGoalsView:()=>resets++},environment));const old=core.readGoals();await Promise.resolve();await Promise.resolve();
  core.goalsPage.tasks=[{title:'old private data'}];core.state.identityGeneration++;core.state.ownerId='two';const current=core.readGoals();assert.equal(core.goalsPage.tasks.length,0);await Promise.resolve();await Promise.resolve();
  for(const read of reads.filter(r=>r.owner==='two'))read.resolve(read.path==='/tasks'?{items:[{title:'new data'}],recent:[]}:read.path==='/sessions'?{sessions:[]}:{items:[]});await current;
  for(const read of reads.filter(r=>r.owner==='one'))read.resolve(read.path==='/tasks'?{items:[{title:'old private data'}],recent:[]}:read.path==='/sessions'?{sessions:[]}:{items:[]});await old;
  assert.equal(core.goalsPage.tasks[0].title,'new data');assert.equal(core.goalsPage.loading,false);assert.equal(resets,2);
});

test('forgetting archived native goals scrubs historical IDs and refuses the original create replay',async t=>{
  const root=await mkdtemp(join(tmpdir(),'weftmate-tb2-goal-tombstone-'));t.after(()=>rm(root,{recursive:true,force:true}));let current:any;
  const agent:any={id:'session',session:{events:[]}},service={get:()=>current,create:(_agent:any,input:any)=>{current={id:'goal-source',revision:1,objective:input.objective};agent.session.events.push({type:'goal/change',data:{goal:{...current}}});return current;},clear:()=>{current=undefined;return {id:'goal-source',revision:2};}};
  const ctx:any={get:(name:string)=>name==='agentPresets'?null:service,sessions:{flush:async()=>{}}};
  const manager=await createNativeGoalManager({ctx,foldGoal:()=>({goal:current}),file:join(root,'requests.json')});
  const request={action:'create',requestId:'original-request',objective:'TB2-archived-private'};await manager.manage(agent,request);await manager.manage(agent,{action:'archive',requestId:'archive',ref:{id:'goal-source',revision:1}});
  const erased=await manager.manage(agent,{action:'forget',sourceTexts:['TB2-archived-private'],receiptIds:[]});assert.deepEqual(erased.clearedGoalIds,['goal-source']);
  await assert.rejects(manager.manage(agent,request),{status:404});assert.equal(current,undefined);assert.ok(!(await readFile(join(root,'requests.json'),'utf8')).includes('TB2-archived-private'));
});

test('goal-only erasure advances the deletion generation even when there are no dynamics',()=>{
  const account:any={sessions:{side:{}},commands:{},activity:{version:1,generation:0,sequence:0,items:{},changes:[],sources:{},operations:{}}};
  eraseChatCopies(account,{sessionId:'side'});assert.equal(account.activity.generation,1);
});
