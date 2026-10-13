import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { computerUsageInterval, computerDay, mergeComputerBuckets, resolvedComputerUsage } from '../src/personal-access/computer-usage.mjs';
import { createComputerUsageSampler } from '../src/computer-usage-sampler.mjs';
import { dailyDigestState, projectDailyDigest, pruneDailyDigests, clearDailyDigests, recentDigestContext } from '../src/personal-access/daily-digest.mjs';
import { healthOverview, healthMetrics } from '../src/personal-health/analysis.mjs';
import { healthModelSummary, createHealthInsights } from '../src/personal-health/insight.mjs';
import { createDailyDigest } from '../src/personal-access/daily-digest.mjs';
import { createPersonalAccessService } from '../src/personal-access/index.mjs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHealthOperations } from '../src/personal-health/records-http.mjs';
import { isHealthQuestion } from '../src/plugins/personal-prompt.mjs';
const zone='Asia/Shanghai', minute=60000;
const account=():any=>({sessions:{},commands:{}});
function observe(a:any,from:string,count:number,idleSeconds=0,timeZone=zone){let at=Date.parse(from);for(let n=0;n<count;n++,at+=minute){const rows=computerUsageInterval({from:at,to:at+minute,idleSeconds,timeZone});const state=dailyDigestState(a);state.computerUsage={buckets:mergeComputerBuckets(state.computerUsage?.buckets??[],rows)};}}
test('five-minute idle cutoff is clipped inside a minute; gaps and invalid sources stay unknown',()=>{
  const from=Date.parse('2026-10-11T17:00:00Z');
  for(const [idle,expected]of [[0,1],[299,1],[300,1],[330,.5],[360,0]])assert.equal(computerUsageInterval({from,to:from+minute,idleSeconds:idle,timeZone:zone})[0].activeMinutes,expected);
  assert.deepEqual(computerUsageInterval({from,to:from+10*minute,idleSeconds:0,timeZone:zone}),[]);
  assert.deepEqual(computerUsageInterval({from,to:from+minute,idleSeconds:NaN,timeZone:zone}),[]);
  assert.equal(computerUsageInterval({from,to:from+minute,idleSeconds:0,timeZone:zone,locked:true})[0].activeMinutes,0);
});
test('quarter-hour buckets split across hour and midnight without turning absent time into zero',()=>{
  const a=account();observe(a,'2026-10-11T15:59:30Z',2);
  const yesterday=computerDay(a,'2026-10-11',zone),today=computerDay(a,'2026-10-12',zone);
  assert.equal(yesterday.activeMinutes,.5);assert.equal(today.activeMinutes,1.5);assert.equal(today.quarterHours[0],1.5);assert.equal(today.quarterHours[1],null);assert.equal(today.hourly[1],null);
  assert.equal(today.firstUsedAt,'2026-10-11T16:00:00.000Z');assert.equal(today.lastUsedAt,'2026-10-11T16:01:30.000Z');
  const b=account();observe(b,'2026-10-11T16:59:30Z',1);assert.deepEqual(computerDay(b,'2026-10-12',zone).hourly.slice(0,2),[.5,.5]);
  assert.equal(computerDay(b,'2026-10-13',zone),null);
});
test('DST repeat retains both real quarters; spring gap stays null; 23/25-hour days keep real minutes',()=>{
  for(const [date,from,count]of [['2026-11-01','2026-11-01T04:00:00Z',1500],['2027-03-14','2027-03-14T05:00:00Z',1380]] as const){
    const a=account();observe(a,from,count,0,'America/New_York');const day=computerDay(a,date,'America/New_York');assert.equal(day.activeMinutes,count);assert.equal(day.buckets.length,count/15);
    if(count===1500){assert.equal(day.quarterHours[4],30);assert.equal(day.hourly[1],120);}else assert.equal(day.hourly[2],null);
  }
});
test('stored observations have a strict time-only shape; retention, clear and owners stay isolated',()=>{
  const a=account(),b=account();observe(a,'2026-10-01T17:00:00Z',2);observe(a,'2026-10-11T17:00:00Z',1,600);a.notificationSettings={reviewRetentionDays:7};
  for(const row of a.dailyDigest.computerUsage.buckets)assert.deepEqual(Object.keys(row).sort(),['activeMinutes','firstUsedAt','lastUsedAt','observedMinutes','start']);
  assert.doesNotMatch(JSON.stringify(a.dailyDigest.computerUsage),/appName|processName|windowTitle|fileName|url|keyboard|mouse|hostname/i);
  assert.equal(computerDay(b,'2026-10-12',zone),null);pruneDailyDigests(a,Date.parse('2026-10-12T04:00:00Z'),zone);assert.equal(a.dailyDigest.computerUsage.buckets.length,1);
  assert.equal(computerDay(a,'2026-10-12',zone).activeMinutes,0);clearDailyDigests(a,Date.now());assert.equal(computerDay(a,'2026-10-12',zone),null);
});
test('real computer usage precedes chat estimates, including observed zero; fallback is explicitly chat',()=>{
  const a=account();dailyDigestState(a).days['2026-10-12']={usage:{estimatedActiveMinutes:45,lateNightMinutes:30,lastUserMessageAt:'2026-10-11T17:05:00Z'}};
  assert.deepEqual(resolvedComputerUsage(a,'2026-10-12',zone),{activeMinutes:45,lateNightMinutes:30,source:'chat'});
  observe(a,'2026-10-11T17:59:00Z',1);let o=healthOverview({},a,'2026-10-12',zone);assert.equal(o.usage.activeMinutes,1);assert.equal(o.usage.source,'computer');assert.equal(o.usage.lastUsedAt,'2026-10-11T18:00:00.000Z');
  const trend=healthMetrics({},a,'usageLateNightMinutes',7,'2026-10-12',zone);assert.equal(trend.points.at(-1).value,1);assert.equal(trend.points.at(-1).source,'computer');
  const b=account();observe(b,'2026-10-11T17:00:00Z',1,900);assert.equal(resolvedComputerUsage(b,'2026-10-12',zone).activeMinutes,0);assert.equal(healthOverview({},b,'2026-10-12',zone).usage.lastUsedAt,null);
});
test('daily devices are local aggregates and the model receives only summaries, never distributions',()=>{
  const a=account();observe(a,'2026-10-11T17:00:00Z',3);const d=projectDailyDigest(a,'2026-10-12',zone);assert.equal(d.devices.status,'available');assert.equal(d.devices.items[0].activeMinutes,3);assert.equal(d.devices.items[0].deviceId,'this-computer');assert.equal(d.devices.items[0].label,'这台电脑');assert.equal(d.devices.items[0].platform,'windows');a.dailyDigest.days[d.day]=d;
  const summary=healthModelSummary({},a,d.day,zone);assert.doesNotMatch(JSON.stringify(summary),/buckets|quarterHours|observedMinutes|firstUsedAt|hourly/);assert.match(JSON.stringify(summary),/computer/);
  assert.match(recentDigestContext(a,Date.parse('2026-10-13T04:00:00Z'),zone),/电脑使用 3 分钟/);
});
test('sampler survives tray operation, closes at shutdown, suspends, locks and stops when disabled or owner changes',async()=>{
  let at=Date.parse('2026-10-11T17:00:00Z'),enabled=true,current='a',generation='0';const saves:any[]=[],power:any=new EventEmitter();power.getSystemIdleTime=()=>0;
  const sampler=createComputerUsageSampler({powerMonitor:power,owner:()=>current,policy:()=>({enabled,generation,timeZone:zone}),persist:(owner:any,gen:any,rows:any)=>saves.push({owner,gen,rows}),now:()=>at,setTimer:()=>({unref(){}}),clearTimer:()=>{}});
  await sampler.tick();at+=minute;await sampler.tick();power.emit('lock-screen');await sampler.tick();at+=minute;await sampler.tick();power.emit('unlock-screen');await sampler.tick();at+=minute;await sampler.tick();power.emit('suspend');await sampler.tick();at+=8*3600000;power.emit('resume');await sampler.tick();at+=minute;await sampler.tick();await sampler.flush();
  assert.equal(saves.flatMap(r=>r.rows).reduce((n,r)=>n+r.activeMinutes,0),3);assert.equal(saves.flatMap(r=>r.rows).reduce((n,r)=>n+r.observedMinutes,0),4);
  enabled=false;generation='1';at+=minute;await sampler.tick();await sampler.flush();const count=saves.length;at+=minute;await sampler.tick();assert.equal(saves.length,count);
  enabled=true;current='b';at+=minute;await sampler.tick();at+=minute;await sampler.tick();await sampler.close();assert.equal(saves.at(-1).owner,'b');assert.equal(saves.at(-1).rows[0].activeMinutes,1);assert.equal(power.listenerCount('suspend'),0);
});
test('real account storage preserves privacy and isolation; disabled/cleared pending batches cannot return after re-enable or restart',async()=>{
  const root=await mkdtemp(join(tmpdir(),'weftmate-data2-unit-'));let service:any;
  const backend=Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(name=>[name,async()=>({})]));
  try {
    service=await createPersonalAccessService({root,port:0,backend});const {origin}=await service.start();
    const register=async(username:string)=>{const r=await fetch(origin+'/personal/v1/auth/register',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({username,password:'synthetic-password-long',deviceName:'Synthetic'})});assert.equal(r.status,201);return {body:await r.json(),cookie:r.headers.get('set-cookie')!.split(';')[0]};};
    const a=await register('data2-owner-a'),b=await register('data2-owner-b'),owner=a.body.account.ownerId;
    const request=async(body:any)=>{const r=await fetch(origin+'/personal/v1/settings/notifications',{method:'PATCH',headers:{origin,cookie:a.cookie,'x-weftmate-csrf':a.body.csrfToken,'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);};
    const initial=service.computerUsagePolicy(owner),rows=computerUsageInterval({from:Math.floor(Date.now()/(15*minute))*15*minute-15*minute,to:Math.floor(Date.now()/(15*minute))*15*minute-14*minute,idleSeconds:0,timeZone:initial.timeZone});
    await service.recordComputerUsage(owner,initial.generation,rows);
    let state=JSON.parse(await readFile(join(root,'store.json'),'utf8'));assert.equal(state.accounts[owner].dailyDigest.computerUsage.buckets.length,1);assert.equal(state.accounts[b.body.account.ownerId].dailyDigest?.computerUsage,undefined);
    for(const row of state.accounts[owner].dailyDigest.computerUsage.buckets)assert.deepEqual(Object.keys(row).sort(),['activeMinutes','firstUsedAt','lastUsedAt','observedMinutes','start']);
    await request({computerUsageEnabled:false});await service.recordComputerUsage(owner,initial.generation,rows);assert.equal(JSON.parse(await readFile(join(root,'store.json'),'utf8')).accounts[owner].dailyDigest.computerUsage.buckets[0].activeMinutes,rows[0].activeMinutes);
    await request({computerUsageEnabled:true});await service.recordComputerUsage(owner,initial.generation,rows);assert.equal(JSON.parse(await readFile(join(root,'store.json'),'utf8')).accounts[owner].dailyDigest.computerUsage.buckets[0].activeMinutes,rows[0].activeMinutes);
    const current=service.computerUsagePolicy(owner);await request({reviewClear:true});await service.recordComputerUsage(owner,current.generation,rows);state=JSON.parse(await readFile(join(root,'store.json'),'utf8'));assert.equal(state.accounts[owner].dailyDigest.computerUsage,undefined);
    await service.close();service=await createPersonalAccessService({root,port:0,backend});assert.notEqual(service.computerUsagePolicy(owner).generation,current.generation);
    await service.close();state=JSON.parse(await readFile(join(root,'store.json'),'utf8'));const old=state.accounts[owner];state.accounts[owner]={account:old.account,devices:old.devices,sessions:{},commands:{},setupGrant:null,authLimits:{failures:0,lastFailureAt:0,lockUntil:0}};await writeFile(join(root,'store.json'),JSON.stringify(state));
    service=await createPersonalAccessService({root,port:0,backend});assert.notEqual(service.computerUsagePolicy(owner).generation,initial.generation,'account-wide wipe must not reuse a pre-clear recording token');await service.recordComputerUsage(owner,initial.generation,rows);assert.equal(JSON.parse(await readFile(join(root,'store.json'),'utf8')).accounts[owner].dailyDigest?.computerUsage,undefined);
  }finally{await service?.close();await rm(root,{recursive:true,force:true});}
});
test('weekly model input carries only computer day totals and timestamps, never observed buckets',async()=>{
  const a=account();a.defaultModelProfileId='synthetic';a.backgroundModelProfileId='synthetic';for(let n=4;n<=10;n++)observe(a,`2026-10-${String(n).padStart(2,'0')}T17:00:00Z`,1);
  let captured:any;const context:any={accountState:()=>a,timestamp:()=>Date.parse('2026-10-13T04:00:00Z'),serial:(fn:any)=>fn(),mutate:(_owner:any,fn:any)=>fn(a),callBackend:(fn:any)=>fn(),usage:{settings:()=>({timeZone:zone}),exportAccount:()=>({records:[]})},modelSelectable:()=>true,visibleModels:(_owner:any,models:any)=>models,backend:{listModels:async()=>[{id:'synthetic',model:'synthetic'}],modelCompletion:async(input:any)=>{captured=JSON.parse(input.body.messages[1].content);return new Response(JSON.stringify({choices:[{message:{content:'这周记录到了电脑使用。'}}]}));}}};
  const service=createDailyDigest(context);await service.refresh('a');await new Promise(r=>setImmediate(r));assert.ok(captured);assert.doesNotMatch(JSON.stringify(captured),/buckets|quarterHours|observedMinutes/);assert.equal(captured.find((d:any)=>d.devices.items.length).devices.items[0].source,'computer');
  const device=captured.find((d:any)=>d.devices.items.length).devices.items[0];
  assert.equal(device.firstUsedAtLocal,'2026-10-05 01:00');assert.equal(device.lastUsedAtLocal,'2026-10-05 01:01');
  assert.equal(device.firstUsedAt,undefined,'the model receives unambiguous account-local time, without a second UTC conversion');
  const weekly:any=Object.values(a.dailyDigest.weeks)[0];assert.equal(weekly.mode,'model');
  assert.match(weekly.text,/这周每天凌晨一点后还在使用/,'model refinement must retain the recorded late-night fact');await service.close();
});
test('ordinary computer-night question loads health_query and usage remains queryable before connecting body measurements',async()=>{
  assert.equal(isHealthQuestion('我昨晚几点还在用电脑？'),true);assert.equal(isHealthQuestion('你好'),false);
  const a=account();observe(a,'2026-10-11T17:00:00Z',1);const context:any={timestamp:()=>Date.parse('2026-10-12T04:00:00Z'),accountState:()=>a,usage:{settings:()=>({timeZone:zone})},healthRecords:{read:async()=>({days:{}})}};
  const ops=createHealthOperations(context),q=await ops.query('a',{metric:'overview'});assert.equal(q.connected,false);assert.equal(q.usageConnected,true);assert.equal(q.items.at(-1).usage.source,'computer');assert.equal(q.timeZone,zone);assert.equal(q.items.at(-1).usage.lastUsedAtLocal,'2026-10-12 01:01');assert.doesNotMatch(JSON.stringify(q),/buckets|quarterHours|observedMinutes/);assert.equal((await ops.query('a',{metric:'sleepMinutes'})).message,'还没接上');clearDailyDigests(a,Date.parse('2026-10-11T04:00:00Z'));observe(a,'2026-10-11T15:00:00Z',1);const nightOnly=await ops.query('a',{metric:'overview',from:'2026-10-12',to:'2026-10-12'});assert.equal(nightOnly.usageConnected,true);assert.equal(nightOnly.items[0].usage.lastUsedAtLocal,'2026-10-11 23:01');assert.equal(nightOnly.items[0].usage.lastUsedAtSource,'computer');await ops.close();
});
test('today insight refreshes for usage changes without changing body generation or resetting model quota; clear withdraws cached cross-data insights',async()=>{
  const a=account(),day='2026-10-12',now=Date.parse(day+'T04:00:00Z');a.backgroundModelProfileId='synthetic';observe(a,'2026-10-11T17:00:00Z',1);
  const state:any={generation:7,settings:{modelInsightsEnabled:true},days:{[day]:{health:{version:1,status:'available',steps:1000,sleepMinutes:420,restingHeartRateBpm:60,exerciseMinutes:10,workouts:[]}},'2026-10-11':{health:{version:1,status:'available',steps:1000,sleepMinutes:420,restingHeartRateBpm:60,exerciseMinutes:10,workouts:[]},insight:{mode:'model',text:'previous cross-data statement'}}}},inputs:any[]=[];
  const context:any={accountState:()=>a,timestamp:()=>now,serial:(fn:any)=>fn(),healthRecords:{read:async()=>state,update:async(_owner:any,fn:any)=>fn(state)},usage:{settings:()=>({timeZone:zone})},modelSelectable:()=>true,callBackend:(fn:any)=>fn(),visibleModels:(_owner:any,models:any)=>models,backend:{listModels:async()=>[{id:'synthetic',model:'synthetic'}],modelCompletion:async(input:any)=>{inputs.push(JSON.parse(input.body.messages[1].content));return Response.json({choices:[{message:{content:JSON.stringify({headline:'记录已更新',text:'使用汇总已经更新。',observations:[],suggestions:[]})}}]});}}};
  const insights=createHealthInsights(context,{debounceMs:10000});
  try {
    await insights.generate('a');assert.equal(inputs.length,1);
    for(let n=1;n<=3;n++){observe(a,`2026-10-11T17:0${n}:00Z`,1);a.dailyDigest.computerUsageRevision=n;await insights.usageChanged('a');assert.equal(state.days[day].insight,undefined);await insights.generate('a');}
    assert.equal(inputs.length,3);assert.equal(state.modelClaims.count,3);assert.equal(state.generation,7);assert.equal(state.days[day].insight.mode,'statistics');assert.deepEqual(inputs.map(input=>input.usage7.at(-1).activeMinutes),[1,2,3]);
    clearDailyDigests(a,now);await insights.usageChanged('a',{clear:true});assert.equal(state.days['2026-10-11'].insight,undefined);await insights.generate('a');assert.equal(inputs.length,3);assert.equal(state.modelClaims.count,3);assert.equal(state.generation,7);assert.equal(Object.keys(state.days).length,2);
  }finally{await insights.close();}
});
test('turning recording off checkpoints the observed partial quarter before stopping',async()=>{
  let now=Date.parse('2026-10-12T01:00:00Z'),enabled=true;const rows:any[]=[],power:any=new EventEmitter();power.getSystemIdleTime=()=>0;
  const sampler=createComputerUsageSampler({powerMonitor:power,owner:()=> 'a',policy:()=>({enabled,generation:'0',timeZone:'UTC'}),persist:(_owner:any,_generation:any,buckets:any)=>rows.push(...buckets),now:()=>now,setTimer:()=>({unref(){}}),clearTimer:()=>{}});
  await sampler.tick();now+=60000;await sampler.tick();assert.equal(rows.length,0);now+=30000;await sampler.checkpoint('a');assert.equal(rows[0].activeMinutes,1.5);
  enabled=false;now+=60000;await sampler.tick();await sampler.close();assert.equal(rows.length,1);
});
test('starting and exiting mid-quarter keep the rest of the day unknown rather than recording zero',async()=>{
  const a=account();let now=Date.parse('2026-10-12T10:07:00Z');const power:any=new EventEmitter();power.getSystemIdleTime=()=>0;
  const sampler=createComputerUsageSampler({powerMonitor:power,owner:()=> 'a',policy:()=>({enabled:true,generation:'0',timeZone:'UTC'}),persist:(_owner:any,_generation:any,buckets:any)=>{const state=dailyDigestState(a);state.computerUsage={buckets:mergeComputerBuckets(state.computerUsage?.buckets??[],buckets)};},now:()=>now,setTimer:()=>({unref(){}}),clearTimer:()=>{}});
  await sampler.tick();assert.equal(computerDay(a,'2026-10-12','UTC'),null);now+=60000;await sampler.tick();now+=30000;await sampler.close();
  const day=computerDay(a,'2026-10-12','UTC');assert.equal(day.activeMinutes,1);assert.equal(day.observedMinutes,1);assert.equal(day.quarterHours[40],1);assert.equal(day.quarterHours[39],null);assert.equal(day.quarterHours[41],null);assert.equal(day.firstUsedAt,'2026-10-12T10:07:00.000Z');assert.equal(day.lastUsedAt,'2026-10-12T10:08:00.000Z');
});
test('closing never starts a new session read, including after the host has closed',async()=>{
  let now=0,hostClosed=false,ownerReads=0;const power:any=new EventEmitter();power.getSystemIdleTime=()=>0;
  const sampler=createComputerUsageSampler({powerMonitor:power,owner:()=>{ownerReads++;assert.equal(hostClosed,false);return 'a';},policy:()=>({enabled:!hostClosed,generation:'0',timeZone:'UTC'}),persist:()=>{},now:()=>now,setTimer:()=>({unref(){}}),clearTimer:()=>{}});
  await sampler.tick();now+=60000;await sampler.tick();const before=ownerReads;hostClosed=true;await sampler.close();assert.equal(ownerReads,before);
});
