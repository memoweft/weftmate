/** Production Electron and shipped mobile assets; isolated host, synthetic account, random ports. */
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startRenderingCandidate } from './ux-5-fixture.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';

const out = resolve('tests/evidence/ux-8');
const verifyOnly = process.argv.includes('--verify-only');
const performanceOnly = process.argv.includes('--performance-only');
const evidenceOnly = process.argv.includes('--evidence-only');
const surfaces = verifyOnly ? ['desktop'] : ['desktop', 'mobile-web', 'android-ui'];
const baselineSource = execFileSync('git', ['show', 'HEAD:src/ui-core/rendering.js'], { encoding: 'utf8' });
const report = { generatedAt: new Date().toISOString(), baselineCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), synthetic: true, androidNativeDevice: false, cpuMetric: 'CDP Performance.getMetrics TaskDuration delta / elapsed wall time; renderer main-thread busy fraction, not total system or GPU CPU', checks: [], sequences: [], performance: [], errors: [] };
await mkdir(out, { recursive: true });

async function selectSample(page, surface) {
  if (surface === 'android-ui') { await page.evaluate(() => listSharedSessions()); await page.getByRole('button', { name: '打开导航', exact: true }).click(); }
  const item = page.getByRole('button', { name: '渲染样张', exact: true, includeHidden: true });
  await item.waitFor({ state: 'attached' });
  if (surface === 'mobile-web' && !await item.isVisible()) await page.locator('#rail-open').click();
  await item.click();
  await page.getByRole('heading', { name: '一份可以读、可以用的回复', exact: true }).waitFor();
}

async function projection(page) {
  await page.waitForFunction(() => !!(document.getElementById('transcript') || document.getElementById('main-chat-transcript') || document.getElementById('chat-content')));
  await page.mouse.move(4, 4);
  await page.evaluate(() => {
    document.activeElement?.blur();
    document.getElementById('ux8-projection-list')?.remove();
    const transcript = document.getElementById('transcript') || document.getElementById('main-chat-transcript') || document.getElementById('chat-content');
    const list = transcript.cloneNode(false); list.id = 'ux8-projection-list';
    const root = document.createElement('li'); root.id = 'ux8-projection'; root.className = 'message assistant is-last-assistant';
    const title = document.createElement('p'); title.textContent = '合成动态效果验收'; title.className = 'muted';
    const status = document.createElement('p'); status.id = 'ux8-status'; status.className = 'inline-progress-summary'; status.setAttribute('aria-live', 'polite');
    const user = document.createElement('div'); user.id = 'ux8-user'; user.className = 'message user'; const bubble = document.createElement('div'); bubble.className = 'message-user-bubble'; bubble.textContent = '请整理这份合成资料。'; user.append(bubble);
    const content = WeftContent.create('我会先读取资料，再整理结果。'); content.id = 'ux8-content';
    const actions = document.createElement('div'); actions.id = 'ux8-actions'; actions.className = 'message-actions';
    const copy = document.createElement('button'); copy.className = 'message-action'; copy.setAttribute('aria-label', '复制'); copy.title = '复制'; copy.append(WeftIcons.create('copy', 16)); actions.append(copy);
    const error = document.createElement('p'); error.id = 'ux8-error'; error.className = 'muted'; error.textContent = '连接暂时中断，内容已保留。'; error.hidden = true;
    root.append(title, user, status, content, actions, error);
    list.append(root); transcript.after(list);
    root.scrollIntoView({ block: 'center', behavior: 'instant' });
    globalThis.ux8 = { root, user, status, content, actions, error };
    WeftReplyMotion.setPreference('full');
    WeftReplyMotion.status(status, '正在思考…', true);
    WeftReplyMotion.indicator(content, true);
  });
  await page.waitForTimeout(220);
  await page.evaluate(() => {
    const box = document.getElementById('chat-scroll');
    box?.dispatchEvent(new WheelEvent('wheel', { deltaY: -240, bubbles: true }));
    ux8.root.scrollIntoView({ block: 'center', behavior: 'instant' });
    box?.dispatchEvent(new Event('scroll'));
  });
}

