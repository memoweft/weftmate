import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {health6Synthetic} from './helpers/health-6-synthetic.mjs';
async function setup(options:any={}){
 const context:any={WeftUiCore:{factories:{}},Intl,URLSearchParams};runInNewContext(await readFile(new URL('../src/ui-core/health.js',import.meta.url),'utf8'),context);
 const fixture=health6Synthetic(options),quotes:string[]=[],core:any={state:{ownerId:'synthetic-account',identityGeneration:0},accessApi:async(path:string,options:any)=>fixture.reply(path,options),failureMessage:()=> '连接暂时中断',selectMainChat:async()=>{}};
 if(options.prior)core.saveHealthSettings=async(patch:any)=>{core.priorWrites??=[];core.priorWrites.push(patch);return fixture.reply('/settings/health',{method:'PATCH',body:patch});};
 Object.assign(core,context.WeftUiCore.factories.health(core,{quoteHealth:(text:string)=>quotes.push(text)},{crypto:{randomUUID:()=> 'synthetic'}}));return {core,fixture,quotes,H:context.WeftHealth};
}
test('health display rounds scores, ranges, blood oxygen and minutes; only three metrics retain one decimal',async()=>{
 const {H}=await setup();for(const id of ['recovery','sleep','load','stress','energy','fitnessAge','hrvSdnnMs','restingHeartRateBpm','spo2Pct','exerciseMinutes','steps'])assert.equal(H.value(37.8,id),'38');
 for(const id of ['wristTempC','respiratoryRateBrpm','vo2Max']){assert.equal(H.value(37.8,id),'37.8');assert.equal(H.value(38,id),'38.0');}assert.equal(H.value(null),'—');assert.equal(H.duration(37.8),'0小时38分钟');
});
test('item analysis is off by default, disclosure never writes, enabling generates only the selected scope',async()=>{
 const {core,fixture}=await setup();await core.readHealth();assert.equal(core.health.settings.itemAnalysisEnabled,false);assert.equal(fixture.calls.filter(c=>c.method==='POST').length,0);
 await core.toggleHealthAnalysis('stress');assert.equal(core.health.analysisOpen.has('stress'),true);assert.equal(fixture.calls.filter(c=>c.method!=='GET').length,0);
 await core.enableHealthAnalysis('stress');const writes=fixture.calls.filter(c=>c.method!=='GET');assert.equal(writes.length,2);assert.deepEqual(JSON.parse(JSON.stringify(writes[0].body)),{itemAnalysisEnabled:true});assert.deepEqual(JSON.parse(JSON.stringify(writes[1].body)),{scope:'stress',day:'2026-10-12'});assert.equal(core.health.analyses.size,1);
 await core.toggleHealthAnalysis('stress');await core.toggleHealthAnalysis('stress');assert.equal(fixture.calls.filter(c=>c.method==='POST').length,1);
});
test('cached statistics and model analyses restore without generation and only fill the main draft',async()=>{
 const {core,fixture,quotes}=await setup();await core.readHealth();await core.enableHealthAnalysis('recovery');await core.saveHealthSettings({itemAnalysisEnabled:false});assert.equal(core.health.analyses.has('recovery'),true);
 core.health.analyses.clear();await core.readHealthAnalyses();assert.equal(core.health.analyses.get('recovery').mode,'statistics');await core.askHealthAnalysis('recovery');assert.match(quotes[0],/恢复 AI 分析/);assert.equal(fixture.calls.filter(c=>c.method==='POST').length,1);
});
test('two health toggles remain independent in both directions',async()=>{
 const {core}=await setup();await core.readHealth();await core.saveHealthSettings({itemAnalysisEnabled:true});assert.equal(core.health.settings.modelInsightsEnabled,true);await core.saveHealthSettings({modelInsightsEnabled:false});assert.equal(core.health.settings.itemAnalysisEnabled,true);await core.saveHealthSettings({itemAnalysisEnabled:false});assert.equal(core.health.settings.modelInsightsEnabled,false);
});
test('legacy settings without the field expose neither disclosure nor analysis cache requests',async()=>{
 const {core,fixture}=await setup({legacy:true});await core.readHealth();await core.toggleHealthAnalysis('recovery');assert.equal(core.health.analysisOpen.size,0);assert.equal(fixture.calls.some(c=>c.path.includes('/analysis')),false);
});
test('analysis maps switch-off, daily cap, offline and generation failure to distinct states',async()=>{
 for(const [code,status,expected]of [['AI_ANALYSIS_OFF',409,'off'],['AI_ANALYSIS_LIMIT',429,'limit'],['HOST_OFFLINE',503,'offline'],['FAILED',500,'failed']]){
  const {core,fixture}=await setup();await core.readHealth();await core.saveHealthSettings({itemAnalysisEnabled:true});core.accessApi=async(path:string,opts:any)=>{if(opts?.method==='POST')throw Object.assign(Error(code),{status});return fixture.reply(path,opts);};await core.toggleHealthAnalysis('sleep');assert.equal(core.health.analysisErrors.get('sleep'),expected);assert.equal(core.health.analysisBusy.size,0);if(expected==='off')assert.equal(core.health.settings.itemAnalysisEnabled,false);
 }
});
test('generation skeleton lasts while a request is pending; navigation and identity discard late analysis',async()=>{
 const {core,fixture}=await setup();await core.readHealth();await core.saveHealthSettings({itemAnalysisEnabled:true});let release:any;core.accessApi=async(path:string,opts:any)=>opts?.method==='POST'?new Promise(r=>release=r):fixture.reply(path,opts);
 const request=core.toggleHealthAnalysis('energy');assert.equal(core.health.analysisBusy.has('energy'),true);await core.readHealth('2026-10-11');release({scope:'energy',day:'2026-10-12',text:'old'});await request;assert.equal(core.health.analyses.size,0);assert.equal(core.health.analysisBusy.size,0);
 const next=core.toggleHealthAnalysis('energy');core.state.ownerId='another-synthetic';core.state.identityGeneration++;core.resetHealth();release({scope:'energy',day:'2026-10-11',text:'old'});await next;assert.equal(core.health.analyses.size,0);assert.equal(core.health.settings,null);
});
test('every requested analysis scope is mapped exactly; no top insight or sleep submetric scope is invented',async()=>{
 const {H}=await setup();for(const id of ['recovery','sleep','load','stress','energy','fitnessAge','activity'])assert.equal(H.analysisScope(id),id);for(const id of H.vitals)assert.equal(H.analysisScope(id),'vital:'+id);assert.equal(H.analysisScope('steps'),'activity');assert.equal(H.analysisScope('insight'),null);assert.equal(H.analysisScope('deepMinutes'),null);
});

