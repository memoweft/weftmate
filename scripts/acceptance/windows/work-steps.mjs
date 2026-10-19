// Reusable installed-UI checkpoints; the operator reviews each real approval before deciding.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {prepareWorkFixture} from './scenarios.mjs';
export async function startWork(ctx,{directory='w1-fixture',name='W1验收文件夹'}={}){
 const fixture=await prepareWorkFixture(ctx,{directory});
 await ctx.page.getByRole('tab',{name:'工作',exact:true}).click();await ctx.page.locator('#new-session').click();
 await ctx.page.getByRole('button',{name:'选择项目或文件夹',exact:true}).click();await ctx.page.getByRole('menuitem',{name:/选择文件夹/}).click();
 await confirmFolder(ctx,name);await ctx.shot('w1-fresh-work-folder');
 await ctx.page.locator('#model-trigger').click();await ctx.page.getByRole('menuitemradio',{name:'MiMo v2.6 Flash',exact:true}).click();
 await ctx.send(`把当前选定的 ${name} 根目录（就是 ${directory} 本身）的7个合成文件按扩展名分入子文件夹，保持原名和内容。只操作这个文件夹，完成后提供可打开的成果。`);
 return fixture;
}
export async function confirmFolder(ctx,name){
 const form=ctx.page.locator('.folder-confirm');await form.waitFor({state:'visible'});
 await form.getByRole('textbox',{name:'名称',exact:true}).fill(name);await form.locator('select').selectOption('write',{force:true});
 await ctx.page.getByRole('button',{name:'在这个文件夹里工作',exact:true}).click();await form.waitFor({state:'hidden'});
}
export async function inspectWorkCheckpoint(ctx){
 const snapshot=await ctx.snapshot(),tasks=await ctx.api('/tasks');
 const result={snapshot,tasks,approval:await ctx.page.locator('#approval-bar').innerText(),question:await ctx.page.locator('#question-bar').innerText()};
 await ctx.save('work-checkpoint.json',result);return result;
}
export async function decideApproval(ctx,decision){
 assert.ok(['批准','拒绝'].includes(decision));
 const text=await ctx.page.locator('#approval-bar').innerText();await ctx.shot('work-before-decision');
 await ctx.page.getByRole('button',{name:decision,exact:true}).click();return {decision,text};
}
export async function auditWork(ctx,{evidencePrefix='work'}={}){
 const fixture=JSON.parse(await readFile(join(ctx.output,'work-fixture.json'),'utf8'));
 const names=await readdir(fixture.root,{recursive:true}),results=[];
 for(const item of fixture.manifest){const relative=names.find(v=>v.endsWith('\\'+item.name)||v.endsWith('/'+item.name));const hash=relative?createHash('sha256').update(await readFile(join(fixture.root,relative))).digest('hex'):null;results.push({name:item.name,relative,contentMatches:hash===item.sha256});}
 await ctx.save(`${evidencePrefix}-file-audit.json`,{results});assert.ok(results.every(v=>v.relative&&v.contentMatches));
 await ctx.page.locator('#transcript').getByText('data.csv',{exact:true}).first().click();await ctx.until(async()=>(await ctx.snapshot()).text.includes('synthetic,42'),15000);
 await ctx.shot(`${evidencePrefix}-result-preview`);await ctx.page.getByRole('button',{name:'收起右侧面板',exact:true}).click();return results;
}
