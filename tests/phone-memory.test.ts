// 保护：事实来源校验、跨对话纠正和遗忘、迟到提取以及电脑接替不能恢复已删除的记忆。
import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {IDBFactory} from 'fake-indexeddb';
import '../src/ui-core/phone-memory.js';
import '../src/ui-core/offline.js';
const W=(globalThis as any).WeftOffline;
const none=()=>({facts:[],forgetIds:[],excluded:false});
const fact=(quote:string,topic='饮品偏好',replaceIds:string[]=[])=>({facts:[{quote,topic,kind:'preference',replaceIds}],forgetIds:[],excluded:false});
const answer=(content:string)=>({choices:[{message:{content}}]});
async function fixture(t:any,extract:(x:any)=>any,options:any={}){
 const vault=await W.browserVault('phone:owner-a',{indexedDB:options.indexedDB??new IDBFactory(),crypto:webcrypto});
 const calls:any[]=[];
 vault.complete=async(body:any,_m:any,signal:any)=>{calls.push(structuredClone(body));return body.max_tokens===1200?answer(JSON.stringify(await extract({...JSON.parse(body.messages[1].content),signal}))):answer('合成回复');};
 let delta:any={items:[],remove:[],hashes:{},generation:1,control:{accountId:'a',hostId:'host'},memoryAuthority:{ready:false},phoneMemory:{completed:[],sources:[],forgotten:[]}};
 vault.open=async()=>structuredClone(delta);
 let host:any=async()=>({}),model:any={modelId:'synthetic'};
 const engine=await W.create({vault,crypto:webcrypto,identity:{accountId:'a',hostId:'host'},standalone:true,phoneModel:()=>model,
  accountCheck:async()=>({}),control:async()=>({authorized:true,accountId:'a',hostId:'host',generation:1}),host:(...a:any[])=>host(...a)});
 const settled=async()=>{const end=Date.now()+2000;while(engine.view().memoryProcessing||engine.view().phoneMemories?.captureQueue.length){if(Date.now()>end)throw Error('memory did not settle');await new Promise(r=>setTimeout(r,2));}};
 t.after(()=>engine.close());return {engine,vault,calls,settled,model:(next:any)=>{model=next;},remember:async(...args:any[])=>{const result=await engine.send(...args);await settled();return result;},replies:()=>calls.filter(c=>c.max_tokens!==1200),host:(fn:any)=>{host=fn;},delta:(d:any)=>{delta={...delta,...d};}};
}
test('facts survive encrypted reopen and corrections are recalled in a new conversation',async t=>{
 const indexedDB=new IDBFactory(),f=await fixture(t,({current_user_text:text,known}:any)=>text==='我喜欢茉莉花茶'?fact(text):text==='我改口了，现在喜欢乌龙茶'?fact('现在喜欢乌龙茶','饮品偏好',known.map((r:any)=>r.id)):none(),{indexedDB});
 await f.remember('我喜欢茉莉花茶');await f.remember('我改口了，现在喜欢乌龙茶');await f.remember('我喜欢喝什么茶？');
 assert.deepEqual(f.engine.searchPhoneMemory().map((r:any)=>r.text),['现在喜欢乌龙茶']);
 assert.ok(f.replies().at(-1).messages[0].content.includes('乌龙茶')&&!f.replies().at(-1).messages[0].content.includes('茉莉花茶'));
 const reopened=await W.browserVault('phone:owner-a',{indexedDB,crypto:webcrypto}),other=await W.browserVault('phone:owner-b',{indexedDB,crypto:webcrypto});t.after(()=>{reopened.close();other.close();});
 assert.deepEqual([(await reopened.load()).phoneMemories.items.length,(await other.load()).conversations.length],[1,0]);
});

