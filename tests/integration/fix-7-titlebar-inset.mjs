/** Real production Electron window, isolated profile and synthetic API data.
 * Layout/confirmation coverage only; no memory formation or deletion claim. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright';
import { localUiSession } from '../helpers/local-ui-session.mjs';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';

const repository = resolve(import.meta.dirname, '../..');
const evidence = join(repository, 'tests/evidence/fix-7');
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'weftmate-fix7-'));
writeFileSync(join(root, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_)/.test(key) || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
const baseline = '2a6aa9f7ad9fa02d77883940a32eb7083fae8641';
const oldAssets = new Map(['native-desktop.css', 'native-desktop.js', 'popovers.js', 'components/settings-navigation.js', 'components/shell.js'].map(name => [name.split('/').at(-1),
  execFileSync('git', ['show', `${baseline}:src/personal-access-ui/${name}`], { cwd: repository, encoding: 'utf8' })]));
const item = { id: 'fix7-memory', kind: 'cognition', text: '合成测试记忆：偏好简洁的中文说明。', currentState: 'current', sourceCount: 0 };
const scopeOnly = process.argv.includes('--scope-only');
const report = scopeOnly ? JSON.parse(readFileSync(join(evidence, 'verification.json'), 'utf8'))
  : { realElectron: true, isolatedData: true, syntheticData: true, baseline, checks: [] };
report.checks = report.checks.filter(check => !check.platform);
let application, candidate, ownerId, phase = 'before';
async function capture(page, name, dialog) {
  console.log('Capture:', name);
  await page.waitForTimeout(350);
  const geometry = await dialog.evaluate(node => {
    const rect = node.getBoundingClientRect(), caption = document.querySelector('.desktop-titlebar').getBoundingClientRect();
    const style = getComputedStyle(node);
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, captionBottom: caption.bottom,
      viewport: { width: innerWidth, height: innerHeight }, gap: parseFloat(style.getPropertyValue('--desktop-dialog-gap')) };
  });
  if (phase === 'after') {
    assert.ok(geometry.y >= geometry.captionBottom + geometry.gap - 1, JSON.stringify(geometry));
    assert.ok(geometry.y + geometry.height <= geometry.viewport.height - geometry.gap + 1, JSON.stringify(geometry));
    assert.ok(geometry.x >= geometry.gap - 1 && geometry.x + geometry.width <= geometry.viewport.width - geometry.gap + 1, JSON.stringify(geometry));
    assert.ok(Math.abs((geometry.y - geometry.captionBottom) - (geometry.viewport.height - geometry.y - geometry.height)) <= 1);
  }
  const png = await application.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
    const win = BrowserWindow.getAllWindows().find(win => win.getTitle() === 'WeftMate');
    win.show(); win.focus();
    const handle = win.getNativeWindowHandle();
    const id = handle.length === 8 ? handle.readBigUInt64LE().toString() : handle.readUInt32LE().toString();
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1600, height: 1200 } });
    const source = sources.find(source => source.id.split(':')[1] === id);
    if (!source || source.thumbnail.isEmpty()) throw Error('Native window capture unavailable');
    return source.thumbnail.toPNG().toString('base64');
  });
  writeFileSync(join(evidence, `${name}.png`), Buffer.from(png, 'base64'));
  report.checks.push({ name, ...geometry });
}
async function openRail(page) {
  if (!await page.getByRole('button', { name: '账户菜单' }).isVisible())
    await page.getByRole('button', { name: '切换会话侧栏', exact: true }).click();
}
try {
  candidate = await startTimelineCandidate({ historyCount: 0, interactive: true, baseTime: Date.now() - 80000 });
  ownerId = (await candidate.request('/auth/me')).account.ownerId;
  application = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: repository,
    args: ['.', '--personal-host', '--access-port=0', `--user-data-dir=${root}`, '--force-device-scale-factor=1'], env, timeout: 90000 });
  const page = await application.firstWindow({ timeout: 90000 }); page.setDefaultTimeout(20000);
  await page.waitForURL(url => url.pathname.startsWith('/personal/v1/ui'));
  await page.route('**/personal/v1/**', async route => {
    const url = new URL(route.request().url()), name = url.pathname.split('/').at(-1);
    if (phase === 'before' && oldAssets.has(name)) return route.fulfill({ contentType: name.endsWith('.css') ? 'text/css' : 'text/javascript', body: oldAssets.get(name) });
    if (url.pathname.includes('/memory/')) {
      const path = url.pathname.split('/memory/')[1];
      const body = path === 'status' ? { state: 'ready', capabilities: { list: true, deleteWorldItem: true } }
        : path.endsWith('/forget-preview') ? { worldRevision: 1, itemCount: 1, evidenceCount: 0, items: [item] }
        : path.endsWith('/sources') ? { worldRevision: 1, sources: [] }
        : path.startsWith('items?') || path === 'items' ? { worldRevision: 1, items: [item], searchScope: 'account_snapshot', hasMore: false }
        : { worldRevision: 1, item, availableActions: { delete: { available: true } } };
      return route.fulfill({ json: { ownerId, ...body } });
    }
    const response = await route.fetch({ url: candidate.origin + url.pathname + url.search, headers: { ...route.request().headers(), origin: candidate.origin } });
    return route.fulfill({ response });
  });
  await page.reload(); await localUiSession(page, candidate.credentials);
  for (const current of scopeOnly ? [] : ['before', 'after']) {
    phase = current;
    for (const [size, width, height] of [['wide', 1200, 800], ['narrow', 480, 520]]) {
      await application.evaluate(({ BrowserWindow }, { width, height }) => BrowserWindow.getAllWindows().find(win => win.getTitle() === 'WeftMate').setContentSize(width, height), { width, height });
      for (const theme of ['light', 'dark']) {
        await page.reload();
        await openRail(page);
        await page.getByRole('button', { name: '账户菜单' }).click();
        await page.getByRole('button', { name: '设置', exact: true }).click();
        if (size === 'wide') await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '外观', exact: true }).click();
        else if (phase === 'before') await page.getByRole('combobox', { name: '设置分类', exact: true }).selectOption('appearance');
        else { await page.getByRole('combobox', { name: '设置分类', exact: true }).click(); await page.getByRole('option', { name: '设置 · 外观', exact: true }).click(); }
        await page.getByRole('button', { name: theme === 'light' ? '浅色' : '深色', exact: true }).click();
        await capture(page, `${phase}-${theme}-${size}-settings`, page.locator('.settings-dialog'));
        await page.keyboard.press('Escape');
        await openRail(page);
        await page.getByRole('button', { name: '更多操作 项目进度报告', exact: true }).click();
        await page.getByRole('menuitem', { name: /^删除/ }).click();
        await capture(page, `${phase}-${theme}-${size}-delete`, page.getByRole('dialog', { name: '删除对话', exact: true }));
        await page.keyboard.press('Escape');
        await openRail(page);
        await page.getByRole('button', { name: '账户菜单' }).click();
        await page.getByRole('button', { name: '记忆', exact: true }).click();
        await page.getByRole('button', { name: /合成测试记忆/ }).click();
        await page.getByRole('button', { name: '忘掉', exact: true }).click();
        await page.getByRole('button', { name: '确认忘掉', exact: true }).waitFor();
        await capture(page, `${phase}-${theme}-${size}-forget`, page.locator('#memory-detail-dialog'));
        await page.keyboard.press('Escape');
      }
    }
  }
  // Windows-only scoping leaves web/macOS modal geometry exactly at the baseline.
  for (const platform of ['darwin', 'web']) {
    const bounds = [];
    for (const current of ['before', 'after']) {
      phase = current; await page.reload();
      await openRail(page);
      await page.getByRole('button', { name: '账户菜单' }).click();
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.evaluate(platform => {
        document.documentElement.dataset.nativePlatform = platform;
        if (platform === 'web') document.documentElement.classList.remove('weftmate-desktop');
      }, platform);
      await page.waitForTimeout(350);
      bounds.push(await page.locator('.settings-dialog').boundingBox());
    }
    assert.ok(bounds[0] && bounds[1]);
    assert.deepEqual(bounds[0], bounds[1]); report.checks.push({ platform, unchangedBounds: bounds[1] });
  }
  writeFileSync(join(evidence, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('FIX-7 real desktop checks passed (24 native screenshots, wide/narrow, light/dark; web/macOS scope).');
} catch (error) {
  if (application) console.error((await (await application.firstWindow()).locator('body').innerText()).slice(-3000));
  throw error;
} finally {
  if (application) { await application.evaluate(({ app }) => app.quit()).catch(() => {}); await application.close().catch(() => {}); }
  await candidate?.close();
}
