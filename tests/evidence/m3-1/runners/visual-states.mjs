import assert from 'node:assert/strict';
import {_electron,chromium} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {startTimelineCandidate} from '../../fx-16/runners/candidate.mjs';
import {localUiSession} from '../../../helpers/local-ui-session.mjs';
const out=resolve(process.env.M31_VISUAL_OUT || 'tests/evidence/m3-1/states'),profile=await mkdtemp(join(tmpdir(),'weftmate-m31-visual-'));await mkdir(out,{recursive:true});
const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_|CLOUD_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
const fixture=await startTimelineCandidate({interactive:true,inlineProgress:true,historyCount:0,baseTime:Date.now()-2000});let app,browser;const checks=[];
try{
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:['scripts/review-gallery/electron.mjs'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:fixture.origin,REVIEW_THEME:'light'},cwd:resolve('.')});const desktop=await app.firstWindow();browser=await chromium.launch();const mobile=await browser.newPage({viewport:{width:390,height:844}});
 for(const [name,page,widths]of [['electron',desktop,[1200,480]],['phone-web',mobile,[390,360]]]){
  await page.route('**/personal/v1/ui/app.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('    ui.loadAttachmentHasher','    globalThis.m31Core=core;globalThis.m31Ui=ui;\n    ui.loadAttachmentHasher')});});
  if(name==='phone-web')await page.goto(fixture.origin+'/personal/v1/ui');else await page.reload();await localUiSession(page,fixture.credentials,'M3 visual states');await page.locator('#assistant-view').waitFor();if(process.env.M31_REWORK_COMBINED_ONLY)await page.evaluate(async id=>{await m31Core.selectSession(id);},fixture.sessionId);if(await page.getByRole('button',{name:'停止回复',exact:true}).isVisible()){await page.getByRole('button',{name:'停止回复',exact:true}).click();await page.waitForTimeout(300);}await page.evaluate(()=>{m31Core.stopAssistantRefresh();m31Core.stopConnection();});await page.waitForTimeout(600);await page.evaluate(()=>{m31Core.connectionSucceeded=()=>{};});
  for(const width of widths){if(name==='electron')await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setSize(width,800),width);else await page.setViewportSize({width,height:width===360?780:844});
   for(const theme of ['light','dark'])for(const kind of (process.env.M31_REWORK_COMBINED_ONLY?[]:['online','connecting','host_offline','network_unavailable','login_required','approval_required'])){
    await page.evaluate(({theme,kind})=>{document.documentElement.dataset.theme=theme;m31Core.presence.success({runtime:'ready'});if(kind==='connecting')m31Core.presence.failure({code:'NETWORK'});else if(kind==='host_offline')m31Core.presence.failure({code:'HOST_OFFLINE'},{independent:true,cloudOffline:true});else if(kind==='network_unavailable')m31Core.presence.network(false);else if(kind!=='online')m31Core.presence.authorization(kind);},{theme,kind});
    await page.waitForTimeout(kind==='online'?3200:500);await page.evaluate(()=>{document.getElementById('toast').hidden=true;});await page.screenshot({path:join(out,`${name}-${width}-${theme}-${kind}.png`)});
    const geometry=await page.evaluate(()=>{const bar=document.querySelector('.presence-bar'),field=document.getElementById('message-text');return {overflow:document.documentElement.scrollWidth>innerWidth,bar:bar.getBoundingClientRect().toJSON(),field:field.getBoundingClientRect().toJSON(),height:innerHeight,slotHeight:document.querySelector('.composer-above-slot').getBoundingClientRect().height, priority:document.querySelector('.composer-above-slot').dataset.priority, visibleAbove:[...document.querySelectorAll('[data-composer-above]')].filter(n=>getComputedStyle(n).display!=='none'&&!n.hidden).length, badgeVisible:document.querySelector('.presence-badge').getBoundingClientRect().height>0};});assert.equal(geometry.overflow,false);assert.ok(geometry.visibleAbove<=1);assert.ok(geometry.slotHeight===40||geometry.slotHeight===44);assert.ok(geometry.badgeVisible);assert.ok(geometry.bar.bottom<=geometry.field.top||kind==='online');checks.push({name,width,theme,kind,projection:true,...geometry});
   }
   for(const theme of ['light','dark']){
    await page.evaluate(theme=>{
      document.documentElement.dataset.theme=theme;m31Core.presence.success({runtime:'ready'});
      m31Core.beginOptimistic({sessionId:m31Core.state.selectedSessionId,requestId:'m31-review-unconfirmed',text:'这条消息的发送结果需要核对。'}).status='failed';
      m31Core.presence.failure({code:'HOST_OFFLINE'},{independent:true,cloudOffline:true});
      m31Ui.historyNotice('主对话暂时无法读取，请重试。');m31Ui.updateAvailability();document.getElementById('toast').hidden=true;
    },theme);await page.waitForTimeout(500);
    const pending=await page.evaluate(()=>({copies:(document.getElementById('transcript').textContent.match(/发送结果待核对/g)||[]).length,readHidden:document.getElementById('timeline-status').hidden}));
    assert.equal(pending.copies,1,JSON.stringify(await page.evaluate(()=>({selected:m31Core.state.selectedSessionId,main:m31Core.inMainChat(),rows:m31Core.optimisticMessages(),text:document.getElementById('transcript').textContent}))));assert.equal(pending.readHidden,true);
    await page.screenshot({path:join(out,`${name}-${width}-${theme}-unconfirmed-offline.png`)});checks.push({name,width,theme,scene:'unconfirmed-offline',...pending});
    await page.evaluate(()=>{globalThis.m31PaintBeforePriority={updateAvailability:m31Ui.updateAvailability,renderConversationApprovals:m31Ui.renderConversationApprovals,renderConversationQuestions:m31Ui.renderConversationQuestions};for(const name of Object.keys(m31PaintBeforePriority))m31Ui[name]=()=>{};});
    for(const priority of ['approval','question']){
      await page.evaluate(priority=>{
        const a=document.getElementById('approval-bar'),q=document.getElementById('question-bar');
        a.hidden=priority!=='approval';q.hidden=priority!=='question';
        const row=priority==='approval'?a:q;row.replaceChildren(Object.assign(document.createElement('span'),{textContent:priority==='approval'?'请批准本次操作':'请选择回答'}));
        m31Core.syncNextSuggestions=()=>{};m31Ui.nextSuggestions.paint();
      },priority);await page.waitForTimeout(500);
      const chosen=await page.evaluate(()=>{const slot=document.querySelector('.composer-above-slot');return {priority:slot.dataset.priority,visible:[...slot.querySelectorAll('[data-composer-above]')].filter(n=>!n.hidden&&getComputedStyle(n).display!=='none').length};});
      assert.equal(chosen.priority,priority);assert.equal(chosen.visible,1);
      await page.screenshot({path:join(out,`${name}-${width}-${theme}-${priority}-priority.png`)});checks.push({name,width,theme,scene:'priority',...chosen});
    }
    await page.evaluate(()=>{document.getElementById('approval-bar').hidden=true;document.getElementById('question-bar').hidden=true;Object.assign(m31Ui,m31PaintBeforePriority);});
   }

  }
 }
}finally{await browser?.close();await app?.close();await fixture.close();await rm(profile,{recursive:true,force:true});await writeFile(join(out,process.env.M31_REWORK_COMBINED_ONLY?'combined-verification.json':'verification.json'),JSON.stringify({realElectron:true,syntheticPresentation:true,checks},null,2));}
