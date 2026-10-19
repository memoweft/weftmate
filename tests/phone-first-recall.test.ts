import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import '../src/ui-core/phone-memory.js';
import '../src/ui-core/offline.js';
const W=(globalThis as any).WeftOffline,M=(globalThis as any).WeftPhoneMemory;
const tick=()=>new Promise<void>(r=>setImmediate(r));
async function settle(e:any){for(let i=0;i<200 && e.view().running;i++)await tick();assert.equal(e.view().running,false);}
async function fixture(){
 let saved:any,hold=false,entered!:()=>void,release!:()=>void;
 const saving=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r),queries:any[]=[];
 const engine=await W.create({identity:{},crypto:webcrypto,phoneModel:()=>({modelId:'synthetic'}),accountCheck:async()=>({}),vault:{
  load:async()=>saved||{snapshot:null,phoneMemory:M.fresh(),conversations:[],turns:[],tasks:[]},close(){},
  save:async(value:any)=>{if(hold&&value.phoneMemory.items.length){hold=false;entered();await gate;}saved=structuredClone(value);},
  complete:async(body:any)=>{
   if(body.max_tokens){const source=JSON.parse(body.messages[1].content)['原话'][0];return{choices:[{message:{content:JSON.stringify({upsert:[{id:null,text:'喜欢喝红茶',sourceIDs:[source.id],evidence:'喜欢喝红茶'}],invalidate:[]})}}]};}
   const query=body.messages.at(-1).content==='我喜欢喝什么？';if(query)queries.push(structuredClone(body));
   return{choices:[{message:{content:query?(body.messages[0].content.includes('喜欢喝红茶')?'红茶':'没有记忆'):'会整理'}}]};
  }}});
 return{engine,queries,saving,release,hold:()=>{hold=true},saved:()=>saved};
}
test('queued remember followed immediately by the first new conversation recalls the formed preference',async t=>{
 const f=await fixture();t.after(()=>f.engine.close());
 await f.engine.enqueue('记住我喜欢喝红茶。');await settle(f.engine);
 assert.equal(f.engine.view().phoneMemory.items.length,0);
 const receipt=await f.engine.enqueue('我喜欢喝什么？');await settle(f.engine);
 assert.equal(f.queries.length,1);assert.match(f.queries[0].messages[0].content,/记忆：喜欢喝红茶/);
 assert.match(f.queries[0].messages[0].content,/已保存的手机记忆（1条）/);
 assert.doesNotMatch(f.queries[0].messages[0].content,/也不能声称已经保存/);
 assert.deepEqual(f.queries[0].messages.slice(1),[{role:'user',content:'我喜欢喝什么？'}]);
 const c=f.saved().conversations.find((c:any)=>c.id===receipt.conversationId);assert.equal(c.turns[0].messages[1].text,'红茶');
});
test('the first queued new conversation waits for a memory save already in progress',async t=>{
 const f=await fixture();t.after(()=>f.engine.close());
 const first=await f.engine.enqueue('记住我喜欢喝红茶。');await settle(f.engine);
 f.hold();const extraction=f.engine.extractMemory(first.conversationId);await f.saving;
 const queued=f.engine.enqueue('我喜欢喝什么？');await tick();assert.equal(f.queries.length,0);
 f.release();await extraction;await queued;await settle(f.engine);
 assert.equal(f.queries.length,1);assert.match(f.queries[0].messages[0].content,/记忆：喜欢喝红茶/);
 assert.equal(f.saved().phoneMemory.items.length,1);
});

test('the first new conversation with no formed memory explicitly receives the empty-memory state',async t=>{
 const f=await fixture();t.after(()=>f.engine.close());await f.engine.enqueue('我喜欢喝什么？');await settle(f.engine);
 assert.equal(f.queries.length,1);assert.match(f.queries[0].messages[0].content,/本次没有提供已保存的手机记忆/);
 assert.equal(f.saved().phoneMemory.items.length,0);
});
