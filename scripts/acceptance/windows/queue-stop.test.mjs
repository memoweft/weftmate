import assert from 'node:assert/strict';
import test from 'node:test';
import {setTimeout as pause} from 'node:timers/promises';
import {queueAndStop} from './scenarios.mjs';

test('stopping the active turn does not count the queued reply as cancellation latency',async()=>{
 let stoppedAt=null;const startedAt=Date.now();
 const done=()=>stoppedAt!==null&&Date.now()-stoppedAt>=200;
 const stop={waitFor:async()=>{},isVisible:async()=>!done(),click:async()=>{stoppedAt=Date.now();}};
 const selected={count:async()=>1,first:()=>({evaluate:async()=> 'fixture-session'})};
 const ctx={
  page:{
   getByRole:(role,{name})=>{assert.equal(role,'button');assert.equal(name,'停止回复');return stop;},
   locator:selector=>{
    if(selector==='.message.assistant')return {last:()=>({innerText:async()=>done()?'排队输入保留':'已经开始的合成流式正文。'.repeat(4)})};
    if(selector==='#session-list button.is-current')return selected;
    if(selector==='#transcript')return {evaluate:async()=>done(),innerText:async()=>'排队输入保留'};
    throw Error('Unexpected selector: '+selector);
   }
  },
  send:async()=>{},shot:async()=>{},save:async()=>{},snapshot:async()=>({text:'排队输入保留'}),
  api:async()=>({body:{sessions:[{sessionId:'fixture-session',running:!done(),lastOutcome:done()?'completed':'running'}]}}),
  until:async(fn)=>{const deadline=Date.now()+2000;while(Date.now()<deadline){const value=await fn();if(value)return value;await pause(2);}throw Error('Fixture timed out');}
 };
 const readEvents=async()=>[
  {type:'turn/start',time:startedAt,data:{turn:1}},
  ...(stoppedAt===null?[]:[
   {type:'turn/end',time:stoppedAt,data:{turn:1,reason:{kind:'aborted',reason:{kind:'user'}}}},
   {type:'turn/start',time:stoppedAt+1,data:{turn:2}},
   ...(done()?[{type:'turn/end',time:stoppedAt+200,data:{turn:2,reason:{kind:'completed'}}}]:[])
  ])
 ];
 const result=await queueAndStop(ctx,{newConversation:false,readEvents});
 assert.ok(result.stopElapsedMs<75,`Measured queued reply instead of stopped turn: ${result.stopElapsedMs}ms`);
 assert.ok(result.queueDrainElapsedMs>=200,'The queued reply still has to finish and be checked');
});
