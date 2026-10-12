import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {weeklyDayPhrase,statisticalInsight} from '../src/personal-access/daily-digest.mjs';
import {startFe1bFixture} from './integration/fe-1b-fixture.mjs';
import {createDshSessionAdapter} from '../src/runtime/dsh-adapter/sessions.mjs';
const context:any={WeftUiCore:{factories:{}}};
for(const file of ['timeline-model','account','settings-registry','composer'])runInNewContext(readFileSync(new URL(`../src/ui-core/${file}.js`,import.meta.url),'utf8'),context);
const api=context.WeftUiCore;
test('n: local account identity is readable and cloud email or custom nickname is preserved',()=>{
 assert.equal(api.accountLabel({username:'local-owner',displayName:'我的账户'}),'只在这台电脑上用');
 assert.equal(api.accountLabel({username:'local-owner',displayName:'local-owner'},'test@example.test'),'test@example.test');
 assert.equal(api.accountLabel({username:'sample',displayName:'纸船'}),'纸船');
 assert.equal(api.accountLabel({displayName:'local-owner'}),'我的账户');
});
test('r: consecutive weekly observations use all-week, date range or day count',()=>{
 const days=Array.from({length:7},(_,i)=>`2026-10-${String(5+i).padStart(2,'0')}`);
 assert.equal(weeklyDayPhrase(days),'这周每天');assert.equal(weeklyDayPhrase(days.slice(0,4)),'周一到周四');
 assert.equal(weeklyDayPhrase([days[0],days[2],days[4],days[6]]),'这周有四天');
 assert.equal(weeklyDayPhrase([days[0],days[0]]),'周一');
 const summaries=days.map(day=>({day,tasks:{completed:0,items:[]},outputs:{count:0,items:[]},usage:{hourlyTurns:[0,1,0,0,0,0]},conversations:{items:[]}}));
 assert.match(statisticalInsight(summaries).text,/这周每天凌晨一点后/);assert.doesNotMatch(statisticalInsight(summaries).text,/周一、周二/);
 const prompt=readFileSync(new URL('../src/personal-access/daily-digest.mjs',import.meta.url),'utf8');assert.match(prompt,/不要逐个列举星期/);
});
test('u: review and health have one searchable entry next to notifications',()=>{
 const registry=api.settingsRegistry(),ids=Array.from(registry.list(),(r:any)=>r.id);
 assert.equal(ids[ids.indexOf('notifications')+1],'reviewHealth');assert.equal(ids.includes('healthData'),false);
 for(const query of ['回顾','洞察','健康','睡眠 恢复','数据 保留'])assert.equal(registry.list({query})[0]?.id,'reviewHealth');
 assert.equal(registry.list({query:'勿扰'})[0].id,'notifications');
});
const event=(seq:number,type:string,data:any,sessionId='side')=>({seq,type,data,sessionId});
test('o: history before the send acknowledgement consumes the exact placeholder before repaint',()=>{
 const native=event(2,'user.message',{receiptId:'rpc:a',text:'相同文字'});
 const core:any={state:{ownerId:'owner',identityGeneration:1,selectedSessionId:'side',historyEvents:new Map([[2,native]])}};
 let painted=-1;
 const actions=api.factories.composer(core,{readMessageDraft:()=>'',renderOptimisticMessages:()=>{painted=actions.optimisticMessages(true).length;}},{});
 actions.beginOptimistic({requestId:'request-a',sessionId:'side',text:'相同文字'});
 actions.reconcileOptimistic({requestId:'request-a',receiptId:'rpc:a',state:'accepted_by_dsh'});
 assert.equal(painted,0);assert.equal(actions.optimisticMessages(true).length,0);
 actions.beginOptimistic({requestId:'request-b',sessionId:'side',text:'相同文字'});
 actions.observeOptimistic([event(3,'task.queued',{requestId:'request-b',receiptId:'rpc:b'}),event(4,'user.message',{receiptId:'rpc:b',text:'相同文字'})],true);
 assert.equal(actions.optimisticMessages(true).length,0);
 actions.beginOptimistic({requestId:'request-c',sessionId:'side',text:'相同文字'});
 actions.observeOptimistic([event(5,'task.queued',{requestId:'request-c',receiptId:'rpc:c'},'other'),event(6,'user.message',{receiptId:'rpc:c',text:'相同文字'},'other')],true);
 assert.equal(actions.optimisticMessages(true).length,1);
});
test('o: claimed native receipt has one user message without its queue echo',()=>{
 const events=[event(1,'task.queued',{receiptId:'rpc:a',taskId:'rpc:a',text:'做同一件事'}),event(2,'user.message',{receiptId:'rpc:a',text:'做同一件事'}),event(3,'task.started',{receiptId:'rpc:a',taskId:'turn-1'})];
 const cards=api.projectTimeline(events).cards;assert.equal(cards.filter((r:any)=>r.type==='task.queued').length,0);assert.equal(cards.filter((r:any)=>r.type==='user.message').length,1);
});
test('w: started, completed and canceled turns remove their own queue state without consuming others',()=>{
 for(const type of ['task.started','task.ended','step.started','step.completed']){
  const events=[event(1,'task.queued',{tasks:[{receiptId:'rpc:a',taskId:'rpc:a'},{receiptId:'rpc:b',taskId:'rpc:b'}]}),event(2,type,{receiptId:'rpc:a',taskId:'turn-1',reason:'completed'})];
  const pending=api.projectTimeline(events).cards.filter((r:any)=>r.type==='task.queued');assert.equal(pending.length,1);assert.equal(pending[0].data.receiptId,'rpc:b');
 }
 const events=[event(1,'task.queued',{receiptId:'rpc:a',taskId:'rpc:a'}),event(2,'task.ended',{receiptId:'rpc:a',reason:'canceled'},'other')];
 assert.equal(api.projectTimeline(events).cards.filter((r:any)=>r.type==='task.queued').length,1);
 const segments=[{seq:1,type:'task.queued',sourceRef:{sessionId:'one'},data:{receiptId:'rpc:a'}},{seq:2,type:'task.started',sourceRef:{sessionId:'two'},data:{receiptId:'rpc:a'}}];
 assert.equal(api.projectTimeline(segments).cards.filter((r:any)=>r.type==='task.queued').length,1);
});
test('s: gallery conversation fixture can mark a record read and load its message versions',async()=>{
 const f=await startFe1bFixture();try{
  const response=await fetch(f.origin+'/personal/v1/auth/login',{method:'POST',headers:{origin:f.origin,'content-type':'application/json'},body:JSON.stringify({username:f.credentials.username,password:f.credentials.password,deviceName:'synthetic regression phone'})});
  assert.equal(response.status,200);const auth=await response.json(),cookie=response.headers.get('set-cookie')!.split(';')[0];
  const base=f.origin+'/personal/v1/sessions/'+f.ids.report;
  const marked=await fetch(base+'/metadata',{method:'PATCH',headers:{origin:f.origin,cookie,'x-weftmate-csrf':auth.csrfToken,'content-type':'application/json'},body:JSON.stringify({unread:false})});
  assert.equal(marked.status,200);assert.equal((await marked.json()).unread,false);
  const versions=await fetch(base+'/message-branches',{headers:{cookie}});assert.equal(versions.status,200);assert.deepEqual(await versions.json(),{groups:[]});assert.deepEqual(f.missingRequests,[]);
 }finally{await f.close();}
});
test('o/w: official native inbox log supplies the receipt that consumes a queue card',async()=>{
 const message={source:{kind:'user',rpcId:'rpc:synthetic'},content:[{type:'text',text:'请整理进展'}]};
 const events=[{seq:0,time:1,type:'agent/inbox/spliced',data:{target:'next-turn',start:0,removedCount:0,inserted:[message]}},{seq:1,time:2,type:'agent/inbox/spliced',data:{target:'next-turn',start:0,removedCount:1,inserted:[]}},{seq:2,time:3,type:'turn/start',data:{turn:1}},{seq:3,time:4,type:'user/message',data:message},{seq:4,time:5,type:'step/start',data:{turn:1,step:1}},{seq:5,time:6,type:'assistant/message',data:{content:[{type:'text',text:'已完成'}]}},{seq:6,time:7,type:'step/end',data:{turn:1,step:1}},{seq:7,time:8,type:'turn/end',data:{turn:1,reason:{kind:'completed'}}}];
 const adapter=createDshSessionAdapter({sessions:{list:async()=>({result:{ok:true,value:{items:[{sessionId:'synthetic',origin:'user'}]}}})},events:{}},{readLog:async()=>events});
 const page=await adapter.historyPage('synthetic',{afterSeq:-1,limit:100});assert.ok(page.events.some((r:any)=>r.type==='task.queued'));
 assert.ok(page.events.some((r:any)=>r.type==='task.started'&&r.data.receiptId==='rpc:synthetic'));
 const cards=api.projectTimeline(page.events).cards;assert.equal(cards.filter((r:any)=>r.type==='task.queued').length,0);assert.equal(cards.filter((r:any)=>r.type==='user.message').length,1);
});
