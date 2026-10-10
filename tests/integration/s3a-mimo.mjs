/** One real MiMo → fixed DSH native reminder → Android system notification. */
import assert from 'node:assert/strict';
import { mkdir,writeFile,rm } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { harness,until } from './ia-2b-harness.mjs';
import { phone,shell,shot,notifications,wait,pause,pkg } from './s3a-android.mjs';
const out=resolve('tests/evidence/s3a');await mkdir(out,{recursive:true});
const h=await harness('s3a-reminder',{memory:false,mainChat:true});let p;
const report={realElectron:true,realAndroid:true,fixedDsh:true,model:'mimo-v2.6-flash',checks:[]};
try{
 const desktop=h.page;desktop.setDefaultTimeout(30000);shell('shell','pm','clear',pkg);
 p=await phone(new URL(desktop.url()).origin,h.credentials);
 shell('shell','pm','grant',pkg,'android.permission.POST_NOTIFICATIONS');shell('shell','input','keyevent','4');
 await desktop.getByRole('button',{name:'WeftMate 主对话',exact:true}).click();
 await desktop.getByRole('button',{name:/选择模型|ia2b-mimo/}).first().click();await desktop.getByRole('option',{name:'ia2b-mimo',exact:true}).click();
 await desktop.getByRole('textbox',{name:'输入消息',exact:true}).fill('请用原生提醒工具设一个 1 分钟后的提醒，内容是“S3A-SYNTHETIC 核对周末计划”。提醒触发时只提醒，不再调用模型。');
 await desktop.getByRole('button',{name:'发送',exact:true}).click();
 const command=await until(async()=>(await h.api('/commands?limit=20')).body.commands.find(row=>row.kind==='chat.message'&&row.state==='accepted_by_dsh'));
 await h.complete(command);const schedules=(await h.api('/schedules')).body.items;
 const schedule=schedules.find(row=>row.text.includes('S3A-SYNTHETIC'));assert.ok(schedule);report.checks.push('real-model-native-one-minute-reminder');
 shell('shell','input','keyevent','3');
 const activity=await until(async()=>(await h.api('/activity?type=reminder')).body.items?.find(row=>row.summary.includes('S3A-SYNTHETIC')),120000);
 assert.equal(activity.notification.notify,true);assert.equal(activity.notification.sound,true);
 await wait(()=>notifications().find(row=>row.tag.endsWith(':'+activity.id)),'real MiMo Android reminder');
 assert.equal(notifications().filter(row=>row.tag.endsWith(':'+activity.id)).length,1);
 assert.ok(notifications().every(row=>!row.ongoing));report.checks.push('living-background-real-native-reminder','host-decision-exact','single-native-notification-no-persistent-item');
 shell('shell','cmd','statusbar','expand-notifications');await pause(400);shot('real-mimo-shade-light');shell('shell','cmd','uimode','night','yes');await pause(400);shot('real-mimo-shade-dark');shell('shell','cmd','uimode','night','no');
 try{shell('shell','uiautomator','dump','/sdcard/s3a-deeplink.xml');}catch{}
 const xml=shell('shell','cat','/sdcard/s3a-deeplink.xml'),node=xml.match(/<node[^>]*text="[^"]*S3A-SYNTHETIC[^"]*"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);assert.ok(node,'real reminder text visible in system shade');
 shell('shell','input','tap',String((Number(node[1])+Number(node[3]))/2),String((Number(node[2])+Number(node[4]))/2));
 await p.page.waitForFunction(()=>state.page==='activity');await p.page.locator(`[data-activity-id="${activity.id}"]`).waitFor();shot('real-mimo-deeplink');report.checks.push('system-notification-click-opens-exact-activity');
 await desktop.getByRole('button',{name:/^动态(?:，|$)/}).click();await desktop.getByText(/S3A-SYNTHETIC/).first().waitFor();await desktop.screenshot({path:join(out,'real-mimo-desktop.png')});
 report.activity={id:activity.id,type:activity.type,at:activity.at,notification:activity.notification};report.schedule={id:schedule.id,scheduledAt:schedule.scheduledAt};
 await p.close();p=null;await h.close();report.usage=await h.usage();await writeFile(join(out,'real-mimo.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){await writeFile(join(out,'real-mimo-failure.json'),JSON.stringify({error:error.message,report,usage:await h.usage().catch(()=>[])},null,2));throw error;}
finally{await p?.close().catch(()=>{});await h.close();await rm(h.base,{recursive:true,force:true});shell('shell','cmd','uimode','night','no');}
