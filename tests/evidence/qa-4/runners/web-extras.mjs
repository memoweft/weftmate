import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export async function run({desktop,mobile,profile,evidence,report,shot}){
 const checks=[];const button=name=>mobile.getByRole('button',{name,exact:true});
 assert.equal(await mobile.getByRole('region',{name:'离线对话',exact:true}).isVisible(),false);
 await button('切换会话侧栏').click();await button('账户菜单').click();await button('设置').click();
 const dialog=mobile.getByRole('dialog',{name:'设置',exact:true});await dialog.waitFor();
 async function category(name){await dialog.getByRole('combobox',{name:'设置分类',exact:true}).click();await mobile.getByRole('option',{name:new RegExp(' · '+name+'$')}).click();}
 for(const theme of ['浅色','深色']){
  await category('外观');await dialog.getByRole('button',{name:theme,exact:true}).click();await shot(mobile,'web-settings-appearance',theme==='浅色'?'light':'dark');
  for(const name of ['常规','账户','设备','用量','模型','审批','已归档','关于']){
   await category(name);await shot(mobile,'web-settings-'+name,theme==='浅色'?'light':'dark');checks.push({theme,name,status:'passed'});
  }
 }
 await button('关闭设置').click();
 const folder=join(profile,'fx14-project');await mkdir(folder);
 const added=await desktop.evaluate(async folder=>{const auth=await(await fetch('/personal/v1/auth/me')).json();const response=await fetch('/personal/v1/projects',{method:'POST',headers:{'content-type':'application/json','x-weftmate-csrf':auth.csrfToken},body:JSON.stringify({requestId:crypto.randomUUID(),name:'FX14 网页项目',rootPath:folder,instructions:'只处理合成测试资料。',permission:'write'})});return {status:response.status,body:await response.json()};},folder);
 assert.equal(added.status,201);await mobile.reload();
 await button('切换会话侧栏').click();await button('在项目 FX14 网页项目 新建对话').click();
 await mobile.waitForFunction(async id=>(await(await fetch('/personal/v1/sessions')).json()).sessions.some(row=>row.projectId===id),added.body.project.projectId);
 await shot(mobile,'web-project-conversation','dark');checks.push({name:'project conversation',status:'passed'});
 report.extraChecks=checks;await writeFile(join(evidence,'extra-checks.json'),JSON.stringify(checks,null,2));
}
