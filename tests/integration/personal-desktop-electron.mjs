/** Real Windows Electron + real pinned DSH, isolated account and loopback model only. */
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
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
const root = mkdtempSync(join(tmpdir(), 'weftmate-w1-'));
const profile = join(root, 'profile'); mkdirSync(profile);
writeFileSync(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const repository = resolve(import.meta.dirname, '../..');
const evidence = join(repository, 'tests/evidence/w1'); mkdirSync(evidence, { recursive: true });
const password = `synthetic-${randomUUID()}-password`;
// Prepare an existing test account through the ordinary registration API, then log in in the program.
const backend = Object.fromEntries(['getStatus', 'listModels', 'preflight', 'createSession', 'sendMessage', 'cancelSession', 'readEvents', 'describeSession']
  .map(method => [method, async () => method === 'listModels' ? [] : {}]));
const preparation = await createPersonalAccessService({ root: join(profile, 'personal-access'), port: 0, backend });
const prepared = await preparation.start();
const setup = await preparation.issueSetupGrant();
const registered = await fetch(`${prepared.origin}/personal/v1/auth/setup`, { method: 'POST',
  headers: { origin: prepared.origin, 'content-type': 'application/json' },
  body: JSON.stringify({ grant: setup.grant, username: 'W1Fixture', password, deviceName: 'Preparation' }) });
assert.equal(registered.status, 201); await preparation.close();
let tools = [], workflowCalls = 0, questionCalls = 0;
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
      params: { path: join(profile, 'workspace', 'approval.txt') } }; }
    else if (workflowCalls === 2) { tool = 'personal_save_document'; args = { fileName: 'w1-result.txt', content: 'W1 synthetic desktop artifact' }; }
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
try {
  await start();
  await page.locator('#login-view').waitFor({ state: 'visible' });
  await screenshot('01-login.png');
  await page.fill('#login-name', 'W1Fixture'); await page.fill('#login-password', password); await page.fill('#login-device', 'W1 Electron');
  await page.locator('#login-form button[type=submit]').click();
  await page.locator('#assistant-view').waitFor({ state: 'visible' }); report.login = true;
  const configured = await api('/account/models', { requestId: 'w1-model', name: 'W1 Synthetic', baseUrl: `http://127.0.0.1:${model.address().port}/v1`,
    modelId: 'w1-synthetic-model', apiKey: 'synthetic-no-secret' });
  assert.equal(configured.status, 202, JSON.stringify(configured.body));
  const operation = await until(async () => { const value = await api('/account/models/by-request/w1-model');
    return !['pending', 'applying'].includes(value.body.operation?.status) && value.body; });
  assert.equal(operation.operation.status, 'succeeded', JSON.stringify(operation));
  await page.reload(); await page.locator('#new-session').click();
  await page.locator('#message-text').waitFor({ state: 'visible' });
  await until(() => page.locator('#message-text').isEnabled());
  await page.fill('#message-text', 'W1_APPROVAL：写入合成文件并保存成果，然后告诉我完成了。');
  await page.locator('#send-message').click();
  console.log('Message submitted');
  await until(() => application.evaluate(() => globalThis.w1Notifications.some(event => event.type === 'approval.requested')));
  await page.getByRole('button', { name: /允许(?:一次|本次)/ }).first().waitFor();
  await page.getByRole('button', { name: /允许(?:一次|本次)/ }).first().scrollIntoViewIfNeeded();
  await screenshot('02-approval.png'); report.approvalNotification = true;
  await page.getByRole('button', { name: /允许(?:一次|本次)/ }).first().click();
  await until(() => application.evaluate(() => globalThis.w1Notifications.some(event => event.type === 'turn.ended')));
  await page.getByText('W1 合成模型已完成，真实程序时间线验证通过。', { exact: true }).first().waitFor();
  await page.getByText('W1 合成模型已完成，真实程序时间线验证通过。', { exact: true }).first().scrollIntoViewIfNeeded();
  report.timeline = true; report.completionNotification = true;
  await screenshot('03-timeline.png');
  await application.evaluate(({ shell }) => {
    globalThis.w1NativeFiles = [];
    const open = shell.openPath, reveal = shell.showItemInFolder;
    shell.openPath = async path => { const error = await open(path); globalThis.w1NativeFiles.push({ action: 'open', path, error }); return error; };
    shell.showItemInFolder = path => { reveal(path); globalThis.w1NativeFiles.push({ action: 'show', path }); };
  });
  await page.getByRole('button', { name: '用默认程序打开', exact: true }).first().click();
  await page.getByRole('button', { name: '在文件夹中显示', exact: true }).first().click();
  const files = await until(() => application.evaluate(() => globalThis.w1NativeFiles.length === 2 && globalThis.w1NativeFiles));
  assert.equal(readFileSync(files[0].path, 'utf8'), 'W1 synthetic desktop artifact');
  assert.equal(files[0].error, ''); report.nativeArtifactBridge = true; report.realNativeFileCalls = true;
  assert.equal(await page.evaluate(async () => { try { await window.weftmateDesktop.artifact('../outside.txt', 'open'); return false; } catch { return true; } }), true);
  const firstSession = (await api('/sessions')).body.sessions[0].sessionId;
  await page.locator('#new-session').click();
  await until(() => page.locator('#message-text').isEnabled());
  await page.fill('#message-text', 'W1_QUESTION：先问我一个合成问题，收到回答后完成。');
  await page.locator('#send-message').click();
  await until(() => application.evaluate(() => globalThis.w1Notifications.some(event => event.type === 'question.asked')));
  await page.getByRole('button', { name: '提交回答', exact: true }).first().waitFor();
  await page.getByRole('button', { name: '提交回答', exact: true }).first().scrollIntoViewIfNeeded();
  await screenshot('05-question.png'); report.questionNotification = true;
  await page.getByText('继续', { exact: true }).last().click();
  await page.getByRole('button', { name: '提交回答', exact: true }).first().click();
  await until(() => application.evaluate(() => globalThis.w1Notifications.filter(event => event.type === 'turn.ended').length === 2));
  const before = await application.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(win => win.getTitle() === 'WeftMate'); win.setBounds({ x: 80, y: 80, width: 1080, height: 760 }); win.close();
    return { id: win.id, visible: win.isVisible() };
  }); assert.equal(before.visible, false); assert.equal(application.process().exitCode, null); report.closeToTray = true;
  await until(() => application.evaluate(() => !!globalThis.w1Tray));
  const tray = await application.evaluate(({ BrowserWindow }) => {
    globalThis.w1Tray.emit('click');
    return { visible: BrowserWindow.getAllWindows().find(win => win.getTitle() === 'WeftMate').isVisible(),
      labels: globalThis.w1TrayMenu.items.map(item => item.label) };
  });
  assert.equal(tray.visible, true); assert.ok(tray.labels.includes('打开 WeftMate')); assert.ok(tray.labels.includes('退出')); report.trayOpen = true;
  assert.ok(tray.labels.some(label => label.includes('模型：W1 Synthetic'))); report.trayModelStatus = true;
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle() === 'WeftMate').hide());
  const second = spawn(executablePath, args, { cwd: repository, env, windowsHide: true, stdio: 'ignore' });
  assert.equal(await new Promise(resolve => second.once('exit', resolve)), 0);
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle() === 'WeftMate').id), before.id);
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle() === 'WeftMate').isVisible()), true);
  report.singleInstance = true;
  await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find(win => win.getTitle() === 'WeftMate').hide();
    globalThis.w1NativeNotifications[0].emit('click'); });
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle() === 'WeftMate').isVisible()), true);
  report.notificationClick = true;
  await until(() => page.getByText('W1_APPROVAL：写入合成文件并保存成果，然后告诉我完成了。', { exact: true }).isVisible());
  assert.equal(await application.evaluate(() => globalThis.w1Notifications[0].sessionId), firstSession); report.notificationConversation = true;
  report.nativeNotificationShown = await application.evaluate(() => globalThis.w1Shown.map(event => event.type));
  assert.ok(report.nativeNotificationShown.includes('approval.requested'));
  assert.ok(report.nativeNotificationShown.includes('question.asked'));
  assert.ok(report.nativeNotificationShown.includes('turn.ended'));
  await page.locator('#show-account').click(); await page.locator('#desktop-auto-start').waitFor();
  await page.locator('#desktop-auto-start').check();
  const loginOptions = await application.evaluate(() => globalThis.w1LoginOptions);
  assert.equal(loginOptions.openAtLogin, true); assert.ok(loginOptions.args.includes('--start-in-tray'));
  assert.ok(loginOptions.args.includes(`--user-data-dir=${profile}`));
  await page.locator('#desktop-auto-start').uncheck();
  report.startupSetting = true; report.startupRegistryIntercepted = true; await screenshot('04-settings.png');
  await application.close(); application = null;
  const expectedBounds = JSON.parse(readFileSync(join(profile, 'desktop-window.json'), 'utf8')).bounds;
  writeFileSync(join(profile, 'desktop-window.json'), JSON.stringify({ bounds: expectedBounds, maximized: true }));
  await start(['--start-in-tray']);
  await page.locator('#assistant-view').waitFor({ state: 'visible' }); report.persistentLogin = true;
  const restored = await application.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(win => win.getTitle() === 'WeftMate'); return { visible: win.isVisible(), bounds: win.getBounds() };
  });
  assert.equal(restored.visible, false);
  for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(restored.bounds[key] - expectedBounds[key]) <= 2,
    `Restored ${key} must match the saved bounds within fractional Windows DPI rounding`);
  report.boundsRestored = true; report.startInTray = true;
  await application.evaluate(({ app }) => app.emit('second-instance'));
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle() === 'WeftMate').isMaximized()), true);
  report.maximizedTrayStartup = true;
  await application.close(); application = null;
  application = await _electron.launch({ executablePath, args: [...args, '--headless'], cwd: repository, env, timeout: 90000 });
  await until(() => JSON.parse(readFileSync(join(profile, 'dsh-home/weftmate-host-state.json'), 'utf8')).personalAccess.state === 'listening');
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 0); report.headless = true;
  await application.close(); application = null;
  const firstRunProfile = join(root, 'first-run-profile'); mkdirSync(firstRunProfile);
  writeFileSync(join(firstRunProfile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
  application = await _electron.launch({ executablePath, args: ['.', `--user-data-dir=${firstRunProfile}`], cwd: repository, env, timeout: 90000 });
  page = await application.firstWindow({ timeout: 90000 });
  await page.locator('#setup-form').waitFor({ state: 'visible' });
  assert.ok((await page.locator('#setup-title').textContent()).includes('原账户')); report.defaultDesktopFirstRun = true;
  writeFileSync(join(evidence, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} catch (error) {
  if (page && !page.isClosed()) {
    console.log('Conversation status:', JSON.stringify(await api('/sessions')));
    const sessions = (await api('/sessions')).body.sessions || [];
    if (sessions[0]) console.log('Event types:', JSON.stringify((await api(`/sessions/${sessions[0].sessionId}/events?afterSeq=-1&limit=200`)).body));
  }
  writeFileSync(join(root, 'failure.log'), output); console.error(`Isolated diagnostic: ${root}`); console.error('Advertised tools:', tools);
  throw error;
} finally { await application?.close().catch(() => {}); await new Promise(resolve => model.close(resolve)); }
