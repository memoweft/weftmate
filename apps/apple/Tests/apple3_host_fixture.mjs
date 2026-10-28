// Synthetic contract service for native UI evidence. No real host, model, cloud or health samples.
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const child=spawn(process.execPath,['apps/apple/Tests/health4_host_fixture.mjs'],{stdio:['ignore','pipe','inherit']});
const [chunk]=await once(child.stdout,'data');const healthOrigin=JSON.parse(chunk.toString()).origin;
let scenario='stream', tick=0,secondOpinionEnabled=true,decisions=[],reads=[],settingWrites=[],routes=[],questionAnswer=null,queueCancels=[];
const at=new Date().toISOString(),sessionID='apple3-session',taskID='turn-1',chatID='apple3-main';
const native=(seq,type,data)=>({seq,type,at,data:type.startsWith('step.')?{...data,detailRef:{seq}}:data});
const row=e=>({eventId:'native-'+e.seq,chatId:chatID,orderKey:String(e.seq).padStart(8,'0'),revision:1,type:e.type,at:e.at,sourceRef:{sessionId:sessionID,seq:e.seq},data:e.data});
function events(){if(scenario==='empty')return [];const rows=[native(1,'user.message',{text:'整理我的合成笔记',turn:1}),native(2,'turn.started',{turn:1})];
 if(scenario==='stream')return rows;
 if(scenario==='rich')return [native(1,'user.message',{text:'周末想去公园走走，帮我留出一个不赶时间的上午。',turn:1}),rows[1],
  native(3,'step.started',{taskId:taskID,stepId:'read-plan',state:'running',summary:'读取已有的安排',toolName:'read'}),
  native(4,'step.completed',{taskId:taskID,stepId:'read-plan',state:'completed',summary:'读取已有的安排',toolName:'read'}),
  native(5,'assistant.message',{text:'**那就把上午留给散步。**\n\n不用排满，也不必赶早。留两个时间点，其他的随心就好。\n\n1. **09:30 左右出发**\n   带上水，穿双舒服的鞋。\n2. **先沿湖走一小圈。**\n   喜欢哪里，就在那里多坐一会儿。\n3. **11:00 前后，自由返程。**\n   顺路买点午饭，回去慢慢吃。',turn:1}),
  native(6,'step.started',{taskId:taskID,stepId:'write-list',state:'running',summary:'生成散步清单',toolName:'write'}),
  native(7,'step.completed',{taskId:taskID,stepId:'write-list',state:'completed',summary:'生成散步清单',toolName:'write'}),native(8,'turn.ended',{turn:1,reason:'completed'})];
 if(scenario==='queue')return [...rows,native(3,'task.queued',{tasks:[
  {commandId:'queue-edit',receiptId:'receipt-queue-edit',text:'QUEUED_EDIT'},
  {commandId:'queue-retract',receiptId:'receipt-queue-retract',text:'QUEUED_RETRACT'},
  {commandId:'queue-active',receiptId:'receipt-queue-active',text:'ALREADY_RUNNING'}
 ]}),native(4,'task.started',{commandId:'queue-active',receiptId:'receipt-queue-active'})];
 if(scenario==='stream-long'){for(let i=0;i<24;i++){rows.push(native(3+i*2,'user.message',{text:'历史合成问题 '+i,turn:i+1}),native(4+i*2,'assistant.message',{text:'历史合成回复 '+i+'：这一段用于验证阅读历史时新文字不会抢走位置。',turn:i+1}));}return rows;}
 if(['task','resources'].includes(scenario)){rows.push(native(3,'step.started',{taskId:taskID,stepId:'read-plan',state:'running',summary:'读取已有的安排',toolName:'read'}),native(4,'step.completed',{taskId:taskID,stepId:'read-plan',state:'completed',summary:'读取已有的安排',toolName:'read'}),native(6,'step.started',{taskId:taskID,stepId:'write-list',state:'running',summary:'生成散步清单',toolName:'write'}),native(7,'step.completed',{taskId:taskID,stepId:'write-list',state:'completed',summary:'生成散步清单',toolName:'write'}),native(8,'turn.ended',{turn:1,reason:'completed'}));}

 if(scenario==='long')rows.push(native(5,'assistant.message',{text:Array.from({length:24},(_,i)=>`第 ${i+1} 条合成笔记：留出时间整理计划，再慢慢完成下一件事。`).join('\n\n'),turn:1}));
 if(['files','recovered'].includes(scenario)){
 if(scenario==='recovered')rows.push(native(3,'step.completed',{taskId:taskID,stepId:'retry-1',state:'failed',summary:'读取合成笔记',toolName:'read'}));
 for(let i=0;i<5;i++)rows.push(native(10+i,'artifact.created',{artifactId:'file-'+i,fileName:'合成成果-'+(i+1)+'.txt',taskId:taskID,contentType:'text/plain',size:8}));
 }
 if(scenario==='final')rows.push(native(5,'assistant.message',{text:'这一段正在生成，这是最终完整回复。',streamSeq:3,turn:1}));
 if(['interrupted','recovered','files','failed','final'].includes(scenario))rows.push(native(30,'turn.ended',{turn:1,reason:scenario==='interrupted'?'aborted':scenario==='failed'?'error':'completed'}));
 return rows;}