async function sequence(page, surface, theme, name, action, times = [0, 20, 40, 60, 90, 120, 150, 180]) {
  await page.evaluate(() => { for (const animation of document.getAnimations()) if (animation.effect?.getTiming().iterations !== Infinity) try { animation.finish(); } catch {} });
  await action();
  const samples = [];
  await page.evaluate(async () => { await new Promise(requestAnimationFrame); if (!ux8.root.isConnected) throw Error('Synthetic projection was removed during capture'); globalThis.ux8Animations = document.getAnimations().filter(animation => animation.effect?.target?.closest?.('#ux8-projection')); for (const animation of ux8Animations) animation.pause(); ux8.root.scrollIntoView({block:'center',behavior:'instant'}); });
  for (const time of times) {
    samples.push(await page.evaluate(time => {
      for (const animation of ux8Animations) animation.currentTime = time;
      return ux8Animations.filter(animation => animation.effect?.target?.isConnected).map(animation => ({ target: animation.effect.target.id || animation.effect.target.className, duration: animation.effect.getTiming().duration, iterations: animation.effect.getTiming().iterations === Infinity ? 'infinite' : animation.effect.getTiming().iterations, opacity: getComputedStyle(animation.effect.target).opacity }));
    }, time));
    if (!verifyOnly) await page.screenshot({ path: join(out, `${surface}-${theme}-${name}-${String(time).padStart(4, '0')}.png`), animations: 'allow' });
  }
  await page.evaluate(() => { for (const animation of ux8Animations) if (animation.effect?.getTiming().iterations === Infinity) animation.play(); else try { animation.finish(); } catch {} });
  report.sequences.push({ surface, theme, name, timesMs: times, samples });
}

async function contracts(page, surface) {
  const result = await page.evaluate(async () => {
    const { status, content, root } = ux8;
    const initialHeight = root.getBoundingClientRect().height;
    const text = content.textContent;
    for (let n = 0; n < 30; n++) WeftReplyMotion.status(status, `正在读取第 ${n + 1} 个文件…`, true);
    const immediate = status.textContent;
    const activeSwitches = document.getAnimations().filter(animation => animation.effect?.target?.closest?.('#ux8-status') && animation.effect.getTiming().iterations !== Infinity).length;
    await new Promise(done => setTimeout(done, 200));
    const statusHeight = root.getBoundingClientRect().height;
    WeftReplyMotion.setPreference('reduce');
    WeftReplyMotion.status(status, '正在思考…', true); WeftReplyMotion.reveal(content); WeftReplyMotion.indicator(content, true);
    const reduced = WeftReplyMotion.reduced;
    const reducedAnimations = document.getAnimations().filter(animation => animation.playState === 'running' && animation.effect?.target?.closest?.('#ux8-projection')).length;
    const reducedText = content.textContent;
    WeftReplyMotion.setPreference('full'); WeftReplyMotion.indicator(content, true);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    const hiddenFlag = document.documentElement.dataset.motionPaused;
    const hiddenAnimations = document.getAnimations().filter(animation => animation.effect?.target?.closest?.('#ux8-projection')).map(animation => animation.playState);
    delete document.hidden; document.dispatchEvent(new Event('visibilitychange'));
    WeftReplyMotion.indicator(content, false);
    await new Promise(done => setTimeout(done, 220));
    return { immediate, activeSwitches, initialHeight, statusHeight, reduced, reducedAnimations, textUnchanged: reducedText === text, hiddenFlag, hiddenAnimations, indicatorRemaining: content.querySelectorAll('.reply-indicator').length, live: status.getAttribute('aria-live') };
  });
  assert.match(result.immediate, /第 30 个文件/); assert.ok(result.activeSwitches <= 2, `status changes must coalesce: ${JSON.stringify(result)}`);
  assert.equal(result.reduced, true); assert.equal(result.reducedAnimations, 0); assert.equal(result.textUnchanged, true); assert.equal(result.indicatorRemaining, 0); assert.equal(result.live, 'polite');
  assert.ok(result.hiddenAnimations.every(state => state !== 'running'), `hidden animation paused: ${JSON.stringify(result)}`);
  report.checks.push({ surface, ...result });
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.evaluate(() => WeftReplyMotion.setPreference('system')); assert.equal(await page.evaluate(() => WeftReplyMotion.reduced), true);
  await page.emulateMedia({ reducedMotion: 'no-preference' }); assert.equal(await page.evaluate(() => WeftReplyMotion.reduced), false);
}

