import { outputPath } from './evidence.mjs';
import {startTimelineCandidate} from './fixture.mjs';
import {rmSync,writeFileSync} from 'node:fs';
const f=await startTimelineCandidate({daily:true,inlineProgress:true,historyCount:0}),c=f.debug.service.__reviewContext,owner=f.debug.auth.account.ownerId;
const pause=ms=>new Promise(r=>setTimeout(r,ms));let release;const report={};
try{
 const host=(await f.request('/status')).hostId,accepted=async command=>{let row;while((row=(await f.request('/commands/'+command.commandId)).command).state!=='accepted_by_dsh')await pause(5);return row;};
 const {sessionId}=await accepted((await f.request('/commands',{requestId:'catalog-generation-create',kind:'session.create',modelProfileId:'local',targetDeviceId:host})).command);
 await accepted((await f.request('/commands',{requestId:'catalog-generation',kind:'session.message',sessionId,text:'Synthetic text selected for erasure',targetDeviceId:host})).command);
 const main=(await f.request('/chats?limit=100')).items.find(row=>row.activeSessionId===sessionId);
 f.progress.text('Synthetic reply selected for erasure');f.progress.finish();
 let entered=false;const gate=new Promise(r=>release=r),models=f.debug.backend.listModels;
 f.debug.backend.listModels=async args=>{entered=true;await gate;return models(args);};
 const pending=fetch(f.origin+`/personal/v1/chats/${main.chatId}/events?limit=100`,{headers:{cookie:f.debug.cookie}});
 while(!entered)await pause(1);
 await c.serial(()=>c.mutate(owner,next=>{next.chatIdentity.chats[main.chatId].contentRevision++;}));
 release();const response=await pending,body=await response.json();
 report.status=response.status;report.returnedRevision=body.contentRevision;report.currentRevision=c.accountState(owner).chatIdentity.chats[main.chatId].contentRevision;report.returnedSyntheticBody=JSON.stringify(body).includes('Synthetic text selected for erasure');
 report.subsequentStatus=(await fetch(f.origin+`/personal/v1/chats/${main.chatId}/changes?cursor=${body.syncCursor}`,{headers:{cookie:f.debug.cookie}})).status;
}finally{release?.();await f.close();rmSync(f.root,{recursive:true,force:true});writeFileSync(outputPath('catalog-generation.json'),JSON.stringify(report,null,2));}
console.log(report);
