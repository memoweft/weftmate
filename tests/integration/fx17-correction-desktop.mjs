/** MEM-D: isolated real Electron / pinned DSH / real Core; no daily endpoints. */
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, openSync, closeSync, statSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
import { runEvaluation } from '../../scripts/eval.mjs';
import { createLanBaselineBridge } from './baseline-lan-model.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
const arg = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name)+1] : fallback;
const repository = resolve(arg('--repo', join(import.meta.dirname,'../..')));
const out = resolve(arg('--out','tests/evidence/mem-d/before-main'));
const core = resolve(arg('--core','C:/Temp/weftmate-mem-d-core/py/src'));
const python = 'D:/AIProjects/MemoWeft/Core/py/.venv/Scripts/python.exe';
const root = mkdtempSync(join(tmpdir(),'weftmate-fx17-')), profile = join(root,'profile'), evaluation = join(root,'eval');
mkdirSync(out,{recursive:true}); mkdirSync(profile); mkdirSync(evaluation);
const real = arg('--model','synthetic') === 'mimo';
const key = real ? execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"[Console]::Out.Write([Environment]::GetEnvironmentVariable('MIMO_API_KEY','Machine'))"],{encoding:'utf8',windowsHide:true}).trim() : 'mem-d-synthetic';
const report = {revision:execFileSync('git',['rev-parse','HEAD'],{cwd:repository,encoding:'utf8'}).trim(),model:real?'mimo':'synthetic',startedAt:new Date().toISOString(),turns:[],requests:[],snapshots:[]};
const secrets=[key];const safe = text => secrets.reduce((text,secret)=>secret?text.replaceAll(secret,'[private]'):text,String(text));
let rejectCorrection=process.argv.includes('--reject'),lan,lockTimer,ownsLock=false;
const lockPath='D:/AIProjects/WeftMate/Runtime/Orchestrator/lan.lock',lockToken=`FX-17 flower ${randomUUID()}`;
const save = () => writeFileSync(join(out,'results.json'),safe(JSON.stringify(report,null,2))+'\n');
writeFileSync(join(out,'run-root.txt'),root+'\n');
const pause = ms => new Promise(r=>setTimeout(r,ms));
let slot=Promise.resolve(), loaded='daily-local', count=0;
const server=createServer(async(req,res)=>{
  if(req.url==='/props'){res.setHeader('content-type','application/json');res.end(JSON.stringify({total_slots:1,n_ctx:131072}));return;}
  if(req.url==='/switch/status'){res.setHeader('content-type','application/json');res.end(JSON.stringify({currentModelId:loaded,switching:false,probe:{health:true}}));return;}
  if(req.url==='/v1/models'){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'daily-local'},{id:'daily-second'}]}));return;}
  let raw='';for await(const chunk of req)raw+=chunk;
  const input=JSON.parse(raw); const record={id:++count,model:input.model,stream:input.stream===true,at:new Date().toISOString()};report.requests.push(record);
  let release;const prior=slot;slot=new Promise(r=>release=r);await prior;
  try {
    if(loaded!==input.model){record.switch=true;record.switchDelayMs=process.argv.includes('--slow-switch')&&input.stream===true&&!report.slowSwitchTested?125000:1200;if(record.switchDelayMs===125000)report.slowSwitchTested=true;save();await pause(record.switchDelayMs);loaded=input.model;}
    const last=input.messages?.at(-1)?.content;
    let payload=input.messages.map(m=>{try{return JSON.parse(m.content)}catch{return null}}).find(m=>Array.isArray(m?.evidence));
    const formation=Array.isArray(payload?.evidence);record.formation=formation;if(formation){record.input=payload;}
    if(formation && report.requests.filter(r=>r.formation).length===1 && !real){record.status=503;res.writeHead(503).end('{}');return;}
    let body;
    if(real){const upstream=await fetch('https://api.xiaomimimo.com/v1/chat/completions',{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify({...input,model:'mimo-v2.6-flash',stream:false,stream_options:undefined}),signal:AbortSignal.timeout(180000)});body=await upstream.json();record.status=upstream.status;record.usage=body.usage??null;}
    else {const e=payload?.evidence?.[0];const content=formation?JSON.stringify({schema_version:8,result:'cognitions',cognitions:[{action:'form',target:'owner_self',statement_kind:'preference',formed_by:'stated',proposition:e.text,supports:e.segments.map(s=>({evidence_id:e.id,segment_id:s.id}))}]}):'收到，我理解了。';body={id:`chat-${count}`,object:'chat.completion',choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}};record.status=200;}
    if(formation){record.output=body;if(rejectCorrection&&payload.evidence.some(e=>e.text.includes('纠正一下'))){record.injectedRejection=true;body={...body,choices:[{message:{content:JSON.stringify({schema_version:8,result:'cognitions',cognitions:[{invalid:true}]})},finish_reason:'stop'}]};}}res.statusCode=record.status;
    if(input.stream && record.status===200){res.setHeader('content-type','text/event-stream');res.end(`data: ${JSON.stringify({id:body.id,object:'chat.completion.chunk',choices:[{index:0,delta:body.choices[0].message,finish_reason:null}]})}\n\ndata: ${JSON.stringify({id:body.id,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:body.usage})}\n\ndata: [DONE]\n\n`);}
    else{res.setHeader('content-type','application/json');res.end(JSON.stringify(body));}
  }catch(error){record.error=safe(error.message);if(!res.headersSent)res.writeHead(503);res.end('{}');}finally{release();save();}
});
let app, page, hostLog='';
const api = (path, body, method=body?'POST':'GET') => page.evaluate(async({path,body,method})=>{const me=await(await fetch('/personal/v1/auth/me')).json();const r=await fetch(`/personal/v1${path}`,{method,headers:{'content-type':'application/json','x-weftmate-csrf':me.csrfToken},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};},{path,body,method});
async function until(check,ms=90000){const end=Date.now()+ms;while(Date.now()<end){const value=await check();if(value)return value;await pause(250);}throw new Error('MEM_D_WAIT_TIMEOUT');}
try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/v1`;
  writeFileSync(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
  const username=`eval-memd-${randomUUID()}`,password=`synthetic-${randomUUID()}`;
  const backend=Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(k=>[k,async()=>({})]));
  const prep=await createPersonalAccessService({root:join(profile,'personal-access'),port:0,backend});
  const {origin}=await prep.start(),grant=await prep.issueSetupGrant();
  assert.equal((await fetch(`${origin}/personal/v1/auth/setup`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,username,password,deviceName:'MEM-D synthetic'})})).status,201);await prep.close();
  const config=join(root,'memory.json');writeFileSync(config,JSON.stringify({python,pythonPath:core,baseUrl:base,model:'@current',authRef:'unselected-startup-model'}));
  const env={...process.env};for(const k of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(k)||['ELECTRON_RUN_AS_NODE','MIMO_API_KEY','MODEL_SWITCH_UNIFIED_KEY'].includes(k))delete env[k];
  env.WEFTMATE_BASELINE_TRACE=join(root,'trace.jsonl');env.MEM_D_REPOSITORY=repository;
  async function launch(){
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[join(import.meta.dirname,'mem-d-bootstrap.mjs'),`--user-data-dir=${profile}`,'--personal-host','--access-port=0',`--personal-memory-config=${config}`],cwd:repository,env,timeout:90000});
  for(const s of [app.process().stdout,app.process().stderr])s?.on('data',d=>{hostLog+=safe(d);});
  page=await app.firstWindow({timeout:90000});page.setDefaultTimeout(90000);await page.waitForURL('**/personal/v1/ui');await localUiSession(page,{username,password},'MEM-D');
  await page.locator('#assistant-view').waitFor({state:'visible'});
  }
  await launch();
  for(const modelId of ['daily-local','daily-second']){const requestId=randomUUID();assert.equal((await api('/account/models',{requestId,name:modelId,baseUrl:base,modelId,apiKey:key})).status,202);assert.equal((await until(async()=>{const op=(await api(`/account/models/by-request/${requestId}`)).body.operation;return op&&!['pending','applying'].includes(op.status)&&op;})).status,'succeeded');}
  writeFileSync(join(evaluation,'credentials.json'),JSON.stringify({host:new URL(page.url()).origin,username,password,deviceName:'MEM-D',provisioned:true}));
  const ownerId=(await api('/status')).body.ownerId;
  async function snapshot(label){const file=join(profile,'personal-access/accounts',ownerId,'memory-home/boundary-outbox.json');const status=await api('/memory/status');report.snapshots.push({label,status,outbox:existsSync(file)?JSON.parse(readFileSync(file,'utf8')):null,ipc:JSON.parse(readFileSync(join(profile,'dsh-home/weftmate-host-state.json'),'utf8')).accountMemoryIpc});save();}
  await snapshot('before');
  const scenario={id:'fx17-flower-tea',category:'memory',title:'Confirmed preference correction',notes:'QA4-01 actual user wording',setup:{files:[],memories:[],devices:[]},turns:[
    {user:'我喝第903种花茶时偏好加一小撮肉桂粉。请提议以后喝这种茶时提醒我加肉桂粉。'},
    {user:'好，以后我喝第903种花茶时，就提醒我加一小撮肉桂粉。'},
    {user:'纠正一下，第903种花茶不加肉桂粉，改为加一片柠檬。'}
  ],checks:[{type:'turn_status',status:'completed'}],timeoutSec:420};
  await runEvaluation({host:new URL(page.url()).origin,out:evaluation,model:'daily-local',scenarioList:[scenario],onScenarioResult:r=>{report.turns.push(r);save();}});
  await until(async()=>{const s=(await api('/memory/status')).body;return s.pendingBoundaryCount===0&&s.pendingFormationCount===0;},420000);
  if(process.argv.includes('--reject')) {
    report.rejectedStatus=(await api('/memory/status')).body;
    assert.equal(report.rejectedStatus.failedCorrectionCount,1);
    const sourceSession=report.turns[0].turns[0].sessionId;
    await app.evaluate(({BrowserWindow},id)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/personal/v1/ui')).webContents.send('wm:desktop:conversation',id),sourceSession);
    await page.locator('[data-formation-notice]').waitFor({state:'visible',timeout:30000});
    await page.screenshot({path:join(out,'rejected-turn-notice.png')});
    await page.getByRole('button',{name:'查看原话与重试',exact:true}).click();await page.locator('#memory-view').waitFor({state:'visible'});
    await page.getByText('有 1 条纠正没有生效',{exact:true}).click();
    await page.screenshot({path:join(out,'rejected-correction.png')});
    report.activity=(await api('/activity?filter=all')).body;assert.ok(report.activity.items.some(i=>i.title==='有 1 条纠正没有生效'));
    const browser=await chromium.launch({headless:true,channel:'msedge'});try{const phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,deviceScaleFactor:1});await phone.goto(new URL(page.url()).origin+'/personal/v1/ui');await localUiSession(phone,{username,password},'FX-17 phone');await phone.locator('#assistant-view').waitFor({state:'visible'});await phone.evaluate(()=>document.getElementById('rail-memory').click());await phone.locator('#memory-view').waitFor({state:'visible'});await phone.getByText('有 1 条纠正没有生效',{exact:true}).click();await phone.screenshot({path:join(out,'rejected-phone.png')});}finally{await browser.close();}
    rejectCorrection=false;
    await page.getByRole('button',{name:'重试形成',exact:true}).click();
    await until(async()=>{const s=(await api('/memory/status')).body;return s.failedCorrectionCount===0&&s.pendingFormationCount===0;},420000);
    report.retryStatus=(await api('/memory/status')).body;
  }
  report.formalItems=(await api('/memory/items?kind=cognition')).body;
  report.sources=[];for(const item of report.formalItems.items??[])report.sources.push({id:item.id,...(await api(`/memory/items/cognition/${encodeURIComponent(item.id)}/sources`)).body});
  await page.evaluate(()=>document.getElementById('rail-memory').click());await page.locator('#memory-view').waitFor({state:'visible'});await pause(1500);
  await page.screenshot({path:join(out,'correction-memory.png')});
  for(const [index,item] of report.formalItems.items.entries()) {
    await page.getByRole('button').filter({hasText:item.text}).click();
    await page.locator('#memory-detail-dialog').waitFor({state:'visible'});
    await pause(500);await page.screenshot({path:join(out,`source-${index}.png`)});
    await page.getByRole('button',{name:'关闭记忆详情',exact:true}).click();
  }
  if(process.argv.includes('--full')) {
    const old=report.formalItems.items.filter(i=>i.currentState==='not_current'&&i.text.includes('肉桂粉'));
    const current=report.formalItems.items.filter(i=>i.currentState==='current');
    assert.equal(old.length,2,'preference and confirmed decision both replaced');
    assert.equal(current.length,1,'one shared successor');assert.match(current[0].text,/柠檬/);
    const unrelated={id:'fx17-unrelated-window',category:'memory',title:'Expire recent turn window',notes:'Ordinary unrelated turns, no memory setup',setup:{files:[],memories:[],devices:[]},turns:Array.from({length:34},(_,i)=>({user:`无关问题第${i+1}轮：${i+1}+1等于几？只回答数字，不调用工具。`})),checks:[{type:'turn_status',status:'completed'}],timeoutSec:1200};
    await runEvaluation({host:new URL(page.url()).origin,out:evaluation,model:'daily-local',scenarioList:[unrelated],onScenarioResult:r=>{report.turns.push(r);save();}});
    await until(async()=>{const s=(await api('/memory/status')).body;return s.pendingBoundaryCount===0&&s.pendingFormationCount===0;},420000);
    await app.close();await launch();
    await app.evaluate(async(_electron,key)=>globalThis.m2ExitSeedCredentials({'daily-local':key,'daily-second':key}),key);
    writeFileSync(join(evaluation,'credentials.json'),JSON.stringify({host:new URL(page.url()).origin,username,password,deviceName:'FX-17'}));report.hostRestart=true;
    while(!ownsLock){try{const fd=openSync(lockPath,'wx');try{writeFileSync(fd,lockToken+' '+new Date().toISOString())}finally{closeSync(fd)}ownsLock=true;}catch(error){if(error.code!=='EEXIST')throw error;if(Date.now()-statSync(lockPath).mtimeMs>10800000){rmSync(lockPath);continue;}console.log('FX-17 LAN occupied; retry in five minutes');await pause(300000);}}
    lockTimer=setInterval(()=>{if(readFileSync(lockPath,'utf8').startsWith(lockToken))utimesSync(lockPath,new Date(),new Date());},60000);
    const envValue=name=>execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`[Console]::Out.Write([Environment]::GetEnvironmentVariable('${name}','User'))`],{encoding:'utf8',windowsHide:true}).trim();
    const lanUrl=envValue('WEFTMATE_LAN_MODEL_BASE_URL'),lanKey=envValue('WEFTMATE_LAN_MODEL_KEY');secrets.push(lanUrl,lanKey,new URL(lanUrl).host);
    lan=await createLanBaselineBridge({baseUrl:lanUrl,key:lanKey});secrets.push(lan.token);await lan.warmup();
    const requestId=randomUUID();assert.equal((await api('/account/models',{requestId,name:'local-quality',baseUrl:lan.url,modelId:'local-quality',apiKey:lan.token})).status,202);
    assert.equal((await until(async()=>{const op=(await api(`/account/models/by-request/${requestId}`)).body.operation;return op&&!['pending','applying'].includes(op.status)&&op;})).status,'succeeded');
    const recall={id:'fx17-restarted-lan',category:'memory',title:'Durable corrected preference',notes:'After 34 unrelated turns and restart, another model',setup:{files:[],memories:[],devices:[]},turns:[{user:'我喝第903种花茶加什么？不要调用工具。'}],checks:[{type:'turn_status',status:'completed'},{type:'reply_contains',text:'柠檬'},{type:'memory_used'}],timeoutSec:420};
    await runEvaluation({host:new URL(page.url()).origin,out:evaluation,model:'local-quality',scenarioList:[recall],onScenarioResult:r=>{report.turns.push(r);save();assert.equal(r.status,'passed');assert.deepEqual(r.turns[0].memoryUsed.map(i=>i.id),[current[0].id]);}});
    report.lan=lan.metrics();await lan.close();lan=null;clearInterval(lockTimer);rmSync(lockPath);ownsLock=false;
  }
  await pause(3000);await snapshot('final');
  const db=join(profile,'personal-access/accounts',ownerId,'memory-home/memoweft/memoweft.sqlite3');
  if(existsSync(db))report.storage=JSON.parse(execFileSync(python,['-c',"import sqlite3,json,sys; c=sqlite3.connect(sys.argv[1]); print(json.dumps({t:c.execute('select count(*) from '+t).fetchone()[0] for t in ['evidence','interaction_context','memory_world_job','cognition']})); c.close()",db],{encoding:'utf8',windowsHide:true}));
}catch(error){report.error=safe(error.stack);process.exitCode=1;}finally{await app?.close();await lan?.close();clearInterval(lockTimer);if(ownsLock&&readFileSync(lockPath,'utf8').startsWith(lockToken))rmSync(lockPath);server.closeAllConnections();await new Promise(r=>server.close(r));writeFileSync(join(out,'host.log'),hostLog);save();}
console.log(JSON.stringify({revision:report.revision,error:report.error,turns:report.turns.length,storage:report.storage,out}));
