import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import '../src/ui-core/phone-memory.js';
import '../src/ui-core/offline.js';
const M=(globalThis as any).WeftPhoneMemory,W=(globalThis as any).WeftOffline;
const turn=(id:string,text:string,timestamp=Date.now())=>({id,timestamp,messages:[{role:'user',text}]});
const result=(patch:any)=>({choices:[{message:{content:JSON.stringify(patch)}}]});
const row=(id:string|null,source:string,text:string)=>({id,text,sourceIDs:[source],evidence:text});

test('MiMo extraction accepts omitted empty arrays and blank new IDs, and still rejects invalid sources',async()=>{
 const s=M.fresh(),c={id:'chat',turns:[turn('red','记住我喜欢喝红茶。')]};
 await M.extract(s,c,async()=>result({upsert:[row('','red','红茶')]}),webcrypto);
 assert.equal(s.items.length,1);assert.deepEqual(s.processed,['red']);
 c.turns.push(turn('bad','没有偏好'));
 await M.extract(s,c,async()=>result({upsert:[row(null,'not-present','绿茶')]}),webcrypto);
 assert.equal(s.items.length,1);
});

test('old extraction retries cannot overwrite newer corrections; forgetting suppresses every revision',async()=>{
 const s=M.fresh();
 await M.extract(s,{id:'a',turns:[turn('a','喜欢红茶',100)]},async()=>result({upsert:[row(null,'a','红茶')],invalidate:[]}),webcrypto);
 const id=s.items[0].id;
 await M.extract(s,{id:'b',turns:[turn('b','更喜欢绿茶',300)]},async()=>result({upsert:[row(id,'b','绿茶')],invalidate:[]}),webcrypto);
 await M.extract(s,{id:'old',turns:[turn('old','喜欢红茶',200)]},async()=>result({upsert:[row(id,'old','红茶')],invalidate:[]}),webcrypto);
 assert.equal(s.items[0].text,'绿茶');
 await M.forget(s,id,webcrypto);
 assert.ok(s.suppressedText.includes(await M.digest('红茶',webcrypto)));
 assert.ok(s.suppressedText.includes(await M.digest('绿茶',webcrypto)));
});

test('background invalidation cannot delete a memory on an ordinary question',async()=>{
 const s=M.fresh();const item=await M.edit(s,null,'喜欢红茶',webcrypto);
 await M.extract(s,{id:'q',turns:[turn('q','我喜欢喝什么？')]},async()=>result({upsert:[],invalidate:[{id:item.id,sourceIDs:['q'],evidence:'我喜欢喝什么？'}]}),webcrypto);
 assert.equal(s.items.length,1);
});

test('a fresh explicit remember can restore forgotten text while an older source remains suppressed',async()=>{
 const s=M.fresh(),time=Date.now();
 await M.extract(s,{id:'a',turns:[turn('a','请记住，我喜欢红茶',time)]},async()=>result({upsert:[row(null,'a','红茶')],invalidate:[]}),webcrypto);
 await M.forget(s,s.items[0].id,webcrypto);
 await M.extract(s,{id:'new',turns:[turn('new','请记住，我喜欢红茶',time+1000)]},async()=>result({upsert:[row(null,'new','红茶')],invalidate:[]}),webcrypto);
 assert.equal(s.items.length,1);await M.forget(s,s.items[0].id,webcrypto);
 s.processed=[];
 await M.extract(s,{id:'a',turns:[turn('a','请记住，我喜欢红茶',time)]},async()=>assert.fail('old source must stay blocked'),webcrypto);
 assert.equal(s.items.length,0);
});

