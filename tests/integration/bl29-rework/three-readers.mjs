import { outputPath } from './evidence.mjs';
import {startTimelineCandidate} from './fixture.mjs';
import {rmSync,writeFileSync} from 'node:fs';
const pause=ms=>new Promise(r=>setTimeout(r,ms)),report=[];
for(const order of ['native-first','commit-first','same-turn']){
 const f=await startTimelineCandidate({daily:true,inlineProgress:true,historyCount:0});
 const c=f.debug.service.__reviewContext,t=c.chatTimeline,original=t.query;
 try{
  const main=(await f.request('/chats/main')).chat,host=(await f.request('/status')).hostId;
  const sent=await f.request('/commands',{requestId:'three-readers',kind:'chat.message',chatId:main.chatId,text:'synthetic',modelProfileId:'local',targetDeviceId:host});
  while((await f.request('/commands/'+sent.command.commandId)).command.state!=='accepted_by_dsh')await pause(5);
  f.progress.text('baseline');f.progress.finish();
  const page=await f.request(`/chats/${main.chatId}/events?limit=100`),path=`/chats/${main.chatId}/changes?cursor=${page.syncCursor}&liveRevision=${page.liveRevision}&waitMs=1200`;
  let release,held=false;const gate=new Promise(r=>release=r);
  t.query=async(...args)=>{const v=await original(...args);if(args[2]==='changes'&&!held){held=true;await gate;}return v;};
  const a=f.request(path);while(!held)await pause(1);const b=f.request(path);await pause(10);
  const at=Date.now();const commit=()=>f.request('/settings/personalization',{nextSuggestionsEnabled:false},'PATCH');
  if(order==='native-first'){f.progress.text('new-'+order);await commit();}
  if(order==='commit-first'){await commit();f.progress.text('new-'+order);}
  if(order==='same-turn'){const p=commit();f.progress.text('new-'+order);await p;}
  const third=await f.request(path);release();const responses=await Promise.all([a,b]);
  report.push({order,ms:Date.now()-at,upserts:[...responses,third].map(x=>x.upserts.length),live:[...responses,third].map(x=>x.liveEvents?.length),counts:f.debug.service.__reviewCounts(),native:f.debug.eventWaiters.size});
 }finally{t.query=original;await f.close();rmSync(f.root,{recursive:true,force:true});}
}
writeFileSync(outputPath('three-readers.json'),JSON.stringify(report,null,2));console.log(report);
