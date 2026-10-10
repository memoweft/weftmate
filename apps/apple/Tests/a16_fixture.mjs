// Real isolated personal/v1 host; deterministic native-log/model fixture. No daily data or model calls.
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPersonalAccessService } from '../../../src/personal-access/index.mjs';
import { syntheticBackend } from './a5_synthetic_backend.mjs';
process.umask(0o077);
const root=await realpath(await mkdtemp(join(tmpdir(),'wm-a16-'))),runtime=syntheticBackend(root);
const originals=runtime.backend.listModels;
runtime.backend.listModels=async()=> (await originals()).map(m=>({...m,apiKey:'A16_SYNTHETIC_SECRET_NEVER_DISPLAY',hiddenUserContent:'A16_SYNTHETIC_PRIVATE_BODY_NEVER_DISPLAY'}));
const evidence=runtime.backend.getTaskReplyEvidence;
runtime.backend.getTaskReplyEvidence=async args=>{const row=await evidence(args),s=runtime.sessions.get(args.sessionId);return {...row,status:s?.a16Ending==='error'?'failed':s?.a16Ending==='aborted'?'aborted':row.status};};
const host=await createPersonalAccessService({root:join(root,'host'),port:0,backend:runtime.backend});runtime.attach(host);
const started=await host.start(),grant=await host.issueSetupGrant();
const setup=await fetch(started.origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin:started.origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,username:'a5-tester',password:'synthetic-test-only',deviceName:'合成执行电脑'})});
const account=await setup.json(),auth={cookie:setup.headers.get('set-cookie').split(';')[0],'x-weftmate-csrf':account.csrfToken,origin:started.origin,'content-type':'application/json'};
const requests=[];
async function api(path,body,method=body===undefined?'GET':'POST'){
 const r=await fetch(started.origin+'/personal/v1'+path,{method,headers:auth,...(body===undefined?{}:{body:JSON.stringify(body)})}),x=await r.json();
 if(!r.ok)throw Error(path+' '+r.status+' '+JSON.stringify(x));return x;
}
async function settle(c){for(let i=0;i<100;i++){const x=(await api('/commands/by-request/'+c.requestId)).command;if(x.state==='accepted_by_dsh')return x;if(x.state==='rejected')throw Error(JSON.stringify(x));await new Promise(r=>setTimeout(r,30));}throw Error('dispatch timeout');}
await api('/settings/usage',{timeZone:'UTC'},'PATCH');
const main=(await api('/chats/main')).chat;
const mainCommand=await settle((await api('/commands',{requestId:'a16-main-first',kind:'chat.message',targetDeviceId:started.hostId,chatId:main.chatId,modelProfileId:'mimo',text:'A8_WAIT 合成主对话任务'})).command);
const native=runtime.sessions.get(mainCommand.sessionId),currentEvents=native.events;
// Ten thousand public messages; source seq / orderKey remain produced by the real host and DSH adapter.
const now=Date.now(),history=[];
for(let i=0;i<10000;i++)history.push({seq:i,time:now-(10000-i)*1800000,type:i%2?'assistant/message':'user/message',data:{id:randomUUID(),...(i%2?{}:{source:{kind:'user',rpcId:'a16-history-'+i}}),content:[{type:'text',text:(i===9500||i===9520?'A16查找纸船 ':'合成记录 ')+i+'：用于日期、搜索与滚动验证。'}]}});
native.events=history;for(const e of currentEvents)native.events.push({...e,seq:native.events.length});
await runtime.a8('tools',native);await runtime.a8('approvals',native);
const sides=[];
for(const state of ['completed','error','aborted']){
 const c=await settle((await api('/commands',{requestId:'a16-side-'+state,kind:'session.side.create',targetDeviceId:started.hostId,parent:{kind:'main',id:main.chatId},modelProfileId:'mimo',title:'合成旁聊 '+state,entry:'composer'})).command);
 const sent=await settle((await api('/commands',{requestId:'a16-result-'+state,kind:'session.message',targetDeviceId:started.hostId,sessionId:c.sessionId,text:'A8_WAIT 合成旁聊任务 '+state})).command);
 const s=runtime.sessions.get(c.sessionId);await runtime.a8('tools',s);runtime.finish(s,state);s.a16Ending=state;
 if(state==='error'){const answer=s.events.findLast(x=>x.type==='assistant/message');answer.data.content=[{type:'text',text:'合成检查失败，请检查输入文件。'}];}
 sides.push({chatId:c.chatId,sessionId:c.sessionId,state});
}
const seedTemporary=await settle((await api('/sessions/temporary',{requestId:'a16-seed-temp',modelProfileId:'mimo',autoDeleteDays:1})).command);
await settle((await api('/commands',{requestId:'a16-seed-temp-body',kind:'session.message',targetDeviceId:started.hostId,sessionId:seedTemporary.sessionId,text:'A8_WAIT A16 合成临时正文只留在临时旁聊'})).command);
let tail;
for(let i=0;i<200;i++){tail=await api('/chats/'+main.chatId+'/events?limit=100');if(tail.indexState==='ready')break;await new Promise(r=>setTimeout(r,10));}
const resultRows=tail.items.filter(x=>x.type==='side.result');
if(resultRows.map(x=>x.data.state).sort().join(',')!=='completed,failed,stopped')throw Error('Fixture terminal states did not project accurately');
const resultIDs=resultRows.map(x=>x.eventId);
const oldDay=tail.items.find(x=>x.at && x.at.slice(0,10)!==new Date().toISOString().slice(0,10))?.at.slice(0,10);
let search=await api('/chats/'+main.chatId+'/search?q='+encodeURIComponent('A16查找纸船')+'&limit=100');
const ready={seedTemporarySessionID:seedTemporary.sessionId,host:started.origin,mainChatID:main.chatId,sessionID:mainCommand.sessionId,oldDay,searchDay:new Date(now-500*1800000).toISOString().slice(0,10),searchEventID:search.hits[0]?.eventId,resultIDs,sides,historyCount:10000};
const metrics=[];let measurementActive=false;
const driver=createServer(async(req,res)=>{try{
 const path=new URL(req.url,'http://localhost').pathname;
 let value;
 if(path==='/ready')value=ready;
 else if(path==='/perf-start'){measurementActive=true;value={ok:true};}
 else if(path==='/perf-stop'){measurementActive=false;value={ok:true};}
 else if(path==='/performance-control')value={active:measurementActive};
 else if(path==='/report')value={syntheticOnly:true,realPersonalHTTPHost:true,historyCount:10000,compiledDSH:false,operations:runtime.operations,approvals:runtime.approvals.map(x=>({id:x.approvalId,resolved:!!x.resolved})),metrics,requests,resultStates:resultRows.map(x=>({eventId:x.eventId,state:x.data.state}))};
 else if(path==='/temporary')value=(await api('/chats?kind=side&limit=200')).items.filter(x=>x.hasTemporaryContent && x.activeSessionId!==seedTemporary.sessionId);
 else if(path==='/consume'){await runtime.consumeApprovals();value={ok:true};}
 else if(path==='/finish'){runtime.finish(native);value={ok:true};}
 else if(path==='/approval'){await runtime.a8('approvals',native);value={ok:true};}
 else if(path==='/metrics'){let body='';for await(const c of req)body+=c;metrics.push(JSON.parse(body));value={ok:true};}
 else if(path==='/expire'){
  const chats=(await api('/chats?kind=side&limit=200')).items.filter(x=>x.hasTemporaryContent);
  for(const c of chats)await api('/chats/'+c.chatId,{requestId:'a16-expire-'+randomUUID(),expectedRevision:c.revision},'DELETE');
  value={ok:true,deleted:chats.map(x=>x.chatId),mechanism:'explicit isolated lifecycle delete; 404 uses same client cleanup as expiry'};
 }
 else{res.writeHead(404).end();return;}
 res.setHeader('content-type','application/json');res.end(JSON.stringify(value));
}catch(e){res.writeHead(500,{'content-type':'application/json'}).end(JSON.stringify({error:String(e)}));}});
driver.listen(0,'127.0.0.1');await once(driver,'listening');
console.log(JSON.stringify({driver:'http://127.0.0.1:'+driver.address().port,root}));
async function cleanup(){driver.close();await host.close();await rm(root,{recursive:true,force:true});process.exit(0);}
process.on('SIGTERM',cleanup);process.on('SIGINT',cleanup);
