import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import '../src/ui-core/offline.js';

const W = (globalThis as any).WeftOffline;
const item = { id:'tea', kind:'preference', text:'喜欢喝合成红茶', sources:[{id:'source-tea'}] };
const original = {id:'original',turns:[{id:'old-turn',conversationId:'original',timestamp:1,messages:[{role:'user',text:'保留这段合成原话'},{role:'assistant',text:'好的'}]}]};
const snapshot = {items:[item],model:{modelId:'computer-model'},control:{accountId:'synthetic',hostId:'host'},generation:1};

async function fixture(t:any, {replica=true, legacy=false, ownModel=true, linkedIdentity=true}:any={}) {
  let saved:any={snapshot:replica?structuredClone(snapshot):null,conversations:[structuredClone(original)],turns:[],tasks:[],
    ...(legacy?{phoneMemory:{enabled:true,items:[{id:'obsolete',text:'不应召回的旧手机记忆'}]}}:{})};
  const calls:any[]=[];
  const engine=await W.create({identity:linkedIdentity?{hostId:'host'}:{accountId:'synthetic'},crypto:webcrypto,
    ...(ownModel?{phoneModel:()=>({modelId:'phone-model'}),accountCheck:async()=>({})}:{}),
    control:async()=>({authorized:true,accountId:'synthetic',hostId:'host',generation:1}),
    vault:{load:async()=>structuredClone(saved),save:async(value:any)=>{saved=structuredClone(value)},close(){},
      complete:async(body:any)=>{calls.push(structuredClone(body));return {choices:[{message:{content:'合成回复'}}]};}}});
  t.after(()=>engine.close());return {engine,calls,saved:()=>saved};
}

for(const ownModel of [true,false]) for(const legacy of [false,true]) test(`one chat request recalls the computer replica; phone model=${ownModel}, legacy=${legacy}`,async t=>{
  const f=await fixture(t,{ownModel,legacy});
  await f.engine.send('我喜欢喝什么合成红茶？');
  assert.equal(f.calls.length,1);
  assert.match(f.calls[0].messages[0].content,/记忆：喜欢喝合成红茶/);
  assert.doesNotMatch(f.calls[0].messages[0].content,/不应召回的旧手机记忆/);
  assert.equal(f.calls[0].model,ownModel?'phone-model':'computer-model');
  assert.equal(Object.hasOwn(f.engine.view(),'phoneMemory'),false);
  assert.equal(Object.hasOwn(f.saved(),'phoneMemory'),false);
  assert.deepEqual(f.saved().conversations[0],original);
});

test('a reopened standalone phone authorizes the computer recorded in its cached replica',async t=>{
  const f=await fixture(t,{linkedIdentity:false});
  await f.engine.send('我喜欢喝什么合成红茶？');
  assert.equal(f.calls.length,1);
  assert.match(f.calls[0].messages[0].content,/记忆：喜欢喝合成红茶/);
});

test('a legacy container drops phone memory on opening, preserving original conversations',async t=>{
  const f=await fixture(t,{replica:false,legacy:true});
  assert.equal(Object.hasOwn(f.engine.view(),'phoneMemory'),false);
  assert.equal(Object.hasOwn(f.saved(),'phoneMemory'),false);
  assert.deepEqual(f.saved().conversations,[original]);
});

test('an encrypted old container is rewritten without phone memory, retains originals, and stays account isolated',async t=>{
  const indexedDB=new IDBFactory();
  const vault=await W.browserVault('phone:synthetic-old',{indexedDB,crypto:webcrypto});
  await vault.save({snapshot:structuredClone(snapshot),conversations:[original],turns:[],phoneMemory:{items:[{text:'旧合成条目'}]}});
  const engine=await W.create({vault,identity:{},crypto:webcrypto});
  engine.close();
  const reopened=await W.browserVault('phone:synthetic-old',{indexedDB,crypto:webcrypto});
  const other=await W.browserVault('phone:synthetic-other',{indexedDB,crypto:webcrypto});
  t.after(()=>{reopened.close();other.close();});
  const value=await reopened.load();
  assert.equal(Object.hasOwn(value,'phoneMemory'),false);
  assert.deepEqual(value.conversations,[original]);
  assert.deepEqual(value.snapshot.items,[item]);
  assert.equal((await other.load()).conversations.length,0);
});

