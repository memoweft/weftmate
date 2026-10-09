/** Real Electron/DSH, synthetic account, random ports and metadata-only model fixtures. */
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createPersonalAccessService } from '../../../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../../../src/host-mode.mjs';

const repository = resolve(import.meta.dirname, '../../../..');
const root = mkdtempSync(join(tmpdir(), 'weftmate-ms1-')), profile = join(root, 'profile'); mkdirSync(profile);
const evidence = join(repository, 'tests/evidence/qa-3/models'); mkdirSync(evidence, { recursive: true });
const password = 'synthetic-ms1-' + randomUUID(), key = 'synthetic-ms1-key';
writeFileSync(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
let inference = 0;
const upstream = createServer(async (request, response) => {
  response.setHeader('content-type', 'application/json');
  if (request.url === '/props') { response.end(JSON.stringify({ total_slots: 1, n_ctx: 8192 })); return; }
  if (request.url === '/switch/status') { response.end(JSON.stringify({ currentModelId: 'muse-q5', switching: false })); return; }
  if (request.url === '/v1/models') { response.end(JSON.stringify({ data: ['muse-q5', 'occamy', 'local-quality', 'mimo-v2.6-flash'].map(id => ({ id })) })); return; }
  if (request.url === '/unsupported/v1/models') { response.writeHead(404).end(); return; }
  if (request.url.endsWith('/chat/completions')) { inference++; request.resume(); response.end(JSON.stringify({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] })); return; }
  response.writeHead(404).end();
});
await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${upstream.address().port}/v1`;
writeFileSync(join(root, 'local.json'), JSON.stringify({ baseUrl }));
writeFileSync(join(profile, 'weftmate-settings.json'), JSON.stringify({ schemaVersion: 3, models: { activeId: null,
  profiles: [{ id: 'synthetic-unconfigured', name: '合成模型 · 未配置', provider: 'openai-compatible', baseUrl, model: 'unconfigured' }] } }));
const backend = Object.fromEntries(['getStatus', 'listModels', 'preflight', 'createSession', 'sendMessage', 'cancelSession', 'readEvents', 'describeSession'].map(name => [name, async () => name === 'listModels' ? [] : {}]));
const preparation = await createPersonalAccessService({ root: join(profile, 'personal-access'), port: 0, backend });
const prepared = await preparation.start(), setup = await preparation.issueSetupGrant();
const registered = await fetch(`${prepared.origin}/personal/v1/auth/setup`, { method: 'POST', headers: { origin: prepared.origin, 'content-type': 'application/json' },
  body: JSON.stringify({ grant: setup.grant, username: 'MS1Fixture', password, deviceName: 'Synthetic preparation' }) });
assert.equal(registered.status, 201); await preparation.close();
const env = { ...process.env };
for (const name of Object.keys(env)) if (name.startsWith('WEFTMATE_') || name.startsWith('MEMOWEFT_') || name === 'ELECTRON_RUN_AS_NODE') delete env[name];
let application, browser, output = '', page;
const errors = [], report = { synthetic: true, realElectron: true, realDsh: true, paidInference: 0 };
async function until(check, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 150)); }
  throw new Error('MS1 condition timed out');
}
async function api(path, body, method = body ? 'POST' : 'GET') {
  return page.evaluate(async ({ path, body, method }) => {
    const me = await (await fetch('/personal/v1/auth/me')).json();
    const response = await fetch('/personal/v1' + path, { method, headers: { 'content-type': 'application/json', 'x-weftmate-csrf': me.csrfToken }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  }, { path, body, method });
}
async function login(target) {
  await target.locator('#login-view').waitFor({ state: 'visible' });
  await target.getByRole('button', { name: '离线使用这台电脑', exact: true }).click();
  if (await target.locator('#auth-local-account').isVisible()) await target.locator('#auth-local-account').click();
  await target.fill('#auth-offline-account', 'MS1Fixture'); await target.fill('#auth-password', password);
  await target.locator('#cloud-auth-form button[type=submit]').click(); await target.locator('#assistant-view').waitFor({ state: 'visible' });
}
async function openModels(target) {
  if (!await target.getByRole('button', { name: '账户菜单', exact: true }).isVisible()) await target.locator('#rail-open').click();
  await target.getByRole('button', { name: '账户菜单', exact: true }).click();
  await target.getByRole('button', { name: '设置', exact: true }).click();
  if (await target.locator('button.settings-category-picker').isVisible()) { await target.locator('button.settings-category-picker').click(); await target.getByRole('option', { name: '助手 · 模型', exact: true }).click(); }
  else await target.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '模型', exact: true }).click();
  await target.getByRole('button', { name: '添加模型', exact: true }).waitFor();
  await until(() => target.locator('#account-models-list .project-row').count().then(count => count >= 5));
}
async function screenshot(name) {
  const png = await application.evaluate(async ({ desktopCapturer, BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(win => win.getTitle() === 'WeftMate');
    const handle = window.getNativeWindowHandle(), id = handle.length === 8 ? handle.readBigUInt64LE().toString() : handle.readUInt32LE().toString();
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1600, height: 1200 } });
    const source = sources.find(row => row.id.split(':')[1] === id); if (!source || source.thumbnail.isEmpty()) throw new Error('Native screenshot unavailable');
    return source.thumbnail.toPNG().toString('base64');
  });
  writeFileSync(join(evidence, name), Buffer.from(png, 'base64'));
}
try {
  application = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: ['.', '--personal-host', `--user-data-dir=${profile}`, '--access-port=0', `--local-model-config=${join(root, 'local.json')}`], cwd: repository, env, timeout: 90000 });
  application.process().stdout?.on('data', part => output += String(part)); application.process().stderr?.on('data', part => output += String(part));
  page = await application.firstWindow({ timeout: 90000 }); page.setDefaultTimeout(60000); page.on('pageerror', error => errors.push(error.message));
  await page.waitForURL('**/personal/v1/ui'); await login(page);
  // A synthetic LAN hostname remains visible as LAN; all actual requests hit our random loopback port.
  await application.evaluate(() => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (url, options) => { const target = new URL(url); if (target.hostname === 'ms1-fixture.local') target.hostname = '127.0.0.1'; return originalFetch(target, options); };
  });
  for (const [name, modelId, endpoint, modelTier] of [
    ['Muse Q5 · 合成', 'muse-q5', baseUrl, 'local'], ['Occamy · 合成', 'occamy', baseUrl, 'local'],
    ['LAN Quality · 合成', 'local-quality', baseUrl.replace('127.0.0.1', 'ms1-fixture.local'), 'local'], ['MiMo · 合成', 'mimo-v2.6-flash', baseUrl, 'cloud']
  ]) {
    const requestId = randomUUID(); assert.equal((await api('/account/models', { requestId, name, modelId, baseUrl: endpoint, modelTier, apiKey: key })).status, 202);
    const result = await until(async () => { const value = await api(`/account/models/by-request/${requestId}`); return value.body.operation?.status === 'succeeded' && value.body; });
    if (modelId === 'muse-q5') report.museProfile = result.model.profileId;
  }
  await api('/settings/models', { defaultModelProfileId: report.museProfile }, 'PATCH');
  await page.reload(); await page.locator('#assistant-view').waitFor({ state: 'visible' }); await openModels(page);
  assert.equal(await page.locator('#account-model-dialog').isVisible(), false);
  assert.ok((await page.locator('#account-models-list').innerText()).includes('已加载'));
  assert.equal(await page.locator('#default-model-select').inputValue(), report.museProfile);
  assert.equal(await page.locator('#background-current-model').innerText(), '当前主模型：Muse Q5 · 合成');
  // Set background explicitly then return to follow mode to verify both persisted paths.
  await page.locator('#background-model-select').selectOption(report.museProfile, { force: true }); await until(() => page.locator('#background-model-notice').innerText().then(value => value.includes('已保存')));
  await page.locator('#background-model-select').selectOption('', { force: true });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { localStorage.setItem('weftmate:appearance', JSON.stringify({ theme, accent: 'neutral', fontSize: 15 })); document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme; }, theme);
    await page.waitForTimeout(250); await screenshot(`desktop-${theme}.png`);
    await page.locator('#account-models-list').scrollIntoViewIfNeeded(); await page.waitForTimeout(200); await screenshot(`desktop-${theme}-list.png`);
    await page.locator('.settings-content').evaluate(node => node.scrollTop = 0);
  }
  await page.getByRole('button', { name: '添加模型', exact: true }).click();
  await page.fill('#account-model-name', '合成连接检查'); await page.fill('#account-model-base-url', baseUrl.replace('/v1', '/unsupported/v1'));
  await page.fill('#account-model-id', 'muse-q5'); await page.fill('#account-model-key', key);
  await page.locator('#account-model-draft-test').click(); await page.getByRole('button', { name: '发送测试消息', exact: true }).waitFor();
  assert.equal(inference, 0); assert.equal(await page.locator('#account-model-form-status').innerText(), ''); await page.locator('#account-model-draft-result').scrollIntoViewIfNeeded(); await page.waitForTimeout(200); await screenshot('desktop-test-no-catalog.png');
  await page.getByRole('button', { name: '发送测试消息', exact: true }).click();
  await until(() => page.locator('#account-model-draft-result').innerText().then(text => text.includes('测试消息已通过')));
  assert.equal(inference, 1); await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.locator('#account-model-key').inputValue(), '');
  // Edit uses the same protected-focus dialog.
  await page.locator('#account-models-list .project-row').filter({ hasText: 'Muse Q5' }).getByRole('button', { name: '编辑', exact: true }).click();
  assert.equal(await page.locator('#model-editor-title').innerText(), '编辑模型');
  assert.equal(await page.locator('#account-model-tier').inputValue(), 'local');
  assert.ok((await page.getByRole('dialog', { name: '编辑模型', exact: true }).getByRole('combobox', { name: '位置', exact: true }).innerText()).includes('本地'));  await screenshot('desktop-edit.png'); await page.keyboard.press('Escape');
  browser = await chromium.launch(); const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobile = await context.newPage(); mobile.on('pageerror', error => errors.push(error.message));
  const cookies = await application.evaluate(async ({ session }) => session.fromPartition('persist:weftmate-desktop').cookies.get({}));
  await context.addCookies(cookies.filter(cookie => !cookie.name.startsWith('__')).map(cookie => ({ name: cookie.name, value: cookie.value, url: page.url(), httpOnly: cookie.httpOnly, secure: cookie.secure })));
  await mobile.goto(page.url()); await mobile.locator('#assistant-view').waitFor({ state: 'visible' }); await openModels(mobile);
  for (const theme of ['light', 'dark']) {
    await mobile.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme; }, theme);
    await mobile.waitForTimeout(250); await mobile.screenshot({ path: join(evidence, `mobile-${theme}.png`) });
    const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth); assert.equal(overflow, false);
  }
  report.clientErrors = errors; assert.deepEqual(errors, []);
  report.syntheticInference = inference; report.logs = readdirSync(join(profile, 'logs'));
  const logs = report.logs.map(file => readFileSync(join(profile, 'logs', file), 'utf8')).join('');
  assert.ok(logs.includes('host.start')); assert.equal(logs.includes(key), false); assert.equal(logs.includes(password), false); assert.equal(logs.includes('Reply OK.'), false);
  delete report.museProfile; writeFileSync(join(evidence, 'report.json'), JSON.stringify(report, null, 2));
  console.log('MS1 desktop light/dark, add/edit, explicit fallback inference and mobile 390x844 verified.');
} catch (error) {
  console.error(output.slice(-4000).replaceAll(key, '[redacted]').replaceAll(password, '[redacted]')); throw error;
} finally {
  await browser?.close(); if (application) { await application.evaluate(({ app }) => app.quit()).catch(() => {}); await application.close().catch(() => {}); }
  upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve));
  assert.ok(root.startsWith(tmpdir())); rmSync(root, { recursive: true, force: true });
}
