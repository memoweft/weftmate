import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryDigest,digestWindow,digestLocalInstant,projectDigest,memoryDigestState,recordDigestMutation,reconcileDigests,confirmDigestMemory } from '../src/personal-access/memory-digest.mjs';
import { notificationDefaults,validateNotificationSettings } from '../src/personal-access/notification-policy.mjs';
import { handlePersonalMemoryHttp } from '../src/personal-memory/http.mjs';
import { memoryItemsFormedInWindow } from '../src/personal-memory/world-projection.mjs';
import { createMemoryHttpHandler } from '../src/personal-access/memory-http.mjs';
const at=Date.parse('2026-10-11T13:00:00Z');
const row=(id:string,created='2026-10-09T00:00:00Z',text=`合成记忆 ${id}`)=>({item_id:id,object_kind:'cognition',created_at:created,updated_at:created,current_state:'current',value:{content:text},lifecycle:{}});
function fixture(rows:any[]=[row('new')]){
  const account:any={sessions:{},commands:{}};let now=at,revision=1,unavailable=false,queries=0;
  const status=()=>({state:unavailable?'unavailable':'ready',worldRevision:revision,capabilities:{list:true}});
  const context:any={accountState:()=>account,serial:(fn:any)=>fn(),mutate:(_id:string,fn:any)=>fn(account),timestamp:()=>now,backend:{},usage:{settings:()=>({timeZone:'Asia/Shanghai'})},
    memoryManager:{query:async(_id:string,_method:string,params:any)=>{queries++;return {world_revision:revision,items:rows.filter(row=>row.object_kind===params.object_kind)};}}};
  let service=createMemoryDigest(context);
  return {account,context,status,rows,refresh:()=>service.refresh('owner',status()),restart:()=>{service=createMemoryDigest(context);},advance:(value:number)=>{now+=value;},change:()=>revision++,unavailable:(value:boolean)=>{unavailable=value;},queries:()=>queries,noteUse:(items:any[])=>service.noteUse('owner',items)};
}
test('weekly account timezone bounds are inclusive/exclusive and keep local time through DST',()=>{
  const window=digestWindow(at,'Asia/Shanghai',notificationDefaults);assert.equal(window.from,'2026-10-04T13:00:00.000Z');assert.equal(window.to,'2026-10-11T13:00:00.000Z');
  assert.equal(digestWindow(at-1,'Asia/Shanghai',notificationDefaults).key,'2026-10-04');
  const dst=digestWindow(Date.parse('2026-11-02T02:00:00Z'),'America/New_York',notificationDefaults);assert.equal(Date.parse(dst.to)-Date.parse(dst.from),169*3600000);
  assert.equal(digestLocalInstant('2026-11-01','01:30','America/New_York'),Date.parse('2026-11-01T05:30:00Z'));
  assert.equal(digestLocalInstant('2027-03-14','02:30','America/New_York'),Date.parse('2027-03-14T07:30:00Z'));
  const result=projectDigest([row('start',window.from),row('end',window.to)],{lastUsed:{},reviewed:{},changes:[]},window,at);assert.deepEqual(result.added.map((row:any)=>row.id),['start']);
});
test('missed weeks catch up only latest once across restart, with generic notifications',async()=>{
  const f=fixture();f.advance(3*86400000);await f.refresh();const reports=Object.values(f.account.activity.items) as any[];assert.equal(reports.length,1);
  assert.deepEqual(reports[0].notification.title,'本周记忆周报已生成');assert.equal(reports[0].notification.body.includes('合成'),false);
  await f.refresh();f.restart();await f.refresh();assert.equal(Object.keys(f.account.activity.items).length,1);
});
test('empty week emits nothing, unavailable/disabled neither advances nor errors and recovery catches up',async()=>{
  const empty=fixture([]);await empty.refresh();assert.equal(Object.keys(empty.account.activity.items).length,0);
  const f=fixture();f.unavailable(true);await f.refresh();assert.equal(f.account.activity,undefined);
  f.unavailable(false);f.account.notificationSettings={memoryDigestEnabled:false};await f.refresh();assert.equal(Object.keys(f.account.activity.items).length,0);assert.equal(f.account.activity.memoryDigest.lastWindow,undefined);
  f.account.notificationSettings.memoryDigestEnabled=true;await f.refresh();assert.equal(Object.keys(f.account.activity.items).length,1);
  const service=createMemoryDigest(f.context);const before=f.queries();await service.refresh('owner',{state:'disabled',capabilities:{list:true}});assert.equal(f.queries(),before);
});
test('too many memories fold deterministically; edits update report and deletion removes content without notifying again',async()=>{
  const f=fixture(Array.from({length:9},(_,i)=>row(`n${i}`)));await f.refresh();const report:any=Object.values(f.account.activity.items)[0];assert.equal(report.memoryDigest.added.length,6);assert.equal(report.memoryDigest.moreCount,3);
  const selected=report.memoryDigest.added[0],source=f.rows.find(row=>row.item_id===selected.id);source.value.content='已纠正的合成表达';recordDigestMutation(f.account,{requestId:'correct-1',operation:'correct',keys:[`cognition:${selected.id}`],at:new Date(at).toISOString()});
  f.change();await f.refresh();assert.equal(report.memoryDigest.added[0].text,'已纠正的合成表达');
  recordDigestMutation(f.account,{requestId:'forget-1',operation:'delete',keys:[`cognition:${selected.id}`],at:new Date(at).toISOString()});f.rows.splice(f.rows.indexOf(source),1);f.change();await f.refresh();
  assert.equal(report.memoryDigest.added[0].status,'forgotten');assert.equal(JSON.stringify(f.account.activity).includes('已纠正的合成表达'),false);
});
test('review uses recorded recall, excludes recently used, three at most and confirmation suppresses for 90 days',async()=>{
  const f=fixture([row('new'),...Array.from({length:5},(_,i)=>row(`old${i}`,'2026-01-01T00:00:00Z'))]);await f.noteUse([{kind:'cognition',id:'old0'}]);await f.refresh();
  const item:any=Object.values(f.account.activity.items)[0];assert.equal(item.memoryDigest.review.length,3);assert.equal(item.memoryDigest.review.some((row:any)=>row.id==='old0'),false);
  const ref=item.memoryDigest.review[0];confirmDigestMemory(f.account,item.id,ref,new Date(at).toISOString());assert.equal(ref.status,'confirmed');
  const state=memoryDigestState(f.account),window=digestWindow(at+7*86400000,'Asia/Shanghai',notificationDefaults);
  assert.equal(projectDigest(f.rows,state,window,at+7*86400000).review.some((row:any)=>row.id===ref.id),false);
  assert.equal(projectDigest([f.rows.find(row=>row.item_id===ref.id)],state,window,at+90*86400000).review[0].id,ref.id);
});
test('confirmed operations are deduplicated and count only their week; mismatched review target fails',()=>{
  const account:any={sessions:{},commands:{}};const state=memoryDigestState(account),change={requestId:'edit',operation:'correct',keys:['cognition:old'],at:'2026-10-08T00:00:00Z'};
  recordDigestMutation(account,change);recordDigestMutation(account,change);recordDigestMutation(account,{requestId:'forget',operation:'delete',keys:['cognition:x','entity:y'],at:'2026-10-08T00:00:00Z'});
  const report=projectDigest([row('old','2026-01-01T00:00:00Z')],state,digestWindow(at,'Asia/Shanghai',notificationDefaults),at);assert.equal(report.correctedCount,1);assert.equal(report.forgottenCount,2);
  assert.throws(()=>confirmDigestMemory(account,'absent',{kind:'cognition',id:'old'},new Date(at).toISOString()),{code:'REQUEST_CONFLICT'});
  assert.throws(()=>validateNotificationSettings({memoryDigestWeekday:7}));assert.throws(()=>validateNotificationSettings({memoryDigestTime:'25:00'}));
});
test('weekly list filter paginates with bounds bound to cursor and rejects changed filters',async()=>{
  const rows=[row('before','2026-10-03T00:00:00Z'),row('inside'),row('inside2'),row('after','2026-10-12T00:00:00Z')];
  const manager={query:async()=>({world_revision:1,items:rows})};const base='http://synthetic/personal/v1/memory/items?kind=cognition&limit=1&from=2026-10-04T13:00:00Z&to=2026-10-11T13:00:00Z';
  const call=(url:string)=>handlePersonalMemoryHttp({manager,ownerId:'owner',request:{method:'GET'},url:new URL(url),pathname:'/personal/v1/memory/items',readJson:async()=>({})});
  const first=await call(base);assert.equal(first.body.items[0].id,'inside');assert.equal(first.body.totalCount,2);
  assert.equal((await call(`${base}&after=${first.body.nextCursor}`)).body.items[0].id,'inside2');
  await assert.rejects(call(`${base.replace('2026-10-04','2026-10-05')}&after=${first.body.nextCursor}`),{code:'INVALID_REQUEST'});
});
test('real Core correction links switch report actions to the replacement id and recover natural corrections without a new query',async()=>{
  const f=fixture([row('new'),row('old','2026-01-01T00:00:00Z')]);await f.refresh();
  const item:any=Object.values(f.account.activity.items)[0],original=f.rows[0];
  const transition={transition_id:'correct-new',transition_kind:'corrects',object_kind:'cognition',prior_item_id:'new',replacement_item_id:'replacement',occurred_at:null};
  original.current_state='not_current';original.lifecycle={invalid_at:'2026-10-11T14:00:00Z'};original.transition_history=[transition];
  f.rows.push({...row('replacement','2026-10-11T14:00:00Z','真正的新编号与纠正内容'),transition_history:[transition]});f.change();await f.refresh();
  assert.equal(item.memoryDigest.added[0].id,'replacement');assert.equal(item.memoryDigest.added[0].text,'真正的新编号与纠正内容');assert.equal(item.memoryDigest.added[0].status,'corrected');
  assert.equal(memoryItemsFormedInWindow(f.rows,item.memoryDigest.from,item.memoryDigest.to)[0].item_id,'replacement');
  const next=digestWindow(at+7*86400000,'Asia/Shanghai',notificationDefaults),projected=projectDigest(f.rows,memoryDigestState(f.account),next,at+7*86400000);
  assert.equal(projected.correctedCount,1);assert.equal(projected.corrected[0].id,'replacement');assert.equal(projected.addedCount,0);
});
test('mute or archive never claims deletion; a missing replacement erases the digest content',async()=>{
  const f=fixture();await f.refresh();const item:any=Object.values(f.account.activity.items)[0];
  f.rows[0].lifecycle={muted_at:'2026-10-11T14:00:00Z'};f.rows[0].current_state='not_current';f.change();await f.refresh();assert.equal(item.memoryDigest.added[0].status,'unavailable');assert.equal(item.memoryDigest.added[0].statusLabel,'已停用');
  f.rows.splice(0,1);f.change();await f.refresh();assert.equal(item.memoryDigest.added[0].status,'forgotten');assert.equal(item.memoryDigest.added[0].text,'');
});
test('a committed receipt left pending is recovered by the host observation after restart',async()=>{
  const f=fixture();const state=memoryDigestState(f.account);state.pending={pending:{requestId:'pending',operation:'correct',keys:['cognition:new'],at:'2026-10-10T00:00:00Z'}};
  f.context.memoryManager.receiptByRequest=async()=>({receipt:{result_state:'applied'}});await f.refresh();const item:any=Object.values(f.account.activity.items)[0];assert.equal(item.memoryDigest.correctedCount,1);assert.deepEqual(state.pending,{});assert.equal(state.changes.length,1);
  f.restart();await f.refresh();assert.equal(state.changes.length,1);
});
test('changing weekday avoids overlapping already reported memory and coherent revision reads retry silently',async()=>{
  const f=fixture();await f.refresh();f.account.notificationSettings={memoryDigestWeekday:6,memoryDigestTime:'21:00',memoryDigestEnabled:true};
  f.advance(6*86400000);f.rows.push(row('next','2026-10-12T00:00:00Z'));f.change();await f.refresh();const reports=Object.values(f.account.activity.items) as any[];
  const latest=reports.find(item=>item.memoryDigest.key==='2026-10-17');assert.equal(latest.memoryDigest.from,'2026-10-11T13:00:00.000Z');assert.deepEqual(latest.memoryDigest.added.map((row:any)=>row.id),['next']);
  const mixed=fixture();const original=mixed.context.memoryManager.query;let raced=false;
  mixed.context.memoryManager.query=async(...args:any[])=>{if(args[2].operation==='revision'&&!raced){raced=true;mixed.change();}return original(...args);};
  await mixed.refresh();assert.equal(mixed.account.activity,undefined);await mixed.refresh();assert.equal(Object.keys(mixed.account.activity.items).length,1);
});
test('a deletion during a snapshot invalidates it before it can restore forgotten report text',async()=>{
  const f=fixture();await f.refresh();const service=createMemoryDigest(f.context),item:any=Object.values(f.account.activity.items)[0],query=f.context.memoryManager.query;let raced=false;
  f.context.memoryManager.query=async(...args:any[])=>{const result=await query(...args);if(args[2].operation==='revision'&&!raced){raced=true;recordDigestMutation(f.account,{requestId:'racing-delete',operation:'delete',keys:['cognition:new'],at:new Date(at).toISOString()});service.invalidate('owner');}return result;};
  await service.refresh('owner',f.status());assert.equal(item.memoryDigest.added[0].status,'forgotten');assert.equal(item.memoryDigest.added[0].text,'');
});
test('digest bookkeeping preserves the existing invalid-request response for a null command body',async()=>{
  const url=new URL('http://synthetic/personal/v1/memory/items/cognition/new/correct');
  const context:any={authenticate:()=>({ownerId:'owner',deviceId:'device'}),readJson:async()=>null,memoryManager:{},timestamp:()=>at};
  await assert.rejects(createMemoryHttpHandler(context).handleMemoryHttp({method:'POST'},{},url,url.pathname,'owner','device'),{code:'INVALID_REQUEST',status:400});
});
