// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
/** Real Electron/DSH/MiMo, numeric-only evidence, ephemeral account/ports. */
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
import { normalizeUsage, usageCost, MIMO_PRICE } from '../../src/personal-access/usage.mjs';
import { usageResponse } from '../../src/personal-access/usage-response.mjs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

assert.ok(process.env.MIMO_API_KEY, 'MIMO_API_KEY must be supplied in process memory');
const key = process.env.MIMO_API_KEY;
const repo = resolve(import.meta.dirname, '../..'), evidence = join(repo, 'tests/evidence/sch-1');
const root = await mkdtemp(join(tmpdir(), 'weft-sch-1-')), profileDir = join(root, 'profile');
await mkdir(profileDir); await mkdir(evidence, { recursive: true });
await writeFile(join(profileDir, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const password = `Synthetic-Usage-${randomUUID()}`;
const backend = Object.fromEntries(['getStatus', 'listModels', 'preflight', 'createSession', 'sendMessage', 'cancelSession', 'readEvents', 'describeSession'].map(method => [method, async () => method === 'listModels' ? [] : {}]));
const prep = await createPersonalAccessService({ root: join(profileDir, 'personal-access'), port: 0, backend });
const prepared = await prep.start(), grant = await prep.issueSetupGrant();
const enrolled = await fetch(`${prepared.origin}/personal/v1/auth/setup`, { method: 'POST', headers: { origin: prepared.origin, 'content-type': 'application/json' }, body: JSON.stringify({ grant: grant.grant, username: 'ScheduleFixture', password, deviceName: 'Preparation' }) });
assert.equal(enrolled.status, 201); await prep.close();
const upstreamUsage = [], report = { realElectron: true, realDsh: true, realMiMo: true, isolatedAccount: true, checks: [] };
let app, desktop;
const proxy = createServer(async (request, response) => {
    try {
        if (request.url === '/v1/models') { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ data: [{ id: 'mimo-v2.6-flash', object: 'model' }] })); return; }
        if (request.url !== '/v1/chat/completions') { response.writeHead(404).end(); return; }
        let body = ''; for await (const part of request) body += part;
        const input = JSON.parse(body);
        // Include the provider's real cache details; preserve all native request fields.
        if (input.stream) input.stream_options = { ...input.stream_options, include_usage: true };
        const upstream = await fetch('https://api.xiaomimimo.com/v1/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(input) });
        const observed = await usageResponse(upstream, value => { upstreamUsage.push(normalizeUsage(value)); });
        response.writeHead(observed.status, { 'content-type': observed.headers.get('content-type') ?? 'application/json' });
        await pipeline(Readable.fromWeb(observed.body), response);
    } catch { response.destroy(); }
});
await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
const env = { ...process.env };
for (const name of Object.keys(env)) if (name.startsWith('WEFTMATE_') || name.startsWith('MEMOWEFT_') || ['ELECTRON_RUN_AS_NODE', 'MIMO_API_KEY'].includes(name)) delete env[name];
env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
async function until(read, timeout = 180000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { const value = await read(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 300)); }
    throw new Error('SCH-1 condition timed out');
}
async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
    return desktop.evaluate(async ({ path, body, method }) => {
        const me = await (await fetch('/personal/v1/auth/me')).json();
        const response = await fetch(`/personal/v1${path}`, { method, headers: { 'content-type': 'application/json', 'x-weftmate-csrf': me.csrfToken }, body: body === undefined ? undefined : JSON.stringify(body) });
        return { status: response.status, body: await response.json() };
    }, { path, body, method });
}
async function nativeScreenshot(name) {
    // Capture the real Electron window directly. Desktop source enumeration on
    // Windows can stall when another application's compositor is busy.
    const capture = app.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find(win => win.getTitle() === 'WeftMate');
        const content = await win.webContents.capturePage();
        return content.toPNG().toString('base64');
    });
    let timer;
    const encoded = await Promise.race([capture, new Promise(resolve => { timer = setTimeout(() => resolve(null), 10000); })]);
    clearTimeout(timer);
    report.screenshots ??= [];
    if (encoded) { await writeFile(join(evidence, name), Buffer.from(encoded, 'base64')); report.screenshots.push({ name, realElectron: true, nativeFrame: false }); }
    else { report.screenshots.push({ name, captureTimedOut: true }); console.log(`Window capture timed out: ${name}; functional checks continue`); }
}

