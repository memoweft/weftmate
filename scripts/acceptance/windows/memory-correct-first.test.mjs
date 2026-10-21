import assert from 'node:assert/strict';
import test from 'node:test';
import {memoryCorrect} from './scenarios.mjs';

async function correctionFixture(firstAnswer='你更喜欢绿茶。'){ 
 const requests=[];let answer='';const click=async()=>{};
 const selected={count:async()=>1,first:()=>({evaluate:async()=> 'fixture-memory-session'})};
 const page={
  getByRole:(role,{name})=>{
   if(role==='tab')return {isVisible:async()=>true,click};
   if(role==='menuitemradio')return {click};
   if(role==='button'&&name==='停止回复')return {isVisible:async()=>false};
   throw Error('Unexpected role: '+role+'/'+name);
  },
  locator:selector=>{
   if(selector.endsWith('-surface'))return {isVisible:async()=>false};
   if(selector==='#new-session'||selector==='#model-trigger')return {click};
   if(selector==='#message-text')return {waitFor:async()=>{}};
   if(selector==='#session-list button.is-current')return selected;
   if(selector==='.message.assistant')return {last:()=>({innerText:async()=>answer})};
   if(selector==='#transcript')return {evaluate:async()=>true,innerText:async()=>answer};
   throw Error('Unexpected selector: '+selector);
  }
 };
 const ctx={page,
  send:async text=>{requests.push(text);answer=requests.length===1?'我记下了，稍后整理进记忆。':firstAnswer;},
  api:async()=>({body:{sessions:[{sessionId:'fixture-memory-session',running:false,lastOutcome:'completed'}]}}),
  until:async fn=>{const value=await fn();assert.ok(value);return value;},
  snapshot:async()=>({text:answer}),save:async()=>{},shot:async()=>{}
 };
 return {ctx,requests};
}
test('M2 judges the first new-chat answer, not whether the acknowledgement repeats green tea',async()=>{
 const {ctx,requests}=await correctionFixture(); const result=await memoryCorrect(ctx);
 assert.deepEqual(requests,['我其实更喜欢绿茶','我喜欢喝什么？']);
 assert.match(result.text,/绿茶/);
 assert.equal(ctx.memoryPreferredTea,'绿茶');
});

test('M2 frozen first answer cannot pass just because a deferred correction contains green tea',async()=>{
 const {ctx,requests}=await correctionFixture('根据记忆，你喜欢喝红茶。不过你最近说过“我其实更喜欢绿茶”，这个新偏好我稍后会整理进记忆，届时以绿茶为准。');
 await assert.rejects(memoryCorrect(ctx),/manual review|did not adopt/);assert.equal(requests.length,2);
});
test('M2 negative and contrast answers require review instead of keyword passing',async()=>{
 for(const answer of ['你不喜欢绿茶。','你喜欢红茶，而不是绿茶。','以前是红茶，现在你更喜欢绿茶。']){
  const {ctx}=await correctionFixture(answer);await assert.rejects(memoryCorrect(ctx),/manual review|did not adopt/);
 }
});
