import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import '../src/ui-core/phone-memory.js';
import '../src/ui-core/offline.js';

const W=(globalThis as any).WeftOffline,M=(globalThis as any).WeftPhoneMemory;
async function until(predicate:()=>boolean){for(let i=0;i<100&&!predicate();i++)await new Promise(r=>setTimeout(r,5));assert.ok(predicate(),'the first stop settles the current request');}

for(const alreadyExtracting of [false,true])for(const followup of [false,true])test(`first stop during ${alreadyExtracting?'existing':'new'} memory preparation preserves the input without replay; followup=${followup}`,async t=>{
 const previous={id:'previous',turns:[{id:'previous-turn',conversationId:'previous',timestamp:1,messages:[{role:'user',text:'记住我喜欢红茶'},{role:'assistant',text:'会整理'}]}]};
 let saved:any,memoryCalls=0;const chats:string[]=[];
 const engine=await W.create({identity:{},crypto:webcrypto,phoneModel:()=>({modelId:'synthetic'}),accountCheck:async()=>({}),vault:{
  load:async()=>JSON.parse(JSON.stringify({snapshot:null,conversations:[previous],turns:previous.turns,phoneMemory:M.fresh()})),
  save:async(value:any)=>{saved=structuredClone(value)},close(){},
  complete:async(body:any,_snapshot:any,signal:AbortSignal)=>{
   if(body.max_tokens){memoryCalls++;return new Promise((_resolve,reject)=>{const stop=()=>reject(new DOMException('CANCELLED','AbortError'));if(signal.aborted)stop();else signal.addEventListener('abort',stop,{once:true});});}
   chats.push(body.messages.at(-1).content);return{choices:[{message:{content:'回复：'+body.messages.at(-1).content}}]};
  }}});
 t.after(()=>engine.close());
 const extraction=alreadyExtracting?engine.extractMemory('previous'):null;
 if(extraction)await until(()=>memoryCalls===1);
 const current=await engine.enqueue('这条停止');await until(()=>memoryCalls===1&&engine.view().running);
 if(followup)await engine.enqueue('后面这一条',current.conversationId);
 engine.stop();await until(()=>!engine.view().running);await extraction;
 assert.equal(memoryCalls,1,'cancelled preparation must not be started again for the same input');
 assert.deepEqual(chats,followup?['后面这一条']:[],'the stopped input must never reach chat completion');
 assert.equal(saved.pendingMessages.length,0);
 const turns=saved.conversations.find((c:any)=>c.id===current.conversationId).turns;
 assert.deepEqual(turns[0].messages,[{role:'user',text:'这条停止'}]);
 if(followup)assert.deepEqual(turns[1].messages,[{role:'user',text:'后面这一条'},{role:'assistant',text:'回复：后面这一条'}]);
 assert.deepEqual(saved.conversations.find((c:any)=>c.id==='previous'),previous);
 assert.equal(saved.phoneMemory.processed.length,0,'cancelled memory results remain uncommitted');
});
