// Drive the real installed candidate or the separately identified explicit-Core development UI.
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {appendHistory} from './history.mjs';
export async function onboarding(ctx){
 const {page,until}=ctx;
 const heading=page.locator('section.onboarding h1');
 for(let n=0;n<4;n++){
  const previous=await heading.innerText();if(previous.includes('选一个一起工作的模型'))break;
  await page.getByRole('button',{name:'继续',exact:true}).click();
  await until(async()=>await heading.innerText()!==previous,15000);
 }
 await page.getByRole('button',{name:'选择模型服务',exact:true}).click();
 await page.getByRole('menuitem',{name:'MiMo',exact:true}).click();
 await page.getByRole('textbox',{name:'模型服务名称',exact:true}).fill('MiMo 基线');
 const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const address=page.getByRole('textbox',{name:'服务地址',exact:true});const official=await address.inputValue();
 await address.fill(`http://127.0.0.1:${port}/v1`);await page.locator('section.onboarding').getByLabel('密钥',{exact:true}).fill('synthetic-invalid-key');
 await page.getByRole('button',{name:'重新查询模型',exact:true}).click();
 await until(async()=>{const t=await page.locator('.onboarding-diagnostic').innerText();return t&&!t.includes('正在读取');},45000);
 await ctx.save('c2-invalid-service.txt',await page.locator('.onboarding-diagnostic').innerText());await ctx.shot('c2-invalid-service');
 await address.fill(official);
 await ctx.fillKey(page.locator('section.onboarding').getByLabel('密钥',{exact:true}));
 await page.getByRole('button',{name:'重新查询模型',exact:true}).click();
 await until(async()=>{const t=await page.locator('.onboarding-diagnostic').innerText();return t&&!t.includes('正在读取');},60000);
 await ctx.shot('01-model-catalog');
 await page.getByRole('button',{name:'继续',exact:true}).click();
 await until(async()=>!(await heading.innerText()).includes('选一个一起工作的模型'));
 await ctx.save('onboarding-memory.txt',await page.locator('section.onboarding').innerText());
 await ctx.shot('02-bundled-memory');
 for(let n=0;n<5;n++){
  const previous=await heading.innerText();if(previous.includes('现在，说出第一句话')||!await page.locator('section.onboarding').isVisible())break;
  const skip=page.getByRole('button',{name:'跳过这步',exact:true});
  if(await skip.isVisible())await skip.click();else await page.getByRole('button',{name:'继续',exact:true}).click();
  await until(async()=>!await page.locator('section.onboarding').isVisible()||await heading.innerText()!==previous,15000);
 }
 if(await page.locator('section.onboarding').isVisible())await page.getByRole('button',{name:'开始聊天',exact:true}).click().catch(async error=>{if(!await page.locator('#message-text').isVisible())throw error;});
 await page.locator('#message-text').waitFor({state:'visible'});
 return ctx.snapshot();
}
export async function newChat(ctx){
 const chatMode=ctx.page.getByRole('tab',{name:'对话',exact:true});if(await chatMode.isVisible())await chatMode.click();
 const fixedVisible=await Promise.all(['activity','health','goals','library'].map(name=>ctx.page.locator(`.${name}-surface`).isVisible()));
 if(fixedVisible.some(Boolean)){const existing=ctx.page.locator('#session-list .session-row > button').first();if(await existing.count())await existing.click();}
 await ctx.page.locator('#new-session').click();
 await ctx.page.locator('#message-text').waitFor({state:'visible'});
 // Account model synchronization can change the default order. Keep the requested
 // acceptance model explicit instead of accidentally exercising another MiMo model.
 await ctx.page.locator('#model-trigger').click();
 await ctx.page.getByRole('menuitemradio',{name:'MiMo v2.6 Flash',exact:true}).click();
}
export async function waitReply(ctx,needle,timeout=120000){
 await waitTurn(ctx,timeout);assert.ok((await ctx.page.locator('.message.assistant').last().innerText()).includes(needle),`Actual final answer does not contain expected scenario marker: ${needle}`);
 return ctx.snapshot();
}
export async function waitTurn(ctx,timeout=150000){
 await ctx.until(async()=>!await ctx.page.getByRole('button',{name:'停止回复',exact:true}).isVisible()&&await ctx.page.locator('#transcript').evaluate(el=>{const rows=[...el.querySelectorAll('.message')];const user=rows.findLastIndex(r=>r.classList.contains('user'));return user>=0&&rows.findLastIndex(r=>r.classList.contains('assistant'))>user;}),timeout);
 return ctx.snapshot();
}
export async function firstReply(ctx){
 await ctx.send('这是全新 Windows 安装的合成验收。计算 17 加 25，只回答结果。');
 const result=await waitReply(ctx,'42');await ctx.shot('03-first-reply');
 assert.match(result.text,/42/);await ctx.save('c1-first-reply.json',result);return result;
}
export async function rapidThree(ctx){
 await newChat(ctx);
 for(let n=1;n<=3;n++){await ctx.send(`B1连发${n}：只回答「第${n}条已收到」。`);if(n<3)await ctx.pause(1500);}
 await ctx.until(async()=>{const t=(await ctx.page.locator('.message.assistant').allTextContents()).join('\n');return [1,2,3].every(n=>t.includes(`第${n}条已收到`))&&!await ctx.page.locator('#send-message[data-action="stop"]').isVisible();},180000);
 const result=await ctx.snapshot();await ctx.save('c7-three-messages.json',result);await ctx.shot('c7-three-messages');return result;
}
export async function memoryForm(ctx){
 await newChat(ctx);await ctx.send('记住我喜欢喝红茶');await waitReply(ctx,'红茶');await ctx.shot('m1-form');
 const formedTask=await ctx.until(async()=>{const tasks=await ctx.api('/tasks');return tasks.body.recent?.find(row=>row.title==='记住我喜欢喝红茶');},15000);ctx.memorySeedSessionId=formedTask.source.sessionId;ctx.memoryPreferredTea='红茶';
 await newChat(ctx);await ctx.send('我喜欢喝什么？');const result=await waitTurn(ctx);await ctx.shot('m1-recall');await ctx.save('m1-recall.json',result);assert.ok((await ctx.page.locator('.message.assistant').last().innerText()).includes('红茶'),'M1: final new-conversation answer did not recall red tea');return result;
}
export async function memoryCorrect(ctx){
 await newChat(ctx);await ctx.send('我其实更喜欢绿茶');await waitReply(ctx,'绿茶');await ctx.shot('m2-correct');
 await newChat(ctx);await ctx.send('我喜欢喝什么？');const result=await waitTurn(ctx);await ctx.shot('m2-recall');await ctx.save('m2-recall.json',result);assert.ok((await ctx.page.locator('.message.assistant').last().innerText()).includes('绿茶'),'M2: final new-conversation answer did not adopt green tea');ctx.memoryPreferredTea='绿茶';return result;
}
async function teaSnapshot(ctx){
 const result=await ctx.api('/memory/items?kind=cognition');assert.equal(result.status,200,'Memory list is unavailable');assert.ok(Array.isArray(result.body.items));return {result,tea:result.body.items.filter(row=>/红茶|绿茶/.test(row.text))};
}
export async function memoryForgetPage(ctx){
 const {page}=ctx;await page.locator('#account-menu-trigger').click();await page.locator('#rail-memory').click();
 await ctx.until(async()=>(await page.locator('#memory-list').innerText()).includes('茶'),60000);
 const before=await teaSnapshot(ctx),target=before.tea.find(row=>row.currentState==='current')||before.tea[0];if(!target)throw Error('M3: tea memory unavailable in the real memory page');
 let receipt;
 try{
  await page.locator('#memory-list').getByRole('button',{name:new RegExp(target.text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))}).first().click();
  await page.locator('#memory-delete-action').click();await ctx.until(()=>page.locator('#memory-confirm-action').isEnabled(),45000);await ctx.shot('m3-forget-preview');
  const keepOriginal=!await page.locator('#memory-forget-scope input[type=checkbox]').isChecked();assert.ok(keepOriginal);
  await page.locator('#memory-confirm-action').click();await ctx.until(async()=>!await page.locator('#memory-detail-dialog').isVisible()||await page.locator('#memory-detail-check').isVisible()||/成功|完成|失败|待确认/.test(await page.locator('#memory-detail-status').innerText()),60000).catch(()=>{});
  if(await page.locator('#memory-detail-check').isVisible())await page.locator('#memory-detail-check').click();
  receipt={text:(await ctx.snapshot()).text,keepOriginal};await ctx.shot('m3-delete-result');
 }finally{if(await page.locator('#memory-detail-close').isVisible())await page.locator('#memory-detail-close').click();if(await page.getByRole('button',{name:'关闭设置',exact:true}).isVisible())await page.getByRole('button',{name:'关闭设置',exact:true}).click();}
 await newChat(ctx);await ctx.send('我喜欢喝什么？');const recall=await waitTurn(ctx);const after=await teaSnapshot(ctx),sources=await ctx.api(`/memory/items/${target.kind}/${encodeURIComponent(target.id)}/sources`);
 const originalChat=ctx.memorySeedSessionId?await ctx.api(`/sessions/${ctx.memorySeedSessionId}/events?limit=200`):null;
 const originalRetained=!!originalChat&&JSON.stringify(originalChat).includes('记住我喜欢喝红茶');
 const result={before,receipt,after,sources,recall,originalRetained};await ctx.save('m3-forget-page.json',result);await ctx.shot('m3-recall-after-forget');
 assert.ok(!after.tea.length&&!/红茶|绿茶/.test(JSON.stringify(sources.body))&&originalRetained,'M3: erased memory/source still readable or original chat was not retained');return result;
}
export async function memoryForgetChat(ctx){
 let before=await teaSnapshot(ctx);if(!before.tea.length){await memoryForm(ctx);before=await teaSnapshot(ctx);}
 await newChat(ctx);await ctx.send(`请立即永久删除我喜欢喝${ctx.memoryPreferredTea||'红茶'}的这条记忆。`);await waitTurn(ctx,150000);
 let answer=await ctx.page.locator('.message.assistant').last().innerText();
 if(/请确认|回复[“"]确认/.test(answer)&&!/已提交|已经忘|已删除/.test(answer)){await ctx.send('确认，请立即永久删除这一条喝茶偏好记忆，默认保留聊天原话。');await waitTurn(ctx,150000);answer=await ctx.page.locator('.message.assistant').last().innerText();}
 await ctx.shot('m7-delete-response');await newChat(ctx);await ctx.send('我喜欢喝什么？');const recall=await waitTurn(ctx),after=await teaSnapshot(ctx);
 const sources=await Promise.all(before.tea.map(row=>ctx.api(`/memory/items/${row.kind}/${encodeURIComponent(row.id)}/sources`)));
 const originalChat=ctx.memorySeedSessionId?await ctx.api(`/sessions/${ctx.memorySeedSessionId}/events?limit=200`):null;
 const result={before,answer,after,sources,recall,originalRetained:!!originalChat&&JSON.stringify(originalChat).includes('记住我喜欢喝红茶')};await ctx.save('m7-forget-chat.json',result);await ctx.shot('m7-recall-after-forget');
 assert.ok(!after.tea.length&&sources.every(r=>!/红茶|绿茶/.test(JSON.stringify(r.body)))&&result.originalRetained,'M7: memory or source text remains readable after dialogue forgetting');return result;
}
export async function queueAndStop(ctx,{newConversation=true}={}){
 if(newConversation)await newChat(ctx);await ctx.send('请直接在聊天正文中逐行写1到500，每行写「数字 合成排队验收」。不要使用任何工具，不要创建或写入文件，不要省略。');
 await ctx.page.getByRole('button',{name:'停止回复',exact:true}).waitFor();
 await ctx.until(async()=>(await ctx.page.locator('.message.assistant').last().innerText().catch(()=>'' )).length>30);
 await ctx.send('排队验收：请只回答「排队输入保留」。');
 await ctx.shot('c3-queued');
 const started=Date.now();await ctx.page.getByRole('button',{name:'停止回复',exact:true}).click();
 await ctx.until(async()=>!await ctx.page.getByRole('button',{name:'停止回复',exact:true}).isVisible(),15000);
 const stopElapsedMs=Date.now()-started;
 await waitReply(ctx,'排队输入保留',150000);
 const result={stopElapsedMs,...await ctx.snapshot()};await ctx.save('c3-queue-stop.json',result);await ctx.shot('c3-queue-stop');return result;
}
export async function switchDuringReply(ctx){
 await newChat(ctx);await ctx.send('从1到120逐行输出合成段落，每行写「序号，切页验收」，最后一行写「切页正文完成」。');
 await ctx.page.getByRole('button',{name:'停止回复',exact:true}).waitFor();
 await ctx.until(async()=>(await ctx.page.locator('.message.assistant').last().innerText().catch(()=>'' )).length>30);
 await ctx.save('c6-leaving-state.json',{streaming:await ctx.page.getByRole('button',{name:'停止回复',exact:true}).isVisible(),partialText:await ctx.page.locator('.message.assistant').last().innerText()});
 await ctx.page.getByRole('button',{name:'目标',exact:true}).click();
 await ctx.shot('c6-away-during-stream');
 await ctx.page.locator('#session-list button.is-current').first().click();
 const result=await waitReply(ctx,'切页正文完成',180000);await ctx.save('c6-restored.json',result);await ctx.shot('c6-restored');return result;
}
export async function createWaterReminder(ctx){
 await newChat(ctx);await ctx.send('5分钟后提醒我喝水，提醒内容写「B1喝水验收」。只设置一次提醒，不执行其他工作。');
 await ctx.until(async()=>{const r=await ctx.api('/schedules');return JSON.stringify(r).includes('B1喝水验收')&&r;},120000);
 const result=await ctx.api('/schedules');await ctx.save('h1-scheduled.json',result);await ctx.shot('h1-scheduled');return result;
}
export async function createTimedReminder(ctx){
 const at=new Date(Date.now()+8*60000);const time=[at.getHours(),at.getMinutes()].map(n=>String(n).padStart(2,'0')).join(':');
 await newChat(ctx);await ctx.send(`今天 ${time} 提醒我「B1定点清单验收」。按本地时间保存为一次性提醒，不执行其他工作。`);
 await ctx.until(async()=>{const r=await ctx.api('/schedules');return JSON.stringify(r).includes('B1定点清单验收')&&r;},120000);
 const result={requestedLocalTime:time,actual:await ctx.api('/schedules')};await ctx.save('h5-scheduled.json',result);await ctx.shot('h5-scheduled');return result;
}
export async function healthNoData(ctx){
 await newChat(ctx);await ctx.send('我这周睡得怎么样？请以实际已同步的健康数据回答，没有数据就如实说明。');
 await ctx.until(async()=>await ctx.page.locator('.message.assistant').count()>0&&!await ctx.page.getByRole('button',{name:'停止回复',exact:true}).isVisible(),120000);
 const result=await ctx.snapshot();await ctx.save('h3-no-data.json',result);await ctx.shot('h3-no-data');return result;
}
export async function healthWithData(ctx){
 const today=new Date();const items=Array.from({length:5},(_,n)=>{const d=new Date(today);d.setDate(d.getDate()-n);const day=new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit'}).format(d);return {day,health:{version:1,status:'available',steps:null,sleepMinutes:450,restingHeartRateBpm:null,exerciseMinutes:null,workouts:[]}};});
 const written=await ctx.api('/health/records/batch',{items},'PUT');assert.equal(written.status,200);await ctx.save('h3-health-fixture.json',written);
 const actual=await ctx.api('/health/metrics/sleepMinutes?days=7');await ctx.save('h3-actual-metrics.json',actual);
 await newChat(ctx);await ctx.send('现在根据已同步的本周睡眠记录，我这周睡得怎么样？请说明记录天数、平均时长与数据限制。');
 await ctx.until(async()=>await ctx.page.locator('.message.assistant').count()>0&&!await ctx.page.getByRole('button',{name:'停止回复',exact:true}).isVisible(),120000);
 const result=await ctx.snapshot();await ctx.save('h3-with-data.json',result);await ctx.shot('h3-with-data');return {actual,result};
}
export async function uiPages(ctx){
 const {page}=ctx;const observed=[];
 for(const theme of ['light','dark']){
  await page.locator('#account-menu-trigger').click();await page.locator('#rail-account').click();
  await page.locator('.settings-nav-item[data-category="appearance"]').click();
  await page.locator(`.appearance-modes button[data-value="${theme}"]`).click();
  await ctx.until(()=>page.evaluate(t=>document.documentElement.dataset.theme===t,theme));
  await page.locator('.settings-nav-item[data-category="general"]').click();await ctx.shot(`u1-${theme}-settings`);
  observed.push({theme,page:'settings',text:await page.locator('#settings-dialog').innerText()});
  await page.locator('.settings-nav-item[data-category="memory"]').click();await ctx.until(async()=>await page.locator('#memory-list').isVisible()||(await page.locator('#settings-dialog').innerText()).includes('当前账户的这一类记忆为空。'),15000);await ctx.shot(`u1-${theme}-memory`);observed.push({theme,page:'memory',text:await page.locator('#settings-dialog').innerText()});
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  await ctx.shot(`u1-${theme}-sidebar`);
  const selected=page.locator('#session-list button.is-current');if(await selected.count())await selected.first().click();else await newChat(ctx);
  await ctx.shot(`u1-${theme}-chat`);observed.push({theme,page:'chat',...(await ctx.snapshot())});
  for(const [name,selector]of [['activity','.activity-entry'],['health','.health-entry'],['goals','.goals-entry'],['library','.library-entry']]){
   await page.locator(selector).click();await page.locator(`.${name}-surface`).waitFor({state:'visible'});
   const surface=page.locator(`.${name}-surface`);
   const loadingSettled=await ctx.until(async()=>!(await surface.innerText()).includes('正在读取')&&await surface.locator('[aria-busy="true"]:visible').count()===0,60000).then(()=>true,()=>false);
   await ctx.shot(`u1-${theme}-${name}`);observed.push({theme,page:name,loadingSettled,text:await surface.innerText()});
  }
 }
 await ctx.save('u1-pages.json',observed);assert.deepEqual(observed.filter(row=>row.loadingSettled===false).map(row=>`${row.theme}/${row.page}`),[],'U1: a page is still loading after 60 seconds');return observed;
}
export async function coldStart(ctx){
 const before={ui:await ctx.snapshot(),models:await ctx.api('/models'),notifications:await ctx.notices()};
 await ctx.save('c5-before.json',before);await ctx.app.close();await ctx.launch();
 await ctx.until(async()=>await ctx.page.locator('#message-text').isVisible(),90000);
 const after={ui:await ctx.snapshot(),models:await ctx.api('/models')};await ctx.save('c5-after.json',after);await ctx.shot('c5-cold-start');return after;
}
export async function inspectProgress(ctx,{language='zh'}={}){
 const block=ctx.page.locator('#transcript details.execution-block').last();await block.waitFor({state:'visible'});
 if(await block.evaluate(e=>e.open))await block.locator('summary').first().click();
 const summary=await block.locator('summary').first().innerText();await ctx.shot(`c10-${language}-collapsed`);
 await block.locator('summary').first().click();
 for(const step of await block.locator('details.execution-step').all()){if(!await step.evaluate(e=>e.open))await step.locator('summary').click();await ctx.until(async()=>!(await step.locator('pre').innerText()).includes('正在读取'),15000).catch(()=>{});}
 const details=await block.innerText();await ctx.save(`c10-${language}-details.json`,{summary,details});await ctx.shot(`c10-${language}-expanded`);
 assert.ok(language!=='en'||!/[\u3400-\u9fff]/.test(summary),'C10: an English conversation has a Chinese progress title');return {summary,details};
}
export async function askEnglishReminderList(ctx){
 await newChat(ctx);await ctx.send('Which reminders do I already have saved? Please check the actual list and reply in English without creating, deleting or changing any reminder.');
 const ui=await waitTurn(ctx,120000),schedules=await ctx.api('/schedules');await ctx.save('h5-english-reminder-query.json',{ui,schedules});return {ui,schedules};
}
export async function prepareWorkFixture(ctx,{directory='work-fixture'}={}){
 const root=join(ctx.output,directory);await mkdir(root,{recursive:true});
 const entries={'one.txt':'B1 synthetic text one','two.txt':'B1 synthetic text two','notes.md':'# B1 synthetic notes','data.csv':'kind,value\nsynthetic,42\n','data.json':'{"synthetic":true}','approve-delete.txt':'B1 approval yes','reject-delete.txt':'B1 approval no'};
 for(const [name,content]of Object.entries(entries))await writeFile(join(root,name),content,{flag:'wx'});
 const manifest=Object.entries(entries).map(([name,content])=>({name,sha256:createHash('sha256').update(content).digest('hex')}));
 await ctx.save('work-fixture.json',{root,manifest});
 await ctx.app.evaluate(({dialog},path)=>{globalThis.baselineOriginalOpenDialog=dialog.showOpenDialog;dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},root);
 return {root,manifest};
}
export async function switchToWorkRequest(ctx){
 await ctx.send('请把我选择的合成文件夹里的文件按扩展名分别整理到子文件夹。先切换到工作，让我选择文件夹，只操作选定的文件夹。');
 await ctx.until(async()=>await ctx.page.locator('.work-switch-card').isVisible()||await ctx.page.locator('#transcript').evaluate(el=>{const rows=[...el.querySelectorAll('.message')];const user=rows.findLastIndex(r=>r.classList.contains('user'));const answer=rows.findLastIndex(r=>r.classList.contains('assistant'));return user>=0&&answer>user;})&&!await ctx.page.getByRole('button',{name:'停止回复',exact:true}).isVisible(),90000).catch(()=>{});
 await ctx.shot('w3-switch-card');const result={cardVisible:await ctx.page.locator('.work-switch-card').isVisible(),...await ctx.snapshot()};await ctx.save('w3-request.json',result);return result;
}
export async function historyPagination(ctx,{reuseCurrentSeed=false}={}){
 if(!reuseCurrentSeed){await newChat(ctx);await ctx.send('C4 合成历史种子：为历史分页准备一个独立对话，请简短确认。');}
 assert.match(await ctx.page.locator('.message.user').last().innerText(),/C4.*(?:种子|分页)/,'Only the dedicated C4 fixture may receive synthetic history');
 await waitTurn(ctx);
 const sessionId=await ctx.page.locator('#session-list button.is-current').first().evaluate(el=>el.closest('[data-session-id]')?.dataset.sessionId);
 if(!sessionId)throw Error('Current native session identifier unavailable');
 await ctx.until(async()=>{const row=(await ctx.api('/sessions')).body.sessions.find(s=>s.sessionId===sessionId);return row?.running===false&&row.lastOutcome==='completed';},90000);
 const isolated=await ctx.api(`/sessions/${encodeURIComponent(sessionId)}/metadata`,{memoryMode:'off'},'PATCH');assert.equal(isolated.status,200);
 const startup=JSON.parse(await readFile(join(ctx.output,'startup.json'),'utf8'));
 await ctx.app.close();let prepared;try{prepared=await appendHistory({repository:ctx.input,profile:startup.profile,sessionId,output:ctx.output});await ctx.save('c4-prepared.json',prepared);}finally{await ctx.launch();}
 await ctx.page.locator(`[data-session-id="${sessionId}"] button`).first().click();
 await ctx.until(async()=>(await ctx.page.locator('#transcript').innerText()).includes('B1-HISTORY-1000'),90000);
 const before={count:await ctx.page.locator('.message').count(),text:await ctx.page.locator('#transcript').innerText()};await ctx.shot('c4-latest-first');
 await ctx.page.locator('#chat-scroll').hover();await ctx.page.mouse.wheel(0,-10000);
 const firstMarker=text=>Math.min(...[...text.matchAll(/B1-HISTORY-(\d{4})/g)].map(v=>+v[1]));
 await ctx.until(async()=>firstMarker(await ctx.page.locator('#transcript').innerText())<firstMarker(before.text),45000);
 const after={count:await ctx.page.locator('.message').count(),text:await ctx.page.locator('#transcript').innerText()};
 const result={prepared,before,after};await ctx.save('c4-pagination.json',result);await ctx.shot('c4-earlier-loaded');assert.ok(firstMarker(after.text)<firstMarker(before.text));return result;
}
