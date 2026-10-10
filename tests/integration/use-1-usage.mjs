// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
/** Real Electron/DSH/MiMo, numeric-only evidence, ephemeral account/ports. */
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
import { normalizeUsage, usageCost, MIMO_PRICE } from '../../src/personal-access/usage.mjs';
import { usageResponse } from '../../src/personal-access/usage-response.mjs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

assert.ok(process.env.MIMO_API_KEY, 'MIMO_API_KEY must be supplied in process memory');
const key = process.env.MIMO_API_KEY;
const repo = resolve(import.meta.dirname, '../..'), evidence = join(repo, 'tests/evidence/use-1');
const root = await mkdtemp(join(tmpdir(), 'weft-use-1-')), profileDir = join(root, 'profile');
await mkdir(profileDir); await mkdir(evidence, { recursive: true });
await writeFile(join(profileDir, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const password = `Synthetic-Usage-${randomUUID()}`;
const backend = Object.fromEntries(['getStatus', 'listModels', 'preflight', 'createSession', 'sendMessage', 'cancelSession', 'readEvents', 'describeSession'].map(method => [method, async () => method === 'listModels' ? [] : {}]));
const prep = await createPersonalAccessService({ root: join(profileDir, 'personal-access'), port: 0, backend });
const prepared = await prep.start(), grant = await prep.issueSetupGrant();
const enrolled = await fetch(`${prepared.origin}/personal/v1/auth/setup`, { method: 'POST', headers: { origin: prepared.origin, 'content-type': 'application/json' }, body: JSON.stringify({ grant: grant.grant, username: 'UsageFixture', password, deviceName: 'Preparation' }) });
assert.equal(enrolled.status, 201); await prep.close();
const upstreamUsage = [], report = { realElectron: true, realDsh: true, realMiMo: true, isolatedAccount: true, checks: [] };
let app, desktop, browser, mobileServer, mobile;
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
    throw new Error('USE-1 condition timed out');
}
async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
    return desktop.evaluate(async ({ path, body, method }) => {
        const me = await (await fetch('/personal/v1/auth/me')).json();
        const response = await fetch(`/personal/v1${path}`, { method, headers: { 'content-type': 'application/json', 'x-weftmate-csrf': me.csrfToken }, body: body === undefined ? undefined : JSON.stringify(body) });
        return { status: response.status, body: await response.json() };
    }, { path, body, method });
}
async function nativeScreenshot(name) {
    const encoded = await app.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
        const win = BrowserWindow.getAllWindows().find(win => win.getTitle() === 'WeftMate'), handle = win.getNativeWindowHandle();
        const id = handle.length === 8 ? handle.readBigUInt64LE().toString() : handle.readUInt32LE().toString();
        const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1600, height: 1200 } });
        return sources.find(source => source.id.split(':')[1] === id).thumbnail.toPNG().toString('base64');
    });
    await writeFile(join(evidence, name), Buffer.from(encoded, 'base64'));
}
try {
    app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: ['.', `--user-data-dir=${profileDir}`, '--personal-host', '--access-port=0'], cwd: repo, env, timeout: 90000 });
    desktop = await app.firstWindow(); desktop.setDefaultTimeout(60000);
    await desktop.waitForURL('**/personal/v1/ui');
    const pageErrors = []; desktop.on('pageerror', error => pageErrors.push(error.message));
    await desktop.getByRole('textbox', { name: '账户名', exact: true }).fill('UsageFixture');
    await desktop.getByLabel('密码', { exact: true }).filter({ visible: true }).fill(password);
    await desktop.getByRole('textbox', { name: '这台设备的名称', exact: true }).fill('USE-1 Electron');
    await desktop.getByRole('button', { name: '登录', exact: true }).click();
    await desktop.getByRole('button', { name: /新对话/ }).waitFor();
    const model = await api('/account/models', { requestId: 'usage-model', name: 'MiMo 用量验收', baseUrl: `http://127.0.0.1:${proxy.address().port}/v1`, modelId: 'mimo-v2.6-flash', modelTier: 'cloud', apiKey: 'synthetic-proxy-key' });
    assert.equal(model.status, 202);
    const operation = await until(async () => { const value = await api('/account/models/by-request/usage-model'); return value.body.operation?.status === 'succeeded' && value.body; });
    const profileId = operation.model?.profileId ?? operation.model?.runtimeProfileId;
    console.log('USE-1 model configured');
    await desktop.reload();
    await desktop.getByRole('button', { name: /新对话/ }).click();
    const composer = desktop.getByRole('textbox', { name: '输入消息', exact: true });
    await until(() => composer.isEnabled());
    for (let turn = 1; turn <= 2; turn++) {
        await composer.fill(`只回复“用量核对${turn}”，不要调用工具。`);
        await desktop.getByRole('button', { name: '发送', exact: true }).click();
        await desktop.getByText(`用量核对${turn}`, { exact: true }).first().waitFor({ timeout: 180000 });
        await until(async () => { const value = await api('/usage'); return value.body.total?.requests >= turn && value.body.total.unknownRequests === 0; });
    }
    // Wait for native title requests and accounting completion, then compare provider totals.
    await until(async () => { const value = await api('/usage'); return value.body.total?.requests === upstreamUsage.length && value.body.total.unknownRequests === 0; });
    const summary = (await api('/usage')).body;
    const providerTotal = upstreamUsage.reduce((sum, row) => { assert.ok(row); for (const field of ['inputTokens', 'cachedInputTokens', 'outputTokens']) sum[field] += row[field]; sum.cost = Math.round((sum.cost + usageCost(row, MIMO_PRICE)) * 1e9) / 1e9; return sum; }, { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, cost: 0 });
    for (const field of Object.keys(providerTotal)) assert.equal(summary.total[field], providerTotal[field], field);
    report.checks.push('native ledger equals actual MiMo usage/cache/cost');
    await desktop.getByRole('button', { name: '本对话用量', exact: true }).click();
    await desktop.getByRole('heading', { name: '本对话用量', exact: true }).waitFor(); await nativeScreenshot('01-conversation.png');
    await desktop.getByRole('button', { name: '关闭设置', exact: true }).click();
    await desktop.getByRole('button', { name: /UsageFixture/ }).click();
    await desktop.getByRole('button', { name: '设置', exact: true }).click();
    await desktop.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '用量', exact: true }).click();
    await desktop.getByRole('heading', { name: '用量与费用', exact: true }).waitFor();
    await nativeScreenshot('02-desktop.png');
    await desktop.getByRole('spinbutton', { name: '月度上限（元）', exact: true }).fill('0.000000001');
    await desktop.getByRole('button', { name: '保存月度上限', exact: true }).click();
    await desktop.getByRole('alert').filter({ hasText: '本月用量已达到上限' }).waitFor();
    await desktop.getByRole('alert').filter({ hasText: '本月用量已达到上限' }).scrollIntoViewIfNeeded(); await nativeScreenshot('03-limit.png');
    const sessions = (await api('/sessions')).body.sessions;
    const before = upstreamUsage.length;
    const hostId = (await api('/status')).body.hostId;
    const denied = await api('/commands', { requestId: 'usage-refused', kind: 'session.message', targetDeviceId: hostId, sessionId: sessions[0].sessionId, text: '此请求必须在发出前被拒绝。' });
    assert.equal(denied.status, 402, JSON.stringify(denied.body)); assert.equal(denied.body.error.code, 'USAGE_LIMIT_REACHED'); assert.equal(upstreamUsage.length, before);
    report.checks.push('100% refused before upstream; visible recovery copy');
    await desktop.getByRole('spinbutton', { name: '仅本月临时上限（元）', exact: true }).fill('1');
    await desktop.getByRole('button', { name: '保存月度上限', exact: true }).click();
    await until(async () => (await api('/usage')).body.budget.state === 'ok'); report.checks.push('temporary month increase restores cloud allowance');
    assert.deepEqual(pageErrors, []);
    // Load the actual bundled mobile interface, using the same native bridge protocol
    // to authenticate and forward every business request to this isolated real host.
    let cookie = '', csrf = '', nativeLogin;
    const origin = new URL(desktop.url()).origin;
    async function mobileApi(path, method = 'GET', body) {
        const response = await fetch(origin + path, { method, headers: { origin, cookie, 'content-type': 'application/json', ...(csrf ? { 'x-weftmate-csrf': csrf } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
        const value = await response.json(); if (!response.ok) throw Object.assign(new Error(value.error?.code || 'REQUEST_FAILED'), { status: response.status });
        if (response.headers.getSetCookie().length) cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
        if (value.csrfToken) csrf = value.csrfToken; return value;
    }
    nativeLogin = await mobileApi('/personal/v1/auth/login', 'POST', { username: 'UsageFixture', password, deviceName: 'USE-1 Mobile' });
    const accountProfile = () => ({ loggedIn: true, ...nativeLogin.account, device: nativeLogin.device, deviceId: nativeLogin.device.id, owner: nativeLogin.account.ownerId, connectionVerified: true, backgroundSync: 'scheduled' });
    mobileServer = createServer(async (request, response) => {
        try { const pathname = new URL(request.url, 'http://localhost').pathname; const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
            assert.ok(!relative.includes('..')); const file = await readFile(join(repo, 'apps/mobile-ui/www', relative));
            response.writeHead(200, { 'content-type': ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' })[extname(relative)] || 'application/octet-stream' }); response.end(file);
        } catch { response.writeHead(404).end(); }
    });
    await new Promise(resolve => mobileServer.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch(); const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    mobile = await context.newPage();
    await mobile.exposeFunction('usageBridge', async ({ method, params = {} }) => {
        if (method === 'app.bootstrap') return { ...accountProfile(), model: null, busy: false, ui: { activeVersion: 'fixture' } };
        if (method === 'auth.me') return accountProfile();
        if (method === 'auth.state') return mobileApi('/personal/v1/auth/state');
        if (method === 'host.business') return mobileApi(params.path, params.method, params.body);
        if (method === 'shared.sessions.list') return { ...(await mobileApi('/personal/v1/sessions')), hostAvailable: true, source: 'host' };
        if (method === 'conversations.list') return { conversations: [], source: 'phone' };
        if (method === 'attachments.list') return { attachments: [] };
        if (method === 'settings.appearance') return { value: 'system' };
        if (method === 'updates.state') return { activeVersion: 'fixture' };
        if (method === 'events.subscribe' || method === 'app.ready' || method === 'app.draft') return {};
        return {};
    });
    await mobile.addInitScript(() => { window.weftNative = { postMessage: raw => { const request = JSON.parse(raw); window.usageBridge(request).then(result => window.weftNative.onmessage({ data: JSON.stringify({ id: request.id, ok: true, result }) }), error => window.weftNative.onmessage({ data: JSON.stringify({ id: request.id, ok: false, error: { code: error.message } }) })); } }; });
    await mobile.goto(`http://127.0.0.1:${mobileServer.address().port}/`);
    await mobile.getByRole('button', { name: '设置与账户', exact: true }).click();
    await mobile.getByRole('button', { name: /用量本月费用|用量.*本月/ }).click();
    await mobile.getByRole('heading', { name: '用量与费用', exact: true }).waitFor();
    await mobile.getByText(`本月合计 ${new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 8 }).format(summary.total.cost).replace(/^/, '¥')} · ${summary.total.requests} 次请求`, { exact: true }).waitFor();
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await mobile.screenshot({ path: join(evidence, '04-mobile.png'), fullPage: true }); report.checks.push('actual mobile bundle shows same host usage; no horizontal overflow');
    await mobile.getByText('模型单价（元 / 百万 token）', { exact: true }).click();
    assert.equal(await mobile.getByRole('spinbutton', { name: '缓存输入', exact: true }).inputValue(), '0.02');
    assert.equal(await mobile.getByRole('spinbutton', { name: '未缓存输入', exact: true }).inputValue(), '1');
    assert.equal(await mobile.getByRole('spinbutton', { name: '输出', exact: true }).inputValue(), '2');
    await mobile.getByRole('button', { name: '保存单价', exact: true }).scrollIntoViewIfNeeded();
    await mobile.screenshot({ path: join(evidence, '05-mobile-prices.png') }); report.checks.push('mobile price/limit controls use real account settings and MiMo official preset');
    report.providerUsage = providerTotal; report.requests = upstreamUsage.length; report.month = summary.month;
    await writeFile(join(evidence, 'verification.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
} finally {
    const costs = join(repo, '.local/use-1-costs.json'); await mkdir(join(repo, '.local'), { recursive: true });
    const attempts = JSON.parse(await readFile(costs, 'utf8').catch(() => '[]'));
    attempts.push({ at: new Date().toISOString(), requests: upstreamUsage.length, usage: upstreamUsage,
      cost: Math.round(upstreamUsage.reduce((sum, row) => sum + (usageCost(row, MIMO_PRICE) ?? 0), 0) * 1e9) / 1e9 });
    await writeFile(costs, JSON.stringify(attempts, null, 2));
    await browser?.close(); await app?.close();
    await new Promise(resolve => proxy.close(resolve));
    if (mobileServer) await new Promise(resolve => mobileServer.close(resolve));
    // Scope is this script's newly-created temporary directory only.
    assert.ok(root.startsWith(join(tmpdir(), 'weft-use-1-'))); await rm(root, { recursive: true, force: true });
}
