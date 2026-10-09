/** Synthetic model, real Electron/DSH: project escape still requires explicit one-shot approval in allow-all. */
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';

const repository=resolve(import.meta.dirname,'../..'),root=mkdtempSync(join(tmpdir(),'weftmate-pj1-escalation-')),profile=join(root,'profile'),folder=join(root,'project');
mkdirSync(profile);mkdirSync(folder);writeFileSync(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const credentials={username:'PJ1EscalationSynthetic',password:'synthetic-project-escalation-password'};
const prep=await createPersonalAccessService({root:join(profile,'personal-access'),port:0,backend:Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(name=>[name,async()=>({})]))});
const ready=await prep.start(),grant=await prep.issueSetupGrant();
assert.equal((await fetch(ready.origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin:ready.origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,...credentials,deviceName:'Synthetic setup'})})).status,201);await prep.close();
const outside=join(root,'explicitly-approved.txt'),inside=join(folder,'approved-new.md');let calls=0,scenario='escape';
const model=createServer(async(req,res)=>{
  if(req.url==='/v1/models'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({data:[{id:'synthetic-project-model'}]}));return;}
  if(req.method!=='POST'||req.url!=='/v1/chat/completions'){res.writeHead(404).end();return;}
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
  const names=(body.tools||[]).map(tool=>tool.function?.name),tool=names.length?(calls++===0?'load_tools':calls===2||scenario==='escape'&&calls===3?'write':null):null;
  const args=tool==='load_tools'?{names:['write']}:tool==='write'?{file_path:scenario==='escape'?outside:inside,content:scenario==='escape'?'Approved one-shot project escape':'Approved project update',...(scenario==='escape'&&calls===3?{sandbox_permissions:'danger-full-access',justification:'Write only this synthetic target outside the synthetic project; wait for user approval.'}:{})}:null;
  if(!body.stream){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({id:randomUUID(),model:body.model,choices:[{index:0,message:{role:'assistant',content:'synthetic model ready'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));return;}
  res.writeHead(200,{'content-type':'text/event-stream'});const frame=(delta,finish_reason=null)=>res.write(`data: ${JSON.stringify({id:randomUUID(),object:'chat.completion.chunk',model:body.model,choices:[{index:0,delta,finish_reason}]})}\n\n`);
  frame(tool?{role:'assistant',tool_calls:[{index:0,id:'call-'+randomUUID(),type:'function',function:{name:tool,arguments:JSON.stringify(args)}}]}:{role:'assistant',content:'Synthetic operation complete.'});frame({},tool?'tool_calls':'stop');res.end('data: [DONE]\n\n');
});
await new Promise(done=>model.listen(0,'127.0.0.1',done));
const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('WEFTMATE_')||key.startsWith('MEMOWEFT_')||key==='ELECTRON_RUN_AS_NODE')delete env[key];env.WEFTMATE_BASELINE_TRACE=join(root,'requests.jsonl');
let app,page;const pause=ms=>new Promise(done=>setTimeout(done,ms));
async function api(path,body,method=body?'POST':'GET'){return page.evaluate(async({path,body,method})=>{const me=await(await fetch('/personal/v1/auth/me')).json();const response=await fetch('/personal/v1'+path,{method,headers:{'content-type':'application/json','x-weftmate-csrf':me.csrfToken},body:body?JSON.stringify(body):undefined});return{status:response.status,body:await response.json()};},{path,body,method});}
async function until(check){const end=Date.now()+60000;while(Date.now()<end){const value=await check();if(value)return value;await pause(200);}throw Error('Synthetic project escalation timed out');}
try{
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[join(repository,'tests/integration/personal-baseline-bootstrap.mjs'),`--user-data-dir=${profile}`,'--personal-host','--access-port=0'],cwd:repository,env});page=await app.firstWindow();await page.waitForURL('**/personal/v1/ui');
  await page.evaluate(async credentials=>{await fetch('/personal/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...credentials,deviceName:'Synthetic desktop'})});},credentials);await page.reload();
  const requestId=randomUUID();assert.equal((await api('/account/models',{requestId,name:'合成边界模型',baseUrl:`http://127.0.0.1:${model.address().port}/v1`,modelId:'synthetic-project-model',apiKey:'synthetic-only-key'})).status,202);
  await until(async()=>(await api(`/account/models/by-request/${requestId}`)).body.operation?.status==='succeeded');
  const selected=(await api('/models')).body.models.find(model=>model.name==='合成边界模型');
  const project=(await api('/projects',{requestId:randomUUID(),name:'合成项目',rootPath:folder,permission:'write'})).body.project;
  const create=(await api(`/projects/${project.projectId}/sessions`,{requestId:randomUUID(),modelProfileId:selected.id})).body.command;
  await until(async()=>(await api('/commands/'+create.commandId)).body.command.state==='accepted_by_dsh');
  assert.equal((await api(`/sessions/${create.sessionId}/approval-mode`,{mode:'allow-all'},'PATCH')).status,200);
  const message=(await api('/commands',{requestId:randomUUID(),kind:'session.message',targetDeviceId:(await api('/status')).body.hostId,sessionId:create.sessionId,text:'Synthetic explicit project escape test'})).body.command;
  const approval=await until(async()=>{const rows=(await api(`/sessions/${create.sessionId}/approvals`)).body.approvals||[];return rows.find(row=>row.status==='pending');});
  assert.equal(existsSync(outside),false,'allow-all cannot silently widen the project sandbox');
  assert.equal((await api(`/sessions/${create.sessionId}/approvals/${approval.approvalId}`,{requestId:randomUUID(),outcome:'allowed-once',scope:'once'})).status,200);
  await until(()=>existsSync(outside));assert.equal(readFileSync(outside,'utf8'),'Approved one-shot project escape');
  await until(async()=>{const task=(await api('/tasks/'+message.commandId)).body;return task.replyEvidence?.status==='completed';});
  scenario='inside';calls=1;assert.equal((await api(`/sessions/${create.sessionId}/approval-mode`,{mode:'ask'},'PATCH')).status,200);
  const update=(await api('/commands',{requestId:randomUUID(),kind:'session.message',targetDeviceId:(await api('/status')).body.hostId,sessionId:create.sessionId,text:'Synthetic in-project approved write'})).body.command;
  const insideApproval=await until(async()=>{const rows=(await api(`/sessions/${create.sessionId}/approvals`)).body.approvals||[];return rows.find(row=>row.status==='pending');});
  const exposed=JSON.stringify(insideApproval);assert.ok(!exposed.includes(folder)&&!exposed.includes(JSON.stringify(folder).slice(1,-1)));assert.match(insideApproval.reason,/approved-new.md/);assert.match(insideApproval.reason,/项目文件夹/);
  assert.equal(existsSync(inside),false);
  assert.equal((await api(`/sessions/${create.sessionId}/approvals/${insideApproval.approvalId}`,{requestId:randomUUID(),outcome:'allowed-once',scope:'once'})).status,200);
  await until(()=>existsSync(inside)&&readFileSync(inside,'utf8')==='Approved project update');await until(async()=>(await api('/tasks/'+update.commandId)).body.replyEvidence?.status==='completed');
  writeFileSync(join(repository,'tests/evidence/pj-1/escalation-verification.json'),JSON.stringify({syntheticModel:true,realElectronAndDsh:true,allowAllStillRequiresExplicitApproval:true,outsideFileAbsentBeforeApproval:true,oneShotNativeFileUpgradeSucceeded:true,projectFolderHiddenInApproval:true,relativeApprovalTargetPreserved:true},null,2));
  console.log('PJ-1 native project escalation requires and consumes explicit approval even in allow-all');
}finally{await app?.close();await new Promise(done=>model.close(done));}
