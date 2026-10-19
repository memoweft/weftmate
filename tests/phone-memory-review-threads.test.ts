import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import '../src/ui-core/phone-memory.js';
import '../src/ui-core/offline.js';
const M=(globalThis as any).WeftPhoneMemory,W=(globalThis as any).WeftOffline;

for(const action of ['edit','pin','toggle','forget'])test(`memory ${action} during generation preserves the live and persisted complete reply`,async t=>{
 let entered!:()=>void,finish!:()=>void,progress:any,stored:any;
 const ready=new Promise<void>(r=>entered=r),pending=new Promise<void>(r=>finish=r);
 const engine=await W.create({identity:{},crypto:webcrypto,phoneModel:()=>({modelId:'synthetic'}),accountCheck:async()=>({}),vault:{
  load:async()=>({snapshot:null,phoneMemory:M.fresh(),conversations:[],turns:[],tasks:[]}),save:async(v:any)=>{stored=structuredClone(v)},close(){},
  complete:async(_body:any,_model:any,_signal:any,onProgress:any)=>{progress=onProgress;onProgress('最初片段');entered();await pending;return{choices:[{message:{content:'完整回答：水会蒸发、凝结，再以降水回到地面。'}}]};}}});
 t.after(()=>engine.close());await engine.memoryChange('add',null,'我喜欢红茶');const id=engine.view().phoneMemory.items[0].id;
 const sending=engine.send('解释水循环');await ready;
 await engine.memoryChange(action,id,action==='edit'?'我喜欢绿茶':action==='toggle'?false:undefined);
 progress('最初片段和后续片段');finish();const reply=await sending;
 const expected=[{role:'user',text:'解释水循环'},{role:'assistant',text:reply.text}];
 assert.deepEqual(engine.view().conversations[0].turns[0].messages,expected);
 assert.deepEqual(stored.conversations[0].turns[0].messages,expected);
 assert.deepEqual(stored.turns[0].messages,expected);
 if(action==='edit')assert.equal(stored.phoneMemory.items[0].text,'我喜欢绿茶');
 if(action==='pin')assert.equal(stored.phoneMemory.items[0].pinned,true);
 if(action==='toggle')assert.equal(stored.phoneMemory.enabled,false);
 if(action==='forget')assert.equal(stored.phoneMemory.items.length,0);
});

async function extractionAfterForget(text:string){
 const state=M.fresh(),fact='只喝红茶';await M.edit(state,null,fact,webcrypto);await M.forget(state,state.items[0].id,webcrypto);
 const source={id:'fresh',timestamp:Date.now()+1000,messages:[{role:'user',text}]};
 await M.extract(state,{id:'fresh-chat',turns:[source]},async()=>({choices:[{message:{content:JSON.stringify({upsert:[{id:null,text:fact,sourceIDs:['fresh'],evidence:fact}],invalidate:[]})}}]}),webcrypto);
 return state;
}
for(const text of ['请记住，以后我只喝红茶','请重新记住，将来我只喝红茶','记住，我以后只喝红茶'])test(`explicit future preference restores forgotten memory: ${text}`,async()=>{
 const state=await extractionAfterForget(text);assert.equal(state.items.length,1);assert.equal(state.items[0].text,'只喝红茶');assert.deepEqual(state.items[0].sourceIDs,['fresh']);
});

test('future words do not bypass conditional, negative, question or quotation checks',async()=>{
 for(const text of ['请记住，如果以后我只喝红茶，就记录这个偏好','请记住，只有将来我确认了才记录我只喝红茶','请记住，我不想以后只喝红茶','请记住，我将来只喝红茶吗','她说：“请记住，以后我只喝红茶”','请记住，“以后我只喝红茶”只是别人说的原话']){
  const state=await extractionAfterForget(text);assert.equal(state.items.length,0,text);
 }
});


test('queue retry preserves memory edits made during the failed reply and all subsequent complete turns',async t=>{
 let stored:any,release!:()=>void,progress:any,calls=0;
 const wait=async(predicate:()=>boolean)=>{for(let i=0;i<200&&!predicate();i++)await new Promise(r=>setTimeout(r,5));assert.ok(predicate());};
 const engine=await W.create({identity:{},crypto:webcrypto,phoneModel:()=>({modelId:'synthetic'}),accountCheck:async()=>({}),vault:{
  load:async()=>({snapshot:null,phoneMemory:M.fresh(),conversations:[],turns:[],tasks:[]}),save:async(v:any)=>{stored=structuredClone(v)},close(){},
  complete:async(body:any,_model:any,_signal:any,onProgress:any)=>{calls++;progress=onProgress;onProgress('部分回复');await new Promise<void>(r=>release=r);if(calls===1)throw Error('NETWORK');return{choices:[{message:{content:'完整回复：'+body.messages.at(-1).content}}]};}}});
 t.after(()=>engine.close());await engine.memoryChange('add',null,'红茶');const id=engine.view().phoneMemory.items[0].id;
 const first=await engine.enqueue('第一条');await wait(()=>calls===1);
 await engine.enqueue('第二条',first.conversationId);await engine.enqueue('第三条',first.conversationId);
 await engine.memoryChange('edit',id,'绿茶');progress('已保留的部分回复');release();
 await wait(()=>!!engine.view().queueError&&!engine.view().running);
 assert.deepEqual(stored.pendingMessages.map((p:any)=>p.text),['第二条','第三条']);
 assert.equal(stored.phoneMemory.items[0].text,'绿茶');
 assert.equal(stored.conversations[0].turns[0].messages[1].text,'已保留的部分回复');
 engine.retryQueue();await wait(()=>calls===2);release();await wait(()=>calls===3);release();await wait(()=>!engine.view().running);
 assert.deepEqual(stored.conversations[0].turns.map((turn:any)=>turn.messages[1].text),['已保留的部分回复','完整回复：第二条','完整回复：第三条']);
 assert.equal(stored.phoneMemory.items[0].text,'绿茶');assert.equal(stored.pendingMessages.length,0);
 assert.deepEqual(engine.takeMemoryConversations(),[first.conversationId]);
});
