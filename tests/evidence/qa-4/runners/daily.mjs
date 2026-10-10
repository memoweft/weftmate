/** MEM-D: isolated real Electron / pinned DSH / real Core; no daily endpoints. */
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPersonalAccessService } from '../../../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../../../src/host-mode.mjs';
import { runEvaluation } from '../../../../scripts/eval.mjs';
import { localUiSession } from '../../../../tests/helpers/local-ui-session.mjs';
const arg = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name)+1] : fallback;
const repository = resolve(arg('--repo', join(import.meta.dirname,'../../../..')));
const out = resolve(arg('--out','tests/evidence/mem-d/before-main'));
const core = resolve(arg('--core','C:/Temp/weftmate-mem-d-core/py/src'));
const python = 'D:/AIProjects/MemoWeft/Core/py/.venv/Scripts/python.exe';
const resumeRoot=arg('--resume',null);
const root = resumeRoot?resolve(resumeRoot):mkdtempSync(join(tmpdir(),'weftmate-qa4-daily-')), profile = join(root,'profile'), evaluation = join(root,'eval');
mkdirSync(out,{recursive:true}); mkdirSync(profile,{recursive:true}); mkdirSync(evaluation,{recursive:true});
const real = arg('--model','synthetic') === 'mimo';
const key = real ? execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"[Console]::Out.Write([Environment]::GetEnvironmentVariable('MIMO_API_KEY','Machine'))"],{encoding:'utf8',windowsHide:true}).trim() : 'mem-d-synthetic';
const report = resumeRoot?JSON.parse(readFileSync(join(out,'results.json'),'utf8')):{revision:execFileSync('git',['rev-parse','HEAD'],{cwd:repository,encoding:'utf8'}).trim(),model:real?'mimo':'synthetic',startedAt:new Date().toISOString(),turns:[],requests:[],snapshots:[],compressedDays:real?1:3,scenarioBoundaries:[],ordinaryTexts:[]};
if(resumeRoot){report.attemptErrors??=[];if(report.error){if(report.error.includes('Invalid scenario'))report.ordinaryTexts=report.ordinaryTexts.filter(t=>!t.includes('第903种花茶'));report.attemptErrors.push(report.error);delete report.error;}report.resumedAt=new Date().toISOString();}
const safe = text => String(text).replaceAll(key,'[private]');
const save = () => writeFileSync(join(out,'results.json'),safe(JSON.stringify(report,null,2))+'\n');
writeFileSync(join(out,'run-root.txt'),root+'\n');
const pause = ms => new Promise(r=>setTimeout(r,ms));
const dayTopics=[
 ['我喝第1种花茶时偏好加一小撮肉桂粉。','我写周报时偏好先列本周完成的事情。','我看技术解释时偏好先给能运行的小例子。','我开视频会时偏好提前十分钟检查麦克风。','我整理下载目录时偏好按项目名称分类。','我做代码审查时偏好先看测试覆盖。'],
 ['我安排上午工作时偏好先做需要专注的任务。','我阅读长文时偏好分成不超过五个小节。','我写会议纪要时偏好把决定和待办分开。','我使用电脑深色主题时偏好低饱和配色。','我准备演示时偏好每页只讲一个重点。','我出差订酒店时偏好安静的高楼层。'],
 ['我周末散步时偏好河边路线。','我喝咖啡时偏好不加糖。','我安排训练时偏好周三晚上。','我拍旅行照片时偏好自然光。','我挑背包时偏好能放十四寸电脑的尺寸。','我订火车票时偏好靠窗座位。'],
 ['我在手机上看回复时偏好先给三句话摘要。','我查看模型费用时偏好显示人民币。','我给文件起名时偏好日期放在最前面。','我写脚本时偏好先提供只读预览。','我做笔记时偏好用中文标题。','我与同事协作时偏好异步文字沟通。'],
 ['我做晚饭时偏好清淡少油。','我购买水果时偏好新鲜橙子。','我听工作背景音乐时偏好纯音乐。','我收到错误报告时偏好先看到复现步骤。','我阅读性能报告时偏好同时看中位数和高分位数。','我看任务进度时偏好简短说明。'],
 ['我备份项目时偏好保留最近七天的版本。','我学英语时偏好技术术语后附中文解释。','我写邮件时偏好开头直接说明请求。','我安排周末时偏好保留一个下午休息。','我读产品建议时偏好列出成本和收益。','我看图表时偏好标出单位。'],
 ['我做月度复盘时偏好先回看未完成事项。','我选择旅行路线时偏好少换乘。','我在线购物时偏好先看售后政策。','我需要教程时偏好每步附验证方法。','我整理收藏时偏好按主题而非网站分类。','我安排下周时偏好先确认固定约会。']
];
let slot=Promise.resolve(), loaded='daily-local', count=report.requests.length;
const server=createServer(async(req,res)=>{
  if(req.url==='/props'){res.setHeader('content-type','application/json');res.end(JSON.stringify({total_slots:1,n_ctx:131072}));return;}
  if(req.url==='/switch/status'){res.setHeader('content-type','application/json');res.end(JSON.stringify({currentModelId:loaded,switching:false,probe:{health:true}}));return;}
  if(req.url==='/v1/models'){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'daily-local'},{id:'daily-second'}]}));return;}
  let raw='';for await(const chunk of req)raw+=chunk;
  const input=JSON.parse(raw); const record={id:++count,model:input.model,stream:input.stream===true,at:new Date().toISOString()};report.requests.push(record);
  let release;const prior=slot;slot=new Promise(r=>release=r);await prior;
  try {
    if(loaded!==input.model){record.switch=true;record.switchDelayMs=process.argv.includes('--slow-switch')?125000:1200;if(record.switchDelayMs===125000)report.slowSwitchTested=true;save();await pause(record.switchDelayMs);loaded=input.model;}
    const last=input.messages?.at(-1)?.content;
    let payload;try{payload=JSON.parse(last);}catch{}
    const formation=Array.isArray(payload?.evidence);record.formation=formation;if(process.argv.includes('--timeout-only')&&input.stream&&!formation&&String(last).includes('QA4_TIMEOUT')&&!report.timeoutInjected){report.timeoutInjected=true;record.silentStream=true;const t=Date.now();res.on('close',()=>{record.closedAfterMs=Date.now()-t;save();});res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify({id:'qa4-silent',choices:[{index:0,delta:{role:'assistant'},finish_reason:null}]})+'\n\n');save();await pause(95000);record.closedByClient=res.destroyed;record.silenceElapsedMs=Date.now()-t;if(!res.destroyed)res.end();return;}record.recallContainsPriorPreference=!formation&&JSON.stringify(input.messages?.slice(0,-1)).includes('肉桂粉');
    if(formation && report.requests.filter(r=>r.formation).length===1 && !real){record.status=503;res.writeHead(503).end('{}');return;}
    let body;
    if(real){const upstream=await fetch('https://api.xiaomimimo.com/v1/chat/completions',{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify({...input,model:'mimo-v2.6-flash',stream:false,stream_options:undefined}),signal:AbortSignal.timeout(180000)});body=await upstream.json();record.status=upstream.status;record.usage=body.usage??null;}
    else {const e=payload?.evidence?.[0];const content=formation?JSON.stringify({schema_version:8,result:'cognitions',cognitions:[{action:'form',target:'owner_self',statement_kind:'preference',formed_by:'stated',proposition:e.text,supports:e.segments.map(s=>({evidence_id:e.id,segment_id:s.id}))}]}):String(last).includes('第1种花茶偏好加什么')?(record.recallContainsPriorPreference?'你偏好加一小撮肉桂粉。':'我不知道。'):'收到，我理解了。';body={id:`chat-${count}`,object:'chat.completion',choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}};record.status=200;}
    res.statusCode=record.status;
    if(input.stream && record.status===200){res.setHeader('content-type','text/event-stream');res.end(`data: ${JSON.stringify({id:body.id,object:'chat.completion.chunk',choices:[{index:0,delta:body.choices[0].message,finish_reason:null}]})}\n\ndata: ${JSON.stringify({id:body.id,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:body.usage})}\n\ndata: [DONE]\n\n`);}
    else{res.setHeader('content-type','application/json');res.end(JSON.stringify(body));}
  }catch(error){record.error=safe(error.message);if(!res.headersSent)res.writeHead(503);res.end('{}');}finally{release();save();}
});
let app, page, hostLog='';
const api = (path, body, method=body?'POST':'GET') => page.evaluate(async({path,body,method})=>{const me=await(await fetch('/personal/v1/auth/me')).json();const r=await fetch(`/personal/v1${path}`,{method,headers:{'content-type':'application/json','x-weftmate-csrf':me.csrfToken},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};},{path,body,method});
async function until(check,ms=360000){const end=Date.now()+ms;while(Date.now()<end){const value=await check();if(value)return value;await pause(250);}throw new Error('MEM_D_WAIT_TIMEOUT');}
try{
  await new Promise(r=>server.listen(resumeRoot?Number(new URL(JSON.parse(readFileSync(join(root,'memory.json'),'utf8')).baseUrl).port):0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/v1`;
  writeFileSync(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
  const priorCredentials=resumeRoot?JSON.parse(readFileSync(join(evaluation,'credentials.json'),'utf8')):null;const username=priorCredentials?.username??`eval-memd-${randomUUID()}`,password=priorCredentials?.password??`synthetic-${randomUUID()}`;
  if(!resumeRoot){
  const backend=Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(k=>[k,async()=>({})]));
  const prep=await createPersonalAccessService({root:join(profile,'personal-access'),port:0,backend});
  const {origin}=await prep.start(),grant=await prep.issueSetupGrant();
  assert.equal((await fetch(`${origin}/personal/v1/auth/setup`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,username,password,deviceName:'MEM-D synthetic'})})).status,201);await prep.close();}
  const config=join(root,'memory.json');writeFileSync(config,JSON.stringify({python,pythonPath:core,baseUrl:base,model:'@current',authRef:'unselected-startup-model'}));
  const env={...process.env};for(const k of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(k)||['ELECTRON_RUN_AS_NODE','MIMO_API_KEY','MODEL_SWITCH_UNIFIED_KEY'].includes(k))delete env[k];
  env.WEFTMATE_BASELINE_TRACE=join(root,'trace.jsonl');env.MEM_D_REPOSITORY=repository;
  async function launch(){
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[join(repository,'tests/integration/mem-d-bootstrap.mjs'),`--user-data-dir=${profile}`,'--personal-host','--access-port=0',`--personal-memory-config=${config}`],cwd:repository,env,timeout:90000});
  for(const s of [app.process().stdout,app.process().stderr])s?.on('data',d=>{hostLog+=safe(d);});
  page=await app.firstWindow({timeout:90000});page.setDefaultTimeout(90000);await page.waitForURL('**/personal/v1/ui');await localUiSession(page,{username,password},'QA-4 daily',{mainChat:true});
  await page.locator('#assistant-view').waitFor({state:'visible'});
  }
  await launch();
  if(resumeRoot)await app.evaluate(async(_electron,key)=>globalThis.m2ExitSeedCredentials({'daily-local':key,'daily-second':key}),key);
  if(!resumeRoot)for(const modelId of ['daily-local','daily-second']){const requestId=randomUUID();assert.equal((await api('/account/models',{requestId,name:modelId,baseUrl:base,modelId,apiKey:key})).status,202);assert.equal((await until(async()=>{const op=(await api(`/account/models/by-request/${requestId}`)).body.operation;return op&&!['pending','applying'].includes(op.status)&&op;})).status,'succeeded');}
  writeFileSync(join(evaluation,'credentials.json'),JSON.stringify({host:new URL(page.url()).origin,username,password,deviceName:'MEM-D',provisioned:true}));
  const ownerId=(await api('/status')).body.ownerId;
  async function snapshot(label){const file=join(profile,'personal-access/accounts',ownerId,'memory-home/boundary-outbox.json');const status=await api('/memory/status');report.snapshots.push({label,status,outbox:existsSync(file)?JSON.parse(readFileSync(file,'utf8')):null,ipc:JSON.parse(readFileSync(join(profile,'dsh-home/weftmate-host-state.json'),'utf8')).accountMemoryIpc});save();}
  await snapshot('before');
  if(process.argv.includes('--backfill'))await app.evaluate(()=>{globalThis.memDNoCapture=true;globalThis.memDDropIngest=true;});
  for(let group=resumeRoot?Number(arg('--groups',3)):0;group<Number(arg('--groups',3));group++){
    if(process.argv.includes('--faults')) await app.evaluate((_electron, group)=>{globalThis.memDNoRoute=group===1;globalThis.memDBusy=group===2;globalThis.memDDropIngest=group===3; if(group===4)globalThis.m2ExitBreakCore();},group);
    const scenario={id:`memd-${group}`,category:'memory',title:'Daily conversations',notes:'Synthetic daily preferences',setup:{files:[],memories:[],devices:[]},turns:Array.from({length:Number(arg('--turns',2))},(_,i)=>({user:`${dayTopics[group%dayTopics.length][i%6]}请简短回复收到，不调用工具。`})),checks:[{type:'turn_status',status:'completed'}],timeoutSec:420};
    report.ordinaryTexts.push(...scenario.turns.map(t=>t.user));
    await runEvaluation({host:new URL(page.url()).origin,out:evaluation,model:group%2?'daily-second':'daily-local',scenarioList:[scenario],onScenarioResult:r=>{report.turns.push(r);save();}});
    await pause(1000);await snapshot(`group-${group}`);await page.evaluate(()=>document.getElementById('rail-memory').click());await page.locator('#memory-view').waitFor({state:'visible'});await pause(800);await page.screenshot({path:join(out,`health-group-${group}.png`)});report.scenarioBoundaries.push({group,day:real?1:Math.min(3,1+Math.floor(group/3)),model:group%2?'daily-second':'daily-local'});save();
    if(group===3){await app.evaluate(({powerMonitor})=>powerMonitor.emit('suspend'));await pause(2500);await app.evaluate(({powerMonitor})=>powerMonitor.emit('resume'));report.sleepWake={simulatedPowerEvents:true,actualOsSleep:false};await snapshot('resume');}
    if(process.argv.includes('--restart')&&group===2){await app.close();await launch();writeFileSync(join(evaluation,'credentials.json'),JSON.stringify({host:new URL(page.url()).origin,username,password,deviceName:'MEM-D',provisioned:true}));await app.evaluate(async(_electron,key)=>globalThis.m2ExitSeedCredentials({'daily-local':key,'daily-second':key}),key);report.hostRestart=true;await pause(5000);await snapshot('host-restarted');}
    if(process.argv.includes('--faults')){await app.evaluate(()=>{globalThis.memDNoRoute=false;globalThis.memDBusy=false;globalThis.memDDropIngest=false;globalThis.m2ExitRestoreCore();});await pause(4000);await snapshot(`recovered-${group}`);}
  }
  if(!process.argv.includes('--backfill')&&!process.argv.includes('--audit-only')&&!process.argv.includes('--timeout-only')&&!process.argv.includes('--correction-audit-only')) {
    const hostId=(await api('/status')).body.hostId,models=(await api('/models')).body.models,modelId=models.find(m=>m.name==='daily-second').id;
    async function command(body){const requestId=randomUUID();assert.equal((await api('/commands',{requestId,targetDeviceId:hostId,...body})).status,202);return until(async()=>{const c=(await api(`/commands/by-request/${requestId}`)).body.command;if(c.state==='rejected')throw Error(c.errorCode);return c.state==='accepted_by_dsh'&&c;});}
    async function complete(body){const c=await command(body);await until(async()=>((await api(`/sessions/${c.sessionId}/events?limit=200`)).body.events??[]).some(e=>e.type==='turn.ended'));return c;}
    if(!report.mainConversation){const temp=await command({kind:'session.create',modelProfileId:modelId,temporary:true});
    await complete({kind:'session.message',sessionId:temp.sessionId,text:'临时暗号 QA4_TEMP_PURPLE_CORAL。我喝茶使用紫金色珊瑚杯，请只回复收到。'});report.temporarySession=temp.sessionId;
    const main=(await api('/chats/main')).body.chat;
    const mainText='我喝第901种花茶时偏好加一小撮肉桂粉。请简短回复收到，不调用工具。';report.ordinaryTexts.push(mainText);
    const mainSend=await complete({kind:'chat.message',chatId:main.chatId,modelProfileId:modelId,text:mainText});report.mainConversation={sent:true,sessionId:mainSend.sessionId};
    const side=await command({kind:'session.side.create',parent:{kind:'main',id:main.chatId},modelProfileId:modelId,title:'三天压缩剧本旁聊'});
    const sideText='我喝第902种花茶时偏好加一小撮肉桂粉。请简短回复收到，不调用工具。';report.ordinaryTexts.push(sideText);
    await complete({kind:'session.message',sessionId:side.sessionId,text:sideText});report.sideConversation={sent:true,sessionId:side.sessionId};}
    const semantic={id:'qa4-daily-decision',category:'memory',title:'Daily confirmation and correction',notes:'Synthetic explicit decision and correction',setup:{files:[],memories:[],devices:[]},turns:[{user:'我喝第903种花茶时偏好加一小撮肉桂粉。请提议以后喝这种茶时提醒我加肉桂粉。'},{user:'好，以后我喝第903种花茶时，就提醒我加一小撮肉桂粉。'},{user:'纠正一下，第903种花茶不加肉桂粉，改为加一片柠檬。请记住。'}],checks:[{type:'turn_status',status:'completed'}],timeoutSec:420};
    report.ordinaryTexts.push(...semantic.turns.map(t=>t.user));await runEvaluation({host:new URL(page.url()).origin,out:evaluation,model:'daily-second',scenarioList:[semantic],onScenarioResult:r=>{report.turns.push(r);save();}});
    report.confirmationAndCorrectionSent=true;await snapshot('daily-extras');
    const recallScenario={id:'qa4-new-session-recall',category:'memory',title:'New session recall',notes:'Synthetic cross-session memory use',setup:{files:[],memories:[],devices:[]},turns:[{user:'我喝第1种花茶偏好加什么？只回答记忆里的偏好，不调用工具。'}],checks:[{type:'turn_status',status:'completed'},{type:'reply_contains',text:'肉桂粉'},{type:'memory_used'}],timeoutSec:420};report.ordinaryTexts.push(recallScenario.turns[0].user);await runEvaluation({host:new URL(page.url()).origin,out:evaluation,model:'daily-local',scenarioList:[recallScenario],onScenarioResult:r=>{report.turns.push(r);save();}});
  }
  if(process.argv.includes('--backfill')) {
    const hostId=(await api('/status')).body.hostId,modelId=(await api('/models')).body.models.find(m=>m.name==='daily-local').id;
    const command=async body=>{const requestId=randomUUID();const r=await api('/commands',{requestId,targetDeviceId:hostId,...body});assert.equal(r.status,202);return until(async()=>{const cmd=(await api(`/commands/by-request/${requestId}`)).body.command;if(cmd.state==='rejected')throw new Error(cmd.errorCode);return cmd.state==='accepted_by_dsh'&&cmd;});};
    const temporary=(await command({kind:'session.create',modelProfileId:modelId,temporary:true})).sessionId;
    await command({kind:'session.message',sessionId:temporary,text:'这次临时说，我只用紫金色珊瑚杯喝茶。请简短回复收到，不调用工具。'});
    await until(async()=>((await api(`/sessions/${temporary}/events?limit=100`)).body.events??[]).some(e=>e.type==='turn.ended'));
    await app.evaluate(async(_electron,ownerId)=>{const c=globalThis.memDIngestionContext;await c.serial(()=>c.mutate(ownerId,next=>{next.memoryCaptureSince=new Date().toISOString();}));globalThis.memDNoCapture=false;globalThis.memDDropIngest=false;},ownerId);
    await page.evaluate(()=>document.getElementById('rail-memory').click());await page.locator('#memory-view').waitFor({state:'visible'});
    const before=await api('/memory/backfill');report.backfill={preview:before.body,temporary};
    assert.equal(before.body.sessionCount,3);assert.equal(before.body.turnCount,3*Number(arg('--turns',2)));
    await page.getByRole('button',{name:'整理过去的对话',exact:true}).click();await page.getByRole('button',{name:'确认开始整理',exact:true}).waitFor({state:'visible'});
    await page.screenshot({path:join(out,'backfill-confirm-desktop.png')});
    await page.getByRole('button',{name:'确认开始整理',exact:true}).click();
    await page.getByRole('button',{name:'暂停整理',exact:true}).waitFor({state:'visible'});
    await page.getByRole('button',{name:'暂停整理',exact:true}).click();
    await until(async()=>((await api('/memory/status')).body.backfill?.state==='paused'));
    await pause(2500);const paused=(await api('/memory/status')).body.backfill;await pause(2500);
    assert.equal((await api('/memory/status')).body.backfill.submittedTurns,paused.submittedTurns);
    await page.getByRole('button',{name:'继续整理',exact:true}).click();
    await page.getByRole('button',{name:'取消整理',exact:true}).click();
    await until(async()=>((await api('/memory/status')).body.backfill?.state==='cancelled'));
    report.backfill.pauseAndCancel=true;
    await page.getByRole('button',{name:'整理过去的对话',exact:true}).click();
    await page.getByRole('button',{name:'确认开始整理',exact:true}).click();
    await until(async()=>((await api('/memory/status')).body.backfill?.state==='completed'),180000);
    await until(async()=>{const s=(await api('/memory/status')).body;return s.pendingBoundaryCount===0&&s.pendingFormationCount===0;},180000);
    report.backfill.after=await api('/memory/backfill');assert.equal(report.backfill.after.body.turnCount,0);
    await page.getByRole('button',{name:'整理过去的对话',exact:true}).click();await pause(500);assert.equal(await page.getByRole('button',{name:'确认开始整理',exact:true}).isVisible(),false);
    await page.locator('#memory-refresh').click();await pause(1000);await page.screenshot({path:join(out,'backfill-complete-desktop.png')});
  }
  if(process.argv.includes('--timeout-only')){const scenario={id:'qa4-timeout-recovery',category:'memory',title:'Default 90 second silent-stream recovery',notes:'Same synthetic account; first stream emits only role then stalls for 95 seconds; product timeout and retry unchanged',setup:{files:[],memories:[],devices:[]},turns:[{user:'QA4_TIMEOUT：我看错误提示时偏好先给恢复方法。请简短回复收到，不调用工具。'}],checks:[{type:'turn_status',status:'completed'}],timeoutSec:420};report.ordinaryTexts.push(scenario.turns[0].user);await runEvaluation({host:new URL(page.url()).origin,out:evaluation,model:'daily-local',scenarioList:[scenario],onScenarioResult:r=>{report.turns.push(r);save();}});}
  if(process.argv.includes('--correction-audit-only')){const scenario={id:'qa4-correction-recall',category:'memory',title:'Daily correction follow-up',notes:'Unprompted value check after all formation jobs drained; no repair or additional correction',setup:{files:[],memories:[],devices:[]},turns:[{user:'我喝第903种花茶现在应该加什么？请按我最后确认的偏好回答。不要调用工具。'}],checks:[{type:'turn_status',status:'completed'},{type:'reply_contains',text:'柠檬'}],timeoutSec:420};report.ordinaryTexts.push(scenario.turns[0].user);await runEvaluation({host:new URL(page.url()).origin,out:evaluation,model:'daily-local',scenarioList:[scenario],onScenarioResult:r=>{report.turns.push(r);save();}});}
  if(process.argv.includes('--verify')) {
    report.allTurnsCompleted=report.turns.every(r=>r.turns.every(t=>t.status==='completed'));
    report.failedScenarioChecks=report.turns.filter(r=>r.status!=='passed').map(r=>({id:r.id,checks:r.checks}));
    await until(async()=>{const s=(await api('/memory/status')).body;return s.pendingBoundaryCount===0&&s.pendingFormationCount===0;},420000);
    const items=(await api('/memory/items?kind=cognition')).body.items;assert.ok(items.length);report.formalItems=items;
    report.allSources=[];for(const item of items){const s=(await api(`/memory/items/cognition/${encodeURIComponent(item.id)}/sources`)).body.sources;report.allSources.push({id:item.id,sources:s});}
    report.sources=(await api(`/memory/items/cognition/${encodeURIComponent(items[0].id)}/sources`)).body.sources;
    assert.ok(report.sources.some(s=>report.ordinaryTexts.includes(s.rawContent)),'formal memory has verbatim ordinary source');
    await page.evaluate(()=>document.getElementById('rail-memory').click());await page.locator('#memory-view').waitFor({state:'visible'});await pause(3500);
    await page.screenshot({path:join(out,'memory-desktop-light.png')});
    await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.screenshot({path:join(out,'memory-desktop-dark.png')});
    const browser=await chromium.launch({headless:true,channel:'msedge'});try{const phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,deviceScaleFactor:1});await phone.goto(new URL(page.url()).origin+'/personal/v1/ui');await localUiSession(phone,{username,password},'QA-4 phone',{mainChat:true});await phone.locator('#assistant-view').waitFor({state:'visible'});await phone.evaluate(()=>document.getElementById('rail-memory').click());await phone.locator('#memory-view').waitFor({state:'visible'});await pause(3500);await phone.screenshot({path:join(out,'memory-phone.png')});}finally{await browser.close();}
  }
  if(process.argv.includes('--audit-only')){const scenario={id:'qa4-settled-recall',category:'memory',title:'Settled cross-session recall',notes:'Repeat only after durable outbox and formation jobs drained; preserve initial immediate failure',setup:{files:[],memories:[],devices:[]},turns:[{user:'补验：我喝第1种花茶偏好加什么？只回答记忆里的偏好，不调用工具。'}],checks:[{type:'turn_status',status:'completed'},{type:'reply_contains',text:'肉桂粉'},{type:'memory_used'}],timeoutSec:420};report.ordinaryTexts.push(scenario.turns[0].user);await runEvaluation({host:new URL(page.url()).origin,out:evaluation,model:'daily-local',scenarioList:[scenario],onScenarioResult:r=>{report.turns.push(r);save();}});await until(async()=>{const s=(await api('/memory/status')).body;return s.pendingBoundaryCount===0&&s.pendingFormationCount===0;},420000);}
  if(process.argv.includes('--correction-audit-only')){const id=report.turns.find(r=>r.id==='qa4-daily-decision').turns[0].sessionId;await page.getByRole('button',{name:'关闭设置',exact:true}).click().catch(()=>{});await app.evaluate(({BrowserWindow},id)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/personal/v1/ui')).webContents.send('wm:desktop:conversation',id),id);await pause(2500);await page.screenshot({path:join(out,'correction-original-conversation-reopened.png')});}
  const receiptDb=join(profile,'personal-access/accounts',ownerId,'memory-home/memoweft/memoweft.sqlite3');
  if(existsSync(receiptDb)){
    const ledger=join(root,'ordinary-ledger.json');writeFileSync(ledger,JSON.stringify(report.ordinaryTexts));
    report.delivery=JSON.parse(execFileSync(python,['-c',"import sqlite3,json,sys; c=sqlite3.connect(sys.argv[1]); texts=json.load(open(sys.argv[2],encoding='utf-8')); rows=c.execute('select * from evidence').fetchall(); found=[any(t in str(v) for row in rows for v in row) for t in texts]; print(json.dumps({'expectedOrdinary':len(texts),'delivered':sum(found),'missing':len(texts)-sum(found),'missingIndices':[i for i,v in enumerate(found) if not v],'temporaryEvidence':sum('QA4_TEMP_PURPLE_CORAL' in str(row) for row in rows),'temporaryContext':sum('QA4_TEMP_PURPLE_CORAL' in str(row) for row in c.execute('select * from interaction_context')),'temporaryFormal':sum('QA4_TEMP_PURPLE_CORAL' in str(row) or '紫金色珊瑚杯' in str(row) for row in c.execute('select * from cognition'))})); c.close()",receiptDb,ledger],{encoding:'utf8',windowsHide:true}));
    if(!process.argv.includes('--backfill')&&!report.forget&&report.turns[0]?.turns[0]?.sessionId){const id=report.turns[0].turns[0].sessionId;const preview=await api(`/sessions/${id}/forget-preview`);report.forget={preview:preview.body};report.forget.deleted=await api(`/sessions/${id}`,{forgetMemories:true,deleteConversationSnippets:true,...(Number.isSafeInteger(preview.body.memoryWorldRevision)?{memoryWorldRevision:preview.body.memoryWorldRevision}:{})},'DELETE');await snapshot('after-explicit-forget');}
  }
  if((process.argv.includes('--timeout-only')||process.argv.includes('--correction-audit-only'))&&report.delivery){const forgotten=report.forget?.deleted?.body?.forgottenEvidenceCount||0;report.delivery.explicitlyForgottenIndices=Array.from({length:forgotten},(_,i)=>i);report.delivery.unintendedMissing=report.delivery.missingIndices.filter(i=>i>=forgotten).length;report.delivery.historicallyDelivered=report.delivery.delivered+report.delivery.missingIndices.filter(i=>i<forgotten).length;}
  await pause(3000);await snapshot('final');
  const db=join(profile,'personal-access/accounts',ownerId,'memory-home/memoweft/memoweft.sqlite3');
  if(existsSync(db))report.storage=JSON.parse(execFileSync(python,['-c',"import sqlite3,json,sys; c=sqlite3.connect(sys.argv[1]); print(json.dumps({t:c.execute('select count(*) from '+t).fetchone()[0] for t in ['evidence','interaction_context','memory_world_job','cognition']})); c.close()",db],{encoding:'utf8',windowsHide:true}));
if(existsSync(db)){report.temporaryEvidenceCount=JSON.parse(execFileSync(python,['-c',"import sqlite3,json,sys; c=sqlite3.connect(sys.argv[1]); print(json.dumps(sum(1 for row in c.execute('select * from evidence') if 'QA4_TEMP_PURPLE_CORAL' in str(row)))); c.close()",db],{encoding:'utf8',windowsHide:true}));}
}catch(error){report.error=safe(error.stack);process.exitCode=1;}finally{await app?.close();server.closeAllConnections();await new Promise(r=>server.close(r));writeFileSync(join(out,'host.log'),hostLog);save();}
console.log(JSON.stringify({revision:report.revision,error:report.error,turns:report.turns.length,storage:report.storage,out}));
