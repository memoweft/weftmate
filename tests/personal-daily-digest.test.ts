import test from 'node:test';
import assert from 'node:assert/strict';
import { createDailyDigest,dailyDigestState,dailyWindow,observeDigestEvents,projectDailyDigest,clearDailyDigests,pruneDailyDigests,recentDigestContext,validateHealthPartition,DIGEST_CONTEXT_LIMIT,shiftDay,statisticalInsight } from '../src/personal-access/daily-digest.mjs';
import { putActivity } from '../src/personal-access/activity-store.mjs';
import { validateNotificationSettings } from '../src/personal-access/notification-policy.mjs';
const day='2026-10-07',zone='Asia/Shanghai',at='2026-10-06T17:30:00Z';
const account=():any=>({sessions:{s:{origin:'personal-remote',title:'季度报告',ownerId:'owner'}},commands:{},devices:{},defaultModelProfileId:'synthetic'});
function fixture(model:any=null){
  const a=account();let now=Date.parse('2026-10-12T00:00:00Z'),calls=0;
  const events=Array.from({length:10},(_,n)=>({seq:n,type:'user.message',at:`${shiftDay('2026-10-01',n)}T17:30:00Z`,data:{text:'PRIVATE ORIGINAL MUST NEVER REACH INSIGHT'}}));
  const context:any={accountState:()=>a,timestamp:()=>now,serial:(fn:any)=>fn(),mutate:(_owner:string,fn:any)=>fn(a),callBackend:(fn:any)=>fn(),usage:{settings:()=>({timeZone:zone}),exportAccount:()=>({records:[]})},modelSelectable:()=>true,visibleModels:async()=>[{id:'synthetic',model:'synthetic'}],backend:{readEvents:async({afterSeq}:any)=>({events:events.filter(e=>e.seq>afterSeq),nextSeq:9,hasMore:false}),...(model?{modelCompletion:async(input:any)=>{calls++;return model(input);}}:{})}};
  let service=createDailyDigest(context);
  return {a,context,events,refresh:()=>service.refresh('owner'),settle:()=>new Promise(resolve=>setImmediate(resolve)),calls:()=>calls,restart:()=>{service=createDailyDigest(context);},advance:(n:number)=>now+=n,close:()=>service.close()};
}
test('natural local day is inclusive/exclusive and DST days are 23 or 25 hours',()=>{
  const w=dailyWindow(day,zone);assert.equal(w.from,'2026-10-06T16:00:00.000Z');assert.equal(w.to,'2026-10-07T16:00:00.000Z');
  for(const [date,hours]of [['2027-03-14',23],['2026-11-01',25]] as const){const d=dailyWindow(date,'America/New_York');assert.equal(Date.parse(d.to)-Date.parse(d.from),hours*3600000);}
});
test('partitions count native turns, terminal tasks, verified outputs, notices, approvals and per-model usage without bodies',()=>{
  const a=account();observeDigestEvents(a,'s',[{seq:0,type:'user.message',at,data:{text:'PRIVATE BODY'}},{seq:1,type:'user.message',at:'2026-10-06T17:32:00Z',data:{}},{seq:2,type:'user.message',at:'2026-10-07T16:00:00Z',data:{}}],2,zone);
  a.commands.task={commandId:'task',kind:'session.message',sessionId:'s',createdAt:at,payload:{text:'PRIVATE COMMAND BODY'},toolExecutions:[{startedAt:at,toolName:'write',state:'completed',permission:{summary:'保存报告'}}],toolApprovals:[{createdAt:at,status:'resolved',outcome:'allowed-once'}]};
  a.commands.output={kind:'desktop.write_artifact',state:'observed',verification:{status:'observed'},sessionId:'s',createdAt:at,fileName:'报告.md',artifactId:'report'};
  a.commands.pending={commandId:'pending',rootTaskId:'pending',kind:'session.message',sessionId:'s',createdAt:at,state:'accepted_by_dsh',toolExecutions:[{startedAt:at,toolName:'read',state:'running'}]};
  putActivity(a,'task:task',{type:'task.completed',at,title:'完成',source:{sessionId:'s',taskId:'task'}});
  putActivity(a,'notice',{type:'reminder.triggered',at,title:'提醒',summary:'提交报告',source:{sessionId:'s',scheduleId:'schedule'}});
  const r=projectDailyDigest(a,day,zone,[{at,profileId:'model',sessionId:'s',tokens:{inputTokens:20,outputTokens:10}},{at,profileId:'model',sessionId:'s',tokens:null}],['计划与决定','计划与决定']);
  assert.equal(r.conversations.turns,2);assert.equal(r.tasks.completed,1);assert.equal(r.tasks.blocked,1);assert.equal(r.tasks.executions.length,2);assert.equal(r.tasks.approvals.count,1);assert.equal(r.outputs.count,1);assert.equal(r.schedule.count,1);
  assert.equal(r.usage.estimatedActiveMinutes,7);assert.equal(r.usage.hourlyTurns[1],2);assert.equal(r.usage.models.model.requests,2);assert.equal(r.usage.models.model.inputTokens,20);assert.equal(r.usage.models.model.unknownRequests,1);
  assert.deepEqual(r.memory.topics,['计划与决定']);assert.equal(r.health.status,'unavailable');assert.equal(r.devices.status,'unavailable');assert.ok(!JSON.stringify(r).includes('PRIVATE'));
});
test('event watermark deduplicates pages and temporary/forgotten sessions do not contribute',()=>{
  const a=account(),events=[{seq:0,type:'user.message',at,data:{}}];observeDigestEvents(a,'s',events,0,zone);observeDigestEvents(a,'s',events,0,zone);assert.equal(projectDailyDigest(a,day,zone).conversations.turns,1);
  a.sessions.s.temporary=true;assert.equal(projectDailyDigest(a,day,zone).conversations.turns,0);
  const b=account();b.sessions.s.forgottenSeqs=[0];observeDigestEvents(b,'s',events,0,zone);assert.equal(projectDailyDigest(b,day,zone).conversations.turns,0);
});
test('ten-day offline catch-up produces each day once, only latest weekly insight, restart never re-infers',async()=>{
  const f=fixture();await f.refresh();assert.equal(Object.keys(f.a.dailyDigest.days).length,10);assert.equal(Object.values(f.a.activity.items).filter((r:any)=>r.weeklyInsight).length,1);
  const before=JSON.stringify(f.a.dailyDigest.days);await f.refresh();f.restart();await f.refresh();assert.equal(JSON.stringify(f.a.dailyDigest.days),before);assert.equal(Object.keys(f.a.activity.items).length,1);await f.close();
});
test('daily 03:00 cutoff waits for yesterday, then generates without replacing previous documents',async()=>{
  const f=fixture();f.advance(-6*3600000);await f.refresh();assert.equal(f.a.dailyDigest.days['2026-10-11'],undefined);f.advance(2*3600000);await f.refresh();assert.ok(f.a.dailyDigest.days['2026-10-11']);await f.close();
});
test('weekly model uses only seven documents, background priority, one call; unavailable uses statistics',async()=>{
  let captured:any;const f=fixture((input:any)=>{captured=input;return new Response(JSON.stringify({choices:[{message:{content:'这周主要在做季度报告，报告已完成。记得休息。'}}]}));});
  await f.refresh();await f.settle();assert.equal(f.calls(),1);assert.equal(captured.priority,'background');const docs=JSON.parse(captured.body.messages[1].content);assert.equal(docs.length,7);assert.ok(docs.every((r:any)=>r.version===1&&r.health));assert.ok(!JSON.stringify(captured).includes('PRIVATE'));assert.equal(Object.values(f.a.activity.items).find((r:any)=>r.weeklyInsight)!.weeklyInsight.mode,'model');
  f.restart();await f.refresh();await f.settle();assert.equal(f.calls(),1);await f.close();
  const unavailable=fixture(()=>{throw Error('offline');});await unavailable.refresh();await unavailable.settle();assert.equal(Object.values(unavailable.a.activity.items).find((r:any)=>r.weeklyInsight)!.weeklyInsight.mode,'statistics');await unavailable.close();
});
test('background request does not hold the feed; clear in flight cannot resurrect insight',async()=>{
  let release:any;const f=fixture(()=>new Promise(resolve=>release=resolve));await f.refresh();await f.settle();assert.equal(f.calls(),1);assert.equal(Object.keys(f.a.activity.items).length,1);clearDailyDigests(f.a,Date.parse('2026-10-12T00:00:00Z'));release(new Response(JSON.stringify({choices:[{message:{content:'STALE'}}]})));await f.settle();assert.equal(Object.keys(f.a.activity.items).length,0);await f.close();
});
test('retention, clearing, disabled defaults and owner isolation',async()=>{
  const f=fixture();await f.refresh();f.a.notificationSettings={reviewRetentionDays:7};pruneDailyDigests(f.a,Date.parse('2026-10-12T00:00:00Z'),zone);assert.equal(Object.keys(f.a.dailyDigest.days).length,6);
  const other=account();assert.equal(recentDigestContext(other,Date.parse('2026-10-12T00:00:00Z'),zone),'');assert.ok(recentDigestContext(f.a,Date.parse('2026-10-12T00:00:00Z'),zone));
  clearDailyDigests(f.a,Date.parse('2026-10-12T00:00:00Z'));await f.refresh();assert.equal(recentDigestContext(f.a,Date.parse('2026-10-12T00:00:00Z'),zone),'');assert.equal(Object.keys(f.a.dailyDigest.days).length,0);
  f.a.notificationSettings.reviewEnabled=false;f.advance(2*86400000);await f.refresh();assert.equal(Object.keys(f.a.dailyDigest.days).length,0);await f.close();
});
test('context is bounded, has concrete sources, no bodies, and disabling stops injection immediately',async()=>{
  const f=fixture();await f.refresh();const text=recentDigestContext(f.a,Date.parse('2026-10-12T00:00:00Z'),zone);assert.ok(text.length<=DIGEST_CONTEXT_LIMIT);assert.equal((text.match(/2026-10-\d{2}：/g)??[]).length,7);assert.match(text,/#weftmate:session:s/);assert.match(text,/季度报告/);assert.ok(!text.includes('PRIVATE'));assert.ok(recentDigestContext(f.a,Date.parse('2026-10-12T00:00:00Z'),zone,180).length<=180);f.a.notificationSettings={reviewEnabled:false};assert.equal(recentDigestContext(f.a,Date.parse('2026-10-12T00:00:00Z'),zone),'');await f.close();
});
test('health v1 validates nullable aggregates, never accepts raw samples or unknown fields',()=>{
  const health={version:1,status:'available',steps:6000,sleepMinutes:440,restingHeartRateBpm:62,exerciseMinutes:30,workouts:[{type:'步行',minutes:30}]};assert.deepEqual(validateHealthPartition(health),health);
  for(const patch of [{version:2},{steps:-1},{steps:1.5},{sleepMinutes:1441},{restingHeartRateBpm:'62'},{samples:[]},{status:'unavailable'},{workouts:[{type:'步行',minutes:30,rawHeartRate:[60]}]}])assert.throws(()=>validateHealthPartition({...health,...patch}),{code:'INVALID_REQUEST'});
  assert.throws(()=>validateHealthPartition(null),{code:'INVALID_REQUEST'});assert.throws(()=>validateNotificationSettings({reviewRetentionDays:0}));assert.throws(()=>validateNotificationSettings({reviewEnabled:'yes'}));
});


test('existing DSH short titles are observed without generating titles or reading bodies',async()=>{
  const f=fixture();delete f.a.sessions.s.title;f.context.backend.describeSession=async()=>({title:'已有的报告标题'});await f.refresh();assert.equal(f.a.dailyDigest.days['2026-10-11'].conversations.items[0].title,'已有的报告标题');await f.close();
});
test('weekly outstanding state follows the latest receipt, not an earlier pending day',()=>{
  const a=account(),first=projectDailyDigest(a,'2026-10-06',zone),last=projectDailyDigest(a,'2026-10-07',zone);
  first.tasks.items=[{title:'报告',state:'pending',source:{sessionId:'s',taskId:'same'}}];first.tasks.blocked=1;
  last.tasks.items=[{title:'报告',state:'completed',source:{sessionId:'s',taskId:'same'}}];last.tasks.completed=1;
  assert.match(statisticalInsight([first,last]).text,/没有记录到卡住/);
});
