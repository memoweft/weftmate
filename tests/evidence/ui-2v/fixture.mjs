/** Loopback UI fixture: real personal authentication and Android network bridge, synthetic projections. */
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createPersonalAccessService} from '../../../src/personal-access/index.mjs';

const root=await mkdtemp(join(tmpdir(),'weftmate-ui2v-'));
const password=`synthetic-${randomUUID()}-password`;
const backend=Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession']
  .map(method=>[method,async()=>method==='listModels'?[]:{}]));
const service=await createPersonalAccessService({root,port:0,backend});
const {origin}=await service.start();
const grant=await service.issueSetupGrant();
const registered=await fetch(`${origin}/personal/v1/auth/setup`,{method:'POST',headers:{origin,'content-type':'application/json'},
  body:JSON.stringify({grant:grant.grant,username:'Ui2vFixture',password,deviceName:'Synthetic preparation'})});
if(registered.status!==201)throw new Error(`Registration failed: ${registered.status}`);
const ownerId=(await registered.json()).account.ownerId;
const now='2026-10-08T06:00:00.000Z';
const approval={approvalId:'12345678-1234-4234-8234-123456789abc',sessionId:'approve',taskId:'cmd-demo',sourceCommandId:'cmd-demo',
  sourceReceiptId:'rpc:demo.1',turn:1,callId:'call:demo.1',rootCallId:'root:demo.1',toolName:'weftmod_script',
  reason:'整理合成临时目录，删除三个不再需要的测试文件。',riskCategories:['execute','delete'],createdAt:now,status:'pending'};
const artifact={artifactId:'report-new',fileName:'项目进展.md',contentType:'text/markdown',size:128,createdAt:now};
const source={key:'file:notes.md',kind:'file',name:'notes.md',location:'notes.md',uses:[{id:'turn-1/read-1',callId:'read-1',summary:'读取项目记录 · notes.md',path:'/sessions/report/events/3/detail',seq:3}]};
const step=(state='completed')=>({seq:3,type:state==='running'?'step.started':'step.completed',at:now,
  data:{taskId:'turn-1',stepId:'read-1',toolName:'read_file',summary:'读取项目记录 · notes.md',state,detailRef:{seq:3}}});
const sessions=[{sessionId:'report',title:'整理项目进展',sendAvailable:true,createdAt:now,modelDisplayName:'合成模型'},
  {sessionId:'running',title:'准备下周的安排',sendAvailable:true,running:true,createdAt:now,modelDisplayName:'合成模型'},
  {sessionId:'approve',title:'整理临时文件',sendAvailable:true,createdAt:now,modelDisplayName:'合成模型'}];
const histories={report:[{seq:1,type:'user.message',at:now,data:{text:'整理这周的项目进展，写一份简洁的报告。'}},step(),
  {seq:4,type:'artifact.created',at:now,data:artifact},{seq:5,type:'assistant.message',at:now,data:{text:'# 项目进展\n\n已整理本周的记录。\n\n- 完成手机审批模式\n- 统一会话与来源阅读\n\n报告已保存，点文件即可查看。'}},
  {seq:6,type:'assistant.message',at:now,data:{text:'## 待核对\n\n'+Array(12).fill('可在原会话继续补充，相关来源也会保留。').join('\n\n')}}],
  running:[{seq:1,type:'user.message',at:now,data:{text:'帮我安排下周的工作，先整理现有的计划。'}},{seq:2,type:'turn.started',at:now,data:{turn:1}},step('running')],
  approve:[{seq:1,type:'user.message',at:now,data:{text:'整理临时文件，删除之前让我确认。'}},{seq:2,type:'approval.requested',at:now,data:{approvalId:approval.approvalId,taskId:'cmd-demo',summary:approval.reason}}]};
