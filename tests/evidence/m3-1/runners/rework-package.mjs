import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {startTimelineCandidate} from '../../fx-16/runners/candidate.mjs';
const out=resolve('tests/evidence/m3-1/rework/android-package');await mkdir(out,{recursive:true});
const f=await startTimelineCandidate({interactive:true,inlineProgress:true,historyCount:0,baseTime:Date.now()-2000});
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:390,height:844}});const checks=[];
try{
  await page.goto(f.mobileUrl);await page.waitForFunction(()=>state.loggedIn&&state.booted);await page.evaluate(()=>{page('chat');uiCore.stopConnection();clearTimeout(state.sharedPollTimer);});
  await page.evaluate(async id=>{selectSharedSession(id);await loadSharedHistory();clearTimeout(state.sharedPollTimer);uiCore.stopConnection();},f.sessionId);
  await page.waitForTimeout(600);
  await page.evaluate(()=>{uiCore.openOfflineMode=()=>globalThis.WeftMobileCloud.core?.openOfflineMode?.();uiCore.connectionSucceeded=()=>{};uiCore.stopConnection();clearTimeout(state.sharedPollTimer);});
  for(const width of [390,360])for(const theme of ['light','dark'])for(const kind of ['connecting','host_offline']){
    await page.setViewportSize({width,height:width===360?780:844});
    await page.evaluate(({theme,kind})=>{
      document.documentElement.dataset.theme=theme;
      state.chatSource='host';state.sharedPending={requestId:'m31-synthetic-pending',state:'uncertain',text:'这条消息的发送结果需要核对。'};
      const row=uiCore.beginOptimistic({sessionId:state.sharedSessionId,requestId:'m31-synthetic-pending',text:'这条消息的发送结果需要核对。'});row.status='failed';
      uiCore.presence.success({runtime:'ready'});
      if(kind==='host_offline')uiCore.presence.failure({code:'HOST_OFFLINE'},{independent:true,cloudOffline:true});else uiCore.presence.failure({code:'NETWORK'});
      state.sharedRunning=true;status('主对话暂时无法读取，请重试');status('离线副本同步未完成，请稍后重试。');renderSharedConversation();$('toast').hidden=true;
    },{theme,kind});
    await page.waitForTimeout(150);
    const result=await page.evaluate(()=>{
      const slot=document.querySelector('.composer-above-slot'),bar=document.querySelector('.presence-bar'),field=$('draft');
      return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,slotHeight:slot.getBoundingClientRect().height,priority:slot.dataset.priority,visibleAbove:[...slot.querySelectorAll('[data-composer-above]')].filter(n=>!n.hidden&&getComputedStyle(n).display!=='none').length,
        pendingCopies:($('chat-content').textContent.match(/发送结果待核对/g)||[]).length,status:$('chat-status').textContent,readErrors:[...document.querySelectorAll('.chat-read-notice')].filter(n=>!n.hidden).length,buttons:[...bar.querySelectorAll('button')].filter(n=>!n.hidden).map(n=>({text:n.textContent,rect:n.getBoundingClientRect().toJSON(),minWidth:getComputedStyle(n).minWidth,padding:getComputedStyle(n).padding})),copy:{rect:bar.querySelector('.presence-copy').getBoundingClientRect().toJSON(),style:getComputedStyle(bar.querySelector('.presence-copy')).minWidth},actions:bar.querySelector('.presence-actions').getBoundingClientRect().toJSON(),bar:bar.getBoundingClientRect().toJSON(),field:field.getBoundingClientRect().toJSON()};
    });
    assert.equal(result.overflow,false);for(const button of result.buttons){assert.ok(button.rect.height>=40&&button.rect.height<=44);assert.ok(button.rect.right<=result.bar.right&&button.rect.left>=result.bar.left);}assert.equal(result.visibleAbove,1);assert.equal(result.priority,'connection');assert.equal(result.slotHeight,44);assert.equal(result.pendingCopies,1);assert.equal(result.status,'');assert.equal(result.readErrors,0);assert.ok(result.bar.bottom<=result.field.top);
    await page.screenshot({path:join(out,`android-package-${width}-${theme}-${kind}.png`)});checks.push({theme,kind,...result});
    if(kind==='host_offline'){
      await page.evaluate(()=>uiCore.presence.success({runtime:'ready'}));await page.waitForTimeout(80);
      const toast=await page.locator('#toast').boundingBox(),field=await page.locator('#draft').boundingBox();
      assert.ok(toast&&field&&toast.y+toast.height<field.y);
      await page.screenshot({path:join(out,`android-package-${width}-${theme}-recovered-toast.png`)});checks.push({width,theme,scene:'recovered-toast',toast,field});
    }

  }
}catch(error){await page.screenshot({path:join(out,'failure.png')});console.error(await page.locator('body').innerText());throw error;}
finally{await browser.close();await f.close();await writeFile(join(out,'verification.json'),JSON.stringify({androidNative:false,reason:'AND-1 owns MuMu; actual UI package in Chromium, no synthetic system bars',checks},null,2));}
