import { outputPath } from './evidence.mjs';
import {chromium} from 'playwright';import {rmSync,writeFileSync} from 'node:fs';import {startTimelineCandidate} from './fixture.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms)),f=await startTimelineCandidate({daily:true,inlineProgress:true,logicalMobile:true,sidebar:true,historyCount:0,baseTime:Date.now()}),report={};let browser;
try{
 const cookies=[];for(const name of ['synthetic-device-1','synthetic-device-2']){const r=await fetch(f.origin+'/personal/v1/auth/login',{method:'POST',headers:{origin:f.origin,'content-type':'application/json'},body:JSON.stringify({...f.credentials,deviceName:name})});cookies.push(r.headers.get('set-cookie').split(';')[0]);}
 const chat=(await f.request('/chats/main')).chat,page=await f.request(`/chats/${chat.chatId}/events`),url=f.origin+`/personal/v1/chats/${chat.chatId}/changes?cursor=${page.syncCursor}&liveRevision=${page.liveRevision}&waitMs=1500`;
 const waits=cookies.flatMap(cookie=>[0,1].map(()=>fetch(url,{headers:{cookie}}).then(async r=>({status:r.status,body:await r.json()}))));await pause(70);report.twoDevicesTwoTabsDuring=f.debug.service.__reviewCounts();await f.request('/settings/personalization',{nextSuggestionsEnabled:false},'PATCH');report.twoDevicesTwoTabsResponses=(await Promise.all(waits)).map(r=>r.status);report.twoDevicesTwoTabsAfter=f.debug.service.__reviewCounts();
 browser=await chromium.launch({headless:true});const p=await browser.newPage({viewport:{width:390,height:844}});let calls=[],caps='old-wait';
 const backendWait=f.debug.backend.waitForEvents;delete f.debug.backend.waitForEvents;
 p.on('request',r=>{if(r.url().endsWith('/bridge')){const m=JSON.parse(r.postData());calls.push({method:m.method,path:m.params?.path});}});
 await p.goto(f.mobileUrl);await p.waitForFunction(()=>state.booted&&state.loggedIn&&uiCore.state.mainChat);await p.evaluate(()=>uiCore.selectMainChat());await pause(700);calls=[];await pause(4500);
 report.newUiOldHost={capability:await p.evaluate(()=>uiCore.state.personalCapabilities.replyWait),ms:4500,changes:calls.filter(r=>/\/changes\?/.test(r.path||'')).length,waitCalls:calls.filter(r=>/waitMs=/.test(r.path||'')).length};
 f.debug.backend.waitForEvents=backendWait;await p.close();
 const c=f.debug.service.__reviewContext;const initial=await f.request(`/chats/${chat.chatId}/events`);const waiting=fetch(f.origin+`/personal/v1/chats/${chat.chatId}/changes?cursor=${initial.syncCursor}&liveRevision=${initial.liveRevision}&waitMs=1500`,{headers:{cookie:f.debug.cookie}});await pause(70);const at=Date.now();
 await c.serial(()=>c.mutate(f.debug.auth.account.ownerId,next=>{next.chatIdentity.chats[chat.chatId].contentRevision++;}));const r=await waiting;report.contentGeneration={ms:Date.now()-at,status:r.status,body:await r.json()};
}finally{await browser?.close();await f.close();rmSync(f.root,{recursive:true,force:true});writeFileSync(outputPath('compat.json'),JSON.stringify(report,null,2));}console.log(report);
