/** Production phone UI, synthetic account, random ports and logical native bridge. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {startTimelineCandidate} from './timeline-ui-candidate.mjs';
const evidence=resolve(import.meta.dirname,'../evidence/ia-4');await mkdir(evidence,{recursive:true});
const web=process.argv.includes('--web');
const f=await startTimelineCandidate({daily:true,sidebar:true,logicalMobile:true,interactive:true,inlineProgress:true,historyCount:0,baseTime:Date.now()-15000});
const host=(await f.request('/status')).hostId,main=(await f.request('/chats/main')).chat;
async function command(body){let row=(await f.request('/commands',{requestId:randomUUID(),targetDeviceId:host,...body})).command;
  for(let i=0;i<100;i++){if(row.state==='accepted_by_dsh')return row;assert.notEqual(row.state,'rejected',JSON.stringify(row));await new Promise(r=>setTimeout(r,20));row=(await f.request(`/commands/${row.commandId}`)).command;}throw Error('command timeout');}
const first=await command({kind:'chat.message',chatId:main.chatId,modelProfileId:'local',text:'合成手机首句'});
f.seedMainHistory(first.sessionId,10000,{mixed:true});
for(const [state,reason]of [['completed','completed'],['failed','error'],['stopped','aborted']]){
  const side=await command({kind:'session.side.create',parent:{kind:'main',id:main.chatId},modelProfileId:'local',title:`合成手机结果 ${state}`});
  const task=await command({kind:'session.message',sessionId:side.sessionId,text:`合成任务 ${state}`});f.progress.text(`合成手机结果摘要 ${state}`);f.progress.finish(reason);
  const history=await f.request(`/chats/${side.chatId}/events?limit=50`),event=history.items.findLast(event=>event.type==='assistant.message'),current=(await f.request(`/chats/${side.chatId}`)).chat;
  await f.request(`/chats/${side.chatId}/results`,{requestId:randomUUID(),sourceEventId:event.eventId,expectedRevision:current.revision,taskId:task.commandId});
}
const report={synthetic:true,productionMobile:true,historyMessages:10000,checks:[],errors:[],performance:{}};
let browser;
try{
  browser=await chromium.launch({headless:true,channel:'chrome',args:['--js-flags=--expose-gc','--enable-precise-memory-info']});
  for(const size of [{width:390,height:844},{width:360,height:780}]){
    const page=await browser.newPage({viewport:size,isMobile:true,hasTouch:true});page.setDefaultTimeout(15000);
    page.on('pageerror',error=>{report.errors.push(error.message);console.log(error.stack);});
    if(web){
      await page.route('**/bridge.js',route=>route.fulfill({contentType:'text/javascript',body:'// Real browser transport.'}));
      await page.route('**/personal/v1/**',async route=>{const response=await route.fetch({url:f.origin+new URL(route.request().url()).pathname+new URL(route.request().url()).search,headers:{...route.request().headers(),origin:f.origin}});await route.fulfill({response});});
      const login=await page.request.post(f.origin+'/personal/v1/auth/login',{data:f.credentials,headers:{origin:f.origin}}),identity=await login.json();assert.equal(login.status(),200);
      await page.goto(f.mobileUrl);await page.waitForFunction(()=>state.booted);
      await page.evaluate(async identity=>{state.loggedIn=true;state.owner=identity.account.ownerId;state.username=identity.account.username;state.deviceId=identity.device.id;state.authEpoch++;document.body.classList.remove('cloud-auth-active');$('cloud-auth-page').classList.remove('active');uiCore.syncMobileIdentity();await listSharedSessions();await uiCore.selectMainChat();},identity);
    }else
    await page.goto(f.mobileUrl);await page.getByRole('textbox',{name:'输入消息',exact:true}).waitFor();
    await page.waitForFunction(()=>uiCore.inMainChat()&&document.querySelector('.main-chat-row.message'));
    const b=name=>page.getByRole('button',{name,exact:true});
    console.log('loaded',size);
    for(const theme of ['light','dark']){
      await page.evaluate(theme=>applyTheme(theme),theme);
      await page.screenshot({path:join(evidence,`web-${size.width}-${theme}-recent.png`)});
      await b('搜索主对话').click();await page.getByRole('searchbox',{name:'主对话搜索关键词'}).fill('合成手机结果摘要');await b('查找').click();
      for(const label of ['成功','失败','停止'])await page.getByRole('button',{name:new RegExp(`^打开旁聊结果：${label}`)}).waitFor();
      await b('关闭主对话搜索').click();
      await page.getByRole('button',{name:/^打开旁聊结果：停止/}).click();await page.getByRole('button',{name:'打开导航',exact:true}).click();await b('WeftMate 主对话').click();
      await b('搜索主对话').click();await page.getByRole('searchbox',{name:'主对话搜索关键词'}).fill('纸船');await b('查找').click();
      await page.locator('mark').first().waitFor();await b('下一条搜索结果').click();await b('上一条搜索结果').click();
      await page.screenshot({path:join(evidence,`web-${size.width}-${theme}-search.png`)});await b('关闭主对话搜索').click();
      const date=new Date(Date.now()-6*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'}),label=`${Number(date.slice(5,7))} 月 ${Number(date.slice(8))} 日`;
      await b('跳到日期').click();await page.getByRole('textbox',{name:'跳到日期',exact:true}).fill(date);
      await b(`${label}，收起`).click();await page.getByRole('button',{name:new RegExp(`^${label} · \\d+ 条，展开$`)}).click();
      await page.screenshot({path:join(evidence,`web-${size.width}-${theme}-date.png`)});
      const visibleName=await page.evaluate(()=>{const box=document.querySelector('#chat-scroll').getBoundingClientRect();return [...document.querySelectorAll('[role=group][aria-label]')].find(row=>{const r=row.getBoundingClientRect();return r.top>=box.top&&r.bottom<=box.bottom;})?.getAttribute('aria-label');});
      assert.ok(visibleName);const row=page.getByRole('group',{name:visibleName,exact:true});await row.click();await row.getByLabel('消息菜单',{exact:true}).click();
      await row.getByRole('button',{name:'从这里开旁聊',exact:true}).click();
      await page.getByRole('textbox',{name:'旁聊名称'}).fill('合成手机旁聊');await page.getByRole('textbox',{name:'旁聊第一句话'}).fill('合成草稿');await b('确认开旁聊').click();
      await page.getByRole('dialog',{name:'开旁聊',exact:true}).waitFor({state:'hidden'});
      await page.getByText('相关上下文尚未带入',{exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'输入消息',exact:true}).inputValue(),'合成草稿');
      await page.screenshot({path:join(evidence,`web-${size.width}-${theme}-origin.png`)});await b('回到主对话原消息').click();
      await b('打开导航').click();await b('WeftMate 主对话').click();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    }
    await page.evaluate(()=>document.documentElement.style.fontSize='130%');await page.screenshot({path:join(evidence,`web-${size.width}-font130.png`)});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    if(size.width===390){
      const duration=Number(process.env.IA4_SCROLL_MS||60000);
      await command({kind:'chat.message',chatId:main.chatId,modelProfileId:'local',text:'合成万条滚动与流式更新'});f.progress.call('read','ia4-scroll-read',{paths:['synthetic.md']});f.progress.result('ia4-scroll-read','synthetic contents');
      await page.evaluate(async()=>{await uiCore.selectMainChat();for(let n=0;n<5;n++)await uiCore.loadOlderLogicalHistory();for(const day of uiCore.mainChatDays())uiCore.expandChatDay(day.date);mobileEffects.scrollToLatest();});
      const cdp=await page.context().newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');report.performance.tenThousandHeapBytes=(await cdp.send('Runtime.getHeapUsage')).usedSize;
      let scrolling=true;const gestures=(async()=>{await page.mouse.move(190,350);while(scrolling){await page.mouse.wheel(0,-380);await new Promise(r=>setTimeout(r,180));}})();
      let streamed=0;const stream=setInterval(()=>f.progress.text(`合成流式更新 ${++streamed}：纸船仍在核对。`),800);
      try{
      report.performance.scroll=await page.evaluate(async duration=>{
        const box=document.querySelector('#chat-scroll'),frames=[],blocks=[];let last=performance.now(),maxRows=0;
        const observer=new PerformanceObserver(list=>blocks.push(...list.getEntries().map(row=>row.duration)));observer.observe({type:'longtask',buffered:false});
        const start=last;await new Promise(done=>{function tick(now){frames.push(now-last);last=now;maxRows=Math.max(maxRows,document.querySelectorAll('.main-chat-row').length);
          if(now-start<duration)requestAnimationFrame(tick);else done();}requestAnimationFrame(tick);});observer.disconnect();
        frames.sort((a,b)=>a-b);return {durationMs:performance.now()-start,frames:frames.length,p95Ms:frames[Math.ceil(frames.length*.95)-1],maxMs:Math.max(...frames),maxRows,longTasks:blocks,cacheRows:uiCore.state.chatWindow.events.size,heapBytes:performance.memory?.usedJSHeapSize};
      },duration);
      }finally{clearInterval(stream);scrolling=false;await gestures;f.progress.finish('completed');}report.performance.streamedUpdates=streamed;
    }
    await page.close();
  }
  assert.deepEqual(report.errors,[]);report.checks.push('main-first','recent-tail','search-highlight-navigation','date-fold-unfold','side-reference-origin','draft-transfer','result-success-failure-stop-source','both-themes-two-sizes','font130-no-overflow');
  await writeFile(join(evidence,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await browser?.close();await f.close();}
