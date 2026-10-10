import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createPersonalAccessService } from '../../../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER,PERSONAL_HOST_MARKER_CONTENT } from '../../../../src/host-mode.mjs';
import { localUiSession } from '../../../helpers/local-ui-session.mjs';
export const pause=ms=>new Promise(r=>setTimeout(r,ms));
export async function until(fn,ms=90000){const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await pause(250);}throw Error('QA5_WAIT_TIMEOUT');}
export async function harness(name,{mimo=false,installed=null,sourceRepository=null}={}){
 const root=mkdtempSync(join(tmpdir(),'weftmate-fx18-'+name+'-')),profile=join(root,'profile'),out=resolve('tests/evidence/fx-18',name);mkdirSync(profile);mkdirSync(out,{recursive:true});
 const h={root,profile,out,sourceRepository,requests:[],formationActive:0,chatActive:0,formationDelay:0,chatDelay:0,app:null,page:null};
 writeFileSync(join(out,'run-root.txt'),root);writeFileSync(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
 const key=mimo?execFileSync('powershell.exe',['-NoProfile','-Command',"[Console]::Out.Write([Environment]::GetEnvironmentVariable('MIMO_API_KEY','Machine'))"],{encoding:'utf8',windowsHide:true}).trim():'qa5-synthetic';
 const server=createServer(async(req,res)=>{try{
  if(req.url.endsWith('/models'))return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({data:[{id:'qa5-model',context_window:131072}]}));
  if(req.url==='/props')return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({total_slots:1,n_ctx:131072}));
  if(req.url==='/switch/status')return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({currentModelId:'qa5-model',switching:false,probe:{health:true}}));
  let raw='';for await(const b of req)raw+=b;const input=JSON.parse(raw);
  const payload=input.messages?.map(m=>{try{return JSON.parse(m.content)}catch{return null}}).find(m=>Array.isArray(m?.evidence));
  const formation=!!payload;const record={at:new Date().toISOString(),formation,stream:!!input.stream};h.requests.push(record);h[formation?'formationActive':'chatActive']++;
  try{
   if(formation){await pause(h.formationDelay);if(h.formationGate)await h.formationGate;}
   let body;
   if(mimo){const upstream=await fetch('https://api.xiaomimimo.com/v1/chat/completions',{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify({...input,model:'mimo-v2.6-flash',stream:false,stream_options:undefined}),signal:AbortSignal.timeout(180000)});record.status=upstream.status;body=await upstream.json();}
   else {const e=payload?.evidence?.[0];body={id:randomUUID(),choices:[{message:{role:'assistant',content:formation?JSON.stringify({schema_version:8,result:'cognitions',cognitions:[{action:'form',target:'owner_self',statement_kind:'preference',formed_by:'stated',proposition:e.text,supports:e.segments.map(s=>({evidence_id:e.id,segment_id:s.id}))}]}):'收到这条合成偏好，稍后整理进记忆。'},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}};record.status=200;}
   record.usage=body.usage??null;res.statusCode=record.status;
   if(input.stream&&record.status===200){res.setHeader('content-type','text/event-stream');res.write(`data: ${JSON.stringify({id:body.id,choices:[{index:0,delta:body.choices[0].message,finish_reason:null}]})}\n\n`);await pause(h.chatDelay);res.end(`data: ${JSON.stringify({id:body.id,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:body.usage})}\n\ndata: [DONE]\n\n`);}else res.end(JSON.stringify(body));
  }finally{h[formation?'formationActive':'chatActive']--;writeFileSync(join(out,'usage.json'),JSON.stringify({mimo,requests:h.requests},null,2));}
 }catch(e){res.statusCode=503;res.end('{}');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/v1`;
 h.credentials={username:'qa5-'+randomUUID(),password:'synthetic-'+randomUUID(),deviceName:'QA5 desktop'};
 const prepareService=sourceRepository?(await import(pathToFileURL(join(sourceRepository,'src/personal-access/index.mjs')).href)).createPersonalAccessService:createPersonalAccessService;
 const prep=await prepareService({root:join(profile,'personal-access'),port:0,backend:Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(k=>[k,async()=>({})]))});const prepared=await prep.start(),grant=await prep.issueSetupGrant();
 assert.equal((await fetch(prepared.origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin:prepared.origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,...h.credentials})})).status,201);await prep.close();
 const config=join(root,'memory.json');writeFileSync(config,JSON.stringify({python:'D:/AIProjects/MemoWeft/Core/py/.venv/Scripts/python.exe',pythonPath:process.env.FX18_CORE_SOURCE || 'D:/AIProjects/MemoWeft/Worktrees/fx-18-formation-recovery/py/src',baseUrl:base,model:'@current',authRef:'qa5-unselected'}));
 const desktopConfig=join(root,'desktop-config.json');writeFileSync(desktopConfig,JSON.stringify({schemaVersion:1,dataDirectory:profile,accessPort:0,personalMemoryConfig:config,updates:{channel:'preview'}}));
 const env={...process.env};for(const k of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_|MIMO_API_KEY|MODEL_SWITCH_UNIFIED_KEY|ELECTRON_RUN_AS_NODE)/.test(k))delete env[k];
 env.WEFTMATE_BASELINE_TRACE=join(root,'trace.jsonl');
 h.launch=async()=>{
  const launchStart=Date.now();h.app=await _electron.launch({executablePath:installed||createRequire(import.meta.url)('electron'),args:installed?[`--desktop-config=${desktopConfig}`]:[h.sourceRepository||resolve('tests/integration/m2-exit-bootstrap.mjs'),`--user-data-dir=${profile}`,'--personal-host','--access-port=0',`--personal-memory-config=${config}`],cwd:h.sourceRepository||resolve('.'),env,timeout:installed?600000:90000});
  h.launchMs=Date.now()-launchStart;
  if(h.modelId&&!installed&&!h.sourceRepository)await h.app.evaluate(async(_electron,key)=>globalThis.m2ExitSeedCredentials({'QA5 model':key}),'qa5-local-proxy');
  h.credentialsRestoredAt=new Date().toISOString();
  h.page=await h.app.firstWindow();h.page.setDefaultTimeout(30000);await h.page.waitForURL('**/personal/v1/ui*');await localUiSession(h.page,h.credentials,'QA5',{mainChat:!h.sourceRepository});await h.page.locator('#assistant-view').waitFor({state:'visible'});
  await h.app.evaluate(({Tray})=>{const old=Tray.prototype.setContextMenu;Tray.prototype.setContextMenu=function(menu){globalThis.qa5Tray=menu;return old.call(this,menu);};});
  h.origin=new URL(h.page.url()).origin;
 };
 h.api=(path,body,method=body?'POST':'GET')=>h.page.evaluate(async({path,body,method})=>{const me=await(await fetch('/personal/v1/auth/me')).json();const r=await fetch('/personal/v1'+path,{method,headers:{'content-type':'application/json','x-weftmate-csrf':me.csrfToken},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};},{path,body,method});
 await h.launch();const id=randomUUID();assert.equal((await h.api('/account/models',{requestId:id,name:'QA5 model',baseUrl:base,modelId:'qa5-model',apiKey:'qa5-local-proxy'})).status,202);
 await until(async()=>(await h.api('/account/models/by-request/'+id)).body.operation?.status==='succeeded');h.modelId=(await h.api('/models')).body.models.find(m=>m.name==='QA5 model').id;h.hostId=(await h.api('/status')).body.hostId;
 await h.api('/settings/models',{backgroundModelProfileId:h.modelId},'PATCH');
 h.session=async()=>{const c=await h.api('/commands',{requestId:randomUUID(),kind:'session.create',targetDeviceId:h.hostId,modelProfileId:h.modelId});assert.equal(c.status,202);return (await until(async()=>{const v=(await h.api('/commands/'+c.body.command.commandId)).body.command;if(v.state==='rejected')throw Error(JSON.stringify(v));return v.state==='accepted_by_dsh'&&v;})).sessionId;};
 h.events=async id=>{const r=await h.api('/sessions/'+id+'/events?limit=200');assert.equal(r.status,200);return r.body.events??[];};
 h.send=async(id,text,wait=true)=>{const before=(await h.events(id)).filter(e=>e.type==='turn.ended').length;const c=await h.api('/commands',{requestId:randomUUID(),kind:'session.message',targetDeviceId:h.hostId,sessionId:id,text});assert.equal(c.status,202);if(wait)await until(async()=>{const e=await h.events(id);return e.filter(e=>e.type==='turn.ended').length>before&&e;},240000);return c;};
 h.healthy=async(ms=180000)=>until(async()=>{const r=await h.api('/memory/status');return r.body.state==='ready'&&r.body.pendingBoundaryCount===0&&r.body.pendingFormationCount===0&&r.body;},ms);
 h.close=async()=>{await h.app?.close().catch(()=>{});h.app=null;server.closeAllConnections();await new Promise(r=>server.close(r));};
 return h;
}