test('deleting original chat retains its memory by default and explicit forgetting removes it',async t=>{
 const f=await fixture(t,({current_user_text:text}:any)=>fact(text));const a=await f.remember('我喜欢茉莉花茶');await f.engine.removeConversation(a.conversationId);
 assert.equal(f.engine.searchPhoneMemory()[0].text,'我喜欢茉莉花茶');assert.equal(f.engine.view().conversations.length,0);
 const b=await f.remember('我喜欢徒步旅行');await f.engine.removeConversation(b.conversationId,{forget:true});assert.equal(f.engine.searchPhoneMemory().length,1);
});
test('unquoted model inventions and unknown correction IDs cannot mutate saved facts',async t=>{
 let call=0;const f=await fixture(t,()=>++call===1?fact('我喜欢茉莉花茶'):call===2?fact('用户住在火星'):fact('现在喜欢乌龙茶','饮品偏好',['someone-elses-memory']));
 await f.remember('我喜欢茉莉花茶');await f.remember('假设我住在火星');await f.remember('现在喜欢乌龙茶');
 assert.deepEqual(f.engine.searchPhoneMemory().map((r:any)=>r.text),['我喜欢茉莉花茶']);
 assert.equal(f.engine.view().phoneMemoryStatus.state,'failed');
});
test('forgetting hides same-source facts and recalled replies while preserving original chat text',async t=>{
 const f=await fixture(t,({current_user_text:text}:any)=>text==='我的鹦鹉叫青瓷'?fact(text,'宠物名字'):none());
 const sent=await f.remember('我的鹦鹉叫青瓷'),item=f.engine.searchPhoneMemory()[0];
 await f.remember('我的鹦鹉叫什么？',sent.conversationId);await f.engine.forgetPhoneMemory(item.id);await f.remember('我的鹦鹉叫什么？',sent.conversationId);
 assert.equal(f.engine.searchPhoneMemory().length,0);
 assert.ok(!JSON.stringify(f.replies().at(-1)).includes('青瓷'));
 assert.equal(f.engine.view().conversations[0].turns[0].messages[0].text,'我的鹦鹉叫青瓷');
 assert.ok(f.engine.view().turns.slice(0,2).every((turn:any)=>turn.memoryExcluded),'answers that recalled the fact cannot re-import it');
});
test('explicit natural-language forgetting changes the durable memory before the reply',async t=>{
 const f=await fixture(t,({current_user_text:text,known}:any)=>text==='我喜欢茉莉花茶'?fact(text):{...none(),forgetIds:known.map((r:any)=>r.id)});
 await f.remember('我喜欢茉莉花茶');await f.remember('忘掉我的饮品偏好');
 assert.equal((await f.vault.load()).phoneMemories.items.length,0);
 assert.equal(f.engine.view().phoneMemoryStatus.forgotten,1);
});

test('forgetting a corrected preference also excludes its earlier sources from later computer formation',async t=>{
 const f=await fixture(t,({current_user_text:text,known}:any)=>fact(text,'饮品偏好',known.map((r:any)=>r.id)));
 await f.remember('我喜欢茉莉花茶');await f.remember('我现在喜欢乌龙茶');const latest=f.engine.searchPhoneMemory()[0];await f.engine.forgetPhoneMemory(latest.id);
 assert.equal(f.engine.view().phoneMemories.forgottenTurns.length,2);
 assert.ok(f.engine.view().turns.every((turn:any)=>turn.memoryExcluded));
});

test('a changed correction lineage invalidates an already displayed forget scope',async t=>{
 const f=await fixture(t,({current_user_text:text,known}:any)=>text==='我喜欢茶，我的鹦鹉叫青瓷'?{facts:[{quote:'我喜欢茶',topic:'茶',kind:'preference',replaceIds:[]},{quote:'我的鹦鹉叫青瓷',topic:'宠物',kind:'fact',replaceIds:[]}],forgetIds:[],excluded:false}:fact(text,'茶',known.filter((r:any)=>r.topic==='茶').map((r:any)=>r.id)));
 await f.remember('我喜欢茶，我的鹦鹉叫青瓷');const item=f.engine.searchPhoneMemory().find((r:any)=>r.topic==='宠物'),preview=f.engine.phoneMemoryScope(item.id);await f.remember('我现在只喝乌龙茶');
 await assert.rejects(f.engine.forgetPhoneMemory(item.id,preview),{code:'PHONE_MEMORY_STALE'});assert.equal(f.engine.searchPhoneMemory().length,2);
});
test('a reply is visible before extraction and resetting the account rejects the late memory',async t=>{
 let release!:(v:any)=>void,started!:()=>void;const ready=new Promise<void>(r=>started=r),pending=new Promise(r=>release=r);
 const f=await fixture(t,async()=>{started();return pending;});const sending=f.engine.send('我喜欢茉莉花茶');const reply=await sending;assert.equal(reply.text,'合成回复');await ready;await f.engine.clear();release(fact('我喜欢茉莉花茶'));await f.settled();
 assert.equal(f.engine.searchPhoneMemory().length,0);assert.equal((await f.vault.load()).conversations.length,0);
});

test('failed extraction stays visible and retry can save the original without sending another chat turn',async t=>{
 let succeed=false;const f=await fixture(t,()=>succeed?fact('我喜欢茉莉花茶'):'invalid');await f.remember('我喜欢茉莉花茶');
 assert.equal(f.engine.view().snapshot.phoneMemoryFailures,1);succeed=true;await f.engine.retryPhoneMemory();await f.settled();
 assert.equal(f.engine.searchPhoneMemory().length,1);assert.equal(f.replies().length,1);
});

test('changing the selected service during a reply cannot send that turn to a different extractor',async t=>{
 const f=await fixture(t,({current_user_text:text}:any)=>fact(text)),complete=f.vault.complete;
 let release!:()=>void,started!:()=>void;const ready=new Promise<void>(r=>started=r),pending=new Promise<void>(r=>release=r);
 f.vault.complete=async(body:any,...args:any[])=>{if(body.max_tokens!==1200){started();await pending;}return complete(body,...args);};
 const sending=f.engine.send('我喜欢茉莉花茶');await ready;f.model({modelId:'new-choice'});release();await sending;await f.settled();
 assert.deepEqual(f.calls.map(call=>call.model),['synthetic','synthetic']);
});

