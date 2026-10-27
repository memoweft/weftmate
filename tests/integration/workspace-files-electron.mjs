// Real HTTP host + production Electron, synthetic repository, no model or daily profile.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-ui04';
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, open, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { createPersonalAccessService } from '../helpers/personal-access-fixture.mjs';
import { waitForCommand } from '../helpers/wait-for-command.mjs';
import { bindConversationWork } from '../../src/personal-access/work-and-chat.mjs';
import { servePersonalAccessUi } from '../../src/personal-access-ui/index.mjs';
import { measureUiAction } from '../helpers/ui-frame-probe.mjs';

const out = process.env.WEFTMATE_EVIDENCE_DIR, locks = process.env.WEFTMATE_HEAVY_LOCK_DIR;
const browserOnly = process.argv.includes('--browser-only');
const skipPerformance = process.argv.includes('--skip-performance');
if (!out || !locks) throw Error('Set external evidence and heavy-lock directories.');
await mkdir(out, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'weftmate-ui04-electron-')), folder = join(root, 'work');
const report = { productionElectron: !browserOnly, hidden: true, passed: false, screenshots: [], errors: [], containerIntegrated: true, performance: [],
  captureChecks: [],
  captureMethod: browserOnly ? 'Playwright page.screenshot' : 'Playwright WebContents.capturePage(stayHidden)',
  performanceMode: skipPerformance ? 'visual-only; hidden Electron frame throttling is not a foreground performance baseline' : 'renderer-observation' };
