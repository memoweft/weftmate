import { outputPath } from './evidence.mjs';
import {createChatTimeline} from '../../../src/personal-access/chat-timeline.mjs';
import {writeFileSync} from 'node:fs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let events=[],waits=[];const account={sessions:{s:{}},chatIdentity:{mainChatId:'c',timeZone:'UTC',segments:{g:{segmentId:'g',sessionId:'s',chatId:'c',hostId:'synthetic',ordinal:0,startedAt:new Date().toISOString()}}}};
const context={accountState:()=>account,chats:{requireChat:()=>({contentRevision:1,revision:1})},publicHistoryEvent:(_,__,event)=>event,publicLiveEvents:(_,__,events)=>events,callBackend:fn=>fn(),
 waitAccountChange:(_,signal)=>new Promise(r=>{const wake=()=>{signal.removeEventListener('abort',wake);r();};signal.addEventListener('abort',wake);}),
 backend:{readEvents:async({afterSeq=-1})=>({events:events.filter(e=>e.seq>afterSeq),nextSeq:events.at(-1)?.seq??-1,liveSeq:events.at(-1)?.seq??-1,hasMore:false,hasOlder:false,liveEvents:[]}),
 waitForEvents:async({seq,signal})=>{waits.push(seq);if((events.at(-1)?.seq??-1)>seq)return;await new Promise(r=>{const wake=()=>{signal.removeEventListener('abort',wake);r();};signal.addEventListener('abort',wake);});}}};
const timeline=createChatTimeline(context);
const page=await timeline.query('o','c','events',new URLSearchParams());
const params=new URLSearchParams({cursor:page.syncCursor});
const a=await timeline.query('o','c','changes',params);
// Another request reads the native event between A's query and A's wait registration.
events.push({seq:0,type:'user.message',at:new Date().toISOString(),data:{text:'arrived while A was preparing wait'}});
const b=await timeline.query('o','c','changes',params);
const at=Date.now();await timeline.waitForChange('o','c',0,1200,new AbortController().signal,a);
const report={clientAEmpty:a.upserts.length,clientBNew:b.upserts.length,subscribedNativeSeq:waits,waitMs:Date.now()-at,clientAAfter:(await timeline.query('o','c','changes',params)).upserts.length};
// Already aborted outer signals are also not forwarded at entry.
const controller=new AbortController();controller.abort();const before=Date.now();await timeline.waitForChange('o','c',0,250,controller.signal);report.alreadyAbortedMs=Date.now()-before;
await timeline.close();writeFileSync(outputPath('race.json'),JSON.stringify(report,null,2));console.log(report);
