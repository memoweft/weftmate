/** Real fixed DSH reminder, actual provider usage and native desktop notification. */
import assert from 'node:assert/strict';
import { mkdir,writeFile,rm } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { harness,until } from './ia-2b-harness.mjs';
const evidence=resolve(import.meta.dirname,'../evidence/tb-1');await mkdir(evidence,{recursive:true});
const h=await harness('tb1-reminder',{memory:false,mainChat:true});
const report={realElectron:true,fixedDsh:true,model:'mimo-v2.6-flash',checks:[]};
try{
  const page=h.page;page.setDefaultTimeout(30000);
  await h.app.evaluate(({app})=>{globalThis.tb1Notices=[];app.on('weftmate-desktop-notification',event=>globalThis.tb1Notices.push(event));});
  await page.getByRole('button',{name:'WeftMate 主对话',exact:true}).click();
  await page.getByRole('button',{name:/选择模型|ia2b-mimo/}).first().click();await page.getByRole('option',{name:'ia2b-mimo',exact:true}).click();
  await page.getByRole('textbox',{name:'输入消息',exact:true}).fill('请用原生提醒工具设一个 1 分钟后的提醒，内容是“TB1-SYNTHETIC 核对周末计划”。提醒触发时只提醒，不再调用模型。');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  const command=await until(async()=> (await h.api('/commands?limit=20')).body.commands.find(row=>row.kind==='chat.message'&&row.state==='accepted_by_dsh'));
  await h.complete(command);const schedules=(await h.api('/schedules')).body.items;
  const schedule=schedules.find(row=>row.text.includes('TB1-SYNTHETIC'));assert.ok(schedule,JSON.stringify(schedules));report.checks.push('real-model-native-schedule-created');
  const activity=await until(async()=> (await h.api('/activity?type=reminder')).body.items?.find(row=>row.summary.includes('TB1-SYNTHETIC')),120000);
  assert.equal(activity.notification.level,'important');
  await until(async()=> (await h.app.evaluate(()=>globalThis.tb1Notices)).some(event=>event.activityId===activity.id),30000);
  const notices=await h.app.evaluate(()=>globalThis.tb1Notices);assert.equal(notices.filter(event=>event.activityId===activity.id).length,1);
  await page.getByRole('button',{name:/^动态(?:，|$)/}).click();await page.getByText(/TB1-SYNTHETIC/).first().waitFor();
  await page.screenshot({path:join(evidence,'real-mimo-reminder.png')});
  report.checks.push('one-minute-native-dispatch','same-activity-native-notification-id','single-notification','desktop-activity-visible');
  report.activity={id:activity.id,type:activity.type,at:activity.at,level:activity.notification.level};
  report.schedule={id:schedule.id,scheduledAt:schedule.scheduledAt};
  await h.close();report.usage=await h.usage();await writeFile(join(evidence,'real-mimo.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){await writeFile(join(evidence,'real-mimo-failure.json'),JSON.stringify({error:error.message,report,usage:await h.usage().catch(()=>[])},null,2));throw error;}
finally{await h.close();await rm(h.base,{recursive:true,force:true});}
