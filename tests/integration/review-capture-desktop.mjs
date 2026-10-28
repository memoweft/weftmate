import { managedMkdtemp as mkdtemp, managedTempRoot as tmpdir } from '../helpers/managed-temp.mjs';
// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
import { _electron } from 'playwright';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { rm } from 'node:fs/promises';

import { join } from 'node:path';
import {renderingSample} from '../helpers/rendering-sample.mjs';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { startMainChatCandidate } from './main-chat-candidate.mjs';
import { nativeFixtureFetchOptions } from '../helpers/local-ui-session.mjs';
import { loadNativeReviewSession } from '../helpers/review-native-session.mjs';
import { redactEvidenceText } from '../helpers/process-evidence.mjs';
import { exposeUx7Desktop, mockUx7Requests, prepareUx7Suggestions } from './ux-7-scenes.mjs';
import { repository, outDirectory, runScene, catalog } from '../../scripts/review-gallery/common.mjs';
const out = outDirectory();
const sceneIndex = process.argv.indexOf('--scene'), onlyScene = sceneIndex < 0 ? null : process.argv[sceneIndex + 1];
for (const theme of ['light', 'dark']) {
  const fixture = await startTimelineCandidate({goals:true, historyCount: 0, interactive: true, riskApproval: true, composer:true, composerMenu:true, baseTime: Date.parse('2026-10-08T08:00:00Z') });
  const profile = await mkdtemp(join(tmpdir(), 'weftmate-review-desktop-'));
  const profiles = [profile];
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('WEFTMATE_') || key.startsWith('MEMOWEFT_') || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
  env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
  Object.assign(env, { REVIEW_PROFILE: profile, REVIEW_THEME: theme, REVIEW_ORIGIN: fixture.origin,
    REVIEW_LIBRARY_TOKEN: fixture.libraryDesktopToken });
  let application, page, mainFixture, suggestionFixture, renderingSeeded=false, closing = false, ownerId;
  const errors = [];
  const stage = name => console.log(`Desktop ${theme}: ${name}`);
  const closeApplication = async label => {
    if (!application) return;
    if (page && !page.isClosed()) {
      stage(`${label} renderer stop started`);
      await page.evaluate(() => { globalThis.__ux7core?.stopAssistantRefresh(); });
      stage(`${label} renderer stop ended`);
      // Captures are complete. Unload this synthetic page before removing its
      // native IPC handlers, so remaining UI callbacks and routes are cancelled.
      stage(`${label} renderer unload started`);
      await page.goto('about:blank', { timeout: 30000 });
      stage(`${label} renderer unload ended`);
    }
    stage(`${label} native close started`);
    await application.evaluate(async () => { await globalThis.__reviewDesktop.close(); });
    stage(`${label} native close ended`);
    const child = application.process();
    let exitListener;
    const exited = child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve({ code: child.exitCode, signal: child.signalCode })
      : new Promise(resolve => { exitListener = (code, signal) => resolve({ code, signal }); child.once('exit', exitListener); });
    const closed = application.waitForEvent('close', { timeout: 30000 });
    stage(`${label} application quit started`);
    try {
      const [, , exit] = await Promise.all([
        application.close(), closed, exited,
      ]);
      assert.equal(exit.code, 0, 'Synthetic Electron must exit successfully');
      assert.equal(exit.signal, null, 'Synthetic Electron must exit without a forced signal');
      stage(`${label} application quit ended ${JSON.stringify(exit)}`);
    } finally { if (exitListener) child.removeListener('exit', exitListener); }
    application = null; page = null;
  };
  try {
    application = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: repository,
      args: [join(repository, 'scripts/review-gallery/electron.mjs'), '--force-device-scale-factor=1', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'], env, timeout: 90000 });
    console.log('Desktop shell launched.');
    page = await application.firstWindow(); page.setDefaultTimeout(30000);
    await exposeUx7Desktop(page); await mockUx7Requests(page, undefined, { nativeIdentity: fixture });
    page.on('pageerror', error => errors.push({ source: 'primary-page', message: redactEvidenceText(error.message.split('\n')[0]) }));
    await page.addInitScript(({ theme, origin }) => {
      // Presentation belongs to this synthetic app, not the opaque cleanup document.
      if (location.origin !== origin) return;
      localStorage.setItem('weftmate.desktop.appearance.v1', JSON.stringify({ theme, accent: 'neutral', fontSize: '15' }));
      const NativeDate = Date, fixed = Date.parse('2026-10-08T08:01:40Z'), started = performance.now();
      const anchoredNow = () => fixed + Math.floor(performance.now() - started);
      globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [anchoredNow()])); } static now() { return anchoredNow(); } };
    }, { theme, origin: fixture.origin });
    await page.route('**/personal/v1/memory/items/cognition/synthetic-memory', route => route.fulfill({ json: { ownerId, item: { text: '使用中文说明' } } }));
    await page.route('**/personal/v1/memory/items/**/sources', route => route.fulfill({ json: { ownerId, sources: [{ recordedAt: '2026-10-08T08:00:00Z', contentAvailable: true, rawContent: '合成偏好：使用中文说明。' }] } }));
    const projectionPage = page;
    let projectionDocumentEpoch = 0;
    projectionPage.on('framenavigated', frame => { if (frame === projectionPage.mainFrame()) projectionDocumentEpoch++; });
    await projectionPage.route('**/personal/v1/sessions/*/events?*', async route => {
      const documentEpoch = projectionDocumentEpoch;
      try {
        const response = await route.fetch(nativeFixtureFetchOptions(route, fixture)), data = await response.json();
        for (const event of data.events || []) if (event.type === 'assistant.message') event.data.memoryUsed = [{ id: 'synthetic-memory', kind: 'cognition', summary: '使用中文说明' }];
        await route.fulfill({ response, json: data });
      } catch (error) {
        const cancelledDocument = documentEpoch !== projectionDocumentEpoch || projectionPage.isClosed() ||
          route.request().failure()?.errorText === 'net::ERR_ABORTED';
        if (!cancelledDocument) errors.push({ source: 'event-projection', code: error.code || error.name || 'ROUTE_FAILED',
          message: redactEvidenceText(error.message.split('\n')[0]) });
        await route.abort().catch(() => {});
      }
    });
    ownerId = await loadNativeReviewSession(page, fixture);
    console.log('Desktop fixture loaded.');
    const button = name => page.getByRole('button', { name, exact: typeof name === 'string' });
    const shot = async (scene, prepare) => {
      stage(`${scene} prepare started`);
      const result = await runScene({ page, out, platform: 'windows', scene, theme, prepare, application });
      stage(`${scene} ${result.status === 'failed' ? 'failed' : 'captured'}`); return result;
    };
    const loginDialog = page.getByRole('dialog', { name: '登录以使用云端功能', exact: true });
    const loginOutcome = await shot('login', async () => {
      // The production native window opens its own existing account directly.
      // Capture the optional cloud login from Settings, keeping local use below it.
      await page.locator('#assistant-view').waitFor({ state: 'visible' });
      await button('账户菜单').click(); await button('设置').click();
      await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '账户', exact: true }).click();
      await page.locator('#cloud-account-panel').getByRole('button', { name: '登录以使用远程访问', exact: true }).click();
      await loginDialog.waitFor({ state: 'visible' });
      await loginDialog.getByRole('heading', { name: '登录 WeftMate', exact: true }).waitFor();
      await loginDialog.getByLabel('邮箱', { exact: true }).waitFor();
      await loginDialog.getByRole('button', { name: '关闭登录', exact: true }).waitFor();
    });
    // A failed scene remains failed; close only surfaces it actually opened.
    // Do not turn runScene's recorded navigation failure into a second timeout.
    if (await loginDialog.isVisible()) {
      await loginDialog.getByRole('button', { name: '关闭登录', exact: true }).click();
      await loginDialog.waitFor({ state: 'hidden' });
    }
    const settingsDialog = page.getByRole('dialog', { name: '设置', exact: true });
    if (await settingsDialog.isVisible()) {
      await settingsDialog.getByRole('button', { name: '关闭设置', exact: true }).click();
      await settingsDialog.waitFor({ state: 'hidden' });
    }
    if (loginOutcome.status !== 'failed') {
      await loginDialog.waitFor({ state: 'hidden' });
      await page.locator('#assistant-view').waitFor({ state: 'visible' });
    }
    // Every feature scene uses the same production native login, without
    // replacing its Cookie with a second password identity between captures.
    const home = async () => {
      await loadNativeReviewSession(page, fixture);
      try{await button(/^项目进度报告/).click();await button('批准').waitFor()}catch(error){console.error('Synthetic desktop landing:',await page.locator('body').innerText());throw error;}
    };
    const settings = async () => { await home(); await button('账户菜单').click(); await button('设置').click(); };
    const preparations = {
      rendering:async()=>{if(!renderingSeeded){fixture.progress.text(renderingSample);renderingSeeded=true;}await home();await page.getByRole('heading',{name:'公式与图表',exact:true}).scrollIntoViewIfNeeded();await page.locator('.render-diagram img').waitFor();},
      goals: async () => { await home(); await button('目标').click(); await page.getByRole('heading',{name:'目标',exact:true}).waitFor(); await page.getByRole('article',{name:'提交合成报告',exact:true}).waitFor(); },
      onboarding: async () => { await settings(); await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '常规', exact: true }).click(); await button('重新查看引导').click(); await page.getByRole('heading', { name: '你好，我是 WeftMate', exact: true }).waitFor(); },
      'search-palette': async () => { await home(); await button('搜索').click();await page.getByRole('dialog',{name:'搜索',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('#search-results')?.getAttribute('aria-busy')==='false'); },
      library: async () => { await home(); await button('成果库').click(); await button('预览 项目进度报告.md').click(); await page.getByRole('heading',{name:'项目进度报告',exact:true}).waitFor(); },
      activity: async () => { await home(); await fixture.recordActivity({ key:'gallery-paused', type:'memory.paused', title:'记忆已暂停', summary:'记忆暂时无法更新，可在记忆页查看状态。', level:'normal' }); await button(/^动态(?:，|$)/).click(); await page.getByRole('heading',{name:'动态',exact:true}).waitFor(); await page.getByText('记忆已暂停',{exact:true}).waitFor(); },
      sessions: async () => { await home(); await button('搜索').waitFor(); },
      'composer-menu': async()=>{await home();await button('添加图片或文件').click();await page.getByRole('menu',{name:'添加附件与深入思考'}).waitFor();await page.getByRole('menuitemcheckbox',{name:'深入思考'}).waitFor();},
      'composer-context': async()=>{await home();await button('背景信息窗口：86% 已用').focus();await page.getByRole('tooltip').waitFor();},
      conversation: async () => { await home(); await page.getByRole('button', {name:'读取了 3 个文件、已运行 1 个命令，已收起',exact:true}).click(); await page.getByText(/^读取 3 个文件/).evaluate(node => node.scrollIntoView({ block: 'center' })); },
      approval: async () => { await home(); await button('批准').evaluate(node => node.scrollIntoView({ block: 'center' })); },
      question: async () => {
        const decisions = [];
        const decisionResponse = response => {
          if (response.request().method() !== 'POST' || !/\/personal\/v1\/sessions\/[^/]+\/approvals\/[^/]+$/.test(new URL(response.url()).pathname)) return;
          const row = { status: response.status() }; decisions.push(row);
          void response.json().then(body => { row.approvalStatus = body.approval?.status; row.outcome = body.approval?.decisionOutcome;
            stage(`question decision response ${JSON.stringify(row)}`); }).catch(() => { stage(`question decision response ${JSON.stringify(row)}`); });
        };
        page.on('response', decisionResponse);
        try {
          await home(); stage('question home ready');
          const [response] = await Promise.all([
            page.waitForResponse(response => response.request().method() === 'POST' &&
              /\/personal\/v1\/sessions\/[^/]+\/approvals\/[^/]+$/.test(new URL(response.url()).pathname) &&
              response.request().postDataJSON()?.outcome === 'rejected'),
            button('拒绝').click().then(() => stage('question reject clicked')),
          ]);
          const decision = await response.json();
          assert.equal(response.status(), 200); assert.equal(decision.approval.status, 'answered');
          assert.equal(decision.approval.decisionOutcome, 'rejected');
          // Complete only the synthetic native approval lifecycle. Do not
          // answer the pending question or invoke any UI refresh/render action.
          await fixture.resolveInitialApproval('rejected'); stage('question native approval resolved');
          await page.getByRole('region',{name:'待回答问题'}).waitFor(); stage('question region visible');
          await page.getByRole('radio', { name: '简要报告', exact: true }).evaluate(node => node.scrollIntoView({ block: 'center' })); stage('question option visible');
        } catch (error) {
          const state = await page.evaluate(() => {
            const core = globalThis.__ux7core;
            const rows = entries => [...(entries?.values() || [])].map(entry => ({ status: entry.row?.status,
              authoritative: entry.authoritative, notice: entry.notice }));
            return { selectedSessionId: core?.state.selectedSessionId, identity: core?.state.identityGeneration,
              authKind: core?.state.device?.authKind, approvals: rows(core?.conversationApprovals.entries),
              approvalOperations: core?.conversationApprovals.operations.size, questions: rows(core?.conversationQuestions.entries),
              approvalHidden: document.querySelector('#approval-bar')?.hidden, questionHidden: document.querySelector('#question-bar')?.hidden,
              historyReadAllowed: core?.historyReadAllowed?.() };
          });
          console.error(`Desktop ${theme} question readiness:`, JSON.stringify({ ...state, decisions })); throw error;
        } finally { page.off('response', decisionResponse); }
      },
      'outputs-sources': async () => { await home(); await button('输出与来源').click(); await page.getByRole('button', { name: /README.md.*读取/ }).waitFor(); },
      memory: async () => { await home(); await button('查看这条回复参考的 1 条记忆来源').click(); await page.getByText('合成偏好：使用中文说明。', { exact: true }).waitFor(); },
      appearance: async () => { await settings(); await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '外观', exact: true }).click(); await page.getByRole('group', { name: '颜色模式' }).waitFor(); },
      general: async () => { await settings(); await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '助手', exact: true }).click(); await page.getByRole('combobox', { name: '回复进行中时发送的消息', exact: true }).waitFor(); },
      usage: async () => { await settings(); await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '用量', exact: true }).click(); await page.getByRole('heading', { name: '用量与费用', exact: true }).waitFor(); await button('刷新用量').waitFor(); },
      'session-menu': async () => { await home(); await button('项目进度报告').click({button:'right'}); await page.getByRole('menu', { name: '对话操作', exact: true }).waitFor(); await page.getByRole('menuitem', { name: '归档 A', exact: true }).waitFor(); await page.getByRole('menuitem', { name: '删除 D', exact: true }).waitFor(); },
    };
    for (const scene of catalog.scenes.filter(row => !['login','main-chat','next-suggestions'].includes(row.id) && (!onlyScene || row.id === onlyScene)).sort((a,b)=>Number(a.id==='question')-Number(b.id==='question'))) {
      await shot(scene.id, preparations[scene.id]);
      if (scene.id === 'onboarding') await page.evaluate(async () => { const me = await (await fetch('/personal/v1/auth/me')).json(); await fetch('/personal/v1/onboarding', { method: 'PATCH', headers: { 'content-type': 'application/json', 'X-WeftMate-CSRF': me.csrfToken }, body: JSON.stringify({ step: 'first', completed: true }) }); });
    }
    if(!onlyScene||onlyScene==='next-suggestions'){
      closing=true;stage('suggestions switch unroute started');await page.unrouteAll({behavior:'ignoreErrors'});stage('suggestions switch unroute ended');
      await closeApplication('suggestions switch');
      stage('suggestions fixture started');suggestionFixture=await startTimelineCandidate({historyCount:0,interactive:true,composer:true});stage('suggestions fixture ready');
      stage('suggestions complete started');await suggestionFixture.complete();stage('suggestions complete ended');
      const suggestionProfile = await mkdtemp(join(tmpdir(), 'weftmate-review-desktop-suggestions-')); profiles.push(suggestionProfile);
      stage('suggestions launch started');
      application=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:repository,args:[join(repository,'scripts/review-gallery/electron.mjs'),'--force-device-scale-factor=1'],env:{...env,REVIEW_PROFILE:suggestionProfile,REVIEW_ORIGIN:suggestionFixture.origin,REVIEW_LIBRARY_TOKEN:suggestionFixture.libraryDesktopToken}});
      page=await application.firstWindow();page.setDefaultTimeout(30000);closing=false;page.on('pageerror',e=>errors.push({source:'suggestions-page',message:redactEvidenceText(e.message.split('\n')[0])}));stage('suggestions launch ended');
      await exposeUx7Desktop(page);await mockUx7Requests(page,undefined,{legacy:true,nativeIdentity:suggestionFixture});
      stage('suggestions native init started');await loadNativeReviewSession(page,suggestionFixture);stage('suggestions native init ended');
      await shot('next-suggestions',async()=>{await page.waitForFunction(()=>globalThis.__ux7core?.state.account);await page.evaluate(id=>__ux7core.selectSession(id),suggestionFixture.sessionId);await prepareUx7Suggestions(page);});
    }
    closing=true;stage('main switch unroute started');await page.unrouteAll({behavior:'ignoreErrors'});stage('main switch unroute ended');
    await closeApplication('main switch');
    stage('main fixture started');mainFixture=await startMainChatCandidate();stage('main fixture ready');
    const mainProfile = await mkdtemp(join(tmpdir(), 'weftmate-review-desktop-main-')); profiles.push(mainProfile);
    stage('main launch started');
    application=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:repository,args:[join(repository,'scripts/review-gallery/electron.mjs'),'--force-device-scale-factor=1'],env:{...env,REVIEW_PROFILE:mainProfile,REVIEW_ORIGIN:mainFixture.origin,REVIEW_LIBRARY_TOKEN:mainFixture.libraryDesktopToken}});
    page=await application.firstWindow();page.setDefaultTimeout(30000);closing=false;page.on('pageerror',e=>errors.push({source:'main-page',message:redactEvidenceText(e.message.split('\n')[0])}));stage('main launch ended');
    await exposeUx7Desktop(page);stage('main native init started');await loadNativeReviewSession(page,mainFixture);stage('main native init ended');
    await shot('main-chat',async()=>{await page.getByRole('button',{name:'筛选最近对话',exact:true}).click();await page.getByRole('menu',{name:'最近对话类型',exact:true}).getByRole('menuitemradio',{name:'对话',exact:true}).click();await button('小纬').click();await page.waitForFunction(()=>document.querySelector('#transcript .main-chat-row'));await button('搜索对话').click();await page.getByRole('searchbox',{name:'对话搜索关键词'}).fill('合成');await page.getByRole('searchbox',{name:'对话搜索关键词'}).press('Enter');await page.locator('mark').first().waitFor();});
    if (errors.length) { console.error(`Desktop ${theme} actual errors:`, JSON.stringify(errors)); throw Error('Desktop renderer or synthetic projection failed'); }
    console.log(`Desktop ${theme}: scene outcomes recorded.`);
  } finally {
    closing = true;
    stage('finally unroute started');await page?.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});stage('finally unroute ended');
    await closeApplication('finally');
    stage('finally primary fixture close started');await fixture.close();stage('finally primary fixture close ended');
    stage('finally main fixture close started');await mainFixture?.close();stage('finally main fixture close ended');
    stage('finally suggestions fixture close started');await suggestionFixture?.close();stage('finally suggestions fixture close ended');
    stage('finally profiles remove started');for(const ownedProfile of profiles)await rm(ownedProfile, { recursive: true, force: true });stage('finally profiles remove ended');
    stage('finally primary root remove started');await rm(fixture.root, { recursive: true, force: true });stage('finally primary root remove ended');
    if(mainFixture){stage('finally main root remove started');await rm(mainFixture.root,{recursive:true,force:true});stage('finally main root remove ended');}
    if(suggestionFixture){stage('finally suggestions root remove started');await rm(suggestionFixture.root,{recursive:true,force:true});stage('finally suggestions root remove ended');}
  }
}
