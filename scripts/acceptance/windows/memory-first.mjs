// Each invocation uses a fresh isolated profile. A failed first answer is never retried.
import assert from 'node:assert/strict';
import {newChat,waitTurn,memoryCorrect,memoryForgetPage} from './scenarios.mjs';

export function needsForgetConfirmation(answer){
 return /(?:请|若|如果|需要|可以再)[\s\S]{0,50}确认|回复[\s\S]{0,35}[“"「]?确认/.test(answer)&&!/已提交|已经忘|已删除/.test(answer);
}

export async function firstMemoryTrial(ctx,{correct=false}={}){
 const results={};
 async function observe(name,run){
  try{results[name]={result:'passed',value:await run()};}
  catch(error){
   results[name]={result:'failed',error:String(error.stack)};await ctx.shot(`${name}-first-failure`);
   // Clean up this failed turn so an unanswered work card cannot block the next case.
   const stop=ctx.page.getByRole('button',{name:'停止回复',exact:true});
   if(await stop.isVisible()){
    try{await stop.click();await ctx.until(async()=>!await stop.isVisible(),30000);results[name].failedTurnStopped=true;}
    catch(cleanupError){results[name].cleanupError=String(cleanupError);}
   }
  }
  await ctx.save('memory-first-results.json',results);
 }
 await observe('M1',async()=>{
  await newChat(ctx);await ctx.send('记住我喜欢喝红茶');
  ctx.memorySeedSessionId=await ctx.until(async()=>{const selected=ctx.page.locator('#session-list button.is-current');return await selected.count()&&await selected.first().evaluate(el=>el.closest('[data-session-id]')?.dataset.sessionId);},15000);
  ctx.memoryPreferredTea='红茶';await waitTurn(ctx);await ctx.shot('m1-seed');
  await newChat(ctx);await ctx.send('我喜欢喝什么？');await waitTurn(ctx);
  const answer=await ctx.page.locator('.message.assistant').last().innerText();
  await ctx.save('m1-first-answer.json',{answer,seedSessionId:ctx.memorySeedSessionId});await ctx.shot('m1-first-answer');
  assert.match(answer,/红茶|red\s+tea/i);assert.doesNotMatch(answer,/不(?:知道|记得)|没有.*(?:记录|记忆)|don't know|do not know/i);
  return {answer};
 });
 if(correct)await observe('M2',()=>memoryCorrect(ctx));
 await observe('M3',()=>memoryForgetPage(ctx));
 // A separate fact keeps M7 independent of M3, without rerunning the failed M1.
 await observe('M7',()=>forgetIndependentFact(ctx));
 return results;
}

export async function forgetIndependentFact(ctx){
 const seed='记住我最喜欢的零食是芝麻饼',query='我最喜欢的零食是什么？',value=/芝麻饼|sesame\s+(?:cake|cookie|biscuit)/i;
 await newChat(ctx);await ctx.send(seed);await waitTurn(ctx);
 const sessionId=await ctx.page.locator('#session-list button.is-current').first().evaluate(el=>el.closest('[data-session-id]')?.dataset.sessionId);
 const before=await ctx.until(async()=>{const r=await ctx.api('/memory/items?kind=cognition');return r.status===200&&r.body.items?.some(row=>value.test(row.text))&&r;},90000);
 const targets=before.body.items.filter(row=>value.test(row.text));
 await newChat(ctx);await ctx.send('请永久忘掉我最喜欢的零食是芝麻饼这条记忆，默认保留聊天原话。');await waitTurn(ctx);
 let answer=await ctx.page.locator('.message.assistant').last().innerText(),confirmed=false;
 if(needsForgetConfirmation(answer)){
  confirmed=true;await ctx.send('确认永久忘掉这条零食偏好，保留聊天原话。');await waitTurn(ctx);answer=await ctx.page.locator('.message.assistant').last().innerText();
 }
 await ctx.save('m7-first-receipt.json',{answer,confirmed,before});await ctx.shot('m7-first-receipt');
 // This is also the first new-dialogue turn after forgetting (#582).
 await newChat(ctx);await ctx.send(query);await waitTurn(ctx);
 const recall=await ctx.page.locator('.message.assistant').last().innerText(),after=await ctx.api('/memory/items?kind=cognition');
 const sources=await Promise.all(targets.map(row=>ctx.api(`/memory/items/${row.kind}/${encodeURIComponent(row.id)}/sources`)));
 const original=await ctx.api(`/sessions/${sessionId}/events?limit=200`);
 const originalRetained=original.status===200&&JSON.stringify(original.body).includes(seed);
 const result={answer,confirmed,recall,before,after,sources,originalRetained};
 await ctx.save('m7-first-result.json',result);await ctx.shot('m7-first-recall');
 assert.equal(after.status,200);assert.ok(!after.body.items.some(row=>value.test(row.text)),'M7: target remains in memory page');
 assert.ok(sources.every(row=>!value.test(JSON.stringify(row.body))),'M7: erased source text is returned');
 assert.ok(originalRetained,'M7: original chat was removed');assert.doesNotMatch(recall,value,'M7: first new dialogue still knows erased fact');
 return result;
}
