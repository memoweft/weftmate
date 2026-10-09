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
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
import { runEvaluation } from '../../scripts/eval.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
const arg = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name)+1] : fallback;
const repository = resolve(arg('--repo', join(import.meta.dirname,'../..')));
const out = resolve(arg('--out','tests/evidence/mem-d/before-main'));
const core = resolve(arg('--core','C:/Temp/weftmate-mem-d-core/py/src'));
const python = 'D:/AIProjects/MemoWeft/Core/py/.venv/Scripts/python.exe';
const root = mkdtempSync(join(tmpdir(),'weftmate-mem-d-')), profile = join(root,'profile'), evaluation = join(root,'eval');
mkdirSync(out,{recursive:true}); mkdirSync(profile); mkdirSync(evaluation);
const real = arg('--model','synthetic') === 'mimo';
const key = real ? execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"[Console]::Out.Write([Environment]::GetEnvironmentVariable('MIMO_API_KEY','Machine'))"],{encoding:'utf8',windowsHide:true}).trim() : 'mem-d-synthetic';
const report = {revision:execFileSync('git',['rev-parse','HEAD'],{cwd:repository,encoding:'utf8'}).trim(),model:real?'mimo':'synthetic',startedAt:new Date().toISOString(),turns:[],requests:[],snapshots:[]};
const safe = text => String(text).replaceAll(key,'[private]');
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
    let payload;try{payload=JSON.parse(last);}catch{}
    const formation=Array.isArray(payload?.evidence);record.formation=formation;
    if(formation && report.requests.filter(r=>r.formation).length===1 && !real){record.status=503;res.writeHead(503).end('{}');return;}
    let body;
    if(real){const upstream=await fetch('https://api.xiaomimimo.com/v1/chat/completions',{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify({...input,model:'mimo-v2.6-flash',stream:false,stream_options:undefined}),signal:AbortSignal.timeout(180000)});body=await upstream.json();record.status=upstream.status;record.usage=body.usage??null;}
    else {const e=payload?.evidence?.[0];const content=formation?JSON.stringify({schema_version:8,result:'cognitions',cognitions:[{action:'form',target:'owner_self',statement_kind:'preference',formed_by:'stated',proposition:e.text,supports:e.segments.map(s=>({evidence_id:e.id,segment_id:s.id}))}]}):'收到，我理解了。';body={id:`chat-${count}`,object:'chat.completion',choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}};record.status=200;}
    res.statusCode=record.status;
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
  if(process.argv.includes('--backfill'))await app.evaluate(()=>{globalThis.memDNoCapture=true;globalThis.memDDropIngest=true;});
  for(let group=0;group<Number(arg('--groups',3));group++){
    if(process.argv.includes('--faults')) await app.evaluate((_electron, group)=>{globalThis.memDNoRoute=group===1;globalThis.memDBusy=group===2;globalThis.memDDropIngest=group===3; if(group===4)globalThis.m2ExitBreakCore();},group);
    const scenario={id:`memd-${group}`,category:'memory',title:'Daily conversations',notes:'Synthetic daily preferences',setup:{files:[],memories:[],devices:[]},turns:Array.from({length:Number(arg('--turns',2))},(_,i)=>({user:`我喝第${group*10+i+1}种花茶时偏好加一小撮肉桂粉。请简短回复收到，不调用工具。`})),checks:[{type:'turn_status',status:'completed'}],timeoutSec:180};
    await runEvaluation({host:new URL(page.url()).origin,out:evaluation,model:group%2?'daily-second':'daily-local',scenarioList:[scenario],onScenarioResult:r=>{report.turns.push(r);save();}});
    await pause(1000);await snapshot(`group-${group}`);
    if(process.argv.includes('--restart')&&group===2){await app.close();await launch();writeFileSync(join(evaluation,'credentials.json'),JSON.stringify({host:new URL(page.url()).origin,username,password,deviceName:'MEM-D',provisioned:true}));await app.evaluate(async(_electron,key)=>globalThis.m2ExitSeedCredentials({'daily-local':key,'daily-second':key}),key);report.hostRestart=true;await pause(5000);await snapshot('host-restarted');}
    if(process.argv.includes('--faults')){await app.evaluate(()=>{globalThis.memDNoRoute=false;globalThis.memDBusy=false;globalThis.memDDropIngest=false;globalThis.m2ExitRestoreCore();});await pause(4000);await snapshot(`recovered-${group}`);}
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
  if(process.argv.includes('--verify')) {
    assert.ok(report.turns.every(r=>r.status==='passed'), 'every planned daily turn completes');
    await until(async()=>{const s=(await api('/memory/status')).body;return s.pendingBoundaryCount===0&&s.pendingFormationCount===0;},420000);
    const items=(await api('/memory/items?kind=cognition')).body.items;assert.ok(items.length);report.formalItems=items;
    report.sources=(await api(`/memory/items/cognition/${encodeURIComponent(items[0].id)}/sources`)).body.sources;
    assert.ok(report.sources.some(s=>s.rawContent?.includes('花茶')));
    await page.evaluate(()=>document.getElementById('rail-memory').click());await page.locator('#memory-view').waitFor({state:'visible'});await pause(3500);
    await page.screenshot({path:join(out,'memory-desktop-light.png')});
    await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.screenshot({path:join(out,'memory-desktop-dark.png')});
    const browser=await chromium.launch({headless:true,channel:'msedge'});try{const phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,deviceScaleFactor:1});await phone.goto(new URL(page.url()).origin+'/personal/v1/ui');await localUiSession(phone,{username,password},'MEM-D phone');await phone.locator('#assistant-view').waitFor({state:'visible'});await phone.evaluate(()=>document.getElementById('rail-memory').click());await phone.locator('#memory-view').waitFor({state:'visible'});await pause(3500);await phone.screenshot({path:join(out,'memory-phone.png')});}finally{await browser.close();}
  }
  await pause(3000);await snapshot('final');
  const db=join(profile,'personal-access/accounts',ownerId,'memory-home/memoweft/memoweft.sqlite3');
  if(existsSync(db))report.storage=JSON.parse(execFileSync(python,['-c',"import sqlite3,json,sys; c=sqlite3.connect(sys.argv[1]); print(json.dumps({t:c.execute('select count(*) from '+t).fetchone()[0] for t in ['evidence','interaction_context','memory_world_job','cognition']})); c.close()",db],{encoding:'utf8',windowsHide:true}));
}catch(error){report.error=safe(error.stack);process.exitCode=1;}finally{await app?.close();server.closeAllConnections();await new Promise(r=>server.close(r));writeFileSync(join(out,'host.log'),hostLog);save();}
console.log(JSON.stringify({revision:report.revision,error:report.error,turns:report.turns.length,storage:report.storage,out}));
