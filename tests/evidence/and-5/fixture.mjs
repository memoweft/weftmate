import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {startNativeFixture} from '../and-4/fixture.mjs';
/** Original login/network/chat dispatcher, with synthetic activity snapshots and receipts. */
export async function startFeedFixture(){
  const base=await startNativeFixture(),requests=[],reads=[],changed=new Map(),removed=new Map();let rows=[],revision=1,mode='list',chat,history=null;
  const snapshotAt=new Date().toISOString();
  const json=(res,value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  const authenticated=async req=>{const r=await fetch(`${base.origin}/personal/v1/auth/me`,{headers:{cookie:req.headers.cookie||''}});return r.ok?await r.json():null;};
  const counts=()=>({unreadCount:rows.filter(r=>!r.read).length,actionableCount:rows.filter(r=>r.state==='pending').length});
  function reset(){
    revision++;mode='list';history=null;const source={chatId:chat.chatId,chatKind:'main',sessionId:chat.activeSessionId,eventId:'event-2',seq:2};
    const order=['approval-pending','question-pending','task-done','reminder','weekly','memory','summary'];const item=(id,type,title,summary,extra={})=>({id,at:new Date(Date.parse(snapshotAt)-order.indexOf(id)*1000).toISOString(),type,title,summary,source,read:false,state:'completed',revision:1,attentionRevision:revision,actions:[{kind:'open_chat',label:'打开对话',target:source}],notification:{notify:false,sound:false,level:'normal'},...extra});
    rows=[item('approval-pending','approval.pending','需要审批','整理合成记录，保留原文件。',{state:'pending',actions:[{kind:'respond_approval',label:'审批',target:{sessionId:chat.activeSessionId,approvalId:'feed-approval'}},{kind:'open_chat',label:'打开对话',target:source}]}),
      item('question-pending','question.pending','需要回答','把记录放在哪里？',{state:'pending',actions:[{kind:'answer_question',label:'回答',target:{sessionId:chat.activeSessionId,questionRpcId:'feed-question'}}]}),
      item('task-done','task.completed','任务完成','本周计划已经整理好。'),item('reminder','reminder.triggered','喝水提醒','休息一下，喝一杯水。'),
      item('weekly','memory.report','这周回顾','完成 3 件事 · 产出 2 份成果',{actions:[],weeklyInsight:{from:'2026-10-05',to:'2026-10-12',text:'这周主要在整理记录。周末留出了休息时间。',sources:[{title:'本周计划',source}]}}),
      item('memory','memory.report','这周记住的事','新增 2 条记忆',{actions:[{kind:'view_memory',label:'查看记忆',target:{from:'2026-10-05T00:00:00Z',to:'2026-10-12T00:00:00Z'}}],memoryDigest:{from:'2026-10-05T00:00:00Z',to:'2026-10-12T00:00:00Z',timeZone:'Asia/Shanghai',added:[{kind:'relation',id:'synthetic-memory',text:'你喜欢把周末留给休息。',topic:'生活',status:'current'}],corrected:[],review:[{kind:'relation',id:'synthetic-old',text:'每周一整理一次计划。',status:'current',reviewReason:'很久没有更新，尚无使用记录。'}]}}),
      item('summary','system.dnd.summary','休息期间的提醒','你休息时有 3 条提醒，已放在这里。',{actions:[]})];
    changed.clear();removed.clear();for(const row of rows)changed.set(row.id,revision);
  }
  const server=createServer(async(req,res)=>{try{
    const u=new URL(req.url,'http://localhost'),p=u.pathname;
    if(p.startsWith('/__and5/')){
      const command=p.split('/').at(-1);if(command==='reset')reset();else if(command==='empty')mode='empty';else if(command==='error')mode='error';else if(command==='slow')mode='slow';else if(command==='notify'){mode='list';rows=rows.filter(r=>!r.id.startsWith('notice-'));rows.unshift({...rows.find(r=>r.id==='task-done'),id:`notice-${++revision}`,read:false,title:'新的合成任务完成',attentionRevision:revision,notification:{notify:true,sound:false,level:'normal',title:'新的合成任务完成',body:'点开查看本周计划。'}});}else if(command==='read-all'){rows=rows.map(r=>({...r,read:true}));revision++;}
      if(command==='history')history=Array.from({length:220},(_,index)=>{const seq=index+1;return {eventId:`event-${seq}`,chatId:chat.chatId,orderKey:String(seq).padStart(20,'0'),revision:1,seq,type:seq%2?'user.message':'assistant.message',at:snapshotAt,sourceRef:{kind:'native',sessionId:chat.activeSessionId,seq},data:{text:seq===1?'帮我整理这周的计划。':seq===2?'这周的计划已经整理好。':`第 ${seq} 条合成记录。`}}});
      if(command==='update'){const row=rows.find(r=>r.id==='reminder');row.title='提醒已更新';row.attentionRevision=++revision;changed.set(row.id,revision);}
      if(command==='notify'){for(const id of changed.keys())if(id.startsWith('notice-')&&!rows.some(r=>r.id===id))removed.set(id,revision);changed.set(rows[0].id,revision);}
      return json(res,{ok:true,...counts(),...(command==='notify'?{notificationId:rows[0].id,chatId:chat.chatId}:{})});
    }
    if(p.startsWith('/personal/v1/activity')){
      const me=await authenticated(req);if(!me)return json(res,{error:{code:'UNAUTHORIZED'}},401);
      let body={};if(req.method!=='GET'){if(req.headers['x-weftmate-csrf']!==me.csrfToken)return json(res,{error:{code:'FORBIDDEN'}},403);let raw='';for await(const chunk of req)raw+=chunk;body=JSON.parse(raw||'{}');}
      requests.push({path:p,method:req.method,query:Object.fromEntries(u.searchParams)});
      if(mode==='error')return json(res,{error:{code:'FIXTURE_UNAVAILABLE'}},503);
      if(mode==='slow')await new Promise(r=>setTimeout(r,3000));
      const available=mode==='empty'?[]:rows;
      const filter=r=>(u.searchParams.get('filter')!=='unread'||!r.read)&&(u.searchParams.get('filter')!=='actionable'||r.state==='pending')&&(!u.searchParams.get('type')||r.type.startsWith(u.searchParams.get('type')+'.'));
      if(p.endsWith('/unread'))return json(res,mode==='empty'?{unreadCount:0,actionableCount:0}:counts());
      if(p.endsWith('/read')&&req.method!=='GET'){
        if(p==='/personal/v1/activity/read'){revision++;rows=rows.map(r=>({...r,read:true}));for(const row of rows)changed.set(row.id,revision);reads.push({all:true,body});return json(res,counts());}
        const id=p.split('/').at(-2),r=rows.find(r=>r.id===id);if(!r)return json(res,{error:{code:'NOT_FOUND'}},404);if(body.attentionRevision!==r.attentionRevision)return json(res,{error:{code:'REQUEST_CONFLICT'}},409);
        r.read=true;changed.set(id,++revision);if(body.reviewedMemory)for(const value of r.memoryDigest?.review||[])if(value.kind===body.reviewedMemory.kind&&value.id===body.reviewedMemory.id)value.status='confirmed';reads.push({id,body});return json(res,{item:r});
      }
      if(p.endsWith('/changes')){const after=Number(u.searchParams.get('cursor')||0);return json(res,{upserts:available.filter(row=>(changed.get(row.id)||0)>after&&filter(row)),removals:[...removed].filter(([,at])=>at>after).map(([id])=>id),nextCursor:String(revision),hasMore:false,snapshotCursor:'synthetic-snapshot',...counts()});}
      const selected=available.filter(filter),offset=Number(u.searchParams.get('cursor')||0),limit=u.searchParams.get('limit')==='50'?4:200,next=offset+limit<selected.length?String(offset+limit):null;
      return json(res,{items:selected.slice(offset,offset+limit),nextCursor:next,hasMore:!!next,syncCursor:String(revision),snapshotCursor:'synthetic-snapshot',timeZone:'Asia/Shanghai',...(mode==='empty'?{unreadCount:0,actionableCount:0}:counts())});
    }
    if(history&&p.startsWith('/personal/v1/chats/')&&(p.endsWith('/events')||p.endsWith('/changes'))){const me=await authenticated(req);if(!me)return json(res,{error:{code:'UNAUTHORIZED'}},401);const delta=p.endsWith('/changes'),end=Number(u.searchParams.get('before')||history.length+1)-1,start=Math.max(0,end-100);return json(res,{[delta?'upserts':'items']:delta?[]:history.slice(start,end),contentRevision:2,chatRevision:1,timeZone:'Asia/Shanghai',...(!delta?{olderCursor:start>0?String(start+1):null,hasOlder:start>0,hasNewer:false}:{}),syncCursor:'220',nextCursor:'220',liveEvents:[],liveRevision:0});}
    if(p.match(/\/sessions\/[^/]+\/approvals$/))return json(res,{approvals:[{approvalId:'feed-approval',sessionId:chat.activeSessionId,summary:'整理合成记录',reason:'把两份合成记录合并，保留原文件。',status:'pending',createdAt:new Date().toISOString()}],hasMore:false,nextBefore:null});
    if(p.match(/\/sessions\/[^/]+\/questions$/))return json(res,{questions:[{questionRpcId:'feed-question',sessionId:chat.activeSessionId,status:'pending',createdAt:new Date().toISOString(),questions:[{id:'destination',question:'把记录放在哪里？',options:[{label:'本周计划'},{label:'稍后再定'}]}]}],hasMore:false,nextBefore:null});
    const headers={};for(const[k,v]of Object.entries(req.headers))if(typeof v==='string'&&!['host','connection','content-length'].includes(k))headers[k]=v;
    const r=await fetch(`${base.origin}${req.url}`,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{}),redirect:'manual'});
    const h=Object.fromEntries(r.headers);delete h['content-length'];delete h['content-encoding'];if(r.headers.getSetCookie().length)h['set-cookie']=r.headers.getSetCookie();
    if(p==='/personal/v1/status'){const b=await r.json();b.personalCapabilities={...b.personalCapabilities,activity:1,activityChanges:1,activityRead:1,pushRegistration:0};return json(res,b,r.status);}
    if(p==='/personal/v1/chats/main'&&r.ok){const b=await r.json();chat=b.chat;return json(res,b);}
    res.writeHead(r.status,h);if(r.body)Readable.fromWeb(r.body).pipe(res);else res.end();
  }catch(e){json(res,{error:{code:'FIXTURE_FAILED'}},500)}});
  // Obtain the synthetic chat through the real login before the proxy starts.
  const login=await fetch(`${base.origin}/personal/v1/auth/login`,{method:'POST',headers:{origin:base.origin,'content-type':'application/json'},body:JSON.stringify({username:base.credentials.username,password:base.credentials.password,deviceName:'Synthetic setup'})});
  if(!login.ok){await base.close();throw Error(`Synthetic login failed: ${login.status}`);}
  const cookie=login.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');const main=await fetch(`${base.origin}/personal/v1/chats/main`,{headers:{cookie}});chat=(await main.json()).chat;reset();
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
  return {origin,credentials:{...base.credentials,origin},requests,reads,async close(){server.closeAllConnections();await new Promise(r=>server.close(r));await base.close();}};
}