function live(){if(scenario==='stream-long'){tick++;return [row(native(1000,'assistant.delta',{text:'持续生成的合成回复。'+Array.from({length:Math.min(200,tick)},(_,i)=>'追加文字 '+i+'。').join(''),cursor:tick,streaming:true,turn:25,step:1}))];}if(scenario!=='stream')return [];tick++;return [row(native(3,'assistant.delta',{text:tick<4?'这一段正在生成':'这一段正在生成，文字正在继续。',cursor:tick+3,streaming:true,turn:1,step:1}))];}
function approval(){return {approvalId:'apple3-'+scenario,sessionId:sessionID,taskId:taskID,sourceCommandId:'cmd-1',sourceReceiptId:'receipt-1',turn:1,callId:'call-1',toolName:'shell',reason:'运行合成命令',createdAt:at,status:'pending',operationCategories:scenario==='two'?[]:['command'],canAlwaysAllow:scenario!=='two',riskCategories:scenario==='two'?[]:['execute'],secondOpinion:{alignment:scenario==='warning'?'对不上':'对得上',externalInfluence:'没有',reason:scenario==='warning'?'这条命令超出了你的要求，请先核对。':'符合要求'}};}
function question(){return {questionRpcId:'apple5-question',observedSeq:7,sessionId:sessionID,taskId:taskID,sourceCommandId:'cmd-1',sourceReceiptId:'receipt-1',turn:1,createdAt:at,status:questionAnswer?'answered':'pending',questions:[{id:'plan',question:'周末想先做什么？',options:[{label:'散步'},{label:'读书'},{label:'整理计划'}],multiSelect:false}],...(questionAnswer?{answer:questionAnswer.answer,answerRequestId:questionAnswer.requestId,answeredAt:at}:{})};}
function queueCommand(id){return {commandId:id,requestId:'request-'+id,kind:'session.message',targetDeviceId:'health4-host',state:'accepted_by_dsh',sessionId:sessionID,receiptId:'receipt-'+id,createdAt:at,updatedAt:at};}
function canceledTask(id){return {taskId:id,sessionId:sessionID,sourceText:id==='queue-edit'?'QUEUED_EDIT':'QUEUED_RETRACT',source:queueCommand(id),artifacts:[],steps:[],sources:[],supplements:[],resumes:[],control:{state:'stop_requested',updatedAt:at,canStop:false,canSupplement:false,canResume:false,stopStatus:'stopped',pendingReceipts:0},replyEvidence:{status:'unconfirmed',turn:null,assistantChunks:0,textChunks:0,reasoningChunks:0,assistantMessages:0,toolSaveObserved:false}};}
const server=http.createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;const data=body?JSON.parse(body):{},url=new URL(req.url,'http://localhost'),path=url.pathname.replace('/personal/v1','');routes.push({method:req.method,path});const send=(v,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(v));};
 if(url.pathname==='/fixture/apple3'){if(data.reset){decisions=[];questionAnswer=null;queueCancels=[];}scenario=data.scenario??scenario;tick=0;if(scenario==='health')await fetch(healthOrigin+'/fixture/control',{method:'POST',body:JSON.stringify({version:3,scenario:'data',enabled:false,resetAnalysis:true})});return send({ok:true});}
 if(url.pathname==='/fixture/apple3-report')return send({syntheticOnly:true,scenario,decisions,reads,settingWrites,routes,queueCancels,questionAnswer});
 if(scenario==='queue'&&path==='/commands')return send({commands:['queue-retract','queue-edit','queue-active'].map(queueCommand),hasMore:false,nextBefore:null});
 if(scenario==='queue'&&path.startsWith('/tasks/queue-')){
  const id=path.split('/')[2];
  if(id==='queue-active')return send({error:{code:'TASK_ALREADY_STARTED'}},409);
  if(!['queue-edit','queue-retract'].includes(id))return send({error:{code:'NOT_FOUND'}},404);
  if(path.endsWith('/cancel')&&req.method==='POST')queueCancels.push({taskId:id,requestId:data.requestId});
  return send({task:canceledTask(id)});
 }
 if(path==='/status')return send({ownerId:'health4-owner',hostId:'health4-host',personalCapabilities:{chats:1,chatTimeline:1,chatSend:1,replyStreaming:1,chatResources:1,chatSearch:1,sideChats:1}});
 if(path==='/sessions')return send({sessions:[{sessionId:'apple4-side-session',title:'周末的合成计划',running:false,sendAvailable:true,modelProfileId:'synthetic-model',taskAvailable:true},{sessionId:'apple4-recent-session',title:'整理读书清单',running:false,sendAvailable:true,modelProfileId:'synthetic-model',taskAvailable:true}]});
 if(path==='/chats')return send({items:[{chatId:'apple4-side',kind:'side',contextUsage:{usedTokens:6200,contextWindow:8192},title:'周末的合成计划',activeSessionId:'apple4-side-session',modelProfileId:'synthetic-model',timeZone:'UTC',revision:1,contentRevision:1,running:false,sendAvailable:true,taskAvailable:true,pinned:true,archived:false,unread:true},{chatId:'apple4-recent',kind:'side',title:'整理读书清单',activeSessionId:'apple4-recent-session',modelProfileId:'synthetic-model',timeZone:'UTC',revision:1,contentRevision:1,running:false,sendAvailable:true,taskAvailable:true,pinned:false,archived:false,unread:false}],hasMore:false,nextCursor:null});
 if(path==='/session-groups')return send({groups:[]});
 if(path==='/projects')return send({projects:[{projectId:'ios-ui-2-project',name:'合成周末计划',instructions:'只整理合成安排和清单。',permission:'write',revision:1,revoked:false,createdAt:at}],canManage:false});
 if(path==='/devices')return send({devices:[{id:'health4-phone',name:'合成设备',revoked:false,current:true}]});
 if(path==='/settings/usage')return send({timeZone:'UTC',canManage:false,models:[]});
 if(path==='/activity')return send({items:[],hasMore:false,nextCursor:null});
 if(path.startsWith('/chats/apple4-')&&!path.endsWith('/events')&&!path.endsWith('/changes')&&!path.endsWith('/resources'))return send({chat:{chatId:path.split('/').at(-1),kind:'side',title:'周末的合成计划',activeSessionId:'apple4-side-session',modelProfileId:'synthetic-model',timeZone:'UTC',revision:1,contentRevision:1,running:false,sendAvailable:true,taskAvailable:true,pinned:true,archived:false,unread:true}});
 if(path.startsWith('/chats/apple4-')&&path.endsWith('/resources'))return send({outputs:[],sources:[],contentRevision:1,hasMore:false,nextCursor:null});
 if(path.startsWith('/chats/apple4-')&&(path.endsWith('/events')||path.endsWith('/changes')))return send({items:[],upserts:[],removals:[],hasOlder:false,hasNewer:false,syncCursor:'side-history',contentRevision:1,indexState:'ready',timeZone:'UTC',liveRevision:0,liveEvents:[],hasMore:false,nextCursor:null});
 if(path==='/settings/general')return send({settings:{language:'zh-CN'}});
 if(path==='/usage')return send({month:new Date().toISOString().slice(0,7),timeZone:'UTC',total:{requests:0,unknownRequests:0,unpricedRequests:0,inputTokens:0,cachedInputTokens:0,outputTokens:0,cost:0},days:[],sessions:[],models:[],budget:{state:'normal'}});
 if(path.endsWith('/thinking'))return send({supported:false,enabled:false});
 if(path===`/chats/${chatID}/resources`)return send({outputs:scenario==='resources'?[{artifactId:'ios-ui-2-file',sessionId:sessionID,fileName:'合成散步清单.txt',contentType:'text/plain',createdAt:at},{artifactId:'ios-ui-2-file-old',sessionId:sessionID,fileName:'合成散步清单.txt',contentType:'text/plain',createdAt:new Date(Date.parse(at)-86400000).toISOString()}]:[],sources:scenario==='resources'?[{key:'ios-ui-2-source',sessionId:sessionID,kind:'tool',name:'读取已有的安排',uses:[{id:'source-read-plan',seq:3,summary:'读取周末安排',path:`/sessions/${sessionID}/events/3/detail`}]}]:[],contentRevision:1,hasMore:false,nextCursor:null});
 if(path===`/chats/${chatID}/locate`)return send({date:url.searchParams.get('date'),eventId:'native-1',contentRevision:1,indexState:'ready',timeZone:'UTC'});
 if(path===`/chats/${chatID}/search`)return send({hits:[],hasMore:false,nextCursor:null,contentRevision:1,indexState:'ready',timeZone:'UTC'});
 if(path.startsWith('/sessions/apple4-')){
  if(path.endsWith('/events'))return send({events:[native(1,'user.message',{text:'想整理周末的计划'}),native(2,'assistant.message',{text:'可以先留出一段时间散步，再读几页书。'})],nextSeq:2,hasMore:false});
  if(path.endsWith('/messages'))return send({messages:[],hasMore:false,nextBefore:null});
  if(path.endsWith('/approval-mode'))return send({mode:'auto',allowedCategories:[]});
  if(path.endsWith('/resources'))return send({outputs:[],sources:[]});
  return send({items:[],approvals:[],questions:[],commands:[],hasMore:false,nextBefore:null});
 }
 if(path==='/models')return send({models:[{id:'synthetic-model',name:'合成模型',provider:'synthetic',model:'synthetic',configured:true}]});
 if(path==='/chats/main')return send({chat:{chatId:chatID,kind:'main',title:'合成对话',activeSessionId:sessionID,modelProfileId:'synthetic-model',timeZone:'UTC',revision:1,contentRevision:1,running:scenario.startsWith('stream'),sendAvailable:true,taskAvailable:true,pinned:true,archived:false,unread:false}});
 if(path===`/chats/${chatID}/events`||path===`/chats/${chatID}/changes`){const items=events().map(row),liveEvents=live();reads.push({kind:'reply',scenario});return send(path.endsWith('/changes')?{upserts:items,removals:[],nextCursor:'history',hasMore:false,contentRevision:1,indexState:'ready',timeZone:'UTC',liveRevision:tick,liveEvents}:{items,olderCursor:null,newerCursor:null,hasOlder:false,hasNewer:false,syncCursor:'history',contentRevision:1,indexState:'ready',timeZone:'UTC',liveRevision:tick,liveEvents});}
 if(path===`/chats/${chatID}/dates`)return send({days:[],contentRevision:1,indexState:'ready',timeZone:'UTC'});
 if(path===`/sessions/${sessionID}/events`)return send({events:events(),nextSeq:30,hasMore:false,liveSeq:tick,liveEvents:live().map(x=>native(x.sourceRef.seq,x.type,x.data))});
 if(path.startsWith(`/sessions/${sessionID}/events/`)&&path.endsWith('/detail')){
  const seq=Number(path.split('/').at(-2));reads.push({kind:'detail',seq});
  return send({seq,text:seq<6?'已读取「合成周末计划.txt」的文字内容。':'把时间点和出门用品整理成清单，并生成「合成散步清单.txt」。',truncated:false});
 }
 if(path===`/sessions/${sessionID}/approvals`)return send({approvals:['aligned','warning','two','long'].includes(scenario)&&!decisions.some(x=>x.approvalId==='apple3-'+scenario)?[approval()]:[],hasMore:false,nextBefore:null});
 if(path.startsWith(`/sessions/${sessionID}/approvals/`)){decisions.push({approvalId:path.split('/').at(-1),...data});return send({approval:{...approval(),status:'answered',decisionOutcome:data.outcome,decisionScope:data.scope??'once',decisionRequestId:data.requestId,answeredAt:at},requestId:data.requestId});}
 if(path===`/sessions/${sessionID}/questions`)return send({questions:scenario==='question'?[question()]:[],hasMore:false,nextBefore:null});
 if(path===`/sessions/${sessionID}/questions/apple5-question`&&req.method==='POST'){questionAnswer={requestId:data.requestId,answer:data.answer};return send({question:question(),requestId:data.requestId});}
 if(path==='/settings/approvals'){if(req.method==='PATCH'){secondOpinionEnabled=data.secondOpinionEnabled??secondOpinionEnabled;settingWrites.push(data);}return send({mode:'auto',secondOpinionEnabled});}
 if(path===`/sessions/${sessionID}/approval-mode`)return send({mode:'auto',allowedCategories:[]});
 // Forward health, authentication and unknown routes to the existing synthetic health service.
 const response=await fetch(healthOrigin+req.url,{method:req.method,headers:{'content-type':'application/json',...(req.headers.cookie?{cookie:req.headers.cookie}:{}),...(req.headers['x-weftmate-csrf']?{'x-weftmate-csrf':req.headers['x-weftmate-csrf']}:{})},...(body?{body}: {})});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({origin:'http://127.0.0.1:'+server.address().port})));process.on('SIGTERM',()=>{server.close();child.kill();});
