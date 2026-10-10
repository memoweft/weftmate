// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
/** Production desktop shell, temporary profile and synthetic host. No daily data. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, chromium } from 'playwright';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
const root = resolve(import.meta.dirname, '../..'), evidence = join(root, 'tests/evidence/ui-p2');
const baseline = 'd2f188deb7b15087a9d7202c66222fe59588b96e';
mkdirSync(evidence, { recursive: true });
const mobileImageUrl = 'data:image/png;base64,' + readFileSync(join(root, 'build/tray-icon.png')).toString('base64');
const imageUrl = 'data:image/png;base64,' + readFileSync(join(root, 'build/icon.png')).toString('base64');
const env = { ...process.env, REVIEW_PROFILE: mkdtempSync(join(tmpdir(), 'weftmate-ui-p2-')), REVIEW_THEME: 'light' };
for (const key of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_)/.test(key) || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
const checks = [], errors = [];
let app, fixture, browser, phase = 'before';
const item = { id: 'synthetic-memory', kind: 'cognition', text: '合成记忆：喜欢简洁的说明。', currentState: 'current', sourceCount: 0 };
async function shot(page, theme, name, desktop = true) {
  await page.waitForTimeout(280);
  await page.screenshot({ path: join(evidence, `${phase}-${desktop ? 'desktop' : 'mobile'}-${theme}-${name}.png`) });
  if (desktop && name === '05-confirmation') {
    const png = await app.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
      const win = BrowserWindow.getAllWindows()[0]; win.show(); win.focus();
      const handle = win.getNativeWindowHandle(), id = handle.length === 8 ? handle.readBigUInt64LE().toString() : handle.readUInt32LE().toString();
      const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1200, height: 800 } });
      const source = sources.find(source => source.id.split(':')[1] === id);
      if (!source || source.thumbnail.isEmpty()) throw Error('Native window capture unavailable');
      return source.thumbnail.toPNG().toString('base64');
    });
    writeFileSync(join(evidence, `${phase}-desktop-${theme}-05-native-caption.png`), Buffer.from(png, 'base64'));
  }
}
async function category(page, name) { await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name, exact: true }).click(); }
async function choose(page, name, option) {
  const control = page.getByRole('combobox', { name, exact: true });
  if (phase === 'before') await control.selectOption({ label: option });
  else { await control.click(); await page.getByRole('option', { name: option, exact: true }).click(); }
}
try {
  fixture = await startTimelineCandidate({ historyCount: 0, interactive: true, usageSamples: true });
  env.REVIEW_ORIGIN = fixture.origin;
  const fixtureIdentity = await fixture.request('/auth/me'), ownerId = fixtureIdentity.account.ownerId;
  const mobileOwner = createHash('sha256').update(`${fixture.origin}|${ownerId}`).digest('hex');
  app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: root, env,
    args: ['scripts/review-gallery/electron.mjs', '--force-device-scale-factor=1'] });
  const page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message));
  await page.route('**/personal/v1/**', async route => {
    const url = new URL(route.request().url());
    if (phase === 'before' && url.pathname.includes('/ui/') && !url.pathname.includes('/ui/ui-core/')) {
      const path = 'src/personal-access-ui/' + url.pathname.split('/ui/')[1];
      if (/\.(css|js)$/.test(path)) {
        try { return route.fulfill({ body: execFileSync('git', ['show', `${baseline}:${path}`], { cwd: root }), contentType: path.endsWith('.css') ? 'text/css' : 'text/javascript' }); } catch {}
      }
    }
    if (url.pathname === '/personal/v1/system') return route.fulfill({ json: { model: { state: 'ready', version: 'synthetic' }, host: { state: 'ready', version: 'synthetic' }, memory: { state: 'ready', version: 'synthetic' }, canRestart: false } });
    if (url.pathname.includes('/memory/')) {
      const path = url.pathname.split('/memory/')[1];
      const value = path === 'status' ? { state: 'ready', capabilities: { list: true, deleteWorldItem: true } }
        : path.endsWith('/forget-preview') ? { worldRevision: 1, itemCount: 1, evidenceCount: 0, items: [item] }
        : path.endsWith('/sources') ? { worldRevision: 1, sources: [] }
        : path === 'items' ? { worldRevision: 1, items: [item], searchScope: 'account_snapshot', hasMore: false }
        : { worldRevision: 1, item, availableActions: { delete: { available: true } } };
      return route.fulfill({ json: { ownerId, ...value } });
    }
    await route.continue();
  });
  await localUiSession(page, fixture.credentials);
  for (phase of ['before', 'after']) for (const theme of ['light', 'dark']) {
    console.log(phase, theme); await page.reload();
    await page.getByRole('button', { name: '账户菜单' }).click(); await page.getByRole('button', { name: '设置', exact: true }).click();
    await category(page, '外观'); await page.getByRole('button', { name: theme === 'light' ? '浅色' : '深色', exact: true }).click();
    await choose(page, '主题色', '蓝色'); await shot(page, theme, '07-appearance');
    await category(page, '用量'); await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '设备', exact: true }).hover();
    await shot(page, theme, '03-navigation');
    if (phase === 'after') {
      const nav = page.getByRole('navigation', { name: '设置分类' });
      const a = await nav.getByRole('button', { name: '设备', exact: true }).boundingBox(), b = await nav.getByRole('button', { name: '用量', exact: true }).boundingBox();
      assert.ok(b.y - a.y - a.height >= 3.9);
    }
    await category(page, '模型');
    const models = page.getByRole('combobox', { name: '后台模型', exact: true });
    if (phase === 'after') {
      // Long-list presentation projection; production options/save handlers remain intact.
      await page.evaluate(() => { const select = document.getElementById('background-model-select'); for (let i = 0; i < 20; i++) select.add(new Option(`合成模型 ${i}`, `synthetic-${i}`)); });
      await models.click(); await page.getByRole('searchbox', { name: '搜索后台模型' }).fill('合成模型 12');
      assert.equal(await page.getByRole('option').count(), 1); await shot(page, theme, '04-dropdown');
      await page.keyboard.press('ArrowDown'); await page.keyboard.press('Escape'); assert.equal(await models.getAttribute('aria-expanded'), 'false');
      await models.press('ArrowDown'); await page.getByRole('searchbox', { name: '搜索后台模型' }).fill('跟随主模型'); await page.keyboard.press('Enter');
      await page.getByText('后台模型已保存', { exact: true }).waitFor();
    } else { await models.focus(); await shot(page, theme, '04-dropdown'); }
    await category(page, '记忆');
    if (phase === 'before') await page.getByRole('button', { name: '管理记忆', exact: true }).click();
    await page.getByRole('button', { name: /^合成记忆：喜欢简洁的说明。/ }).waitFor(); await shot(page, theme, '02-memory');
    if (phase === 'after') { assert.equal(await page.getByRole('dialog', { name: '设置', exact: true }).isVisible(), true); }
    await page.getByRole('button', { name: /^合成记忆：喜欢简洁的说明。/ }).click();
    await page.getByRole('dialog', { name: '理解详情', exact: true }).waitFor(); await shot(page, theme, '07-memory-detail');
    await page.getByRole('button', { name: '忘掉', exact: true }).click(); await shot(page, theme, '05-confirmation');
    if (phase === 'after') { const geometry = await page.getByRole('dialog', { name: '理解详情', exact: true }).evaluate(node => ({ top: node.getBoundingClientRect().top, caption: document.querySelector('.desktop-titlebar').getBoundingClientRect().bottom })); assert.ok(geometry.top >= geometry.caption + 15); }
    await page.getByRole('button', { name: '关闭记忆详情', exact: true }).click();
    if (phase === 'before') { await page.getByRole('button', { name: '← 返回对话', exact: true }).click(); await page.getByRole('button', { name: '账户菜单' }).click(); await page.getByRole('button', { name: '设置', exact: true }).click(); }
    {
      await category(page, '关于'); await page.getByRole('button', { name: '阅读隐私政策', exact: true }).click(); await shot(page, theme, '07-legal'); await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    }
    const more = page.getByRole('button', { name: /^更多操作/ }).first(); await more.hover(); await shot(page, theme, '01-session-row');
    if (phase === 'after') assert.equal(await more.evaluate(node => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)');
    await page.evaluate(url => WeftDesktop.showImage(url, '合成图片', document.getElementById('rail-open')), imageUrl);
    await page.getByRole('img', { name: '合成图片', exact: true }).waitFor(); await shot(page, theme, '07-image');
    await page.getByRole('button', { name: '收起右侧面板', exact: true }).click();
    if (phase === 'after') {
      await page.evaluate(() => document.getElementById('rail-memory').click());
      await page.getByRole('dialog', { name: '设置', exact: true }).waitFor(); await page.getByRole('heading', { name: '记忆', exact: true }).waitFor();
      await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    }
    checks.push({ phase, theme, surface: 'desktop' });
  }
  browser = await chromium.launch();
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  mobile.on('pageerror', e => errors.push(e.message));
  await mobile.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/bridge') {
      const input = route.request().postDataJSON();
      if (input.method === 'auth.me') return route.fulfill({ json: { result: { ...fixtureIdentity, owner: mobileOwner, connectionVerified: true } } });
      if (input.method === 'cloud.callback') return route.fulfill({ json: { result: {} } });
      if (input.method === 'host.business') {
        const path = new URL(input.params.path, fixture.origin).pathname;
        let result;
        if (path.includes('/memory/')) {
          const tail = path.split('/memory/')[1];
          result = { ownerId, worldRevision: 1, ...(tail === 'status' ? { state: 'ready', capabilities: { list: true, source: true, deleteWorldItem: true } }
            : tail === 'items' ? { items: [item], searchScope: 'account_snapshot', hasMore: false }
            : tail.endsWith('/sources') ? { sources: [] }
            : { item, availableActions: { delete: { available: true } } }) };
        } else result = await fixture.request(input.params.path.replace('/personal/v1', ''), input.params.body, input.params.method);
        return route.fulfill({ json: { result } });
      }
    }
    if (phase === 'before' && /\.(js|css)$/.test(url.pathname)) {
      const name = url.pathname.slice(1);
      try { return route.fulfill({ body: execFileSync('git', ['show', `${baseline}:apps/mobile-ui/www/${name}`], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] }), contentType: name.endsWith('.css') ? 'text/css' : 'text/javascript' }); } catch {}
    }
    await route.continue();
  });
  for (phase of ['before', 'after']) for (const theme of ['light', 'dark']) {
    await mobile.goto(fixture.mobileUrl); await mobile.waitForFunction(() => state.booted);
    await mobile.evaluate(theme => { applyTheme(theme); state.loggedIn = true; page('settings'); }, theme);
    await mobile.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: /^记忆 / }).click(); await mobile.getByText(item.text, { exact: true }).waitFor(); await shot(mobile, theme, '02-memory', false);
    await mobile.getByText(item.text, { exact: true }).click(); await mobile.waitForFunction(() => state.memory.view === 'detail'); await shot(mobile, theme, '07-memory-detail', false);
    await mobile.evaluate(() => page('models')); await shot(mobile, theme, '04-models', false);
    await mobile.evaluate(() => page('appearance')); await shot(mobile, theme, '07-appearance', false);
    assert.equal(await mobile.evaluate(() => document.documentElement.dataset.theme), theme);
    await mobile.evaluate(() => page('about')); await mobile.getByRole('button', { name: /^隐私政策 / }).click(); await shot(mobile, theme, '07-legal', false); await mobile.getByRole('dialog', { name: '隐私政策', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
    await mobile.evaluate(url => {
      state.chatSource = 'phone'; state.transitionPending = false; page('chat');
      openImagePreview(url, '合成图片', $('model-button'), { owner: state.owner, epoch: state.authEpoch, conversationId: attachmentConversationId(), source: 'phone' });
    }, mobileImageUrl);
    await mobile.getByRole('button', { name: '关闭图片预览', exact: true }).waitFor(); await shot(mobile, theme, '07-image', false);
    checks.push({ phase, theme, surface: 'mobile', viewport: '390x844' });
  }
  assert.deepEqual(errors, []);
  writeFileSync(join(evidence, 'verification.json'), JSON.stringify({ baseline, syntheticData: true, isolatedProfile: true, productionDesktopShell: true, checks }, null, 2) + '\n');
  console.log('UI-P2 desktop/mobile theme and interaction checks passed.');
} finally { await app?.close(); await browser?.close(); await fixture?.close(); }
