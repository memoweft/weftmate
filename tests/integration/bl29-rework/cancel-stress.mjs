import { outputPath } from './evidence.mjs';
import {startTimelineCandidate} from './fixture.mjs';
import {rmSync,writeFileSync} from 'node:fs';
import {getEventListeners} from 'node:events';
import {createHook} from 'node:async_hooks';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const f=await startTimelineCandidate({daily:true,inlineProgress:true,historyCount:0});
const c=f.debug.service.__reviewContext,t=c.chatTimeline,original=t.query,report={samples:[]};
const ownedTimers=new Set();const hook=createHook({init(id,type){if(type==='Timeout'&&/chat-timeline.mjs|dsh-adapter[\\/]timeline.mjs/.test(new Error().stack))ownedTimers.add(id);},destroy(id){ownedTimers.delete(id);}});hook.enable();
try {
 const main=(await f.request('/chats/main')).chat,page=await f.request(`/chats/${main.chatId}/events`);
 const url=f.origin+`/personal/v1/chats/${main.chatId}/changes?cursor=${page.syncCursor}&liveRevision=${page.liveRevision}&waitMs=30000`;
 const started=Date.now();
 for(let i=0;i<1000;i++) {
  let release,entered=false;const gate=new Promise(r=>release=r);
  t.query=async(...args)=>{const value=await original(...args);if(args[2]==='changes'){entered=true;await gate;}return value;};
  const controller=new AbortController();const req=fetch(url,{headers:{cookie:f.debug.cookie},signal:controller.signal}).catch(()=>null);
  while(!entered)await pause(1);controller.abort();await req;await pause(2);release();
  await pause(Math.max(2,started+(i+1)*120-Date.now()));
  if((i+1)%100===0) {global.gc?.();report.samples.push({n:i+1,elapsed:Date.now()-started,...counters(),heapUsed:process.memoryUsage().heapUsed,rss:process.memoryUsage().rss});}
 }
 report.final=counters();report.elapsed=Date.now()-started;
}finally{t.query=original;hook.disable();await f.close();rmSync(f.root,{recursive:true,force:true});writeFileSync(outputPath('cancel-stress.json'),JSON.stringify(report,null,2));}
function counters(){return {...f.debug.service.__reviewCounts(),nativeWaiters:f.debug.eventWaiters.size,closingListeners:getEventListeners(c.closingSignal,'abort').length,waitTimers:ownedTimers.size};}
console.log(report);