async function geometry(page, surface) {
  const result = await page.evaluate(async () => {
    const scroll = document.getElementById('chat-scroll') || document.getElementById('messages');
    const container = scroll?.scrollHeight > scroll?.clientHeight ? scroll : document.scrollingElement;
    ux8.root.scrollIntoView({ block: 'center', behavior: 'instant' });
    await new Promise(done => setTimeout(done, 240));
    container.dispatchEvent(new WheelEvent('wheel', { deltaY: -240, bubbles: true }));
    container.scrollTop = Math.max(0, container.scrollTop - 120); container.dispatchEvent(new Event('scroll'));
    await new Promise(requestAnimationFrame);
    const before = ux8.root.getBoundingClientRect(), height = ux8.root.offsetHeight, childrenBefore = [...ux8.root.children].map(el => ({ id: el.id, height: el.offsetHeight, marginTop: getComputedStyle(el).marginTop, marginBottom: getComputedStyle(el).marginBottom }));
    WeftReplyMotion.status(ux8.status, '正在读取文件…', true);
    WeftReplyMotion.reveal(ux8.content); WeftReplyMotion.indicator(ux8.content, true);
    const samples = [];
    for (let n = 0; n < 12; n++) { await new Promise(requestAnimationFrame); samples.push({ top: ux8.root.getBoundingClientRect().top, height: ux8.root.offsetHeight, scrollTop: container.scrollTop }); }
    return { top: before.top, height, childrenBefore, childrenAfter: [...ux8.root.children].map(el => ({id:el.id,height:el.offsetHeight,marginTop:getComputedStyle(el).marginTop,marginBottom:getComputedStyle(el).marginBottom})), samples, maxAnchorDrift: Math.max(...samples.map(sample => Math.abs(sample.top - before.top))), maxHeightDrift: Math.max(...samples.map(sample => Math.abs(sample.height - height))) };
  });
  assert.ok(result.maxAnchorDrift <= 1, `${surface} visible anchor must remain stable: ${JSON.stringify(result)}`); assert.equal(result.maxHeightDrift, 0, JSON.stringify(result));
  report.checks.push({ surface, geometry: result });
  const follow = await page.evaluate(async () => {
    const box = document.createElement('div'); box.style.cssText = 'position:fixed;top:0;left:0;width:320px;height:180px;overflow:auto;z-index:5';
    const content = document.createElement('div'); content.style.height = '400px'; box.append(content); document.body.append(box);
    const button = document.createElement('button'); document.body.append(button);
    const helper = WeftConversationScroll(box, content, button); helper.latest();
    const start = box.scrollTop; content.style.height = '520px'; helper.changed();
    const samples = []; for (let n = 0; n < 14; n++) { await new Promise(requestAnimationFrame); samples.push(box.scrollTop); } await new Promise(done => setTimeout(done, 220));
    const smoothEnd = box.scrollTop, gap = box.scrollHeight - box.clientHeight - smoothEnd;
    content.style.height = '700px'; helper.changed(); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    box.dispatchEvent(new WheelEvent('wheel', { deltaY: -120 })); box.scrollTop -= 120; helper.scrolled();
    const held = box.scrollTop; await new Promise(done => setTimeout(done, 240)); const afterUserUp = box.scrollTop;
    const pinnedAfterUp = helper.pinned;
    WeftReplyMotion.setPreference('reduce'); helper.latest(); content.style.height = '900px'; helper.changed(); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    const reducedGap = box.scrollHeight - box.clientHeight - box.scrollTop; box.remove(); button.remove(); WeftReplyMotion.setPreference('full');
    return { start, samples, smoothEnd, gap, held, afterUserUp, pinnedAfterUp, reducedGap };
  });
  assert.ok(Math.abs(follow.gap) <= 1, JSON.stringify(follow)); assert.ok(follow.samples.some(top => top > follow.start && top < follow.smoothEnd), 'stream following moves through intermediate positions');
  assert.equal(follow.held, follow.afterUserUp); assert.equal(follow.pinnedAfterUp, false); assert.ok(Math.abs(follow.reducedGap) <= 1);
  report.checks.push({ surface, follow });
}

