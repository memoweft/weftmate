import assert from 'node:assert/strict';
import { cpus } from 'node:os';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,appendFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { createPersonalAccessService } from '../../../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER,PERSONAL_HOST_MARKER_CONTENT } from '../../../../src/host-mode.mjs';
import { localUiSession } from '../../../../tests/helpers/local-ui-session.mjs';
const root=mkdtempSync('C:/Temp/weftmate-fx19-native-live-'),profile=join(root,'profile'),out=resolve(process.env.FX19_OUT||'tests/evidence/fx-19/profile-before');mkdirSync(profile);mkdirSync(out,{recursive:true});
const cpu=()=>cpus().reduce((r,c)=>({idle:r.idle+c.times.idle,total:r.total+Object.values(c.times).reduce((a,b)=>a+b,0)}),{idle:0,total:0});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
writeFileSync(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const credentials={username:'QA1Synthetic',password:`synthetic-${randomUUID()}-password`,deviceName:'QA1 desktop'};
const report={runnerPid:process.pid,startedAt:new Date().toISOString(),sourceVersion:process.env.FX19_VERSION||"working-tree",realMain:true,realDsh:true,syntheticModel:true,checks:[],errors:[]};
const save=()=>writeFileSync(join(out,'results.json'),JSON.stringify(report,null,2));
let calls=0,app,page,browser;
const model=createServer(async(req,res)=>{
 if(req.url==='/switch/status')return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({state:'ready',current_model:'qa1-stream',loading:false}));
 if(req.url==='/props')return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({n_ctx:131072,total_slots:1}));
 if(req.url.endsWith('/models'))return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({data:[{id:'qa1-stream',object:'model',context_window:131072}]}));
 if(!req.url.endsWith('/chat/completions'))return res.writeHead(404).end();
 let raw='';for await(const p of req)raw+=p;const input=JSON.parse(raw);calls++;
 if(!input.stream)return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({choices:[{message:{role:'assistant',content:'合成验收回复'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:10}}));
 res.writeHead(200,{'content-type':'text/event-stream'});
 for(let i=0;i<35;i++){if(res.destroyed)return;res.write(`data: ${JSON.stringify({id:'qa1-stream',object:'chat.completion.chunk',model:input.model,choices:[{index:0,delta:{role:'assistant',content:`合成连续使用验收，第 ${i+1} 行。\n\n`},finish_reason:null}]})}\n\n`);await pause(500);}
 res.end(`data: ${JSON.stringify({id:'qa1-stream',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:64000,completion_tokens:400,total_tokens:64400}})}\n\ndata: [DONE]\n\n`);
});await new Promise(r=>model.listen(0,'127.0.0.1',r));
const env={...process.env};for(const k of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(k)||['ELECTRON_RUN_AS_NODE','MIMO_API_KEY','MODEL_SWITCH_UNIFIED_KEY'].includes(k))delete env[k];
env.FX19_CHILD_TRACE=join(out,'native-stages.jsonl');
const api=async(path,body,method=body?'POST':'GET')=>page.evaluate(async({path,body,method})=>{const me=await(await fetch('/personal/v1/auth/me')).json();const r=await fetch('/personal/v1'+path,{method,headers:{'content-type':'application/json','x-weftmate-csrf':me.csrfToken},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};},{path,body,method});
const shot=async(name)=>{await page.screenshot({path:join(out,name+'.png')});return 'desktop/'+name+'.png';};
async function check(name,fn){const t=Date.now();try{const detail=await fn();report.checks.push({name,status:'passed',durationMs:Date.now()-t,...detail});}catch(e){report.checks.push({name,status:'failed',durationMs:Date.now()-t,error:e.message,screenshot:await shot('failure-'+report.checks.length).catch(()=>null)});}save();}
 const preparation=await createPersonalAccessService({root:join(profile,'personal-access'),port:0,backend:Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(n=>[n,async()=>({})]))});const prepared=await preparation.start(),grant=await preparation.issueSetupGrant();await fetch(prepared.origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin:prepared.origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,...credentials})});await preparation.close();
