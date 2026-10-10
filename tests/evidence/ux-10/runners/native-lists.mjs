import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,appendFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { createPersonalAccessService } from '../../../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER,PERSONAL_HOST_MARKER_CONTENT } from '../../../../src/host-mode.mjs';
import { localUiSession } from '../../../../tests/helpers/local-ui-session.mjs';
const root=mkdtempSync('C:/Temp/weftmate-ux10-native-live-'),profile=join(root,'profile'),out=resolve(process.env.FX16_NATIVE_OUT||'tests/evidence/ux-10/performance');mkdirSync(profile);mkdirSync(out,{recursive:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
writeFileSync(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const credentials={username:'QA1Synthetic',password:`synthetic-${randomUUID()}-password`,deviceName:'QA1 desktop'};
const report={runnerPid:process.pid,startedAt:new Date().toISOString(),realMain:true,realDsh:true,syntheticModel:true,checks:[],errors:[]};
const save=()=>writeFileSync(join(out,'results.json'),JSON.stringify(report,null,2));
let calls=0,app,page;
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
const api=async(path,body,method=body?'POST':'GET')=>page.evaluate(async({path,body,method})=>{const me=await(await fetch('/personal/v1/auth/me')).json();const r=await fetch('/personal/v1'+path,{method,headers:{'content-type':'application/json','x-weftmate-csrf':me.csrfToken},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};},{path,body,method});
const shot=async(name)=>{await page.screenshot({path:join(out,name+'.png')});return 'desktop/'+name+'.png';};
async function check(name,fn){const t=Date.now();try{const detail=await fn();report.checks.push({name,status:'passed',durationMs:Date.now()-t,...detail});}catch(e){report.checks.push({name,status:'failed',durationMs:Date.now()-t,error:e.message,screenshot:await shot('failure-'+report.checks.length).catch(()=>null)});}save();}
 const preparation=await createPersonalAccessService({root:join(profile,'personal-access'),port:0,backend:Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(n=>[n,async()=>({})]))});const prepared=await preparation.start(),grant=await preparation.issueSetupGrant();await fetch(prepared.origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin:prepared.origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,...credentials})});await preparation.close();
try{
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:[resolve('tests/evidence/fx-16/runners/native-live-bootstrap.mjs'),`--user-data-dir=${profile}`,'--personal-host','--access-port=0'],env,timeout:90000});page=await app.firstWindow();page.setDefaultTimeout(30000);await page.waitForURL('**/personal/v1/ui');page.on('pageerror',e=>report.errors.push(e.message));
 report.requestCount=0;writeFileSync(join(out,'requests.jsonl'),'');page.on('requestfinished',async request=>{if(!request.url().includes('/personal/v1/'))return;const response=await request.response().catch(()=>null);report.requestCount++;appendFileSync(join(out,'requests.jsonl'),JSON.stringify({at:new Date().toISOString(),path:new URL(request.url()).pathname,method:request.method(),timing:request.timing(),status:response?.status()})+'\n');});
 await localUiSession(page,credentials,'Synthetic UI regression',{mainChat:true});await page.locator('#assistant-view').waitFor();
 await api('/account/models',{requestId:'qa1-stream',name:'合成验收模型',baseUrl:`http://127.0.0.1:${model.address().port}/v1`,modelId:'qa1-stream',apiKey:'qa1-synthetic'});
 await page.waitForFunction(async()=>{const r=await(await fetch('/personal/v1/account/models/by-request/qa1-stream')).json();return r.operation?.status==='succeeded';});await page.reload();await page.locator('#assistant-view').waitFor({state:'visible'});
 await app.evaluate(async({app},profile)=>{console.log('monitor-start');const {monitorEventLoopDelay}=process.getBuiltinModule('node:perf_hooks');const fs=process.getBuiltinModule('node:fs');globalThis.qa1={hist:monitorEventLoopDelay({resolution:20}),samples:[],writes:0,started:Date.now(),watchers:[]};const q=globalThis.qa1;q.exactWrites=0;const orig=fs.promises.rename;fs.promises.rename=async function(a,b,...rest){const result=await orig.call(this,a,b,...rest);if(String(b).replaceAll('\\','/').endsWith('/store.json'))q.exactWrites++;return result;};process.getBuiltinModule('node:module').syncBuiltinESMExports();q.hist.enable();q.timer=setInterval(()=>q.samples.push({at:Date.now(),rss:process.memoryUsage().rss,heapUsed:process.memoryUsage().heapUsed}),10000);q.samples.push({at:Date.now(),rss:process.memoryUsage().rss,heapUsed:process.memoryUsage().heapUsed});q.watchers.push(fs.watch(profile+'/personal-access',{recursive:true},(event,file)=>{if(file?.replaceAll('\\','/').endsWith('store.json'))q.writes++;}));},profile);

 await page.getByRole('button',{name:/^(新对话|新旁聊) Ctrl N$/,exact:true}).click();await page.waitForFunction(()=>!document.getElementById('message-text').disabled&&document.getElementById('operation-status').hidden);
 const own=(await api('/auth/me')).body.account.ownerId,modelId=(await api('/sessions')).body.sessions[0].modelProfileId;
 const p95=v=>[...v].sort((a,b)=>a-b)[Math.ceil(v.length*.95)-1];report.populations=[];
 let populated=1;
 for(const count of [500]){
  while(populated<count){const amount=Math.min(50,count-populated);await app.evaluate(async(_electron,input)=>globalThis.__fx16NativeCreate(input),{ownerId:own,modelProfileId:modelId,count:amount,offset:populated});populated+=amount;console.log('native seeded',populated);}
  await page.reload();await page.locator('#assistant-view').waitFor({state:'visible'});await page.waitForFunction(()=>globalThis.__WeftUiStarted===true);await page.locator('#session-list [data-session-id]').first().waitFor({timeout:90000});
  const times={sessions:[],chats:[]};for(let n=0;n<30;n++)for(const path of ['sessions','chats']){const t=performance.now();const r=await api('/'+path+'?archived=all&limit=100');assert.equal(r.status,200);times[path].push(performance.now()-t);assert.equal((r.body.sessions||r.body.items).length,100);}
  report.currentListMeasurement={count,sessionsP95Ms:p95(times.sessions),chatsP95Ms:p95(times.chats),samples:times};save();
  const creates=[];
  const row={count,nativeCreation:'real DSH Gateway session create; bulk synthetic account metadata; real production API/UI',sessionsP95Ms:p95(times.sessions),chatsP95Ms:p95(times.chats),createInputP95Ms:p95(creates),listSamples:times,createSamples:creates,renderedRows:await page.locator('#session-list [data-session-id]').count()};report.populations.push(row);save();await shot('native-'+count);console.log(JSON.stringify(row));
  if(count===500){assert.ok(row.sessionsP95Ms<150);assert.ok(row.chatsP95Ms<150);}
  populated+=10;
 }
 report.finishedAt=new Date().toISOString();save();
}catch(e){report.fatal=e.message;await shot('fatal').catch(()=>null);save();console.error(e.message);}finally{await app?.close();model.closeAllConnections();await new Promise(r=>model.close(r));report.cleaned=true;report.root='removed isolated UX10 profile';save();await import('node:fs/promises').then(fs=>fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:500}));if(report.fatal||report.checks.some(c=>c.status==='failed'))process.exitCode=1;}
