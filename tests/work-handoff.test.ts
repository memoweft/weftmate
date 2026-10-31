// 保护：工作交接只能读取已确认消息之前的原会话；已遗忘内容和超量历史不能重新注入。
import test from 'node:test';
import assert from 'node:assert/strict';
import {workHandoff} from '../src/personal-access/work-handoff.mjs';
function fixture(events:any[],forgottenSeqs:number[]=[]){
  const anchor={seq:100,type:'user.message',data:{receiptId:'receipt',text:'确认切换工作模式'}};
  return {accountState:()=>({sessions:{source:{forgottenSeqs}}}),callBackend:fn=>fn(),publicHistoryEvent:(_o,_s,e)=>e,
    backend:{readSourceEvents:async()=>({events:[anchor]}),readEvents:async input=>{
      assert.equal(input.beforeSeq,100);return {events,hasOlder:false};
    }}};
}
const source={sessionId:'source',receiptId:'receipt'};
test('confirmation keeps prior user goals and assistant plans separate from the current request',async()=>{
  const h=await workHandoff(fixture([{seq:1,type:'user.message',data:{text:'打开浏览器并搜索百度'}},
    {seq:2,type:'assistant.message',data:{text:'第二个方案用浏览器。'}},{seq:101,type:'user.message',data:{text:'尚未确认的新请求'}}]),'owner',{turn:2},source);
  assert.match(h.text,/打开浏览器并搜索百度/);assert.doesNotMatch(h.text,/尚未确认的新请求/);
  assert.deepEqual(h.sourceRefs,[{sessionId:'source',seq:1},{sessionId:'source',seq:2},{sessionId:'source',seq:100}]);
});
test('forgotten sources are excluded and an erased confirmation cannot start work',async()=>{
  const f=fixture([{seq:1,type:'user.message',data:{text:'已遗忘的秘密'}}],[1]);
  assert.equal(await workHandoff(f,'owner',{turn:2},source),null);
  await assert.rejects(workHandoff(fixture([],[100]),'owner',{turn:2},source),{code:'SOURCE_UNAVAILABLE'});
});
test('large history remains inside the native context budget',async()=>{
  const h=await workHandoff(fixture(Array.from({length:90},(_,seq)=>({seq,type:'user.message',data:{text:'合成背景'.repeat(3000)}}))),'owner',{turn:2},source);
  assert.ok(Buffer.byteLength(h.text,'utf8')<=16384);assert.equal(h.truncated,true);
});
