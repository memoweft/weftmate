import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {randomUUID,createHash} from 'node:crypto';
import {startFe1bFixture} from '../../integration/fe-1b-fixture.mjs';
export async function startNativeFixture(mimoKey) {
  const base=await startFe1bFixture(), sid=base.ids.report, chatId=`chat-${randomUUID()}`;
  const chat={chatId,kind:'main',title:'WeftMate',parent:null,pinned:true,archived:false,unread:false,activeSessionId:sid,revision:1,contentRevision:1,timeZone:'Asia/Shanghai',sendAvailable:true,taskAvailable:true,running:false,modelProfileId:'synthetic'};
  const commands=new Map(), uploads=new Map(), requests=[],decisions=[],events=[];let live=[],liveRevision=0,mimoRequests=0,mode='auto',seq=0;
  const approvalId=randomUUID(),questionId=randomUUID();let approvals=[],questions=[];
  const add=(type,data)=>{const e={eventId:`event-${++seq}`,chatId,orderKey:String(seq).padStart(20,'0'),revision:1,seq,type,at:new Date().toISOString(),sourceRef:{kind:'native',sessionId:sid,seq},data};events.push(e);return e;};
  function reset(){events.length=0;seq=0;live=[];liveRevision++;chat.running=false;approvals=[];questions=[];add('user.message',{text:'帮我整理这周的计划。'});add('assistant.message',{text:'**这周的计划**\n\n- 整理项目记录\n- 留出休息时间\n\n可以从一件小事开始。'});}
  reset();
  const json=(res,b,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(b));};
  async function stream(text,real=false){chat.running=true;liveRevision++;const anchor=seq+1;const e={eventId:`live-${anchor}`,chatId,orderKey:String(anchor).padStart(20,'0'),seq:anchor,type:'assistant.delta',sourceRef:{kind:'native',sessionId:sid,seq:anchor},at:new Date().toISOString(),data:{text:'',streaming:true,turn:anchor}};live=[e];
    try {
      if(real){if(!mimoKey)throw Error('MIMO_KEY_UNAVAILABLE');mimoRequests++;
        const response=await fetch('https://api.xiaomimimo.com/v1/chat/completions',{method:'POST',headers:{authorization:`Bearer ${mimoKey}`,'content-type':'application/json'},body:JSON.stringify({model:'mimo-v2.6-flash',stream:true,messages:[{role:'user',content:'请用中文简短回答：原生界面为什么让聊天更自然？不超过100字。'}]})});
        if(!response.ok)throw Error(`MIMO_HTTP_${response.status}`);
        let buffer='',done=false;const decoder=new TextDecoder();for await(const b of response.body){buffer+=decoder.decode(b,{stream:true});let pos;while((pos=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,pos).trim();buffer=buffer.slice(pos+1);if(!line.startsWith('data:'))continue;const data=line.slice(5).trim();if(data==='[DONE]'){done=true;continue;}const p=JSON.parse(data);const part=p.choices?.[0]?.delta?.content;if(part){e.data.text+=part;liveRevision++;}}}if(!done)throw Error('MIMO_STREAM_INCOMPLETE');
      } else for(const part of ['收到。','我会先整理','这周的记录，','再给出简短的建议。']){await new Promise(r=>setTimeout(r,450));e.data.text+=part;liveRevision++;}
      add('assistant.message',{text:e.data.text,streamSeq:anchor});live=[];liveRevision++;chat.running=false;
    }catch(error){e.data.streaming=false;chat.running=false;liveRevision++;requests.push({failure:String(error.message).replace(/https?:\/\/\S+/g,'<endpoint>')});}
  }
  const server=createServer(async(req,res)=>{try{
    const u=new URL(req.url,'http://localhost'),p=u.pathname;
    if(p==='/__qa/reset'){reset();return json(res,{ok:true});}
    if(p==='/__qa/long'){reset();for(let i=0;i<80;i++)add(i%2?'assistant.message':'user.message',{text:`第 ${i+1} 条合成记录。\n\n这是一段用来检查长对话滚动的文字。`});return json(res,{ok:true});}
    // Both entry points must scroll the same long history, not the base fixture's short thread.
    if(events.length>=80 && p===`/personal/v1/sessions/${sid}/events`)return json(res,{events,nextSeq:seq,hasMore:false,hasOlder:false});
    if(p==='/personal/v1/auth/login') {
      let raw='';for await(const chunk of req)raw+=chunk;
      const response=await fetch(`${base.origin}${p}`,{method:'POST',headers:{origin:base.origin,'content-type':'application/json'},body:raw});
      requests.push({method:'POST',path:p,status:response.status});
      res.writeHead(response.status,{'content-type':'application/json','set-cookie':response.headers.getSetCookie()});res.end(await response.text());return;
    }
    const synthetic=['/personal/v1/status','/personal/v1/models','/personal/v1/tasks','/personal/v1/goals','/personal/v1/schedules'].includes(p)||p.startsWith('/personal/v1/chats')||p.startsWith('/personal/v1/commands')||p.startsWith('/personal/v1/sync/attachments/')||p.match(/\/sessions\/[^/]+\/(approvals|questions|approval-mode|attachments)/);
    if(synthetic){
      const meResponse=await fetch(`${base.origin}/personal/v1/auth/me`,{headers:{cookie:req.headers.cookie||''}});const me=await meResponse.json();if(!meResponse.ok)return json(res,{error:{code:'UNAUTHORIZED'}},401);
      let raw=Buffer.alloc(0);if(!['GET','HEAD'].includes(req.method)){for await(const c of req)raw=Buffer.concat([raw,c]);if(req.headers['x-weftmate-csrf']!==me.csrfToken)return json(res,{error:{code:'FORBIDDEN'}},403);}
      const body=raw.length && req.headers['content-type']?.includes('json')?JSON.parse(raw):{};requests.push({method:req.method,path:p});
      if(p==='/personal/v1/status'){const r=await fetch(`${base.origin}${p}`,{headers:{cookie:req.headers.cookie}});const s=await r.json();s.personalCapabilities={...s.personalCapabilities,chats:1,chatTimeline:1,chatSend:1,chatLifecycle:1,replyStreaming:1,taskOverview:1,scheduleEditing:1,goals:1};s.capabilities={...s.capabilities,chat:{available:true}};s.backend={...s.backend,runtime:'ready'};return json(res,s);}
      if(['/personal/v1/tasks','/personal/v1/goals','/personal/v1/schedules'].includes(p))return json(res,{items:[],recent:[],timeZone:'Asia/Shanghai'});
      if(p==='/personal/v1/models')return json(res,{models:[{id:'synthetic',name:'MiMo v2.6 Flash',model:'mimo-v2.6-flash',configured:true,source:'host'}]});
      if(p==='/personal/v1/chats/main'||p===`/personal/v1/chats/${chatId}`)return json(res,{chat});
      if(p==='/personal/v1/chats')return json(res,{items:[],groups:[],hasMore:false,nextCursor:null,indexState:'ready'});
      if(p.endsWith('/events')||p.endsWith('/changes'))return json(res,{[p.endsWith('/changes')?'upserts':'items']:events.slice(-100),contentRevision:1,chatRevision:1,timeZone:'Asia/Shanghai',olderCursor:null,hasOlder:false,hasNewer:false,syncCursor:String(seq),nextCursor:String(seq),liveEvents:live,liveRevision});
      if(p.endsWith('/approval-mode')){if(req.method==='PATCH')mode=body.mode;return json(res,{mode,allowedCategories:[]});}
      if(p.endsWith('/approvals'))return json(res,{approvals,hasMore:false,nextBefore:null});
      if(p.includes('/approvals/')){const row=approvals.find(r=>r.approvalId===p.split('/').at(-1));if(!row)return json(res,{error:{code:'NOT_FOUND'}},404);Object.assign(row,{status:'answered',decisionOutcome:body.outcome,decisionScope:body.scope,decisionRequestId:body.requestId});decisions.push({kind:'approval',...body});setTimeout(()=>{row.status='resolved';row.outcome=body.outcome;add('approval.resolved',{approvalId:row.approvalId,outcome:body.outcome,summary:'已处理'});},700);return json(res,{requestId:body.requestId,approval:{...row}});}
      if(p.endsWith('/questions'))return json(res,{questions,hasMore:false,nextBefore:null});
      if(p.includes('/questions/')){const row=questions[0];Object.assign(row,{status:'answered',answer:body.answer,answerRequestId:body.requestId});decisions.push({kind:'question',...body});setTimeout(()=>{row.status='resolved';row.answerAcceptedAt=new Date().toISOString();},700);return json(res,{requestId:body.requestId,question:{...row}});}
      if(req.method==='PUT'){const id=p.split('/').at(-1),ref={attachmentId:id,name:u.searchParams.get('name'),contentType:req.headers['content-type'],size:raw.length,sha256:createHash('sha256').update(raw).digest('hex')};uploads.set(id,{ref,raw});return json(res,{attachment:ref});}
      if(p.startsWith('/personal/v1/commands/by-request/')){const c=commands.get(decodeURIComponent(p.split('/').at(-1)));return c?json(res,{command:c}):json(res,{error:{code:'NOT_FOUND'}},404);}
      if(p==='/personal/v1/commands'&&req.method==='POST'){
        const c={...body,commandId:`cmd-${randomUUID()}`,sessionId:sid,state:'accepted_by_dsh',receiptId:'rpc:synthetic',createdAt:new Date().toISOString()};commands.set(body.requestId,c);
        if(body.kind==='session.cancel'){chat.running=false;live=[];liveRevision++;add('turn.ended',{summary:'已停止'});}else{
          const refs=(body.originalAttachments||body.attachments||[]).map(r=>({...r,kind:r.contentType?.startsWith('image/')?'image':'file',thumbnailDataUrl:uploads.get(r.attachmentId)&&r.contentType?.startsWith('image/')?`data:${r.contentType};base64,${uploads.get(r.attachmentId).raw.toString('base64')}`:undefined}));
          add('user.message',{text:body.text,attachments:refs});
          if(body.text.includes('审批')){const row={approvalId:randomUUID(),sessionId:sid,taskId:c.commandId,toolName:'shell',summary:'整理合成记录',reason:'把两份合成记录合并为一份，保留原文件。',status:'pending',createdAt:new Date().toISOString(),canAlwaysAllow:body.text.includes('三项'),secondOpinion:{alignment:'对得上',externalInfluence:'没有',reason:'只整理这次指定的记录。'}};approvals.push(row);add('approval.requested',{approvalId:row.approvalId,summary:row.summary});}
          else if(body.text.includes('三选一')){const row={questionRpcId:randomUUID(),status:'pending',createdAt:new Date().toISOString(),questions:[{id:'destination',question:'把整理后的记录放在哪里？',options:[{label:'工作资料'},{label:'本周计划'},{label:'稍后再定'}]}]};questions.push(row);add('question.requested',{questionRpcId:row.questionRpcId});}
          else void stream(body.text,body.text.includes('真实流式'));
        }return json(res,{command:c},202);
      }
      if(p==='/personal/v1/commands')return json(res,{commands:[...commands.values()]});
      return json(res,{error:{code:'NOT_FOUND'}},404);
    }
    const headers={};for(const[k,v]of Object.entries(req.headers))if(typeof v==='string'&&!['host','connection','content-length','origin'].includes(k))headers[k]=v;headers.origin=base.origin;
    const response=await fetch(`${base.origin}${req.url}`,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{}),redirect:'manual'});
    const h=Object.fromEntries(response.headers);delete h['content-length'];delete h['content-encoding'];if(response.headers.getSetCookie().length)h['set-cookie']=response.headers.getSetCookie();res.writeHead(response.status,h);if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();
  }catch(error){requests.push({failure:error.cause?.code || error.code || error.name,path:req.url.split('?')[0]});json(res,{error:{code:'FIXTURE_FAILURE'}},500);}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
  return {origin,credentials:{...base.credentials,origin},requests,decisions,get mimoRequests(){return mimoRequests;},async close(){server.closeAllConnections();await new Promise(r=>server.close(r));await base.close();}};
}
