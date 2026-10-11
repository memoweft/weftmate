import { outputPath } from './evidence.mjs';
import {startTimelineCandidate} from './fixture.mjs';import {rmSync,writeFileSync} from 'node:fs';import {randomUUID} from 'node:crypto';
const pause=ms=>new Promise(r=>setTimeout(r,ms)),f=await startTimelineCandidate({daily:true,inlineProgress:true,sidebar:true,historyCount:0,baseTime:Date.now()}),report=[];
const raw=path=>fetch(f.origin+'/personal/v1'+path,{headers:{cookie:f.debug.cookie}});
try{
 f.progress.text('initial done');f.progress.finish();const main=(await f.request('/chats/main')).chat,host=(await f.request('/status')).hostId;
 async function command(text){const c=await f.request('/commands',{requestId:randomUUID(),kind:'chat.message',chatId:main.chatId,text,modelProfileId:'local',targetDeviceId:host});for(let i=0;i<100;i++){const r=(await f.request('/commands/'+c.command.commandId)).command;if(r.state==='accepted_by_dsh')return r;await pause(10);}throw Error('command not accepted');}
 async function test(name,chatId,change){const p=await f.request(`/chats/${chatId}/events?limit=100`);const response=raw(`/chats/${chatId}/changes?cursor=${p.syncCursor}&liveRevision=${p.liveRevision}&waitMs=1500`);await pause(70);const at=Date.now();const action=await change();const r=await response,b=await r.json();report.push({name,ms:Date.now()-at,status:r.status,upserts:b.upserts?.length,live:b.liveEvents?.length,error:b.error?.code,action});}
 await test('empty-main-first-message',main.chatId,async()=>({sessionId:(await command('first')).sessionId}));f.progress.text('done');f.progress.finish();
 await test('another-message-existing-main',main.chatId,async()=>({sessionId:(await command('another')).sessionId}));
 let approval;await test('approval-appears',main.chatId,async()=>{approval=await f.progress.approve('rev-approval','Write-Output synthetic');return {approvalId:approval.approvalId};});
 await test('approval-resolved-other-device',main.chatId,async()=>{await f.request(`/sessions/${approval.tuple.sessionId}/approvals/${approval.approvalId}`,{requestId:randomUUID(),outcome:'allowed-once'});await f.progress.resolve(approval,'allowed-once');});
 let question;await test('question-appears',main.chatId,async()=>{question=f.progress.ask([{id:'q',question:'synthetic?',options:[]}]);return {questionRpcId:question.questionRpcId};});
 await test('question-answered',main.chatId,()=>f.request(`/sessions/${question.sessionId}/questions/${question.questionRpcId}`,{requestId:randomUUID(),answer:{answers:[{id:'q',selected:[],custom:'synthetic'}]}}));f.progress.text('done');f.progress.finish();
 const previous=(await f.request('/chats/main')).chat.activeSessionId;f.relayNextMain();await test('main-handoff',main.chatId,async()=>({previous,sessionId:(await command('new segment')).sessionId}));f.progress.text('done');f.progress.finish();
 await test('personalization',main.chatId,()=>f.request('/settings/personalization',{nextSuggestionsEnabled:false},'PATCH'));
 const side=(await f.request(`/sessions/${f.sessionId}/chat`)).chatId;
 await test('side-rename',side,()=>f.request(`/sessions/${f.sessionId}/metadata`,{title:'renamed'},'PATCH'));
 let current=(await f.request(`/chats/${side}`)).chat;await test('side-archive',side,()=>f.request(`/chats/${side}/archive`,{requestId:randomUUID(),expectedRevision:current.revision}));
 const page=await f.request(`/chats/${side}/events`),at=Date.now(),archived=await raw(`/chats/${side}/changes?cursor=${page.syncCursor}&liveRevision=${page.liveRevision}&waitMs=200`);report.push({name:'archived-steady-wait',status:archived.status,ms:Date.now()-at});
 current=(await f.request(`/chats/${side}`)).chat;await test('side-delete',side,()=>f.request(`/chats/${side}`,{requestId:randomUUID(),expectedRevision:current.revision},'DELETE'));
 const gone=await raw(`/chats/${side}/changes?cursor=${page.syncCursor}&liveRevision=${page.liveRevision}&waitMs=200`);report.push({name:'deleted-subsequent',status:gone.status,body:await gone.json()});
}catch(e){report.push({failure:e.message});}finally{await f.close();rmSync(f.root,{recursive:true,force:true});writeFileSync(outputPath('events.json'),JSON.stringify(report,null,2));console.log(report);}
