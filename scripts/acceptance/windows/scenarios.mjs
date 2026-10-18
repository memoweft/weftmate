// Scenario actions always operate on the installed renderer; assertions use visible UI.
import assert from 'node:assert/strict';
export async function onboarding(ctx){
 const {page,until}=ctx;
 const heading=page.locator('section.onboarding h1');
 for(let n=0;n<4;n++){
  if((await heading.innerText()).includes('选一个一起工作的模型'))break;
  const name=page.getByRole('textbox',{name:'怎么称呼你',exact:true});
  if(await name.isVisible())await name.fill('合成验收用户');
  await page.getByRole('button',{name:'继续',exact:true}).click();
 }
 await page.getByRole('button',{name:'选择模型服务',exact:true}).click();
 await page.getByRole('menuitem',{name:'MiMo',exact:true}).click();
 await page.getByRole('textbox',{name:'模型服务名称',exact:true}).fill('MiMo 基线');
 await ctx.fillKey(page.getByLabel('密钥',{exact:true}));
 await page.getByRole('button',{name:'重新查询模型',exact:true}).click();
 await until(async()=>{const t=await page.locator('.onboarding-diagnostic').innerText();return t&&!t.includes('正在读取');},60000);
 await ctx.shot('01-model-catalog');
 await page.getByRole('button',{name:'继续',exact:true}).click();
 await until(async()=>!(await heading.innerText()).includes('选一个一起工作的模型'));
 await ctx.save('onboarding-memory.txt',await page.locator('section.onboarding').innerText());
 await ctx.shot('02-bundled-memory');
 for(let n=0;n<5;n++){
  if((await heading.innerText()).includes('现在，说出第一句话'))break;
  const skip=page.getByRole('button',{name:'跳过这步',exact:true});
  if(await skip.isVisible())await skip.click();else await page.getByRole('button',{name:'继续',exact:true}).click();
 }
 await page.getByRole('button',{name:'开始聊天',exact:true}).click();
 await page.locator('#message-text').waitFor({state:'visible'});
 return ctx.snapshot();
}
export async function newChat(ctx){
 await ctx.page.locator('#new-session').click();
 await ctx.page.locator('#message-text').waitFor({state:'visible'});
}
export async function waitReply(ctx,needle,timeout=120000){
 await ctx.until(async()=>{const rows=ctx.page.locator('.message.assistant');if(!await rows.count())return false;const t=await rows.last().innerText();return t.includes(needle)&&!await ctx.page.locator('#send-message[data-action="stop"]').isVisible();},timeout);
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
 await newChat(ctx);await ctx.send('我喜欢喝什么？');const result=await waitReply(ctx,'红茶');await ctx.shot('m1-recall');await ctx.save('m1-recall.json',result);return result;
}
export async function memoryCorrect(ctx){
 await newChat(ctx);await ctx.send('我其实更喜欢绿茶');await waitReply(ctx,'绿茶');await ctx.shot('m2-correct');
 await newChat(ctx);await ctx.send('我喜欢喝什么？');const result=await waitReply(ctx,'绿茶');await ctx.shot('m2-recall');await ctx.save('m2-recall.json',result);return result;
}
export async function queueAndStop(ctx){
 await newChat(ctx);await ctx.send('请从1开始逐行写到2000，每行写「数字 合成排队验收」，不要省略。');
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
