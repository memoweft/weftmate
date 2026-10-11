import { outputPath } from './evidence.mjs';
import {startTimelineCandidate} from './fixture.mjs';
import {rmSync,writeFileSync} from 'node:fs';
const pause=ms=>new Promise(r=>setTimeout(r,ms)),report=[];
for(const kind of ['close','close-after-wake','logout']){
 const f=await startTimelineCandidate({daily:true,inlineProgress:true,historyCount:0});
 let release;
 try {
  const main=(await f.request('/chats/main')).chat;const snapshot=kind==='close-after-wake'?await f.request('/chats/'+main.chatId+'/events?limit=1'):null;
  let entered=false;const gate=new Promise(r=>release=r),models=f.debug.backend.listModels;
  f.debug.backend.listModels=async args=>{entered=true;await gate;return models(args);};
  const requestPath=snapshot?'/personal/v1/chats/'+main.chatId+'/changes?cursor='+snapshot.syncCursor+'&liveRevision='+snapshot.liveRevision+'&accountRevision='+snapshot.accountChanges.revision+'&waitMs=30000':'/personal/v1/chats/'+main.chatId+'/events?limit=1';const pending=fetch(f.origin+requestPath,{headers:{cookie:f.debug.cookie}}).then(async r=>({status:r.status,body:await r.json()})).catch(e=>({error:e.message}));
  if(snapshot){await pause(40);await f.request('/settings/personalization',{nextSuggestionsEnabled:false},'PATCH');}while(!entered)await pause(1);const at=Date.now();
  if(kind.startsWith('close')){await f.debug.service.close();release();}
  else {await f.request('/auth/logout',{});release();}
  report.push({kind,ms:Date.now()-at,result:await pending});
 }finally{release?.();await f.close();rmSync(f.root,{recursive:true,force:true});}
}
writeFileSync(outputPath('catalog-close.json'),JSON.stringify(report,null,2));console.log(report);
