/** Production Electron/DSH and responsive remote UI; synthetic data/provider only. */
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';

const repository = resolve(import.meta.dirname, '../..');
const root = mkdtempSync(join(tmpdir(), 'weftmate-up3-synthetic-'));
const profile = join(root, 'profile'), evidence = join(repository, 'tests/evidence/up-3');
mkdirSync(profile); mkdirSync(evidence, { recursive: true });
writeFileSync(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const username = `up3-${randomUUID()}`, password = `synthetic-${randomUUID()}-password`;
const backend = Object.fromEntries(['getStatus', 'listModels', 'preflight', 'createSession', 'sendMessage', 'cancelSession', 'readEvents', 'describeSession'].map(name => [name, async () => ({})]));
const prep = await createPersonalAccessService({ root: join(profile, 'personal-access'), port: 0, backend });
const started = await prep.start(), grant = await prep.issueSetupGrant();
const registered = await fetch(`${started.origin}/personal/v1/auth/setup`, { method: 'POST', headers: { origin: started.origin, 'content-type': 'application/json' }, body: JSON.stringify({ grant: grant.grant, username, password, deviceName: 'UP3 synthetic desktop' }) });
assert.equal(registered.status, 201); await prep.close();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let switching = false;
const provider = createServer(async (request, response) => {
  if (request.url === '/props') return response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ total_slots: 1, default_generation_settings: { n_ctx: 98304 } }));
  if (request.url === '/switch/status') return response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ switching }));
  if (request.url.endsWith('/models')) return response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'up3-synthetic', object: 'model' }] }));
  let raw = ''; for await (const part of request) raw += part;
  const input = JSON.parse(raw);
  if (!input.stream) return response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '合成回执' }, finish_reason: 'stop' }] }));
  switching = true; await pause(4500); switching = false;
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const chunk = (delta, finish_reason = null) => response.write(`data: ${JSON.stringify({ id: 'synthetic-stream', object: 'chat.completion.chunk', model: 'up3-synthetic', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  chunk({ role: 'assistant', reasoning_content: '合成思考阶段' }); await pause(4000);
  chunk({ content: '你好，合成测试已收到。' }); await pause(2000);
  chunk({}, 'stop'); response.end('data: [DONE]\n\n');
});
await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
const modelUrl = `http://127.0.0.1:${provider.address().port}/v1`;
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_)/.test(key) || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
let app, browser;
async function until(fn, ms = 90000) { const deadline = Date.now() + ms; while (Date.now() < deadline) { const value = await fn(); if (value) return value; await pause(100); } throw new Error('UP3 synthetic deadline'); }
async function api(page, path, body, method = body ? 'POST' : 'GET') {
  return page.evaluate(async ({ path, body, method }) => {
    const me = await (await fetch('/personal/v1/auth/me')).json();
    const response = await fetch('/personal/v1' + path, { method, headers: { 'content-type': 'application/json', 'x-weftmate-csrf': me.csrfToken }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  }, { path, body, method });
}
const report = { syntheticOnly: true, realElectron: true, realDsh: true, checks: [] };
try {
  app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: ['.', `--user-data-dir=${profile}`, '--personal-host', '--access-port=0'], cwd: repository, env, timeout: 90000 });
  const desktop = await app.firstWindow(); await desktop.waitForURL('**/personal/v1/ui', { timeout: 90000 });
  await localUiSession(desktop, { username, password }, 'UP3 synthetic desktop');
  const requestId = randomUUID();
  assert.equal((await api(desktop, '/account/models', { requestId, name: 'Synthetic Muse', baseUrl: modelUrl, modelId: 'up3-synthetic', apiKey: 'synthetic-key' })).status, 202);
  await until(async () => (await api(desktop, `/account/models/by-request/${requestId}`)).body.operation?.status === 'succeeded');
  const model = (await api(desktop, '/models')).body.models.find(row => row.name === 'Synthetic Muse'); assert.ok(model);
  browser = await chromium.launch({ headless: true });
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(desktop.url()); await localUiSession(mobile, { username, password }, 'UP3 synthetic mobile web');
  for (const [name, page] of [['desktop', desktop], ['mobile-web', mobile]]) {
    const created = await api(page, '/commands', { requestId: randomUUID(), kind: 'session.create', targetDeviceId: (await api(page, '/status')).body.hostId, modelProfileId: model.id });
    assert.equal(created.status, 202);
    const command = await until(async () => { const row = (await api(page, `/commands/${created.body.command.commandId}`)).body.command; return row.state === 'accepted_by_dsh' && row; });
    await until(() => page.locator(`[data-session-id="${command.sessionId}"] > button`).first().count());
    const rail = page.locator('#rail-open');
    await page.locator('#assistant-view').waitFor({ state: 'visible' });
    if (!(await page.locator(`[data-session-id="${command.sessionId}"] > button`).first().isVisible()) && await rail.isVisible()) await rail.click();
    await page.locator(`[data-session-id="${command.sessionId}"] > button`).first().click();
    await page.locator('#message-text').fill('你好'); await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByText('正在加载模型 Synthetic Muse…', { exact: true }).waitFor({ timeout: 20000 });
    assert.equal(await page.locator('.conversation-task').count(), 0);
    assert.equal(await page.locator('.queued-task').count(), 0);
    assert.equal(await page.getByRole('button', { name: /^停止(?:回复)?$/, exact: true }).isEnabled(), true);
    await page.screenshot({ path: join(evidence, `${name}-loading.png`) });
    await page.getByText('你好，合成测试已收到。', { exact: true }).waitFor({ timeout: 30000 });
    await until(async () => !(await api(page, '/sessions')).body.sessions.find(row => row.sessionId === command.sessionId)?.running);
    assert.equal(await page.locator('.conversation-task').count(), 0);
    await page.screenshot({ path: join(evidence, `${name}-reply.png`) });
    report.checks.push({ surface: name, loading: true, reply: true, emptyToolCards: 0, stopEnabledDuringWait: true });
  }
  writeFileSync(join(evidence, 'synthetic.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  await browser?.close(); await app?.close();
  provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve));
  rmSync(root, { recursive: true, force: true });
}
