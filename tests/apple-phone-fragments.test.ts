import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {startPhoneTurnFragmentServer} from '../apps/apple/Tests/phone_turn_fragment_server.mjs';
import {taskRecipient,openTask} from '../src/personal-offline/crypto.mjs';

const digest=(raw:Buffer)=>createHash('sha256').update(raw).digest('hex');
async function fixture(t:any){
  const f=await startPhoneTurnFragmentServer();t.after(()=>f.close());
  const post=async(route:string,body:any,expected=200)=>{
    const response=await fetch(f.origin+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json();assert.equal(response.status,expected,JSON.stringify(result));return result;
  };
  const recipient=taskRecipient(),identity={ownerId:'owner-test',hostId:'host-test',deviceId:'device-test'};
  const sync=async(generation=0)=>openTask(await post('/personal/v1/offline/sync',{publicJwk:recipient.publicJwk,generation,hashes:{},phoneFirst:true}),recipient,identity);
  await sync();
  const turn={id:'long-turn',conversationId:'long-chat',timestamp:1_700_000_000_123,
    messages:[{role:'user',text:'合成原话😀'.repeat(17000)},{role:'assistant',text:'完整助手回复👩‍👩‍👧‍👧'.repeat(13000)}],memoryRefs:[],dependencyComplete:true};
  const raw=Buffer.from(JSON.stringify(turn)),count=Math.ceil(raw.length/96000),sha256=digest(raw);
  const parts=Array.from({length:count},(_,index)=>({id:turn.id,conversationId:turn.conversationId,timestamp:turn.timestamp,index,count,sha256,encoding:'json-utf8-base64',data:raw.subarray(index*96000,(index+1)*96000).toString('base64')}));
  const send=(parts:any[],expected=200,generation=1)=>post('/personal/v1/offline/turns',{generation,turns:[],turnFragments:parts},expected);
  return {...f,post,sync,turn,raw,parts,send};
}

test('APPLE-3 desktop reassembles real UTF-8/Base64 in arbitrary order, deduplicates and survives restart',{timeout:30_000},async t=>{
  const f=await fixture(t);
  await f.post('/personal/v1/offline/turns',{generation:1,turns:[f.turn]},413);
  assert.ok(f.parts.length>3);
  // Chunks are bytes, and may split a Chinese scalar or emoji sequence.
  assert.ok(f.parts.slice(0,-1).some(p=>Buffer.from(p.data,'base64').toString('utf8').includes('\ufffd')));
  for(const index of [2,0,2]){
    const result=await f.send([f.parts[index]]);
    assert.deepEqual(result.receipts,[]);assert.deepEqual(result.fragmentReceipts,[{id:f.turn.id,index,state:'received'}]);
  }
  await f.post('/configure',{restart:true});
  for(let index=0;index<f.parts.length;index++)if(index!==2){
    const result=await f.send([f.parts[index]]);
    assert.equal(result.receipts.length,index===f.parts.length-1?1:0);
  }
  assert.equal(f.report.accepted.length,1);assert.deepEqual(f.report.accepted[0],f.turn);
  assert.equal(f.report.assemblies.at(-1)!.sha256,digest(f.raw));
  assert.equal(f.report.accepted[0].timestamp,1_700_000_000_123);
  // A dropped final reply leaves only the final piece on retry; replay all to finish.
  const last=await f.send([f.parts.at(-1)]);assert.deepEqual(last.receipts,[]);
  let replay:any;for(const part of f.parts){replay=await f.send([part]);if(replay.receipts.length)break;}
  assert.equal(replay.receipts[0].state,'synced');assert.equal(f.report.accepted.length,1);
  const next={...f.turn,id:'next-turn',messages:[{role:'user',text:'下一轮照常上交'}]};
  const received=await f.post('/personal/v1/offline/turns',{generation:1,turns:[next]});
  assert.equal(received.receipts[0].state,'synced');assert.equal(f.report.accepted.length,2);
  for(const text of f.report.raw.slice(1))assert.ok(Buffer.from(text,'base64').length<=256*1024);
});

test('APPLE-3 wrong digest/index/descriptor and generation cannot acknowledge or mix originals',{timeout:30_000},async t=>{
  const f=await fixture(t);
  await f.send([{...f.parts[0],index:f.parts.length}],400);
  await f.send([f.parts[0]]);
  await f.send([{...f.parts[1],sha256:'0'.repeat(64)}],409);
  await f.send([{...f.parts[1],timestamp:f.turn.timestamp+1}],409);
  // A corrupt payload with the original digest fails when the complete bytes arrive.
  const corrupt=Buffer.from(f.parts.at(-1)!.data,'base64');corrupt[corrupt.length-2]^=1;
  for(const part of f.parts.slice(1,-1))await f.send([part]);
  await f.send([{...f.parts.at(-1),data:corrupt.toString('base64')}],409);
  assert.equal(f.report.accepted.length,0);
  await f.post('/configure',{generation:2});
  await f.send([f.parts[0]],409,1);await f.sync(2);
  const partial=await f.send([f.parts.at(-1)],200,2);assert.deepEqual(partial.receipts,[]);
  assert.equal(f.report.accepted.length,0,'old generation fragments were erased');
  let result:any;for(const part of f.parts){result=await f.send([part],200,2);if(result.receipts.length)break;}
  assert.equal(result.receipts[0].state,'synced');assert.equal(f.report.accepted.length,1);
});