async function engineFixture(complete:any){
 let stored:any,failSave=false;
 const vault={load:async()=>({snapshot:null,conversations:[],turns:[],tasks:[],forgetConversations:[],phoneMemory:M.fresh()}),save:async(v:any)=>{if(failSave){failSave=false;throw Error('disk');}stored=structuredClone(v);},close(){},complete};
 const engine=await W.create({vault,identity:{accountId:'test',origin:'local'},phoneModel:()=>({modelId:'synthetic'}),accountCheck:async()=>({}),crypto:webcrypto});
 return {engine,get stored(){return stored;},fail(){failSave=true;}};
}
test('conversation forget replies only after durable deletion, retains chat and independent memories',async t=>{
 let target='';const f=await engineFixture(async(body:any)=>body.max_tokens?result({intent:'forget',request:'请忘掉我的饮品偏好。',ids:[target]}):result({}));t.after(()=>f.engine.close());
 await f.engine.memoryChange('add',null,'我喜欢红茶');target=f.engine.view().phoneMemory.items[0].id;
 await f.engine.memoryChange('add',null,'我喜欢散步');
 const reply=await f.engine.send('请忘掉我的饮品偏好。');
 assert.match(reply.text,/已经忘/);assert.equal(f.stored.phoneMemory.items.length,1);assert.equal(f.stored.phoneMemory.items[0].text,'我喜欢散步');
 assert.equal(f.stored.conversations[0].turns[0].messages[0].text,'请忘掉我的饮品偏好。');
});
test('failed forget persistence cannot report success or change live memory',async t=>{
 let target='';const f=await engineFixture(async()=>{f.fail();return result({intent:'forget',request:'请忘掉红茶偏好。',ids:[target]});});t.after(()=>f.engine.close());
 await f.engine.memoryChange('add',null,'我喜欢红茶');target=f.engine.view().phoneMemory.items[0].id;
 await assert.rejects(f.engine.send('请忘掉红茶偏好。'));
 assert.equal(f.engine.view().phoneMemory.items.length,1);
 assert.ok(!f.engine.view().conversations.flatMap((c:any)=>c.turns).some((t:any)=>t.messages.some((m:any)=>m.role==='assistant'&&/已经忘/.test(m.text))));
});

test('forget authorization rejects incomplete echoed requests and invented targets',async()=>{
 const s=M.fresh();await M.edit(s,null,'喜欢红茶',webcrypto);
 const full='请忘掉红茶。等等，取消，保留它。';
 await assert.rejects(M.planForget(s,full,async()=>result({intent:'forget',request:'请忘掉红茶。',ids:[s.items[0].id]})));
 await assert.rejects(M.planForget(s,'请忘掉红茶。',async()=>result({intent:'forget',request:'请忘掉红茶。',ids:['invented']})));
 assert.equal(await M.planForget(s,full,async()=>result({intent:'none',request:full,ids:[]})),null);
 assert.equal(s.items.length,1);
});

test('canceling while the authorization model is running leaves memory intact',async t=>{
 let finish:any,entered:any;const ready=new Promise<void>(r=>entered=r),pending=new Promise(r=>finish=r);
 const f=await engineFixture(async()=>{entered();return pending;});t.after(()=>f.engine.close());
 await f.engine.memoryChange('add',null,'我喜欢红茶');const id=f.engine.view().phoneMemory.items[0].id;
 const sending=f.engine.send('请忘掉红茶。');await ready;f.engine.stop();
 finish(result({intent:'forget',request:'请忘掉红茶。',ids:[id]}));await assert.rejects(sending);
 assert.equal(f.stored.phoneMemory.items.length,1);
});