let host, app, lock, timeout, page;
try {
  for (const slot of browserOnly ? [] : [1, 2, 3]) {
    const candidate = join(locks, `heavy-${slot}.lock`);
    try { const handle = await open(candidate, 'wx'); await handle.writeFile(`UI-04-REVIEW-FILES ${new Date().toISOString()} Electron`); await handle.close(); lock = candidate; break; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  if (!lock && !browserOnly) throw Error('All heavy slots are occupied.');
  await mkdir(folder); const git = (...args) => execFileSync('git', ['-C', folder, ...args], { windowsHide: true, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 'synthetic@example.invalid'); git('config', 'user.name', 'Synthetic'); git('config', 'core.autocrlf', 'false');
  await writeFile(join(folder, 'README.md'), '# 合成工作目录\n\n原有内容。\n'); await mkdir(join(folder, 'src')); await writeFile(join(folder, 'src', 'example.js'), 'export const answer = 1;\n');
  await writeFile(join(folder, 'sample.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5mQAAAAASUVORK5CYII=', 'base64'));
  const stream = 'BT /F1 18 Tf 40 140 Td (Synthetic workspace preview) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf = '%PDF-1.4\n'; const offsets = [];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf); pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await writeFile(join(folder, 'sample.pdf'), pdf);
  git('add', '.'); git('commit', '-qm', 'fixture'); await writeFile(join(folder, 'README.md'), '# 合成工作目录\n\n更新后的内容。\n新增一行。\n'); await writeFile(join(folder, 'notes.txt'), '待整理的合成笔记。\n');
  const sessions = new Set();
  const backend = { getStatus: async () => ({ runtime: 'ready', capabilities: { chat: { available: true } } }),
    listModels: async () => [{ id: 'synthetic', configured: true, name: '合成模型' }], preflight: async () => ({}),
    createSession: async ({ sessionId }) => { sessions.add(sessionId); return { sessionId }; },
    describeSession: async sessionId => sessions.has(sessionId) ? { sessionId, agentPreset: 'personal-remote', modelProfileId: 'synthetic' } : null,
    readEvents: async () => ({ events: [], nextSeq: -1, hasMore: false }), sendMessage: async () => ({}), cancelSession: async () => ({}) };
  host = await createPersonalAccessService({ root: join(root, 'host'), port: 0, backend, uiHandler: servePersonalAccessUi });
  const { origin, hostId } = await host.start(); await host.__testContext.activity.close();
  let auth = { origin, 'content-type': 'application/json' };
  const setup = await fetch(origin + '/personal/v1/auth/setup', { method: 'POST', headers: auth,
    body: JSON.stringify({ grant: (await host.issueSetupGrant()).grant, username: 'SyntheticUiFour', password: 'Synthetic UI04 password', deviceName: 'Synthetic' }) });
  assert.equal(setup.status, 201); const cookie = setup.headers.get('set-cookie').split(';')[0], csrf = (await setup.json()).csrfToken;
  auth = { ...auth, cookie, 'x-weftmate-csrf': csrf };
  const request = async (route, body) => { const res = await fetch(origin + '/personal/v1' + route, { method: body ? 'POST' : 'GET', headers: auth, body: body ? JSON.stringify(body) : undefined }); const data = await res.json(); assert.ok(res.ok, JSON.stringify(data)); return data; };
  const project = (await request('/projects', { requestId: 'ui04-register', name: '合成工作目录', rootPath: folder, permission: 'write' })).project;
  const created = (await request('/commands', { requestId: 'ui04-create', kind: 'session.create', targetDeviceId: hostId, modelProfileId: 'synthetic' })).command;
  await waitForCommand(async () => (await request('/commands/' + created.commandId)).command);
  const ctx = host.__testContext, ownerId = Object.keys(ctx.rootState.accounts)[0];
  await ctx.serial(() => ctx.mutate(ownerId, next => bindConversationWork({ ...next, hostId }, created.sessionId, project.projectId)));
  const chat = (await request('/commands', { requestId: 'ui04-create-chat', kind: 'session.create', targetDeviceId: hostId, modelProfileId: 'synthetic' })).command;
  await waitForCommand(async () => (await request('/commands/' + chat.commandId)).command);
  const env = { ...process.env, UI04_PROFILE: join(root, 'profile'), UI04_ORIGIN: origin, UI04_DESKTOP_TOKEN: host.libraryDesktopToken };
  delete env.ELECTRON_RUN_AS_NODE;
  app = browserOnly ? await chromium.launch({ headless: true }) : await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: resolve('.'),
    args: ['tests/integration/workspace-files-electron-entry.mjs', `--user-data-dir=${join(root, 'profile')}`, '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion', '--force-device-scale-factor=1'], env, timeout: 30000 });
  timeout = setTimeout(() => { void app?.close(); void host?.close(); }, 240000);
  page = browserOnly ? await app.newPage({ viewport: { width: 1360, height: 960 } }) : await app.firstWindow(); page.setDefaultTimeout(12000); page.on('pageerror', error => report.errors.push(error.message));
  await page.context().addCookies([{ name: 'wm_personal_session', value: cookie.slice(cookie.indexOf('=') + 1), url: origin }]);
  await page.addInitScript(() => {
    let coreModule;
    Object.defineProperty(globalThis, 'WeftUiCore', { configurable: true, get: () => coreModule, set(value) { coreModule = value; const original = value.create; value.create = (...args) => { globalThis.ui04Core = original(...args); return ui04Core; }; } });
  });
  await page.goto(origin + '/personal/v1/ui/');
  await page.waitForFunction(() => globalThis.__WeftUiStarted && globalThis.ui04Core?.state.csrfToken && Array.isArray(ui04Core.state.chats) && ui04Core.state.sessions?.length);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(async sid => { await ui04Core.selectSession(sid); }, created.sessionId);
  await page.waitForFunction(({ sid, pid }) => WeftPanels.context.sessionId === sid && WeftPanels.context.projectId === pid,
    { sid: created.sessionId, pid: project.projectId });
  assert.equal(await page.evaluate(() => document.querySelectorAll('script[src$="/panels/review.js"]').length), 1);
  assert.equal(await page.evaluate(() => document.querySelectorAll('script[src$="/panels/files.js"]').length), 1);
  report.panelContext = await page.evaluate(() => { const { ownerId, workDir, ...context } = WeftPanels.context; return { ...context, workDirResolved: !!workDir }; });
  async function mount(kind) {
    const panel = page.getByRole('complementary', { name: '工作面板', exact: true });
    if (!await panel.isVisible()) await page.getByRole('button', { name: '打开工作面板', exact: true }).click();
    const title = kind === 'review' ? '审查' : '文件', tab = panel.getByRole('tab', { name: title, exact: true });
    if (await tab.count()) await tab.click();
    else if (await panel.locator(`[data-panel-kind="${kind}"]`).isVisible()) await panel.locator(`[data-panel-kind="${kind}"]`).click();
    else {
      await panel.getByRole('button', { name: '再打开一项', exact: true }).click();
      await page.getByRole('menu', { name: '打开面板', exact: true }).getByRole('menuitem', { name: title, exact: true }).click();
    }
    await panel.locator(`.panel-${kind}`).waitFor({ state: 'visible' });
  }
  async function resize(width, height) {
    if (browserOnly) await page.setViewportSize({ width, height });
    else await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height });
    await page.waitForFunction(() => { const panel = document.querySelector('.panel-files'), file = panel?.querySelector('.workspace-file-title');
      return !panel || !file?.textContent?.includes('/') || panel.clientWidth >= 360 || panel.querySelector('.files-navigation').hidden; });
  }
  async function capture(name) { for (const [width, height] of [[1280, 800], [900, 700]]) { await resize(width, height); for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => WeftDesktop.setAppearance({ theme }), theme); const file = `${name}-${width}x${height}-${theme}.png`;
    if (browserOnly) await page.screenshot({ path: join(out, file) });
    else {
      await page.evaluate(() => document.fonts.ready);
      // A hidden window can still return the previous compositor surface. Warm
      // the capturer, then wait for new renderer frames instead of trusting DOM alone.
      await app.evaluate(async ({ BrowserWindow }) => { await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true }); });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const snapshot = await app.evaluate(async ({ BrowserWindow }) => {
        const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true });
        const size = image.getSize(), bitmap = image.toBitmap(), offset = (Math.floor(size.height / 2) * size.width + Math.floor(size.width / 2)) * 4;
        return { png: image.toPNG().toString('base64'), brightness: (bitmap[offset] + bitmap[offset + 1] + bitmap[offset + 2]) / 3 };
      });
      assert.ok(theme === 'light' ? snapshot.brightness > 150 : snapshot.brightness < 100, `compositor theme mismatch: ${file}`);
      report.captureChecks.push({ file, theme, centerBrightness: snapshot.brightness });
      await writeFile(join(out, file), Buffer.from(snapshot.png, 'base64'));
    }
    report.screenshots.push(file);
  } } }
  await mount('review'); await page.getByRole('button', { name: /README.md/ }).waitFor(); await page.locator('.diff-add').first().waitFor(); await capture('review');
  await resize(1280, 800); await mount('files'); await page.getByText('src', { exact: true }).click(); await page.getByRole('button', { name: 'example.js', exact: true }).click(); await page.getByRole('button', { name: '编辑文本', exact: true }).click();
  await page.getByRole('textbox', { name: '文件文本', exact: true }).fill('export const answer = 2;\n');
  await mount('review'); await mount('files');
  assert.equal(await page.getByRole('textbox', { name: '文件文本', exact: true }).inputValue(), 'export const answer = 2;\n', 'switching registered tabs keeps the editor');
  await page.getByRole('button', { name: '收起右侧面板', exact: true }).click(); await mount('files');
  assert.equal(await page.getByRole('textbox', { name: '文件文本', exact: true }).inputValue(), 'export const answer = 2;\n', 'hiding the registered panel keeps the editor');
  await writeFile(join(folder, 'src', 'example.js'), 'export const external = 3;\n');
  await page.getByRole('button', { name: '刷新文件', exact: true }).click(); await page.getByRole('button', { name: '查看新版本', exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: '文件文本', exact: true }).inputValue(), 'export const answer = 2;\n');
  await page.getByRole('button', { name: '查看新版本', exact: true }).click(); await capture('files-conflict');
  await page.getByRole('button', { name: '保留草稿继续编辑', exact: true }).click(); await page.getByRole('button', { name: '保存', exact: true }).click(); await page.getByText('已保存。', { exact: true }).waitFor();
  assert.equal(await readFile(join(folder, 'src', 'example.js'), 'utf8'), 'export const answer = 2;\n'); await capture('files-saved');
  const ensureNavigation = async () => { const open = page.getByRole('button', { name: '展开导航', exact: true }); if (await open.count()) await open.click(); };
  await ensureNavigation(); await page.getByRole('searchbox', { name: '按文件名搜索' }).fill('notes');
  await page.getByRole('button', { name: 'notes.txt', exact: true }).click();
  await page.locator('.files-current-preview').getByText('待整理的合成笔记。', { exact: true }).waitFor();
  await ensureNavigation(); await page.getByRole('searchbox', { name: '按文件名搜索' }).fill('');
  await page.getByRole('button', { name: 'sample.png', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.files-current-preview img')?.naturalWidth === 1);
  await capture('files-image');
  await ensureNavigation(); await page.getByRole('button', { name: 'sample.pdf', exact: true }).click();
  const pdfFrame = page.locator('.files-current-preview iframe'); await pdfFrame.waitFor({ state: 'visible' });
  assert.match(await pdfFrame.getAttribute('src'), /^blob:/);
  await (await (await pdfFrame.elementHandle()).contentFrame()).waitForLoadState('load');
  await capture('files-pdf');
  report.searchAndMediaPreview = true;
  report.visualAssertionsPassed = true;
  if (!skipPerformance) {
  await resize(1280, 800);
  if (await page.getByRole('button', { name: '展开导航', exact: true }).count()) await page.getByRole('button', { name: '展开导航', exact: true }).click();
  report.performance.push(await measureUiAction(page, 'file-navigation-collapse-expand', async () => {
    await page.getByRole('button', { name: '收起导航', exact: true }).click(); await page.getByRole('button', { name: '展开导航', exact: true }).click();
  }));
  report.performance.push(await measureUiAction(page, 'panel-hide-restore', async () => {
    await page.getByRole('button', { name: '收起右侧面板', exact: true }).click();
    await mount('files');
    await page.locator('.panel-files').waitFor({ state: 'visible' });
  }));
  report.performance.push(await measureUiAction(page, 'file-A-B-switch', async () => {
    await page.getByRole('button', { name: 'notes.txt', exact: true }).click(); await page.getByRole('button', { name: '编辑文本', exact: true }).waitFor();
    if (await page.getByRole('button', { name: '展开导航', exact: true }).count()) await page.getByRole('button', { name: '展开导航', exact: true }).click();
    await page.getByRole('button', { name: 'example.js', exact: true }).click(); await page.getByRole('textbox', { name: '文件文本', exact: true }).waitFor();
  }));
  // Large-list workload stays synthetic and is read through the real workspace API.
  await mkdir(join(folder, 'many')); await Promise.all(Array.from({ length: 500 }, (_, index) => writeFile(join(folder, 'many', `item-${String(index).padStart(4, '0')}.txt`), 'synthetic\n')));
  if (await page.getByRole('button', { name: '展开导航', exact: true }).count()) await page.getByRole('button', { name: '展开导航', exact: true }).click();
  await page.getByRole('button', { name: '刷新文件', exact: true }).click(); await page.getByText('many', { exact: true }).waitFor();
  report.performance.push(await measureUiAction(page, 'file-directory-expand-500', async () => {
    await page.getByText('many', { exact: true }).click(); await page.getByRole('button', { name: 'item-0499.txt', exact: true }).waitFor({ state: 'attached' });
  }));
  report.performance.push(await measureUiAction(page, 'file-list-scroll-500', () => page.evaluate(async () => {
    const view = document.querySelector('.files-navigation'); for (let frame = 0; frame < 30; frame++) { view.scrollTop = (view.scrollHeight - view.clientHeight) * frame / 29; await new Promise(requestAnimationFrame); }
  })));
  await mount('review'); await page.waitForFunction(() => document.querySelectorAll('.review-file').length > 500);
  report.performance.push(await measureUiAction(page, 'review-list-scroll-500', () => page.evaluate(async () => {
    const view = document.querySelector('.review-files'); for (let frame = 0; frame < 30; frame++) { view.scrollTop = (view.scrollHeight - view.clientHeight) * frame / 29; await new Promise(requestAnimationFrame); }
  })));
  report.performance.push(await measureUiAction(page, 'review-unchanged-refresh', async () => {
    await page.locator('.panel-review > .workspace-toolbar button').click(); await page.waitForFunction(() => !document.querySelector('.panel-review button').disabled);
  }));
  report.performance.push(await measureUiAction(page, 'panel-divider-drag', async () => {
    const box = await page.locator('.preview-resize').boundingBox(); assert.ok(box);
    await page.mouse.move(box.x + box.width / 2, box.y + 100); await page.mouse.down();
    await page.mouse.move(box.x - 80, box.y + 100, { steps: 20 }); await page.mouse.move(box.x, box.y + 100, { steps: 20 }); await page.mouse.up();
  }));
  }
  await page.evaluate(async sid => { await ui04Core.selectSession(sid); }, chat.sessionId);
  await page.waitForFunction(sid => WeftPanels.context.sessionId === sid && WeftPanels.context.mode === 'chat', chat.sessionId);
  await mount('review');
  await page.locator('.panel-review').getByText('先在工作模式里选一个工作目录。', { exact: true }).waitFor();
  await capture('review-no-directory');
  await mount('files');
  await page.locator('.panel-files').getByText('先在工作模式里选一个工作目录。', { exact: true }).waitFor();
  report.identityDisposal = await page.evaluate(() => {
    const files = document.querySelector('.panel-files'), review = document.querySelector('.panel-review');
    WeftPanels.update({ ...WeftPanels.context, identityGeneration: WeftPanels.context.identityGeneration + 1 });
    return [files, review].every(el => !el.isConnected && !el.childNodes.length);
  });
  assert.equal(report.identityDisposal, true, 'identity changes dispose every registered panel');
  report.passed = true; assert.deepEqual(report.errors, []);
} catch (error) { report.failure = error.message; if (page) await page.screenshot({ path: join(out, 'failure.png') }).catch(() => {}); throw error; }
finally {
  clearTimeout(timeout); await app?.close().catch(() => {}); await host?.close();
  if (lock) await unlink(lock);
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2));
  const target = resolve(root), rel = relative(resolve(tmpdir()), target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw Error('Fixture cleanup escaped temporary directory.');
  await rm(target, { recursive: true, force: true });
}
console.log(JSON.stringify(report));