const requests=[];let mode='auto';
const ids={report:'session-11111111-1111-4111-8111-111111111111',running:'session-22222222-2222-4222-8222-222222222222',approve:'session-33333333-3333-4333-8333-333333333333'};
for(const session of sessions)session.sessionId=ids[session.sessionId];
approval.sessionId=ids.approve;
source.uses[0].path=`/sessions/${ids.report}/events/3/detail`;
const json=(res,value,status=200)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(value))};
const proxy=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');const path=url.pathname;
  if(path==='/__fixture/stop'&&req.method==='POST'){
    await writeFile(new URL('./requests.json',import.meta.url),JSON.stringify(requests,null,2)+'\n');
    json(res,{stopped:true});setTimeout(async()=>{proxy.closeAllConnections();await new Promise(done=>proxy.close(done));await service.close();process.exit(0);},200);return;
  }
  const synthetic=path==='/personal/v1/sessions'||path.startsWith('/personal/v1/sessions/')||path.startsWith('/personal/v1/tasks/cmd-demo')||path.startsWith('/personal/v1/artifacts/report-new');
  if(synthetic){
    const auth=await fetch(`${origin}/personal/v1/auth/me`,{headers:{cookie:req.headers.cookie||''}});
    const me=await auth.json();if(!auth.ok||me.account?.ownerId!==ownerId)return json(res,{error:{code:'UNAUTHORIZED'}},401);
    let body;if(req.method!=='GET'){if(req.headers['x-weftmate-csrf']!==me.csrfToken)return json(res,{error:{code:'FORBIDDEN'}},403);
      let raw='';for await(const chunk of req)raw+=chunk;body=JSON.parse(raw);}
    requests.push({method:req.method,path:req.url,...(body?{body}:{})});
    if(path==='/personal/v1/sessions')return json(res,{sessions});
    const id=Object.keys(ids).find(key=>ids[key]===path.split('/')[4]);
    if(path.endsWith('/attachments'))return json(res,{attachments:[]});
    if(path.endsWith('/approval-mode')){if(body)mode=body.mode;return json(res,{mode,allowedCategories:[]});}
    if(path.endsWith('/events')){const events=histories[id]||[];const after=Number(url.searchParams.get('afterSeq')??-1);return json(res,{events:events.filter(e=>e.seq>after),nextSeq:events.at(-1)?.seq??-1,hasMore:false,hasOlder:false});}
    if(path.endsWith('/detail'))return json(res,{text:JSON.stringify({arguments:{file_path:'notes.md'},output:'本周已经完成两项界面工作。'},null,2)});
    if(path.endsWith('/resources'))return json(res,{outputs:[artifact],sources:[source],nextSeq:6,hasMore:false});
    if(path.endsWith('/approvals'))return json(res,{approvals:id==='approve'?[approval]:[],hasMore:false,nextBefore:null});
    if(path.includes('/approvals/')){Object.assign(approval,{status:'answered',decisionOutcome:body.outcome,decisionRequestId:body.requestId,decisionScope:body.scope,answeredAt:now});return json(res,{requestId:body.requestId,approval});}
    if(path.endsWith('/questions'))return json(res,{questions:[],hasMore:false,nextBefore:null});
    if(path.startsWith('/personal/v1/tasks/'))return json(res,{taskId:'cmd-demo',sessionId:ids.approve,source:{commandId:'cmd-demo',kind:'session.message',sessionId:ids.approve,receiptId:'rpc:demo.1'},artifacts:[],control:{state:'active',canStop:false,canSupplement:false}});
    if(path.endsWith('/preview'))return json(res,{text:'# 项目进展\n\n两项界面工作已完成。\n\n| 工作 | 状态 |\n| --- | --- |\n| 审批模式 | 完成 |\n| 来源阅读 | 完成 |'});
    return json(res,{error:{code:'NOT_FOUND'}},404);
  }
  const headers=new Headers();for(const [key,value]of Object.entries(req.headers))if(typeof value==='string'&&!['host','connection','content-length','origin'].includes(key))headers.set(key,value);
  headers.set('origin',origin);
  const upstream=await fetch(new URL(req.url,origin),{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{}),redirect:'manual'});
  const forwarded=Object.fromEntries(upstream.headers);delete forwarded['content-length'];delete forwarded['content-encoding'];
  const cookies=upstream.headers.getSetCookie();if(cookies.length)forwarded['set-cookie']=cookies;
  res.writeHead(upstream.status,forwarded);if(upstream.body)Readable.fromWeb(upstream.body).pipe(res);else res.end();
}catch(error){console.error(error.message);if(!res.headersSent)json(res,{error:{code:'FIXTURE_FAILURE'}},500);else res.end();}});
await new Promise(done=>proxy.listen(18187,'127.0.0.1',done));
await writeFile(new URL('../../../.local/ui-2v/login.json',import.meta.url),JSON.stringify({origin:'http://127.0.0.1:18187',username:'Ui2vFixture',password}));
console.log('UI-2v isolated fixture ready on 18187; no model inference.');
process.stdin.resume();process.stdin.on('data',async data=>{if(String(data).trim()==='q'){
  await writeFile(new URL('./requests.json',import.meta.url),JSON.stringify(requests,null,2)+'\n');
  proxy.closeAllConnections();await new Promise(done=>proxy.close(done));await service.close();process.exit(0);
}});
