import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
export async function run({desktop,mobile,profile,evidence,report,shot}){
mobile.setDefaultTimeout(6000);const pause=ms=>new Promise(r=>setTimeout(r,ms));const checks=[];
const api=(path,body,method=body?'POST':'GET')=>desktop.evaluate(async({path,body,method})=>{const me=await(await fetch('/personal/v1/auth/me')).json();const r=await fetch('/personal/v1'+path,{method,headers:{'content-type':'application/json','x-weftmate-csrf':me.csrfToken},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};},{path,body,method});
async function check(name,fn){const t=Date.now();try{const data=await fn();checks.push({name,status:'passed',durationMs:Date.now()-t,...data});}catch(e){checks.push({name,status:'failed',durationMs:Date.now()-t,error:e.message});await shot(mobile,'extra-failure-'+checks.length,'light');}await writeFile(join(evidence,'extra-checks.json'),JSON.stringify(checks,null,2));}
for(const theme of []){
await mobile.evaluate(t=>applyTheme(t),theme);
for(const name of ['常规','外观','账户','设备','用量','模型','审批','记忆','提醒与定时任务','已归档','系统状态','备份与恢复','关于'])await check(theme+'-settings-'+name,async()=>{
await mobile.evaluate(()=>page('settings'));const row=mobile.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:new RegExp('^'+name+'(?:\\s|$)')});
if(!(await row.count()))throw Error('Setting category missing: '+name);await row.click();await pause(700);await shot(mobile,'extra-settings-'+name,theme);return {text:await mobile.locator('#page-content').innerText()};});
}
await check('projects',async()=>{const folder=join(profile,'qa2-project');await mkdir(folder);const added=await api('/projects',{requestId:crypto.randomUUID(),name:'QA2 合成项目',rootPath:folder,instructions:'只处理合成测试资料。',permission:'write'});assert.equal(added.status,201);const project=added.body.project;
await mobile.evaluate(()=>page('home'));await mobile.getByRole('main').getByRole('button',{name:'QA2 合成项目',exact:true}).waitFor();for(const theme of ['light','dark']){await mobile.evaluate(t=>applyTheme(t),theme);await shot(mobile,'extra-project-list',theme);}
await mobile.getByRole('main').getByRole('button',{name:'在项目 QA2 合成项目 新建对话',exact:true}).click();await mobile.getByRole('dialog',{name:'新建项目对话',exact:true}).getByRole('button',{name:'新建对话',exact:true}).click();await mobile.waitForFunction(id=>state.page==='chat'&&state.sharedSessions.some(s=>s.sessionId===state.sharedSessionId&&s.projectId===id),project.projectId);await shot(mobile,'extra-project-conversation','dark');
const sessionId=await mobile.evaluate(()=>state.sharedSessionId);await mobile.evaluate(()=>page('home'));const title=(await api('/sessions')).body.sessions.find(s=>s.sessionId===sessionId).title;await mobile.getByRole('main').getByRole('button',{name:'更多操作 '+title,exact:true}).click();await shot(mobile,'extra-project-menu','dark');await mobile.getByRole('button',{name:'移至项目',exact:true}).click();await mobile.getByRole('dialog',{name:'移至项目',exact:true}).waitFor();await shot(mobile,'extra-move-project','dark');return {projectCreated:true,sessionLinked:true};});
report.extraChecks=checks;
}