async function launch() {
    app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: ['--disable-gpu', '.', `--user-data-dir=${profileDir}`, '--personal-host', '--access-port=0'], cwd: repo, env, timeout: 90000 });
    app.process().stdout?.on('data', data => { const value = String(data); if (/schedule|error|failed/i.test(value)) console.log(value.replaceAll(key, '[redacted]')); });
    app.process().stderr?.on('data', data => { const value = String(data); if (/schedule|error|failed/i.test(value)) console.log(value.replaceAll(key, '[redacted]')); });
    desktop = await app.firstWindow(); desktop.setDefaultTimeout(60000);
    await desktop.waitForURL('**/personal/v1/ui');
    await app.evaluate(({ app }) => {
        globalThis.schNotifications = []; globalThis.schShown = [];
        app.on('weftmate-desktop-notification', event => globalThis.schNotifications.push(event));
        app.on('weftmate-desktop-notification-shown', event => globalThis.schShown.push(event));
    });
    const offlineButton = desktop.getByRole('button', { name: '离线使用这台电脑', exact: true });
    if (await offlineButton.isVisible()) {
        await offlineButton.click();
        const account = desktop.getByRole('textbox', { name: '本地账户名', exact: true });
        if (await account.isVisible()) await account.fill('ScheduleFixture');
        await desktop.getByLabel('离线密码', { exact: true }).filter({ visible: true }).fill(password);
        await desktop.getByRole('button', { name: '登录', exact: true }).click();
    }
    await desktop.getByRole('button', { name: '新对话 Ctrl N', exact: true }).waitFor();
}
async function schedules() { const value = await api('/schedules'); assert.equal(value.status, 200, JSON.stringify(value)); return value.body.items; }
async function send(text) {
    const back = desktop.getByRole('button', { name: '关闭设置', exact: true });
    if (await back.isVisible()) await back.click();
    const composer = desktop.getByRole('textbox', { name: '输入消息', exact: true });
    await until(() => composer.isEnabled()); await composer.fill(text);
    await desktop.getByRole('button', { name: '发送', exact: true }).click();
}
try {
    await launch();
    const pageErrors = []; desktop.on('pageerror', error => pageErrors.push(error.message));
    const model = await api('/account/models', { requestId: 'schedule-model', name: 'MiMo 定时验收', baseUrl: `http://127.0.0.1:${proxy.address().port}/v1`, modelId: 'mimo-v2.6-flash', modelTier: 'cloud', apiKey: 'synthetic-proxy-key' });
    assert.equal(model.status, 202);
    await until(async () => { const value = await api('/account/models/by-request/schedule-model'); return value.body.operation?.status === 'succeeded'; });
    await desktop.reload();
    await api('/settings/usage', { timeZone: 'Asia/Shanghai' }, 'PATCH');
    await desktop.getByRole('button', { name: '新对话 Ctrl N', exact: true }).click();
    await send('请在 65 秒后提醒我交 SCH-1 报告，只是提醒，不要执行其他工作。');
    const reminder = await until(async () => (await schedules()).find(row => row.text.includes('SCH-1') && row.kind === 'reminder'));
    console.log('Reminder created');
    await until(async () => { const value = await api('/notifications'); return value.body.items?.some(row => row.text.includes('SCH-1')); }, 180000);
    await desktop.getByText(/提醒：.*SCH-1/, { exact: false }).first().waitFor();
    await until(async () => (await app.evaluate(() => globalThis.schShown)).some(row => row.type === 'assistant.message'));
    report.checks.push('MiMo conversation creates native reminder; native system notification shown and durable conversation message');
    await nativeScreenshot('01-reminder.png');
    await send('明天早上 9 点提醒我交 SCH-1 明日报告，只提醒。');
    const tomorrow = await until(async () => (await schedules()).find(row => row.text.includes('明日报告')));
    const localTarget = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(tomorrow.nextRunAt));
    assert.equal(localTarget, '09:00');
    await send('取消明天交 SCH-1 明日报告的提醒。');
    await until(async () => !(await schedules()).some(row => row.id === tomorrow.id));
    report.checks.push('natural tomorrow 09:00 uses account zone; conversation cancellation deletes exact schedule');

    await send('请在 65 秒后开始执行，之后每周一早上 8 点执行一次：在本对话目录新建 sch-1-weekly.txt，内容写“本周验收完成”。这是定时任务，现在不要写文件，建立任务后一句话确认。');
    const task = await until(async () => (await schedules()).find(row => row.kind === 'task' && row.text.includes('sch-1-weekly.txt')));
    assert.equal(task.repeat.kind, 'weekly'); assert.equal(task.repeat.weekday, 1);
    console.log('Recurring task created');
    await until(async () => { const value = await api(`/sessions/${task.sessionId}/resources`); return value.body.outputs?.some(row => row.fileName === 'sch-1-weekly.txt'); }, 240000);
    const taskRows = await schedules(); assert.ok(taskRows.find(row => row.id === task.id).nextRunAt);
    report.checks.push('calendar recurrence executes through original conversation and creates registered file; next local occurrence exists');
    const backFromSettings = desktop.getByRole('button', { name: '关闭设置', exact: true });
    if (await backFromSettings.isVisible()) await backFromSettings.click();
    await nativeScreenshot('02-periodic-file.png');
    if (!(await desktop.getByRole('button', { name: '提醒与定时任务', exact: true }).isVisible())) {
        await desktop.getByRole('button', { name: '账户菜单', exact: true }).click();
        await desktop.getByRole('button', { name: '设置', exact: true }).click();
    }
    await desktop.getByRole('button', { name: '提醒与定时任务', exact: true }).click();
    const taskItem = desktop.getByRole('listitem', { name: task.text, exact: true });
    await taskItem.getByRole('button', { name: '暂停', exact: true }).click();
    await until(async () => (await schedules()).find(row => row.id === task.id)?.state === 'paused');
    await nativeScreenshot('03-management.png');
    await taskItem.getByRole('button', { name: '恢复', exact: true }).click();
    await until(async () => (await schedules()).find(row => row.id === task.id)?.state === 'scheduled');
    await taskItem.getByRole('button', { name: '删除', exact: true }).click();
    await until(async () => !(await schedules()).some(row => row.id === task.id));
    report.checks.push('management uses visible names/roles: pause, resume, delete');
    await desktop.getByRole('button', { name: '关闭设置', exact: true }).click();
    await send('请在 65 秒后提醒我检查 SCH-1 离线补发，只提醒。');
    const offline = await until(async () => (await schedules()).find(row => row.text.includes('离线补发')));
    await until(async () => { const value = await api('/sessions'); return value.body.sessions.find(row => row.sessionId === offline.sessionId)?.running === false; });
    await app.close(); app = null;
    const due = Date.parse(offline.nextRunAt);
    const waitMs = Math.max(0, due + 65000 - Date.now());
    console.log(`Host offline; wait ${Math.ceil(waitMs / 1000)} seconds for missed occurrence`);
    const waitDeadline = Date.now() + waitMs;
    while (Date.now() < waitDeadline) await new Promise(resolve => setTimeout(resolve, Math.min(1000, waitDeadline - Date.now())));
    await launch();
    await until(async () => { const value = await api('/notifications'); return value.body.items?.some(row => row.text.includes('离线补发') && row.missed); });
    await desktop.getByRole('button', { name: '新对话 Ctrl N', exact: true }).waitFor();
    await until(async () => { const value = await api(`/sessions/${offline.sessionId}/events?afterSeq=-1&limit=100`); return value.body.events?.some(row => row.data?.reminder && row.data.text.includes('错过了') && row.data.text.includes('离线补发')); });
    await nativeScreenshot('04-offline-catchup.png');
    await app.close(); app = null; await launch();
    const notifications = await api('/notifications');
    assert.equal(notifications.body.items.filter(row => row.text.includes('离线补发')).length, 1);
    report.checks.push('real host shutdown crosses target; restart catches up with missed time; second restart does not duplicate');
    assert.deepEqual(pageErrors, []);
    report.usage = upstreamUsage; report.cost = Math.round(upstreamUsage.reduce((sum, row) => sum + (usageCost(row, MIMO_PRICE) ?? 0), 0) * 1e9) / 1e9;
    await writeFile(join(evidence, 'verification.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
 } catch (error) {
    const diagnostic = { error: error.message, checks: report.checks };
    try {
      diagnostic.schedules = (await api('/schedules')).body;
      diagnostic.commands = (await api('/commands?limit=20')).body;
      diagnostic.alerts = await desktop.getByRole('alert').allTextContents();
      const sessions = (await api('/sessions')).body.sessions;
      diagnostic.timeline = (await api(`/sessions/${sessions[0].sessionId}/events?limit=50`)).body;
      await writeFile(join(repo, '.local/sch-1-last-failure.json'), JSON.stringify(diagnostic, null, 2));
    } catch { /* Preserve the original validation failure. */ }
    throw error;
} finally {
    const costs = join(repo, '.local/sch-1-costs.json'); await mkdir(join(repo, '.local'), { recursive: true });
    const attempts = JSON.parse(await readFile(costs, 'utf8').catch(() => '[]'));
    attempts.push({ at: new Date().toISOString(), requests: upstreamUsage.length, usage: upstreamUsage,
      cost: Math.round(upstreamUsage.reduce((sum, row) => sum + (usageCost(row, MIMO_PRICE) ?? 0), 0) * 1e9) / 1e9 });
    await writeFile(costs, JSON.stringify(attempts, null, 2));
    await app?.close(); await new Promise(resolve => proxy.close(resolve));
    assert.ok(root.startsWith(join(tmpdir(), 'weft-sch-1-'))); await rm(root, { recursive: true, force: true });
}