test('forgetting on the page during an extraction save wins over the late extraction result',async t=>{
 let finish:any,entered:any,block=false;const ready=new Promise<void>(r=>entered=r),pending=new Promise<void>(r=>finish=r);
 let saved:any;
 const vault={load:async()=>({snapshot:null,conversations:[],turns:[],tasks:[],phoneMemory:M.fresh()}),close(){},
  save:async(v:any)=>{if(block){block=false;entered();await pending;}saved=structuredClone(v);},
  complete:async(body:any)=>{if(!body.max_tokens)return result('普通回复');const source=JSON.parse(body.messages[1].content)['原话'][0];return result({upsert:[row(null,source.id,'红茶')]});}};
 const e=await W.create({vault,identity:{},phoneModel:()=>({modelId:'synthetic'}),accountCheck:async()=>({}),crypto:webcrypto});t.after(()=>e.close());
 const sent=await e.send('我喜欢红茶');block=true;const extracting=e.extractMemory(sent.conversationId);await ready;
 const forgetting=e.memoryChange('forget-all');finish();await extracting;await forgetting;
 assert.equal(saved.phoneMemory.items.length,0);assert.equal(e.view().phoneMemory.items.length,0);
});

test('existing encrypted vault entries recover their newest source time before retrying older conversations',async t=>{
 const s=M.fresh();s.items=[{id:'legacy',text:'绿茶',sourceIDs:['a','b'],updatedAt:400}];
 delete s.suppressedAt;s.suppressedText=[await M.digest('旧条目',webcrypto)];
 const old={id:'old',turns:[turn('old','红茶',200)]};
 const e=await W.create({identity:{},crypto:webcrypto,phoneModel:()=>({modelId:'synthetic'}),accountCheck:async()=>({}),vault:{
   load:async()=>({snapshot:null,phoneMemory:s,conversations:[{id:'a',turns:[turn('a','红茶',100)]},{id:'b',turns:[turn('b','绿茶',300)]},old],turns:[],tasks:[]}),save:async()=>{},close(){},complete:async()=>result({upsert:[row('legacy','old','红茶')]})}});
 t.after(()=>e.close());await e.extractMemory('old');assert.equal(e.view().phoneMemory.items[0].text,'绿茶');
 assert.equal(e.view().phoneMemory.items[0].sourceTimestamp,300);
 assert.equal(Object.keys(e.view().phoneMemory.suppressedAt).length,1);
});

test('a new chat waits for an already running correction instead of canceling it and recalling the old value',async t=>{
 let entered:any,finish:any,id='';const ready=new Promise<void>(r=>entered=r),pending=new Promise<void>(r=>finish=r);
 const f=await engineFixture(async(body:any)=>{
  if(body.max_tokens){entered();await pending;const source=JSON.parse(body.messages[1].content)['原话'][0];return result({upsert:[row(id,source.id,'绿茶')]});}
  return {choices:[{message:{content:body.messages[0].content.includes('绿茶')?'绿茶':'红茶'}}]};
 });t.after(()=>f.engine.close());
 await f.engine.memoryChange('add',null,'红茶');id=f.engine.view().phoneMemory.items[0].id;
 const first=await f.engine.send('我其实更喜欢绿茶');const extracting=f.engine.extractMemory(first.conversationId);await ready;
 const asking=f.engine.send('我喜欢喝什么？');finish();await extracting;
 assert.equal((await asking).text,'绿茶');
});

test('opening a new conversation before the idle timer still forms the preceding explicit preference',async t=>{
 const f=await engineFixture(async(body:any)=>{
  if(body.max_tokens){const source=JSON.parse(body.messages[1].content)['原话'][0];return result({upsert:[row(null,source.id,'红茶')]});}
  return {choices:[{message:{content:body.messages[0].content.includes('记忆：红茶')?'红茶':'不知道'}}]};
 });t.after(()=>f.engine.close());
 await f.engine.send('记住我喜欢喝红茶');assert.equal(f.engine.view().phoneMemory.items.length,0);
 assert.equal((await f.engine.send('我喜欢喝什么？')).text,'红茶');
});

