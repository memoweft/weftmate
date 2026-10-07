/** Real Windows Electron + real pinned DSH, isolated account and loopback model only. */
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';

if (process.platform !== 'win32') throw new Error('This native shell verification requires Windows.');
const root = mkdtempSync(join(process.env.SystemRoot || 'C:/Windows', 'Temp', 'weftmate-ui-1c-'));
const profile = join(root, 'profile'); mkdirSync(profile);
writeFileSync(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const repository = resolve(import.meta.dirname, '../..');
const evidence = join(repository, 'tests/evidence/ui-1c'); mkdirSync(evidence, { recursive: true });
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
    if (workflowCalls === 1) { tool = 'weftmod_script'; args = { action: 'run', description: '写入 approval.txt',
      code: 'return await tools.write({file_path: params.path, content: "W1 synthetic approval result"});',
      params: { path: join(profile, 'conversations', fixtureSession, 'approval.txt') } }; }
    else if (workflowCalls === 2) { tool = 'write'; args = { file_path: join(profile, 'conversations', fixtureSession, 'approval.txt'), content: 'UI-1c latest approval output' }; }
    else if (workflowCalls === 3 || workflowCalls === 4) { tool = 'write'; args = { file_path: join(profile, 'conversations', fixtureSession, 'w1-result.txt'), content: workflowCalls === 3 ? 'UI-1c older output' : 'UI-1c latest output' }; }
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
const args = ['.', `--user-data-dir=${profile}`, '--personal-host', '--access-port=0'];
let application, page, output = '';
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

async function panelFlow(theme) {
  await page.evaluate(theme => localStorage.setItem('weftmate.desktop.appearance.v1', JSON.stringify({ theme })), theme);
  await page.reload(); await page.locator('#assistant-view').waitFor({ state: 'visible' });
  await page.locator('#session-list button').first().click();
  const newChat = await page.locator('#new-session').boundingBox(), collapse = await page.locator('#rail-close').boundingBox();
  assert.ok(Math.abs(newChat.y + newChat.height / 2 - collapse.y - collapse.height / 2) < 1, `sidebar controls share one center line: ${JSON.stringify({ newChat, collapse })}`);
  assert.ok(newChat.x + newChat.width <= collapse.x, 'sidebar controls do not overlap');
  const rail = await page.locator('#session-rail').boundingBox();
  assert.ok(newChat.y - rail.y < 24, 'no empty heading row');
  await page.locator('#rail-close').click();
  assert.equal(await page.locator('#session-rail').isVisible(), false);
  await page.locator('#rail-open').click();
  await page.locator('#conversation-resources').click();
  const picker = page.getByRole('dialog', { name: '输出与来源' });
  const outputs = picker.locator('[data-resource-key^="artifact:"]');
  await outputs.filter({ hasText: 'w1-result.txt' }).waitFor();
  assert.equal(await outputs.count(), 2, 'one entry for each named file');
  assert.equal(await outputs.filter({ hasText: 'approval.txt' }).count(), 1);
  await screenshot(`${theme}-list.png`);
  await outputs.filter({ hasText: 'approval.txt' }).click();
  const content = page.locator('.preview-content:not([hidden])');
  await content.getByText('UI-1c latest approval output', { exact: true }).waitFor();
  await page.getByRole('button', { name: '再打开一项' }).click();
  await outputs.filter({ hasText: 'w1-result.txt' }).click();
  await content.getByText('UI-1c latest output', { exact: true }).waitFor();
  await page.getByRole('button', { name: '再打开一项' }).click();
  await picker.locator('[data-resource-key="tool:weftmod_script"]').click();
  await content.getByText('调用 1 次', { exact: true }).waitFor();
  assert.match(await content.locator('.resource-usage summary').innerText(), /运行脚本：写入 approval\.txt · \d{2}:\d{2}/);
  assert.equal(await content.locator('pre').count(), 0, 'source opens at the human summary');
  await screenshot(`${theme}-summary.png`);
  await content.locator('.resource-usage summary').click();
  await content.getByRole('button', { name: '复制', exact: true }).waitFor();
  const raw = await content.locator('pre').innerText();
  assert.match(raw, /arguments/); assert.match(raw, /output/);
  const font = await content.locator('pre').evaluate(pre => getComputedStyle(pre).fontFamily);
  assert.match(font, /mono|Consolas/i);
  await content.getByRole('button', { name: '复制', exact: true }).click();
  await content.getByRole('button', { name: '已复制', exact: true }).waitFor();
  const copied = await application.evaluate(({ clipboard }) => clipboard.readText());
  assert.equal(copied.replace(/\r\n/g, '\n'), raw.replace(/\r\n/g, '\n'), 'Windows clipboard preserves content with native newlines');
  await screenshot(`${theme}-detail.png`);
  await content.locator('.resource-usage summary').click();
  assert.equal(await content.locator('pre').isVisible(), false);
  await page.getByRole('button', { name: '再打开一项' }).click();
  await picker.locator('[data-resource-key="tool:write"]').click();
  await content.getByText('调用 3 次', { exact: true }).waitFor();
  assert.equal(await content.locator('.resource-usage').count(), 3);
  assert.equal(await content.locator('pre').count(), 0);
  assert.match(await content.innerText(), /写入文件：approval\.txt/);
  assert.match(await content.innerText(), /写入文件：w1-result\.txt/);
  await screenshot(`${theme}-calls.png`);
  await page.evaluate(() => window.WeftDesktop.closePreview(false));
}

try {
  await start();
  await page.fill('#login-name', 'PanelFixture'); await page.fill('#login-password', password); await page.fill('#login-device', 'Panel Electron');
  await page.locator('#login-form button[type=submit]').click(); await page.locator('#assistant-view').waitFor({ state: 'visible' });
  const configured = await api('/account/models', { requestId: 'ui1c-model', name: 'Panel Synthetic', baseUrl: `http://127.0.0.1:${model.address().port}/v1`, modelId: 'w1-synthetic-model', apiKey: 'synthetic-no-secret' });
  assert.equal(configured.status, 202);
  await until(async () => (await api('/account/models/by-request/ui1c-model')).body.operation?.status === 'succeeded');
  await page.reload(); await page.locator('#new-session').click(); await until(() => page.locator('#message-text').isEnabled());
  fixtureSession = (await api('/sessions')).body.sessions[0].sessionId;
  await page.fill('#message-text', 'W1_APPROVAL：重复写入合成文件，然后保存最新成果。'); await page.locator('#send-message').click();
  await page.getByRole('button', { name: /允许(?:一次|本次)/ }).first().click();
  await page.getByText('W1 合成模型已完成，真实程序时间线验证通过。', { exact: true }).first().waitFor();
  await panelFlow('light'); await panelFlow('dark');
  Object.assign(report, { nativeThemes: ['light', 'dark'], latestOutputs: true, readableCalls: true, collapsibleRawDetails: true, copyExactRawDetails: true, sidebarAligned: true });
  // Synthetic connector source exercises the same presentation in the real window.
  // It uses no external connector or account and makes no network request outside loopback.
  const connector = { key: 'tool:connector.search', kind: 'tool', name: 'connector.search', uses: [
    { id: 'connector-1', callId: 'connector-1', at: '2026-10-08T02:28:00Z', summary: '查找日历里的下次会议', path: '/sessions/synthetic/events/900/detail' },
    { id: 'connector-2', callId: 'connector-2', at: '2026-10-08T02:29:00Z', summary: '查找日历里的本周安排', path: '/sessions/synthetic/events/901/detail' },
  ] };
  await page.route('**/personal/v1/sessions/*/resources?*', async route => {
    const response = await route.fetch(); const data = await response.json(); data.sources.push(connector);
    await route.fulfill({ response, json: data });
  });
  let detailReads = 0;
  await page.route('**/personal/v1/sessions/synthetic/events/*/detail', async route => {
    detailReads++;
    if (detailReads === 1) await route.fulfill({ status: 503, json: { code: 'BACKEND_UNAVAILABLE' } });
    else await route.fulfill({ json: { text: '{"arguments":{"query":"会议"},"output":"合成日历结果"}', truncated: true } });
  });
  await page.locator('#conversation-resources').click();
  await page.getByRole('dialog', { name: '输出与来源' }).locator('[data-resource-key="tool:connector.search"]').click();
  const content = page.locator('.preview-content:not([hidden])');
  assert.equal(detailReads, 0, 'raw connector calls stay lazy');
  assert.equal(await content.locator('.resource-usage').count(), 2);
  const summary = content.locator('.resource-usage summary').first();
  await summary.focus(); await page.keyboard.press('Enter');
  await content.getByText('暂时无法读取，收起后可重试。', { exact: true }).waitFor();
  await page.keyboard.press('Enter'); await until(() => summary.evaluate(node => !node.parentElement.open));
  await page.keyboard.press('Enter'); await content.getByRole('button', { name: '复制', exact: true }).waitFor();
  assert.equal(detailReads, 2); assert.match(await content.locator('pre').innerText(), /内容已截断/);
  // Retrying replaces the loading/error body instead of duplicating it.
  assert.equal(await content.locator('.resource-usage').first().locator('pre').count(), 1);
  report.connectorKeyboardAndRetry = true;
  await screenshot('dark-connector.png');
  await page.evaluate(() => window.WeftDesktop.closePreview(false));
  await page.unroute('**/personal/v1/sessions/*/resources?*');
  await page.locator('#new-session').click();
  await until(async () => await page.locator('#message-text').isEnabled() && !(await page.locator('#transcript').innerText()).trim());
  await page.locator('#conversation-resources').click();
  await page.getByText('这段对话还没有生成输出内容。', { exact: true }).waitFor();
  report.conversationIsolationAndEmpty = true;
  if (capture) writeFileSync(join(evidence, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('UI-1c real desktop panel verification passed.');
} catch (error) {
  writeFileSync(join(root, 'failure.log'), output); console.error(`Isolated diagnostic: ${root}`); throw error;
} finally { await application?.close().catch(() => {}); await new Promise(resolve => model.close(resolve)); }
