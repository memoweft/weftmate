import test from 'node:test';
import assert from 'node:assert/strict';
const moduleUrl=process.env.ACCEPTANCE_SCENARIOS_MODULE??new URL('./scenarios.mjs',import.meta.url).href;
const {waitTurn,memoryCorrect,memoryForgetPage,memoryForgetChat}=await import(moduleUrl);
function fixture({answers=[],initiallyRunning=false}={}){
 let answer='',running=initiallyRunning,reads=0;
 const rows=['user','assistant'].map(role=>({classList:{contains:name=>name===role}}));
 const item=selector=>({count:async()=>1,isVisible:async()=>false,isEnabled:async()=>true,isChecked:async()=>false,click:async()=>{},waitFor:async()=>{},first(){return this;},last(){return this;},getByRole(){return this;},innerText:async()=>selector==='#memory-list'?'绿茶':selector==='#transcript'?'user\n'+answer:answer,evaluate:async fn=>fn(selector==='#transcript'?{querySelectorAll:()=>rows}:{closest:()=>({dataset:{sessionId:'synthetic'}})})});
 const ctx={page:{getByRole:()=>item('role'),locator:item},api:async()=>{reads++;const wasRunning=running;running=false;return {body:{sessions:[{sessionId:'synthetic',running:wasRunning,lastOutcome:wasRunning?null:'completed'}]}};},until:async fn=>{for(let n=0;n<4;n++)if(await fn())return;throw Error('fixture deadline');},snapshot:async()=>({answer,nativeReads:reads}),send:async()=>{answer=answers.shift()??'';},save:async()=>{},shot:async()=>{}};
 return ctx;
}
test('completion waits for the actual session even when the visible transcript looks finished',async()=>{
 const ctx=fixture({initiallyRunning:true});const result=await waitTurn(ctx);assert.ok(result.nativeReads>=2,'the initial native state is still running');
});
test('a correction expressed as green tea still runs the required first new conversation',async()=>{
 const ctx=fixture({answers:["I've noted your preference for green tea.",'You prefer green tea.']});await memoryCorrect(ctx);assert.equal(ctx.memoryPreferredTea,'绿茶');
});
test('a completed work session in a collapsed project is checked against its unique visible title',async()=>{
 const ctx=fixture(),locator=ctx.page.locator;ctx.page.locator=selector=>selector==='#session-list button.is-current'?{count:async()=>0}:selector==='#assistant-title'?{innerText:async()=> 'Synthetic work'}:locator(selector);
 let reads=0;ctx.api=async()=>{reads++;return {body:{sessions:[{sessionId:'work',mode:'work',title:'Synthetic work',running:reads===1,lastOutcome:reads===1?null:'completed'}]}};};
 await waitTurn(ctx);assert.ok(reads>=2);
});
function deletionFixture(answers){
 const ctx=fixture({answers}),native=ctx.api;let lists=0;
 ctx.memorySeedSessionId='seed';ctx.memoryPreferredTea='绿茶';
 ctx.api=async path=>{
  if(path.startsWith('/memory/items?'))return {status:200,body:{items:lists++===0?[{id:'tea',kind:'cognition',text:'绿茶',currentState:'current'}]:[]}};
  if(path.endsWith('/sources'))return {status:404,body:{}};
  if(path.startsWith('/sessions/seed/'))return {status:200,body:{text:'记住我喜欢喝红茶'}};
  return native(path);
 };return ctx;
}
test('page forgetting cannot pass with empty API results while the new chat still knows the preference',async()=>{
 await assert.rejects(memoryForgetPage(deletionFixture(['你喜欢绿茶'])),/still recalls the forgotten preference/);
});
test('chat forgetting cannot pass with empty API results while the new chat still knows the preference',async()=>{
 await assert.rejects(memoryForgetChat(deletionFixture(['已经忘了','你喜欢绿茶'])),/still recalls the forgotten preference/);
});
