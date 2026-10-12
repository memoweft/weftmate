process.env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
import assert from 'node:assert/strict';
import {_electron} from 'playwright';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createPersonalAccessService} from '../../src/personal-access/index.mjs';
import {PERSONAL_HOST_MARKER,PERSONAL_HOST_MARKER_CONTENT} from '../../src/host-mode.mjs';
import {localUiSession} from '../helpers/local-ui-session.mjs';
import {generateHealthV3Sequence} from '../helpers/health-sequence.mjs';
import {redactEvidenceText,systemCommitMemory,describeExit} from '../helpers/process-evidence.mjs';
const repo=resolve(import.meta.dirname,'../..'),out=join(repo,'tests/evidence/health-5'),root=await mkdtemp(join(tmpdir(),'weftmate-health5-electron-')),profile=join(root,'profile'),startedAt=new Date().toISOString();
await mkdir(out,{recursive:true});await mkdir(profile);await writeFile(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const key=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"[Console]::Out.Write([Environment]::GetEnvironmentVariable('MIMO_API_KEY','Machine'))"],{encoding:'utf8',windowsHide:true}).trim();assert.ok(key,'Machine MIMO_API_KEY is required');
const credentials={username:'health5-synthetic',password:'synthetic-'+randomUUID(),deviceName:'Synthetic health test'};
const prep=await createPersonalAccessService({root:join(profile,'personal-access'),port:0,backend:Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(n=>[n,async()=>({})]))});
try{const {origin}=await prep.start(),grant=await prep.issueSetupGrant(),r=await fetch(origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,...credentials})});assert.equal(r.status,201);}finally{await prep.close();}
const env={...process.env};for(const name of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(name)||['ELECTRON_RUN_AS_NODE','MIMO_API_KEY','MODEL_SWITCH_UNIFIED_KEY'].includes(name))delete env[name];
Object.assign(env,{WEFTMATE_TEST_HOST_NAME:'synthetic-host',WEFTMATE_BASELINE_TRACE:join(root,'requests.jsonl')});
let app,page,ownerId,modelId,stage='launch',log='';const report={startedAt,realElectron:true,realNativeDSH:true,syntheticOnly:true,model:'mimo-v2.6-flash',mimoRequests:0,itemAnalysisRequests:0,topInsightRequests:0,checks:[],screenshots:[],errors:[],cleanedProcesses:0};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,timeout=120000){stage=label;console.log('Health-5 stage: '+label);const end=Date.now()+timeout;while(Date.now()<end){const result=await fn();if(result)return result;await pause(200);}throw Error('Health-5 timeout: '+label);}
const api=async(path,body,method=body?'POST':'GET')=>page.evaluate(async({path,body,method})=>{const me=await fetch('/personal/v1/auth/me').then(r=>r.json()),r=await fetch('/personal/v1'+path,{method,headers:{'content-type':'application/json','x-weftmate-csrf':me.csrfToken},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};},{path,body,method});
async function shot(name){await page.screenshot({path:join(out,name)});report.screenshots.push(name);}
try{
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:repo,args:[join(repo,'tests/integration/health-2-bootstrap.mjs'),'--user-data-dir='+profile,'--personal-host','--access-port=0','--force-device-scale-factor=1'],env,timeout:90000});
 const capture=v=>log+=redactEvidenceText(String(v).replaceAll(key,'[private]'),[root]);app.process().stdout?.on('data',capture);app.process().stderr?.on('data',capture);
 page=await app.firstWindow({timeout:90000});page.setDefaultTimeout(30000);page.on('pageerror',e=>report.errors.push(redactEvidenceText(e.message)));await page.waitForURL('**/personal/v1/ui');await localUiSession(page,credentials,'Health-5',{mainChat:true});await page.locator('#assistant-view').waitFor({state:'visible'});
 const status=(await api('/status')).body;ownerId=status.ownerId;
 await app.evaluate(()=>{const c=globalThis.health2.context,original=c.backend.modelCompletion;globalThis.health5ItemCalls=0;globalThis.health5TopCalls=0;c.backend.modelCompletion=async input=>{const text=input.body.messages?.[0]?.content??'',item=text.startsWith('根据这一项'),top=text.startsWith('根据所给汇总数字');if(item)globalThis.health5ItemCalls++;if(top)globalThis.health5TopCalls++;if(item){const summary=input.body.messages[1].content;if(/hrvSamples|heartRateQuarterHourly|heartRateHourly|stages|SYNTHETIC PRIVATE BODY|conversations|memory/.test(summary))throw Error('HEALTH_ITEM_PRIVACY');}const response=await original(input);if(item)globalThis.health5LastCompletion={status:response.status,body:await response.clone().json()};return response;};});
 const requestId=randomUUID();assert.equal((await api('/account/models',{requestId,name:'Synthetic MiMo',baseUrl:'https://api.xiaomimimo.com/v1',modelId:'mimo-v2.6-flash',apiKey:key})).status,202);
 await until(async()=>{const op=(await api('/account/models/by-request/'+requestId)).body.operation;if(op?.status==='failed')throw Error('Model setup failed');return op?.status==='succeeded';},'configure synthetic MiMo');modelId=(await api('/models')).body.models.find(r=>r.name==='Synthetic MiMo').id;
 await api('/settings/models',{backgroundModelProfileId:modelId,defaultModelProfileId:modelId},'PATCH');await api('/settings/usage',{timeZone:'Asia/Shanghai'},'PATCH');await api('/settings/notifications',{reviewEnabled:false},'PATCH');
 assert.equal((await api('/settings/health')).body.settings.modelInsightsEnabled,true);assert.equal((await api('/settings/health')).body.settings.itemAnalysisEnabled,false);await api('/settings/health',{modelInsightsEnabled:false},'PATCH');
 const to=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),data=generateHealthV3Sequence({to});
 assert.equal((await api('/health/profile',data.profile,'PUT')).status,200);assert.equal((await api('/health/records/batch',{items:data.items},'PUT')).status,200);
 const overview=(await api('/health/overview')).body;assert.deepEqual(overview.capabilities,{record:3,profile:true});for(const id of ['stress','energy','fitnessAge'])assert.ok(overview[id]&&overview[id].state!=='insufficient',id);assert.equal(overview.energy.curve.length,96);assert.ok(overview.energy.sleepPeriods.length);assert.ok(overview.fitnessAge.referenceRange);report.overview=overview;report.checks.push('90-day-v3-real-host-overview-profile-and-incremental-fields');
 const off=await api('/health/analysis',{scope:'stress',day:to});assert.equal(off.status,409);assert.equal(off.body.error.code,'AI_ANALYSIS_OFF');assert.equal(await app.evaluate(()=>globalThis.health5ItemCalls),0);report.checks.push('off-409-and-zero-item-model-requests');
 stage='single-item-real-MiMo';await api('/settings/health',{itemAnalysisEnabled:true},'PATCH');const generated=await api('/health/analysis',{scope:'stress',day:to});assert.equal(generated.status,200);assert.equal(generated.body.mode,'model',JSON.stringify(generated.body));report.itemAnalysis=generated.body;const count=await app.evaluate(()=>globalThis.health5ItemCalls);assert.equal(count,1);assert.deepEqual((await api('/health/analysis',{scope:'stress',day:to})).body,generated.body);assert.equal(await app.evaluate(()=>globalThis.health5ItemCalls),count);assert.equal((await api('/health/analysis?day='+to)).body.items.length,1);report.checks.push('real-mimo-item-analysis-one-request-and-cache-hit');
 const main=(await api('/chats/main')).body.chat;
 for(const [index,question]of ['我今天压力大吗','我的体能年龄是多少'].entries()){
   const before=main.activeSessionId?(await api('/sessions/'+main.activeSessionId+'/events?limit=100')).body.events??[]:[],after=before.at(-1)?.seq??-1;
   const created=await api('/commands',{requestId:randomUUID(),kind:'chat.message',chatId:main.chatId,targetDeviceId:status.hostId,modelProfileId:modelId,text:question,mode:'queue'});assert.equal(created.status,202);
   const accepted=await until(async()=>{const r=(await api('/commands/'+created.body.command.commandId)).body.command;if(['rejected','uncertain'].includes(r.state))throw Error(r.errorCode??r.state);return r.state==='accepted_by_dsh'&&r;},'main question '+index);
   const events=await until(async()=>{const r=(await api('/sessions/'+accepted.sessionId+'/events?afterSeq='+after+'&limit=100')).body.events??[];return r.some(e=>e.type==='turn.ended')&&r;},'native health answer '+index,180000);
   assert.ok(events.some(e=>e.type==='step.started'&&e.data?.toolName==='health_query'),JSON.stringify(events.map(e=>({type:e.type,name:e.data?.toolName}))));assert.ok(events.some(e=>e.type==='step.completed'&&e.data?.toolName==='health_query'&&e.data?.state==='completed'));
   const reply=events.filter(e=>e.type==='assistant.message').map(e=>e.data.text).join('\n');assert.match(reply,index===0?/压力|测量/:/体能|年龄/);report['question'+index]={question,tool:'health_query',reply};report.checks.push('native-query-before-answer-'+index);
   main.activeSessionId=accepted.sessionId;
   await page.getByRole('button',{name:/^WeftMate/}).first().click();await until(async()=>await page.locator('#assistant-view').innerText().then(t=>t.replace(/\s+/g,'').includes(reply.replace(/[*_#]/g,'').replace(/\s+/g,'').slice(0,24))),'visible reply '+index);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1200,900));
   for(const theme of ['light','dark']){await page.evaluate(t=>{document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;},theme);await pause(200);await shot('electron-1200-'+theme+'-'+(index===0?'stress':'fitness-age')+'.png');}
 }
 await page.keyboard.press('Control+,');await page.getByRole('button',{name:'通知',exact:true}).click();await page.getByRole('switch',{name:'各项 AI 分析',exact:true}).waitFor();await page.waitForFunction(()=>!document.getElementById('health-itemAnalysisEnabled').disabled);
 for(const theme of ['light','dark']){await page.evaluate(t=>{document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;},theme);await page.getByRole('switch',{name:'各项 AI 分析',exact:true}).scrollIntoViewIfNeeded();await shot('electron-1200-'+theme+'-settings.png');}
 await page.getByRole('switch',{name:'各项 AI 分析',exact:true}).uncheck();await page.waitForFunction(()=>!document.getElementById('health-itemAnalysisEnabled').disabled);assert.equal((await api('/health/analysis',{scope:'energy',day:to})).status,409);assert.equal((await api('/settings/health')).body.settings.modelInsightsEnabled,false);report.checks.push('shared-setting-toggle-and-independent-top-state');
 report.itemAnalysisRequests=await app.evaluate(()=>globalThis.health5ItemCalls);report.topInsightRequests=await app.evaluate(()=>globalThis.health5TopCalls);assert.deepEqual(report.errors,[]);report.completed=true;
}catch(error){report.completed=false;report.failure=redactEvidenceText(String(error.message).replaceAll(key,'[private]'),[root]);report.lastCompletion=app?await app.evaluate(()=>globalThis.health5LastCompletion??null).catch(()=>null):null;report.lastStage=stage;report.commitMemory=systemCommitMemory();report.electronExit=app?describeExit(app.process().exitCode,app.process().signalCode):null;report.logTail=log.slice(-5000);if(page&&!page.isClosed())await shot('failure-electron.png');throw error;}
finally{
 const trace=await readFile(join(root,'requests.jsonl'),'utf8').catch(()=> '');report.mimoRequests=trace.split('\n').filter(Boolean).map(JSON.parse).filter(r=>r.kind==='model'&&r.phase==='start'&&r.origin==='https://api.xiaomimimo.com').length;
 if(app){report.itemAnalysisRequests=await app.evaluate(()=>globalThis.health5ItemCalls??0).catch(()=>report.itemAnalysisRequests);await app.close();report.cleanedProcesses++;}await rm(root,{recursive:true,force:true});await writeFile(join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');
}
