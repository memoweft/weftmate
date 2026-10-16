import { outputPath } from './evidence.mjs';
import {startTimelineCandidate} from './fixture.mjs';
import {rmSync,writeFileSync} from 'node:fs';
import {waitForCondition} from '../../helpers/wait-for-condition.mjs';
import {waitForCommand} from '../../helpers/wait-for-command.mjs';
import {waitForPublishedText} from '../../helpers/wait-for-published-text.mjs';
const f=await startTimelineCandidate({daily:true,inlineProgress:true,historyCount:0});const report={};
try{
 const c=(await f.request('/chats/main')).chat,h=(await f.request('/status')).hostId;
 const send=await f.request('/commands',{requestId:'http-race',kind:'chat.message',chatId:c.chatId,text:'synthetic',modelProfileId:'local',targetDeviceId:h});
 await waitForCommand(async()=>(await f.request('/commands/'+send.command.commandId)).command);f.progress.text('done');f.progress.finish();
 await waitForPublishedText(()=>f.request(`/chats/${c.chatId}/events?limit=100`),'done');
 const page=await f.request(`/chats/${c.chatId}/events?limit=100`),base=`/chats/${c.chatId}/changes?cursor=${page.syncCursor}&liveRevision=${page.liveRevision}`;
 const timeline=f.debug.service.__reviewContext.chatTimeline,original=timeline.query;let release,held=false;
 const gate=new Promise(r=>release=r);timeline.query=async(...args)=>{const v=await original(...args);if(args[2]==='changes'&&!held){held=true;await gate;}return v;};
 const pending=f.request(base+'&waitMs=1200');await waitForCondition(()=>held,{label:'A first query held'});
 f.progress.text('native message which B sees first');const b=await f.request(base+'&waitMs=1');report.bUpserts=b.upserts.length;
 // Include every scheduling delay after release, with no guessed sleep offset.
 const start=performance.now();release();const a=await pending;report.aDelayAfterReleaseMs=performance.now()-start;report.aUpserts=a.upserts.length;report.after=f.debug.service.__reviewCounts();report.nativeAfter=f.debug.eventWaiters.size;
 timeline.query=original;
 // Four simultaneous requests, then cancel all twenty successive HTTP reads.
 // Waiters cannot expire and hide a cancellation leak during the checks.
 const p=await f.request(`/chats/${c.chatId}/events`),url=f.origin+'/personal/v1'+`/chats/${c.chatId}/changes?cursor=${p.syncCursor}&liveRevision=${p.liveRevision}&waitMs=30000`;
 const counts=()=>f.debug.service.__reviewCounts(),drained=()=>counts().accountWaiters===0&&f.debug.eventWaiters.size===0;
 const request=(c,headers={})=>fetch(url,{headers:{cookie:f.debug.cookie,...headers},signal:c.signal}).catch(()=>null);
 const controllers=Array.from({length:4},()=>new AbortController()),requests=controllers.map(c=>request(c));
 await waitForCondition(()=>counts().accountWaiters===4,{label:'four HTTP waiters registered'});report.four=counts();controllers.forEach(c=>c.abort());await Promise.all(requests);
 await waitForCondition(drained,{label:'four cancelled reads drained'});report.fourAfter=counts();
 report.switches=[];for(let i=0;i<20;i++){const c=new AbortController(),r=request(c);await waitForCondition(()=>counts().accountWaiters===1,{label:`read ${i} registered`});const before=counts().accountWaiters;c.abort();await r;await waitForCondition(drained,{label:`read ${i} cancelled`});report.switches.push([before,counts().accountWaiters]);}
 let finishQueries,prepared=0,returned=0;const queryGate=new Promise(r=>finishQueries=r),responses=[];
 // Client abort resolution does not prove the server has observed the close.
 const onRequest=(req,res)=>{if(req.headers['x-ci-probe']==='early')responses.push(res);};f.debug.service.__reviewServer().on('request',onRequest);
 timeline.query=async(...args)=>{const result=await original(...args);if(args[2]==='changes'){prepared++;await queryGate;returned++;}return result;};
 const early=Array.from({length:20},()=>new AbortController()),earlyRequests=early.map(c=>request(c,{'x-ci-probe':'early'}));
 try{
  await waitForCondition(()=>prepared===20,{label:'twenty first queries held'});early.forEach(c=>c.abort());await Promise.all(earlyRequests);
  await waitForCondition(()=>responses.length===20&&responses.every(r=>r.destroyed),{label:'server received twenty disconnects'});finishQueries();
  await waitForCondition(()=>returned===20&&drained(),{label:'cancelled first queries returned without waiters'});
  report.abortBeforeWait={prepared,accountWaiters:counts().accountWaiters,nativeWaiters:f.debug.eventWaiters.size};
 }finally{finishQueries();timeline.query=original;f.debug.service.__reviewServer().off('request',onRequest);}
}finally{await f.close();rmSync(f.root,{recursive:true,force:true});writeFileSync(outputPath('http-race.json'),JSON.stringify(report,null,2));}console.log(report);
