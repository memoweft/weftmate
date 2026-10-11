// Synthetic accounts, production Electron shell and a real authenticated cloud.
// Only cloud-login preparation/transport is injected; no GitHub network traffic.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startFixture } from './ux-4-fixture.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
import { fixture as cloudFixture } from '../../services/cloud/test/identity-helpers.mjs';
import { registration, appDevice, control } from '../../services/cloud/test/app-helpers.mjs';
import { createProcessEvidence } from '../helpers/process-evidence.mjs';

const evidence=resolve('tests/evidence/r0-4');await mkdir(evidence,{recursive:true});
const teardown=[],received=[],checks=[],errors=[];
let mode='ready';
const github=createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const value=JSON.parse(Buffer.concat(chunks));received.push(value);
  res.writeHead(mode==='github-failure'?403:201,{'content-type':'application/json'});res.end(JSON.stringify({number:42}));
});
await new Promise(r=>github.listen(0,'127.0.0.1',r));
const cloud=await cloudFixture({after:fn=>teardown.push(fn)},{env:{CLOUD_FEEDBACK_REPOSITORY:'synthetic/feedback',CLOUD_FEEDBACK_TOKEN:'synthetic-token'},
  feedbackFetch:async(_url,options)=>{
    const response=await fetch(`http://127.0.0.1:${github.address().port}/issues`,options);return response;
  }});