async function benchmark(page, surface, phase, session, app) {
  await page.evaluate(phase => WeftReplyMotion.setPreference(phase === 'before' ? 'reduce' : 'full'), phase);
  await page.waitForTimeout(2500);
  const metrics = async () => Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]));
  const processCpu = async () => app ? app.evaluate(({ app }) => app.getAppMetrics().filter(metric => ['Tab', 'GPU'].includes(metric.type)).map(metric => ({ type: metric.type, pid: metric.pid, creationTime: metric.creationTime, percentCPUUsage: metric.cpu.percentCPUUsage, cumulativeCPUUsage: metric.cpu.cumulativeCPUUsage ?? null }))) : null;
  await session.send('Performance.enable');
  await processCpu(); // Electron docs: each call resets the sampling interval.
  const idleStart = await metrics(), idleAt = performance.now(); await page.waitForTimeout(1600); const idleEnd = await metrics();
  const idleElapsed = performance.now() - idleAt;
  const idleProcessCpu = await processCpu();
  await processCpu();
  const streamStart = await metrics(), streamAt = performance.now();
  const perf = await page.evaluate(async phase => {
    const text = '# 万字性能样张\n\n' + ('中文 English 内容用于测试换行与高度。'.repeat(400)) + '\n\n' + Array.from({ length: 20 }, (_, i) => '```javascript\n' + `const code${i} = "value";\n`.repeat(12) + '```').join('\n\n') + '\n\n' + Array.from({ length: 5 }, () => '| 项目 | 数量 |\n| --- | ---: |\n| A | 12 |\n| B | 32 |').join('\n\n');
    const motion = globalThis.WeftReplyMotion; if (phase === 'before') globalThis.WeftReplyMotion = undefined;
    const host = WeftContent.create(text); host.style.cssText = 'position:fixed;left:0;top:0;width:390px;height:300px;overflow:hidden;z-index:5'; document.body.append(host);
    if (phase === 'after') WeftReplyMotion.indicator(host, true);
    const code = host.querySelector('.render-code'), updates = [], gaps = []; let last;
    const heapBefore = performance.memory?.usedJSHeapSize;
    try {
      for (let n = 1; n <= 120; n++) {
        const frame = await new Promise(requestAnimationFrame); if (last !== undefined) gaps.push(frame - last); last = frame;
        const at = performance.now(); WeftContent.update(host, text + '\n\n正在输出 ' + n + '。'); host.getBoundingClientRect(); updates.push(performance.now() - at);
      }
      const percentile = values => [...values].sort((a, b) => a - b)[Math.floor(values.length * .95)];
      return { characters: text.length, codeBlocks: 20, tables: 5, updateSamplesMs: updates, frameGapsMs: gaps, updateP95Ms: percentile(updates), frameGapP95Ms: percentile(gaps), updateMeanMs: updates.reduce((a,b)=>a+b)/updates.length, heapBefore: heapBefore ?? null, heapAfter: performance.memory?.usedJSHeapSize ?? null, stableCodeNode: code === host.querySelector('.render-code') };
    } finally { host.remove(); globalThis.WeftReplyMotion = motion; }
  }, phase);
  const streamEnd = await metrics();
  const streamProcessCpu = await processCpu();
  const cpu = (start, end, elapsed) => ({ rendererTaskDurationMs: (end.TaskDuration - start.TaskDuration) * 1000, elapsedMs: elapsed, mainThreadBusyPercent: (end.TaskDuration - start.TaskDuration) * 100000 / elapsed });
  report.performance.push({ surface, phase, batchOrder: report.performance.filter(row => row.surface === surface).length + 1, ...perf, idle: cpu(idleStart, idleEnd, idleElapsed), stream: cpu(streamStart, streamEnd, performance.now() - streamAt), electronCpu: app ? { api: 'app.getAppMetrics cpu.percentCPUUsage averages since prior call; separate renderer Tab and GPU processes', idle: idleProcessCpu, stream: streamProcessCpu } : null });
  assert.equal(perf.stableCodeNode, true);
}

