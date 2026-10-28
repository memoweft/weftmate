// Real, hidden Electron + production desktop bridge + owned local web service.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { _electron } from 'playwright';

const profile = await mkdtemp(join(tmpdir(), 'weftmate-ui06-browser-'));
let app, child, secretHits = 0, retryHits = 0;
const server = createServer((req, res) => {
  if (req.url === '/secret') { secretHits++; res.end('must never be reached'); return; }
  if (req.url === '/retry' && retryHits++ === 0) { req.socket.destroy(); return; }
  if (req.url === '/redirect-private') { res.writeHead(302, { location: `http://127.0.0.1:${server.address().port}/secret` }); res.end(); return; }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  const second = req.url.startsWith('/second');
  res.end(`<!doctype html><html><title>${second ? '合成第二页' : '合成第一页'}</title><main><h1>${second ? '第二页' : '第一页'}</h1>
    <a id="next" href="/second">继续第二页</a><input id="draft" aria-label="页内草稿"><button id="change" onclick="document.title='标题已更新'">更新标题</button>
    <div style="height:1200px">${second ? '第二页橙色时钟' : '第一页蓝色风筝'}</div><a href="#section">页内链接</a><h2 id="section">末尾章节</h2></main>
    ${req.url === '/private' ? `<img src="http://127.0.0.1:${server.address().port}/secret">` : ''}</html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://page-a.weftmate.invalid:${server.address().port}`;
const kill = () => {
  if (child && child.exitCode === null) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000, stdio: 'ignore' });
};
const timeout = setTimeout(() => { kill(); process.exitCode = 1; }, 150_000);
try {
  const env = { ...process.env, BROWSER_TEST_PROFILE: profile, BROWSER_TEST_PORT: String(server.address().port), WEFTMATE_TEST_HOST_NAME: 'synthetic-host' };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: resolve('.'),
    args: ['tests/fixtures/desktop-browser-electron.mjs', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion'], env, timeout: 30_000 });
  child = app.process(); child.stdout?.resume(); child.stderr?.resume();
  const page = await app.firstWindow(); page.setDefaultTimeout(15_000);
  await page.waitForURL('**/personal/v1/ui');
  await page.waitForFunction(() => globalThis.__WeftUiStarted === true);
  await page.waitForFunction(() => !!globalThis.weftmateDesktop);
  const ids = await app.evaluate(() => ({ a: browserTest.a, b: browserTest.b, ownerId: browserTest.ownerId }));
  await page.evaluate(() => {
    document.body.className = '';
    document.body.innerHTML = '<div id="test-browser" style="position:absolute;left:640px;top:44px;width:540px;height:720px"></div>';
    globalThis.WeftPanels = { register(kind, definition) { globalThis.browserDefinition = definition; } };
  });
  await page.addScriptTag({ url: '/personal/v1/ui/panels/browser.js' });
  const make = id => page.evaluate(({ id, ownerId }) => {
    globalThis.panel = browserDefinition.create({ conversationId: id, ownerId, mode: 'work', computerId: 'synthetic-host' });
    document.getElementById('test-browser').replaceChildren(panel.el); panel.show();
  }, { id, ownerId: ids.ownerId });
  await make(ids.a);
  // Agent starts while UI registration is still in flight, through the actual
  // account tool path, rather than a separate test-only navigation callback.
  const captured = await app.evaluate(async (_electron, url) => browserTest.agent(browserTest.a, url), base + '/first');
  assert.match(captured.text, /第一页蓝色风筝/);
  await page.waitForFunction(() => document.querySelector('.browser-address').value.endsWith('/first')).catch(async error => {
    console.error('Bridge diagnostic', await page.evaluate(async id => {
      try { return await weftmateDesktop.browser('list', { conversationId: id }); } catch (error) { return error.message; }
    }, ids.a)); throw error;
  });
  assert.equal(await app.evaluate(() => browserTest.browser.tabs.size), 1, 'immediate tool and panel use one registered instance');
  const tab = await app.evaluate(() => [...browserTest.browser.tabs.values()][0].id);
  const nextLink = captured.links.find(link => link.label === '继续第二页');
  assert.ok(nextLink.linkId);
  const followed = await app.evaluate(async (_electron, input) => browserTest.follow(input.snapshotId, input.linkId), { snapshotId: captured.snapshotId, linkId: nextLink.linkId });
  assert.match(followed.text, /第二页橙色时钟/);
  await page.getByRole('button', { name: '后退', exact: true }).click();
  await page.getByText('合成第一页', { exact: true }).waitFor();
  await app.evaluate(() => {
    browserTest.trace = [];
    const request = browserTest.browser.request.bind(browserTest.browser);
    browserTest.browser.request = (...args) => { if (args[1] !== 'layout') browserTest.trace.push(['request', args[1]]); return request(...args); };
    const wc = [...browserTest.browser.tabs.values()][0].view.webContents;
    for (const name of ['did-navigate', 'did-stop-loading']) wc.on(name, () => browserTest.trace.push([name, wc.getURL(), wc.navigationHistory.getActiveIndex(), wc.navigationHistory.getAllEntries().map(x=>x.url)]));
  });
  // Execute page interaction in the guest's own live renderer.
  const runGuest = code => app.evaluate(async (_electron, code) => [...browserTest.browser.tabs.values()][0].view.webContents.executeJavaScript(code), code);
  assert.equal(await runGuest("typeof window.weftmateDesktop+','+typeof require"), 'undefined,undefined');
  await runGuest("document.getElementById('next').click()");
  await page.getByText('合成第二页', { exact: true }).waitFor();
  await page.getByRole('button', { name: '后退', exact: true }).click();
  await page.getByText('合成第一页', { exact: true }).waitFor();
  await page.getByRole('button', { name: '前进', exact: true }).click();
  await page.getByText('合成第二页', { exact: true }).waitFor();
  await runGuest("document.getElementById('change').click()");
  await page.getByText('标题已更新', { exact: true }).waitFor();
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByText('合成第二页', { exact: true }).waitFor();
  await runGuest("document.getElementById('draft').value='保持原处';scrollTo(0,400)");
  await page.evaluate(() => panel.hide());
  await app.evaluate(() => { const tab = [...browserTest.browser.tabs.values()][0]; if (tab.view.getVisible()) throw new Error('hidden view remains visible'); });
  await page.evaluate(() => panel.show());
  assert.match(await runGuest("document.getElementById('draft').value+':'+scrollY"), /^保持原处:400$/);
  await page.evaluate(() => { globalThis.panelA = panel; panel.update({ conversationId: 'invalid-conversation', mode: 'work' }); });
  await page.getByText('请先打开一个电脑上的对话。', { exact: true }).waitFor();
  await page.evaluate(({ b, ownerId }) => panel.update({ conversationId: b, ownerId, mode: 'work', computerId: 'synthetic-host' }), ids);
  await page.waitForFunction(() => !document.querySelector('.browser-address').disabled);
  await app.evaluate(async (_electron, url) => browserTest.agent(browserTest.b, url), base + '/second');
  assert.equal(await app.evaluate(() => browserTest.browser.tabs.size), 2);
  await app.evaluate(async (_electron, tabId) => {
    await assertReject(browserTest.browser.request(browserTest.ownerId, 'state', { conversationId: browserTest.b, tabId }));
    async function assertReject(work) { try { await work; } catch (error) { if (error.code === 'BROWSER_TAB_UNAVAILABLE') return; throw error; } throw new Error('cross-conversation tab accepted'); }
  }, tab);
  await page.evaluate(({ a, ownerId }) => panel.update({ conversationId: a, ownerId, mode: 'work', computerId: 'synthetic-host' }), ids);
  await page.waitForFunction(() => document.querySelector('.browser-address').value.endsWith('/second'));
  assert.equal(await runGuest("document.getElementById('draft').value"), '保持原处');
  await page.getByRole('textbox', { name: '网址', exact: true }).fill(base + '/retry');
  await page.getByRole('button', { name: '打开', exact: true }).click();
  await page.getByText('加载失败', { exact: true }).waitFor();
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.getByText('已打开', { exact: true }).waitFor();
  assert.ok(retryHits >= 2);
  const addressBefore = await page.getByRole('textbox', { name: '网址', exact: true }).inputValue();
  await page.evaluate(() => { document.getElementById('test-browser').style.width = '400px'; });
  await page.waitForFunction(() => document.querySelector('.browser-viewport').getBoundingClientRect().width === 400);
  await app.evaluate(async () => browserTest.desktop.window.capturePage(undefined, { stayHidden: true, stayAwake: true }));
  for (let tries = 0; tries < 100; tries++) {
    if (await app.evaluate(() => [...browserTest.browser.tabs.values()][0].view.getBounds().width === 400)) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(await app.evaluate(() => [...browserTest.browser.tabs.values()][0].view.getBounds().width), 400);
  const output = process.env.WEFTMATE_BROWSER_TEST_OUTPUT;
  if (output) {
    await mkdir(output, { recursive: true });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      const png = await app.evaluate(async () => (await browserTest.desktop.window.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64'));
      await writeFile(join(output, `browser-${theme}.png`), Buffer.from(png, 'base64'));
    }
    // BrowserWindow.capturePage only captures the shell renderer. Capture the
    // native child separately and assert its actual visibility and placement.
    const guestPng = await app.evaluate(async () => {
      const tab = [...browserTest.browser.tabs.values()][0];
      if (!tab.view.getVisible()) throw new Error('native browser view not visible');
      return (await tab.view.webContents.capturePage()).toPNG().toString('base64');
    });
    await writeFile(join(output, 'browser-webpage.png'), Buffer.from(guestPng, 'base64'));
  }
  assert.equal(await page.getByRole('textbox', { name: '网址', exact: true }).inputValue(), addressBefore);
  await assert.rejects(app.evaluate(async (_electron, url) => browserTest.agent(browserTest.a, url), base + '/private'));
  await assert.rejects(app.evaluate(async (_electron, url) => browserTest.agent(browserTest.a, url), base + '/redirect-private'));
  assert.equal(secretHits, 0, 'private subresources and redirects never reach their destination');
  // A real conversation deletion releases its view even while the panel lives.
  await app.evaluate(async () => browserTest.request('/sessions/' + browserTest.b, {}, 'DELETE'));
  assert.equal(await app.evaluate(() => browserTest.browser.tabs.size), 1);
  const wcId = await app.evaluate(() => [...browserTest.browser.tabs.values()][0].view.webContents.id);
  await page.evaluate(() => panel.dispose());
  assert.equal(await app.evaluate(() => browserTest.browser.tabs.size), 0);
  assert.equal(await app.evaluate(({ webContents }, id) => !!webContents.fromId(id), wcId), false);
  // Remote browser/phone uses the same content module and an honest fallback.
  const remoteWindow = app.waitForEvent('window');
  await app.evaluate(async ({ BrowserWindow }) => {
    const win = new BrowserWindow({ show: false, width: 390, height: 760, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
    globalThis.remoteBrowserTestWindow = win;
    await win.loadURL(browserTest.origin + '/personal/v1/ui');
  });
  const remote = await remoteWindow;
  await remote.waitForFunction(() => !!globalThis.WeftIcons);
  await remote.evaluate(() => { globalThis.WeftPanels = { register(_kind, definition) { globalThis.browserDefinition = definition; } }; });
  await remote.addScriptTag({ url: '/personal/v1/ui/panels/browser.js' });
  await remote.evaluate(() => {
    document.body.className = ''; document.body.innerHTML = '';
    const panel = browserDefinition.create({ conversationId: 'remote', mode: 'chat' });
    document.body.append(panel.el); panel.show(); globalThis.remotePanel = panel;
  });
  await remote.getByText('请在电脑上的 WeftMate 中打开网页；手机暂不嵌入浏览器。', { exact: true }).waitFor();
  assert.equal(await remote.getByRole('button', { name: '打开', exact: true }).isDisabled(), true);
  await remote.evaluate(() => remotePanel.dispose());
  // Delayed creation for the old conversation cannot replace the new one.
  const stale = await remote.evaluate(async () => {
    let releaseOld;
    const closed = [];
    globalThis.weftmateDesktop = { browser: async (action, input) => {
      if (action === 'create') {
        if (input.conversationId === 'old') return new Promise(resolve => { releaseOld = resolve; });
        return { tabId: 'new-tab', registered: true, url: 'https://example.org/new', title: '新的对话网页' };
      }
      if (action === 'close') closed.push(input.tabId);
      return {};
    } };
    const panel = browserDefinition.create({ conversationId: 'old' });
    document.body.replaceChildren(panel.el); panel.show(); panel.update({ conversationId: 'new' });
    await Promise.resolve(); await Promise.resolve();
    releaseOld({ tabId: 'old-tab', registered: true, url: 'https://example.org/old', title: '旧的对话网页' });
    await Promise.resolve(); await Promise.resolve();
    const title = panel.el.querySelector('.browser-page-title').textContent;
    await panel.dispose();
    return { title, closed: closed.sort() };
  });
  assert.equal(stale.title, '新的对话网页');
  assert.deepEqual(stale.closed, ['new-tab', 'old-tab']);
  const lateClose = await remote.evaluate(async () => {
    let finish;
    const closed = [];
    globalThis.weftmateDesktop = { browser: async (action, input) => {
      if (action === 'create') return new Promise(resolve => { finish = resolve; });
      if (action === 'close') closed.push(input.tabId);
      return {};
    } };
    const panel = browserDefinition.create({ conversationId: 'late' });
    const disposed = panel.dispose();
    finish({ tabId: 'late-tab', registered: true, url: '', title: '' });
    await disposed;
    return closed;
  });
  assert.deepEqual(lateClose, ['late-tab'], 'closing during registration releases the eventual instance once');
  await app.evaluate(() => remoteBrowserTestWindow.destroy());
  console.log('PASS registered race; Agent/account tool shares live view; links/history/reload/title; two conversations; preserve/hide/resize; failure/retry; network restrictions; deletion/disposal; phone fallback');
} catch (error) {
  if (app) {
    console.error('Browser fixture state', await app.evaluate(() => [...browserTest.browser.tabs.values()].map(tab => browserTest.browser.state(tab))).catch(() => []));
    console.error('Trace', await app.evaluate(() => JSON.stringify(browserTest.trace)).catch(() => []));
    const pages = app.windows();
    if (pages[0]) console.error('Panel state', await pages[0].evaluate(() => ({ address: document.querySelector('.browser-address')?.value,
      status: document.querySelector('.browser-status')?.textContent, message: document.querySelector('.browser-explanation')?.textContent })).catch(() => null));
  }
  throw error;
} finally {
  clearTimeout(timeout);
  if (app) {
    await app.evaluate(async () => browserTest?.close()).catch(() => {});
    await app.close().catch(() => {});
  }
  kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 });
}