await registration(cloud);const device=await appDevice(cloud,'desktop');
const unconfigured=await cloudFixture({after:fn=>teardown.push(fn)});await registration(unconfigured);const noTokenDevice=await appDevice(unconfigured,'desktop');
try {
  for(const surface of ['desktop','mobile-web','mobile-ui']) {
    const f=await startFixture(),profile=await mkdtemp(join(tmpdir(),'weftmate-r04-electron-'));let app,browser,page,failed=false;
    const executable=createRequire(import.meta.url)('electron');
    const processEvidence=createProcessEvidence({outputDir:join(evidence,'process',surface),profileDirectory:profile,commandRoots:[resolve('.')],executables:[process.execPath,executable]});
    try {
      const captureScript=async route=>{if(new URL(route.request().url()).pathname.includes('/ui-core/'))return route.continue();const response=await route.fetch();await route.fulfill({response,body:(await response.text())+`\n{const create=WeftMessageActions.create;WeftMessageActions.create=options=>{window.__feedbackCore=options.core;window.__feedbackActions=create(options);return window.__feedbackActions;};}`});};
      if(surface==='desktop') {
        const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
        env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
        try { app=await _electron.launch({executablePath:executable,cwd:resolve('.'),args:['scripts/review-gallery/electron.mjs'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:f.origin,REVIEW_THEME:'light'}}); }
        catch(error){processEvidence.recordLaunchFailure(error,'last-stage: launch-electron');throw error;}
        processEvidence.track(app.process(),{label:'production-electron',executable});
        page=await app.firstWindow();await page.route('**/message-actions.js',captureScript);await localUiSession(page,f.credentials);
      } else {
        browser=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:true,viewport:{width:390,height:844},isMobile:true,hasTouch:true});page=await browser.newPage();
        await page.route('**/message-actions.js',captureScript);await page.goto(surface==='mobile-web'?f.origin+'/personal/v1/ui':f.mobileUrl);
        if(surface==='mobile-web')await localUiSession(page,f.credentials);
        else {await page.waitForFunction(()=>state.booted);await page.evaluate(()=>listSharedSessions());await page.getByRole('button',{name:'打开导航',exact:true}).click();await page.getByRole('button',{name:'合成消息操作',exact:true}).last().click();}
      }
      page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push({surface,error:error.message}));
      await page.getByRole('button',{name:'没用',exact:true}).last().waitFor();
      await page.exposeFunction('__feedbackTransport',async payload=>{
        const result=await control(mode==='unconfigured'?noTokenDevice:device,'/feedback',payload,mode==='unconfigured'?503:mode==='github-failure'?502:201);
        if(result.status!==201)throw Error(result.data.error.code);
        return result.data;
      });
      await page.evaluate(surface=>{
        window.__copies=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.__copies.push(text)},configurable:true});
        const core=surface==='mobile-ui'?WeftUiCore.create({hostOrigin:location.origin}):window.__feedbackCore;
        core.initializeCloudAccount();core.state.cloudAuth.mode='authenticated';
        if(surface==='mobile-ui')WeftMobileCloud.core=core;
        WeftUiCore.CloudAuthClient.prototype.authorized=async function(path,options){if(path!=='/feedback'||options.method!=='POST')throw Error('Unexpected test cloud route');
          try{return await window.__feedbackTransport(options.body)}catch(error){throw {code:error.message.replace(/^.*?: /,'')}}};
        core.feedbackDiagnostic=async()=>'{"platform":"synthetic","state":"ready"}';
      },surface);
      const beforeRating=received.length;
      const bad=page.getByRole('button',{name:'没用',exact:true}).last(),useful=page.getByRole('button',{name:'有用',exact:true}).last();
      await useful.click();await assertPressed(useful,true);await useful.click();await assertPressed(useful,false);await bad.click();await assertPressed(bad,true);
      assert.equal(await page.getByRole('dialog',{name:'反馈问题'}).count(),0);
      await bad.click();await assertPressed(bad,false);await bad.click();
      assert.equal(received.length,beforeRating);
      for(const theme of ['light','dark'])for(const width of surface==='desktop'?[1200,480]:[360,390]) {
        await size(page,app,width);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
        await page.screenshot({scale:'css',path:join(evidence,`${surface}-${theme}-${width}-rating.png`)});
      }
      await page.getByRole('button',{name:'告诉我们哪里不对'}).last().click();
      let dialog=page.getByRole('dialog',{name:'反馈问题'});await dialog.getByLabel('哪里不对（必填）').fill('最后一步缺少说明，请补上。');
      assert.equal(await dialog.getByLabel('附上诊断摘要',{exact:true}).isChecked(),true);
      assert.equal(await dialog.getByLabel('附上这段对话',{exact:true}).isChecked(),false);
      for(const theme of ['light','dark'])for(const width of surface==='desktop'?[1200,480]:[360,390]) {
        await size(page,app,width);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
        await page.screenshot({scale:'css',path:join(evidence,`${surface}-${theme}-${width}-form.png`)});await geometry(dialog,page);
      }
      await dialog.getByRole('button',{name:'查看完整预览'}).click();const payload=await preview(dialog);
      assert.doesNotMatch(payload.body,/合成回复|请给出一条合成答复/);
      for(const theme of ['light','dark'])for(const width of surface==='desktop'?[1200,480]:[360,390]) {
        await size(page,app,width);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
        await page.screenshot({scale:'css',path:join(evidence,`${surface}-${theme}-${width}-preview.png`)});await geometry(dialog,page);
      }
      await dialog.getByRole('button',{name:'确认发送'}).click();await dialog.getByText('已发送，问题单 #42。',{exact:true}).waitFor();assert.deepEqual(received.at(-1),payload);
      await dialog.getByRole('button',{name:'关闭',exact:true}).click();
      await page.evaluate(()=>window.__feedbackActions.sentFeedback());await page.getByRole('dialog',{name:'我发过的反馈'}).getByText(/#42/).waitFor();
      for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({scale:'css',path:join(evidence,`${surface}-${theme}-sent.png`)});}
      await page.getByRole('dialog',{name:'我发过的反馈'}).getByRole('button',{name:'关闭',exact:true}).click();
      await page.getByRole('button',{name:'告诉我们哪里不对'}).last().click();dialog=page.getByRole('dialog',{name:'反馈问题'});
      await dialog.getByLabel('哪里不对（必填）').fill('附上合成对话供核对。');await dialog.getByLabel('附上这段对话',{exact:true}).check();
      await dialog.getByRole('button',{name:'查看完整预览'}).click();assert.equal(await dialog.getByRole('region',{name:'反馈完整预览'}).isVisible(),false);
      for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({scale:'css',path:join(evidence,`${surface}-${theme}-conversation-confirm.png`)});}
      await dialog.getByRole('button',{name:'确认附上对话'}).click();await dialog.getByRole('button',{name:'查看完整预览'}).click();
      const included=await preview(dialog);assert.match(included.body,/合成回复/);assert.doesNotMatch(included.body,/synthetic-secret-export|C:\\Synthetic/);
      await dialog.getByRole('button',{name:'确认发送'}).click();await dialog.getByText('已发送，问题单 #42。',{exact:true}).waitFor();assert.deepEqual(received.at(-1),included);
      await dialog.getByRole('button',{name:'关闭',exact:true}).click();
      if(surface==='desktop')for(const failure of ['unconfigured','github-failure','unlogged']){
        mode=failure;await page.getByRole('button',{name:'告诉我们哪里不对'}).last().click();dialog=page.getByRole('dialog',{name:'反馈问题'});
        await dialog.getByLabel('哪里不对（必填）').fill('合成失败恢复检查');await dialog.getByRole('button',{name:'查看完整预览'}).click();const saved=await preview(dialog);
        if(failure==='unlogged')await page.evaluate(()=>window.__feedbackCore.state.cloudAuth.mode='offline');
        await dialog.getByRole('button',{name:'确认发送'}).click();await dialog.getByText(/暂未开通|403|请先登录/).waitFor();
        for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({scale:'css',path:join(evidence,`desktop-${theme}-${failure}.png`)});}
        await dialog.getByRole('button',{name:'复制内容'}).click();assert.equal((await page.evaluate(()=>window.__copies)).at(-1),saved.title+'\n\n'+saved.body);
        await dialog.getByRole('button',{name:'关闭',exact:true}).click();await page.evaluate(()=>window.__feedbackCore.state.cloudAuth.mode='authenticated');
      }
      mode='ready';cloud.db.prepare("DELETE FROM failure_limits WHERE key LIKE 'feedback:%'").run();
      checks.push({surface,ratingToggle:true,noAutomaticDialog:true,defaultWithoutConversation:true,previewExact:true,conversationSecondConfirmation:true,metadataRecord:true,layouts:true});
    } catch(error) {failed=true;if(page)await page.screenshot({scale:'css',path:join(evidence,`${surface}-failure.png`)});throw error;}
    finally {await app?.close();await browser?.close();await f.close();if(app||failed)await processEvidence.finalize({failed});await rm(profile,{recursive:true,force:true});}
  }
  assert.deepEqual(errors,[]);await writeFile(join(evidence,'checks.json'),JSON.stringify({checks,errors,githubRequests:received.length,realModelRequests:0,phoneEvidence:'Browser viewport only; native system bars require native follow-up'},null,2)+'\n');
} finally {for(const fn of teardown.reverse())await fn();await new Promise(r=>{github.close(r);github.closeAllConnections()});}
async function preview(dialog){const region=dialog.getByRole('region',{name:'反馈完整预览'});await region.waitFor();return {title:await region.getByLabel('问题单标题').textContent(),body:await region.getByLabel('问题单正文').textContent()};}
async function assertPressed(button,value){await button.page().waitForFunction(({name,value})=>[...document.querySelectorAll('button')].filter(n=>n.getAttribute('aria-label')===name).at(-1)?.getAttribute('aria-pressed')===String(value),{name:await button.getAttribute('aria-label'),value});}
async function size(page,app,width){if(app)await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,width===480?780:800),width);else await page.setViewportSize({width,height:width===360?780:844});}
async function geometry(dialog,page){const bounds=await dialog.boundingBox(),viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));assert.ok(bounds.x>=0&&bounds.x+bounds.width<=viewport.width+1);assert.ok(bounds.y>=0&&bounds.y+bounds.height<=viewport.height+1);assert.equal(await dialog.evaluate(n=>n.scrollWidth>n.clientWidth+1),false);}
