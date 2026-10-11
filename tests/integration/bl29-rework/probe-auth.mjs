import { outputPath } from './evidence.mjs';
import {rmSync,writeFileSync} from 'node:fs';
process.argv.push('--export-only');const {startTimelineCandidate}=await import('./probe-server.mjs');
const pause=ms=>new Promise(r=>setTimeout(r,ms)),report=[];
for(const kind of ['revoke','password','delete-account']){
 const f=await startTimelineCandidate({daily:true,inlineProgress:true,historyCount:0});
 try{
  f.progress.text('synthetic completed');f.progress.finish();
  const raw=(path,body,method=body?'POST':'GET',desktop=false)=>fetch(f.origin+'/personal/v1'+path,{method,headers:{origin:f.origin,cookie:f.debug.cookie,'content-type':'application/json','x-weftmate-csrf':f.debug.auth.csrfToken,...(desktop?{'x-weftmate-desktop':f.libraryDesktopToken}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const chat=(await f.request('/chats/main')).chat,page=await f.request(`/chats/${chat.chatId}/events`);
  const pending=raw(`/chats/${chat.chatId}/changes?cursor=${page.syncCursor}&liveRevision=${page.liveRevision}&waitMs=3000`);await pause(100);const start=Date.now();let mutation;
  if(kind==='revoke')mutation=await raw('/auth/devices/'+f.debug.auth.device.id,null,'DELETE');
  if(kind==='password')mutation=await raw('/auth/change-password',{currentPassword:f.credentials.password,newPassword:'synthetic-next-password-123456'});
  if(kind==='delete-account')mutation=await raw('/data/close-account',{accountName:f.credentials.username,confirm:true},'POST',true);
  const response=await pending,row={kind,mutationStatus:mutation.status,responseStatus:response.status,ms:Date.now()-start,body:await response.json()};
  if(kind==='delete-account'){for(let i=0;i<100;i++){const op=f.debug.service.dataControls.nativeOperation(f.debug.auth.account.ownerId);row.operation=op;if(!['running','pending_confirmation'].includes(op?.state))break;await pause(50);}const last=await raw('/auth/me');row.finalAuthStatus=last.status;}
  report.push(row);
 }finally{await f.close();rmSync(f.root,{recursive:true,force:true});}
}
writeFileSync(outputPath('auth.json'),JSON.stringify(report,null,2));console.log(report);
