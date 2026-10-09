/** D35: production desktop window and mobile bundle, synthetic host events only. */
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startTimelineCandidate } from '../../../../tests/integration/timeline-ui-candidate.mjs';
import { localUiSession } from '../../../../tests/helpers/local-ui-session.mjs';
const capture = !process.argv.includes('--verify-only');
const root = resolve(import.meta.dirname, '../../../..'), evidence = join(root, 'tests/evidence/qa-1/progress');
mkdirSync(evidence, { recursive: true });
const errors = [], checks = [], env = { ...process.env };
for (const key of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_)/.test(key) || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
let app, browser, fixture, profile;
const pause = ms => new Promise(done => setTimeout(done, ms));
async function until(fn) { const end = Date.now() + 25000; while (Date.now() < end) { if (await fn()) return; await pause(100); } throw Error('UI-P3 condition timed out'); }
async function close() { await browser?.close(); await app?.close(); await fixture?.close(); if (fixture) { assert.ok(fixture.root.startsWith(join(tmpdir(),'weftmate-m0-3-'))); rmSync(fixture.root,{recursive:true,force:true}); } if (profile) rmSync(profile, { recursive: true, force: true }); app = browser = fixture = profile = null; }
try {
  for (const theme of ['light', 'dark']) {
    fixture = await startTimelineCandidate({ historyCount: 0, interactive: true, inlineProgress: true, baseTime: Date.now() - 15000 });
    profile = mkdtempSync(join(tmpdir(), 'weftmate-ui-p3-'));
    app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: root,
      args: ['scripts/review-gallery/electron.mjs', '--force-device-scale-factor=1'], env: { ...env, REVIEW_PROFILE: profile, REVIEW_ORIGIN: fixture.origin, REVIEW_THEME: theme } });
    const desktop = await app.firstWindow(); desktop.setDefaultTimeout(25000);
    await localUiSession(desktop, fixture.credentials);
    await desktop.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    browser = await chromium.launch({ headless: true });
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await mobile.goto(fixture.mobileUrl);
    await mobile.getByRole('button', { name: '项目进度报告 正在运行', exact: true }).click();
    await mobile.evaluate(theme => applyTheme(theme), theme);
    const remote = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await remote.goto(fixture.origin+'/personal/v1/ui');await localUiSession(remote,fixture.credentials);await remote.evaluate(theme=>{document.documentElement.dataset.theme=theme},theme);
    const surfaces = [['desktop', desktop], ['mobile', mobile], ['mobile-web',remote]];
    for (const [, page] of surfaces) page.on('pageerror', error => errors.push(error.message));
    const shot = async name => { console.log(theme, name); for (const [surface, page] of surfaces) { await page.evaluate(() => document.activeElement?.blur()); if(capture)await page.screenshot({ path: join(evidence, `${surface}-${theme}-${name}.png`) }); } };
    const see = async text => { for (const [, page] of surfaces) await page.getByText(text, { exact: true }).first().waitFor(); };
    await see(/^正在加载模型 合成模型… \d+ 秒$/); await shot('01-loading');
    fixture.progress.call('pwsh', 'p3-command-1', { command: 'npm test' });
    await see('正在运行命令 npm test…'); await shot('02-working-command');
    // Native Space toggles disclosure; adding the next real step preserves it.
    for (const [, page] of surfaces) {
      const summary = page.getByRole('button', { name: '正在运行命令 npm test…，已收起', exact: true });
      await summary.focus(); await summary.press('Space');
      await page.getByRole('button', { name: '正在运行命令 npm test…，已展开', exact: true }).waitFor();
    }
    fixture.progress.result('p3-command-1', 'Synthetic tests: 42 passed.');
    fixture.progress.call('read', 'p3-read-1', { paths: ['设置说明.md', 'README.md'] });
    await see(/^正在读取 2 个文件/); await shot('03-working-read');
    for (const [, page] of surfaces) assert.equal(await page.getByRole('button', { name: /^正在读取 2 个文件.*，已展开$/ }).count(), 1);
    fixture.progress.result('p3-read-1', 'Synthetic file content.');
    fixture.progress.call('grep', 'p3-search-1', { pattern: 'approval', path: 'src' });
    await see('正在搜索 approval…'); await shot('04-working-search');
    for (const [, page] of surfaces) {
      await page.emulateMedia({reducedMotion:'reduce'});
      assert.ok(await page.locator('.inline-progress-text.is-running').count()>0);
      assert.equal(await page.locator('.inline-progress-text.is-running').evaluateAll(nodes=>nodes.every(node=>getComputedStyle(node).animationName==='none')),true);
      await page.emulateMedia({reducedMotion:'no-preference'});
    }
    fixture.progress.result('p3-search-1', 'Synthetic matches: 3.');
    await see('已运行 1 个命令、读取了 2 个文件、搜索了 1 次');
    for (const [, page] of surfaces) {
      const summary = page.getByRole('button', { name: '已运行 1 个命令、读取了 2 个文件、搜索了 1 次，已展开', exact: true });
      await summary.press('Enter');
    }
    await shot('05-completed-collapsed');
    for (const [, page] of surfaces) {
      await page.getByRole('button', { name: '已运行 1 个命令、读取了 2 个文件、搜索了 1 次，已收起', exact: true }).click();
    }
    await shot('06-expanded');
    for (const [, page] of surfaces) {
      await page.getByText(/^运行命令[:： ]npm test$/).click();
      await page.getByText(/Synthetic tests: 42 passed/).waitFor();
    }
    await shot('07-step-output');
    for (const [, page] of surfaces) await page.getByRole('button', { name: '已运行 1 个命令、读取了 2 个文件、搜索了 1 次，已展开', exact: true }).click();
    fixture.progress.text('资料已经核对。接下来运行检查，并生成合成验收报告。');
    fixture.progress.call('pwsh', 'p3-command-2', { command: 'npm run typecheck' });
    await see('正在运行命令 npm run typecheck…');
    for (const [, page] of surfaces) {
      const order = await page.locator('[data-seq]').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, seq: Number(node.dataset.seq) })));
      const first = order.find(row => row.text.includes('读取了 2 个文件'));
      const text = order.find(row => row.text.includes('资料已经核对。接下来'));
      const second = order.find(row => row.text.includes('正在运行命令 npm run typecheck'));
      assert.ok(first.seq < text.seq && text.seq < second.seq);
    }
    for (const [, page] of surfaces) {
      const oldLine=page.getByRole('button',{name:'已运行 1 个命令、读取了 2 个文件、搜索了 1 次，已收起',exact:true});
      await oldLine.click();await page.getByText('正在运行命令 npm run typecheck…',{exact:true}).waitFor();
      await page.getByRole('button',{name:'已运行 1 个命令、读取了 2 个文件、搜索了 1 次，已展开',exact:true}).click();
    }
    fixture.progress.result('p3-command-2', 'Synthetic typecheck passed.');
    const approvalA = await fixture.progress.approve('p3-approval-a', 'npm run verify');
    const approvalB = await fixture.progress.approve('p3-approval-b', 'npm run release');
    for (const [, page] of surfaces) {
      await page.getByRole('region', { name: '待批准操作' }).waitFor();
      await page.getByText('还有 1 个待批准', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '批准', exact: true }).count(), 1);
      const draft = page.getByRole('textbox', { name: /输入消息|消息/ }).first();
      await draft.fill('保留的合成草稿');
    }
    await shot('08-approval-two-pending');
    await desktop.getByRole('button', { name: '批准', exact: true }).focus();
    await desktop.getByRole('button', { name: '批准', exact: true }).press('Enter');
    await until(async () => (await fixture.request(`/sessions/${fixture.sessionId}/approvals?limit=100`)).approvals.find(row => row.approvalId === approvalA.approvalId)?.status === 'answered');
    await fixture.progress.resolve(approvalA, 'allowed-once'); fixture.progress.result('p3-approval-a', 'Synthetic approval accepted.');
    for (const [, page] of surfaces) await until(() => page.getByRole('region', { name: '待批准操作' }).getByText('要运行命令：npm run release', { exact: true }).count());
    await shot('09-approved-current-removed');
    await mobile.getByRole('button', { name: '拒绝', exact: true }).click();
    await until(async () => (await fixture.request(`/sessions/${fixture.sessionId}/approvals?limit=100`)).approvals.find(row => row.approvalId === approvalB.approvalId)?.status === 'answered');
    for (const [, page] of surfaces) await page.getByRole('region', { name: '待批准操作' }).waitFor({ state: 'hidden' });
    await fixture.progress.resolve(approvalB, 'rejected'); fixture.progress.result('p3-approval-b', 'Synthetic command rejected.');
    await shot('10-rejected-bar-removed');
    for (const [, page] of surfaces) {
      const line = page.getByRole('button', { name: /已运行 3 个命令，已收起/ });
      await line.click(); await page.getByText(/运行命令[:： ]npm run verify.*已批准/).waitFor();
      await page.getByText(/运行命令[:： ]npm run release.*已拒绝/).waitFor();
    }
    const approvalC = await fixture.progress.approve('p3-approval-c', 'npm run inspect');
    await desktop.getByRole('region', {name:'待批准操作'}).getByText('要运行命令：npm run inspect',{exact:true}).waitFor();
    await shot('10b-single-approval');
    await desktop.getByRole('region', {name:'待批准操作'}).getByText('要运行命令：npm run inspect',{exact:true}).press('Enter');
    assert.equal((await fixture.request(`/sessions/${fixture.sessionId}/approvals?limit=100`)).approvals.find(row=>row.approvalId===approvalC.approvalId).status,'pending','Enter on parameters never approves');
    await desktop.getByRole('button',{name:'批准',exact:true}).click();
    for (const [, page] of surfaces) await page.getByRole('region',{name:'待批准操作'}).waitFor({state:'hidden'});
    await fixture.progress.resolve(approvalC,'allowed-once');fixture.progress.result('p3-approval-c','Synthetic single approval accepted.');
    await shot('10c-approved-bar-removed');
    await fixture.progress.artifact(); await see('已读回核验'); await shot('11-artifact');
    fixture.progress.call('pwsh', 'p3-failure', { command: 'node synthetic-failure.mjs' });
    fixture.progress.result('p3-failure', 'Synthetic failure: file unavailable.', true);
    await see('第 9 步失败');
    for (const [, page] of surfaces) {
      await page.getByText(/Synthetic failure: file unavailable/).waitFor();
      assert.equal(await page.getByRole('region', { name: '待批准操作' }).isVisible(), false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await page.locator('.inline-progress-text.is-running').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).animationName === 'none')), true);
    }
    for (const [, page] of surfaces) await page.getByText('第 9 步失败', {exact:true}).scrollIntoViewIfNeeded();
    await shot('11-failure-artifact');
    fixture.progress.finish('aborted'); await desktop.getByText('本轮已停止。如需继续，请重新发送。',{exact:true}).waitFor();await mobile.getByText('电脑回合已停止',{exact:true}).waitFor(); await shot('12-stopped');
    checks.push({ theme, surfaces: ['production Electron', 'mobile bundle 390×844', 'remote mobile web 390×844'], liveFrames: 3, order: true, keyboard: true, preservedExpansion: true, approvals: ['approved', 'rejected'], failure: true, artifactReadback: true, reducedMotion: true });
    await close();
  }
  // Pure reply has a waiting line only until the first actual text event.
  fixture = await startTimelineCandidate({ historyCount: 0, interactive: true, inlineProgress: true });
  browser = await chromium.launch({ headless: true }); const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(fixture.mobileUrl); await page.getByRole('button', { name: '项目进度报告 正在运行', exact: true }).click();
  profile = mkdtempSync(join(tmpdir(), 'weftmate-ui-p3-pure-'));
  app = await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:root,args:['scripts/review-gallery/electron.mjs'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:fixture.origin,REVIEW_THEME:'light'}});
  const pureDesktop=await app.firstWindow();await localUiSession(pureDesktop,fixture.credentials);
  fixture.progress.text('合成纯文字回复。'); fixture.progress.finish();
  await pureDesktop.getByText('合成纯文字回复。',{exact:true}).waitFor();
  assert.equal(await pureDesktop.locator('.execution-block, .inline-waiting, .conversation-task').count(),0);
  if(capture)await pureDesktop.screenshot({path:join(evidence,'desktop-pure-text.png')});
  await page.getByText('合成纯文字回复。', { exact: true }).waitFor();
  assert.equal(await page.locator('.execution-block, .inline-waiting, .conversation-task').count(), 0);
  if(capture)await page.screenshot({path:join(evidence,'mobile-pure-text.png')});
  assert.deepEqual(errors, []);
  if(capture)writeFileSync(join(evidence, 'checks.json'), JSON.stringify({ syntheticOnly: true, checks, pureText: true, errors }, null, 2) + '\n');
  console.log('UI-P3 desktop/mobile semantic interactions and evidence passed.');
} catch (error) {
  if (app) console.error((await (await app.firstWindow()).locator('body').innerText()).slice(-2200));
  throw error;
} finally { await close(); }
