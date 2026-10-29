// Open the production UI-01 launcher; never replace its registry or container.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { _electron } from 'playwright';

const profile = await mkdtemp(join(tmpdir(), 'weftmate-ui06-shell-'));
const output = process.env.WEFTMATE_BROWSER_TEST_OUTPUT;
let application, child, retryCount = 0;
const server = createServer((request, response) => {
  response.setHeader('content-type', 'text/html; charset=utf-8');
  if (request.url === '/retry' && retryCount++ === 0) { response.writeHead(503); response.end('稍后重试'); return; }
  const second = request.url === '/b';
  response.end(`<!doctype html><title>${second ? '合成网页 B' : '合成网页 A'}</title><main><h1>${second ? '第二页' : '第一页'}</h1><a href="/b">继续第二页</a><input id="draft" aria-label="页内草稿"><div style="height:1400px">合成网页内容</div></main>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://page-a.weftmate.invalid:${server.address().port}`;
const kill = () => {
  if (child?.exitCode === null) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000, stdio: 'ignore' });
};
const deadline = setTimeout(() => { kill(); process.exitCode = 1; }, 150_000);
const waitHost = async predicate => {
  for (let attempt = 0; attempt < 160; attempt++) {
    if (await application.evaluate(predicate)) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('browser host state did not settle');
};
try {
  const env = { ...process.env, BROWSER_TEST_PROFILE: profile, BROWSER_TEST_PORT: String(server.address().port), WEFTMATE_TEST_HOST_NAME: 'synthetic-host' };
  delete env.ELECTRON_RUN_AS_NODE;
  application = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: resolve('.'),
    args: ['tests/fixtures/desktop-browser-electron.mjs', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion'], env, timeout: 30_000 });
  child = application.process(); child.stdout?.resume(); child.stderr?.resume();
  const page = await application.firstWindow(); page.setDefaultTimeout(15_000);
  await page.waitForURL('**/personal/v1/ui');
  await page.addInitScript(() => {
    let value;
    Object.defineProperty(globalThis, 'WeftUiCore', { configurable: true, get: () => value, set(next) {
      value = next; const create = next.create;
      next.create = function (...args) { const core = create.apply(this, args); globalThis.browserPanelCore = core; return core; };
    } });
  });
  await page.reload();
  await page.waitForFunction(() => globalThis.browserPanelCore?.state.device?.authKind === 'desktop');
  const ids = await application.evaluate(() => ({ a: browserTest.a, b: browserTest.b }));
  await page.evaluate(async id => { await browserPanelCore.refreshSessions(); await browserPanelCore.selectSession(id); }, ids.a);
  const panel = page.getByRole('complementary', { name: '工作面板', exact: true });
  await page.getByRole('button', { name: '打开工作面板', exact: true }).click();
  await panel.locator('[data-panel-kind=browser]').click();
  await panel.getByRole('textbox', { name: '网址', exact: true }).waitFor();
  assert.equal(await panel.getByText('这项正在做', { exact: true }).count(), 0);
  await page.waitForFunction(() => !document.querySelector('.browser-address').disabled);
  assert.equal(await page.evaluate(() => WeftPanels.context.workDir), null);
  assert.ok(await page.evaluate(() => WeftPanels.context.sessionId));
  const navigate = async path => {
    await panel.getByRole('textbox', { name: '网址', exact: true }).fill(base + path);
    await panel.getByRole('button', { name: '打开', exact: true }).click();
  };
  await navigate('/a'); await panel.getByText('合成网页 A', { exact: true }).waitFor();
  const original = await application.evaluate(() => [...browserTest.browser.tabs.values()].map(tab => ({ id: tab.id, wcId: tab.view.webContents.id })));
  const capture = await application.evaluate(async (_electron, url) => browserTest.agent(browserTest.a, url), base + '/a');
  assert.match(capture.text, /第一页/);
  assert.equal(await application.evaluate(() => browserTest.browser.tabs.size), 1);
  const guest = code => application.evaluate(async (_electron, code) => [...browserTest.browser.tabs.values()][0].view.webContents.executeJavaScript(code), code);
  await guest("document.querySelector('a').click()"); await panel.getByText('合成网页 B', { exact: true }).waitFor();
  await panel.getByRole('button', { name: '后退', exact: true }).click(); await panel.getByText('合成网页 A', { exact: true }).waitFor();
  await panel.getByRole('button', { name: '前进', exact: true }).click(); await panel.getByText('合成网页 B', { exact: true }).waitFor();
  await panel.getByRole('button', { name: '刷新', exact: true }).click(); await panel.getByText('已打开', { exact: true }).waitFor();
  await guest("document.querySelector('#draft').value='保留网页草稿';scrollTo(0,300)");
  await panel.getByRole('button', { name: '再打开一项', exact: true }).click();
  await page.getByRole('menu', { name: '打开面板', exact: true }).getByRole('menuitem', { name: '文件', exact: true }).click();
  await waitHost(() => [...browserTest.browser.tabs.values()].every(tab => !tab.view.getVisible()));
  await panel.getByRole('tab', { name: '浏览器', exact: true }).click();
  await waitHost(() => [...browserTest.browser.tabs.values()].some(tab => tab.view.getVisible()));
  assert.equal(await guest("document.querySelector('#draft').value+':'+scrollY"), '保留网页草稿:300');
  await page.getByRole('button', {name:'收起右侧面板', exact: true }).click(); await panel.waitFor({ state: 'hidden' });
  await waitHost(() => [...browserTest.browser.tabs.values()].every(tab => !tab.view.getVisible()));
  await page.getByRole('button', { name: '打开工作面板', exact: true }).click();
  await waitHost(() => [...browserTest.browser.tabs.values()].some(tab => tab.view.getVisible()));
  assert.equal(await guest("document.querySelector('#draft').value+':'+scrollY"), '保留网页草稿:300');
  await page.evaluate(() => WeftPanels.update({ ...WeftPanels.context, workDir: 'synthetic-workspace' }));
  assert.deepEqual(await application.evaluate(() => [...browserTest.browser.tabs.values()].map(tab => ({ id: tab.id, wcId: tab.view.webContents.id }))), original);
  const before = await panel.boundingBox();
  await panel.getByRole('separator', { name: '调整预览宽度' }).press('ArrowLeft');
  await page.waitForFunction(width => document.querySelector('.timeline-preview').getBoundingClientRect().width > width, before.width);
  await navigate('/retry'); await panel.getByText('加载失败', { exact: true }).waitFor();
  await panel.getByRole('button', { name: '重试', exact: true }).click(); await panel.getByText('已打开', { exact: true }).waitFor();
  assert.ok(retryCount >= 2);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => WeftDesktop.setAppearance({ theme }), theme);
    await page.evaluate(async () => { await document.fonts.ready; for (const animation of document.getAnimations()) if (Number.isFinite(animation.effect.getTiming().iterations)) animation.finish(); });
    await application.evaluate(async () => browserTest.desktop.window.capturePage(undefined, { stayHidden: true, stayAwake: true }));
    if (output) {
      await mkdir(output, { recursive: true });
      const png = await application.evaluate(async () => (await browserTest.desktop.window.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64'));
      await writeFile(join(output, `shell-entry-${theme}.png`), Buffer.from(png, 'base64'));
      const web = await application.evaluate(async () => (await [...browserTest.browser.tabs.values()][0].view.webContents.capturePage()).toPNG().toString('base64'));
      await writeFile(join(output, `shell-entry-${theme}-webpage.png`), Buffer.from(web, 'base64'));
    }
  }
  if (!await page.locator('#session-rail').isVisible()) await page.getByRole('button', { name: '切换会话侧栏', exact: true }).click();
  await page.locator(`.session-row[data-session-id="${ids.b}"]`).locator('button').first().click();
  await page.waitForFunction(() => !document.querySelector('.browser-address').disabled && !document.querySelector('.browser-address').value);
  await navigate('/b'); await panel.getByText('合成网页 B', { exact: true }).waitFor();
  assert.equal(await application.evaluate(() => browserTest.browser.tabs.size), 2);
  await page.locator(`.session-row[data-session-id="${ids.a}"]`).locator('button').first().click();
  await page.waitForFunction(url => document.querySelector('.browser-address').value === url, base + '/retry');
  const ownedIds = await application.evaluate(() => [...browserTest.browser.tabs.values()].map(tab => tab.view.webContents.id));
  await panel.getByRole('button', { name: '关闭标签 浏览器', exact: true }).click();
  await waitHost(() => browserTest.browser.tabs.size === 0);
  assert.equal(await application.evaluate(({ webContents }, ids) => ids.some(id => !!webContents.fromId(id)), ownedIds), false);
  // Reopen from the real add menu, then exercise the container's identity reset.
  await panel.getByRole('button', { name: '再打开一项', exact: true }).click();
  await page.getByRole('menu', { name: '打开面板', exact: true }).getByRole('menuitem', { name: '浏览器', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.browser-address').disabled);
  await page.evaluate(() => WeftPanels.update({ ...WeftPanels.context, ownerId: 'another-synthetic-owner', identityGeneration: WeftPanels.context.identityGeneration + 1 }));
  await waitHost(() => browserTest.browser.tabs.size === 0);
  assert.equal(await panel.getByRole('tab', { name: '浏览器', exact: true }).count(), 0);
  console.log('PASS UI-01 browser launcher; navigation/history/reload/retry; Agent shares instance; tab switch/hide preserve draft and scroll; delayed workDir reuses tab; resize; light/dark; A/B isolation; close and identity dispose');
} finally {
  clearTimeout(deadline);
  if (application) { await application.evaluate(async () => browserTest?.close()).catch(() => {}); await application.close().catch(() => {}); }
  kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 });
}
