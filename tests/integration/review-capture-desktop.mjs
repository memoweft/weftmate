import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { repository, outDirectory, runScene, catalog } from '../../scripts/review-gallery/common.mjs';
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
    const shot = (scene, prepare) => runScene({ page, out, platform: 'windows', scene, theme, prepare, application });
    await shot('login', async () => {
      await page.getByRole('heading', { name: '登录 WeftMate', exact: true }).waitFor();
      await page.getByLabel('邮箱', { exact: true }).filter({ visible: true }).waitFor();
      await button('离线使用这台电脑').waitFor();
    });
    // Real isolated host authentication is independent of login-page selectors.
    // This gallery captures LG-1a's first screen, not the cloud registration flow.
    ownerId = await page.evaluate(async credentials => {
      const response = await fetch('/personal/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials) });
      if (!response.ok) throw Error('Isolated desktop authentication failed');
      return (await response.json()).account.ownerId;
    }, fixture.credentials);
    const home = async () => {
      await page.goto(fixture.origin + '/personal/v1/ui');
      await button('批准').waitFor();
    };
    const settings = async () => { await home(); await button('账户菜单').click(); await button('设置').click(); };
    const preparations = {
      sessions: async () => { await home(); await button('搜索会话').click(); await page.getByRole('searchbox', { name: '搜索会话', exact: true }).waitFor(); },
      conversation: async () => { await home(); await page.getByRole('button', {name:'读取了 3 个文件、已运行 1 个命令，已收起',exact:true}).click(); await page.getByText(/^读取 3 个文件/).evaluate(node => node.scrollIntoView({ block: 'center' })); },
      approval: async () => { await home(); await button('批准').evaluate(node => node.scrollIntoView({ block: 'center' })); },
      question: async () => { await home(); await page.getByRole('radio', { name: '简要报告', exact: true }).evaluate(node => node.scrollIntoView({ block: 'center' })); },
      'outputs-sources': async () => { await home(); await button('输出与来源').click(); await page.getByRole('button', { name: /README.md.*读取/ }).waitFor(); },
      memory: async () => { await home(); await button('查看这条回复采用的 1 条记忆来源').click(); await page.getByText('合成偏好：使用中文说明。', { exact: true }).waitFor(); },
      appearance: async () => { await settings(); await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '外观', exact: true }).click(); await page.getByRole('group', { name: '颜色模式' }).waitFor(); },
      usage: async () => { await settings(); await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '用量', exact: true }).click(); await page.getByRole('heading', { name: '用量与费用', exact: true }).waitFor(); await button('刷新用量').waitFor(); },
      'session-menu': async () => { await home(); await button('更多操作 项目进度报告').click(); await page.getByRole('menu', { name: '对话操作', exact: true }).waitFor(); await page.getByRole('menuitem', { name: '归档 A', exact: true }).waitFor(); await page.getByRole('menuitem', { name: '删除 D', exact: true }).waitFor(); },
    };
    for (const scene of catalog.scenes.filter(row => row.id !== 'login')) await shot(scene.id, preparations[scene.id]);
    if (errors.length) throw Error('Desktop renderer or synthetic projection failed');
    console.log(`Desktop ${theme}: scene outcomes recorded.`);
  } finally {
    closing = true;
    await page?.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
    await application?.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await application?.close().catch(() => {}); await fixture.close(); await rm(profile, { recursive: true, force: true }); await rm(fixture.root, { recursive: true, force: true });
  }
}
