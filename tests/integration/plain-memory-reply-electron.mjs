/** U1/#569: real source application, pinned Core/DSH and MiMo; no reply rewriting. */
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, open, unlink, readdir, lstat, rm } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { harness, until } from './ia-2b-harness.mjs';
import { managedTempRoot } from '../helpers/managed-temp.mjs';
import { cleanupOwnedProcesses, redactEvidenceText } from '../helpers/process-evidence.mjs';

for(const stream of [process.stdout,process.stderr])stream.on('error',error=>{if(error.code!=='EPIPE')throw error;});
const out=resolve(process.env.WEFTMATE_EVIDENCE_DIR),locks=process.env.WEFTMATE_HEAVY_LOCK_DIR;
assert.ok(locks,'Explicit heavy lock directory required');
await mkdir(out,{recursive:true});
const startedAt=Date.now(), require=createRequire(import.meta.url);
const report={realElectron:true,realDsh:true,realCore:true,model:'mimo-v2.6-flash',passed:false,cases:[],screenshots:[]};
let h, lease, leaseText, watchdog, failure;
const cleanProcesses=()=>cleanupOwnedProcesses({startedAt,
  executables:[process.execPath,require('electron'),process.env.WEFTMATE_TEST_MEMOWEFT_PYTHON],
  commandRoots:[resolve(import.meta.dirname,'../..'),...(h?[h.base]:[])]});
async function removeLinks(directory) {
  for(const row of await readdir(directory,{withFileTypes:true})){
    const file=join(directory,row.name);
    if((await lstat(file)).isSymbolicLink())await unlink(file);
    else if(row.isDirectory())await removeLinks(file);
  }
}
async function capture(name) {
  for(const theme of ['light','dark']){
    await h.page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
    const file=name+'-'+theme+'.png';
    const image=await h.app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'));
    await writeFile(join(out,file),Buffer.from(image,'base64'));report.screenshots.push(file);
  }
}
async function ask(text) {
  const created=await h.command({requestId:randomUUID(),kind:'session.create',targetDeviceId:h.hostId,modelProfileId:h.modelProfileId});
  const sessionId=created.sessionId;
  const command=await h.command({requestId:randomUUID(),kind:'session.message',targetDeviceId:h.hostId,sessionId,text,mode:'queue'});
  await h.complete(command);
  await h.page.evaluate(async id=>{await fix45Core.refreshSessions();await fix45Core.selectSession(id);},sessionId);
  await h.page.locator(`#session-list .session-row[data-session-id="${sessionId}"] > button`).first().click();
  const rows=await until(async()=>{const value=(await h.api('/sessions/'+sessionId+'/events?limit=200')).body.events;
    return value.some(row=>row.type==='turn.ended')&&value;},120000);
  const reply=rows.filter(row=>row.type==='assistant.message').map(row=>row.data.text).join('\n');
  assert.ok(reply.length>0&&reply.length<200,'ordinary memory answer should be brief');
  assert.doesNotMatch(reply,/MemoWeft|load_tools|health_query|后台|异步|回执|用户问|直接回答即可|调度|这是.*记忆|不需要.*(?:工具|load|提醒)/i);
  await h.app.evaluate(async({BrowserWindow})=>{await BrowserWindow.getAllWindows()[0].capturePage(undefined,{stayHidden:true,stayAwake:true});});
  const visible=await until(async()=>{
    const selected=await h.page.evaluate(()=>fix45Core.state.selectedSessionId);
    const text=(await h.page.locator('.message.assistant .message-text').allInnerTexts()).join('\n');
    const normalize=value=>value.replaceAll('**','').replace(/\s+/g,'');
    return selected===sessionId&&normalize(text)===normalize(reply)&&text;
  },30000);
  assert.doesNotMatch(visible,/MemoWeft|load_tools|health_query|后台分析|用户问|直接回答即可/i);
  const labels=await h.page.locator('.inline-progress-text,.execution-step > summary').allTextContents();
  for(const label of labels)assert.doesNotMatch(label,/MemoWeft|load_tools|health_query|后台分析/i);
  report.cases.push({request:text,sessionId,reply,progressLabels:labels});
  return sessionId;
}
try {
  for(const number of [1,2,3]){
    const file=join(locks,'heavy-'+number+'.lock');
    try{const fd=await open(file,'wx');leaseText='569 '+new Date().toISOString()+' real memory reply';await fd.writeFile(leaseText);await fd.close();lease=file;break;}
    catch(error){if(error.code!=='EEXIST')throw error;}
  }
  if(!lease)throw Error('No heavy slot');
  watchdog=setTimeout(()=>{cleanProcesses();process.exit(1);},480000);
  h=await harness('plain-memory-569',{memory:true,mainChat:true,modelTrace:true,hidden:true});
  const models=(await h.api('/models')).body.models;
  report.configuredModels=models.map(row=>({id:row.id,configured:row.configured,name:row.name}));
  const preferences=await h.api('/settings/models',{defaultModelProfileId:h.modelProfileId},'PATCH');
  assert.equal(preferences.status,200,JSON.stringify(preferences.body));
  await h.api('/onboarding',{step:'first',completed:true},'PATCH');
  await h.page.reload();
  await h.page.waitForFunction(()=>globalThis.fix45Core?.state.personalCapabilities?.workAndChat===1,{timeout:30000});
  await h.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('wm:desktop:visibility',false));
  await h.page.evaluate(()=>fix45Core.refreshThinkingModels());
  await until(async()=>{
    const status=(await h.api('/status')).body;
    report.readiness={runtime:status.backend?.runtime,chat:status.backend?.capabilities?.chat};
    return status.backend?.runtime==='ready'&&status.backend?.capabilities?.chat?.available===true;
  },90000);
  const first=await ask('记住我喜欢喝红茶');await capture('remember-red-tea');
  const memory=await until(async()=>{const value=await h.api('/memory/items?kind=cognition');return value.status===200&&value.body.items?.find(item=>item.text.includes('红茶'));},180000);
  report.formalMemoryPresent=true;report.formalMemoryKind=memory.kind??'cognition';
  const second=await ask('我喜欢喝什么？');
  assert.notEqual(first,second,'recall runs in a new conversation');
  assert.match(report.cases.at(-1).reply,/红茶/);
  await capture('new-conversation-recall');
  report.passed=true;console.log('569 PASS: preference acknowledgement and new-conversation recall are plain replies');
}catch(error){
  failure=error;report.failure=redactEvidenceText(error.message,h?[h.base]:[]);
  if(h){
    const log=await readFile(join(h.base,'host.log'),'utf8').catch(()=>'');
    report.runtimeErrors=log.split('\n').filter(line=>/DSH|runtime|error|failed/i.test(line)).slice(-12).map(line=>redactEvidenceText(line,[h.base]));
    await capture('failure').catch(()=>{});
  }
  console.error(report.failure);process.exitCode=1;
}
finally{
  if(h){let deadline;try{await Promise.race([h.close(),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('CloseTimeout')),15000);})]);}catch{cleanProcesses();}finally{clearTimeout(deadline);}}
  report.cleanup=cleanProcesses();clearTimeout(watchdog);
  if(h){const rel=relative(managedTempRoot(),h.base);assert.ok(rel&&!rel.startsWith('..')&&!isAbsolute(rel));await removeLinks(h.base);await rm(h.base,{recursive:true,force:true});}
  if(lease)await unlink(lease);
  await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));
}
