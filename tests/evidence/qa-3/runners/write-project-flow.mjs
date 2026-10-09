import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
export async function run({desktop,mobile,profile,evidence,report,shot}) {
 const start=Date.now(),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const api=async(path,body,method=body?'POST':'GET')=>desktop.evaluate(async({path,body,method})=>{
   const me=await(await fetch('/personal/v1/auth/me')).json();
   const response=await fetch('/personal/v1'+path,{method,headers:{'content-type':'application/json','x-weftmate-csrf':me.csrfToken},body:body?JSON.stringify(body):undefined});
   return {status:response.status,body:await response.json()};
 },{path,body,method});
 async function until(check,ms=60000){const end=Date.now()+ms;while(Date.now()<end){const result=await check();if(result)return result;await pause(500);}throw Error('Phone task condition timed out');}
 const key=execFileSync('powershell.exe',['-NoProfile','-Command',"[Console]::Out.Write([Environment]::GetEnvironmentVariable('MIMO_API_KEY','Machine'))"],{encoding:'utf8',windowsHide:true}).trim();
 const requestId=randomUUID();await api('/account/models',{requestId,name:'FX-9 MiMo',baseUrl:'https://api.xiaomimimo.com/v1',modelId:'mimo-v2.6-flash',apiKey:key});
 await until(async()=>(await api('/account/models/by-request/'+requestId)).body.operation?.status==='succeeded');
 const model=(await api('/models')).body.models.find(item=>item.name==='FX-9 MiMo');
 const host=(await api('/status')).body;
 const create=(await api('/commands',{requestId:randomUUID(),kind:'session.create',targetDeviceId:host.hostId,modelProfileId:model.id})).body.command;
 const created=await until(async()=>{const found=(await api('/commands/'+create.commandId)).body.command;return found.state==='accepted_by_dsh'&&found;});
 const mode=await api('/sessions/'+created.sessionId+'/approval-mode',{mode:'ask'},'PATCH');
 report.executionOwner={executionAccount:host.executionAccount,session:created.sessionId,approvalMode:mode};
 await api('/sessions/'+created.sessionId+'/metadata',{title:'FX-9 手机办事'},'PATCH');
 const native=await mobile.evaluate(()=>!!window.weftNative);
 if(native){await mobile.evaluate(()=>listSharedSessions());await mobile.getByRole('button',{name:'FX-9 手机办事',exact:true}).click();}
 else{await mobile.reload();await until(async()=>(await mobile.locator('#assistant-title').innerText())==='FX-9 手机办事');}
 const path=join('C:/Temp','fx11-phone-'+randomUUID()+'.txt').replaceAll('\\','/');
 await mobile.locator(native?'#draft':'#message-text').fill(`请在电脑上创建 ${path}，内容只写 FX11_PHONE_EXECUTED。直接使用 write 工具完成首次写入，再用 read 读回。只操作这个测试文件。如果 write 报错就停止，不要重试也不要换工具绕过。完成后告诉我。`);
 await mobile.locator(native?'#send-button':'#send-message').click();
 let approvals=0,fileContent=null,completed=false;
 const end=Date.now()+240000;
 while(Date.now()<end){
   const approve=mobile.getByRole('button',{name:'批准',exact:true});
   if(await approve.isVisible().catch(()=>false)){
     await shot(mobile,'task-approval','light');
     await desktop.screenshot({path:join(evidence,'desktop-phone-approval.png')});
     await approve.click();approvals++;
   }
   fileContent=await readFile(path,'utf8').catch(()=>null);
   completed=(await api('/sessions/'+created.sessionId+'/events')).body.events?.some(event=>event.type==='turn.ended'&&event.data?.reason==='completed');
   if(completed){await pause(1500);break;}
   await pause(700);
 }
 await shot(mobile,fileContent?'task-result':'task-failed','light');
 await desktop.screenshot({path:join(evidence,'desktop-phone-result.png')});
 const view=native?await mobile.evaluate(()=>({draft:document.getElementById('draft').value,
   pending:state.sharedPending?.state||null,optimistic:uiCore.optimisticMessages().map(row=>({requestId:row.requestId,status:row.status})),
   history:state.sharedEvents.map(event=>({seq:event.seq,type:event.type,data:event.data})),text:document.body.innerText})):await mobile.evaluate(()=>({draft:document.getElementById('message-text').value,pending:null,optimistic:[...document.querySelectorAll('[data-optimistic]')].map(node=>({status:node.classList.contains('send-failed')?'failed':'accepted'})),history:[],text:document.body.innerText}));
 const commands=(await api('/commands?limit=50')).body.commands;
 const source=commands.find(command=>command.kind==='session.message'&&command.sessionId===created.sessionId);
 const task=source?await api('/tasks/'+source.commandId):null;
 const events=(await api('/sessions/'+created.sessionId+'/events?limit=200')).body.events;
 const firstWrite=events.find(event=>(event.type==='step.completed'&&event.data?.toolName==='write')||(event.type==='artifact.created'&&event.data?.completedStep?.toolName==='write'));
 const writeState=firstWrite?.data?.completedStep?.state||firstWrite?.data?.state;
 report.firstWrite={state:writeState,artifacts:events.filter(e=>e.type==='artifact.created').length};
 if(report.phase==='baseline'){const detail=await api('/sessions/'+created.sessionId+'/events/'+firstWrite.data.detailRef.seq+'/detail');report.firstWrite.sourceUnavailable=detail.body.text.includes('TOOL_SOURCE_UNAVAILABLE');}
 const noUnconfirmed=!view.pending&&!view.optimistic.some(row=>row.status!=='accepted')&&view.draft===''&&!view.text.includes('发送未确认')&&!view.text.includes('发送结果待核对');
 report.phoneTask={passed:writeState==='completed'&&mode.status===200&&approvals>0&&completed&&fileContent?.trim()==='FX11_PHONE_EXECUTED'&&noUnconfirmed,
   durationMs:Date.now()-start,approvals,completed,fileContent,noUnconfirmed,commandState:source?.state,
   taskStatus:task?.status,replyEvidence:task?.body.replyEvidence||null,draft:view.draft,pending:view.pending,optimistic:view.optimistic,text:view.text};
 await writeFile(join(evidence,'phone-task.json'),JSON.stringify(report.phoneTask,null,2));
 await writeFile(join(evidence,'events.json'),JSON.stringify(events,null,2));
 if(fileContent!==null)await rm(path,{force:true});
 if(report.phase==='baseline'){assert.equal(writeState,'failed');assert.equal(report.firstWrite.sourceUnavailable,true);assert.equal(fileContent?.trim(),'FX11_PHONE_EXECUTED','native write already took effect before registration rejected');}
 else {assert.equal(report.phoneTask.passed,true,JSON.stringify(report.phoneTask));await (await import('../../../../tests/integration/fx-11-desktop-projects.mjs')).verify({desktop,profile,evidence,report,api,model});}
}
