import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {healthPageSynthetic} from './helpers/health-page-synthetic.mjs';
async function setup(state='ready'){
  const context:any={WeftUiCore:{factories:{}},Intl,URLSearchParams};runInNewContext(await readFile(new URL('../src/ui-core/human-format.js',import.meta.url),'utf8'),context);runInNewContext(await readFile(new URL('../src/ui-core/health.js',import.meta.url),'utf8'),context);
  const fixture=healthPageSynthetic({state}),writes:any[]=[],quotes:string[]=[],core:any={state:{ownerId:'a',identityGeneration:0,selectedSessionId:'main-session'},accessApi:async(path:string,options:any)=>{if(options){writes.push({path,...options});}return fixture.reply(path);},failureMessage:()=> '连接暂时中断',selectMainChat:async()=>{core.state.selectedSessionId='main-session';}};
  Object.assign(core,context.WeftUiCore.factories.health(core,{quoteHealth:(text:string)=>quotes.push(text)},{crypto:{randomUUID:()=> 'synthetic-request'}}));return {core,fixture,writes,quotes,H:context.WeftHealth};
}
test('health model keeps every contract state and missing value without zero filling',async()=>{
  for(const state of ['ready','short','missing','disconnected','statistical','empty']){const {core,H}=await setup(state);await core.readHealth();assert.equal(core.health.overview.connected,state!=='disconnected');assert.equal(H.value(null),'—');
    if(state==='short')assert.equal(core.health.overview.recovery.score,null);if(state==='missing')assert.equal(core.health.overview.vitals.spo2Pct.value,null);if(state==='statistical')assert.equal(core.health.overview.insight.mode,'statistical');if(state==='empty')assert.equal(core.health.overview.insight,null);}
});
test('health chart breaks at missing days and remains finite for empty, zero and one point',async()=>{
  const {H}=await setup();for(const points of [[],[{value:null}],[{value:0}],[{value:12}],[{value:12},{value:null},{value:17}]]){const chart=H.chart(points);assert.ok(!/NaN|Infinity/.test(chart.path));assert.equal(chart.empty,!points.some(p=>p.value!==null));}
  assert.equal((H.chart([{value:1},{value:null},{value:2}]).path.match(/M/g)||[]).length,2);assert.equal(H.value(0),'0');assert.equal(H.duration(59.8),'1 小时');
});
test('health overlay joins independent series and days respect selected history date',async()=>{
  const {core}=await setup();await core.readHealth();await core.healthOverlay(true);assert.equal(core.health.usage.id,'usageLateNightMinutes');await core.readHealth('2026-10-10');assert.ok(core.health.trend.points.every((p:any)=>p.day<='2026-10-10'));await core.openHealthMetric('sleep','detail');assert.equal(core.health.view,'detail');assert.equal(core.health.metric,'sleep');await core.readHealthTrend('sleep',14);assert.equal(core.health.days,14);await core.readHealthCalendar('2026-09');assert.equal(core.health.calendar.days.length,30);await core.readHealth('2026-06-01');assert.equal(core.health.trend.outsideRange,true);assert.equal(core.health.trend.points.length,0);assert.equal(core.health.overview.recovery.score,null);
});
test('remind is an explicit idempotent write and ask only quotes into the main draft',async()=>{
  const {core,writes,quotes}=await setup();await core.readHealth();const suggestion=core.health.overview.insight.suggestions[0];await core.remindHealth(suggestion);await core.remindHealth(suggestion);assert.equal(writes.length,1);assert.deepEqual(JSON.parse(JSON.stringify(writes[0].body)),{sessionId:'main-session',requestId:'synthetic-request'});assert.equal(writes[0].protectedWrite,true);await core.askHealth();assert.match(quotes[0],/^> 2026-10-12/);assert.equal(writes.length,1);
});
test('a late response from the prior account cannot repopulate health or trend',async()=>{
  const {core,fixture}=await setup();let release:any;core.accessApi=()=>new Promise(r=>release=r);const read=core.readHealth();core.state.ownerId='b';core.state.identityGeneration++;core.resetHealth();release(fixture.overview());await read;assert.equal(core.health.overview,null);assert.equal(core.health.reminders.size,0);
});

test('uncertain reminder retries preserve the exact intent after navigating to another chat',async()=>{
  const {core,fixture}=await setup();await core.readHealth();const attempts:any[]=[];core.accessApi=async(path:string,options:any)=>{attempts.push(JSON.parse(JSON.stringify(options.body)));if(attempts.length===1)throw Error('connection lost');return fixture.reply(path);};
  const suggestion=core.health.overview.insight.suggestions[0];await assert.rejects(core.remindHealth(suggestion));assert.equal(core.health.busy.size,0);core.state.selectedSessionId='other-chat';await core.remindHealth(suggestion);assert.deepEqual(attempts[0],attempts[1]);assert.equal(core.health.reminders.size,1);
});

