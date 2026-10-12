import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateHealthRecord,validateHealthProfile,HEALTH_DEFAULTS,healthSettingsPatch} from '../src/personal-health/records-schema.mjs';
import {createHealthRecordsStore} from '../src/personal-health/records-store.mjs';
import {healthStress,healthEnergy,healthFitnessAge,invertFitnessAge} from '../src/personal-health/advanced.mjs';
import {healthOverview,healthMetrics,healthShiftDay} from '../src/personal-health/analysis.mjs';
import {healthItemSummary,validateItemAnalysis,createHealthItemAnalysis,HEALTH_ANALYSIS_SCOPES} from '../src/personal-health/item-analysis.mjs';
import {createHealthInsights,healthModelSummary} from '../src/personal-health/insight.mjs';
import {createPersonalAccessService} from '../src/personal-access/index.mjs';
import {generateHealthV3Sequence,generateHealthSequence,generateHealthV3Fixture} from './helpers/health-sequence.mjs';
import {createHealthOperations} from '../src/personal-health/records-http.mjs';
import {observeDigestEvents,projectDailyDigest,recentDigestContext} from '../src/personal-access/daily-digest.mjs';
import {isHealthQuestion} from '../src/plugins/personal-prompt.mjs';
const owner='owner-11111111-1111-4111-8111-111111111111',other='owner-22222222-2222-4222-8222-222222222222',day='2026-10-12',zone='UTC',now=Date.parse(day+'T23:59:59Z');
const v1={version:1,status:'available',steps:6000,sleepMinutes:440,restingHeartRateBpm:60,exerciseMinutes:30,workouts:[]};
function state(){const data=generateHealthV3Sequence({to:day,timeZone:zone});return {generation:1,settings:{...HEALTH_DEFAULTS},profile:data.profile,days:Object.fromEntries(data.items.map(r=>[r.day,{health:r.health}]))};}
function sample(d:string,si:number|null=100,sdnn=50,hr=70){return {time:d+'T12:00:00Z',sdnnMs:sdnn,rmssdMs:null,stressIndex:si,meanHeartRateBpm:hr};}
function constant(days=8){const s:any={generation:1,settings:{...HEALTH_DEFAULTS},days:{}};for(let i=0;i<days;i++){const d=healthShiftDay(day,-i);s.days[d]={health:{...v1,version:3,hrvSamples:[sample(d)]}};}return s;}
test('v1/v2 exact compatibility, v3 nested validation and profile exact nullable shape',()=>{
 assert.deepEqual(validateHealthRecord(v1),v1);const v2=generateHealthSequence({days:1,to:day,timeZone:zone}).items[0].health;assert.deepEqual(validateHealthRecord(v2),v2);
 const v3=generateHealthV3Sequence({days:1,to:day,timeZone:zone}).items[0].health;assert.deepEqual(validateHealthRecord(v3),v3);
 for(const patch of [{version:2},{hrvSamples:[{...sample(day),rrIntervals:[1]}]},{hrvSamples:[sample(day),sample(day)]},{hrvSamples:[{...sample(day),sdnnMs:NaN}]},{hrvSamples:[{...sample(day),stressIndex:-1}]},{hrvSamples:Array(97).fill(sample(day))},{heartRateQuarterHourly:Array(95).fill(null)},{heartRateQuarterHourly:Array(96).fill({avg:60,min:70,max:80})},{sleep:{...v3.sleep,stages:[{start:day+'T01:00:00Z',end:day+'T00:00:00Z',stage:'deep'}]}},{sleep:{...v3.sleep,stages:[{start:day+'T01:00:00Z',end:day+'T02:00:00Z',stage:'unknown'}]}},{status:'unavailable'}])assert.throws(()=>validateHealthRecord({...v3,...patch}),{code:'INVALID_REQUEST'});
 const nullable={version:1,birthYear:null,sex:null,heightCm:null,weightKg:null};assert.deepEqual(validateHealthProfile(nullable,2026),nullable);
 for(const p of [{birthYear:2027},{birthYear:1988.5},{sex:'unknown'},{heightCm:0},{weightKg:Infinity},{ownerId:other},{version:3},{birthYear:undefined},{heightCm:undefined}])assert.throws(()=>validateHealthProfile({...nullable,...p},2026));
 assert.throws(()=>validateHealthProfile({version:1}));assert.throws(()=>healthSettingsPatch({itemAnalysisEnabled:'true'}));assert.equal(HEALTH_DEFAULTS.modelInsightsEnabled,true);assert.equal(HEALTH_DEFAULTS.itemAnalysisEnabled,false);
});
test('stress known percentiles, ties, seven DISTINCT prior days, method-specific fallback and sleep exclusion',()=>{
 const s=constant();assert.equal(healthStress(s,day,zone).score,50);
 for(let n=1;n<=7;n++)s.days[healthShiftDay(day,-n)].health.hrvSamples=[sample(healthShiftDay(day,-n),n*10)];
 s.days[day].health.hrvSamples=[sample(day,40)];assert.equal(healthStress(s,day,zone).score,50);
 s.days[day].health.hrvSamples=[sample(day,100)];assert.equal(healthStress(s,day,zone).score,100);
 const short=constant(7);assert.equal(healthStress(short,day,zone).score,null);assert.equal(healthStress(short,day,zone).baselineDays,6);
 short.days[healthShiftDay(day,-1)].health.hrvSamples=Array.from({length:40},(_,i)=>({...sample(healthShiftDay(day,-1)),time:healthShiftDay(day,-1)+'T12:'+String(i).padStart(2,'0')+':00Z'}));assert.equal(healthStress(short,day,zone).score,null);
 const fallback=constant();for(const [d,row]of Object.entries(fallback.days) as any)row.health.hrvSamples=[sample(d,null)];assert.equal(healthStress(fallback,day,zone).score,50);
 fallback.days[day].health.hrvSamples=[sample(day,null,25,100)];assert.equal(healthStress(fallback,day,zone).score,100);
 const sleeping=constant();sleeping.days[day].health.sleep={start:day+'T11:00:00Z',end:day+'T13:00:00Z'};assert.equal(healthStress(sleeping,day,zone).average,null);
 const none=constant();none.days[day].health.hrvSamples=[];assert.equal(healthStress(none,day,zone).state,'insufficient');assert.equal(healthStress({days:{}},day,zone),null);
});
test('energy known curve points, clipped charge/discharge totals, hourly degradation and gaps/future are never quiet',()=>{
 const s:any=constant(),r=s.days[day].health;r.heartRateQuarterHourly=Array(96).fill({avg:60,min:50,max:70});r.sleep={start:day+'T00:00:00Z',end:day+'T06:00:00Z'};
 const scores={sleep:{score:100},recovery:{score:100}},stress={samples:[{time:day+'T06:00:00Z',value:100}]};
 const e=healthEnergy(s,day,zone,scores,stress);assert.equal(e.curve.length,96);assert.equal(e.curve[0].value,72);assert.equal(e.curve[14].value,100);assert.equal(e.curve[23].value,100);assert.equal(e.curve[24].value,98.8);assert.equal(e.nightCharged,30);assert.equal(e.degraded,false);assert.deepEqual(e.sleepPeriods,[{start:'00:00',end:'06:00'}]);const crossing=structuredClone(s);crossing.days[day].health.sleep.start=healthShiftDay(day,-1)+'T23:00:00Z';assert.deepEqual(healthEnergy(crossing,day,zone,scores,stress).sleepPeriods,[{start:'23:00',end:'06:00'}]);const noSleep=structuredClone(s);delete noSleep.days[day].health.sleep;assert.deepEqual(healthEnergy(noSleep,day,zone,scores,stress).sleepPeriods,[]);assert.equal(healthEnergy(noSleep,day,zone,scores,stress).nightCharged,0);assert.ok(healthEnergy(noSleep,day,zone,scores,stress).missing.includes('sleepTiming'));
 const hourly=structuredClone(s);hourly.days[day].health.heartRateHourly=Array(24).fill({avg:60,min:50,max:70});delete hourly.days[day].health.heartRateQuarterHourly;const h=healthEnergy(hourly,day,zone,scores,stress);assert.deepEqual(h.curve,e.curve);assert.equal(h.degraded,true);
 const missing=structuredClone(s);missing.days[day].health.heartRateQuarterHourly[25]=null;const m=healthEnergy(missing,day,zone,scores,stress);assert.equal(m.curve[25].value,null);assert.equal(m.curve[26].value,97.6);assert.ok(m.missing.includes('heartRateGaps'));
 const early=healthEnergy(s,day,zone,scores,stress,Date.parse(day+'T01:00:00Z'));assert.equal(early.current,78);assert.equal(early.curve[4].value,null);
 assert.equal(healthEnergy(s,day,zone,{sleep:{score:null},recovery:{score:100}},stress).state,'insufficient');assert.equal(healthEnergy({days:{}},day,zone,scores,stress),null);
});
test('fitness age invert known median/interpolation, both sexes, bounds, missing inputs and 60-day freshness',()=>{
 assert.deepEqual(invertFitnessAge(42.4,'male'),{fitnessAge:34.5,bounded:false});assert.equal(invertFitnessAge(40.1,'male').fitnessAge,39.5);assert.equal(invertFitnessAge(30.2,'female').fitnessAge,34.5);assert.deepEqual(invertFitnessAge(90,'male'),{fitnessAge:24.5,bounded:true});
 const s:any=constant();s.profile={version:1,birthYear:1988,sex:'male'};s.days[day].health.vo2Max=42.4;const f=healthFitnessAge(s,day);assert.equal(f.actualAge,38);assert.equal(f.difference,-3.5);assert.equal(f.trend.length,60);assert.deepEqual(f.referenceRange,{low:35.9,high:49.2});const female=structuredClone(s);female.profile.sex='female';assert.deepEqual(healthFitnessAge(female,day).referenceRange,{low:25.3,high:36.1});
 for(const p of [{birthYear:null},{sex:null},{sex:'other'}]){const n=structuredClone(s);Object.assign(n.profile,p);assert.equal(healthFitnessAge(n,day).state,'insufficient');assert.equal(healthFitnessAge(n,day).referenceRange,null);}
 delete s.days[day].health.vo2Max;assert.deepEqual(healthFitnessAge(s,day).missing,['vo2Max']);s.days[healthShiftDay(day,-60)]={health:{...v1,vo2Max:42}};assert.ok(healthFitnessAge(s,day).missing.includes('vo2Max'));assert.equal(healthFitnessAge({days:{}},day),null);
});
test('v3 deterministic synthetic fixtures include pressure rise/energy dip; overview capability, numeric model states and compact queries',async()=>{
 const data=generateHealthV3Sequence({to:day,timeZone:zone}),s:any=state();assert.deepEqual(data,generateHealthV3Sequence({to:day,timeZone:zone}));
 for(const item of data.items)assert.deepEqual(validateHealthRecord(item.health),item.health);
 const fixture=generateHealthV3Fixture({to:day,timeZone:zone});assert.ok(fixture.overview.energy.sleepPeriods.length);assert.deepEqual(fixture.overview.fitnessAge.referenceRange,{low:35.9,high:49.2});const o=healthOverview(s,{},day,zone);assert.deepEqual(o.capabilities,{record:3,profile:true});for(const id of ['stress','energy','fitnessAge'])assert.ok(o[id]);assert.ok(o.load.recommendedRange);assert.equal(o.load.recommendedRange.unit,'relative');
 const low=healthOverview(s,{},healthShiftDay(day,-9),zone);assert.ok(low.stress.average>o.stress.average);assert.ok(low.energy.current<o.energy.current);
 for(const id of ['stress','energy','fitnessAge','vo2Max']){const result=healthMetrics(s,{},id,7,healthShiftDay(day,-14),zone);assert.equal(result.points.at(-1).day,healthShiftDay(day,-14));assert.equal(result.points.length,7);}
 const summary=healthModelSummary(s,{},day,zone);for(const id of ['stress','energy','fitnessAge'])assert.ok(summary[id]?.state);assert.ok(!JSON.stringify(summary).includes('hrvSamples'));
 const ops=createHealthOperations({timestamp:()=>now,healthRecords:{read:async()=>s},usage:{settings:()=>({timeZone:zone})},accountState:()=>({notificationSettings:{reviewEnabled:false},sessions:{}})});try{assert.ok((await ops.query(owner,{metric:'overview'})).items.at(-1).fitnessAge);for(const id of ['stress','energy','fitnessAge'])assert.ok((await ops.query(owner,{metric:id})).items.at(-1).value!==null);}finally{await ops.close();}
 for(const q of ['我今天压力大吗','我的体能年龄是多少','今天电能低吗'])assert.equal(isHealthQuestion(q),true);
});
test('numeric-only item summary, medical/unsupported-number/causality filter and all scopes',()=>{
 const s=state(),a:any={sessions:{},dailyDigest:{days:{}}};for(const scope of HEALTH_ANALYSIS_SCOPES){const summary=healthItemSummary(s,a,scope,day,zone);const wire=JSON.stringify(summary);assert.doesNotMatch(wire,/hrvSamples|heartRateQuarterHourly|stages|SYNTHETIC PRIVATE BODY|workouts|conversations|memory/);const safe={text:'记录已整理，可以看看接下来的趋势。',points:[],basis:summary.basis};assert.ok(validateItemAnalysis(safe,summary));assert.ok(validateItemAnalysis({...safe,text:'10月12日的记录已整理。'},summary));for(const text of ['患有心脏病','建议服药','已有医学结论','导致你的恢复变差','今天压力为 98765 分'])assert.equal(validateItemAnalysis({...safe,text},summary),null);}
});
async function fixture(t:any){const root=await mkdtemp(join(tmpdir(),'weftmate-health5-unit-'));let time=now;const store=createHealthRecordsStore({root,clock:()=>time,timeZone:()=>zone});await store.upsert(owner,generateHealthV3Sequence({to:day,timeZone:zone}).items);await store.profile(owner,{version:1,birthYear:1988,sex:'male',heightCm:175,weightKg:72});let calls=0,captured:any;
 const account:any={sessions:{},commands:{},defaultModelProfileId:'synthetic'},context:any={timestamp:()=>time,healthRecords:store,accountState:()=>account,serial:(fn:any)=>fn(),usage:{settings:()=>({timeZone:zone})},callBackend:(fn:any)=>fn(),modelSelectable:()=>true,visibleModels:(_o:any,c:any)=>c,backend:{listModels:async()=>[{id:'synthetic',model:'synthetic'}],modelCompletion:async(input:any)=>{calls++;captured=input;return Response.json({choices:[{message:{content:JSON.stringify({text:'今天的记录已整理，可以按自己的节奏安排。',points:[],basis:JSON.parse(input.body.messages[1].content).basis})}}]});}}};
 const service=createHealthItemAnalysis(context,{timeoutMs:20});t.after(async()=>{await service.close();await store.close();await rm(root,{recursive:true,force:true});});return {root,store,service,context,account,calls:()=>calls,captured:()=>captured,setTime:(n:number)=>time=n};}
