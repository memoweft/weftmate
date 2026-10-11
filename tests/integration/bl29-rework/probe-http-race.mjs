import { outputPath } from './evidence.mjs';
import {startTimelineCandidate} from './fixture.mjs';
import {rmSync,writeFileSync} from 'node:fs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));const f=await startTimelineCandidate({daily:true,inlineProgress:true,historyCount:0});const report={};
try{
 const c=(await f.request('/chats/main')).chat,h=(await f.request('/status')).hostId;
 const send=await f.request('/commands',{requestId:'http-race',kind:'chat.message',chatId:c.chatId,text:'synthetic',modelProfileId:'local',targetDeviceId:h});
 for(let i=0;i<100;i++){if((await f.request('/commands/'+send.command.commandId)).command.state==='accepted_by_dsh')break;await pause(10);}f.progress.text('done');f.progress.finish();
 const page=await f.request(`/chats/${c.chatId}/events?limit=100`),base=`/chats/${c.chatId}/changes?cursor=${page.syncCursor}&liveRevision=${page.liveRevision}`;
 const timeline=f.debug.service.__reviewContext.chatTimeline,original=timeline.query;let release,held=false;
 const gate=new Promise(r=>release=r);timeline.query=async(...args)=>{const v=await original(...args);if(args[2]==='changes'&&!held){held=true;await gate;}return v;};
 const pending=f.request(base+'&waitMs=1200');while(!held)await pause(2);
 f.progress.text('native message which B sees first');const b=await f.request(base+'&waitMs=1');report.bUpserts=b.upserts.length;release();await pause(30);
 report.waitersDuring=f.debug.service.__reviewCounts();report.nativeWaitersDuring=f.debug.eventWaiters.size;
 const start=Date.now(),a=await pending;report.aDelayAfterReleaseMs=Date.now()-start+30;report.aUpserts=a.upserts.length;report.after=f.debug.service.__reviewCounts();report.nativeAfter=f.debug.eventWaiters.size;
 timeline.query=original;
 // Four simultaneous requests, then cancel all twenty successive HTTP reads.
 const p=await f.request(`/chats/${c.chatId}/events`),url=f.origin+'/personal/v1'+`/chats/${c.chatId}/changes?cursor=${p.syncCursor}&liveRevision=${p.liveRevision}&waitMs=2000`;
 const controllers=Array.from({length:4},()=>new AbortController());const requests=controllers.map(c=>fetch(url,{headers:{cookie:f.debug.cookie},signal:c.signal}).catch(()=>null));await pause(50);report.four=f.debug.service.__reviewCounts();controllers.forEach(c=>c.abort());await Promise.all(requests);await pause(30);report.fourAfter=f.debug.service.__reviewCounts();
 report.switches=[];for(let i=0;i<20;i++){const c=new AbortController();const r=fetch(url,{headers:{cookie:f.debug.cookie},signal:c.signal}).catch(()=>null);await pause(15);const before=f.debug.service.__reviewCounts().accountWaiters;c.abort();await r;await pause(15);report.switches.push([before,f.debug.service.__reviewCounts().accountWaiters]);}
 let finishQueries,prepared=0;const queryGate=new Promise(r=>finishQueries=r);
 timeline.query=async(...args)=>{const result=await original(...args);if(args[2]==='changes'){prepared++;await queryGate;}return result;};
 const early=Array.from({length:20},()=>new AbortController()),earlyRequests=early.map(c=>fetch(url,{headers:{cookie:f.debug.cookie},signal:c.signal}).catch(()=>null));
 while(prepared<20)await pause(5);early.forEach(c=>c.abort());await Promise.all(earlyRequests);await pause(30);finishQueries();await pause(50);
 report.abortBeforeWait={prepared,accountWaiters:f.debug.service.__reviewCounts().accountWaiters,nativeWaiters:f.debug.eventWaiters.size};
 await pause(2050);report.abortBeforeWait.afterTimeout=f.debug.service.__reviewCounts().accountWaiters;timeline.query=original;
}finally{await f.close();rmSync(f.root,{recursive:true,force:true});writeFileSync(outputPath('http-race.json'),JSON.stringify(report,null,2));}console.log(report);
