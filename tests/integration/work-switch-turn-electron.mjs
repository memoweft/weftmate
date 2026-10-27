// Real desktop shell, personal HTTP and pinned DSH; synthetic account/model only.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, open, unlink, readdir, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
const repository = resolve(process.env.WORK_SWITCH_SOURCE || process.cwd());
const load = path => import(pathToFileURL(join(repository, path)).href);
const { phoneRuntime } = await load('services/cloud/test/relay-phone-runtime.mjs');
const { createPersonalAccessService } = await load('src/personal-access/index.mjs');
const { servePersonalAccessUi } = await load('src/personal-access-ui/index.mjs');
const out = process.env.WEFTMATE_EVIDENCE_DIR;
const root = await mkdtemp(join(tmpdir(), 'weftmate-work-switch-'));
let runtime, host, app, lock;
const logs = [], responses = [], report = { source: process.env.WORK_SWITCH_BASELINE ? '0389aba1c' : 'working-tree', observations: [] };
const text = m => typeof m.content === 'string' ? m.content : (m.content || []).map(p => p.text || '').join('');
const until = async (read, label, timeout = 30000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await read(); if (value) return value; await new Promise(r => setTimeout(r, 80)); }
  throw Error('Timed out: ' + label);
};
async function removeLinks(dir) { for (const item of await readdir(dir, {withFileTypes:true})) {
  const path = join(dir,item.name); if ((await lstat(path)).isSymbolicLink()) await unlink(path); else if(item.isDirectory()) await removeLinks(path);
} }
try {
  if (out) await mkdir(out,{recursive:true});
  for (const n of [1,2,3]) { const candidate = join(process.env.WEFTMATE_HEAVY_LOCK_DIR,`heavy-${n}.lock`);
    try {const file=await open(candidate,'wx');await file.writeFile('WORK-SWITCH '+new Date().toISOString());await file.close();lock=candidate;break;}catch(e){if(e.code!=='EEXIST')throw e;} }
  assert.ok(lock,'No heavy slot');
  runtime = await phoneRuntime(root,logs,{respond:body=>{
    if (!body.tools?.length) return {content:'合成对话'};
    const start=body.messages.findLastIndex(m=>m.role==='user'&&text(m)==='创建一个文件夹叫 她');
    if(start<0)return {content:'继续对话。'};
    const calls=body.messages.slice(start+1).flatMap(m=>m.tool_calls||[]);
    const name=calls.length===0?'load_tools':calls.length===1?'pwsh':null;
    const args=name==='load_tools'?{names:['pwsh']}:{command:'New-Item -ItemType Directory -Path 她 | Select-Object FullName',description:'创建文件夹'};
    return name?{content:'',tool_calls:[{id:'switch-'+randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]}:{content:'已处理。'};
  }});
  host=await createPersonalAccessService({root:join(root,'account'),port:0,backend:runtime.backend,uiHandler:servePersonalAccessUi});
  runtime.setHost(host);await runtime.start();const started=await host.start(),grant=await host.issueSetupGrant();
  const setup=await fetch(started.origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin:started.origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,username:'SyntheticSwitch',password:'Synthetic switch password',deviceName:'synthetic-phone'})});
  const auth=await setup.json(),cookie=setup.headers.get('set-cookie').split(';')[0];assert.equal(setup.status,201);
  const api=async(path,body,method=body===undefined?'GET':'POST')=>{
    const res=await fetch(started.origin+'/personal/v1'+path,{method,headers:{origin:started.origin,cookie,'x-weftmate-csrf':auth.csrfToken,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    const value=await res.json();assert.ok(res.ok,JSON.stringify({path,status:res.status,value}));return value;
  };
  const save=async(name,path)=>{const value=await api(path);if(out)await writeFile(join(out,name+'.json'),JSON.stringify(value,null,2));return value;};
  await api('/settings/models',{defaultModelProfileId:'synthetic'},'PATCH');await api('/onboarding',{step:'first',completed:true},'PATCH');
  const folder=join(root,'Desktop');await mkdir(folder);
  const project=(await api('/projects',{requestId:randomUUID(),name:'Desktop',rootPath:folder,permission:'write'})).project;
  const command=async body=>{const {command:c}=await api('/commands',{requestId:randomUUID(),targetDeviceId:started.hostId,...body});return until(async()=>{const {command:v}=await api('/commands/'+c.commandId);if(v.state==='rejected')throw Error(v.errorCode);return v.state==='accepted_by_dsh'&&v;},'command accepted');};
  const created=await command({kind:'session.create',modelProfileId:'synthetic'}),sessionId=created.sessionId;
  const env={...process.env,REVIEW_PROFILE:join(root,'desktop-profile'),REVIEW_ORIGIN:started.origin,REVIEW_LIBRARY_TOKEN:host.libraryDesktopToken,REVIEW_THEME:'light',REVIEW_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:repository,args:[resolve(import.meta.dirname,'../helpers/work-switch-electron.mjs')],env});
  const page=await app.firstWindow();page.setDefaultTimeout(15000);
  page.on('response',response=>{if(out&&response.request().method()==='POST'&&/\/approvals\//.test(response.url())){
    const index=responses.length;responses.push(response.json().then(value=>writeFile(join(out,`decision-${index}.json`),JSON.stringify(value,null,2))));
  }});
  await page.addInitScript(()=>{Object.defineProperty(document,'visibilityState',{get:()=> 'visible'});Object.defineProperty(document,'hidden',{get:()=>false});let module;Object.defineProperty(globalThis,'WeftUiCore',{get:()=>module,set:value=>{module=value;const create=value.create;value.create=(...args)=>globalThis.switchCore=create(...args);}});});
  await page.context().addCookies([{name:'wm_personal_session',value:cookie.slice(cookie.indexOf('=')+1),url:started.origin}]);
  await page.goto(started.origin+'/personal/v1/ui/');await page.waitForFunction(()=>globalThis.switchCore?.state.personalCapabilities?.workAndChat===1);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('wm:desktop:visibility',false));
  await page.evaluate(id=>switchCore.selectSession(id),sessionId);
  const message=await command({kind:'session.message',sessionId,text:'创建一个文件夹叫 她',intent:'queue'});
  const card=await until(async()=> (await api(`/sessions/${sessionId}/approvals`)).approvals.find(r=>r.intent==='work-switch'&&r.status==='pending'),'work proposal');
  await page.evaluate(async()=>{await switchCore.refreshConversationTasks();await switchCore.refreshConversationApprovals();});
  await page.evaluate(()=>{const submit=switchCore.submitApproval;switchCore.submitApproval=(context,row,...args)=>{globalThis.switchDebug={context,current:switchCore.approvalContext(),valid:switchCore.approvalContextCurrent(context),source:!!switchCore.approvalSource(row,true),entry:switchCore.conversationApprovals.entries.get(row.approvalId)?.authoritative};return submit(context,row,...args);};});
  await page.locator('.work-switch-card').waitFor();
  await save('proposal-events',`/sessions/${sessionId}/events?limit=200`);await save('proposal-task',`/tasks/${message.commandId}`);await save('proposal-approvals',`/sessions/${sessionId}/approvals`);
  if(out)await page.screenshot({path:join(out,'proposal.png')});
  if(process.env.WORK_SWITCH_BASELINE){
    await page.evaluate(()=>switchCore.refreshHistory(true));
    report.before=await page.evaluate(()=>({composer:switchCore.composerState(''),entry:[...switchCore.conversationApprovals.entries.values()].map(e=>({authoritative:e.authoritative,notice:e.notice})),tasks:[...switchCore.conversationTasks.entries.values()]}));
    await page.getByRole('button',{name:'切换到工作',exact:true}).click();
    report.clickDebug=await page.evaluate(()=>globalThis.switchDebug);
    await save('clicked-events',`/sessions/${sessionId}/events?limit=200`);await save('clicked-task',`/tasks/${message.commandId}`);await save('clicked-approvals',`/sessions/${sessionId}/approvals`);
    report.after=await page.evaluate(()=>({composer:switchCore.composerState(''),entry:[...switchCore.conversationApprovals.entries.values()].map(e=>({authoritative:e.authoritative,notice:e.notice})),button:document.querySelector('.work-switch-actions .primary')?.disabled}));
    if(out)await page.screenshot({path:join(out,'clicked.png')});
    assert.equal(report.before.composer.running,false,'proposal must end the chat turn before a click');
  } else {
    await until(async()=> (await api(`/sessions/${sessionId}/events?limit=200`)).events.some(e=>e.type==='turn.ended'),'proposal ends chat turn');
    await page.evaluate(async()=>{await switchCore.refreshHistory(true);await switchCore.refreshConversationTasks();await switchCore.refreshSessions();});
    await until(()=>page.evaluate(()=>switchCore.composerState('').running===false),'composer returns to send');
    report.proposalComposer=await page.evaluate(()=>switchCore.composerState(''));
    if(out)await page.screenshot({path:join(out,'proposal.png')});
    assert.equal((await api(`/sessions/${sessionId}/events?limit=200`)).events.some(e=>JSON.stringify(e).includes('New-Item')),false,'chat must not expose a computer command');
    await page.getByRole('button',{name:'切换到工作',exact:true}).click();
    report.clickDebug=await page.evaluate(()=>globalThis.switchDebug);
    const switched=await until(async()=> (await api(`/sessions/${sessionId}/approvals`)).approvals.find(r=>r.approvalId===card.approvalId&&r.workSessionId),'new work accepted');
    assert.notEqual(switched.workSessionId,sessionId);
    await until(async()=>{try{return (await readFile(join(folder,'她'),'utf8'));}catch{return (await import('node:fs/promises')).stat(join(folder,'她')).then(v=>v.isDirectory(),()=>false);}},'original request executed in selected folder');
    await until(async()=> (await api(`/sessions/${switched.workSessionId}/events?limit=200`)).events.some(e=>e.type==='turn.ended'),'work ends');
    await save('work-events',`/sessions/${switched.workSessionId}/events?limit=200`);
    await save('completed-chat-task',`/tasks/${message.commandId}`);
    await save('work-approvals',`/sessions/${sessionId}/approvals`);
    const workRow=(await api(`/sessions/${sessionId}/approvals`)).approvals.find(r=>r.approvalId===card.approvalId);
    await save('completed-work-task',`/tasks/${workRow.workCommandId}`);
    await page.waitForFunction(id=>switchCore.state.selectedSessionId===id,switched.workSessionId);
    if(out)await page.screenshot({path:join(out,'work-completed.png')});
    const declined=(await command({kind:'session.create',modelProfileId:'synthetic'})).sessionId;
    await page.evaluate(id=>switchCore.selectSession(id),declined);
    const declineMessage=await command({kind:'session.message',sessionId:declined,text:'创建一个文件夹叫 她',intent:'queue'});
    const declineCard=await until(async()=> (await api(`/sessions/${declined}/approvals`)).approvals.find(r=>r.intent==='work-switch'&&r.status==='pending'),'decline card');
    await until(async()=> (await api(`/sessions/${declined}/events?limit=200`)).events.some(e=>e.type==='turn.ended'),'declined proposal turn ends');
    await page.evaluate(async()=>{await switchCore.refreshConversationTasks();await switchCore.refreshConversationApprovals();await switchCore.refreshHistory(true);});
    await page.getByRole('button',{name:'先不用',exact:true}).click();
    await until(async()=> (await api(`/sessions/${declined}/approvals`)).approvals.some(r=>r.approvalId===declineCard.approvalId&&r.decisionOutcome==='rejected'),'decline committed');
    assert.equal((await api('/sessions')).sessions.find(r=>r.sessionId===declined).mode,'chat');
    assert.equal((await api(`/tasks/${declineMessage.commandId}`)).executionSteps.length,0);
    await command({kind:'session.message',sessionId:declined,text:'继续聊聊',intent:'queue'});
    await until(async()=> (await api(`/sessions/${declined}/events?limit=200`)).events.filter(e=>e.type==='turn.ended').length===2,'next chat completes');
    await save('declined-events',`/sessions/${declined}/events?limit=200`);
    await save('declined-task',`/tasks/${declineMessage.commandId}`);
    await page.evaluate(async()=>{await switchCore.refreshHistory(true);await switchCore.refreshSessions();});
    if(out)await page.screenshot({path:join(out,'declined.png')});
    report.observations.push('chat ends before choice; no computer command in chat; new work executes original text in Desktop; decline stays chat and accepts next input');
  }
}catch(error){report.error=error.stack;throw error;}
finally{
  await Promise.all(responses);
  if(out){await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));await writeFile(join(out,'runtime.log'),logs.join('\n'));}
  await app?.close();await runtime?.close();await host?.close();if(lock)await unlink(lock);
  await removeLinks(root);assert.ok(root.startsWith(join(tmpdir(),'weftmate-work-switch-')));await rm(root,{recursive:true,force:true});
}