test('formal v3 objects, null future buckets, missing profile reasons and array vitals use canonical fields',async()=>{
 const {H,fixture}=await setup(),o=fixture.overview();assert.equal(o.stress.latest.value,o.stress.score);assert.equal(o.stress.samples[0].method,'sdnnHeartRate');assert.equal(o.energy.degraded,false);assert.equal(o.energy.curve.length,96);assert.equal(o.energy.curve[0].time,'00:00');assert.equal(o.energy.curve[95].value,null);assert.equal((H.chart(o.energy.curve).path.match(/[ML]/g)||[]).length,74);assert.equal(o.energy.nightCharged,45);assert.equal(o.fitnessAge.fitnessAge,29.2);assert.equal(o.fitnessAge.difference,-4.8);assert.equal(H.clockMinutes('23:45'),1425);assert.equal(H.vital(o,'hrvSdnnMs').value,fixture.base.sequence.items.at(-1).health.hrvSdnnMs);
 assert.match(H.profileHint({missing:['birthYear']}),/出生年份/);assert.ok(!H.profileHint({missing:['birthYear']}).includes('性别'));assert.match(H.profileHint({missing:['sex']}),/性别/);assert.ok(!H.profileHint({missing:['sex']}).includes('出生年份'));assert.match(H.profileHint({missing:['vo2Max']}),/最大摄氧量/);assert.ok(o.load.recommendedRange.high>o.load.recommendedRange.low);
});
test('v3 history uses requested to without a 90-day workaround and caches restore the formal day/items response',async()=>{
 const {core,fixture}=await setup();await core.readHealth();await core.readHealth('2026-08-01');await core.readHealthTrend('stress',14);const request=fixture.calls.findLast(c=>c.path.includes('/metrics/stress'));const url=new URL(request.path,'http://synthetic.invalid');assert.equal(url.searchParams.get('to'),'2026-08-01');assert.equal(url.searchParams.get('days'),'14');assert.equal(core.health.trend.points.at(-1).day,'2026-08-01');
 await core.enableHealthAnalysis('stress');core.health.analyses.clear();await core.readHealthAnalyses();assert.equal(core.health.analyses.get('stress').day,'2026-08-01');assert.equal(fixture.calls.filter(c=>c.method==='POST').length,1);
});

test('health presentation preserves the main settings writer when it is present',async()=>{const {core,fixture}=await setup({prior:true});await core.readHealth();await core.saveHealthSettings({itemAnalysisEnabled:true});assert.equal(core.priorWrites.length,1);assert.equal(fixture.calls.filter(c=>c.method==='PATCH').length,1);assert.equal(core.health.settings.itemAnalysisEnabled,true);});
