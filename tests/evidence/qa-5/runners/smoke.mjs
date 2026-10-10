import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {localUiSession} from '../../../helpers/local-ui-session.mjs';
import {harness,pause,until} from './harness.mjs';
const out=resolve('tests/evidence/qa-5/smoke');mkdirSync(out,{recursive:true});
// Same isolated installer identity: wait for the private backup rehearsal to finish.
await until(()=>{try{return JSON.parse(readFileSync('tests/evidence/qa-5/installed/migration-report.json')).backupCopyDeleted;}catch{return false;}},1800000);
const installRoot=process.env.QA5_SMOKE_INSTALL_ROOT||mkdtempSync(join(tmpdir(),'weftmate-qa5-smoke-installed-')),installation=join(installRoot,'Programs');
assert.ok(resolve(installRoot).startsWith(resolve(tmpdir(),'weftmate-qa5-smoke-installed-')));writeFileSync(join(out,'install-root.txt'),installRoot);const installStart=Date.now();
if(!process.env.QA5_SMOKE_SKIP_INSTALL)execFileSync(resolve('.local/qa-5/releases/0.1.1-preview.1/build/WeftMate-Setup-0.1.1-preview.1.exe'),['/S','/currentuser',`/D=${installation}`],{windowsHide:true,stdio:'pipe',timeout:600000});
writeFileSync(join(out,'install-root.txt'),installRoot);
if(!process.env.QA5_SMOKE_SKIP_INSTALL)writeFileSync(join(out,'install-timing.json'),JSON.stringify({elapsedMs:Date.now()-installStart,installed:true}));
const executable=join(installation,readdirSync(installation).find(n=>n.endsWith('.exe')&&!/Uninstall|Recovery/.test(n)));
const h=await harness('smoke',{mimo:true,installed:executable}),start=Date.now(),report={startedAt:new Date().toISOString(),installed:true,checks:[],errors:[]};let browser,phone;
const save=()=>writeFileSync(join(out,'results.json'),JSON.stringify(report,null,2));
const shot=async(name,page=h.page)=>page.screenshot({path:join(out,name+'.png')});
const check=async(name,fn)=>{const t=Date.now();try{const detail=await fn();report.checks.push({name,passed:true,durationMs:Date.now()-t,...detail});await shot(name);}catch(e){report.checks.push({name,passed:false,durationMs:Date.now()-t,error:e.message});await shot(name+'-failed').catch(()=>{});}save();};
async function active(page=h.page){const selected=await page.locator('#session-list [data-session-id]:has(button.is-current)').first().getAttribute('data-session-id').catch(()=>null);return selected||(await h.api('/chats/main')).body.chat?.activeSessionId;}
async function say(text,page=h.page,{approval=false}={}){
 const beforeId=await active(page),beforeSeq=beforeId?Math.max(-1,...(await h.events(beforeId)).map(e=>e.seq)):-1;const prior=new Set((await h.api('/commands?limit=100')).body.commands.map(c=>c.commandId));const t=Date.now();await page.getByRole('textbox',{name:'输入消息',exact:true}).fill(text);await page.getByRole('button',{name:'发送',exact:true}).click();
 const command=await until(async()=>{const rows=(await h.api('/commands?limit=100')).body.commands;return rows.find(c=>!prior.has(c.commandId)&&['session.message','chat.message'].includes(c.kind)&&c.state==='accepted_by_dsh');});
 let approvals=0;const user=await until(async()=>{const events=await h.events(command.sessionId);return events.find(e=>e.type==='user.message'&&e.data.text===text&&e.seq>(command.sessionId===beforeId?beforeSeq:-1));});
 const events=await until(async()=>{if(approval){const approve=page.getByRole('button',{name:'批准',exact:true});if(await approve.isVisible().catch(()=>false)){await shot('approval-'+report.checks.length+'-'+approvals,page);await approve.click();approvals++;}}const rows=await h.events(command.sessionId);return rows.some(e=>e.type==='turn.ended'&&e.seq>(user?.seq??-1))&&rows;},300000);
 const reply=events.filter(e=>e.type==='assistant.message'&&e.seq>(user?.seq??-1)).map(e=>e.data.text??'').join('\n');return {sessionId:command.sessionId,durationMs:Date.now()-t,approvals,reply};
}
try{
 h.page.on('pageerror',e=>report.errors.push(e.message));await h.page.reload();await h.page.locator('#assistant-view').waitFor({state:'visible'});
 await h.app.evaluate(({Notification})=>{globalThis.qa5Notifications=[];const original=Notification.prototype.show;Notification.prototype.show=function(){globalThis.qa5Notifications.push({title:this.title,body:this.body,at:Date.now()});return original.call(this);};});
 await check('01-main-chat',()=>say('今天准备收拾桌面资料，先给我两条简单建议，不用工具。'));
 await check('02-preference',async()=>{const r=await say('我喝第951种花茶喜欢加一片柠檬。请记下这个偏好。');await h.healthy();return r;});
 await check('03-side-recall',async()=>{await h.page.getByRole('button',{name:/^(新对话|新旁聊) Ctrl N$/,exact:true}).click();const r=await say('我喝第951种花茶加什么？');assert.match(r.reply,/柠檬/);return r;});
 await check('04-correction',async()=>{const r=await say('纠正一下，第951种花茶不加柠檬了，改为加一片苹果。');await h.healthy();return r;});
 const folder=join(h.root,'synthetic-folder');mkdirSync(folder);writeFileSync(join(folder,'a.txt'),'合成会议笔记');writeFileSync(join(folder,'b.txt'),'合成阅读清单');
 await check('05-file-approval',async()=>{const id=await active();await h.api(`/sessions/${id}/approval-mode`,{mode:'ask'},'PATCH');const r=await say(`请整理这个合成文件夹 ${folder.replaceAll('\\','/')}：读取a.txt和b.txt，写一份index.md列出两份文件内容。只操作此目录。`,h.page,{approval:true});assert.ok(r.approvals>0);assert.ok(existsSync(join(folder,'index.md')));return r;});
 await check('06-reminder-set',()=>say('请在2分钟后提醒我站起来活动，提醒内容为QA5日用冒烟活动。',h.page,{approval:true}));
 await check('07-personalization',async()=>{await h.page.keyboard.press('Control+,');await h.page.locator('#settings-dialog').waitFor();await h.page.locator('button[data-category="personalization"]').click();await h.page.getByRole('textbox',{name:'怎么称呼你',exact:true}).fill('小织');await h.page.getByRole('button',{name:'保存个性化',exact:true}).click();await until(async()=>(await h.api('/settings/personalization')).body.settings.preferredName==='小织');await shot('personalization-open');await h.page.getByRole('button',{name:'关闭设置',exact:true}).click();});
 await check('08-dark',async()=>{await h.page.keyboard.press('Control+,');await h.page.locator('button[data-category="appearance"]').click();const native=h.page.locator('#appearance-theme');if(await native.isVisible())await native.selectOption('dark');else{await h.page.getByRole('button',{name:'深色',exact:true}).click();}await shot('dark-settings-open');await h.page.getByRole('button',{name:'关闭设置',exact:true}).click();});
 await check('09-temporary',async()=>{await h.page.keyboard.press('Escape');await h.page.getByRole('button',{name:'选择新对话类型',exact:true}).click();await h.page.locator('#new-temporary-session').click();const r=await say('仅在这次临时对话里：第777个测试箱的颜色是紫色。只回复收到。');await h.healthy();const items=(await h.api('/memory/items?kind=cognition')).body.items;assert.ok(!JSON.stringify(items).includes('第777'));return r;});
 await check('10-phone-continue-approve',async()=>{browser=await chromium.launch({channel:'msedge'});phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await phone.goto(h.origin+'/personal/v1/ui');await localUiSession(phone,h.credentials,'QA5 phone',{mainChat:true});await phone.locator('#assistant-view').waitFor({state:'visible'});const main=(await h.api('/chats/main')).body.chat;await h.api(`/sessions/${main.activeSessionId}/approval-mode`,{mode:'ask'},'PATCH');const path=join(folder,'phone.txt').replaceAll('\\','/');const r=await say(`请在${path}写入QA5_PHONE_OK，然后读回来告诉我。`,phone,{approval:true});assert.ok(r.approvals>0);assert.equal(readFileSync(path,'utf8').trim(),'QA5_PHONE_OK');await shot('phone-completed',phone);return r;});
 await check('11-reminder-delivery',async()=>{const activity=await until(async()=>{const rows=(await h.api('/activity?type=reminder')).body.items;return rows?.find(r=>JSON.stringify(r).includes('QA5日用冒烟活动'));},180000);const notifications=await h.app.evaluate(()=>globalThis.qa5Notifications);assert.ok(notifications.some(n=>n.body?.includes('QA5日用冒烟活动')));return {activity,notifications};});
 let cycle=0;
 while(Date.now()-start<20*60*1000){cycle++;await check('daily-'+cycle,async()=>{await h.page.keyboard.press('Escape');if(await h.page.locator('#settings-dialog').isVisible().catch(()=>false))await h.page.getByRole('button',{name:'关闭设置',exact:true}).click();if(cycle%2===1)await h.page.getByRole('button',{name:/^(新对话|新旁聊) Ctrl N$/,exact:true}).click();return say(cycle%2?'现在我喝第951种花茶应该加什么？也请用我设置的称呼打个招呼。':'刚才整理文件后的下一步，可以给我一个很短的建议吗？不用工具。');});await pause(Math.min(45000,Math.max(0,20*60*1000-(Date.now()-start))));}
 report.notifications=await h.app.evaluate(()=>globalThis.qa5Notifications);report.elapsedMs=Date.now()-start;report.health=await h.healthy();
}catch(e){report.fatal=e.stack;}finally{await browser?.close();await h.close();report.finishedAt=new Date().toISOString();report.elapsedMs=Date.now()-start;save();try{execFileSync(join(installation,'Uninstall WeftMate.exe'),['/S'],{windowsHide:true,stdio:'pipe',timeout:600000});report.uninstalled=true;}catch{report.uninstalled=false;}save();}
