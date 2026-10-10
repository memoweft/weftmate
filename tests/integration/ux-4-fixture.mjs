import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { servePersonalAccessUi } from '../../src/personal-access-ui/index.mjs';
export async function startFixture({ phone = false, longReply = false } = {}) {
  const root=mkdtempSync(join(tmpdir(),'weftmate-ux4-fixture-')),logs=new Map(),titles=new Map(),calls=[];
  const model={id:'synthetic',name:'合成模型',model:'synthetic',configured:true};
  const backend={getStatus:async()=>({runtime:'ready',referenceScan:'ready',capabilities:{chat:{available:true}}}),
    listModels:async()=>[model,{...model,id:'alternate',name:'另一个合成模型'}],preflight:async()=>({ok:true}),
    createSession:async({sessionId})=>{logs.set(sessionId,[]);titles.set(sessionId,'合成消息操作');return {sessionId}},
    renameSession:async({sessionId,title})=>{titles.set(sessionId,title);return {title}},
    describeSession:async sessionId=>({sessionId,title:titles.get(sessionId),modelProfileId:'synthetic',agentPreset:'personal-remote',running:false}),
    sendMessage:async input=>{const list=logs.get(input.sessionId),receiptId='r-'+randomUUID();
      const append=(type,data)=>list.push({seq:(list.at(-1)?.seq??-1)+1,type,data,at:new Date().toISOString(),sessionId:input.sessionId});
      append('turn.started',{turn:1});append('user.message',{text:input.text,receiptId});
      append('step.completed',{stepId:'s-'+randomUUID(),toolName:'read',state:'completed',summary:'读取 C:\\Synthetic\\private.txt'});
      append('assistant.message',{text:'**合成回复**：这是可引用的回答。\n\n'+(longReply?'完整长回复段落。'.repeat(1000)+'\n末尾完整标记\n':'')+'api_key="synthetic-secret-export"\nC:\\Synthetic\\private.txt',turn:1});
      append('turn.ended',{reason:'completed',turn:1});return {accepted:true,receiptId};},
    forkSession:async input=>{calls.push(input);const list=logs.get(input.sessionId).filter(row=>input.beforeSeq===undefined||row.seq<input.beforeSeq).map(row=>({...row,sessionId:input.childId}));logs.set(input.childId,list);titles.set(input.childId,'合成消息操作（分叉）');return {sessionId:input.childId,title:titles.get(input.childId),modelProfileId:input.modelProfileId,latestSeq:list.at(-1)?.seq??-1}},
    readEvents:async({sessionId,afterSeq,beforeSeq,limit=50})=>{const all=logs.get(sessionId)||[],forward=afterSeq!==undefined;
      const eligible=all.filter(row=>forward?row.seq>afterSeq:beforeSeq===undefined||row.seq<beforeSeq),events=forward?eligible.slice(0,limit):eligible.slice(-limit);
      return {events:events.map(event=>event.type==='assistant.message'&&event.data.text.length>4000?{...event,data:{...event.data,text:event.data.text.slice(0,4000),truncated:true}}:event),nextSeq:forward?events.at(-1)?.seq??afterSeq:all.at(-1)?.seq??-1,nextBeforeSeq:events[0]?.seq??null,hasMore:forward&&eligible.length>limit,hasOlder:!forward&&eligible.length>limit}},
    readEventDetail:async({sessionId,seq})=>{const event=logs.get(sessionId).find(event=>event.seq===seq);return {seq,type:event.type,text:event.data.text}},
    cancelSession:async()=>({accepted:true})};
  const service=await createPersonalAccessService({root,port:0,backend,uiHandler:servePersonalAccessUi});const {origin,hostId}=await service.start();
  const credentials={username:'MessageFixture',password:'synthetic-'+randomUUID()+'-password',deviceName:'消息操作隔离验收'};
  const grant=await service.issueSetupGrant();const response=await fetch(origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({...credentials,grant:grant.grant})});
  assert.equal(response.status,201);const auth=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];
  async function request(path,body,method=body?'POST':'GET') {const response=await fetch(origin+'/personal/v1'+path,{method,headers:{cookie,origin,'content-type':'application/json','x-weftmate-csrf':auth.csrfToken},body:body?JSON.stringify(body):undefined});const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.error?.code),{status:response.status});return value;}
  async function command(body){let {command}=await request('/commands',{targetDeviceId:hostId,...body});while(['pending','dispatching','preflight'].includes(command.state)){await new Promise(resolve=>setTimeout(resolve,20));command=(await request('/commands/'+command.commandId)).command;}assert.equal(command.state,'accepted_by_dsh');return command;}
  const source=(await command({requestId:'create',kind:'session.create',modelProfileId:'synthetic'})).sessionId;
  await command({requestId:'message',kind:'session.message',sessionId:source,text:'请给出一条合成答复。',mode:'queue'});
  const bridge=async(method,params)=>{
    if(method==='host.status')return request('/status');
    if(['app.ready','app.activity','events.subscribe','cloud.callback'].includes(method))return {};
    if(method==='app.bootstrap')return {loggedIn:true,username:credentials.username,owner:auth.account.ownerId,busy:false,model:{source:'host',displayName:'合成模型'}};
    if(method==='auth.me')return {device:auth.device,deviceId:auth.device.id,displayName:'合成账号',owner:auth.account.ownerId,connectionVerified:true};
    if(method==='settings.appearance')return {value:'light'};
    if(method==='attachments.list')return {attachments:[]};if(method==='conversations.list')return {conversations:phone?[{id:'phone-synthetic',title:'手机合成对话',createdAt:new Date().toISOString()}]:[]};
    if(method==='conversations.messages')return {source:'phone',turnStatus:'completed',messages:[{id:'local-user',role:'user',text:'手机合成目标'},{id:'local-reply',role:'assistant',text:'**手机合成回答**\napi_key="synthetic-phone-secret"'}],receipts:[]};
    if(method==='shared.conversations.get')return {source:'host',conversationId:params.conversationId,status:'unbound',canAdopt:false,reasonCode:'SOURCE_DEVICE_UPGRADE_REQUIRED'};
    if(method==='models.list')return {models:[]};if(method==='models.host')return {models:[{profileId:'synthetic',displayName:'合成模型',configured:true},{profileId:'alternate',displayName:'另一个合成模型',configured:true}]};
    if(method==='shared.sessions.list')return {source:'host',hostAvailable:true,sessions:(await request('/sessions')).sessions.map(row=>({...row,source:'host'}))};
    if(method==='shared.sessions.events')return {source:'host',hostAvailable:true,sessionId:params.sessionId,...await request(`/sessions/${params.sessionId}/events?limit=100${params.afterSeq===undefined?'':`&afterSeq=${params.afterSeq}`}${params.beforeSeq===undefined?'':`&beforeSeq=${params.beforeSeq}`}`)};
    if(method==='shared.projects.list')return {projects:[],canManage:false};
    if(method==='shared.commands.detail')return request('/commands/'+params.commandId);
    if(method==='shared.sessions.eventDetail')return request(`/sessions/${params.sessionId}/events/${params.seq}/detail`);
    if(method==='shared.commands.byRequest')return request('/commands/by-request/'+params.requestId);
    if(method==='shared.outbox.list')return {commands:[],source:'host'};
    if(method==='activity.list')return {activities:[],hostAvailable:true};
    if(method==='shared.tasks.detail')return request('/tasks/'+params.taskId);
    if(method==='shared.approvals.list')return {approvals:[]};if(method==='shared.questions.list')return {questions:[]};
    if(method==='clipboard.copy')return {copied:true};if(method==='conversation.export')return {pending:true};
    if(method==='host.business')return request(params.path.replace('/personal/v1',''),params.body,params.method);
    throw new Error('Unsupported fixture method '+method);
  };
  const mobileDir=new URL('../../apps/mobile-ui/www/',import.meta.url);
  const server=createServer(async(req,res)=>{try{
    if(req.url==='/bridge'){const chunks=[];for await(const chunk of req)chunks.push(chunk);const input=JSON.parse(Buffer.concat(chunks));try{res.end(JSON.stringify({id:input.id,ok:true,result:await bridge(input.method,input.params)}));}catch(error){res.end(JSON.stringify({id:input.id,ok:false,error:{code:error.message,status:error.status||503}}));}return;}
    const path=req.url==='/'?'index.html':req.url.slice(1);let data=readFileSync(new URL(path,mobileDir));
    if(path==='index.html')data=Buffer.from(data.toString().replace('<script defer src="vendor.js">','<script src="bridge.js"></script><script defer src="vendor.js">'));
    if(path==='bridge.js')return;
    res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(path)]||'application/octet-stream');res.end(data);
  }catch(error){if(req.url==='/bridge.js'){res.setHeader('content-type','text/javascript');res.end(`window.weftNative={postMessage:raw=>fetch('/bridge',{method:'POST',body:raw}).then(r=>r.json()).then(message=>{function receive(){if(window.WeftUiCore&&typeof androidBridge!=='undefined')androidBridge.receive(message);else setTimeout(receive,20)}receive()})};`);}else{res.statusCode=404;res.end();}}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {origin,credentials,source,hostId,request,logs,calls,mobileUrl:`http://127.0.0.1:${server.address().port}/`,close:async()=>{await service.close();await new Promise(resolve=>server.close(resolve));rmSync(root,{recursive:true,force:true})}};
}
