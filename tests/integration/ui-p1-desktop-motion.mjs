/** Real application evidence; --fixture uses the portable CI Electron window only. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright';
import { localUiSession } from '../helpers/local-ui-session.mjs';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';

const repository = resolve(import.meta.dirname, '../..'), evidence = join(repository, 'tests/evidence/ui-p1');
const baseline = '014924a51e04e679b631dde354dfbb9fef194dbd';
const capture = !process.argv.includes('--verify-only'), fixture = process.argv.includes('--fixture');
const root = mkdtempSync(join(tmpdir(), 'weftmate-ui-p1-'));
writeFileSync(join(root, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
if (capture) mkdirSync(evidence, { recursive: true });
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('WEFTMATE_') || key.startsWith('MEMOWEFT_') || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
let application, page, candidate;
const retiredCandidates = [];
const errors = [], results = [], performanceResults = [];
async function until(check) { const deadline = performance.now() + 30000; while (performance.now() < deadline) { if (await check()) return; await new Promise(done => setTimeout(done, 50)); } throw Error('Motion fixture condition timed out'); }
async function frames(phase, name, action) {
  console.log(`${phase}: ${name}`);
  if (name.startsWith('execution-')) await page.getByText(phase === 'before' ? '执行了 2 步 · 用时 2 秒' : '读取了 3 个文件、已运行 1 个命令', { exact: true }).scrollIntoViewIfNeeded();
  if (name === 'approval-resolve') await page.locator('[data-conversation-approval]').first().scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) { try { animation.finish(); } catch {} }
    window.name = 'motion-capture'; window.__motionCapture = true; window.__motionFrames = [];
  });
  await action();
  await page.evaluate(() => document.fonts.ready);
  const samples = [];
  for (const time of [0, 60, 120, 240]) {
    samples.push(await page.evaluate(time => {
      const animations = window.__motionFrames.filter(animation => animation.effect?.target?.isConnected);
      for (const animation of animations) animation.currentTime = time;
      return animations.map(animation => ({ target: animation.effect.target.className || animation.effect.target.id,
        timing: animation.effect.getTiming(), opacity: getComputedStyle(animation.effect.target).opacity }));
    }, time));
    if (capture) await page.screenshot({ path: join(evidence, `${phase}-${name}-${time}.png`), animations: 'allow' });
  }
  await page.evaluate(() => {
    window.name = ''; window.__motionCapture = false;
    for (const animation of window.__motionFrames) { try { animation.finish(); } catch {} }
  });
  results.push({ phase, name, sampleTimesMs: [0, 60, 120, 240], samples });
}
async function measure(name, action) {
  await page.evaluate(() => {
    window.__longTasks = []; window.__frameGaps = []; window.__lastFrame = performance.now();
    window.__observer = new PerformanceObserver(list => window.__longTasks.push(...list.getEntries().map(entry => ({ startTime: entry.startTime, duration: entry.duration }))));
    window.__observer.observe({ type: 'longtask' });
    window.__measureFrames = true;
    const frame = time => { if (!window.__measureFrames) return; window.__frameGaps.push(time - window.__lastFrame); window.__lastFrame = time; requestAnimationFrame(frame); }; requestAnimationFrame(frame);
  });
  await action();
  await page.waitForTimeout(300);
  const result = await page.evaluate(() => { window.__measureFrames = false; window.__observer.disconnect(); return { longTasks: window.__longTasks, frameGapsMs: window.__frameGaps }; });
  performanceResults.push({ name, ...result });
  assert.equal(result.longTasks.filter(task => task.duration > 50).length, 0, `${name}: >50ms main-thread task`);
}
async function projectQueue(count) {
  await page.evaluate(count => {
    const ui = { byId: id => document.getElementById(id), element: (tag, cls = '', text = '') => { const node = document.createElement(tag); node.className = cls; node.textContent = text; return node; }, readMessageDraft: () => '', toast() {} };
    const core = { conversationTaskContext: () => ({}), taskQueue: () => Array.from({ length: count }, (_, index) => ({ queued: true, state: 'queued', taskId: `motion-queue-${index}`, text: `合成排队目标 ${index + 1}` })), messageTaskLabel: () => '' };
    window.WeftUiComponents.factories.tasks(core, ui).renderTaskQueue();
  }, count);
}
async function projectSteps(count) {
  await page.evaluate(count => {
    let list = document.getElementById('motion-steps');
    if (!list) { list = document.createElement('li'); list.id = 'motion-steps'; document.getElementById('transcript').append(list); }
    window.WeftTimeline.render(Array.from({ length: count }, (_, index) => ({ seq: index, sessionId: 'motion-session', type: 'step.started', at: '2026-10-08T08:00:00Z', data: { taskId: 'motion-task', stepId: `motion-step-${index}`, state: 'running', summary: `合成新增步骤 ${index + 1}` } })), list);
    const details = list.querySelector('.execution-block'); if (details) details.open = true;
    if (count <= 20) list.scrollIntoView({ block: 'center' });
  }, count);
}
try {
  candidate = await startTimelineCandidate({ historyCount: 0, interactive: true, riskApproval: true, baseTime: Date.now() - 80000 });
  console.log('fixture host ready');
  const args = fixture ? ['tests/integration/desktop-ui-1.cjs', candidate.origin + '/personal/v1/ui/'] : ['.', '--personal-host', '--access-port=0', `--user-data-dir=${root}`, '--force-device-scale-factor=1'];
  application = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: repository, args, env, timeout: 90000 });
  console.log('Electron launched');
  page = await application.firstWindow({ timeout: 90000 }); page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForURL(url => url.pathname.startsWith('/personal/v1/ui'));
  await page.addInitScript(() => {
    window.__motionCapture = window.name === 'motion-capture'; window.__motionFrames = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function(...args) {
      const animation = animate.apply(this, args);
      if (window.__motionCapture) { animation.pause(); window.__motionFrames.push(animation); }
      return animation;
    };
  });
  let phase = 'after';
  await page.route('**/personal/v1/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/ui')) {
      if (phase === 'before' && /\/(index.html|styles.css|desktop.js|timeline.js|components\/(auth|shell|steps|sessions|messages|tasks|approvals).js)$/.test(url.pathname)) {
        const name = url.pathname.split('/ui/')[1];
        return route.fulfill({ contentType: name.endsWith('.css') ? 'text/css' : name.endsWith('.html') ? 'text/html' : 'text/javascript', body: execFileSync('git', ['show', `${baseline}:src/personal-access-ui/${name}`], { cwd: repository, encoding: 'utf8' }) });
      }
      if (phase === 'before' && /\/ui\/?$/.test(url.pathname)) return route.fulfill({ contentType: 'text/html', body: execFileSync('git', ['show', `${baseline}:src/personal-access-ui/index.html`], { cwd: repository, encoding: 'utf8' }) });
      const asset = await route.fetch({ url: candidate.origin + url.pathname });
      return route.fulfill({ response: asset });
    }
    if (url.pathname.includes('/sessions/22222222-2222-4222-8222-222222222222/')) {
      const json = url.pathname.endsWith('/events') ? { events: [], nextSeq: -1, hasMore: false, hasOlder: false }
        : url.pathname.endsWith('/approval-mode') ? { mode: 'ask' } : { approvals: [], questions: [] };
      return route.fulfill({ json });
    }
    const response = await route.fetch({ url: candidate.origin + url.pathname + url.search, headers: { ...route.request().headers(), origin: candidate.origin } });
    if (url.pathname === '/personal/v1/sessions') {
      const data = await response.json(); data.sessions.push({ sessionId: '22222222-2222-4222-8222-222222222222', title: '合成空白对话', running: false });
      return route.fulfill({ response, json: data });
    }
    if (/\/events$/.test(url.pathname)) {
      const data = await response.json();
      for (const event of data.events || []) if (event.type === 'assistant.message') event.data.memoryUsed = [{ id: 'synthetic-memory', kind: 'cognition', summary: '使用中文说明' }];
      return route.fulfill({ response, json: data });
    }
    await route.fulfill({ response });
  });
  for (const current of capture ? ['before', 'after', 'reduced'] : ['after', 'reduced']) {
    phase = current;
    const previous = candidate;
    candidate = await startTimelineCandidate({ historyCount: 0, interactive: true, riskApproval: true, baseTime: Date.now() - 80000 });
    retiredCandidates.push(previous);
    await page.emulateMedia({ reducedMotion: phase === 'reduced' ? 'reduce' : 'no-preference' });
    console.log(`loading ${phase}`);
    await page.reload(); console.log(`loaded ${phase}`);
    // A reload can leave a proxy fetch reading the old host. Keep that host
    // alive until all route handlers have drained in the final cleanup.
    await page.getByRole('heading', { name: '登录 WeftMate' }).waitFor();
    await frames(phase, 'login-step', () => page.getByRole('button', { name: '还没有账号？注册', exact: true }).evaluate(button => button.click()));
    for (const step of ['code', 'password']) await frames(phase, `login-${step}`, () => page.evaluate(step => {
      window.__motionAuth ||= window.WeftUiComponents.factories.auth({}, { byId: id => document.getElementById(id), errorAt() {}, setBusy() {} });
      window.__motionAuth.paintCloudAuth({ mode: 'registration', step, email: 'synthetic@example.test', deviceName: '合成桌面', busy: false, error: '', resendSeconds: 0, retrySeconds: 0 });
    }, step));
    await page.reload();
    await page.getByRole('heading', { name: '登录 WeftMate' }).waitFor();
    await frames(phase, 'approval-enter', async () => { await localUiSession(page, candidate.credentials); await page.getByRole('button', { name: phase === 'before' ? '允许一次' : '批准', exact: true }).waitFor(); });
    await page.getByRole('button', { name: phase === 'before' ? '允许一次' : '批准', exact: true }).waitFor();
    const summary = page.getByText(phase === 'before' ? '执行了 2 步 · 用时 2 秒' : '读取了 3 个文件、已运行 1 个命令', { exact: true });
    await frames(phase, 'execution-expand', () => summary.evaluate(element => element.click()));
    await frames(phase, 'execution-collapse', () => summary.evaluate(element => element.click()));
    if (phase === 'after') await measure('execution-expand-collapse', async () => { await summary.evaluate(element => element.click()); await page.waitForTimeout(240); await summary.evaluate(element => element.click()); });
    await frames(phase, 'steps-enter', async () => { await projectSteps(1); await projectSteps(3); });
    await frames(phase, 'queue-enter', () => projectQueue(2));
    await frames(phase, 'queue-exit', () => projectQueue(0));
    await projectQueue(21); await projectSteps(21);
    const longLists = await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running' && animation.effect.getTiming().iterations !== Infinity && (animation.effect.target.closest('#task-queue, #motion-steps'))).length);
    assert.equal(longLists, 0, 'more than 20 rows show immediately');
    await projectQueue(0); await page.locator('#motion-steps').evaluate(element => element.remove());
    await page.getByRole('button', { name: '输出与来源', exact: true }).click();
    await frames(phase, 'panel-open', () => page.getByRole('button', { name: /README.md.*读取/ }).evaluate(button => button.click()));
    await page.getByRole('button', { name: '再打开一项' }).click();
    await page.getByRole('button', { name: '项目进度报告.md', exact: true }).click();
    const sourceTab = page.getByRole('tab', { name: 'README.md', exact: true });
    await frames(phase, 'panel-tab', () => sourceTab.evaluate(button => button.click()));
    if (phase === 'after') await measure('panel-tab', async () => { await page.getByRole('tab', { name: '项目进度报告.md', exact: true }).evaluate(button => button.click()); await page.waitForTimeout(240); await sourceTab.evaluate(button => button.click()); });
    await frames(phase, 'panel-close', () => page.getByRole('button', { name: '收起右侧面板', exact: true }).evaluate(button => button.click()));
    if (phase === 'after') await measure('panel-open-close', async () => {
      await page.evaluate(() => window.WeftDesktop.openPreview('性能合成预览'));
      await page.waitForTimeout(240);
      await page.getByRole('button', { name: '收起右侧面板', exact: true }).evaluate(button => button.click());
    });
    const search = page.getByRole('searchbox', { name: '搜索会话', exact: true });
    await frames(phase, 'session-list', () => search.fill('项目'));
    await search.fill('');
    await page.getByRole('button', { name: '合成空白对话', exact: true }).click();
    await frames(phase, 'session-switch', async () => { await page.getByRole('button', { name: /^项目进度报告(?:\s|$)/ }).evaluate(button => button.click()); await page.getByRole('button', { name: phase === 'before' ? '允许一次' : '批准', exact: true }).waitFor(); });
    await page.getByRole('button', { name: '账户菜单' }).click();
    await frames(phase, 'page-switch', () => page.getByRole('button', { name: '设置', exact: true }).evaluate(button => button.click()));
    await page.getByRole('button', { name: phase === 'before' ? /返回对话/ : '关闭设置' }).click();
    await frames(phase, 'approval-resolve', async () => {
      await page.getByRole('button', { name: phase === 'before' ? '允许一次' : '批准', exact: true }).evaluate(button => button.click());
      if (phase === 'before') await until(() => page.getByText(/已提交允许|已允许本次/).count());
      else await page.getByRole('region', { name: '待批准操作' }).waitFor({ state: 'hidden' });
    });
    await frames(phase, 'reply-and-send-stop', async () => {
      await candidate.complete(true);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await page.getByText('报告已保存，测试全部通过。', { exact: true }).waitFor();
      await page.getByRole('button', { name: '停止', exact: true }).waitFor({ state: 'hidden' });
      await page.getByText('报告已保存，测试全部通过。', { exact: true }).scrollIntoViewIfNeeded();
    });
    if (phase === 'reduced') {
      assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
      assert.equal(await page.locator('.motion-copy').count(), 0);
      // Switching the preference while a dismissal is running must cancel and clean it up.
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.evaluate(() => { const detail = document.querySelector('.execution-block'); detail.open = true; window.WeftMotion.dismiss(window.WeftMotion.snapshot(detail), true); });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await until(async () => await page.locator('.motion-copy').count() === 0);
      assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
    }
    // Final geometry and scroll metrics are fixed for the full animation lifetime.
    await page.evaluate(() => { const element = document.querySelector('.execution-block'); element.open = false; element.querySelector('summary').click(); });
    const layout = await page.evaluate(() => { const scroll = document.getElementById('chat-scroll'); return { height: scroll.scrollHeight, top: scroll.scrollTop }; });
    await page.waitForTimeout(260);
    assert.deepEqual(await page.evaluate(() => { const scroll = document.getElementById('chat-scroll'); return { height: scroll.scrollHeight, top: scroll.scrollTop }; }), layout);
    await page.getByRole('textbox', { name: '输入消息', exact: true }).fill('动效过程中可继续输入');
    await page.locator('.execution-block > summary').first().press('Enter');
    assert.equal(await page.getByRole('textbox', { name: '输入消息', exact: true }).inputValue(), '动效过程中可继续输入');
  }
  assert.deepEqual(errors, []);
  if (capture) writeFileSync(join(evidence, 'verification.json'), JSON.stringify({ baseline, realProgram: !fixture, syntheticLogModel: true, isolated: true, modelRequests: 0, framesAreDeterministicAnimationSamples: true, results, performance: performanceResults, reducedMotion: true, livePreferenceChange: true, longLists: true, keyboard: true, geometryStable: true, errors }, null, 2) + '\n');
  console.log('UI-P1 desktop motion and reduced-motion behavior passed.');
} catch (error) { console.error(error); if (page) { console.error((await page.locator('body').innerText()).slice(-1800)); await page.screenshot({ path: join(root, 'failure.png'), timeout: 5000 }).catch(() => {}); console.error('Isolated diagnostics:', root); } throw error; }
finally { await page?.unrouteAll({ behavior: 'wait' }).catch(() => {}); await application?.close().catch(() => {}); await candidate?.close(); await Promise.all(retiredCandidates.map(host => host.close())); }