test('OFF fixed assertion: zero item model requests across upload/read/every scope; today switch remains independent',async t=>{
 const f=await fixture(t);assert.equal((await f.store.read(owner)).settings.modelInsightsEnabled,true);
 for(const scope of HEALTH_ANALYSIS_SCOPES)await assert.rejects(f.service.generate(owner,{scope,day}),{code:'AI_ANALYSIS_OFF'});
 await f.service.get(owner,day);healthOverview(await f.store.read(owner),{},day,zone);assert.equal(f.calls(),0,'itemAnalysisEnabled=false MUST send zero item model requests');
 await f.store.settings(owner,{modelInsightsEnabled:false,itemAnalysisEnabled:true});assert.equal((await f.service.generate(owner,{scope:'stress',day})).mode,'model');assert.equal(f.calls(),1);
 const beforeProfile=await f.store.read(owner);await f.store.profile(owner,beforeProfile.profile);assert.equal((await f.store.read(owner)).dataGeneration,beforeProfile.dataGeneration);const claims=(await f.store.read(owner)).itemAnalyses.count;await f.store.settings(owner,{itemAnalysisEnabled:false});assert.equal((await f.store.read(owner)).settings.modelInsightsEnabled,false);assert.equal((await f.service.get(owner,day)).items.length,1);await assert.rejects(f.service.generate(owner,{scope:'stress',day}),{code:'AI_ANALYSIS_OFF'});assert.equal(f.calls(),1);assert.equal((await f.store.read(owner)).itemAnalyses.count,claims);
});
test('model top can run with item OFF; item writes keep existing top insight and top model quota',async t=>{
 const f=await fixture(t);f.context.backend.modelCompletion=async()=>{return Response.json({choices:[{message:{content:JSON.stringify({headline:'看看记录',text:'看看今天的睡眠趋势。',observations:[{text:'睡眠已有记录。',inputs:['sleepMinutes']}],suggestions:[]})}}]});};
 const top=createHealthInsights(f.context);try{await top.generate(owner);const before=await f.store.read(owner);assert.equal(before.days[day].insight.mode,'model');await f.store.settings(owner,{itemAnalysisEnabled:true});const after=await f.store.read(owner);assert.deepEqual(after.days[day].insight,before.days[day].insight);assert.deepEqual(after.modelClaims,before.modelClaims);assert.equal(after.generation,before.generation);}finally{await top.close();}
});
test('same-scope concurrency coalesces, cache survives restart, 40 generation limit is durable and owner isolated',async t=>{
 const f=await fixture(t);await f.store.settings(owner,{modelInsightsEnabled:false,itemAnalysisEnabled:true});const input={scope:'stress',day};const results=await Promise.all([f.service.generate(owner,input),f.service.generate(owner,input)]);assert.deepEqual(results[0],results[1]);assert.equal(f.calls(),1);
 const second=createHealthItemAnalysis(f.context);try{assert.deepEqual(await second.generate(owner,input),results[0]);assert.equal(f.calls(),1);}finally{await second.close();}
 for(let n=1;n<40;n++)await f.service.generate(owner,{scope:'stress',day:healthShiftDay(day,-n)});assert.equal(f.calls(),40);await assert.rejects(f.service.generate(owner,{scope:'sleep',day}),{code:'AI_ANALYSIS_LIMIT'});assert.equal((await f.service.get(other,day)).items.length,0);assert.equal((await f.store.read(other)).profile,undefined);
 await assert.rejects(f.service.generate(other,input),{code:'AI_ANALYSIS_OFF'});await f.store.settings(owner,{clear:true});assert.equal((await f.service.get(owner,day)).items.length,0);await assert.rejects(f.service.generate(owner,{scope:'sleep',day}),{code:'AI_ANALYSIS_LIMIT'});f.setTime(now+86400000);assert.equal((await f.service.get(owner,day)).items.length,0);assert.equal((await f.store.read(owner)).itemAnalyses,undefined);
});
test('model failure/timeout/medical text/invalid structure all return safe statistics; cache hits consume no generation',async t=>{
 const f=await fixture(t);await f.store.settings(owner,{itemAnalysisEnabled:true});const variants=[()=>Promise.reject(Error('synthetic failure')),()=>new Promise(()=>{}),()=>Promise.resolve(Response.json({choices:[{message:{content:'{"text":"感染","points":[],"basis":[]}'}}]})),()=>Promise.resolve(Response.json({choices:[{message:{content:'{}'}}]}))];
 for(let i=0;i<variants.length;i++){f.context.backend.modelCompletion=variants[i];const result=await f.service.generate(owner,{scope:HEALTH_ANALYSIS_SCOPES[i],day});assert.equal(result.mode,'statistics');assert.doesNotMatch(result.text,/感染/);}
 const before=(await f.store.read(owner)).itemAnalyses.count;await f.service.generate(owner,{scope:'recovery',day});assert.equal((await f.store.read(owner)).itemAnalyses.count,before);
});
test('disable aborts in-flight item and discards late output; clear deletes profile and analysis, persistent settings default upgrade',async t=>{
 const f=await fixture(t);await f.store.settings(owner,{itemAnalysisEnabled:true});let resolve:any,started:any;const ready=new Promise(r=>started=r);f.context.backend.modelCompletion=()=>{started();return new Promise(r=>resolve=r);};const pending=f.service.generate(owner,{scope:'stress',day});await ready;f.service.cancel(owner);await f.store.settings(owner,{itemAnalysisEnabled:false});resolve(Response.json({choices:[]}));await assert.rejects(pending,{code:'AI_ANALYSIS_OFF'});assert.equal((await f.service.get(owner,day)).items.length,0);
 await f.store.settings(owner,{clear:true});const s=await f.store.read(owner);assert.equal(s.profile,undefined);assert.equal(s.itemAnalyses,undefined);assert.equal(Object.keys(s.days).length,0);
 const path=join(f.root,'accounts',owner,'health','daily-records.json'),old=JSON.parse(await readFile(path,'utf8'));delete old.settings.itemAnalysisEnabled;await writeFile(path,JSON.stringify(old));assert.equal((await f.store.read(owner)).settings.itemAnalysisEnabled,false);
});
test('real HTTP v1/v2/v3, CSRF, atomic batch/profile validation, historical end, independent week and reminder with no conversation',async t=>{
 const root=await mkdtemp(join(tmpdir(),'weftmate-health5-http-')),known=new Set<string>(),calls:any[]=[];let sends=0,modelCalls=0;
 const backend:any={getStatus:async()=>({runtime:'ready',capabilities:{chat:{available:true}}}),listModels:async()=>[{id:'local',name:'Synthetic',model:'synthetic',configured:true}],preflight:async()=>({ok:true}),createSession:async({sessionId}:any)=>{known.add(sessionId);return {sessionId};},sendMessage:async()=>({accepted:true,receiptId:`receipt-${++sends}`}),cancelSession:async()=>({accepted:true}),readEvents:async()=>({events:[],nextSeq:-1,hasMore:false}),describeSession:async(id:string)=>known.has(id)?{sessionId:id,agentPreset:'personal-remote',modelProfileId:'local'}:null,schedules:async(input:any)=>{calls.push(input);return input.action==='create'?{item:{id:'native-reminder',kind:'reminder',text:JSON.parse(input.prompt).text}}:{items:[]};},modelCompletion:async(input:any)=>{modelCalls++;return Response.json({choices:[{message:{content:JSON.stringify({text:'记录已经整理，可以看看接下来的趋势。',points:[],basis:JSON.parse(input.body.messages[1].content).basis})}}]});}};
 const service=await createPersonalAccessService({root,port:0,backend,clock:()=>now});t.after(async()=>{await service.close();await rm(root,{recursive:true,force:true});});const {origin}=await service.start(),grant=await service.issueSetupGrant();
 const setup=await fetch(origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,username:'Health5Synthetic',password:'synthetic health password',deviceName:'Synthetic'})});assert.equal(setup.status,201);const auth=await setup.json(),cookie=setup.headers.get('set-cookie')!.split(';')[0];
 const req=async(path:string,method='GET',body?:any,csrf=true)=>{const r=await fetch(origin+'/personal/v1'+path,{method,headers:{origin,cookie,'content-type':'application/json',...(csrf?{'x-weftmate-csrf':auth.csrfToken}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 await req('/settings/usage','PATCH',{timeZone:zone});await req('/settings/models','PATCH',{defaultModelProfileId:'local',backgroundModelProfileId:'local'});await req('/settings/health','PATCH',{modelInsightsEnabled:false});
 assert.equal((await req('/health/profile','PUT',{version:1,birthYear:1988,sex:'male',heightCm:null,weightKg:null},false)).status,403);
 const data=generateHealthV3Sequence({to:day,timeZone:zone});assert.equal((await req('/health/profile','PUT',data.profile)).status,200);assert.equal((await req('/health/profile','PUT',{...data.profile,sex:'unknown'})).status,400);
 const mixed=[{day:healthShiftDay(day,-2),health:v1},{day:healthShiftDay(day,-1),health:generateHealthSequence({days:1,to:healthShiftDay(day,-1),timeZone:zone}).items[0].health},data.items.at(-1)];const response=await req('/health/records/batch','PUT',{items:mixed});assert.equal(response.status,200);assert.deepEqual(response.body.items,mixed);
 assert.equal((await req('/health/records/batch','PUT',{items:data.items})).status,200);assert.equal((await req('/health/records/batch','PUT',{items:[data.items[0],{...data.items[1],health:{...data.items[1].health,hrvSamples:[sample(day)]}}]})).status,400);
 for(const path of ['/health/metrics/stress?days=7&to=2026-10-01','/health/metrics/energy?to=2026-10-01&days=30','/health/metrics/fitnessAge','/health/weekly?to=2026-10-12'])assert.equal((await req(path)).status,200,path);
 assert.equal((await req('/health/weekly?to=2026-10-12')).body.health.workouts>0,true);for(const path of ['/health/metrics/stress?to=2026-10-13','/health/metrics/stress?to=2026-10-01&to=2026-10-02','/health/analysis?day=2026-10-13','/health/analysis?ownerId=other'])assert.equal((await req(path)).status,400,path);
 const overview=(await req('/health/overview')).body;for(const id of ['stress','energy','fitnessAge'])assert.ok(overview[id]);assert.deepEqual(overview.capabilities,{record:3,profile:true});
 assert.equal((await req('/health/analysis','POST',{scope:'stress',day})).status,409);assert.equal(modelCalls,0);
 await req('/settings/health','PATCH',{itemAnalysisEnabled:true});const analysis=await req('/health/analysis','POST',{scope:'stress',day});assert.equal(analysis.status,200);assert.equal(analysis.body.mode,'model');assert.deepEqual((await req('/health/analysis','POST',{scope:'stress',day})).body,analysis.body);assert.equal(modelCalls,1);
 await req('/settings/health','PATCH',{itemAnalysisEnabled:false});assert.equal((await req('/health/analysis','POST',{scope:'stress',day})).status,409);assert.equal((await req('/health/analysis?day='+day)).body.items.length,1);
 assert.equal(known.size,0);await req('/daily-summaries/'+day+'/health','PUT',{...data.items.at(-1).health,sleepMinutes:300,sleep:{minutes:300,start:null,end:null}});const suggestion=(await req('/health/overview')).body.insight.suggestions.find((s:any)=>s.reminder);assert.ok(suggestion);
 const path='/health/suggestions/'+suggestion.id+'/remind',input={requestId:'health5-no-conversation'};assert.equal((await req(path,'POST',input)).status,201);assert.equal((await req(path,'POST',input)).status,201);assert.equal(known.size,1);assert.equal(sends,0,'preparing main reminder does not start a model turn');assert.equal(calls.filter(c=>c.action==='create')[0].sessionId,calls.filter(c=>c.action==='create')[1].sessionId);
 await req('/settings/health','PATCH',{clear:true});assert.equal((await req('/health/analysis')).body.items.length,0);assert.equal((await req('/health/overview')).body.fitnessAge,null);
});

test('last night user message timestamp preserves seconds, ignores private/deleted sources and seven-day context includes stress/energy within cap',()=>{
 const s=state(),account:any={sessions:{s:{origin:'personal-remote'},private:{origin:'personal-remote',memoryMode:'off'}},commands:{}};
 const yesterday=healthShiftDay(day,-1);observeDigestEvents(account,'s',[{seq:0,type:'user.message',at:yesterday+'T23:19:37Z',data:{text:'SYNTHETIC PRIVATE BODY'}}],0,zone);
 observeDigestEvents(account,'private',[{seq:0,type:'user.message',at:day+'T02:00:00Z',data:{text:'SYNTHETIC PRIVATE BODY'}}],0,zone);
 assert.equal(healthOverview(s,account,day,zone).usage.lastUsedAt,yesterday+'T23:19:37Z');
 for(let n=1;n<=7;n++){const d=healthShiftDay(day,-n);account.dailyDigest.days[d]=projectDailyDigest(account,d,zone,[],[],s);}
 const context=recentDigestContext(account,now,zone,3600,s);assert.ok(context.length<=3600);assert.match(context,/压力/);assert.match(context,/电能/);assert.doesNotMatch(context,/SYNTHETIC PRIVATE BODY/);
 account.sessions.s.deleting=true;assert.equal(healthOverview(s,account,day,zone).usage.lastUsedAt,null);
});

test('HTTP item switch leaves top model weekly paragraph and pending top jobs untouched',async t=>{
 const f=await fixture(t),week={from:healthShiftDay(day,-7),to:day,usageText:'合成使用回顾',text:'合成使用回顾\n合成模型健康回顾',health:{mode:'model',text:'合成模型健康回顾'}};f.account.dailyDigest={days:{},sources:{},weeks:{[day]:structuredClone(week)}};let cancels=0;
 f.context.healthInsights={cancel:()=>cancels++};f.context.activity={dailyDigest:{cancel:()=>cancels++}};f.context.mutate=(_owner:any,fn:any)=>fn(f.account);f.context.authenticate=()=>({ownerId:owner});f.context.readJson=async()=>({itemAnalysisEnabled:true});f.context.json=()=>{};
 const ops=createHealthOperations(f.context);try{assert.equal(await ops.handleHttp({method:'PATCH'}, {},new URL('http://synthetic.invalid/personal/v1/settings/health'),owner),true);assert.equal(cancels,0);assert.deepEqual(f.account.dailyDigest.weeks[day],week);assert.equal((await f.store.read(owner)).settings.modelInsightsEnabled,true);}finally{await ops.close();}
});

test('ordinary no-RR phone samples use timestamp-matched quarter/hour heart rate without renaming method or inventing missing HR',()=>{
 const s:any=constant();for(const [d,row]of Object.entries(s.days) as any){row.health.hrvSamples=[{...sample(d,null),meanHeartRateBpm:null}];row.health.heartRateQuarterHourly=Array(96).fill({avg:70,min:60,max:80});}
 const q=healthStress(s,day,zone);assert.equal(q.score,50);assert.equal(q.samples[0].method,'sdnnHeartRate');assert.deepEqual(q.missing,['measurementHeartRate']);
 const hourly=structuredClone(s);for(const row of Object.values(hourly.days) as any){row.health.heartRateQuarterHourly=null;row.health.heartRateHourly=Array(24).fill({avg:70,min:60,max:80});}assert.equal(healthStress(hourly,day,zone).score,50);
 const absent=structuredClone(s);delete absent.days[day].health.heartRateQuarterHourly;assert.equal(healthStress(absent,day,zone).score,null);
});
