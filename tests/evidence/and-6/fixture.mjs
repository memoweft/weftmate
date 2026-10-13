import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {startNativeFixture} from '../and-4/fixture.mjs';

/** Same real login and native business dispatcher as AND-5, with synthetic goal receipts. */
export async function startGoalsFixture(){
  const base=await startNativeFixture(),requests=[],receipts=new Map();let chat,mode='list',schedules=[],goals=[],records=[];
  const json=(res,b,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(b));};
  const login=await fetch(`${base.origin}/personal/v1/auth/login`,{method:'POST',headers:{origin:base.origin,'content-type':'application/json'},body:JSON.stringify({username:base.credentials.username,password:base.credentials.password,deviceName:'Synthetic setup'})});
  if(!login.ok){await base.close();throw Error(`Synthetic login failed ${login.status}`)}
  const cookie=login.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
  chat=(await(await fetch(`${base.origin}/personal/v1/chats/main`,{headers:{cookie}})).json()).chat;
  const source={sessionId:chat.activeSessionId,chatId:chat.chatId,chatKind:'main'};
  const nextAt=body=>{
    if(body.at)return new Date(`${body.at.date}T${body.at.time}+08:00`).toISOString();
    const repeat=body.repeat||{kind:'daily',time:'09:00:00'};
    if(repeat.kind==='interval')return new Date(Date.now()+repeat.seconds*1000).toISOString();
    const local=new Date(Date.now()+8*3600000),[h,m,s]=repeat.time.split(':').map(Number);
    for(let offset=0;offset<63;offset++){
      const day=new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()+offset));
      if(repeat.kind==='weekly'&&day.getUTCDay()!==repeat.weekday||repeat.kind==='monthly'&&day.getUTCDate()!==repeat.day)continue;
      const at=Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate(),h-8,m,s||0);if(at>Date.now())return new Date(at).toISOString();
    }
    throw Error('Synthetic calendar date unavailable');
  };
  function reset(){mode='list';receipts.clear();schedules=[{id:'water',sessionId:source.sessionId,text:'每天早上提醒喝水',kind:'reminder',timeZone:'Asia/Shanghai',repeat:{kind:'daily',time:'09:00:00'},state:'scheduled',nextRunAt:nextAt({repeat:{kind:'daily',time:'09:00:00'}}),lastRunAt:new Date(Date.now()-20000).toISOString(),lastResult:{state:'delivered'},revision:1,conversationTitle:'WeftMate 主对话',source},{id:'weekly',sessionId:source.sessionId,text:'整理本周项目进展',kind:'task',timeZone:'Asia/Shanghai',repeat:{kind:'weekly',time:'09:00:00',weekday:1},state:'paused',nextRunAt:null,lastRunAt:null,lastResult:null,revision:1,conversationTitle:'WeftMate 主对话',source}];goals=[{id:'long',revision:1,title:'完成秋季项目',description:'检查点：整理资料，再写结论。',objective:'完成秋季项目',phase:'active',progress:'已推进 2 轮',roundsStarted:2,createdAt:Date.now()-86400000,updatedAt:Date.now(),conversationTitle:'WeftMate 主对话',source,scheduleIds:['weekly']}];records=[{id:'record-1',scheduleId:'water',sessionId:source.sessionId,text:'该喝水了，休息一下。',kind:'reminder',seq:2,createdAt:new Date().toISOString(),scheduledAt:new Date().toISOString(),source}];}
  reset();
  const server=createServer(async(req,res)=>{try{
    const u=new URL(req.url,'http://localhost'),p=u.pathname;
    if(p.startsWith('/__and6/')){const command=p.split('/').at(-1);if(command==='reset')reset();else if(['empty','error','slow','offline'].includes(command))mode=command;return json(res,{ok:true,requests,schedules,goals});}
    if(/^\/personal\/v1\/(schedules|goals|notifications)(\/|$)/.test(p)||p==='/personal/v1/tasks'){
      const auth=await fetch(`${base.origin}/personal/v1/auth/me`,{headers:{cookie:req.headers.cookie||''}});if(!auth.ok)return json(res,{error:{code:'UNAUTHORIZED'}},401);
      const me=await auth.json();let body={};if(req.method!=='GET'){if(req.headers['x-weftmate-csrf']!==me.csrfToken)return json(res,{error:{code:'FORBIDDEN'}},403);let raw='';for await(const chunk of req)raw+=chunk;body=JSON.parse(raw||'{}');}
      requests.push({path:p,method:req.method,body});
      if(['error','offline'].includes(mode))return json(res,{error:{code:'FIXTURE_UNAVAILABLE'}},503);
      if(mode==='slow')await new Promise(r=>setTimeout(r,2500));
      if(req.method==='GET')return json(res,p.endsWith('/tasks')?{items:[],recent:[],timeZone:'Asia/Shanghai'}:{items:mode==='empty'?[]:p.endsWith('/schedules')?schedules:p.endsWith('/goals')?goals:records});
      if(body.requestId&&receipts.has(body.requestId)){const r=receipts.get(body.requestId);if(r.body!==JSON.stringify(body))return json(res,{error:{code:'REQUEST_CONFLICT'}},409);return json(res,r.value,r.status)}
      let value={ok:true},status=200;
      if(p==='/personal/v1/schedules'&&req.method==='POST'){
        if(!body.text?.trim()||!body.sessionId||(!body.at&&!body.repeat))return json(res,{error:{code:'INVALID_REQUEST'}},400);
        const row={...body,id:`created-${randomUUID()}`,revision:1,state:'scheduled',timeZone:'Asia/Shanghai',nextRunAt:nextAt(body),lastRunAt:null,lastResult:null,source,conversationTitle:'WeftMate 主对话'};schedules.push(row);value={item:row};status=201;
      }else if(p.startsWith('/personal/v1/schedules/')){
        const parts=p.split('/'),id=decodeURIComponent(parts[5]),row=schedules.find(r=>r.id===id);if(!row)return json(res,{error:{code:'NOT_FOUND'}},404);
        if(req.method==='DELETE')schedules=schedules.filter(r=>r!==row);
        else if(req.method==='PATCH'){if(body.expectedRevision!==row.revision)return json(res,{error:{code:'REVISION_CHANGED'}},409);Object.assign(row,body,{revision:row.revision+1});value={item:row};}
        else if(parts[6]==='run'){row.lastRunAt=new Date().toISOString();row.lastResult={state:row.kind==='task'?'queued':'delivered'};records.unshift({id:randomUUID(),scheduleId:row.id,sessionId:row.sessionId,text:row.text,kind:row.kind,createdAt:row.lastRunAt,source});}
        else {row.state=parts[6]==='pause'?'paused':'scheduled';row.nextRunAt=row.state==='paused'?null:nextAt(row);}
      }else if(p==='/personal/v1/goals'){if(goals.some(r=>r.source.sessionId===body.sessionId&&r.phase!=='complete'))return json(res,{error:{code:'GOAL_ALREADY_EXISTS'}},409);const row={id:randomUUID(),revision:1,title:body.title,description:body.description,phase:'active',progress:'尚未推进',source};goals.push(row);value={ref:{id:row.id,revision:1}};status=201;}
      else if(p.endsWith('/complete'))goals=goals.map(r=>r.id===body.ref.id?{...r,phase:'complete',revision:r.revision+1}:r);
      else if(p.endsWith('/archive'))goals=goals.filter(r=>r.id!==body.ref.id);
      if(body.requestId)receipts.set(body.requestId,{body:JSON.stringify(body),value,status});return json(res,value,status);
    }
    const headers={};for(const[k,v]of Object.entries(req.headers))if(typeof v==='string'&&!['host','connection','content-length'].includes(k))headers[k]=v;
    const r=await fetch(`${base.origin}${req.url}`,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{}),redirect:'manual'});
    const h=Object.fromEntries(r.headers);delete h['content-length'];delete h['content-encoding'];if(r.headers.getSetCookie().length)h['set-cookie']=r.headers.getSetCookie();
    if(p==='/personal/v1/status'){const b=await r.json();b.hostName='合成电脑';b.personalCapabilities={...b.personalCapabilities,taskOverview:1,scheduleEditing:1,goals:1};return json(res,b,r.status)}
    if(p==='/personal/v1/sessions'&&r.ok)return json(res,{sessions:[{sessionId:source.sessionId,chatId:chat.chatId,kind:'main',title:'WeftMate 主对话',taskAvailable:true}]});
    res.writeHead(r.status,h);if(r.body)Readable.fromWeb(r.body).pipe(res);else res.end();
  }catch{json(res,{error:{code:'FIXTURE_FAILED'}},500)}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
  return {origin,credentials:{...base.credentials,origin},requests,source,async close(){server.closeAllConnections();await new Promise(r=>server.close(r));await base.close()}};
}
