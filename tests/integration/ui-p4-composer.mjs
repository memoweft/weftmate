/** Real production Electron shell + isolated personal host; synthetic data only. */
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
const before = process.argv.includes('--before');
const root = resolve(import.meta.dirname, '../..'), evidence = join(root, 'tests/evidence/ui-p4');
mkdirSync(evidence, {recursive:true});
const env = {...process.env};
for (const key of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_)/.test(key) || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
const report = {syntheticOnly:true, before, checks:[]};
const errors=[];
const gap = page=>page.evaluate(()=>{const b=document.getElementById('chat-scroll');return b.scrollHeight-b.clientHeight-b.scrollTop});
async function bottom(page){await page.waitForFunction(()=>{const b=document.getElementById('chat-scroll');return b.scrollHeight-b.clientHeight-b.scrollTop<=2});}
for (const theme of ['light','dark']) {
  const fixture = await startTimelineCandidate({historyCount:20,interactive:true,inlineProgress:true,composer:!before,baseTime:Date.now()-15000});
  if(!before)await fixture.request(`/sessions/${fixture.sessionId}/approval-mode`,{mode:'allow-all'},'PATCH');
  const profile = mkdtempSync(join(tmpdir(),'weftmate-ui-p4-'));
  let app, browser;
  try {
    app = await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:root,
      args:['scripts/review-gallery/electron.mjs','--force-device-scale-factor=1'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:fixture.origin,REVIEW_THEME:theme}});
    const desktop = await app.firstWindow(); await localUiSession(desktop,fixture.credentials);
    desktop.on('pageerror',error=>errors.push(error.message));
    browser = await chromium.launch({headless:true});
    const remote = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    await remote.goto(fixture.origin+'/personal/v1/ui'); await localUiSession(remote,fixture.credentials);
    const mobile = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    mobile.on('pageerror',error=>errors.push(error.message));remote.on('pageerror',error=>errors.push(error.message));
    await mobile.goto(fixture.mobileUrl); await mobile.getByRole('button',{name:'项目进度报告 正在运行',exact:true}).click();
    const surfaces = [['desktop',desktop],['mobile-web',remote],['mobile',mobile]];
    for (const [surface,page] of surfaces) {
      await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
      const shot = async name=>{await page.screenshot({path:join(evidence,`${before?'before':'after'}-${surface}-${theme}-${name}.png`)});};
      await shot('03-stop'); await shot('04-layout'); await shot('05-context');
      if(!before){
        await page.getByRole('button',{name:'停止回复',exact:true}).waitFor();
        const ring=page.getByRole('button',{name:'背景信息窗口：86% 已用',exact:true});
        await ring.click(); await page.getByRole('tooltip').waitFor();
        assert.match(await page.getByRole('tooltip').textContent(),/已用 713k 标记，共 828k/);await shot('05-context-tooltip');
      }
      const input = page.getByRole('textbox',{name:/输入消息|消息/}).first(); await input.fill('合成输入区验收');
      await shot('03-running-draft'); await input.fill('');
      if (surface==='desktop'||!before) {
        const text=`合成即时消息 ${surface} ${theme}`;
        await input.fill(text);
        if(!before)await page.route('**/personal/v1/commands',async route=>{const response=await route.fetch();await new Promise(done=>setTimeout(done,650));await route.fulfill({response});});
        await page.evaluate(text=>{
          window.p4Start=0;window.p4Elapsed=null;
          const form=document.getElementById('message-form'),send=document.getElementById('send-button');
          (form||send).addEventListener(form?'submit':'click',()=>window.p4Start=performance.now(),{capture:true,once:true});
          const content=document.getElementById('transcript')||document.getElementById('chat-content');
          const observer=new MutationObserver(()=>{if(content.textContent.includes(text)&&window.p4Start){window.p4Elapsed=performance.now()-window.p4Start;observer.disconnect();}});
          observer.observe(content,{subtree:true,childList:true,characterData:true});
        },text);
        await page.getByRole('button',{name:'发送',exact:true}).click();
        await shot('01-sending');
        await page.waitForFunction(()=>window.p4Elapsed!==null);
        const elapsed=await page.evaluate(()=>window.p4Elapsed);
        if(!before){assert.ok(elapsed<100);await bottom(page);await input.waitFor();await page.waitForFunction(()=>!(document.getElementById('message-text')||document.getElementById('draft')).value);await page.unroute('**/personal/v1/commands');}
        report.checks.push({surface,theme,sendToBubbleMs:elapsed});console.log(theme,'sendToBubbleMs',elapsed);
      }
      for(let n=0;n<12;n++)fixture.progress.text(`合成长回复 ${n}：用于检查跟随到底部和保留历史阅读位置。\n\n`.repeat(3));
      await page.getByText(/合成长回复 11/).first().waitFor(); await shot('02-bottom');
      if(!before)await bottom(page);
      await page.evaluate(()=>{const box=document.getElementById('chat-scroll');box.scrollTop=box.scrollHeight/3;});
      await page.waitForTimeout(150);
      const prior=await page.evaluate(()=>document.getElementById('chat-scroll').scrollTop);
      const incoming=`合成新内容 ${surface} ${theme}：阅读历史时保持位置。`;fixture.progress.text(incoming);
      await page.getByText(incoming,{exact:true}).first().waitFor(); await shot('02-history');
      if(!before){assert.ok(Math.abs(await page.evaluate(()=>document.getElementById('chat-scroll').scrollTop)-prior)<3);
        const jump=page.getByRole('button',{name:'回到底部',exact:true});assert.equal(await jump.isVisible(),true);assert.match(await jump.textContent(),/有新内容/);
        await jump.click();await bottom(page);await shot('02-returned-bottom');
        const id=`p4-tool-${surface}-${theme}`;fixture.progress.call('read',id,{path:'合成设置.md'});fixture.progress.result(id,'合成详情\n'.repeat(14));
        const progress=page.getByRole('button',{name:/已读取|读取了 1 个文件.*已收起/}).last();
        await progress.waitFor();await bottom(page);await progress.click();await bottom(page);await shot('02-progress-expanded');
        await page.getByRole('button',{name:/读取了 1 个文件.*已展开/}).last().click();await bottom(page);
        await page.evaluate(()=>{const content=document.getElementById('transcript')||document.getElementById('chat-content');const image=document.createElement('img');image.alt='合成延迟加载图片';image.style.width='100%';content.append(image);setTimeout(()=>image.src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240"><rect width="640" height="240" fill="#edf1f5"/><text x="320" y="125" text-anchor="middle" fill="#3d4650" font-size="24">合成图片 · 加载完成</text></svg>'),150);});
        await page.getByRole('img',{name:'合成延迟加载图片'}).evaluate(image=>image.complete?Promise.resolve():new Promise(done=>image.addEventListener('load',done,{once:true})));await bottom(page);await shot('02-image-loaded');
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        report.checks.push({surface,theme,pinnedGap:await gap(page),historyPreserved:true,jumpNewContent:true,progressResize:true,imageLoad:true,contextTooltip:true});
      }
      if(surface==='desktop') {await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(480,800));await shot('06-narrow');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1200,800));}
      else await shot('06-narrow');
      if(!before)assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      if(!before){
        const failedText=`合成失败重试 ${surface} ${theme}`,ids=[];
        await input.fill(failedText);
        const pattern=surface==='mobile'?'**/bridge':'**/personal/v1/commands';let fail=true;
        await page.route(pattern,route=>{const body=route.request().postDataJSON();
          if(surface!=='mobile'||body.method==='shared.send'){ids.push(surface==='mobile'?body.params.requestId:body.requestId);if(fail){fail=false;return route.abort();}}
          return route.continue();});
        await page.getByRole('button',{name:'发送',exact:true}).click();
        const retry=page.getByRole('button',{name:'重试发送',exact:true});await retry.waitFor();
        assert.equal(await input.inputValue(),failedText);await shot('01-failed-draft-retained');
        await retry.click();await page.waitForFunction(()=>!(document.getElementById('message-text')||document.getElementById('draft')).value);
        await page.waitForFunction(text=>{const content=document.getElementById('transcript')||document.getElementById('chat-content');return [...content.children].filter(row=>row.textContent.includes(text)).length===1},failedText);
        assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);await page.unroute(pattern);await shot('01-retry-confirmed');
        report.checks.push({surface,theme,retrySameRequestId:true,draftRetained:true,oneMessageAfterAck:true});
      }
    }
    if(!before){
      fixture.progress.context({usedTokens:12000,contextWindow:null});fixture.progress.finish();
      for(const [surface,page]of surfaces){await page.getByRole('button',{name:'发送',exact:true}).waitFor();await page.screenshot({path:join(evidence,`after-${surface}-${theme}-03-idle.png`)});
        const ring=page.getByRole('button',{name:'背景信息窗口：用量待确认',exact:true});await ring.waitFor();await ring.click();await page.getByRole('tooltip').waitFor();assert.match(await page.getByRole('tooltip').textContent(),/已用 12k 标记，上限未知/);await page.screenshot({path:join(evidence,`after-${surface}-${theme}-05-unknown-limit.png`)});}
    }
  } finally {await browser?.close();await app?.close();await fixture.close();assert.ok(fixture.root.startsWith(join(tmpdir(),'weftmate-m0-3-')));rmSync(fixture.root,{recursive:true,force:true});rmSync(profile,{recursive:true,force:true});}
}
assert.deepEqual(errors,[]);report.errors=errors;
writeFileSync(join(evidence,before?'before.json':'checks.json'),JSON.stringify(report,null,2)+'\n');
