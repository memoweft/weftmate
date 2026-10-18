/** Production Electron shell and mobile page; isolated synthetic account only. */
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { startFixture } from './ux-4-fixture.mjs';
import { evidencePath } from '../helpers/evidence-path.mjs';

const inspect = process.argv.includes('--inspect');
const androidSerial = process.env.UI468_ANDROID_SERIAL;
const out = evidencePath('ui-468', process.env.UI468_PHASE || (inspect ? 'before' : 'after'));
await mkdir(out, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'weftmate-ui468-'));
const f = await startFixture({ auth1: true });
console.log('Synthetic host ready');
const report = { inspect, checks: [], screenshots: [], errors: [] };
let app, browser, androidBrowser, androidContext, reversedPort, forwardedPort, activePage;
const adb = (...args) => execFileSync(process.env.UI468_ADB, ['-s', androidSerial, ...args], { windowsHide: true });
// Observation is deliberately side-effect free for the original factory.
function observeCore() {
  let module;
  Object.defineProperty(globalThis, 'WeftUiCore', { configurable: true, get: () => module, set(value) {
    module = value;
    const create = value.create;
    value.create = function (...args) {
      const core = Reflect.apply(create, this, args);
      try { globalThis.ui468Core = core; } catch {}
      return core;
    };
  } });
}
async function capture(page, surface, name) {
  const file = `${surface}-${name}.png`;
  if (surface === 'electron') {
    const encoded = await app.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
      const win = BrowserWindow.getAllWindows()[0], handle = win.getNativeWindowHandle();
      const id = handle.length === 8 ? handle.readBigUInt64LE().toString() : handle.readUInt32LE().toString();
      const source = (await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1600, height: 1200 } })).find(row => row.id.split(':')[1] === id);
      if (!source || source.thumbnail.isEmpty()) throw Error('Owned window capture unavailable');
      return source.thumbnail.toPNG().toString('base64');
    });
    await writeFile(join(out, file), Buffer.from(encoded, 'base64'));
  } else if (surface === 'android-web') await writeFile(join(out, file), adb('exec-out', 'screencap', '-p'));
  else await page.screenshot({ path: join(out, file), fullPage: true });
  report.screenshots.push(file);
}
try {
  const main = (await f.request('/chats/main')).chat;
  let command = (await f.request('/commands', { requestId: 'ui468-main', kind: 'chat.message', targetDeviceId: f.hostId, chatId: main.chatId, modelProfileId: 'synthetic', text: '旧主对话合成历史仍然可见。', mode: 'queue' })).command;
  while (['pending', 'dispatching', 'preflight'].includes(command.state)) command = (await f.request('/commands/' + command.commandId)).command;
  assert.equal(command.state, 'accepted_by_dsh');
  const before = (await f.request(`/chats/${main.chatId}/events?limit=200`)).items;
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_)/.test(key) || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
  app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: resolve('.'), args: ['scripts/review-gallery/electron.mjs'], env: { ...env, WEFTMATE_TEST_HOST_NAME: 'synthetic-host', REVIEW_PROFILE: root, REVIEW_ORIGIN: f.origin, REVIEW_LIBRARY_TOKEN: f.libraryDesktopToken, REVIEW_THEME: 'light' } });
  const desktop = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.show(); win.focus(); });
  console.log('Electron ready');
  await desktop.addInitScript(observeCore);
  await desktop.reload();
  console.log('Electron authenticated');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.addInitScript(observeCore);
  const [cookieName, ...cookieValue] = f.mobileCookie.split('=');
  await mobile.context().addCookies([{ name: cookieName, value: cookieValue.join('='), url: f.origin, httpOnly: true, sameSite: 'Strict' }]);
  await mobile.goto(f.origin + '/personal/v1/ui');
  await mobile.waitForFunction(() => !!globalThis.ui468Core);
  await mobile.evaluate(async () => {
    const core = ui468Core, session = await core.api('/me');
    core.state.cloudAuth.mode = 'authenticated'; await core.acceptSession(session); await core.enterAssistant();
  });
  console.log('Mobile page ready');
  const surfaces = [['electron', desktop], ['mobile-web', mobile]];
  if (androidSerial) {
    reversedPort = new URL(f.origin).port;
    adb('reverse', `tcp:${reversedPort}`, `tcp:${reversedPort}`);
    adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'about:blank', 'com.android.chromium');
    forwardedPort = adb('forward', 'tcp:0', 'localabstract:chrome_devtools_remote').toString().trim();
    androidBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${forwardedPort}`, { noDefaults: true });
    androidContext = androidBrowser.contexts()[0];
    await androidContext.addInitScript(observeCore);
    await androidContext.addCookies([{ name: cookieName, value: cookieValue.join('='), url: f.origin, httpOnly: true, sameSite: 'Strict' }]);
    const phone = androidContext.pages()[0];
    assert.ok(phone, 'Owned Android browser tab must exist');
    await phone.bringToFront();
    await phone.goto(f.origin + '/personal/v1/ui');
    await phone.waitForFunction(() => !!globalThis.ui468Core);
    await phone.evaluate(async () => { const core = ui468Core, session = await core.api('/me'); core.state.cloudAuth.mode = 'authenticated'; await core.acceptSession(session); await core.enterAssistant(); });
    surfaces.push(['android-web', phone]);
  }
  for (const [surface, page] of surfaces) {
    activePage = page;
    console.log('Checking', surface);
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => report.errors.push({ surface, message: error.message }));
    await page.waitForFunction(() => globalThis.ui468Core?.state.mainChat);
    for (const theme of ['light', 'dark']) for (const kind of ['main', 'ordinary']) {
      await page.evaluate(async ({ theme, kind, source }) => {
        document.documentElement.dataset.theme = theme;
        if (kind === 'main') await ui468Core.selectMainChat();
        else await ui468Core.selectSession(source);
      }, { theme, kind, source: f.source });
      await page.getByText(kind === 'main' ? '旧主对话合成历史仍然可见。' : '请给出一条合成答复。', { exact: true }).waitFor();
      const row = page.getByRole('group', { name: /^助手消息：/ }).last();
      await row.focus();
      const more = row.getByRole('button', { name: '更多回复操作', exact: true });
      const moreCount = await more.count();
      if (moreCount) { await more.click(); await page.getByRole('menu').last().waitFor(); }
      else assert.equal(kind, 'main', 'Ordinary replies retain regeneration');
      const entries = await page.getByRole('menuitem').allTextContents();
      const cancelled = entries.filter(text => /旁聊|从这里开对话/.test(text));
      report.checks.push({ surface, theme, kind, historyVisible: true, cancelled, entries });
      await capture(page, surface, `${theme}-${kind}-menu`);
      await page.keyboard.press('Escape');
      const user = page.getByRole('group', { name: /^我的消息：/ }).last();
      report.checks.push({ surface, theme, kind, userMenuCount: await user.getByLabel('消息菜单', { exact: true }).count() });
    }
  }
  assert.deepEqual(await desktop.evaluate(async id => (await ui468Core.accessApi(`/chats/${id}/events?limit=200`)).items, main.chatId), before);
  report.historyUnchanged = true;
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (!inspect) {
    assert.equal(report.errors.length, 0);
    assert.equal(report.checks.filter(row => row.cancelled?.length || row.userMenuCount).length, 0, 'D92 cancelled message entry must be absent');
  }
} catch (error) {
  console.error(error);
  if (activePage) {
    console.error(await activePage.evaluate(() => ({ core: !!globalThis.ui468Core, capabilities: globalThis.ui468Core?.state.personalCapabilities, selected: ui468Core?.state.selectedSessionId, connection: ui468Core?.state.connection, text: document.body.innerText })).catch(() => null));
    if (androidSerial) await writeFile(join(out, 'failure.png'), adb('exec-out', 'screencap', '-p'));
    else await activePage.screenshot({ path: join(out, 'failure.png') }).catch(() => {});
  }
  throw error;
} finally {
  if (app) await app.evaluate(async () => { await globalThis.__reviewDesktop.close(); });
  await app?.close();
  await browser?.close();
  await androidBrowser?.close();
  if (reversedPort) adb('reverse', '--remove', `tcp:${reversedPort}`);
  if (forwardedPort) adb('forward', '--remove', `tcp:${forwardedPort}`);
  await f.close();
  await rm(root, { recursive: true, force: true });
}
