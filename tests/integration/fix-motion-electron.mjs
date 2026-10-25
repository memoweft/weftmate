// Production Electron shell; isolated identity/profile and synthetic host only.
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { startFixture } from './ux-4-fixture.mjs';
import { feedbackUiSession } from '../helpers/feedback-ui-session.mjs';

const repo = resolve(import.meta.dirname, '../..');
const profile = await mkdtemp(join(tmpdir(), 'weftmate-fix-motion-'));
// Keep the CI runner's managed parent/scope together; local direct runs get
// their own fixture root so they never scan another test's temporary files.
if (!process.env.WEFTMATE_TEST_TEMP_SCOPE) process.env.WEFTMATE_MANAGED_TEMP_ROOT = join(profile, 'fixtures');
const out = process.env.WEFTMATE_MOTION_OUTPUT;
if (out) await mkdir(out, { recursive: true });
const bootstrap = join(profile, 'motion-shell.mjs');
await writeFile(bootstrap, `import {createRequire} from 'node:module';
const {app}=createRequire(${JSON.stringify(new URL('../../package.json', import.meta.url).href)})('electron');
app.setName('WeftMate Motion Test');
app.setAppUserModelId('com.memoweft.weftmate.test.motion');
for(const stream of [process.stdout,process.stderr])stream.on('error',error=>{if(error.code!=='EPIPE')throw error});
await import(${JSON.stringify(new URL('../../scripts/review-gallery/electron.mjs', import.meta.url).href)});
`);
let app, fixture;
const killTree = () => {
  const child = app?.process();
  if (child?.exitCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill('SIGKILL');
  }
};
const deadline = setTimeout(() => { killTree(); process.exitCode = 1; }, 110000);
try {
  fixture = await startFixture();
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_)/.test(key) || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
  Object.assign(env, { REVIEW_PROFILE: profile, REVIEW_ORIGIN: fixture.origin, REVIEW_LIBRARY_TOKEN: fixture.libraryDesktopToken, REVIEW_THEME: 'light', REVIEW_HIDDEN: '1', WEFTMATE_TEST_HOST_NAME: 'synthetic-host' });
  app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: repo, args: [bootstrap], env, timeout: 30000 });
  for (const stream of [app.process().stdout, app.process().stderr]) stream?.on('error', error => { if (error.code !== 'EPIPE') throw error; });
  const page = await app.firstWindow(); page.setDefaultTimeout(12000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await feedbackUiSession(page, fixture, { native: true });
  await page.evaluate(async id => { await globalThis.__feedbackSessionCore.selectSession(id); }, fixture.source);
  // Hidden native windows intentionally pause motion. Drive their presentation
  // state explicitly while keeping the actual window off the user's desktop.
  await page.evaluate(() => WeftReplyMotion.setVisibility(false));
  assert.equal(await page.evaluate(() => WeftReplyMotion.paused), false);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.body.dataset.theme = theme; }, theme);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => { WeftReplyMotion.setPreference('system'); document.querySelector('.activity-entry').click(); });
    assert.equal(await page.locator('.activity-surface').getAttribute('data-motion'), 'view-enter');
    assert.equal(await page.locator('.activity-surface').evaluate(node => getComputedStyle(node).animationName), 'm-enter-rise');
    for (const view of ['library', 'goals', 'health']) {
      await page.locator('.' + view + '-entry').evaluate(button => button.click());
      const surface = page.locator('.' + view + '-surface');
      await surface.waitFor({ state: 'visible' });
      assert.equal(await surface.getAttribute('data-motion'), 'view-enter');
    }
    await page.evaluate(() => {
      for (const animation of document.getElementById('assistant-view').getAnimations()) animation.finish();
      __feedbackSessionCore.show('account');
    });
    assert.equal(await page.locator('#account-view').getAttribute('data-motion'), 'enter-fade');
    await page.evaluate(async id => { await __feedbackSessionCore.selectSession(id); __feedbackSessionCore.show('assistant'); }, fixture.source);
    assert.equal(await page.locator('#assistant-view').getAttribute('data-motion'), 'view-enter');
    assert.equal(await page.locator('#assistant-view').evaluate(node => node.getAnimations().some(animation => animation.animationName === 'm-enter-rise' && animation.playState === 'running')), true, 'returning from settings must replay entry on the reused chat surface');
    const result = await page.evaluate(async () => {
      const body = WeftContent.create('', 'message-text markdown-body');
      const row = document.createElement('li'); row.className = 'message assistant'; row.dataset.motion = 'enter-rise'; row.append(body); document.getElementById('transcript').append(row);
      const text = '你好🙂，这段**合成回复**按帧流入。';
      WeftContent.update(body, text, { streaming: true });
      const before = body._renderText || '';
      await new Promise(requestAnimationFrame);
      const first = body._renderText;
      WeftContent.update(body, text + '完成。', { streaming: false });
      const samples = [first];
      while (body._renderText !== text + '完成。') { await new Promise(requestAnimationFrame); samples.push(body._renderText); }
      return { before, first, samples, text: body.textContent, html: body.innerHTML, rowAnimation: getComputedStyle(row).animationName };
    });
    assert.equal(result.before, ''); assert.ok(Array.from(result.first).length >= 1 && Array.from(result.first).length <= 3);
    for (let i = 1; i < result.samples.length; i++) assert.ok(Array.from(result.samples[i]).length - Array.from(result.samples[i - 1]).length <= 3);
    assert.equal(result.text, '你好🙂，这段合成回复按帧流入。完成。'); assert.match(result.html, /<strong>合成回复<\/strong>/);
    assert.equal(result.rowAnimation, 'm-enter-rise');
    const css = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return ['dur-1', 'dur-2', 'dur-3', 'dur-4', 'dur-5', 'ease-out', 'ease-in-out', 'ease-in', 'ease-linear'].map(key => style.getPropertyValue('--' + key).trim());
    });
    assert.deepEqual(css.slice(0, 5), ['130ms', '220ms', '320ms', '420ms', '640ms']); assert.ok(css.slice(5).every(Boolean));
    const recipes = await page.evaluate(() => {
      const result = {};
      for (const name of ['enter-rise', 'enter-fade', 'stagger-rise', 'view-enter', 'sheet-in', 'unfold', 'text-shimmer']) {
        const node = document.createElement('div'); node.dataset.motion = name; node.textContent = '合成占位';
        const child = document.createElement('div'); child.textContent = '内容'; node.append(child); document.body.append(node);
        const style = getComputedStyle(name === 'stagger-rise' ? child : node);
        result[name] = name === 'unfold' ? style.transitionDuration : style.animationName;
        node.remove();
      }
      const style = getComputedStyle(document.documentElement);
      result.alias = style.getPropertyValue('--wm-duration-fast').trim();
      return result;
    });
    assert.deepEqual(recipes, { 'enter-rise': 'm-enter-rise', 'enter-fade': 'm-fade', 'stagger-rise': 'm-enter-rise', 'view-enter': 'm-enter-rise', 'sheet-in': 'm-sheet-in', unfold: '0.42s', 'text-shimmer': 'm-shimmer', alias: '130ms' });
    assert.deepEqual(await page.evaluate(() => {
      const status = document.createElement('p'); document.body.append(status);
      WeftReplyMotion.status(status, '正在读取合成结果…', true);
      const loading = status.dataset.motion;
      WeftReplyMotion.setVisibility(true);
      const paused = getComputedStyle(status).animationPlayState;
      WeftReplyMotion.setVisibility(false);
      status.classList.add('reply-offscreen');
      const offscreen = getComputedStyle(status).animationPlayState;
      status.classList.remove('reply-offscreen');
      WeftReplyMotion.status(status, '合成结果已读取', false);
      const result = { loading, paused, offscreen, loaded: status.dataset.motion, text: status.firstChild.textContent }; status.remove(); return result;
    }), { loading: 'text-shimmer', paused: 'paused', offscreen: 'paused', loaded: 'enter-fade', text: '合成结果已读取' });
    if (out) {
      const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
      await writeFile(join(out, `${theme}.png`), Buffer.from(png, 'base64'));
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.evaluate(() => WeftReplyMotion.reduced), true);
    await page.evaluate(() => document.querySelector('.activity-entry').click());
    assert.equal(await page.locator('.activity-surface').evaluate(node => getComputedStyle(node).animationName), 'none');
    assert.equal(await page.evaluate(() => { const body = WeftContent.create('立即显示', 'markdown-body', { streaming: true }); return body.textContent; }), '立即显示');
    assert.deepEqual(await page.evaluate(() => {
      const result = {};
      for (const name of ['view-enter', 'sheet-in', 'text-shimmer', 'unfold', 'stagger-rise']) {
        const node = document.createElement('div'); node.dataset.motion = name; const child = document.createElement('div'); node.append(child); document.body.append(node);
        const style = getComputedStyle(name === 'stagger-rise' ? child : node);
        result[name] = name === 'unfold' ? style.transitionDuration : style.animationName; node.remove();
      }
      return result;
    }), { 'view-enter': 'none', 'sheet-in': 'none', 'text-shimmer': 'none', unfold: '0s', 'stagger-rise': 'none' });
    // Drive the actual settings controls, including manual overrides of the OS.
    await page.evaluate(theme => { WeftDesktop.setAppearance({ theme }); WeftSettingsNavigation.open('appearance'); }, theme);
    if (!await page.locator('.appearance-advanced').evaluate(details => details.open)) await page.locator('.appearance-advanced > summary').click();
    const motionButtons = page.getByRole('group', { name: '减少动态效果', exact: true });
    const probe = () => page.evaluate(async () => {
      const node = document.createElement('div'); node.dataset.motion = 'view-enter';
      const text = '设置动效开关的合成回复';
      const body = WeftContent.create('', 'markdown-body'); node.append(body); document.body.append(node);
      const progress = document.createElement('ol'); node.append(progress);
      WeftTimeline.render([
        { seq: 0, type: 'turn.started', data: { turn: 1 } },
        ...['read', 'exec'].map((toolName, index) => ({ seq: index + 1, type: 'step.started', at: new Date().toISOString(),
          data: { taskId: 'motion-task', stepId: `motion-step-${index}`, toolName, state: 'running', summary: '合成进展步骤' } })),
      ], progress);
      const block = progress.querySelector('.execution-block'), step = progress.querySelector('.execution-step');
      block.open = true; step.open = true;
      WeftContent.update(body, text, { streaming: true });
      const immediate = body._renderText || '';
      await new Promise(requestAnimationFrame);
      for (const animation of progress.getAnimations({ subtree: true })) if (animation.effect.getTiming().iterations !== Infinity) animation.finish();
      const records = progress.querySelector('.execution-records');
      const progressStyle = { animations: progress.getAnimations({ subtree: true }).length,
        dots: [...progress.querySelectorAll('.progress-indicator i')].map(dot => ({ animation: getComputedStyle(dot).animationName, opacity: getComputedStyle(dot).opacity })),
        transition: getComputedStyle(block, '::details-content').transitionDuration,
        recordsDisplay: getComputedStyle(records).display, recordsHeight: records.getBoundingClientRect().height,
        stepDisplay: getComputedStyle(step).display, summaryHeight: step.querySelector('summary').getBoundingClientRect().height };
      const result = { preference: WeftReplyMotion.preference, reduced: WeftReplyMotion.reduced,
        animation: getComputedStyle(node).animationName, immediate, first: body._renderText, text, progress: progressStyle };
      node.remove(); return result;
    });
    const checkProgress = choice => {
      assert.equal(choice.progress.recordsDisplay, 'block');
      assert.notEqual(choice.progress.stepDisplay, 'grid');
      assert.ok(choice.progress.recordsHeight > 0 && choice.progress.summaryHeight > 0, 'expanded progress and its summary remain visible');
      if (choice.reduced) {
        assert.equal(choice.progress.animations, 0); assert.equal(choice.progress.transition, '0s');
        assert.ok(choice.progress.dots.every(dot => dot.animation === 'none' && dot.opacity === '0.6'));
      } else assert.ok(choice.progress.dots.every(dot => dot.animation === 'm-progress-dot'));
    };
    await motionButtons.getByRole('button', { name: '关闭', exact: true }).click();
    let choice = await probe();
    checkProgress(choice);
    assert.equal(choice.preference, 'full'); assert.equal(choice.reduced, false);
    assert.equal(choice.animation, 'm-enter-rise'); assert.equal(choice.immediate, '');
    assert.ok(Array.from(choice.first).length >= 1 && Array.from(choice.first).length <= 3);
    assert.equal(await page.evaluate(() => {
      WeftSettingsNavigation.open('general');
      return document.querySelector('.settings-category[data-category=general]').getAnimations().some(animation => animation.playState === 'running');
    }), true, 'manual motion-on must override the system setting for settings navigation too');
    await page.reload();
    await page.waitForFunction(() => globalThis.__feedbackSessionCore?.state.device?.authKind === 'desktop');
    await page.evaluate(async id => { await __feedbackSessionCore.selectSession(id); WeftReplyMotion.setVisibility(false); WeftSettingsNavigation.open('appearance'); }, fixture.source);
    if (!await page.locator('.appearance-advanced').evaluate(details => details.open)) await page.locator('.appearance-advanced > summary').click();
    assert.equal(await motionButtons.getByRole('button', { name: '关闭', exact: true }).getAttribute('aria-pressed'), 'true');
    choice = await probe(); assert.equal(choice.preference, 'full'); assert.equal(choice.reduced, false); assert.equal(choice.animation, 'm-enter-rise');
    checkProgress(choice);
    await motionButtons.getByRole('button', { name: '系统', exact: true }).click();
    choice = await probe(); assert.equal(choice.preference, 'system'); assert.equal(choice.reduced, true);
    checkProgress(choice);
    assert.equal(choice.animation, 'none'); assert.equal(choice.immediate, choice.text);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    // Drive foreground restoration while keeping the native test window hidden.
    await page.evaluate(() => { WeftReplyMotion.setVisibility(true); WeftReplyMotion.setVisibility(false); });
    await page.waitForFunction(() => !WeftReplyMotion.reduced && !document.documentElement.hasAttribute('data-reduced-motion'));
    choice = await probe(); assert.equal(choice.animation, 'm-enter-rise'); assert.equal(choice.immediate, '');
    checkProgress(choice);
    await motionButtons.getByRole('button', { name: '开启', exact: true }).click();
    choice = await probe(); assert.equal(choice.preference, 'reduce'); assert.equal(choice.reduced, true);
    checkProgress(choice);
    assert.equal(choice.animation, 'none'); assert.equal(choice.immediate, choice.text);
    if (out) {
      const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
      await writeFile(join(out, `${theme}-settings-motion.png`), Buffer.from(png, 'base64'));
    }
    await motionButtons.getByRole('button', { name: '系统', exact: true }).click();
    await page.evaluate(() => __feedbackSessionCore.show('assistant'));
  }
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.isVisible())), false);
  assert.deepEqual(errors, []);
  console.log('PASS: production Electron motion, six views, light/dark, per-frame Markdown streaming and live reduced motion.');
} finally {
  clearTimeout(deadline); killTree();
  await app?.close().catch(error => { if (!/closed|EPIPE|Target/.test(error.message)) throw error; });
  await fixture?.close();
  await rm(profile, { recursive: true, force: true });
}