test('queued account A memory writes expire on close before the native current account changes to B',async()=>{
 let release!:()=>void,entered!:()=>void,block=false,current='A';
 const ready=new Promise<void>(r=>entered=r),pending=new Promise<void>(r=>release=r);
 const a=M.fresh(),b=M.fresh();await M.edit(a,null,'A 合成偏好',webcrypto);await M.edit(b,null,'B 合成偏好',webcrypto);
 const containers:any={A:{snapshot:null,phoneMemory:a,conversations:[],turns:[],tasks:[]},B:{snapshot:null,phoneMemory:b,conversations:[],turns:[],tasks:[]}};
 const writes:string[]=[];
 const e=await W.create({identity:{accountId:'A',origin:'local'},crypto:webcrypto,phoneModel:()=>({modelId:'synthetic'}),accountCheck:async()=>({}),vault:{
  load:async()=>structuredClone(containers.A),close(){},save:async(v:any)=>{const account=current;writes.push(account);if(block){block=false;entered();await pending;}containers[account]=structuredClone(v);}}});
 block=true;const first=e.memoryChange('toggle',null,false);const rejectedFirst=assert.rejects(first);
 await ready;const second=e.memoryChange('toggle',null,true);const rejectedSecond=assert.rejects(second);
 e.close();current='B';release();await rejectedFirst;await rejectedSecond;
 assert.equal(containers.B.phoneMemory.items[0].text,'B 合成偏好');assert.deepEqual(writes,['A']);
 await assert.rejects(e.memoryChange('add',null,'关闭后不应写入'));assert.deepEqual(writes,['A']);
});

test('negative, question and conditional remember requests never unlock a forgotten digest even when extraction proposes it',async()=>{
 const texts=['我不想再记住我喜欢红茶这件事了。','我不想记住我喜欢红茶。','我不愿重新记住我喜欢红茶。','我没有要求记住我喜欢红茶。','我想知道怎么记住我喜欢红茶。','请记住我喜欢红茶，好吗','假若我说记住我喜欢红茶，再保存。','I do not want to remember that I like tea.','Could you remember that I like tea','Remember that I like tea only if I confirm.'];
 for(const text of texts){const s=M.fresh(),fact=text.match(/[A-Za-z]/)?'I like tea':'我喜欢红茶';
  await M.edit(s,null,fact,webcrypto);await M.forget(s,s.items[0].id,webcrypto);
  const source=turn('new',text,Date.now()+1000);
  await M.extract(s,{id:'new-chat',turns:[source]},async()=>result({upsert:[row(null,'new',fact)],invalidate:[]}),webcrypto);
  assert.equal(s.items.length,0,text);
 }
});

test('forgetting a memory during a reply preserves streamed and final assistant messages in the saved turn',async t=>{
 let entered!:()=>void,release!:()=>void,progress:any;
 const ready=new Promise<void>(r=>entered=r),pending=new Promise<void>(r=>release=r);let stored:any;
 const e=await W.create({identity:{},crypto:webcrypto,phoneModel:()=>({modelId:'synthetic'}),accountCheck:async()=>({}),vault:{
  load:async()=>({snapshot:null,phoneMemory:M.fresh(),conversations:[],turns:[],tasks:[]}),close(){},save:async(v:any)=>{stored=structuredClone(v)},
  complete:async(_body:any,_model:any,_signal:any,onProgress:any)=>{progress=onProgress;onProgress('前半段');entered();await pending;return{choices:[{message:{content:'完整助手回复'}}]};}}});t.after(()=>e.close());
 await e.memoryChange('add',null,'我喜欢红茶');const id=e.view().phoneMemory.items[0].id;
 const sending=e.send('请解释水循环');await ready;await e.memoryChange('forget',id);progress('前半段和后半段');release();
 const reply=await sending;assert.equal(reply.text,'完整助手回复');
 assert.equal(stored.phoneMemory.items.length,0);
 assert.deepEqual(stored.conversations[0].turns[0].messages,[{role:'user',text:'请解释水循环'},{role:'assistant',text:'完整助手回复'}]);
 assert.deepEqual(stored.turns[0].messages,stored.conversations[0].turns[0].messages);
});
