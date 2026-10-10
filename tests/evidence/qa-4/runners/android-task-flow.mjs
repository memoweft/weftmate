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
 if(native){await mobile.evaluate(()=>listSharedSessions());await mobile.getByRole('main').getByRole('button',{name:/^FX-9 手机办事(?:\s|$)/}).first().click();}
 else{await mobile.reload();await mobile.locator('#assistant-view').waitFor({state:'visible'});await mobile.waitForFunction(()=>globalThis.__WeftUiStarted===true);report.phoneNavigation=await mobile.evaluate(async id=>{const r=await fetch('/personal/v1/sessions');const s=await r.json();const c=await(await fetch('/personal/v1/chats')).json();return {httpStatus:r.status,sessionCount:s.sessions?.length,createdSessionVisible:s.sessions?.some(s=>s.sessionId===id),nativeTitle:s.sessions?.find(s=>s.sessionId===id)?.title,logicalTitle:c.items?.find(c=>c.activeSessionId===id)?.title,railVisible:getComputedStyle(document.getElementById('session-rail')).display!=='none'};},created.sessionId);await writeFile(join(evidence,'phone-navigation.json'),JSON.stringify(report.phoneNavigation,null,2));const uiTitle=report.phoneNavigation.logicalTitle||report.phoneNavigation.nativeTitle||'FX-9 手机办事';if(uiTitle!=='FX-9 手机办事'){report.issues??=[];report.issues.push({id:'native-logical-session-title-mismatch'});}const target=mobile.locator('[data-session-id="'+created.sessionId+'"]').getByRole('button',{name:uiTitle,exact:true,includeHidden:true});await target.waitFor({state:'attached'});if(!await mobile.getByRole('complementary',{name:'会话导航',exact:true}).isVisible().catch(()=>false))await mobile.getByRole('button',{name:'切换会话侧栏',exact:true}).click();await pause(1000);if(!await target.isVisible()){report.phoneNavigation.sidebarOpenRetried=true;await shot(mobile,'sidebar-first-click-hidden','light');await mobile.getByRole('button',{name:'切换会话侧栏',exact:true}).click();}await target.click();await until(async()=>(await mobile.locator('#assistant-title').innerText())===uiTitle);await writeFile(join(evidence,'phone-navigation.json'),JSON.stringify(report.phoneNavigation,null,2));}
 if(process.argv.includes('--setup-only')){report.modelSetupOnly=true;return;}
 const path=join('C:/Temp','fx9-phone-'+randomUUID()+'.txt').replaceAll('\\','/');
 const taskText=`请在电脑上创建 ${path}，内容只写 FX9_PHONE_EXECUTED。只操作这个测试文件，并读回核验内容。完成后告诉我。`;const draft=mobile.locator(native?'#draft':'#message-text');await draft.fill(taskText);await pause(700);const retained=await draft.inputValue();report.draftEntry={retained:retained===taskText,enteredLength:taskText.length,retainedLength:retained.length};if(retained!==taskText){report.issues??=[];report.issues.push({id:'draft-cleared-during-session-selection'});await shot(mobile,'draft-cleared-before-send','light');await draft.fill(taskText);}await writeFile(join(evidence,'draft-entry.json'),JSON.stringify(report.draftEntry,null,2));
 await mobile.locator(native?'#send-button':'#send-message').click();
 let approvals=0,fileContent=null,completed=false;
 const end=Date.now()+240000;
 while(Date.now()<end){
   const offline=mobile.getByRole('region',{name:'离线对话',exact:true});
   if(await offline.isVisible().catch(()=>false)){
     await shot(mobile,'unexpected-offline','light');throw Error('Offline overlay interrupted online task');
   }
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
 const noUnconfirmed=!view.pending&&!view.optimistic.some(row=>row.status!=='accepted')&&view.draft===''&&!view.text.includes('发送未确认')&&!view.text.includes('发送结果待核对');
 report.phoneTask={passed:mode.status===200&&approvals>0&&completed&&fileContent?.trim()==='FX9_PHONE_EXECUTED'&&noUnconfirmed,
   durationMs:Date.now()-start,approvals,completed,fileContent,noUnconfirmed,commandState:source?.state,
   taskStatus:task?.status,replyEvidence:task?.body.replyEvidence||null,draft:view.draft,pending:view.pending,optimistic:view.optimistic,text:view.text};
 await writeFile(join(evidence,'phone-task.json'),JSON.stringify(report.phoneTask,null,2));
 await writeFile(join(evidence,'events.json'),JSON.stringify(view.history,null,2));
 if(fileContent!==null)await rm(path,{force:true});
 if(report.phase==='before'){assert.equal(mode.status,404);assert.equal(fileContent,null);assert.equal(approvals,0);}else assert.equal(report.phoneTask.passed,true,JSON.stringify(report.phoneTask));
}
