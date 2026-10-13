import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateHealthRecord,HEALTH_DEFAULTS,EMPTY_HEALTH} from '../src/personal-health/records-schema.mjs';
import {createHealthRecordsStore} from '../src/personal-health/records-store.mjs';
import {comparison,percentile,healthScores,healthOverview,healthMetrics,healthCalendar,healthWeeklySummary,dailyLoad,healthShiftDay} from '../src/personal-health/analysis.mjs';
import {createHealthInsights,HEALTH_INSIGHT_PROMPT,HEALTH_UNSAFE_TEXT,healthModelSummary,statisticalHealthInsight,validateHealthInsight} from '../src/personal-health/insight.mjs';
import {createHealthOperations} from '../src/personal-health/records-http.mjs';
import {generateHealthSequence} from './helpers/health-sequence.mjs';
import {dailyWindow,projectDailyDigest,recentDigestContext,clearDailyDigests,createDailyDigest} from '../src/personal-access/daily-digest.mjs';
import {createPersonalAccessService} from '../src/personal-access/index.mjs';
import {createPersonalAccessBackend} from '../src/personal-access-backend.mjs';
import {presentPersonalPrompt,isHealthQuestion} from '../src/plugins/personal-prompt.mjs';
const owner='owner-11111111-1111-4111-8111-111111111111',other='owner-22222222-2222-4222-8222-222222222222',to='2026-10-12',zone='Asia/Shanghai';
const v1={version:1,status:'available',steps:6000,sleepMinutes:440,restingHeartRateBpm:62,exerciseMinutes:30,workouts:[{type:'步行',minutes:30}]};
function state(){const data=generateHealthSequence({to});return {version:1,ownerId:owner,generation:1,settings:{...HEALTH_DEFAULTS},days:Object.fromEntries(data.items.map(r=>[r.day,{health:r.health,updatedAt:to+'T00:00:00Z'}]))};}
test('v1 original body passes unchanged; nullable v2 superset and exact nested validation',()=>{
 assert.deepEqual(validateHealthRecord(v1),v1);const good=generateHealthSequence({days:1,to}).items[0].health;assert.deepEqual(validateHealthRecord(good),good);
 for(const patch of [{steps:1.5},{sleepMinutes:1441},{samples:[]},{spo2Pct:101},{hrvSdnnMs:NaN},{sleep:{minutes:1}},{sleep:{minutes:good.sleepMinutes,start:'2026-02-30T23:00:00Z'}},{heartRateHourly:[]},{heartRateHourly:Array(24).fill({avg:30,min:40,max:60})},{workouts:[{type:'walk',minutes:1,zoneMinutes:[1,1,1,1,1]}]},{workouts:[{type:'walk',minutes:1,samples:[]}]},{status:'unavailable'}])assert.throws(()=>validateHealthRecord({...good,...patch}),{code:'INVALID_REQUEST'});
 assert.deepEqual(validateHealthRecord({...EMPTY_HEALTH,version:2,sleep:null,heartRateHourly:null}),{...EMPTY_HEALTH,version:2,sleep:null,heartRateHourly:null});
 const r=validateHealthRecord({...v1,version:2,sleep:{start:null}});assert.equal(r.sleep.minutes,440);assert.throws(()=>validateHealthRecord({...v1,version:2,sleep:{minutes:null}}));
});
test('median and interpolated 15/85 percentiles compare personal history; exactly seven needed',()=>{
 assert.equal(percentile([1,3,5,7],.5),4);assert.equal(percentile([0,10],.15),1.5);
 assert.equal(comparison(10,[1,2,3,4,5,6]).state,'insufficient');assert.equal(comparison(null,[1,2,3,4,5,6,7]).state,'insufficient');assert.equal(comparison(4,[1,2,3,4,5,6,7]).state,'normal');assert.equal(comparison(0,[1,2,3,4,5,6,7]).label,'比平时低');assert.equal(comparison(10,[1,2,3,4,5,6,7]).label,'比平时高');
 assert.equal(comparison(null,[1,2,3,4,5,6,7]).baseline,4);assert.equal(comparison(null,[1,2,3,4,5,6,7]).label,'未记录');
});
test('three scores have documented formulas, partial-input weighting, no fabricated score for insufficient history',()=>{
 const s:any=state(),a=healthScores(s,to,zone);for(const id of ['recovery','sleep','load'])assert.ok(a[id].score>=0&&a[id].score<=100);
 const short:any={settings:HEALTH_DEFAULTS,days:{[to]:{health:structuredClone(v1)}}};for(const v of Object.values(healthScores(short,to,zone)))assert.equal((v as any).score,null);
 s.days[to].health={...v1,version:2};const partial=healthScores(s,to,zone);assert.ok(partial.recovery.missing.includes('hrvSdnnMs'));assert.ok(partial.sleep.missing.includes('deepMinutes'));assert.ok(partial.sleep.score!==null);assert.equal(dailyLoad(s,to),30);
 const constant:any={settings:HEALTH_DEFAULTS,days:{}};for(let n=0;n<65;n++)constant.days[healthShiftDay(to,-n)]={health:{...v1,version:2,activeEnergyKcal:300,hrvSdnnMs:50,wristTempC:35,sleep:{minutes:440,awakeMinutes:0,deepMinutes:70,remMinutes:100}}};
 const c=healthScores(constant,to,zone);assert.equal(c.recovery.score,Math.round((70*.35+70*.3+(440/450*100)*.25+85*.1)));assert.equal(c.load.score,50);assert.equal(c.load.difference,0);assert.equal(c.load.state,'balanced');assert.equal(c.sleep.score,Math.round(((440/450*100)*.45+70*.25+100*.2)/.9));
 constant.days[to].health.activeEnergyKcal=null;const missingEnergy=healthScores(constant,to,zone).load;assert.equal(missingEnergy.score,50);assert.equal(missingEnergy.difference,0);assert.ok(missingEnergy.missing.includes('activeEnergyKcal'));
 constant.days[to].health.sleepMinutes=null;constant.days[to].health.restingHeartRateBpm=null;constant.days[to].health.hrvSdnnMs=null;constant.days[to].health.wristTempC=null;constant.days[to].health.exerciseMinutes=null;constant.days[to].health.activeEnergyKcal=null;constant.days[to].health.workouts=[];constant.days[to].health.sleep=null;for(const r of Object.values(healthScores(constant,to,zone)))assert.equal((r as any).score,null);
});
test('overview, all series and month calendar preserve gaps and use account local days including DST',()=>{
 const s=state(),data=generateHealthSequence({to}),account={dailyDigest:{days:data.usageDays}};const o=healthOverview(s,account,to,zone);assert.equal(o.vitals.length,5);assert.ok(o.connected);assert.equal(o.usage.activeMinutes,data.usageDays[to].usage.estimatedActiveMinutes);
 const series=healthMetrics(s,account,'sleepMinutes',14,to,zone);assert.equal(series.points.length,14);assert.equal(series.points.at(-1).day,to);assert.ok(series.points.some(p=>p.value===null));assert.ok(series.average>0);
 assert.equal(healthCalendar(s,'2026-02',zone).days.length,28);assert.equal(healthCalendar(s,'2028-02',zone).days.length,29);
 const empty=healthOverview({settings:HEALTH_DEFAULTS,days:{}},{},to,zone);assert.equal(empty.connected,false);assert.equal(empty.insight,null);assert.equal(empty.recovery.score,null);
 for(const [day,h]of [['2027-03-14',23],['2026-11-01',25]] as const){const w=dailyWindow(day,'America/New_York');assert.equal((Date.parse(w.to)-Date.parse(w.from))/3600000,h);const seq=generateHealthSequence({to:day,days:8,timeZone:'America/New_York'});seq.items.forEach(r=>validateHealthRecord(r.health));assert.equal(seq.items.at(-1).day,day);}
});
test('synthetic sequence deterministic, includes weekends, low recovery after late nights, raised resting heart rate and gaps',()=>{
 const a=generateHealthSequence({to}),b=generateHealthSequence({to});assert.deepEqual(a,b);assert.notDeepEqual(a,generateHealthSequence({seed:9,to}));a.items.forEach(r=>validateHealthRecord(r.health));assert.equal(a.items.length,90);assert.ok(a.items.some(r=>r.health.status==='unavailable'));assert.ok(a.items.some(r=>r.health.hrvSdnnMs===null&&r.health.status==='available'));
 const s=state();assert.equal(healthScores(s,healthShiftDay(to,-10),zone).recovery.state,'low');assert.equal(healthOverview(s,{dailyDigest:{days:a.usageDays}},healthShiftDay(to,-35),zone).vitals[0].state,'high');
});
test('independent retention, idempotence, atomic batch, migration, settings/clear, owner isolation and restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'weftmate-health-base-'));let now=Date.parse(to+'T02:00:00Z');let store=createHealthRecordsStore({root,clock:()=>now,timeZone:()=>zone});
 try{
 const initial=await store.upsert(owner,generateHealthSequence({to}).items);assert.equal(initial.changedDays.length,90);assert.equal((await store.upsert(owner,generateHealthSequence({to}).items)).changedDays.length,0);
 await store.upsert(owner,[{day:to,health:v1}]);assert.deepEqual((await store.read(owner)).days[to].health,v1);assert.equal(Object.keys((await store.read(other)).days).length,0);
 const before=await store.read(owner);await assert.rejects(store.upsert(owner,[{day:to,health:{...v1,steps:100}},{day:'2026-10-13',health:v1}]),{code:'INVALID_REQUEST'});assert.deepEqual(await store.read(owner),before);
 await assert.rejects(store.upsert(owner,Array.from({length:101},(_,n)=>({day:healthShiftDay(to,-n),health:v1}))),{code:'INVALID_REQUEST'});await assert.rejects(store.upsert(owner,[{day:to,health:v1},{day:to,health:v1}]));
 await store.migrate(owner,{[healthShiftDay(to,-120)]:v1});assert.ok((await store.read(owner)).days[healthShiftDay(to,-120)]);const restart=createHealthRecordsStore({root,clock:()=>now,timeZone:()=>zone});assert.deepEqual(await restart.read(owner),await store.read(owner));await restart.close();
 await store.settings(owner,{retentionDays:90});assert.equal(Object.keys((await store.read(owner)).days).length,90);await store.settings(owner,{retentionDays:null});now+=500*86400000;assert.equal(Object.keys((await store.read(owner)).days).length,90);await store.settings(owner,{retentionDays:400});assert.equal(Object.keys((await store.read(owner)).days).length,0);
 await store.upsert(other,[{day:'2028-02-24',health:v1}]).catch(()=>{});await store.settings(owner,{clear:true,modelInsightsEnabled:false});assert.equal((await store.read(owner)).settings.modelInsightsEnabled,false);assert.equal(Object.keys((await store.read(owner)).days).length,0);
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
test('insight strict structure, medical/medication ban, supported observations and at most one cross-data observation',()=>{
 const s=state(),account={dailyDigest:{days:generateHealthSequence({to}).usageDays}},summary=healthModelSummary(s,account,to,zone),now=Date.parse(to+'T02:00:00Z'),valid={headline:'今天按自己的节奏',text:'昨晚的睡眠已记录，可以看看这几天的变化。',observations:[{text:'睡眠已记录。',inputs:['sleepMinutes']}],suggestions:[{text:'给自己留点休息时间。'}]};
 assert.ok(validateHealthInsight(valid,summary,now));for(const patch of [{extra:'x'},{text:'感冒了，建议吃药。'},{headline:'字'.repeat(17)},{observations:[{text:'未知',inputs:['invented']}]},{suggestions:[{text:'休息',reminder:{title:'休息',time:to+'T00:00:00Z'}}]}])assert.equal(validateHealthInsight({...valid,...patch},summary,now),null);
 assert.ok(validateHealthInsight({...valid,observations:[{text:`比目标多${Math.abs(summary.sleep.minutes-summary.sleep.targetMinutes)}分钟。`,inputs:['sleepMinutes']}]},summary,now));
 assert.equal(validateHealthInsight({...valid,observations:[{text:'同时出现',inputs:['recovery','usageLateNightMinutes']},{text:'同时出现',inputs:['sleepMinutes','usageActiveMinutes']}]},summary,now),null);
 assert.equal(validateHealthInsight({...valid,observations:[{text:'睡眠9999分钟。',inputs:['sleepMinutes']}]},summary,now),null);
 const noLate={...summary,usage7:summary.usage7.map(r=>({...r,lateNightMinutes:0}))};assert.equal(validateHealthInsight({...valid,observations:[{text:'深夜使用与恢复比平时低同时出现。',inputs:['recovery','usageLateNightMinutes']}]},noLate,now),null);
 assert.ok(validateHealthRecord({...v1,version:2,workouts:[{type:'步行',minutes:null}]}));assert.throws(()=>validateHealthRecord({...v1,workouts:[{type:'步行',minutes:null}]}));
 assert.match(HEALTH_INSIGHT_PROMPT,/不说使用导致/);assert.match(HEALTH_INSIGHT_PROMPT,/严禁医学诊断/);assert.match(HEALTH_INSIGHT_PROMPT,/不给对话原文/);assert.ok(!HEALTH_UNSAFE_TEXT.test(JSON.stringify(statisticalHealthInsight(s,account,to,zone,now))));
});
test('model receives only numeric aggregates, background priority, strict fallback for malformed/timeout, max 3 calls and disabled cancels',async()=>{
 const root=await mkdtemp(join(tmpdir(),'weftmate-health-model-')),now=Date.parse(to+'T02:00:00Z'),store=createHealthRecordsStore({root,clock:()=>now,timeZone:()=>zone});let calls=0,captured:any,mode='good';
 const account:any={sessions:{s:{origin:'personal-remote'}},commands:{private:{payload:{text:'PRIVATE CONVERSATION'}}},memory:{text:'PRIVATE MEMORY'},defaultModelProfileId:'model',dailyDigest:{days:generateHealthSequence({to}).usageDays}};
 const context:any={healthRecords:store,timestamp:()=>now,usage:{settings:()=>({timeZone:zone})},accountState:()=>account,serial:(fn:any)=>fn(),callBackend:(fn:any)=>fn(),modelSelectable:()=>true,visibleModels:(_o:any,c:any)=>c,backend:{listModels:async()=>[{id:'model',model:'synthetic'}],modelCompletion:async(input:any)=>{calls++;captured=input;if(mode==='timeout')return new Promise(()=>{});return new Response(JSON.stringify({choices:[{message:{content:mode==='bad'?'bad json':JSON.stringify({headline:'照自己的节奏',text:'睡眠已记录，看看接下来几天的趋势。',observations:[{text:'睡眠已记录',inputs:['sleepMinutes']}],suggestions:[{text:'留点休息时间。'}]})}}]}));}}};
 const service=createHealthInsights(context,{timeoutMs:25});try{
 await store.upsert(owner,generateHealthSequence({to}).items);await service.generate(owner);assert.equal((await store.read(owner)).days[to].insight.mode,'model');assert.equal(captured.priority,'background');const payload=JSON.stringify(captured);for(const token of ['PRIVATE CONVERSATION','PRIVATE MEMORY','heartRateHourly','zoneMinutes','coreMinutes','SYNTHETIC PRIVATE BODY'])assert.ok(!payload.includes(token));assert.equal(JSON.parse(captured.body.messages[1].content).usage7.length,7);
 mode='bad';await store.upsert(owner,[{day:to,health:{...v1,steps:6500}}]);await service.generate(owner);assert.equal((await store.read(owner)).days[to].insight.mode,'statistics');mode='timeout';await store.upsert(owner,[{day:to,health:{...v1,steps:6501}}]);await service.generate(owner);assert.equal((await store.read(owner)).days[to].insight.mode,'statistics');await store.upsert(owner,[{day:to,health:{...v1,steps:6502}}]);await service.generate(owner);assert.equal(calls,3);
 await store.settings(owner,{modelInsightsEnabled:false});await store.upsert(owner,[{day:to,health:{...v1,steps:6503}}]);await service.generate(owner);assert.equal(calls,3);assert.equal((await store.read(owner)).days[to].insight.mode,'statistics');
 await store.settings(owner,{clear:true,modelInsightsEnabled:true});await store.upsert(owner,[{day:to,health:v1}]);await service.generate(owner);assert.equal(calls,3,'clearing does not reset today model request limit');
 }finally{await service.close();await store.close();await rm(root,{recursive:true,force:true});}
});
test('assistant compact query, not-connected response, bounded background and weekly health/usage summary',async()=>{
 const root=await mkdtemp(join(tmpdir(),'weftmate-health-query-')),now=Date.parse(to+'T02:00:00Z'),store=createHealthRecordsStore({root,clock:()=>now,timeZone:()=>zone}),account:any={sessions:{},commands:{},dailyDigest:{days:{}}};
 account.dailyDigest.sources={};account.dailyDigest.weeks={};account.dailyDigest.healthDays={};account.dailyDigest.generation=0;
 const context:any={healthRecords:store,usage:{settings:()=>({timeZone:zone})},timestamp:()=>now,accountState:()=>account};const ops=createHealthOperations(context);
 try{assert.equal((await ops.query(owner,{metric:'overview'})).message,'还没接上');await store.upsert(owner,generateHealthSequence({to}).items);assert.equal((await ops.query(owner,{metric:'sleepMinutes'})).items.length,7);await assert.rejects(ops.query(owner,{metric:'overview',from:'2026-01-01'}));const s=await store.read(owner),data=generateHealthSequence({to});const summary=healthWeeklySummary(s,{dailyDigest:{days:data.usageDays}},healthShiftDay(to,-7),to,zone);assert.match(summary.text,/平均睡眠/);assert.match(summary.text,/凌晨/);
 for(let n=1;n<=7;n++){const day=healthShiftDay(to,-n);account.dailyDigest.days[day]=projectDailyDigest(account,day,zone,[],[],s);}
 const background=recentDigestContext(account,now,zone,3600,s);assert.ok(background.length<=3600);assert.match(background,/恢复/);assert.match(background,/睡眠/);assert.match(background,/负荷/);clearDailyDigests(account,now);assert.equal(Object.keys((await store.read(owner)).days).length,90);
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
test('real HTTP health contract: auth/CSRF, v1 readback, 90-day batch, empty reads, reminder idempotence and tool receipt authorization',async t=>{
 const root=await mkdtemp(join(tmpdir(),'weftmate-health-http-')),known=new Set<string>(),calls:any[]=[],events:any[]=[];let sends=0;
 const backend:any={getStatus:async()=>({runtime:'ready',capabilities:{chat:{available:true}}}),listModels:async()=>[{id:'local',name:'Synthetic',model:'synthetic',configured:true}],preflight:async()=>({ok:true}),createSession:async({sessionId}:any)=>{known.add(sessionId);return {sessionId};},sendMessage:async()=>({accepted:true,receiptId:`receipt-${++sends}`}),cancelSession:async()=>({accepted:true}),readEvents:async()=>({events,nextSeq:events.at(-1)?.seq??-1,hasMore:false}),describeSession:async(id:string)=>known.has(id)?{sessionId:id,agentPreset:'personal-remote',modelProfileId:'local'}:null,schedules:async(input:any)=>{calls.push(input);return input.action==='create'?{item:{id:'native-reminder',kind:'reminder',text:JSON.parse(input.prompt).text}}:{items:[]};}};
 const service=await createPersonalAccessService({root,port:0,backend,clock:()=>Date.parse(to+'T02:00:00Z')});t.after(async()=>{await service.close();await rm(root,{recursive:true,force:true});});
 const {origin,hostId}=await service.start(),grant=await service.issueSetupGrant();const setup=await fetch(origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,username:'HealthSynthetic',password:'synthetic health password',deviceName:'Synthetic'})});assert.equal(setup.status,201);const auth=await setup.json(),cookie=setup.headers.get('set-cookie')!.split(';')[0];
 const req=async(path:string,method='GET',body?:any,csrf=true)=>{const r=await fetch(origin+'/personal/v1'+path,{method,headers:{origin,cookie,'content-type':'application/json',...(csrf?{'x-weftmate-csrf':auth.csrfToken}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 // The synthetic sequence and clock are in Shanghai; the host's OS zone is
 // independent (on Mac this fixture may run before the UTC date's midnight).
 assert.equal((await req('/settings/usage','PATCH',{timeZone:zone})).status,200);
 assert.equal((await fetch(origin+'/personal/v1/health/overview')).status,401);assert.equal((await req('/health/overview')).body.connected,false);assert.equal((await req('/health/calendar?month=2026-10')).body.days.length,31);
 assert.equal((await req('/daily-summaries/'+to+'/health','PUT',v1,false)).status,403);assert.deepEqual((await req('/daily-summaries/'+to+'/health','PUT',v1)).body,{day:to,health:v1});
 const batch=await req('/health/records/batch','PUT',{items:generateHealthSequence({to}).items});assert.equal(batch.status,200,JSON.stringify(batch.body).slice(0,100));assert.equal(batch.body.items.length,90);assert.equal((await req('/health/records/batch','PUT',{items:generateHealthSequence({to}).items})).body.changedDays.length,0);
 for(const path of ['/health/overview?ownerId=other','/health/overview?day=2026-02-30','/health/metrics/sleep?days=8','/health/metrics/raw?days=7','/health/calendar?month=2026-99','/health/overview?day=2026-10-12&day=2026-10-11'])assert.equal((await req(path)).status,400,path);
 assert.equal((await req('/health/metrics/recovery?days=30')).body.points.length,30);
 const creation=await req('/commands','POST',{requestId:'health-session',kind:'session.create',targetDeviceId:hostId,modelProfileId:'local'});let command:any;for(let n=0;n<100;n++){command=(await req('/commands/'+creation.body.command.commandId)).body.command;if(command.state==='accepted_by_dsh')break;await new Promise(r=>setTimeout(r,10));}assert.equal(command.state,'accepted_by_dsh');
 const message=await req('/commands','POST',{requestId:'health-question',kind:'session.message',sessionId:command.sessionId,targetDeviceId:hostId,text:'我最近睡得怎么样',mode:'queue'});let accepted:any;for(let n=0;n<100;n++){accepted=(await req('/commands/'+message.body.command.commandId)).body.command;if(accepted.state==='accepted_by_dsh')break;await new Promise(r=>setTimeout(r,10));}
 assert.equal((await service.handleScheduleRuntime({action:'health_query',sessionId:command.sessionId,sourceReceiptId:accepted.receiptId,query:{metric:'sleepMinutes'}})).items.length,7);await assert.rejects(service.handleScheduleRuntime({action:'health_query',sessionId:command.sessionId,sourceReceiptId:'other',query:{metric:'overview'}}),{code:'FORBIDDEN'});
 await req('/settings/health','PATCH',{modelInsightsEnabled:false});await req('/daily-summaries/'+to+'/health','PUT',{...v1,sleepMinutes:300});const overview=(await req('/health/overview')).body;const suggestion=overview.insight.suggestions.find((s:any)=>s.reminder);assert.ok(suggestion);assert.equal((await req('/health/overview')).body.insight.suggestions[0].id,suggestion.id);
 const reminder='/health/suggestions/'+suggestion.id+'/remind',input={sessionId:command.sessionId,requestId:'health-reminder'};assert.equal((await req(reminder,'POST',input,false)).status,403);assert.equal((await req(reminder,'POST',input)).status,201);assert.equal((await req(reminder,'POST',input)).status,201);const creates=calls.filter(c=>c.action==='create');assert.equal(creates[0].requestId,creates[1].requestId);assert.equal(creates[0].prompt,creates[1].prompt);assert.equal(JSON.parse(creates[0].prompt).kind,'reminder');
 await req('/settings/notifications','PATCH',{reviewRetentionDays:7,reviewClear:true});assert.equal((await req('/health/metrics/sleepMinutes?days=90')).body.points.filter((p:any)=>p.value!==null).length,85);await req('/settings/health','PATCH',{clear:true});assert.equal((await req('/health/overview')).body.connected,false);assert.equal((await req(reminder,'POST',input)).status,404);
});
test('weekly statistics and model health paragraph use aggregates; disabling keeps health numeric inputs out of model',async()=>{
 const health:any=state();let captured:any;
 async function run(enabled:boolean){health.settings.modelInsightsEnabled=enabled;const a:any={sessions:{s:{origin:'personal-remote',title:'合成报告'}},commands:{},defaultModelProfileId:'local'},data=generateHealthSequence({days:10,to:healthShiftDay(to,-1)});
  const context:any={healthRecords:{read:async()=>health},accountState:()=>a,timestamp:()=>Date.parse(to+'T02:00:00Z'),serial:(fn:any)=>fn(),mutate:(_o:any,fn:any)=>fn(a),usage:{settings:()=>({timeZone:zone}),exportAccount:()=>({records:[]})},callBackend:(fn:any)=>fn(),modelSelectable:()=>true,visibleModels:(_o:any,c:any)=>c,backend:{readEvents:async({afterSeq}:any)=>({events:data.events.filter(e=>e.seq>afterSeq),nextSeq:data.events.at(-1).seq,hasMore:false}),listModels:async()=>[{id:'local',model:'synthetic'}],modelCompletion:async(input:any)=>{captured=input;return new Response(JSON.stringify({choices:[{message:{content:enabled?JSON.stringify({usageText:'这周完成了合成报告。',healthInsight:{headline:'看看这周的趋势',text:'这周的睡眠和恢复已经记录，给自己留一点休息时间。',observations:[{text:'睡眠已经记录。',inputs:['sleepMinutes']}],suggestions:[]}}):'这周完成了合成报告。'}}]}));}}};
  const service=createDailyDigest(context);try{await service.refresh(owner);for(let n=0;n<4;n++)await new Promise(r=>setImmediate(r));const report:any=Object.values(a.dailyDigest.weeks)[0];assert.ok(report.health);assert.match(report.text,/这周|睡眠/);assert.equal(report.mode,'model');assert.equal(report.health.mode,enabled?'model':undefined);const wire=captured.body.messages[1].content;assert.ok(!wire.includes('SYNTHETIC PRIVATE BODY'));assert.ok(!wire.includes('heartRateHourly'));assert.ok(!wire.includes('zoneMinutes'));if(enabled){assert.ok(JSON.parse(wire).healthWeek);assert.match(captured.body.messages[0].content,/严禁医学诊断/);}else{assert.ok(Array.isArray(JSON.parse(wire)));assert.ok(!wire.includes('hrvSdnnMs'));assert.ok(JSON.parse(wire).every((d:any)=>d.health===undefined));}}finally{await service.close();}
 }
 await run(true);await run(false);
});
test('health uses the existing lightweight provider mode and leaves ordinary background/chat configuration intact',async()=>{
 const profile={id:'mimo',baseUrl:'https://api.xiaomimimo.com/v1',model:'mimo-v2.6-flash'},sent:any[]=[];
 const backend=createPersonalAccessBackend({profiles:()=>[profile],hasCredential:()=>true,credentialForProfile:()=> 'synthetic-only',modelFetch:async(_url:any,options:any)=>{sent.push(JSON.parse(options.body));return Response.json({});}});
 const body={model:profile.model,messages:[{role:'user',content:'synthetic'}],thinking:{type:'enabled'},max_tokens:1536,stream:false};
 await backend.modelCompletion({ownerId:'owner',profileId:'mimo',priority:'background',body});await backend.modelCompletion({ownerId:'owner',profileId:'mimo',priority:'background',purpose:'health-insight',body});
 assert.equal(sent[0].thinking.type,'enabled');assert.equal(sent[1].thinking.type,'disabled');assert.equal(sent[1].max_tokens,1536);
});
test('health questions present the query directly; ordinary greetings defer its schema and health guidance',()=>{
 for(const question of ['我最近睡得怎么样','这周恢复得如何','熬夜对我第二天影响大吗','最近HRV如何'])assert.equal(isHealthQuestion(question),true);
 assert.equal(isHealthQuestion('你好'),false);const assembly={sections:[],tools:[{name:'load_tools',description:'load',parameters:{}},{name:'health_query',description:'health',parameters:{metric:{type:'string'}}}]};
 const greeting=presentPersonalPrompt(assembly);assert.deepEqual(greeting.tools.map(t=>t.name),['load_tools']);assert.ok(!greeting.sections.some(s=>s.name==='weftmate:health-guidance'));
 const health=presentPersonalPrompt(assembly,new Set(['health_query']));assert.ok(health.tools.some(t=>t.name==='health_query'));assert.match(health.sections.find(s=>s.name==='weftmate:health-guidance').text,/先直接调用 health_query/);
});