for (const surface of surfaces) {
  const fixture = await startRenderingCandidate(), profile = await mkdtemp(join(tmpdir(), 'weftmate-ux8-ui-'));
  const env = { ...process.env, REVIEW_PROFILE: profile, REVIEW_ORIGIN: fixture.origin, REVIEW_THEME: 'light', REVIEW_LIBRARY_TOKEN: fixture.libraryDesktopToken };
  for (const key of Object.keys(env)) if (key.startsWith('WEFTMATE_') || key.startsWith('MEMOWEFT_') || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
  let app, browser, page, phase = 'after';
  try {
    if (surface === 'desktop') {
      const entry = join(profile, 'ux8-electron.cjs');
      await writeFile(entry, `const {app,nativeTheme}=require('electron'); app.setPath('userData',process.env.REVIEW_PROFILE); app.whenReady().then(async()=>{ nativeTheme.themeSource='light'; let quitting=false; const {createPersonalDesktop}=await import(${JSON.stringify(pathToFileURL(resolve('src/personal-desktop.mjs')).href)}); const desktop=createPersonalDesktop({origin:process.env.REVIEW_ORIGIN,libraryDesktopToken:process.env.REVIEW_LIBRARY_TOKEN,isQuitting:()=>quitting}); await desktop.ready; desktop.window.setContentSize(1200,800); app.on('before-quit',()=>quitting=true); });`);
      app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: resolve('.'), args: [entry], env, timeout: 90000 }); page = await app.firstWindow(); await localUiSession(page, fixture.credentials, 'UX-8 synthetic', { interceptLegacyStatus: false });
    }
    else { browser = await chromium.launch({ channel: 'chrome', headless: true }); page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); await page.goto(surface === 'mobile-web' ? fixture.origin + '/personal/v1/ui' : fixture.mobileUrl); if (surface === 'mobile-web') await localUiSession(page, fixture.credentials, 'UX-8 synthetic', { interceptLegacyStatus: false }); else await page.waitForFunction(() => state.booted && state.loggedIn); }
    page.setDefaultTimeout(20000); page.on('pageerror', error => report.errors.push({ surface, error: error.message }));
    await page.waitForFunction(() => !!globalThis.WeftReplyMotion);
    await selectSample(page, surface);
    for (const theme of performanceOnly ? [] : ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      await projection(page);
      await sequence(page, surface, theme, 'status-shimmer', () => page.evaluate(() => WeftReplyMotion.status(ux8.status, '正在思考…', true)), [0, 240, 480, 720, 960, 1200, 1440, 1800]);
      await sequence(page, surface, theme, 'status-switch', () => page.evaluate(() => WeftReplyMotion.status(ux8.status, '正在读取文件…', true)));
      await sequence(page, surface, theme, 'message-arrival', () => page.evaluate(() => { WeftReplyMotion.reveal(ux8.user, 'send'); WeftReplyMotion.reveal(ux8.content, 'arrival'); }));
      await sequence(page, surface, theme, 'stream-fragments', () => page.evaluate(() => { WeftContent.update(ux8.content, '我会先读取资料，再整理结果。新增的短片段立即可读。\n\n- 新到的列表行\n\n```javascript\nconst result = 1;\nconst next = 2;\n```', {streaming:true}); }));
      await sequence(page, surface, theme, 'indicator-breathe', () => page.evaluate(() => WeftReplyMotion.indicator(ux8.content, true)), [0, 240, 480, 720, 960, 1200, 1440, 1800]);
      await sequence(page, surface, theme, 'completion', () => page.evaluate(() => { WeftReplyMotion.indicator(ux8.content, false); WeftReplyMotion.reveal(ux8.actions, 'actions'); }));
      await sequence(page, surface, theme, 'stop-error', () => page.evaluate(() => { WeftReplyMotion.status(ux8.status, '已停止', false); ux8.error.hidden = false; WeftReplyMotion.reveal(ux8.error, 'error'); }));
      await page.evaluate(() => document.getElementById('ux8-projection-list').remove());
      const diagram = page.locator('.render-mermaid').first(); await diagram.scrollIntoViewIfNeeded(); await diagram.locator('.render-diagram img').waitFor();
      if (!verifyOnly) await page.screenshot({ path: join(out, `${surface}-${theme}-mermaid.png`) });
      const toolbar = await diagram.evaluate(el => { const header = el.querySelector('.render-block-head') || el.firstElementChild; const button = el.querySelector('button'); return { header: header.getBoundingClientRect().toJSON(), button: button.getBoundingClientRect().toJSON() }; });
      report.checks.push({ surface, theme, diagramToolbar: toolbar });
      await page.getByRole('button', { name: '查看图片 合成色板 A', exact: true }).click();
      const gallery = page.getByRole('dialog', { name: '图片画廊', exact: true }); await gallery.waitFor();
      if (!verifyOnly) await page.screenshot({ path: join(out, `${surface}-${theme}-gallery-open.png`) });
      const buttons = await gallery.locator('button,a').evaluateAll(elements => elements.filter(el => el.getBoundingClientRect().width > 0).map(el => ({ name: el.getAttribute('aria-label') || el.textContent, title: el.title, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })));
      assert.ok(buttons.every(button => button.width >= 40 && button.height >= 40 && button.title && button.name));
      report.checks.push({ surface, theme, galleryButtons: buttons });
      await gallery.getByRole('button', { name: '关闭图片画廊', exact: true }).click();
    }
    if (!verifyOnly && !performanceOnly) for (const size of surface === 'desktop' ? [{ width: 480, height: 800 }] : [{ width: 360, height: 780 }, { width: 390, height: 844 }]) {
      if (app) await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), size); else await page.setViewportSize(size);
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme); await projection(page);
        await page.screenshot({ path: join(out, `${surface}-${theme}-${size.width}x${size.height}.png`) });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      }
    }
    if (!performanceOnly) { await projection(page); await contracts(page, surface); await geometry(page, surface); }
    if (app && !performanceOnly) {
      await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.webContents.setBackgroundThrottling(true); win.minimize(); });
      await page.waitForFunction(() => WeftReplyMotion.paused, null, { polling: 100 });
      assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-motion-paused')), true);
      await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.restore(); win.webContents.setBackgroundThrottling(false); });
      await page.waitForFunction(() => !WeftReplyMotion.paused, null, { polling: 100 });
      report.checks.push({ surface, actualWindowMinimizePauses: true });
    }
    for (const theme of performanceOnly ? [] : ['light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; WeftReplyMotion.setPreference('reduce'); }, theme);
      if (!verifyOnly) await page.screenshot({ path: join(out, `${surface}-${theme}-reduced-motion.png`) });
      await page.evaluate(surface => surface === 'android-ui' ? page('appearance') : WeftSettingsNavigation.open('appearance'), surface);
      const control = page.getByRole('combobox', { name: '减少动态效果', exact: true }); await control.waitFor();
      if (!verifyOnly) await page.screenshot({ path: join(out, `${surface}-${theme}-appearance-open.png`) });
      await control.click();
      if (!verifyOnly) await page.screenshot({ path: join(out, `${surface}-${theme}-motion-menu-open.png`) });
      await page.getByRole('option', { name: '跟随系统', exact: true }).click(); assert.equal(await page.evaluate(() => WeftReplyMotion.preference), 'system');
      await control.click(); await page.getByRole('option', { name: '开启', exact: true }).click(); assert.equal(await page.evaluate(() => WeftReplyMotion.reduced), true);
      if (surface === 'android-ui') await page.getByRole('button', { name: '返回对话', exact: true }).click();
      else await page.getByRole('button', { name: '关闭设置', exact: true }).click();
      report.checks.push({ surface, theme, appearancePreference: true });
    }
    if (!verifyOnly && !evidenceOnly) {
      const session = await page.context().newCDPSession(page);
      await page.evaluate(() => globalThis.ux8CandidateContent = WeftContent);
      await page.route('**/ux8-baseline.js', route => route.fulfill({ contentType: 'text/javascript', body: baselineSource }));
      await page.evaluate(url => new Promise((done, fail) => { const script = document.createElement('script'); script.src = url; script.onload = () => done(); script.onerror = () => fail(new Error('UX-5 baseline script did not load')); document.head.append(script); }), new URL('ux8-baseline.js', page.url()).href);
      await page.evaluate(() => { globalThis.ux8BaselineContent = WeftContent; globalThis.WeftContent = ux8CandidateContent; });
      await projection(page);
      for (const current of ['before', 'after', 'after', 'before']) {
        phase = current; await page.evaluate(current => globalThis.WeftContent = current === 'before' ? ux8BaselineContent : ux8CandidateContent, current); await benchmark(page, surface, current, session, app);
      }
      await session.detach();
    }
    await writeFile(join(out, performanceOnly ? 'performance.json' : 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  } catch (error) { if (page) await page.screenshot({ path: join(out, `${surface}-failure.png`) }); throw error; }
  finally { await app?.close(); await browser?.close(); await fixture.close(); await rm(profile, { recursive: true, force: true }); await rm(fixture.root, { recursive: true, force: true }); }
}
assert.deepEqual(report.errors, []);
await writeFile(join(out, performanceOnly ? 'performance.json' : 'verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log('UX-8 production motion, reduced motion, visibility and geometry passed');
console.log(JSON.stringify(report.performance.map(({ surface, phase, updateP95Ms, frameGapP95Ms, idle, stream }) => ({ surface, phase, updateP95Ms, frameGapP95Ms, idle, stream })), null, 2));