try{
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:[resolve('tests/evidence/fx-19/runners/bootstrap.mjs'),`--user-data-dir=${profile}`,'--personal-host','--access-port=0'],env,timeout:90000});page=await app.firstWindow();page.setDefaultTimeout(30000);await page.waitForURL('**/personal/v1/ui');page.on('pageerror',e=>report.errors.push(e.message));
 report.requestCount=0;writeFileSync(join(out,'requests.jsonl'),'');page.on('requestfinished',async request=>{if(!request.url().includes('/personal/v1/'))return;const response=await request.response().catch(()=>null);report.requestCount++;appendFileSync(join(out,'requests.jsonl'),JSON.stringify({at:new Date().toISOString(),path:new URL(request.url()).pathname,method:request.method(),timing:request.timing(),status:response?.status()})+'\n');});
 await localUiSession(page,credentials,'Synthetic UI regression',{mainChat:true});await page.locator('#assistant-view').waitFor();
 await api('/account/models',{requestId:'qa1-stream',name:'合成验收模型',baseUrl:`http://127.0.0.1:${model.address().port}/v1`,modelId:'qa1-stream',apiKey:'qa1-synthetic'});
 await page.waitForFunction(async()=>{const r=await(await fetch('/personal/v1/account/models/by-request/qa1-stream')).json();return r.operation?.status==='succeeded';});await page.reload();await page.locator('#assistant-view').waitFor({state:'visible'});
 await app.evaluate(async({app},profile)=>{console.log('monitor-start');const {monitorEventLoopDelay}=process.getBuiltinModule('node:perf_hooks');const fs=process.getBuiltinModule('node:fs');globalThis.qa1={hist:monitorEventLoopDelay({resolution:20}),samples:[],writes:0,started:Date.now(),watchers:[]};const q=globalThis.qa1;q.exactWrites=0;const orig=fs.promises.rename;fs.promises.rename=async function(a,b,...rest){const result=await orig.call(this,a,b,...rest);if(String(b).replaceAll('\\','/').endsWith('/store.json'))q.exactWrites++;return result;};process.getBuiltinModule('node:module').syncBuiltinESMExports();q.hist.enable();q.timer=setInterval(()=>q.samples.push({at:Date.now(),rss:process.memoryUsage().rss,heapUsed:process.memoryUsage().heapUsed}),10000);q.samples.push({at:Date.now(),rss:process.memoryUsage().rss,heapUsed:process.memoryUsage().heapUsed});q.watchers.push(fs.watch(profile+'/personal-access',{recursive:true},(event,file)=>{if(file?.replaceAll('\\','/').endsWith('store.json'))q.writes++;}));},profile);

 await page.getByRole('button',{name:/^(新对话|新旁聊)(\s*Ctrl N)?$/,exact:true}).click();await page.waitForFunction(()=>!document.getElementById('message-text').disabled&&document.getElementById('operation-status').hidden);
 const own=(await api('/auth/me')).body.account.ownerId,modelId=(await api('/sessions')).body.sessions[0].modelProfileId;
 const p95=v=>[...v].sort((a,b)=>a-b)[Math.ceil(v.length*.95)-1];report.populations=[]; const stats=v=>{const sorted=[...v].sort((a,b)=>a-b);return {p50:sorted[Math.ceil(v.length*.5)-1],p95:p95(v),max:Math.max(...v),over1000:v.map(ms=>ms>1000),count:v.length};};
 let populated=1;
 for(const count of (process.env.FX19_COUNTS||'100,500,2000').split(',').map(Number)){
  while(populated<count){const amount=Math.min(250,count-populated);await app.evaluate(async(_electron,input)=>globalThis.__fx16NativeCreate(input),{ownerId:own,modelProfileId:modelId,count:amount,offset:populated});populated+=amount;console.log('native seeded',populated);}
  await page.reload();await page.locator('#assistant-view').waitFor({state:'visible'});await page.waitForFunction(()=>globalThis.__WeftUiStarted===true);
  const listCpuBefore=cpu(); const times={sessions:[],chats:[]};for(let n=0;n<30;n++)for(const path of ['sessions','chats']){const t=performance.now();const r=await api('/'+path+'?archived=all&limit=100');assert.equal(r.status,200);times[path].push(performance.now()-t);assert.equal((r.body.sessions||r.body.items).length,100);}
  const listCpuAfter=cpu(); report.currentListMeasurement={count,sessionsP95Ms:p95(times.sessions),chatsP95Ms:p95(times.chats),samples:times};save();
  if(process.env.FX19_PROFILE_CPU)await app.evaluate(()=>globalThis.__fx19Child.send({fx19:'profile-start'})); const cpuBefore=cpu(); await app.evaluate(()=>{globalThis.__fx19Trace=[];}); const creates=[];for(let n=0;n<Number(process.env.FX19_CREATES||3);n++){const prior=await page.evaluate(()=>document.querySelector('#session-list [data-session-id]:has(button.is-current)')?.dataset.sessionId??null);const t=performance.now();await page.evaluate(()=>{globalThis.__fx19Click=null;document.addEventListener('click',()=>{globalThis.__fx19Click=performance.now();},{once:true,capture:true});});await page.getByRole('button',{name:/^(新对话|新旁聊)(\s*Ctrl N)?$/,exact:true}).click();await page.waitForFunction(prior=>{const row=document.querySelector('#session-list [data-session-id]:has(button.is-current)');return row&&row.dataset.sessionId!==prior&&!document.getElementById('message-text').disabled;},prior);creates.push(await page.evaluate(()=>performance.now()-globalThis.__fx19Click)); console.log('create',count,n,creates.at(-1)); await page.locator('#message-text').fill('合成可发送检验'); assert.equal(await page.locator('#send-message').isEnabled(),true); await page.locator('#message-text').fill('');await pause(250);}
  const switches=[];const ids=await page.locator('#session-list [data-session-id]').evaluateAll(rows=>rows.slice(0,2).map(row=>row.dataset.sessionId));
  for(let n=0;n<Number(process.env.FX19_SWITCHES||3);n++){const id=ids[(n+1)%2],t=performance.now();await page.evaluate(()=>{globalThis.__fx19Click=null;document.addEventListener('click',()=>{globalThis.__fx19Click=performance.now();},{once:true,capture:true});});await page.locator(`[data-session-id="${id}"] > button`).first().click();await page.waitForFunction(id=>document.querySelector(`[data-session-id="${id}"] > button`)?.classList.contains('is-current')&&!document.getElementById('message-text').disabled,id);switches.push(await page.evaluate(()=>performance.now()-globalThis.__fx19Click));console.log('switch',count,n,switches.at(-1));await pause(250);}
  if(process.env.FX19_PROFILE_CPU){await app.evaluate(()=>globalThis.__fx19Child.send({fx19:'profile-stop'}));await pause(500);} const cpuAfter=cpu(); const trace=await app.evaluate(()=>globalThis.__fx19Trace); writeFileSync(join(out,'trace-'+count+'.json'),JSON.stringify(trace,null,2)); const stages={};for(const v of trace){(stages[v.stage]??=[]).push(v.ms);} const row={count,metrics:{create:stats(creates),switch:stats(switches),sessions:stats(times.sessions),chats:stats(times.chats)},listCpuPercent:100*(1-(listCpuAfter.idle-listCpuBefore.idle)/(listCpuAfter.total-listCpuBefore.total)),cpuPercent:100*(1-(cpuAfter.idle-cpuBefore.idle)/(cpuAfter.total-cpuBefore.total)),stages:Object.fromEntries(Object.entries(stages).map(([k,v])=>[k,{count:v.length,sum:v.reduce((a,b)=>a+b,0),p95:p95(v),max:Math.max(...v)}])),nativeCreation:'real DSH Gateway session create; bulk synthetic account metadata; real production API/UI',sessionsP95Ms:p95(times.sessions),chatsP95Ms:p95(times.chats),createInputP95Ms:p95(creates),switchInputP95Ms:p95(switches),switchSamples:switches,listSamples:times,createSamples:creates,renderedRows:await page.locator('#session-list [data-session-id]').count()};report.populations.push(row);save();await shot('native-'+count);console.log(JSON.stringify({count,cpu:row.cpuPercent,create:row.createInputP95Ms,switch:row.switchInputP95Ms}));
  
  populated+=creates.length;
 }
 if(process.env.FX19_PHONE){
  browser=await chromium.launch({channel:'msedge'});const phone=await browser.newPage({viewport:{width:390,height:844}});
  await phone.goto(new URL(page.url()).origin+'/personal/v1/ui');await localUiSession(phone,credentials,'FX19 synthetic phone',{mainChat:true});await phone.waitForFunction(()=>globalThis.__WeftUiStarted===true);
  const samples=[],before=cpu();for(let n=0;n<10;n++){
   const create=phone.getByRole('button',{name:/^(新对话|新旁聊)(\s*Ctrl N)?$/,exact:true});if(!await create.isVisible())await phone.getByRole('button',{name:'切换会话侧栏',exact:true}).click();
   const prior=await phone.evaluate(()=>document.querySelector('#session-list [data-session-id]:has(button.is-current)')?.dataset.sessionId);
   await phone.evaluate(()=>{document.addEventListener('click',()=>globalThis.__fx19Click=performance.now(),{once:true,capture:true})});await create.click();
   await phone.waitForFunction(prior=>{const row=document.querySelector('#session-list [data-session-id]:has(button.is-current)');return row&&row.dataset.sessionId!==prior&&!document.getElementById('message-text').disabled},prior);
   samples.push(await phone.evaluate(()=>performance.now()-globalThis.__fx19Click));await phone.locator('#message-text').fill('手机首次草稿保留');assert.equal(await phone.locator('#send-message').isEnabled(),true);await pause(100);assert.equal(await phone.locator('#message-text').inputValue(),'手机首次草稿保留');await phone.locator('#message-text').fill('');console.log('phone-create',n,samples.at(-1));
  }
  const after=cpu();report.phone={width:390,height:844,population:populated,samples,metrics:stats(samples),cpuPercent:100*(1-(after.idle-before.idle)/(after.total-before.total)),firstDraftLostCharacters:0};await phone.screenshot({path:join(out,'phone-web-390.png')});await browser.close();browser=null;save();
 }
 report.finishedAt=new Date().toISOString();save();
}catch(e){report.fatal=e.message;await shot('fatal').catch(()=>null);save();console.error(e.message);}finally{await browser?.close();await app?.close();model.closeAllConnections();await new Promise(r=>model.close(r));report.cleaned=true;report.root='removed isolated FX19 profile';save();await import('node:fs/promises').then(fs=>fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:500}));if(report.fatal||report.checks.some(c=>c.status==='failed'))process.exitCode=1;}
