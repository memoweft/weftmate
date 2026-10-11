import { outputPath } from './evidence.mjs';
import {readFileSync,writeFileSync,rmSync,mkdtempSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {getEventListeners} from 'node:events';
import {nativeTimelineLog} from '../../../src/runtime/dsh-adapter/timeline.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms)), report={};
const fixtureUrl=pathToFileURL(resolve('tests/integration/timeline-ui-candidate.mjs'));
let code=readFileSync(fixtureUrl,'utf8').replaceAll('import.meta.url',JSON.stringify(fixtureUrl.href));
code=code.replace(/from '(\.\.?\/[^']+)'/g,(_,p)=>`from '${new URL(p,fixtureUrl).href}'`);
code=code.replace('return { root, origin,','return { root, origin, debug:{backend,service,eventWaiters,auth,cookie},');
const {startTimelineCandidate}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
export {startTimelineCandidate};
if(process.argv.includes('--export-only')){}else{
const f=await startTimelineCandidate({daily:true,inlineProgress:true,historyCount:0});
try{
 const main=(await f.request('/chats/main')).chat,host=(await f.request('/status')).hostId;
 const send=await f.request('/commands',{requestId:'rev-wait',kind:'chat.message',chatId:main.chatId,text:'synthetic',modelProfileId:'local',targetDeviceId:host});
 for(let n=0;n<100;n++){if((await f.request('/commands/'+send.command.commandId)).command.state==='accepted_by_dsh')break;await pause(10);}
 f.progress.text('synthetic done');f.progress.finish();
 const page=await f.request(`/chats/${main.chatId}/events?limit=100`);
 const waitPath=`/chats/${main.chatId}/changes?cursor=${page.syncCursor}&liveRevision=${page.liveRevision}&waitMs=2000`;
 const raw=(path,options={})=>fetch(f.origin+'/personal/v1'+path,{...options,headers:{origin:f.origin,cookie:f.debug.cookie,'content-type':'application/json','x-weftmate-csrf':f.debug.auth.csrfToken},...(options.body?{body:JSON.stringify(options.body)}:{})});
 const controllers=Array.from({length:4},()=>new AbortController());
 const waits=controllers.map(c=>raw(waitPath,{signal:c.signal}).then(async r=>({status:r.status,data:await r.json()})).catch(e=>({error:e.name})));
 await pause(100);report.fourWaiters=f.debug.eventWaiters.size;f.progress.chunk('wake all');report.fourResults=await Promise.all(waits);await pause(25);report.afterWakeWaiters=f.debug.eventWaiters.size;
 let cursor=report.fourResults[0].data.nextCursor,live=report.fourResults[0].data.liveRevision;
 const latest=()=>`/chats/${main.chatId}/changes?cursor=${cursor}&liveRevision=${live}&waitMs=2000`;
 report.switches=[];
 for(let i=0;i<20;i++){const c=new AbortController();const p=raw(latest(),{signal:c.signal}).catch(()=>null);await pause(15);const before=f.debug.eventWaiters.size;c.abort();await p;await pause(15);report.switches.push({before,after:f.debug.eventWaiters.size});}
 const original=f.debug.backend.waitForEvents;
 f.debug.backend.waitForEvents=()=>Promise.reject(Object.assign(new Error('backend synthetic rejection'),{code:'BACKEND_UNAVAILABLE',status:503}));
 let at=Date.now();let r=await raw(latest());report.rejectedWait={ms:Date.now()-at,status:r.status,body:await r.json(),remaining:f.debug.eventWaiters.size};f.debug.backend.waitForEvents=original;
 // Ordinary account mutation wakes an unchanged conversation immediately.
 at=Date.now();const settingWait=raw(latest());await pause(100);await f.request('/settings/personalization',{nextSuggestionsEnabled:false},'PATCH');r=await settingWait;report.settingsWake={ms:Date.now()-at,status:r.status,body:await r.json()};
 // Recheck authentication after the post-wait query: log out while this query is deliberately held.
 const originalRead=f.debug.backend.readEvents;let gateResolve,gateStarted=false,hold=false;
 const gate=new Promise(r=>gateResolve=r);
 f.debug.backend.readEvents=async args=>{if(hold&&!gateStarted){gateStarted=true;await gate;}return originalRead(args);};
 const authWait=raw(latest());await pause(100);hold=true;f.progress.text('must not leak after logout');
 for(let i=0;i<100&&!gateStarted;i++)await pause(5);
 const logout=await raw('/auth/logout',{method:'POST',body:{}});gateResolve();r=await authWait;
 report.logoutAfterQuery={gateStarted,logout:logout.status,response:r.status,body:await r.json()};f.debug.backend.readEvents=originalRead;
}finally{await f.close();rmSync(f.root,{recursive:true,force:true});}
// Invoke precisely the cleanup registered with Cordis, rather than the unused read.close method.
const temp=mkdtempSync(join(tmpdir(),'rev-bl29-log-')),effects=[],listeners=new Map();
const native={id:'synthetic-session',header:{},events:[]};
const ctx={on:(key,fn)=>listeners.set(key,fn),get:key=>key==='sessions'?new Map([[native.id,native]]):key==='sessionPersistence'?{config:{root:join(temp,'sessions')},listSnapshots:()=>[]}:undefined,effect:fn=>effects.push(fn())};
const read=nativeTimelineLog(ctx);const controller=new AbortController();let settled=false;
const started=Date.now(),waiting=read.waitForChange(native.id,-1,1200,controller.signal).then(()=>settled=true);
await pause(50);for(const dispose of effects)await dispose();await pause(100);
report.nativeDispose={settledAfterDispose:settled,abortListeners:getEventListeners(controller.signal,'abort').length};
await waiting;report.nativeDispose.waitMs=Date.now()-started;report.nativeDispose.listenersAfter=getEventListeners(controller.signal,'abort').length;
const ended=new AbortController();ended.abort();const at=Date.now();await read.waitForChange(native.id,-1,1000,ended.signal);report.nativeAlreadyAbortedMs=Date.now()-at;
rmSync(temp,{recursive:true,force:true});
writeFileSync(outputPath('server.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
