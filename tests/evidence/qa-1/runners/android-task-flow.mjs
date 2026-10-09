import {execFileSync} from 'node:child_process';import {randomUUID} from 'node:crypto';import {readFile,writeFile} from 'node:fs/promises';import {join} from 'node:path';
export async function run({desktop,mobile,profile,evidence,report,shot}){
 const start=Date.now(),pause=ms=>new Promise(r=>setTimeout(r,ms));
 const api=async(path,body,method=body?'POST':'GET')=>desktop.evaluate(async({path,body,method})=>{const me=await(await fetch('/personal/v1/auth/me')).json();const r=await fetch('/personal/v1'+path,{method,headers:{'content-type':'application/json','x-weftmate-csrf':me.csrfToken},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};},{path,body,method});
 async function until(f,ms=60000){const end=Date.now()+ms;while(Date.now()<end){const v=await f();if(v)return v;await pause(500);}throw Error('Android task condition timed out');}
 const key=execFileSync('powershell.exe',['-NoProfile','-Command',"[Console]::Out.Write([Environment]::GetEnvironmentVariable('MIMO_API_KEY','Machine'))"],{encoding:'utf8',windowsHide:true}).trim();
 const requestId=randomUUID();await api('/account/models',{requestId,name:'QA1 MiMo',baseUrl:'https://api.xiaomimimo.com/v1',modelId:'mimo-v2.6-flash',apiKey:key});
 await until(async()=>(await api('/account/models/by-request/'+requestId)).body.operation?.status==='succeeded');
 const model=(await api('/models')).body.models.find(m=>m.name==='QA1 MiMo');const host=(await api('/status')).body.hostId;
 const create=(await api('/commands',{requestId:randomUUID(),kind:'session.create',targetDeviceId:host,modelProfileId:model.id})).body.command;
 const c=await until(async()=>{const c=(await api('/commands/'+create.commandId)).body.command;return c.state==='accepted_by_dsh'&&c;});
 await api('/sessions/'+c.sessionId+'/metadata',{title:'QA1 手机办事'},'PATCH');await api('/sessions/'+c.sessionId+'/approval-mode',{mode:'ask'});
 await mobile.getByRole('button',{name:'QA1 手机办事',exact:true}).waitFor({timeout:60000});await mobile.getByRole('button',{name:'QA1 手机办事',exact:true}).click();
 const path=join('C:/Temp','qa1-phone-'+randomUUID()+'.txt').replaceAll('\\','/');
 await mobile.locator('#draft').fill(`请在电脑上创建 ${path}，内容只写 QA1_PHONE_EXECUTED。只操作这个测试文件，完成后告诉我。`);
 await mobile.locator('#send-button').click();
 let approvals=0;const end=Date.now()+180000;
 while(Date.now()<end){const approve=mobile.getByRole('button',{name:'批准',exact:true});if(await approve.isVisible().catch(()=>false)){await shot(mobile,'task-approval','light');await approve.click();approvals++;}
  const body=await readFile(path,'utf8').catch(()=>null);if(body?.includes('QA1_PHONE_EXECUTED')){await pause(3000);await shot(mobile,'task-result','light');report.phoneTask={passed:true,durationMs:Date.now()-start,approvals,fileContent:body};await writeFile(join(evidence,'phone-task.json'),JSON.stringify(report.phoneTask,null,2));return;}
  const text=await mobile.locator('body').innerText();if(text.includes('无法在电脑')||text.includes('没有文件')||text.includes('没有任何文件'))break;await pause(700);
 }
 await shot(mobile,'task-timeout','light');report.phoneTask={passed:false,durationMs:Date.now()-start,approvals,text:await mobile.locator('body').innerText()};await writeFile(join(evidence,'phone-task.json'),JSON.stringify(report.phoneTask,null,2));
}
