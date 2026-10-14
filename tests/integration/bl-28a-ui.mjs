import { evidencePath } from '../helpers/evidence-path.mjs';
/** BL-28a: production Electron and mobile web content, synthetic host and suggestion responses only. */
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
import { exposeUx7Desktop, mockUx7Requests, closeUx7Routes, assertUx7RouteErrors } from './ux-7-scenes.mjs';

const root = resolve(import.meta.dirname, '../..'), out = evidencePath('bl-28a');
await mkdir(out, { recursive: true });
const checks = [], shots = [], errors = [], pages = new Set();
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_)/.test(key) || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let fixture, profile, app, browser;
async function core(page, code, arg) {
  return page.evaluate(({ code, arg }) => new Function('core', 'arg', `return (async () => { ${code} })();`)(globalThis.__ux7core || uiCore, arg), { code, arg });
}
async function settings(page, mobile) {
  await page.evaluate(mobile => mobile ? globalThis.page('assistant') : __ux7ui.openSettings('assistant'), mobile);
  await page.getByRole('switch', { name: '输入时补全', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('#personalization-inlineCompletionEnabled').disabled);
}
async function closeSettings(page, mobile) {
  await page.evaluate(mobile => mobile ? globalThis.page('chat') : __ux7ui.hideSettingsDialog(), mobile);
}
async function setSwitch(page, name, value) {
  const toggle = page.getByRole('switch', { name, exact: true });
  if (await toggle.isChecked() !== value) await toggle.click();
  await page.waitForFunction(() => !document.querySelector('#personalization-inlineCompletionEnabled').disabled);
  assert.equal(await toggle.isChecked(), value);
}
function contrast(fg, bg) {
  const luminance = text => text.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => {
    v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
  }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
  const a = luminance(fg), b = luminance(bg); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
async function capture(page, surface, theme) {
  await page.locator('#toast').waitFor({ state: 'hidden' });
  await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
  const toggle = page.getByRole('switch', { name: '输入时补全', exact: true });
  assert.equal(await toggle.isChecked(), false);
  assert.equal(await page.getByRole('switch', { name: '下一步建议', exact: true }).isChecked(), true);
  await toggle.focus();
  await delay(180);
  const screenshot = `${surface}-${theme}-assistant-settings.png`;
  await page.screenshot({ path: join(out, screenshot) });
  const geometry = await toggle.evaluate(input => {
    const row = input.closest('.settings-row'), help = row.querySelector('p'), rect = row.getBoundingClientRect(), control = input.getBoundingClientRect();
    let surface = row, background;
    do { background = getComputedStyle(surface).backgroundColor; surface = surface.parentElement; }
    while (surface && (background === 'transparent' || background === 'rgba(0, 0, 0, 0)'));
    return { viewport: { width: innerWidth, height: innerHeight }, documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      row: rect.toJSON(), control: control.toJSON(), color: getComputedStyle(help).color, background,
      className: input.className, role: input.getAttribute('role'), description: help.textContent,
      controlStyle: { width: getComputedStyle(input).width, height: getComputedStyle(input).height, appearance: getComputedStyle(input).appearance },
      peerStyle: { width: getComputedStyle(document.querySelector('#personalization-webSearch')).width, height: getComputedStyle(document.querySelector('#personalization-webSearch')).height, appearance: getComputedStyle(document.querySelector('#personalization-webSearch')).appearance } };
  });
  assert.equal(geometry.documentOverflow, false);
  assert.ok(geometry.control.right <= geometry.viewport.width && geometry.control.left >= geometry.row.left);
  assert.ok(geometry.control.top >= geometry.row.top && geometry.control.bottom <= geometry.row.bottom);
  assert.match(geometry.className, /settings-switch/); assert.equal(geometry.role, 'switch');
  assert.deepEqual(geometry.controlStyle, geometry.peerStyle);
  assert.match(geometry.description, /用云端模型时可能来不及显示/);
  geometry.descriptionContrast = contrast(geometry.color, geometry.background); assert.ok(geometry.descriptionContrast >= 4.5);
  shots.push({ surface, theme, screenshot, webContentOnly: surface.startsWith('mobile'), geometry });
  console.log(screenshot);
}
async function exercise(page, surface, mobile) {
  let completions = 0, replies = 0;
  page.on('request', request => {
    if (request.method() !== 'POST') return;
    let input;
    if (request.url().includes('/suggestions')) input = request.postDataJSON();
    else if (request.url().endsWith('/bridge')) { const bridge = request.postDataJSON(); if (bridge.method === 'host.business' && bridge.params?.path.includes('/suggestions')) input = bridge.params.body; }
    if (input?.kind === 'completion') completions++;
    if (input?.kind === 'replies') replies++;
  });
  const field = page.locator('#message-text,#draft');
  await core(page, 'await core.loadPersonalization(); core.state.personalCapabilities = {...core.state.personalCapabilities,nextSuggestions:1}; core.syncNextSuggestions();');
  assert.equal(await core(page, 'return core.state.personalization.inlineCompletionEnabled;'), false);
  const before = completions;
  await field.fill('请'); await field.fill('请把'); await field.fill('请把它'); await delay(800);
  assert.equal(completions - before, 0);
  await field.press('Tab'); assert.equal(await field.inputValue(), '请把它');
  checks.push({ surface, scenario: 'default-off', completionRequests: completions - before, tabAccepted: false });
  await settings(page, mobile);
  assert.equal(await page.getByRole('switch', { name: '下一步建议', exact: true }).isChecked(), true);
  assert.equal(await page.getByRole('switch', { name: '输入时补全', exact: true }).isChecked(), false);
  if (!mobile) {
    for (const theme of ['light','dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      await page.evaluate(() => WeftHelpView.shortcuts());
      assert.equal(await page.locator('[data-shortcut-id="complete"]').textContent(), '接受灰色补全TAB');
      await page.locator('[data-shortcut-id="complete"]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(out, `${surface}-${theme}-shortcuts-off.png`) });
      await page.getByRole('button', { name: '关闭快捷键', exact: true }).click();
    }
  }
  await closeSettings(page, mobile);
  for (const replyEnabled of [true, false]) for (const completionEnabled of [false, true]) {
    await settings(page, mobile);
    await setSwitch(page, '下一步建议', replyEnabled); await setSwitch(page, '输入时补全', completionEnabled);
    await closeSettings(page, mobile);
    await field.fill(''); await core(page, 'core.cancelNextSuggestions();');
    const rb = replies, cb = completions;
    await core(page, 'await core.requestNextSuggestions("replies");');
    assert.equal(replies - rb, Number(replyEnabled));
    await field.fill('请把它'); await delay(800);
    assert.equal(completions - cb, Number(completionEnabled));
    assert.equal(await page.locator('.composer-completion').isVisible(), completionEnabled);
    await field.press('Tab');
    assert.equal(await field.inputValue(), completionEnabled ? '请把它保存成文件' : '请把它');
    checks.push({ surface, replyEnabled, completionEnabled, replyRequests: replies - rb, completionRequests: completions - cb, tabAccepted: completionEnabled });
  }
  await settings(page, mobile); await setSwitch(page, '下一步建议', true); await setSwitch(page, '输入时补全', false);
  await closeSettings(page, mobile); await field.fill('');
  assertUx7RouteErrors(page);
}
try {
  fixture = await startTimelineCandidate({ historyCount: 0, interactive: true, composer: true }); await fixture.complete();
  profile = await mkdtemp(join(tmpdir(), 'weftmate-bl28a-'));
  app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: root,
    args: ['scripts/review-gallery/electron.mjs'], env: { ...env, REVIEW_PROFILE: profile, REVIEW_ORIGIN: fixture.origin, REVIEW_THEME: 'light' } });
  const desktop = await app.firstWindow(); pages.add(desktop); desktop.setDefaultTimeout(15000); desktop.on('pageerror', error => errors.push(error.message));
  await exposeUx7Desktop(desktop); await localUiSession(desktop, fixture.credentials); await mockUx7Requests(desktop, undefined, { legacy: true });
  await desktop.reload(); await desktop.waitForFunction(() => globalThis.__ux7core?.state.account); await core(desktop, 'await core.selectSession(arg);', fixture.sessionId);
  await exercise(desktop, 'electron-1200', false);
  for (const width of [1200, 480]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 800), width);
    await settings(desktop, false); for (const theme of ['light', 'dark']) await capture(desktop, `electron-${width}`, theme);
    await closeSettings(desktop, false);
  }
  // The heavy Electron run ends before the browser starts.
  await closeUx7Routes(desktop); await app.close(); app = null;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const size of [{ width: 360, height: 780 }, { width: 390, height: 844 }]) {
    const remote = await browser.newPage({ viewport: size, isMobile: true, hasTouch: true }); pages.add(remote); remote.setDefaultTimeout(15000); remote.on('pageerror', error => errors.push(error.message));
    await exposeUx7Desktop(remote); await remote.goto(fixture.origin + '/personal/v1/ui'); await localUiSession(remote, fixture.credentials);
    await mockUx7Requests(remote, undefined, { legacy: true }); await remote.reload(); await remote.waitForFunction(() => globalThis.__ux7core?.state.account);
    await core(remote, 'await core.selectSession(arg);', fixture.sessionId);
    await exercise(remote, `mobile-web-${size.width}`, false); await settings(remote, false);
    for (const theme of ['light','dark']) await capture(remote, `mobile-web-${size.width}`, theme);
    assertUx7RouteErrors(remote); await closeUx7Routes(remote); await remote.close();
    const web = await browser.newPage({ viewport: size, isMobile: true, hasTouch: true }); pages.add(web); web.setDefaultTimeout(15000); web.on('pageerror', error => errors.push(error.message));
    await mockUx7Requests(web);
    await web.route('**/bridge', async route => {
      if (route.request().postDataJSON().method !== 'host.status') return route.fallback();
      const response = await route.fetch(), value = await response.json();
      await route.fulfill({ response, json: { ...value, result: { ...value.result, personalCapabilities: { ...value.result.personalCapabilities, nextSuggestions: 1 } } } });
    });
    await web.goto(fixture.mobileUrl); await web.waitForFunction(() => state.booted);
    await web.evaluate(async id => { await selectSharedSession(id); closeDrawer(); }, fixture.sessionId);
    await exercise(web, `mobile-ui-web-${size.width}`, true); await settings(web, true);
    for (const theme of ['light', 'dark']) await capture(web, `mobile-ui-web-${size.width}`, theme);
    assertUx7RouteErrors(web); await closeUx7Routes(web); await web.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(join(out, 'ui-checks.json'), JSON.stringify({ synthetic: true, realModelRequests: 0, mobileEvidence: 'mobile-web: remote host browser UI; mobile-ui-web: shared mobile www UI with a synthetic bridge in Chromium. Both are web content only, no native shell or system bars.', checks, shots, errors }, null, 2) + '\n');
} finally {
  for (const page of pages) await closeUx7Routes(page);
  await browser?.close(); await app?.close(); await fixture?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
  if (fixture) await rm(fixture.root, { recursive: true, force: true });
}
