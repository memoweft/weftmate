import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { repository, outDirectory, capture } from '../../scripts/review-gallery/common.mjs';
const out = outDirectory();
for (const theme of ['light', 'dark']) {
  const fixture = await startTimelineCandidate({ historyCount: 0, interactive: true, riskApproval: true, baseTime: Date.parse('2026-10-08T08:00:00Z') });
  const profile = await mkdtemp(join(tmpdir(), 'weftmate-review-desktop-'));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('WEFTMATE_') || key.startsWith('MEMOWEFT_') || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
  Object.assign(env, { REVIEW_PROFILE: profile, REVIEW_THEME: theme, REVIEW_ORIGIN: fixture.origin });
  let application, page, closing = false, ownerId;
  const errors = [];
  try {
    application = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: repository,
      args: [join(repository, 'scripts/review-gallery/electron.mjs'), '--force-device-scale-factor=1', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'], env, timeout: 90000 });
    console.log('Desktop shell launched.');
    page = await application.firstWindow(); page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(theme => {
      localStorage.setItem('weftmate.desktop.appearance.v1', JSON.stringify({ theme, accent: 'neutral', fontSize: '15' }));
      const NativeDate = Date, fixed = Date.parse('2026-10-08T08:01:40Z');
      globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return fixed; } };
    }, theme);
    await page.route('**/personal/v1/memory/items/**/sources', route => route.fulfill({ json: { ownerId, sources: [{ recordedAt: '2026-10-08T08:00:00Z', contentAvailable: true, rawContent: '合成偏好：使用中文说明。' }] } }));
    await page.route('**/personal/v1/sessions/*/events?*', async route => {
      try {
        const response = await route.fetch(), data = await response.json();
        for (const event of data.events || []) if (event.type === 'assistant.message') event.data.memoryUsed = [{ id: 'synthetic-memory', kind: 'cognition', summary: '使用中文说明' }];
        await route.fulfill({ response, json: data });
      } catch { if (!closing) errors.push('Synthetic event projection failed'); }
    });
    await page.goto(fixture.origin + '/personal/v1/ui', { timeout: 30000 });
    console.log('Desktop fixture loaded.');
    const button = name => page.getByRole('button', { name, exact: typeof name === 'string' });
    const shot = scene => capture(page, out, 'windows', scene, theme, application);
    await page.getByRole('heading', { name: '登录 WeftMate' }).waitFor(); await shot('login');
    await page.getByRole('textbox', { name: '账户名', exact: true }).fill(fixture.credentials.username);
    await page.getByLabel('密码', { exact: true }).filter({ visible: true }).fill(fixture.credentials.password);
    await page.getByRole('textbox', { name: '这台设备的名称' }).fill('合成审稿桌面');
    await button('登录').click(); await button('允许一次').waitFor();
    await page.getByText('已登录。', { exact: true }).waitFor({ state: 'hidden' });
    ownerId = await page.evaluate(async () => (await (await fetch('/personal/v1/auth/me')).json()).account.ownerId);
    // Remove the hidden login form value before any authenticated screenshot.
    await page.locator('input[type=password]').evaluateAll(nodes => nodes.forEach(n => { n.value = ''; }));
    await button('搜索会话').click(); await page.getByRole('searchbox', { name: '搜索会话', exact: true }).waitFor(); await shot('sessions');
    await page.getByRole('searchbox', { name: '搜索会话', exact: true }).blur();
    await page.getByText('执行了 2 步 · 用时 2 秒', { exact: true }).click();
    await page.getByText('读取 3 个文件', { exact: true }).evaluate(node => node.scrollIntoView({ block: 'center' })); await shot('conversation');
    await button('允许一次').evaluate(node => node.scrollIntoView({ block: 'center' })); await shot('approval');
    await page.getByRole('radio', { name: '简要报告', exact: true }).evaluate(node => node.scrollIntoView({ block: 'center' })); await shot('question');
    await button('输出与来源').click(); await page.getByRole('button', { name: /README.md.*读取/ }).waitFor(); await shot('outputs-sources');
    await button('关闭列表').click();
    await button('查看这条回复采用的 1 条记忆来源').click();
    await page.getByText('合成偏好：使用中文说明。', { exact: true }).waitFor(); await shot('memory');
    await button('收起右侧面板').click(); await button(/TimelineFixture/).click(); await button('设置').click();
    await page.getByRole('combobox', { name: /^颜色模式/ }).waitFor(); await shot('appearance');
    assert.deepEqual(errors, []);
    console.log(`Desktop ${theme}: eight synthetic scenes captured.`);
  } catch (error) {
    console.error(error.message);
    if (page) console.error((await page.locator('body').innerText()).slice(-1600));
    throw error;
  } finally {
    closing = true;
    await page?.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
    await application?.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await application?.close().catch(() => {}); await fixture.close();
  }
}