test('without a replica the prompt explains where memory forms and never promises local forgetting',async t=>{
  const f=await fixture(t,{replica:false});
  await f.engine.send('忘掉我的合成偏好');
  assert.equal(f.calls.length,1);
  const prompt=f.calls[0].messages[0].content;
  assert.match(prompt,/记忆在电脑上形成/);
  assert.match(prompt,/连上电脑后才有/);
  assert.match(prompt,/现在删不了/);
  assert.match(prompt,/连上电脑后再说一次或去记忆页忘掉/);
});

test('large and previously deferred handovers upload automatically with stable ids and originals only',async t=>{
  const turns=Array.from({length:101},(_,i)=>({id:`turn-${i}`,conversationId:'original',timestamp:i,messages:[{role:'user',text:'合成原话'.repeat(600)}]}));
  let saved:any={snapshot:null,turns,conversations:[{id:'original',turns}],handover:{id:'stable-handover',totalTurns:101,conversationCount:1,bytes:300000,awaitingConfirmation:true},phoneMemory:{items:[{text:'不上传的旧条目'}]}};
  const requests:any[]=[];
  const engine=await W.create({identity:{},crypto:webcrypto,phoneModel:()=>({modelId:'synthetic'}),
    vault:{load:async()=>structuredClone(saved),save:async(value:any)=>{saved=structuredClone(value)},key:async()=>({}),open:async(value:any)=>value,close(){}},
    host:async(path:string,body:any)=>{
      if(path==='/offline/sync')return {...snapshot,remove:[],memoryAuthority:{ready:true}};
      requests.push(structuredClone(body));return {receipts:body.turns.map((turn:any)=>({id:turn.id,state:'synced'}))};
    }});
  t.after(()=>engine.close());
  do {await engine.sync();}while(engine.view().turns.length);
  assert.ok(requests.length>=3);
  assert.ok(requests.every(r=>r.handover.id==='stable-handover'));
  assert.equal(requests.at(-1).handover.complete,true);
  assert.equal(requests.flatMap(r=>r.turns).length,101);
  assert.equal(JSON.stringify(requests).includes('不上传的旧条目'),false);
  assert.equal(Object.hasOwn(saved.handover,'awaitingConfirmation'),false);
  assert.equal(saved.conversations[0].turns.length,101);
});

test('lost and partial handover receipts retain original turns for retry while computer recall stays available',async t=>{
  let saved:any={snapshot:null,conversations:[],turns:[]},attempt=0;
  const requests:any[]=[],models:any[]=[];
  const engine=await W.create({identity:{hostId:'host'},crypto:webcrypto,phoneModel:()=>({modelId:'synthetic'}),accountCheck:async()=>({}),
    control:async()=>({authorized:true,accountId:'synthetic',hostId:'host',generation:1}),
    vault:{load:async()=>saved,save:async(value:any)=>{saved=structuredClone(value)},key:async()=>({}),open:async(value:any)=>value,close(){},
      complete:async(body:any)=>{models.push(body);return {choices:[{message:{content:'合成回复'}}]};}},
    host:async(path:string,body:any)=>{
      if(path==='/offline/sync')return {...snapshot,remove:[],memoryAuthority:{ready:true}};
      requests.push(structuredClone(body));
      if(attempt++===0)throw Error('LOST_RECEIPT');
      return {receipts:body.turns.slice(0,1).map((turn:any)=>({id:turn.id,state:'synced'}))};
    }});
  t.after(()=>engine.close());
  await engine.send('第一条合成原话');await engine.send('第二条合成原话');
  await assert.rejects(engine.sync(),/LOST_RECEIPT/);assert.equal(saved.turns.length,2);
  await engine.sync();assert.deepEqual(requests[0],requests[1]);assert.equal(saved.turns.length,1);
  await engine.send('我喜欢喝什么合成红茶？');
  assert.match(models.at(-1).messages[0].content,/记忆：喜欢喝合成红茶/);
  assert.equal(models.length,3);
  await engine.sync();await engine.sync();
  assert.equal(saved.turns.length,0);
  assert.equal(saved.conversations.length,3);
});
