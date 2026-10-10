/** Approved real MiMo request, actual provider usage, fixed DSH and isolated Electron. */
import assert from 'node:assert/strict';
import { mkdir,writeFile,rm } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { harness,until } from './ia-2b-harness.mjs';
const out=resolve(import.meta.dirname,'../evidence/tb-2');await mkdir(out,{recursive:true});
const h=await harness('tb2-mimo',{memory:false,mainChat:true});const report={realElectron:true,fixedDsh:true,model:'mimo-v2.6-flash',checks:[]};
try{
  const page=h.page;page.setDefaultTimeout(30000);await page.getByRole('button',{name:'WeftMate 主对话',exact:true}).click();
  await page.getByRole('button',{name:/选择模型|ia2b-mimo/}).first().click();await page.getByRole('option',{name:'ia2b-mimo',exact:true}).click();
  await page.getByRole('textbox',{name:'输入消息',exact:true}).fill('每天早上 8 点提醒我喝水');await page.getByRole('button',{name:'发送',exact:true}).click();
  const command=await until(async()=>(await h.api('/commands?limit=20')).body.commands.find(r=>r.kind==='chat.message'&&r.state==='accepted_by_dsh'));
  await h.complete(command);const row=(await h.api('/schedules')).body.items.find(r=>r.text.includes('喝水'));
  assert.ok(row);assert.equal(row.kind,'reminder');assert.deepEqual(row.repeat,{kind:'daily',time:'08:00:00'});assert.equal(row.timeZone,'Asia/Shanghai');assert.equal(new Intl.DateTimeFormat('en-GB',{timeZone:row.timeZone,hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(row.nextRunAt)),'08:00');
  await page.getByRole('button',{name:'目标',exact:true}).click();await page.getByText(/每天 08:00/).waitFor();await page.screenshot({path:join(out,'real-mimo-daily.png')});
  report.checks.push('natural-chinese-daily-reminder-native-create','goals-page-correct-local-rule');report.schedule={kind:row.kind,repeat:row.repeat,timeZone:row.timeZone,nextRunAt:row.nextRunAt};
  await h.close();report.usage=await h.usage();await writeFile(join(out,'real-mimo.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await h.close();await rm(h.base,{recursive:true,force:true});}
