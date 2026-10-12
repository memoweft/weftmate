import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {healthPageSynthetic} from './helpers/health-page-synthetic.mjs';
async function setup(state='ready'){
  const context:any={WeftUiCore:{factories:{}},Intl,URLSearchParams};runInNewContext(await readFile(new URL('../src/ui-core/health.js',import.meta.url),'utf8'),context);
  const fixture=healthPageSynthetic({state}),writes:any[]=[],quotes:string[]=[],core:any={state:{ownerId:'a',identityGeneration:0,selectedSessionId:'main-session'},accessApi:async(path:string,options:any)=>{if(options){writes.push({path,...options});}return fixture.reply(path);},failureMessage:()=> '连接暂时中断',selectMainChat:async()=>{core.state.selectedSessionId='main-session';}};
  Object.assign(core,context.WeftUiCore.factories.health(core,{quoteHealth:(text:string)=>quotes.push(text)},{crypto:{randomUUID:()=> 'synthetic-request'}}));return {core,fixture,writes,quotes,H:context.WeftHealth};
}
test('health model keeps every contract state and missing value without zero filling',async()=>{
  for(const state of ['ready','short','missing','disconnected','statistical','empty']){const {core,H}=await setup(state);await core.readHealth();assert.equal(core.health.overview.connected,state!=='disconnected');assert.equal(H.value(null),'—');
    if(state==='short')assert.equal(core.health.overview.recovery.score,null);if(state==='missing')assert.equal(core.health.overview.vitals.spo2Pct.value,null);if(state==='statistical')assert.equal(core.health.overview.insight.mode,'statistical');if(state==='empty')assert.equal(core.health.overview.insight,null);}
});
test('health chart breaks at missing days and remains finite for empty, zero and one point',async()=>{
  const {H}=await setup();for(const points of [[],[{value:null}],[{value:0}],[{value:12}],[{value:12},{value:null},{value:17}]]){const chart=H.chart(points);assert.ok(!/NaN|Infinity/.test(chart.path));assert.equal(chart.empty,!points.some(p=>p.value!==null));}
  assert.equal((H.chart([{value:1},{value:null},{value:2}]).path.match(/M/g)||[]).length,2);assert.equal(H.value(0),'0');
});
test('health overlay joins independent series and days respect selected history date',async()=>{
  const {core}=await setup();await core.readHealth();await core.healthOverlay(true);assert.equal(core.health.usage.id,'usageLateNightMinutes');await core.readHealth('2026-10-10');assert.ok(core.health.trend.points.every((p:any)=>p.day<='2026-10-10'));await core.openHealthMetric('sleep','detail');assert.equal(core.health.view,'detail');assert.equal(core.health.metric,'sleep');await core.readHealthTrend('sleep',14);assert.equal(core.health.days,14);await core.readHealthCalendar('2026-09');assert.equal(core.health.calendar.days.length,30);
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
