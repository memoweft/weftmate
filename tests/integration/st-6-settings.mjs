import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
const out=resolve('tests/evidence/st-6');await mkdir(out,{recursive:true});
const start=Date.now();let now=start;
const f=await startTimelineCandidate({interactive:true,inlineProgress:true,composer:true,historyCount:0,clock:()=>now,baseTime:start-10000});
const profile=await mkdtemp(join(tmpdir(),'weftmate-st6-electron-'));
const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
let app,browser;const report={realElectron:true,syntheticClock:true,checks:[],errors:[]};
const wait=async fn=>{const end=Date.now()+30000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('ST-6 timeout');};
async function settings(page,surface){
 if(surface==='android-ui'){
  await page.getByRole('button',{name:'返回',exact:true}).click();await page.getByRole('button',{name:'设置与账户',exact:true}).click();
  await page.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:/^通知/}).click();
 }else{
  if(!(await page.getByRole('button',{name:'账户菜单',exact:true}).isVisible().catch(()=>false)))await page.getByRole('button',{name:'切换会话侧栏',exact:true}).click();
  await page.getByRole('button',{name:'账户菜单',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();
  if(surface==='mobile-web'){await page.getByRole('combobox',{name:'设置分类',exact:true}).click();await page.getByRole('option',{name:'设置 · 通知',exact:true}).click();}
  else await page.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:'通知',exact:true}).click();
 }
 await page.getByText('已同步 · 通知规则立即生效',{exact:true}).filter({visible:true}).waitFor();
}
async function choose(page,label,value){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:value,exact:true}).click();await wait(async()=>await page.getByText('已同步 · 通知规则立即生效',{exact:true}).filter({visible:true}).isVisible());}
try{
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['scripts/review-gallery/electron.mjs'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:f.origin,REVIEW_THEME:'light'}});
 await app.evaluate(({app})=>{globalThis.st6Notices=[];app.on('weftmate-desktop-notification',e=>globalThis.st6Notices.push(e));});
 const desktop=await app.firstWindow();await localUiSession(desktop,f.credentials,'ST-6 synthetic',{mainChat:true});await desktop.getByRole('textbox',{name:'输入消息',exact:true}).waitFor();desktop.on('pageerror',e=>report.errors.push(e.message));
 await settings(desktop,'desktop');
 for(const [key,label]of [['approval','待审批'],['question','待回答'],['task','任务完成 / 失败'],['reminder','提醒与定时任务'],['memory','记忆状态'],['system','系统']]){
   await choose(desktop,label,'只进动态不通知');await wait(async()=>(await f.request('/settings/notifications')).settings[key]==='activity');
   await choose(desktop,label,'只通知');await wait(async()=>(await f.request('/settings/notifications')).settings[key]==='notify');
   await choose(desktop,label,'通知 + 声音');await wait(async()=>(await f.request('/settings/notifications')).settings[key]==='sound');
 }
 report.checks.push('all-six-category-modes-save');
 assert.equal(await desktop.getByRole('combobox',{name:'每周记忆小结',exact:true}).isDisabled(),true);
 assert.equal(await desktop.getByText('精灵 / 主动问候',{exact:true}).count(),0);
 await desktop.getByRole('switch',{name:'通知声音',exact:true}).uncheck();await wait(async()=>(await f.request('/settings/notifications')).settings.soundEnabled===false);
 await desktop.getByRole('button',{name:'发送测试通知',exact:true}).click();await desktop.getByText(/^测试通知已发送/).waitFor();
 const test=(await f.request('/activity')).items.find(r=>r.type==='system.notification.test');await wait(async()=>(await app.evaluate(()=>globalThis.st6Notices)).some(e=>e.activityId===test.id));assert.equal(test.notification.sound,false);report.checks.push('test-notification-native-delivery-sound-off');
 await app.evaluate(({shell})=>{globalThis.st6SettingsLink=null;shell.openExternal=async url=>{globalThis.st6SettingsLink=url;};});await desktop.getByRole('button',{name:'打开 Windows 通知设置',exact:true}).click();await wait(async()=>(await app.evaluate(()=>globalThis.st6SettingsLink))==='ms-settings:notifications');report.checks.push('windows-notification-settings-deep-link');
 for(const theme of ['light','dark']){await desktop.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await desktop.getByRole('combobox',{name:'待审批',exact:true}).scrollIntoViewIfNeeded();await desktop.screenshot({path:join(out,`desktop-${theme}-notifications.png`)});}
 await desktop.getByRole('switch',{name:'启用勿扰',exact:true}).check();await wait(async()=>(await f.request('/settings/notifications')).settings.dndEnabled===true);
 await f.request('/settings/usage',{timeZone:'UTC'},'PATCH');
 // Move only the host's injected clock; no OS clock or daily account is changed.
 now=Date.parse(new Date(start).toISOString().slice(0,10)+'T23:00:00Z');
 const approval=await f.progress.approve('st6-quiet-approve','Write-Output synthetic-st6');await f.request('/activity');
 const approvalRow=(await f.request('/activity')).items.find(r=>r.actions.some(a=>a.target?.approvalId===approval.approvalId));assert.equal(approvalRow.notification.notify,true);
 await wait(async()=>(await app.evaluate(()=>globalThis.st6Notices)).some(e=>e.activityId===approvalRow.id));
 f.progress.notice({kind:'plugin',plugin:'weftmate-reminder'},'ST6-SYNTHETIC 勿扰提醒');
 f.progress.call('read','st6-work',{paths:['synthetic.md']});f.progress.result('st6-work','Synthetic');f.progress.finish();
 const quiet=(await f.request('/activity')).items;const task=quiet.find(r=>r.type==='task.completed'),reminder=quiet.find(r=>r.summary.includes('ST6-SYNTHETIC'));assert.ok(task);assert.ok(reminder);
 for(const row of [task,reminder]){assert.equal(row.notification.notify,false);assert.equal(row.notification.reason,'dnd');}
 await desktop.getByRole('button',{name:'关闭设置',exact:true}).click();await desktop.getByRole('button',{name:/^动态(?:，|$)/}).click();await desktop.getByText('因勿扰未提醒',{exact:true}).first().waitFor();
 await new Promise(r=>setTimeout(r,2500));assert.equal((await app.evaluate(()=>globalThis.st6Notices)).some(e=>[task.id,reminder.id].includes(e.activityId)),false);
 await desktop.screenshot({path:join(out,'desktop-quiet-activity.png')});report.checks.push('cross-midnight-dnd-approval-exception','task-and-reminder-suppressed','activity-explains-dnd');
 now=Date.parse(new Date(now+86400000).toISOString().slice(0,10)+'T08:00:00Z');
 const summary=(await f.request('/activity')).items.find(r=>r.type==='system.dnd.summary');assert.ok(summary);assert.equal(summary.summary,'勿扰期间有 3 件事');
 await wait(async()=>(await app.evaluate(()=>globalThis.st6Notices)).some(e=>e.activityId===summary.id));await f.request('/activity');assert.equal((await f.request('/activity')).items.filter(r=>r.type==='system.dnd.summary').length,1);report.checks.push('one-end-of-dnd-summary-no-replay');
 await f.request('/settings/notifications',{dndEnabled:false,dailyLimit:3},'PATCH');
 const active=[];for(let n=0;n<4;n++){await f.recordActivity({key:'st6-active-'+n,type:'companion.greeting',title:'合成主动提醒',summary:'ST6-ACTIVE-'+n,initiatedBy:'assistant'});active.push((await f.request('/activity')).items.find(r=>r.summary==='ST6-ACTIVE-'+n));}
 assert.equal(active.filter(r=>r.notification.notify).length,3);assert.equal(active[3].notification.reason,'daily_limit');
 await wait(async()=>(await app.evaluate(()=>globalThis.st6Notices)).filter(e=>active.slice(0,3).some(r=>r.id===e.activityId)).length===3);
 await new Promise(r=>setTimeout(r,2500));assert.equal((await app.evaluate(()=>globalThis.st6Notices)).some(e=>e.activityId===active[3].id),false);report.checks.push('daily-proactive-cap-three-native-notices');
 await settings(desktop,'desktop');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(480,650));await desktop.screenshot({path:join(out,'desktop-narrow-notifications.png')});
 assert.ok(await desktop.getByRole('dialog',{name:'设置',exact:true}).evaluate(el=>el.scrollWidth<=el.clientWidth));await desktop.getByRole('switch',{name:'通知声音',exact:true}).focus();await desktop.keyboard.press('Space');await wait(async()=>(await f.request('/settings/notifications')).settings.soundEnabled===true);report.checks.push('narrow-keyboard-switch');
 browser=await chromium.launch({headless:true,channel:'chrome'});
 const web=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await web.goto(f.origin+'/personal/v1/ui');await localUiSession(web,f.credentials,'ST-6 web',{mainChat:true});await web.getByRole('textbox',{name:'输入消息',exact:true}).waitFor();
 const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await mobile.goto(f.mobileUrl);await mobile.getByRole('button',{name:/^项目进度报告 [0-9]/}).click();
 for(const [surface,page]of [['mobile-web',web],['android-ui',mobile]]){
  page.on('pageerror',e=>report.errors.push(e.message));await settings(page,surface);
  await choose(page,'每日主动打扰上限','5 条');await wait(async()=>(await f.request('/settings/notifications')).settings.dailyLimit===5);
  await choose(page,'提醒与定时任务','只通知');await wait(async()=>(await f.request('/settings/notifications')).settings.reminder==='notify');
  for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.getByRole('combobox',{name:'待审批',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:join(out,`${surface}-${theme}-notifications.png`)});await page.getByRole('button',{name:'发送测试通知',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:join(out,`${surface}-${theme}-quiet-hours.png`)});}
  assert.ok(await page.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth));report.checks.push(surface+'-390x844-sync-light-dark');
 }
 // Region evidence for a long, internally scrolling settings surface.
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1200,800));
 for(const [surface,page]of [['desktop',desktop],['mobile-web',web],['android-ui',mobile]])for(const theme of ['light','dark']){
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  const regions=[['notifications',page.getByRole('combobox',{name:'待审批',exact:true})],['categories-bottom',page.getByRole('combobox',{name:'记忆状态',exact:true})],['quiet-hours',page.getByRole('heading',{name:'勿扰时段',exact:true})],['quiet-hours-end',page.getByLabel('结束时间',{exact:true})],['sound-permission',page.getByRole('heading',{name:'主动提醒与声音',exact:true})]];
  for(const [name,locator]of regions){await locator.evaluate(el=>(el.closest('.settings-row')??el).scrollIntoView({block:'start'}));await page.screenshot({path:join(out,`${surface}-${theme}-${name}.png`)});}
 }
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(480,650));
 await desktop.getByRole('combobox',{name:'待审批',exact:true}).evaluate(el=>(el.closest('.settings-row')??el).scrollIntoView({block:'start'}));await desktop.screenshot({path:join(out,'desktop-narrow-notifications.png')});
 await desktop.getByRole('heading',{name:'勿扰时段',exact:true}).evaluate(el=>el.scrollIntoView({block:'start'}));await desktop.screenshot({path:join(out,'desktop-narrow-quiet-hours.png')});
 assert.deepEqual(report.errors,[]);await writeFile(join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){for(const page of await app?.windows()||[]){console.log((await page.locator('body').innerText()).slice(-10000));await page.screenshot({path:join(out,'ui-failure.png')});}await writeFile(join(out,'failure.json'),JSON.stringify({error:error.message,report},null,2));throw error;}
finally{await browser?.close();await app?.close();await f.close();await rm(profile,{recursive:true,force:true});await rm(f.root,{recursive:true,force:true});}
