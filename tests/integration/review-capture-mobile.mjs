import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, join, sep } from 'node:path';
import { startFe1bFixture } from './fe-1b-fixture.mjs';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { mobileBridge } from '../../scripts/review-gallery/mobile-bridge.mjs';
import { repository, outDirectory, capture } from '../../scripts/review-gallery/common.mjs';
const assets = join(repository, 'apps/mobile-ui/www'), out = outDirectory();
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
const browser = await chromium.launch({ headless: true });
try {
  for (const theme of ['light', 'dark']) {
    const fixture = await startFe1bFixture();
    const candidate = await startTimelineCandidate({ historyCount: 0, interactive: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: theme });
    const page = await context.newPage(), errors = [];
    try {
      const bridge = mobileBridge(fixture, theme);
      page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(error.message));
      await page.exposeFunction('__reviewNative', async payload => {
        try { return { id: payload.id, ok: true, result: await bridge(payload) }; }
        catch (error) { return { id: payload.id, ok: false, error: { code: error.message } }; }
      });
      await page.addInitScript(() => { window.weftNative = { postMessage(value) { window.__reviewNative(JSON.parse(value)).then(result => window.weftNative.onmessage({ data: JSON.stringify(result) })); } }; });
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      const button = name => page.getByRole('button', { name, exact: typeof name === 'string' });
      const conversation = title => button(new RegExp(`^${title} [0-9]`));
      const shot = scene => capture(page, out, 'mobile-web', scene, theme);
      await button('登录或连接').click(); await page.getByRole('heading', { name: '电脑账户与连接', exact: true }).waitFor(); await shot('login');
      await page.getByLabel('个人服务地址', { exact: true }).fill(fixture.origin);
      await page.getByLabel('账户名（3–64个字符）', { exact: true }).fill(fixture.credentials.username);
      await page.getByLabel('密码（注册时15–128个字符）', { exact: true }).fill(fixture.credentials.password);
      await page.getByLabel('设备名称', { exact: true }).fill('合成审稿手机');
      await button('检查服务连接').click(); await button('注册新账户').waitFor();
      await button('登录').click(); await page.waitForFunction(() => state.loggedIn); await button('返回').click(); await conversation('整理项目进展').waitFor(); await shot('sessions');
      await conversation('整理项目进展').click(); await page.getByText(/执行了 1 步/).click();
      await page.getByText('读取项目记录 · notes.md', { exact: true }).waitFor(); await shot('conversation');
      await button('输出与来源').click(); await button(/^notes.md 1 次使用$/).waitFor(); await shot('outputs-sources');
      await button('返回对话').click(); await button('返回').click(); await conversation('整理临时文件').click();
      await button('允许一次').waitFor(); await shot('approval'); await button('返回').click();
      await button('打开导航').click(); await button('记忆').click(); await button(/使用中文说明/).waitFor(); await shot('memory');
      await button('返回').click(); await button('设置与账户').click(); await button(/^外观 /).click(); await button(new RegExp(`^${theme === 'dark' ? '深色' : '浅色'}`)).click(); await shot('appearance');
      // FE-1a's real question projection supplies the missing FE-1b question fixture.
      const questionPage = await context.newPage(); questionPage.setDefaultTimeout(30000);
      await questionPage.route('**/bridge', async route => {
        const body = route.request().postDataJSON();
        if (body.method === 'settings.appearance') return route.fulfill({ json: { result: { value: theme } } });
        await route.continue();
      });
      await questionPage.goto(candidate.mobileUrl);
      await questionPage.waitForFunction(() => state.booted && state.page === 'home');
      await questionPage.getByRole('button', { name: '项目进度报告 待审批', exact: true }).click();
      await questionPage.getByText('报告要采用哪种格式？', { exact: true }).evaluate(node => node.scrollIntoView({ block: 'center' }));
      await capture(questionPage, out, 'mobile-web', 'question', theme);
      assert.deepEqual(errors, []); console.log(`Mobile ${theme}: eight synthetic scenes captured.`);
    } catch (error) {
      console.error(error.message);
      for (const current of context.pages()) console.error((await current.locator('body').innerText()).slice(-1800));
      throw error;
    } finally { await context.close(); await fixture.close(); await candidate.close(); }
  }
} finally { await browser.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); }