test('personal low/high and more/less states preserve the server labels and measurements',async()=>{
  for(const [state,label]of [['low','比平时低'],['high','比平时高'],['normal','正常'],['insufficient','再戴几天就有对比了']]){
    const {core,fixture}=await setup();core.accessApi=async(path:string)=>{const result=fixture.reply(path);if(path.includes('/overview')){result.vitals.hrvSdnnMs={...result.vitals.hrvSdnnMs,state,label};result.load={...result.load,state:state==='low'?'less':state==='high'?'more':'balanced',label:state==='low'?'练少了':state==='high'?'练多了':'刚好'};}return result;};await core.readHealth();assert.equal(core.health.overview.vitals.hrvSdnnMs.state,state);assert.equal(core.health.overview.vitals.hrvSdnnMs.label,label);assert.equal(core.health.overview.load.state,state==='low'?'less':state==='high'?'more':'balanced');
  }
});

test('sleep stages use existing metric reads and the 14 day comparison survives a 7 day chart selection',async()=>{
  const {core,fixture}=await setup();await core.readHealth();assert.equal(core.health.overview.sleep.deepMinutes,undefined);assert.equal(core.health.sleepStages.deepMinutes,fixture.metric('deepMinutes',7).points.at(-1).value);
  const average=core.health.scoreAverages.sleep;assert.equal(average,fixture.metric('sleep',14).average);await core.openHealthMetric('sleep','detail');await core.readHealthTrend('sleep',7);assert.equal(core.health.scoreAverages.sleep,average);await core.openHealthMetric('load','detail');assert.equal(core.health.dimensionMetrics.exerciseMinutes.value,fixture.metric('exerciseMinutes',7).points.at(-1).value);assert.equal(core.health.dimensionLoading,false);
});

test('a missing stage or failed stage read never blanks the rest of the overview',async()=>{
  const {core,fixture}=await setup();core.accessApi=async(path:string)=>{if(path.includes('/metrics/deepMinutes'))throw Error('unavailable');return fixture.reply(path);};await core.readHealth();assert.equal(core.health.error,'');assert.equal(core.health.sleepStages.deepMinutes,null);assert.equal(core.health.stageError,'连接暂时中断');assert.ok(core.health.sleepStages.remMinutes>0);assert.ok(core.health.overview.sleep.minutes>0);
});

test('refreshes during the first health read cannot starve completed sleep stages',async()=>{
  for(const missing of [false,true]){
    const {core,fixture}=await setup();let releaseFirst!:()=>void,releaseLater!:()=>void,started!:()=>void;
    const firstMetrics=new Promise<void>(r=>releaseFirst=r),laterMetrics=new Promise<void>(r=>releaseLater=r),metricsStarted=new Promise<void>(r=>started=r);
    let overviews=0;
    core.accessApi=async(path:string)=>{
      if(path.includes('/overview'))overviews++;
      if(path.includes('/metrics/')){const first=overviews===1;started();await(first?firstMetrics:laterMetrics);}
      const result=fixture.reply(path);
      if(missing&&/\/metrics\/(deepMinutes|remMinutes|awakeMinutes|inBedMinutes)/.test(path))for(const point of result.points)point.value=null;
      return result;
    };
    const initial=core.readHealth();await metricsStarted;
    // Timeline/foreground refreshes can arrive before the first supplement batch completes.
    const refreshes=[core.readHealth(),core.readHealth(core.health.day)];
    try{
      releaseFirst();await initial;
      assert.equal(core.health.supplementLoading,false,'successful first supplements must reach the page despite overlapping refreshes');
      assert.equal(core.health.sleepStages.deepMinutes,missing?null:fixture.metric('deepMinutes',7).points.at(-1).value);
      assert.equal(overviews,1,'same-day refreshes share the full in-flight read');
    }finally{releaseLater();await Promise.all(refreshes);}
  }
});

test('changing the health date supersedes an in-flight read without accepting its late stages',async()=>{
  const {core,fixture}=await setup();let release!:()=>void,started!:()=>void;
  const gate=new Promise<void>(r=>release=r),metricsStarted=new Promise<void>(r=>started=r);
  core.accessApi=async(path:string)=>{if(path.includes('/metrics/')&&core.health.day===fixture.today){started();await gate;}return fixture.reply(path);};
  const initial=core.readHealth();await metricsStarted;
  const day='2026-10-10';await core.readHealth(day);
  assert.equal(core.health.day,day);assert.equal(core.health.supplementLoading,false);
  const stages=JSON.stringify(core.health.sleepStages);release();await initial;
  assert.equal(core.health.day,day);assert.equal(JSON.stringify(core.health.sleepStages),stages);
  assert.equal(core.health.sleepStages.deepMinutes,fixture.metric('deepMinutes',7).points.find((p:any)=>p.day===day).value);
  // Completion of the superseded read must not retain the deduplication entry.
  let overviews=0;const read=core.accessApi;core.accessApi=async(path:string)=>{if(path.includes('/overview'))overviews++;return read(path);};
  await core.readHealth(day);assert.equal(overviews,1);
});
