import test from 'node:test';
import assert from 'node:assert/strict';
import {forgetIndependentFact,needsForgetConfirmation} from './memory-first.mjs';
test('a requested confirmation is part of the same flow, but a deferred failure is not retried',()=>{
 assert.ok(needsForgetConfirmation('若你确认要永久忘掉这条记忆，可以再明确回复一次，我届时再提交删除。'));
 assert.ok(needsForgetConfirmation('请直接回复“确认永久忘掉这条零食偏好”，我再执行。'));
 assert.ok(needsForgetConfirmation('如果你确认要永久删除，请回复一句明确的“确认删除”，我再提交。'));
 assert.equal(needsForgetConfirmation('这次还没忘掉，稍后会再试。'),false);
 assert.equal(needsForgetConfirmation('已删除这条偏好。如果要重新记住请确认。'),false);
});
test('M7 without a formed target stops at its prerequisite and never reruns M1',async()=>{
 const sent=[],rows=['user','assistant'].map(role=>({classList:{contains:name=>role===name}}));
 const locator=selector=>({click:async()=>{},waitFor:async()=>{},isVisible:async()=>false,count:async()=>1,first(){return this;},evaluate:async fn=>fn(selector==='#transcript'?{querySelectorAll:()=>rows}:{closest:()=>({dataset:{sessionId:'seed'}})}),innerText:async()=>''});
 const ctx={page:{getByRole:locator,locator},send:async text=>sent.push(text),snapshot:async()=>({}),
  api:async path=>path.startsWith('/memory/items')?{status:200,body:{items:[]}}:{body:{sessions:[{sessionId:'seed',running:false,lastOutcome:'completed'}]}},
  until:async fn=>{for(let i=0;i<2;i++){const value=await fn();if(value)return value;}throw Error('target unavailable');}};
 await assert.rejects(forgetIndependentFact(ctx),/target unavailable/);
 assert.deepEqual(sent,['记住我最喜欢的零食是芝麻饼']);
});
