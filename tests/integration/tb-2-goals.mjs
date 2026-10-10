/** Real Electron + pinned DSH, synthetic concurrent model, isolated account and random ports. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { harness, until } from './ia-2b-harness.mjs';
const out=resolve(import.meta.dirname,'../evidence/tb-2');await mkdir(out,{recursive:true});
const held=new Set();let hold=true;
const model=createServer(async(req,res)=>{
  if(req.method==='GET'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[{id:'tb2-synthetic',object:'model'}]}));return;}
  let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);
  res.writeHead(200,{'content-type':'text/event-stream'});
  const chunk=(delta,finish=null)=>res.write(`data: ${JSON.stringify({id:'tb2',object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:body.model,choices:[{index:0,delta,finish_reason:finish}]})}\n\n`);
  const later=Math.max(raw.lastIndexOf('TB2-FORGOTTEN-SECRET'),raw.lastIndexOf('TB2-TEMPORARY-PRIVATE'));const kind=raw.lastIndexOf('TB2-JOB')>later?'job':raw.lastIndexOf('TB2-APPROVAL')>later?'approval':null;
  const toolId=`tb2-pwsh-${kind}`;
  const used=body.messages?.some(m=>m.tool_call_id===toolId||m.tool_calls?.some(c=>c.id===toolId));
  if(kind&&!used&&!/Generate the session title/.test(raw)){
    const loaded=body.tools?.some(t=>t.function?.name==='pwsh');
    chunk({role:'assistant',tool_calls:[{index:0,id:loaded?toolId:`tb2-load-${kind}`,type:'function',function:{name:loaded?'pwsh':'load_tools',arguments:JSON.stringify(loaded?{description:'核对合成执行流程',command:kind==='job'?"Start-Sleep -Seconds 30; Write-Output 'TB2-JOB'":"Write-Output 'TB2-APPROVAL'",...(kind==='job'?{run_in_background:true}:{})}:{names:['pwsh']})}}]},'tool_calls');res.end('data: [DONE]\n\n');return;
  }
  chunk({role:'assistant',content:'正在核对合成资料。'});
  const finish=()=>{if(!res.destroyed){chunk({content:'核对完成。'});chunk({},'stop');res.end('data: [DONE]\n\n');}held.delete(finish);};
  if(hold&&raw.includes('TB2-HOLD')&&!/Generate the session title/.test(raw)){held.add(finish);res.on('close',()=>held.delete(finish));}else finish();
});await new Promise(r=>model.listen(0,'127.0.0.1',r));
let h;const report={realElectron:true,fixedDsh:true,syntheticAccount:true,checks:[],errors:[]};
const check=(value,label)=>{assert.ok(value,label);report.checks.push(label);console.log(`[tb2] ${label}`);};
try{
  h=await harness('tb2-fixed',{memory:false,mainChat:true,provider:{baseUrl:`http://127.0.0.1:${model.address().port}/v1`,modelId:'tb2-synthetic',key:'synthetic-tb2'}});
  await h.app.evaluate(()=>{globalThis.tb2ScheduleErrors=[];const original=globalThis.ia2b.service.handleScheduleRuntime;globalThis.ia2b.service.handleScheduleRuntime=async input=>{try{return await original(input)}catch(error){globalThis.tb2ScheduleErrors.push(error.code??error.name);throw error;}}});
  const page=h.page;page.setDefaultTimeout(20000);page.on('pageerror',e=>report.errors.push(e.message));page.on('console',e=>{if(e.text().includes('TB2 goals'))console.log(e.text());});
  const create=()=>h.command({requestId:randomUUID(),kind:'session.create',targetDeviceId:h.hostId,modelProfileId:h.modelProfileId});
  const projectRoot=join(h.base,'project');await mkdir(projectRoot);const project=await h.api('/projects',{requestId:randomUUID(),name:'合成资料项目',rootPath:projectRoot,permission:'read-only'});assert.equal(project.status,201,JSON.stringify(project));
  const one=(await create()).sessionId,projectRequest=randomUUID();const projectSession=await h.api(`/projects/${project.body.project.projectId}/sessions`,{requestId:projectRequest,modelProfileId:h.modelProfileId});assert.equal(projectSession.status,202,JSON.stringify(projectSession));const projectCommand=await until(async()=>{const row=(await h.api(`/commands/by-request/${projectRequest}`)).body.command;return row?.state==='accepted_by_dsh'&&row;});const two=projectCommand.sessionId;
  assert.equal((await h.api(`/sessions/${one}/metadata`,{title:'合成计划对话'},'PATCH')).status,200);assert.equal((await h.api(`/sessions/${two}/metadata`,{title:'合成资料对话'},'PATCH')).status,200);
  const choose=async(form,name,label)=>{await form.getByRole('combobox',{name,exact:true}).click();await page.getByRole('option',{name:label,exact:true}).click();};
  const send=(sessionId,text)=>h.command({requestId:randomUUID(),kind:'session.message',sessionId,text,mode:'queue',targetDeviceId:h.hostId});
  const first=await send(one,'TB2-HOLD 项目计划'),second=await send(two,'TB2-HOLD 旁聊资料');await send(one,'排队核对下一份资料');const mainChat=(await h.api('/chats/main')).body.chat;const mainTask=await h.command({requestId:randomUUID(),kind:'chat.message',chatId:mainChat.chatId,text:'TB2-HOLD 主对话资料',mode:'queue',modelProfileId:h.modelProfileId,targetDeviceId:h.hostId});
  await until(async()=>held.size>=3);
  await page.getByRole('button',{name:'目标',exact:true}).click();await page.getByRole('heading',{name:'目标',exact:true}).waitFor();
  const overview=(await h.api('/tasks')).body;check(overview.items.some(r=>r.taskId===first.commandId)&&overview.items.some(r=>r.taskId===second.commandId)&&overview.items.some(r=>r.taskId===mainTask.commandId&&r.source.chatKind==='main')&&overview.items.some(r=>r.source.projectId===project.body.project.projectId),'native-multi-conversation-overview');
  await page.getByRole('article',{name:/TB2-HOLD 项目计划/}).getByRole('button',{name:'停止',exact:true}).click();
  await until(async()=>['stopped','aborted'].includes((await h.api(`/tasks/${first.commandId}`)).body.control?.stopStatus));check(true,'native-targeted-stop-receipt');
  const historyOpened=page.waitForResponse(r=>r.url().includes(`/sessions/${two}/events?`));await page.getByRole('article',{name:/TB2-HOLD 旁聊资料/}).getByRole('button',{name:'打开对话与步骤'}).click();await historyOpened;await page.getByRole('region',{name:'对话',exact:true}).getByText('TB2-HOLD 旁聊资料',{exact:true}).waitFor();check(true,'open-original-conversation');
  hold=false;for(const finish of [...held])finish();await h.complete(second);await h.complete(mainTask);
  await page.getByRole('button',{name:'目标',exact:true}).click();await page.getByRole('button',{name:'刷新目标'}).click();
  await until(async()=>(await h.api('/tasks')).body.recent.some(r=>r.taskId===second.commandId));check(true,'native-terminal-recent-seven-days');
  async function makeSchedule(text,repeat){await page.getByRole('button',{name:'新建定时任务',exact:true}).click();const form=page.getByRole('form',{name:'新建定时任务'});await form.getByLabel('要做什么',{exact:true}).fill(text);await choose(form,'所属对话','合成资料对话');await choose(form,'重复',{daily:'每天',weekly:'每周',once:'一次性'}[repeat]);await form.getByLabel('时间',{exact:true}).fill('09:00');if(repeat==='once')await form.getByLabel('日期',{exact:true}).fill('2027-01-02');await form.getByRole('button',{name:'保存',exact:true}).click();await form.waitFor({state:'hidden'});}
  await makeSchedule('每天核对计划','daily');await makeSchedule('每周核对资料','weekly');await makeSchedule('一次性核对报告','once');
  const scheduleRows=(await h.api('/schedules')).body.items;check(scheduleRows.length===3&&scheduleRows.find(r=>r.text==='每天核对计划').repeat.kind==='daily'&&scheduleRows.find(r=>r.text==='每周核对资料').repeat.weekday===1,'native-daily-weekly-once-create');
  const activeMain=(await h.api('/chats/main')).body.chat.activeSessionId;const mainSchedule=await h.api('/schedules',{requestId:randomUUID(),sessionId:activeMain,text:'主对话中的合成定时工作',kind:'task',repeat:{kind:'daily',time:'08:00:00'}});assert.equal(mainSchedule.status,201,JSON.stringify(mainSchedule));await h.api(`/schedules/${activeMain}/${mainSchedule.body.item.id}/run`,{requestId:randomUUID()});const mainResult=await until(async()=>{const row=(await h.api('/schedules')).body.items.find(row=>row.sessionId===activeMain&&row.id===mainSchedule.body.item.id);return row?.lastResult?.state==='completed'&&row;});check((await h.api('/commands?limit=100')).body.commands.some(row=>row.commandId===mainResult.lastResult.commandId&&row.chatId===mainChat.chatId),'ui-main-schedule-uses-logical-main-command');
  let row=page.getByRole('article',{name:'每天核对计划',exact:true});await row.getByRole('button',{name:'编辑',exact:true}).click();const edit=page.getByRole('form',{name:'编辑定时任务'});await edit.getByLabel('时间',{exact:true}).fill('10:00');await edit.getByRole('button',{name:'保存',exact:true}).click();await edit.waitFor({state:'hidden'});
  await row.getByRole('button',{name:'暂停',exact:true}).click();await row.getByRole('button',{name:'恢复',exact:true}).waitFor();await row.getByRole('button',{name:'立即运行',exact:true}).click();await until(async()=>(await h.api('/schedules')).body.items.find(r=>r.text==='每天核对计划')?.lastResult?.state==='delivered');
  await row.getByRole('button',{name:'恢复',exact:true}).click();await row.getByRole('button',{name:'暂停',exact:true}).waitFor();check(true,'native-edit-pause-run-resume');
  await row.getByRole('button',{name:'删除',exact:true}).click();const confirm=page.getByRole('dialog',{name:'删除这个定时任务？'});await confirm.getByRole('button',{name:'取消',exact:true}).click();assert.ok((await h.api('/schedules')).body.items.some(r=>r.text==='每天核对计划'));await row.getByRole('button',{name:'删除',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认删除',exact:true}).click();await row.waitFor({state:'hidden'});check(true,'confirmed-native-delete');
  const at=new Date(Date.now()+5000),parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(at).map(p=>[p.type,p.value]));
  const due=await h.api('/schedules',{requestId:randomUUID(),sessionId:two,text:'到点核对资料',kind:'reminder',at:{date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}:${parts.second}`}});assert.equal(due.status,201,JSON.stringify(due));
  await until(async()=>(await h.api('/activity?type=reminder')).body.items.some(r=>r.summary.includes('到点核对资料')),30000);check(true,'native-due-to-activity');
  const scheduledTask=await h.api('/schedules',{requestId:randomUUID(),sessionId:two,text:'合成定时工作',kind:'task',repeat:{kind:'daily',time:'09:00:00'}});assert.equal(scheduledTask.status,201);
  const runPath=`/schedules/${two}/${scheduledTask.body.item.id}/run`,runBody={requestId:randomUUID()};const firstRun=await h.api(runPath,runBody);const secondRun=await h.api(runPath,runBody);assert.equal(firstRun.status,200,JSON.stringify({firstRun,errors:await h.app.evaluate(()=>globalThis.tb2ScheduleErrors)}));assert.equal(secondRun.status,200,JSON.stringify({secondRun,errors:await h.app.evaluate(()=>globalThis.tb2ScheduleErrors)}));
  const completedSchedule=await until(async()=>{const row=(await h.api('/schedules')).body.items.find(row=>row.sessionId===two&&row.id===scheduledTask.body.item.id);return row?.lastResult?.state==='completed'&&row;});
  check((await h.api('/activity?type=task')).body.items.filter(row=>row.source.taskId===completedSchedule.lastResult.commandId).length===1,'native-scheduled-task-result-activity-and-exact-run-replay');
  await page.getByRole('button',{name:'新建长期目标'}).click();const goalForm=page.getByRole('form',{name:'新建长期目标'});await goalForm.getByLabel('目标标题').fill('整理学习计划');await goalForm.getByLabel('目标说明').fill('每周在这个对话核对进展。');await choose(goalForm,'所属对话','合成资料对话');await goalForm.getByRole('button',{name:'保存',exact:true}).click();await goalForm.waitFor({state:'hidden'});
  let goal=page.getByRole('article',{name:'整理学习计划',exact:true});await goal.getByRole('button',{name:'完成目标'}).click();await goal.getByText(/已完成/).waitFor();await goal.getByRole('button',{name:'归档目标'}).click();await goal.waitFor({state:'hidden'});check(true,'native-goal-create-complete-archive');
  await h.api('/goals',{requestId:randomUUID(),sessionId:two,title:'合成保留目标',description:'合成说明'});await page.getByRole('button',{name:'刷新目标'}).click();
  await page.screenshot({path:join(out,'desktop-light.png')});await page.evaluate(()=>localStorage.setItem('weftmate.desktop.appearance.v1',JSON.stringify({theme:'dark',accent:'neutral',fontSize:'15'})));await page.reload();await page.getByRole('button',{name:'目标',exact:true}).click();await page.getByRole('article',{name:'合成保留目标'}).waitFor();await page.screenshot({path:join(out,'desktop-dark.png')});
  await h.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(480,650));await page.screenshot({path:join(out,'desktop-narrow.png')});check(await page.locator('.goals-surface').evaluate(el=>el.scrollWidth<=el.clientWidth),'narrow-no-overflow');
  await page.getByRole('button',{name:'新建定时任务'}).focus();await page.keyboard.press('Enter');await page.getByRole('form',{name:'新建定时任务'}).waitFor();await page.getByRole('form').getByRole('button',{name:'取消',exact:true}).click();check(true,'keyboard-form-open');
  await h.api(`/sessions/${one}/approval-mode`,{mode:'ask'},'PATCH');const approvalTask=await send(one,'TB2-APPROVAL 核对合成审批');
  await until(async()=>(await h.api('/tasks')).body.items.some(r=>r.taskId===approvalTask.commandId&&r.status==='approval'));await page.getByRole('button',{name:'刷新目标'}).click();check(true,'native-waiting-approval-overview');
  const stopApproval=await h.api(`/tasks/${approvalTask.commandId}/stop`,{requestId:randomUUID()});assert.equal(stopApproval.status,202);await until(async()=>['stopped','completed'].includes((await h.api(`/tasks/${approvalTask.commandId}`)).body.control.stopStatus));
  await h.api(`/sessions/${one}/approval-mode`,{mode:'auto'},'PATCH');const job=await send(one,'TB2-JOB 核对后台作业');
  await until(async()=>(await h.api(`/tasks/${job.commandId}`)).body.control.backgroundJobs.active>0);const liveJob=(await h.api('/tasks')).body.items.find(r=>r.taskId===job.commandId);check(!!liveJob,'native-background-job-stays-active');assert.ok(Number.isSafeInteger(liveJob.source.seq));await page.getByRole('button',{name:'刷新目标'}).click();await page.getByRole('article',{name:/TB2-JOB 核对后台作业/}).getByRole('button',{name:'打开对话与步骤'}).click();await page.getByRole('region',{name:'对话',exact:true}).getByRole('button',{name:/运行|命令|核对合成执行流程/}).first().waitFor();check(true,'native-step-anchor-opens-original-details');await page.getByRole('button',{name:'切换会话侧栏',exact:true}).click();await page.getByRole('button',{name:'目标',exact:true}).click();
  assert.equal((await h.api(`/tasks/${job.commandId}/stop`,{requestId:randomUUID()})).status,202);await until(async()=>(await h.api(`/tasks/${job.commandId}`)).body.control.backgroundJobs.active===0);check(true,'native-background-job-stop');
  const secret='TB2-FORGOTTEN-SECRET',source=await send(one,secret);await h.complete(source);
  const make=async(text)=>h.api('/schedules',{requestId:randomUUID(),sessionId:one,text,kind:'reminder',repeat:{kind:'daily',time:'09:00:00'}});
  assert.equal((await make(secret)).status,201);assert.equal((await make('保持无关安排')).status,201);assert.equal((await h.api('/goals',{requestId:randomUUID(),sessionId:one,title:secret})).status,201);
  for(const row of (await h.api('/goals')).body.items)if(row.phase!=='complete')await h.api(`/goals/${row.source.sessionId}/complete`,{requestId:randomUUID(),ref:{id:row.id,revision:row.revision}});
  await until(async()=>(await h.api('/sessions')).body.sessions.every(row=>!row.running));
  await h.app.evaluate(async(_,args)=>globalThis.ia2b.service.cleanupMemoryCopies(args.ownerId,{sourceTexts:[args.secret],deleteConversationSnippets:false}),{ownerId:h.ownerId,secret});
  const afterForget=(await h.api('/schedules')).body.items;check(!afterForget.some(r=>r.text.includes(secret))&&afterForget.some(r=>r.text==='保持无关安排')&&!JSON.stringify((await h.api('/goals')).body).includes(secret),'d33-native-goal-schedule-cleanup-preserves-unrelated');
  assert.ok(!(await readFile(join(h.profile,'dsh-home/personal-schedules.json'),'utf8')).includes(secret));check(true,'d33-adapter-store-no-forgotten-content');
  const temporary=(await h.command({requestId:randomUUID(),kind:'session.create',targetDeviceId:h.hostId,modelProfileId:h.modelProfileId,temporary:true})).sessionId;
  const privateTask=await send(temporary,'TB2-TEMPORARY-PRIVATE');await h.complete(privateTask);
  await h.api('/schedules',{requestId:randomUUID(),sessionId:temporary,text:'TB2-TEMPORARY-PRIVATE',kind:'reminder',repeat:{kind:'daily',time:'09:00:00'}});await h.api('/goals',{requestId:randomUUID(),sessionId:temporary,title:'TB2-TEMPORARY-PRIVATE'});
  check(!JSON.stringify((await h.api('/tasks')).body).includes('TB2-TEMPORARY-PRIVATE')&&!JSON.stringify((await h.api('/schedules')).body).includes('TB2-TEMPORARY-PRIVATE')&&!JSON.stringify((await h.api('/goals')).body).includes('TB2-TEMPORARY-PRIVATE'),'temporary-task-schedule-goal-title-redaction');
  const deleted=await h.api(`/sessions/${two}`,{},'DELETE');assert.equal(deleted.status,200,JSON.stringify(deleted));check(!(await h.api('/schedules')).body.items.some(r=>r.sessionId===two)&&!(await h.api('/goals')).body.items.some(r=>r.source.sessionId===two)&&!(await h.api('/tasks')).body.items.some(r=>r.source.sessionId===two),'delete-clears-native-linked-items');
  check(report.errors.length===0,'renderer-zero-errors');await writeFile(join(out,'fixed-dsh.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){await h?.page?.screenshot({path:join(out,'failure.png')}).catch(()=>{});await writeFile(join(out,'failure.json'),JSON.stringify({error:error.stack,report},null,2));throw error;}
finally{hold=false;for(const finish of [...held])finish();await h?.close();if(h)await rm(h.base,{recursive:true,force:true});await new Promise(r=>model.close(r));}
