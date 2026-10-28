import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, extname, join, sep } from 'node:path';
import { startFe1bFixture } from './fe-1b-fixture.mjs';
import {startRenderingCandidate} from './ux-5-fixture.mjs';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { startMainChatCandidate } from './main-chat-candidate.mjs';
import { prepareGoalsScene } from './review-goals-scene.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
import { mockUx7Requests, prepareUx7Suggestions, ux7Replies } from './ux-7-scenes.mjs';
import { mobileBridge } from '../../scripts/review-gallery/mobile-bridge.mjs';
import { repository, outDirectory, runScene, catalog } from '../../scripts/review-gallery/common.mjs';
import { observePageFailures, sceneFailureSummary } from '../../scripts/review-gallery/scene-diagnostics.mjs';
import { renderingFailureSampler } from '../../scripts/review-gallery/rendering-snapshot.mjs';
import { prepareMobileRendering } from '../../scripts/review-gallery/mobile-rendering.mjs';
import { redactEvidenceText } from '../helpers/process-evidence.mjs';
import { galleryBridge } from '../../scripts/nightly/gallery-bridge.mjs';
import { startAndroid } from '../../scripts/nightly/android.mjs';
const assets = join(repository, 'apps/mobile-ui/www'), out = outDirectory();
const sceneIndex = process.argv.indexOf('--scene'), onlyScene = sceneIndex < 0 ? null : process.argv[sceneIndex + 1];
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    const file = resolve(assets, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(assets + sep)) return res.writeHead(404).end();
    res.setHeader('content-type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const device = process.argv.includes('--android');
let android;
try {
  const infoIndex = process.argv.indexOf('--android-device');
  const deviceInfo = infoIndex < 0 ? undefined : JSON.parse(await readFile(process.argv[infoIndex + 1], 'utf8'));
  android = device ? await startAndroid(out, deviceInfo) : null;
}
catch (error) { server.closeAllConnections(); await new Promise(done=>server.close(done)); throw error; }
const browser = android?.browser || await chromium.launch({ headless: true });
let currentBridge;
const themeErrors = [], captureFailures = [];
if (android) {
  await android.page.exposeFunction('__reviewNative', async payload => {
    try { return { id: payload.id, ok: true, result: await currentBridge(payload) }; }
    catch (error) { return { id: payload.id, ok: false, error: { code: error.message } }; }
  });
  await android.page.addInitScript(() => {
    const install = () => { window.weftNative = { postMessage(value) { window.__reviewNative(JSON.parse(value)).then(result => window.weftNative.onmessage({ data: JSON.stringify(result) })); } }; };
    install();
    // Android injects its native object after new-document CDP scripts. Replace
    // transport once the document is ready, before the app's boot listener.
    document.addEventListener('DOMContentLoaded', install, {once:true});
  });
}
try {
  for (const theme of ['light', 'dark']) {
    const fixture = await startFe1bFixture();
    const candidate = await startTimelineCandidate({daily:true,logicalMobile:true,goals:true, historyCount: 0, interactive: true });
    const context = android ? android.page.context() : await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: theme });
    const page = android?.page || await context.newPage(), errors = [];let mainFixture,suggestionFixture,renderingFixture,renderingDiagnostics;
    try {
      const bridge = mobileBridge(fixture, theme);
      currentBridge = bridge;
      const navigate = async (current, url) => {
        if (!android) return current.goto(url);
        const source = [candidate, mainFixture, suggestionFixture, renderingFixture].find(fixture=>fixture?.mobileUrl === url);
        currentBridge = source ? galleryBridge(source, theme, source === suggestionFixture ? {suggestions:ux7Replies} : {}) : bridge;
        await current.goto(android.entryUrl);
        await current.waitForFunction(() => state.booted && String(window.weftNative?.postMessage).includes('__reviewNative'));
      };
      if (android) await android.theme(theme);
      page.setDefaultTimeout(30000); page.on('pageerror', error => { errors.push(error.message); console.error('Mobile page error:',redactEvidenceText(error.stack || error.message)); });
      if (!android) await page.exposeFunction('__reviewNative', async payload => {
        try { return { id: payload.id, ok: true, result: await bridge(payload) }; }
        catch (error) { return { id: payload.id, ok: false, error: { code: error.message } }; }
      });
      if (!android) await page.addInitScript(() => { window.weftNative = { postMessage(value) { window.__reviewNative(JSON.parse(value)).then(result => window.weftNative.onmessage({ data: JSON.stringify(result) })); } }; });
      await navigate(page, `http://127.0.0.1:${server.address().port}/`);
      const button = name => page.getByRole('button', { name, exact: typeof name === 'string' });
      const conversation = title => button(new RegExp(`^${title} [0-9]`));
      const shot = async (scene, prepare, current = page) => {
        if ((onlyScene && scene !== onlyScene) || android && catalog.scenes.find(row => row.id === scene).unavailable?.includes('android')) return null;
        const record = await runScene({ page:current, out, platform:android?'android':'mobile-web',scene,theme,prepare,screenshot:android?()=>android.screenshot(scene,theme):undefined,pageDiagnostics:scene==='rendering'?renderingDiagnostics:undefined,
          failureSampler:scene==='rendering'?renderingFailureSampler(current,()=>android?android.entryUrl:renderingFixture?.mobileUrl):undefined });
        if (android && scene === 'next-suggestions' && record.status === 'failed') {
          const support = await current.evaluate(()=>({abortAny:typeof AbortSignal.any,webView:navigator.userAgent.match(/Chrome\/([0-9.]+)/)?.[1] || 'unknown'}));
          if (support.abortAny !== 'function') {
            record.reason=`产品兼容问题：WebView ${support.webView} 未提供 AbortSignal.any，下一步建议请求在发出前失败；原页面等待断言仍超时`;
            await writeFile(join(out,`review-android-${scene}-${theme}.json`),JSON.stringify(record,null,2)+'\n');
          }
        }
        if(record.status === 'failed') captureFailures.push(sceneFailureSummary(record));
        return record;
      };
      // LG-1b account-first login; authentication below remains independent.
      const prepareLogin = async () => {
        // FE-1b's local auth fixture predates the native cloudApp bootstrap flag.
        await page.waitForFunction(() => state.booted);
        await page.evaluate(() => WeftMobileCloud.init());
        await page.getByRole('heading', { name: '登录 WeftMate', exact: true }).waitFor();
        await page.getByRole('textbox', { name: '邮箱', exact: true }).waitFor();
        await page.getByRole('button', { name: '注册账号', exact: true }).waitFor();
      };
      await shot('login', prepareLogin);
      // Keep authenticated scenes independent of an evolving login form.
      await bridge({ method: 'auth.login', params: { ...fixture.credentials, deviceName: '合成审稿手机' } });
      const home = async () => { await page.reload(); await conversation('整理项目进展').waitFor(); };
      const report = async () => { await home(); await conversation('整理项目进展').click(); };
      const settings = async () => { await home(); await button('设置与账户').click(); };
      const preparations = {
        onboarding: async () => { await settings(); await button(/^设备 /).click(); await page.getByRole('heading', { name: '连接你的电脑', exact: true }).waitFor(); },
        sessions: async()=>{await home();await button('打开导航').click();await page.getByRole('navigation',{name:'主导航',exact:true}).waitFor();},
        'composer-menu': async()=>{await report();await button('添加图片或文件').click();await page.getByRole('menu',{name:'添加附件'}).waitFor();await page.getByRole('menuitem',{name:'相机'}).waitFor();},
        'composer-context': async()=>{await report();await button('对话操作').click();await page.getByRole('menuitem',{name:'背景信息',exact:true}).click();await page.getByRole('dialog',{name:'背景信息',exact:true}).waitFor();assert.match(await page.getByRole('dialog',{name:'背景信息',exact:true}).innerText(),/86%/);},
        conversation: async () => { await report(); const process=page.locator('.execution-block').first();await process.waitFor();if(!await process.evaluate(node=>node.open))await process.locator(':scope > summary').click(); await page.getByText(/^读取(?: 1 个文件|项目记录)/).waitFor(); await page.waitForFunction(()=>document.getElementById('toast').hidden); assert.equal(await page.getByText(/这条记录已不可查看/).count(),0); assert.deepEqual(fixture.missingRequests,[]); },
        'outputs-sources': async () => { await report(); await button('对话操作').click(); await page.getByRole('menuitem', { name:'输出与来源', exact:true }).click(); await button(/^notes.md 1 次使用$/).waitFor(); },
        approval: async () => { await home(); await conversation('整理临时文件').click(); await button('批准').waitFor(); },
        'search-palette': async () => { await home();await button('打开导航').click();await page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('button',{name:'搜索',exact:true}).click();await page.getByRole('dialog',{name:'搜索',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('#search-results')?.getAttribute('aria-busy')==='false'); },
        memory: async () => { await settings(); await button(/^记忆/).click(); await button(/使用中文说明/).waitFor(); },
        appearance: async () => { await settings(); await button(/^外观 /).click(); await button(new RegExp(`^${theme === 'dark' ? '深色' : '浅色'}`)).click(); },
        general: async () => { await settings(); await button(/^助手/).click(); await page.getByRole('combobox', { name: '回复进行中时发送的消息', exact: true }).waitFor(); },
        usage: async () => { await settings(); await button(/^用量 /).click(); await page.getByRole('heading', { name: '用量与费用', exact: true }).waitFor(); await button('刷新用量').waitFor(); },
        'session-menu': async () => { await home();await button('打开导航').click();const row=page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('button',{name:'整理项目进展',exact:true});await row.dispatchEvent('pointerdown',{pointerType:'touch'});await page.getByRole('dialog',{name:'对话操作',exact:true}).waitFor();await row.dispatchEvent('pointerup',{pointerType:'touch'});await button('更多').click();await page.getByRole('dialog',{name:'对话操作',exact:true}).getByRole('button',{name:'删除',exact:true}).waitFor(); },
      };
      for (const scene of catalog.scenes.filter(row => !['login', 'question','main-chat','activity','goals','library','rendering','next-suggestions'].includes(row.id) && (!onlyScene || row.id === onlyScene))) await shot(scene.id, preparations[scene.id]);
      // FE-1a's real question projection supplies the missing FE-1b question fixture.
      const questionPage = android?.page || await context.newPage(); questionPage.setDefaultTimeout(30000);
      renderingDiagnostics = observePageFailures(questionPage);
      if (android) await questionPage.unrouteAll({ behavior: 'ignoreErrors' });
      await questionPage.route('**/bridge', async route => {
        const body = route.request().postDataJSON();
        if (body.method === 'settings.appearance') return route.fulfill({ json: { result: { value: theme } } });
        await route.continue();
      });
      await shot('rendering',async()=>{
        let phase='fixture-create';
        try {
          const rendered=renderingFixture=await startRenderingCandidate();
          phase='navigate';await navigate(questionPage,rendered.mobileUrl);
          phase='login-ready';await questionPage.waitForFunction(()=>state.booted&&state.loggedIn);
          phase='session-list';await questionPage.evaluate(()=>listSharedSessions());
          phase='drawer-open';await questionPage.getByRole('button',{name:'打开导航',exact:true}).click();
          phase='session-select';await questionPage.getByRole('button',{name:'渲染样张',exact:true}).click();
          await prepareMobileRendering(questionPage, next => { phase=next; });
        } catch(error) {error.scenePhase=phase;throw error;}
      },questionPage);
      await shot('library', async () => { await navigate(questionPage, candidate.mobileUrl);await questionPage.waitForFunction(()=>state.booted&&state.loggedIn);await questionPage.getByRole('tab',{name:/^成果库(?:，|$)/}).click();await questionPage.getByRole('button',{name:'预览 项目进度报告.md',exact:true}).waitFor(); },questionPage);
      await shot('goals', async () => {
        await navigate(questionPage, candidate.mobileUrl);await questionPage.waitForFunction(()=>state.booted&&state.loggedIn);await questionPage.getByRole('tab',{name:/^目标(?:，|$)/}).click();await prepareGoalsScene(questionPage);
      },questionPage);
      await shot('activity', async () => {
        await candidate.recordActivity({key:'gallery-paused',type:'memory.paused',title:'记忆已暂停',summary:'记忆暂时无法更新，可在记忆页查看状态。',level:'normal'});
        await navigate(questionPage, candidate.mobileUrl);await questionPage.waitForFunction(()=>state.booted&&state.loggedIn);
        await questionPage.getByRole('tab',{name:/^动态(?:，|$)/}).click();
        await questionPage.getByRole('heading',{name:'动态',exact:true}).waitFor();await questionPage.getByText('记忆已暂停',{exact:true}).waitFor();
      },questionPage);
      const questionRecord = await shot('question', async () => {
        await navigate(questionPage, candidate.mobileUrl);
        await questionPage.waitForFunction(() => state.booted && state.loggedIn);
        await questionPage.getByRole('tab',{name:/^动态(?:，|$)/}).click();
        await questionPage.getByRole('button',{name:'更多操作 需要审批',exact:true}).click();
        await questionPage.getByRole('menuitem',{name:'拒绝',exact:true}).click();
        // Rejection selects its source conversation, then returns to activity.
        // Finish that real action before opening the independent question.
        await questionPage.waitForFunction(()=>uiCore.activity.busy.size===0&&!uiCore.activity.loading);
        await questionPage.getByRole('button',{name:'打开动态 需要回答',exact:true}).click();
        const card=questionPage.getByRole('region',{name:'待回答问题',exact:true});
        await card.waitFor();
        assert.equal(await card.evaluate(node=>!!node.closest('#chat-scroll')),true,'phone questions belong to the conversation');
        await card.getByRole('button',{name:'简要报告',exact:true}).waitFor();
        await card.getByRole('button',{name:'完整记录',exact:true}).waitFor();
      }, questionPage);
      if(questionRecord?.status!=='failed'&&questionRecord){
        const answer=questionPage.waitForResponse(response=>response.request().method()==='POST'&&response.request().postDataJSON()?.method==='shared.questions.answer');
        await questionPage.getByRole('region',{name:'待回答问题',exact:true}).getByRole('button',{name:'简要报告',exact:true}).click();
        const response=await answer;assert.equal(response.status(),200);
        const result=await response.json();assert.equal(result.result?.question?.status,'answered');
        assert.deepEqual(result.result.question.answer.answers[0].selected,['简要报告']);
      }
      await shot('next-suggestions', async () => { suggestionFixture=await startTimelineCandidate({historyCount:0,interactive:true,composer:true});await suggestionFixture.complete();await mockUx7Requests(questionPage); await navigate(questionPage, suggestionFixture.mobileUrl); await questionPage.waitForFunction(()=>state.booted); await questionPage.evaluate(async id=>{await selectSharedSession(id);closeDrawer()},suggestionFixture.sessionId); try { await prepareUx7Suggestions(questionPage); }
        catch(error) { if(android) console.error('Suggestion readiness:',JSON.stringify(await questionPage.evaluate(()=>({booted:state.booted,loggedIn:state.loggedIn,sharedRunning:state.sharedRunning,sharedLoading:state.sharedLoading,hostAvailable:state.sharedHostAvailable,chatSource:state.chatSource,owner:!!uiCore.state.ownerId,session:!!uiCore.state.selectedSessionId,online:uiCore.state.online,selecting:uiCore.state.sessionSelecting,submitting:uiCore.state.submitting,historyCount:uiCore.state.historyEvents.size,capability:uiCore.state.personalCapabilities?.nextSuggestions,enabled:uiCore.nextSuggestionsView().enabled,replies:uiCore.nextSuggestionsView().suggestions.length,crypto:typeof crypto.randomUUID,abortAny:typeof AbortSignal.any,abortTimeout:typeof AbortSignal.timeout,csrf:!!uiCore.state.csrfToken,coreSource:uiCore.state.activeChatSource,running:uiCore.conversationRunning(uiCore.state.selectedSessionId),lastHistory:[...uiCore.state.historyEvents.values()].slice(-3).map(e=>e.type)}))));throw error; } }, questionPage);
      const mainPage=android?.page || await context.newPage();
      await shot('main-chat',async()=>{
        mainFixture=await startMainChatCandidate(300,{logicalMobile:true});await navigate(mainPage, mainFixture.mobileUrl);
        await mainPage.waitForFunction(()=>state.booted&&uiCore.state.mainChat);
        await mainPage.evaluate(()=>uiCore.selectMainChat());
        await mainPage.getByRole('button',{name:'搜索对话',exact:true}).waitFor();await mainPage.waitForFunction(()=>document.querySelector('.main-chat-row'));
        await mainPage.evaluate(theme=>applyTheme(theme),theme);
        await mainPage.getByRole('button',{name:'搜索对话',exact:true}).click();await mainPage.getByRole('searchbox',{name:'对话搜索关键词'}).fill('合成');await mainPage.getByRole('searchbox',{name:'对话搜索关键词'}).press('Enter');await mainPage.locator('mark').first().waitFor();
      },mainPage);
      if (errors.length) themeErrors.push({theme,errors:errors.map(error => redactEvidenceText(error))});
      console.log(`Mobile ${theme}: scene outcomes recorded.`);
    } finally { renderingDiagnostics?.dispose(); if (!android) await context.close(); await fixture.close(); await candidate.close();await mainFixture?.close();await suggestionFixture?.close();await renderingFixture?.close(); await rm(fixture.root, { recursive: true, force: true }); await rm(candidate.root, { recursive: true, force: true });if(mainFixture)await rm(mainFixture.root,{recursive:true,force:true});if(suggestionFixture)await rm(suggestionFixture.root,{recursive:true,force:true}); }
  }
  if(themeErrors.length) throw Error('Mobile renderer failed: ' + JSON.stringify(themeErrors));
  if(captureFailures.length) throw Error('Mobile scenes failed: ' + JSON.stringify(captureFailures));
} catch (error) { console.error('Primary mobile capture failure:', error.stack, error.cause?.stack || ''); throw error; }
finally { try { if (android) await android.close(); else await browser.close(); } finally { server.closeAllConnections(); await new Promise(done => server.close(done)); } }