test('a delayed extractor cannot create an orphan memory after its original conversation is deleted',async t=>{
 let release!:(v:any)=>void,started!:()=>void;const ready=new Promise<void>(r=>started=r),pending=new Promise(r=>release=r);
 const f=await fixture(t,async()=>{started();return pending;}),sent=await f.engine.send('我喜欢茉莉花茶');await ready;await f.engine.removeConversation(sent.conversationId);release(fact('我喜欢茉莉花茶'));await f.settled();
 assert.equal(f.engine.searchPhoneMemory().length,0);assert.equal(f.engine.view().conversations.length,0);
});

test('forgetting during a reply rejects late transport text even when the provider ignores cancellation',async t=>{
 const f=await fixture(t,({current_user_text:text}:any)=>text==='我的鹦鹉叫青瓷'?fact(text,'宠物'):none());await f.remember('我的鹦鹉叫青瓷');
 const complete=f.vault.complete;let release!:(x:any)=>void,started!:()=>void;const ready=new Promise<void>(r=>started=r);
 f.vault.complete=async(body:any,...args:any[])=>{if(body.max_tokens===1200)return complete(body,...args);started();return new Promise(r=>release=r);};
 const sending=f.engine.send('我的鹦鹉叫什么？');await ready;await f.engine.forgetPhoneMemory(f.engine.searchPhoneMemory()[0].id);release(answer('你的鹦鹉叫青瓷'));
 await assert.rejects(sending,{name:'AbortError'});assert.equal(f.engine.view().conversations.at(-1).turns[0].messages.length,1);
});

test('forgetting while the first upload fragment is in flight sends an erasure before retransmitting',async t=>{
 const f=await fixture(t,({current_user_text:text}:any)=>fact(text));const complete=f.vault.complete;
 f.vault.complete=async(body:any,...args:any[])=>body.max_tokens===1200?complete(body,...args):answer('合成背景'.repeat(10000));
 await f.remember('我喜欢茉莉花茶');f.delta({memoryAuthority:{ready:true}});
 let release!:()=>void,started!:()=>void;const ready=new Promise<void>(r=>started=r),pending=new Promise<void>(r=>release=r);const forgotten:string[]=[];
 f.host(async(path:string,body:any)=>{if(path==='/offline/sync')return{};if(body.forgetTurns){forgotten.push(...body.forgetTurns);return{generation:1,receipts:[],forgottenTurns:body.forgetTurns};}started();await pending;return{generation:1,receipts:[],fragmentReceipts:body.turnFragments.map((p:any)=>({id:p.id,index:p.index,state:'received'}))};});
 const syncing=f.engine.sync();await ready;const item=f.engine.searchPhoneMemory()[0];await f.engine.forgetPhoneMemory(item.id);release();await syncing;await f.engine.sync();
 assert.deepEqual(forgotten,[item.turnId]);assert.equal(f.engine.view().fragmentProgress[item.turnId],undefined);
});
test('computer receipt alone preserves phone facts; completed processing replaces only those sources',async t=>{
 const f=await fixture(t,({current_user_text:text}:any)=>fact(text));await f.remember('我喜欢茉莉花茶');await f.remember('我喜欢徒步旅行');
 const items=f.engine.searchPhoneMemory(),first=items.find((r:any)=>r.text==='我喜欢茉莉花茶');
 await f.engine.sync();assert.equal(f.engine.searchPhoneMemory().length,2);
 f.delta({items:[{id:'formal-tea',kind:'cognition',text:'用户喜欢茉莉花茶',sources:[{id:'e-tea'}]}],phoneMemory:{completed:[{turnId:first.turnId,sources:['e-tea']}],sources:[{turnId:first.turnId,sources:['e-tea']}],forgotten:[]}});
 await f.engine.sync();assert.deepEqual(f.engine.searchPhoneMemory().map((r:any)=>r.text).sort(),['我喜欢徒步旅行','用户喜欢茉莉花茶'].sort());
});
test('forgotten phone sources cannot return through a delayed computer snapshot',async t=>{
 const f=await fixture(t,({current_user_text:text}:any)=>fact(text));await f.remember('我喜欢茉莉花茶');const item=f.engine.searchPhoneMemory()[0];await f.engine.forgetPhoneMemory(item.id);
 f.delta({items:[{id:'formal-tea',kind:'cognition',text:'用户喜欢茉莉花茶',sources:[{id:'e-tea'}]}],phoneMemory:{completed:[{turnId:item.turnId,sources:['e-tea']}],sources:[{turnId:item.turnId,sources:['e-tea']}],forgotten:[]}});
 await f.engine.sync();assert.equal(f.engine.searchPhoneMemory().length,0);
});
test('this-conversation exclusion persists for later turns and greetings do not call an extractor',async t=>{
 let requests=0;const f=await fixture(t,()=>{requests++;return {...none(),excluded:true};});
 await f.remember('你好');assert.equal(requests,0);
 const sent=await f.remember('这段别记');await f.remember('我喜欢茉莉花茶',sent.conversationId);
 assert.equal(requests,1);assert.ok(f.engine.view().conversations.find((c:any)=>c.id===sent.conversationId).turns.every((r:any)=>r.memoryExcluded));
});
