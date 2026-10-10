/** Production Electron + the fixed DSH, one actual cloud document request. */
import assert from 'node:assert/strict';
import { mkdir,writeFile,readFile,rm } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { harness,until } from './ia-2b-harness.mjs';
const out=resolve(import.meta.dirname,'../evidence/tb-3');await mkdir(out,{recursive:true});
const previous=await readFile(join(out,'real-mimo.json'),'utf8').then(JSON.parse).catch(()=>null);
const h=await harness('tb3-library',{memory:false,mainChat:true});
const report={realElectron:true,fixedDsh:true,model:'mimo-v2.6-flash',checks:[]};
try{
  const page=h.page;page.setDefaultTimeout(30000);
  await page.getByRole('button',{name:'WeftMate 主对话',exact:true}).click();
  await page.getByRole('button',{name:/选择模型|ia2b-mimo/}).first().click();await page.getByRole('option',{name:'ia2b-mimo',exact:true}).click();
  await page.getByRole('textbox',{name:'输入消息',exact:true}).fill('请在当前工作目录创建 tb3-weekend.md，写一份中文周末计划，标题是“合成周末计划”，包含整理书房和出门散步两项。用原生 write 工具保存 Markdown 文件，不要只在回复里展示，完成后简短告诉我文件名。');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  const command=await until(async()=> (await h.api('/commands?limit=20')).body.commands.find(row=>row.kind==='chat.message'&&row.state==='accepted_by_dsh'));
  await h.complete(command);const item=await until(async()=> (await h.api('/library')).body.items?.find(row=>row.fileName==='tb3-weekend.md'));
  assert.equal(item.exists,true);const preview=(await h.api(`/library/${item.id}/preview`)).body;assert.equal(preview.kind,'markdown');assert.match(preview.text,/合成周末计划/);
  await page.getByRole('button',{name:'成果库',exact:true}).click();await page.getByRole('button',{name:'预览 tb3-weekend.md',exact:true}).click();await page.getByRole('heading',{name:'合成周末计划',exact:true}).waitFor();
  await page.screenshot({path:join(out,'real-mimo-markdown.png')});report.checks.push('real-native-write','global-library-listed','markdown-preview');
  report.item={id:item.id,fileName:item.fileName,type:item.type,exists:item.exists,source:item.source};
  await h.close();report.usage=await h.usage();report.usageRuns=[...(previous?.usageRuns??(previous?.usage?[previous.usage]:[])),report.usage];report.totalUsage=report.usageRuns.flat().reduce((sum,row)=>({requests:sum.requests+1,inputTokens:sum.inputTokens+(row.prompt_tokens??0),outputTokens:sum.outputTokens+(row.completion_tokens??0),cachedTokens:sum.cachedTokens+(row.prompt_tokens_details?.cached_tokens??0),totalTokens:sum.totalTokens+(row.total_tokens??0)}),{requests:0,inputTokens:0,outputTokens:0,cachedTokens:0,totalTokens:0});await writeFile(join(out,'real-mimo.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){await writeFile(join(out,'real-mimo-failure.json'),JSON.stringify({message:error.message,report,usage:await h.usage().catch(()=>[])},null,2));throw error;}
finally{await h.close();await rm(h.base,{recursive:true,force:true});}
