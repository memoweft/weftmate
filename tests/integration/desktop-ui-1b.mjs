// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
/** Real Windows Electron + real pinned DSH, isolated account and loopback model only. */
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';

if (process.platform !== 'win32') throw new Error('This native shell verification requires Windows.');
const root = mkdtempSync(join(process.env.SystemRoot || 'C:/Windows', 'Temp', 'weftmate-ui-1b-'));
const profile = join(root, 'profile'); mkdirSync(profile);
writeFileSync(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const repository = resolve(import.meta.dirname, '../..');
const evidence = join(repository, 'tests/evidence/ui-1b'); mkdirSync(evidence, { recursive: true });
const password = `synthetic-${randomUUID()}-password`;
// Prepare an existing test account through the ordinary registration API, then log in in the program.
const backend = Object.fromEntries(['getStatus', 'listModels', 'preflight', 'createSession', 'sendMessage', 'cancelSession', 'readEvents', 'describeSession']
  .map(method => [method, async () => method === 'listModels' ? [] : {}]));
const preparation = await createPersonalAccessService({ root: join(profile, 'personal-access'), port: 0, backend });
const prepared = await preparation.start();
const setup = await preparation.issueSetupGrant();
const registered = await fetch(`${prepared.origin}/personal/v1/auth/setup`, { method: 'POST',
  headers: { origin: prepared.origin, 'content-type': 'application/json' },
  body: JSON.stringify({ grant: setup.grant, username: 'PanelFixture', password, deviceName: 'Preparation' }) });
assert.equal(registered.status, 201); await preparation.close();
let tools = [], workflowCalls = 0, questionCalls = 0, fixtureSession;
const model = createServer(async (request, response) => {
  console.log('Synthetic provider:', request.method, request.url);
  if (request.url === '/v1/models') { response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [{ id: 'w1-synthetic-model', object: 'model' }] })); return; }
  if (request.url !== '/v1/chat/completions') { response.writeHead(404).end(); return; }
  let raw = ''; for await (const part of request) raw += part;
  const body = JSON.parse(raw); const names = (body.tools || []).map(tool => tool.function?.name || tool.name);
  if (names.length) tools = names;
  console.log('Synthetic tools:', names.length);
  const text = body.messages.filter(message => message.role === 'user').map(message => typeof message.content === 'string' ? message.content :
    (message.content || []).filter(part => part.type === 'text').map(part => part.text).join('')).join('\n');
  let tool, args;
  if (names.length && text.includes('W1_QUESTION')) {
    if (++questionCalls === 1) { tool = 'ask_user_question'; args = { questions: [{ id: 'w1', header: '合成提问', question: '请确认这次程序测试可以继续。', options: [{ label: '继续' }, { label: '稍后' }] }] }; }
  } else if (names.length && text.includes('W1_APPROVAL')) {
    workflowCalls++;
    if (workflowCalls === 1) { tool = 'weftmod_script'; args = { action: 'run', description: 'W1 合成文件写入审批',
      code: 'return await tools.write({file_path: params.path, content: "W1 synthetic approval result"});',
      params: { path: join(profile, 'conversations', fixtureSession, 'approval.txt') } }; }
    else if (workflowCalls === 2) { tool = 'write'; args = { file_path: join(profile, 'conversations', fixtureSession, 'w1-result.txt'), content: 'W1 synthetic desktop artifact' }; }
  }
  if (tool && names.includes('run_code')) { args = { code: `return await tools.${tool}(${JSON.stringify(args)});`, description: 'W1 synthetic tool call' }; tool = 'run_code'; }
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const frame = choice => response.write(`data: ${JSON.stringify({ id: 'w1-fixture', model: body.model, object: 'chat.completion.chunk', choices: [choice] })}\n\n`);
  frame({ index: 0, delta: tool ? { role: 'assistant', tool_calls: [{ index: 0, id: `call-${randomUUID()}`, type: 'function', function: { name: tool, arguments: JSON.stringify(args) } }] }
    : { role: 'assistant', content: 'W1 合成模型已完成，真实程序时间线验证通过。' }, finish_reason: null });
  frame({ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }); response.end('data: [DONE]\n\n');
});
await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
const executablePath = createRequire(import.meta.url)('electron');
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('WEFTMATE_') || key.startsWith('MEMOWEFT_') || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
const args = ['.', `--user-data-dir=${profile}`, '--personal-host', '--access-port=0'];
let application, page, browser, remote, output = '';
const capture = !process.argv.includes('--verify-only');
const report = { realElectron: true, realDsh: true, syntheticAccount: true, paidModelRequests: 0 };
async function until(check, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 200)); }
  throw new Error('W1 condition timed out');
}
async function start(extra = []) {
  application = await _electron.launch({ executablePath, args: [...args, ...extra], cwd: repository, env, timeout: 90000 });
  application.process().stdout?.on('data', part => { output += String(part); });
  application.process().stderr?.on('data', part => { output += String(part); });
  await application.evaluate(({ app, Tray, Notification }) => {
    globalThis.w1Notifications = []; globalThis.w1NativeNotifications = []; globalThis.w1Shown = [];
    app.on('weftmate-desktop-notification', event => globalThis.w1Notifications.push(event));
    app.on('weftmate-desktop-notification-shown', event => globalThis.w1Shown.push(event));
    const show = Notification.prototype.show;
    Notification.prototype.show = function () { globalThis.w1NativeNotifications.push(this); return show.call(this); };
    const menu = Tray.prototype.setContextMenu;
    Tray.prototype.setContextMenu = function (value) { globalThis.w1Tray = this; globalThis.w1TrayMenu = value; return menu.call(this, value); };
    // Verify the startup bridge without replacing the real user's Windows login entry.
    globalThis.w1Startup = false;
    app.getLoginItemSettings = () => ({ openAtLogin: globalThis.w1Startup });
    app.setLoginItemSettings = value => { globalThis.w1Startup = value.openAtLogin; globalThis.w1LoginOptions = value; };
  });
  page = await application.firstWindow({ timeout: 90000 }); page.setDefaultTimeout(60000);
  await page.waitForURL('**/personal/v1/ui');
}
async function api(path, body) {
  return page.evaluate(async ({ path, body }) => {
    const me = await (await fetch('/personal/v1/auth/me')).json();
    const response = await fetch(`/personal/v1${path}`, { method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', 'x-weftmate-csrf': me.csrfToken }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  }, { path, body });
}
async function screenshot(name) {
  if (!capture) return;
  // OS window thumbnail includes the native caption buttons, unlike page.screenshot().
  const encoded = await application.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
    const win = BrowserWindow.getAllWindows().find(win => win.getTitle() === 'WeftMate');
    const handle = win.getNativeWindowHandle();
    const id = handle.length === 8 ? handle.readBigUInt64LE().toString() : handle.readUInt32LE().toString();
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1600, height: 1200 } });
    const source = sources.find(source => source.id.split(':')[1] === id);
    if (!source || source.thumbnail.isEmpty()) throw new Error('Native window capture unavailable');
    return source.thumbnail.toPNG().toString('base64');
  });
  writeFileSync(join(evidence, name), Buffer.from(encoded, 'base64'));
}
async function panelFlow(target, theme, native = false) {
  await target.evaluate(theme => { localStorage.setItem('weftmate.desktop.appearance.v1', JSON.stringify({ theme })); }, theme);
  await target.reload(); await target.locator('#assistant-view').waitFor({ state: 'visible' });
  await target.locator('#session-list button').first().click();
  await target.locator('#conversation-resources').click();
  const picker = target.getByRole('dialog', { name: '输出与来源' });
  await picker.locator('[data-resource-key^="artifact:"]').filter({ hasText: 'w1-result.txt' }).first().waitFor();
  if (native) await screenshot(`${theme}-list.png`);
  await picker.locator('[data-resource-key^="artifact:"]').filter({ hasText: 'w1-result.txt' }).first().click();
  await target.locator('.preview-content:not([hidden])').getByText('W1 synthetic desktop artifact', { exact: true }).waitFor();
  assert.equal(await target.getByRole('tab').count(), 1);
  const content = target.locator('.preview-content:not([hidden])');
  assert.equal(await content.getByText('用默认程序打开', { exact: true }).count(), native ? 1 : 0);
  assert.equal(await content.getByText('在文件夹中显示', { exact: true }).count(), native ? 1 : 0);
  // Browser downloads use the same authenticated endpoint and preserve bytes.
  if (!native) {
    const pending = target.waitForEvent('download'); await content.getByText('下载', { exact: true }).click();
    const download = await pending; assert.equal(readFileSync(await download.path(), 'utf8'), 'W1 synthetic desktop artifact');
  }
  await target.getByRole('button', { name: '再打开一项' }).click();
  await picker.locator('[data-resource-key^="tool:"]').first().waitFor();
  const toolName = await picker.locator('[data-resource-key^="tool:"]').first().getAttribute('data-resource-key');
  await picker.locator('[data-resource-key^="tool:"]').first().click();
  assert.equal(await target.getByRole('tab').count(), 2);
  await target.locator('.preview-content:not([hidden])').getByText(/调用 \d+ 次/).waitFor();
  await target.getByRole('button', { name: '查看调用内容' }).first().click();
  await target.locator('.preview-content:not([hidden]) pre').first().waitFor();
  if (native) await screenshot(`${theme}-tabs.png`);
  await target.locator('.preview-tab-close').last().click(); assert.equal(await target.getByRole('tab').count(), 1);
  await target.getByRole('button', { name: '再打开一项' }).click();
  await picker.locator(`[data-resource-key="${toolName}"]`).click(); assert.equal(await target.getByRole('tab').count(), 2);
  // Real pointer dragging, including capture at the left edge of the panel.
  const separator = target.getByRole('separator', { name: '调整预览宽度' }), bounds = await separator.boundingBox();
  const before = await target.locator('.timeline-preview').boundingBox();
  await target.mouse.move(bounds.x + 3, bounds.y + 120); await target.mouse.down();
  await target.mouse.move(bounds.x - 100, bounds.y + 120, { steps: 8 }); await target.mouse.up();
  assert.ok((await target.locator('.timeline-preview').boundingBox()).width > before.width + 50);
  await target.getByRole('button', { name: '放大右侧面板' }).click();
  assert.equal(await target.locator('body').evaluate(body => body.classList.contains('preview-expanded')), true);
  await target.getByRole('button', { name: '放大右侧面板' }).click();
  await target.getByRole('button', { name: '收起右侧面板' }).click();
  assert.equal(await target.locator('.timeline-preview').isVisible(), false);
  await target.locator('#conversation-resources').click(); await picker.locator(`[data-resource-key="${toolName}"]`).click();
  assert.equal(await target.getByRole('tab').count(), 2); assert.equal(await target.locator('.timeline-preview').isVisible(), true);
  await target.locator('#conversation-resources').click(); await picker.getByText('查看全部', { exact: true }).click();
  await target.locator('.preview-content:not([hidden])').getByRole('heading', { name: '来源', exact: true }).waitFor();
  assert.equal(await target.getByRole('tab').count(), 3);
  // Processed approval is one visible sentence; no execution/receipt implementation copy.
  const resolved = target.locator('.conversation-approval.is-resolved').first();
  assert.match(await resolved.innerText(), /已允许 ·/);
  assert.doesNotMatch(await resolved.innerText(), /执行端|回执|请继续查看/);
  assert.ok((await resolved.innerText()).trim().split('\n').length === 1);
  if (native) {
    assert.equal(await target.locator('.rail-heading > strong').isVisible(), false);
    await screenshot(`${theme}-all.png`);
  }
  await target.evaluate(() => window.WeftDesktop.closePreview(false));
  await target.getByRole('button', { name: '打开成果', exact: true }).first().click();
  assert.equal(await target.getByRole('tab').count(), 1);
  await target.evaluate(() => window.WeftDesktop.closePreview(false));
  await target.getByRole('button', { name: '查看来源与成果', exact: true }).first().click();
  await target.locator('.preview-content:not([hidden])').getByRole('heading', { name: '来源', exact: true }).waitFor();
  await target.evaluate(() => window.WeftDesktop.closePreview(false));
}
try {
  await start();
  await page.fill('#login-name', 'PanelFixture'); await page.fill('#login-password', password); await page.fill('#login-device', 'Panel Electron');
  await page.locator('#login-form button[type=submit]').click(); await page.locator('#assistant-view').waitFor({ state: 'visible' });
  const configured = await api('/account/models', { requestId: 'ui1b-model', name: 'Panel Synthetic', baseUrl: `http://127.0.0.1:${model.address().port}/v1`, modelId: 'w1-synthetic-model', apiKey: 'synthetic-no-secret' });
  assert.equal(configured.status, 202);
  const operation = await until(async () => { const value = await api('/account/models/by-request/ui1b-model'); return value.body.operation?.status === 'succeeded' && value.body; });
  assert.equal(operation.operation.status, 'succeeded');
  await page.reload(); await page.locator('#new-session').click(); await until(() => page.locator('#message-text').isEnabled());
  fixtureSession = (await api('/sessions')).body.sessions[0].sessionId;
  await page.fill('#message-text', 'W1_APPROVAL：写入合成文件并保存成果，然后告诉我完成了。'); await page.locator('#send-message').click();
  await page.getByRole('button', { name: /允许(?:一次|本次)/ }).first().click();
  await page.getByText('W1 合成模型已完成，真实程序时间线验证通过。', { exact: true }).first().waitFor();
  await page.locator('.conversation-approval.is-resolved').first().waitFor();
  await application.evaluate(({ shell }) => {
    globalThis.panelFiles = []; const open = shell.openPath, show = shell.showItemInFolder;
    shell.openPath = async path => { const error = await open(path); globalThis.panelFiles.push({ path, error, action: 'open' }); return error; };
    shell.showItemInFolder = path => { show(path); globalThis.panelFiles.push({ path, action: 'show' }); };
  });
  await panelFlow(page, 'light', true);
  await page.locator('[data-timeline-artifact]').filter({ hasText: 'w1-result.txt' }).getByRole('button', { name: '打开成果', exact: true }).click();
  const preview = page.locator('.preview-content:not([hidden])');
  await preview.getByRole('button', { name: '用默认程序打开', exact: true }).click();
  await preview.getByRole('button', { name: '在文件夹中显示', exact: true }).click();
  const files = await until(() => application.evaluate(() => globalThis.panelFiles.length === 2 && globalThis.panelFiles));
  assert.equal(files[0].error, ''); assert.equal(readFileSync(files[0].path, 'utf8'), 'W1 synthetic desktop artifact');
  report.nativeOpenAndReveal = true;
  await panelFlow(page, 'dark', true);
  report.nativePanelFlow = ['light', 'dark']; report.oneLineApproval = true;
  // The remote browser has no preload bridge and uses the real isolated host.
  const origin = new URL(page.url()).origin;
  browser = await chromium.launch({ headless: true, channel: 'msedge' }); remote = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await remote.goto(origin + '/personal/v1/ui');
  await remote.fill('#login-name', 'PanelFixture'); await remote.fill('#login-password', password); await remote.fill('#login-device', 'Panel Browser');
  await remote.locator('#login-form button[type=submit]').click(); await remote.locator('#assistant-view').waitFor({ state: 'visible' });
  await panelFlow(remote, 'light'); await panelFlow(remote, 'dark'); report.remotePanelFlow = ['light', 'dark']; report.remoteDownload = true;
  if (capture) await remote.screenshot({ path: join(evidence, 'browser-dark.png') });
  // A second conversation verifies empty groups and scope cleanup.
  await remote.locator('#new-session').click(); await until(async () => await remote.locator('#message-text').isEnabled() && !(await remote.locator('#transcript').innerText()).trim());
  await remote.locator('#conversation-resources').click();
  await remote.getByText('这段对话还没有生成输出内容。', { exact: true }).waitFor();
  assert.equal(await remote.getByRole('tab').count(), 0); report.conversationIsolationAndEmpty = true;
  await browser.close(); browser = null;
  await page.locator('#new-session').click(); await until(() => page.locator('#message-text').isEnabled());
  await page.fill('#message-text', 'W1_QUESTION：先问我一个合成问题，收到回答后完成。'); await page.locator('#send-message').click();
  await page.getByRole('button', { name: '提交回答', exact: true }).first().waitFor();
  await page.getByText('继续', { exact: true }).last().click(); await page.getByRole('button', { name: '提交回答', exact: true }).first().click();
  await page.locator('.conversation-question.is-resolved').first().waitFor();
  const answered = await page.locator('.conversation-question.is-resolved').first().innerText();
  assert.match(answered, /已回答 ·/); assert.equal(answered.trim().split('\n').length, 1); report.oneLineQuestion = true;
  if (capture) { await screenshot('dark-question.png'); writeFileSync(join(evidence, 'verification.json'), JSON.stringify(report, null, 2) + '\n'); }
  console.log('UI-1b real desktop and remote panel verification passed.');
} catch (error) { writeFileSync(join(root, 'failure.log'), output); console.error(`Isolated diagnostic: ${root}`); if (remote && !remote.isClosed()) console.error('Remote fixture view:', (await remote.locator('body').innerText()).slice(-1400)); throw error; }
finally { await browser?.close(); await application?.close().catch(() => {}); await new Promise(resolve => model.close(resolve)); }
