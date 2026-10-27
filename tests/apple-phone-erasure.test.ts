import test from 'node:test';
import assert from 'node:assert/strict';
import {startPhoneTurnFragmentServer} from '../apps/apple/Tests/phone_turn_fragment_server.mjs';
import {openTask,taskRecipient} from '../src/personal-offline/crypto.mjs';

// Windows verifies the real desktop HTTP seam. Swift erasure assertions run on macOS,
// and actual MemoWeft formation/forgetting is separately accepted in APPLE-5.
test('APPLE-4 desktop forget changes generation and removes synthetic memory from decrypted replica',{timeout:30_000},async t=>{
  const f=await startPhoneTurnFragmentServer();t.after(()=>f.close());
  const post=async(path:string,body:any,expected=200)=>{
    const response=await fetch(f.origin+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json();assert.equal(response.status,expected,JSON.stringify(result));return result;
  };
  const identity={ownerId:'owner-test',hostId:'host-test',deviceId:'device-test'},recipient=taskRecipient();
  const sync=async(generation:number,hashes={})=>openTask(await post('/personal/v1/offline/sync',{generation,hashes,publicJwk:recipient.publicJwk,phoneFirst:true}),recipient,identity);
  await post('/configure',{memory:true});
  const initial=await sync(0);assert.equal(initial.generation,1);assert.equal(initial.items[0].id,'tea');
  const original={id:'synthetic-original',conversationId:'synthetic-chat',timestamp:1_700_000_000_123,
    messages:[{role:'user',text:'合成原话：我喜欢茉莉花茶'},{role:'assistant',text:'合成记忆派生回复'}],memoryRefs:[{kind:'cognition',id:'tea'}],dependencyComplete:true};
  const receipt=await post('/personal/v1/offline/turns',{generation:1,turns:[original]});
  assert.equal(receipt.receipts[0].state,'synced');
  assert.equal(f.report.accepted.length,1);
  await post('/configure',{generation:2,memory:false});
  const erased=await sync(1,initial.hashes);
  assert.equal(erased.generation,2);assert.equal(erased.control.generation,2);assert.equal(erased.reset,true);
  assert.deepEqual(erased.items,[]);assert.deepEqual(erased.hashes,{});
  assert.ok(!JSON.stringify(erased).includes('茉莉花茶'));
  await post('/personal/v1/offline/turns',{generation:1,turns:[original]},409);
  assert.equal(f.report.accepted.length,1,'stale-generation packet cannot form another import');
  // Desktop raw chat remains viewable; erasing memory is distinct from erasing originals.
  const report=await (await fetch(f.origin+'/report')).json();
  assert.ok(JSON.stringify(report.history).includes(original.messages[0].text));
});

test('APPLE-4 controlled SSE can hold and release a late response while capturing actual model input',{timeout:30_000},async t=>{
  const f=await startPhoneTurnFragmentServer();t.after(()=>f.close());
  await fetch(f.origin+'/configure',{method:'POST',body:JSON.stringify({pauseModel:true,reply:'合成迟到正文'})});
  const response=await fetch(f.origin+'/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer synthetic-state-key','content-type':'application/json'},
    body:JSON.stringify({model:'phone-configured',stream:true,messages:[{role:'user',content:'合成问题'}]})});
  const reader=response.body!.getReader(),first=await reader.read();
  assert.match(new TextDecoder().decode(first.value),/合成中途派生片段/);
  assert.equal(f.report.chats[0].messages[0].content,'合成问题');
  await fetch(f.origin+'/release',{method:'POST',body:'{}'});
  let remaining='';for(;;){const part=await reader.read();if(part.done)break;remaining+=new TextDecoder().decode(part.value);}
  assert.match(remaining,/合成迟到正文/);assert.match(remaining,/\[DONE\]/);
});
