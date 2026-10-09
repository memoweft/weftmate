/** Real product entry + real DSH; synthetic held SSE model, local signed update source. */
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { generateKeyPairSync, createPublicKey, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { keyId } from '../../src/personal-update/manifest.mjs';
import { packageRelease } from '../../scripts/release/package.mjs';
import { personalAccessUiResources } from '../../src/personal-access-ui/index.mjs';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';

const repository = resolve(import.meta.dirname, '../..');
const evidence = join(repository, 'tests/evidence/upd-1'); await mkdir(evidence, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'weftmate-upd-1-'));
const profile = join(root, 'profile'); await mkdir(profile);
await writeFile(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const feedDir = join(root, 'feed');
const privateKey = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
const keysFile = join(root, 'keys.json'); await writeFile(keysFile, JSON.stringify({ [keyId(publicKey)]: publicKey }));
const transfers = [], modelRequests = [];
let target = null, released = false, application, page, browser;
const model = createServer(async (req, res) => {
  console.log('UPD-1 provider:', req.method, req.url);
  if (req.url === '/props') return res.end(JSON.stringify({ n_ctx: 98304, total_slots: 1 }));
  if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'upd-1-synthetic', object: 'model' }] }));
  if (req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return; }
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw); const background = !(body.tools?.length);
  console.log('UPD-1 provider request:', body.model, { background, stream: body.stream });
  const record = { background, closed: false, completed: false }; modelRequests.push(record);
  res.on('close', () => { record.closed = true; });
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const write = (content, finish = null) => res.write(`data: ${JSON.stringify({ id: 'upd-1', object: 'chat.completion.chunk', model: body.model,
    choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: finish }] })}\n\n`);
  write(background ? '更新验证' : 'UPD-1 任务正在运行，等待完成信号。');
  record.complete = () => { record.completed = true; write(background ? '更新验证' : 'UPD-1 任务正常完成。', 'stop'); res.end('data: [DONE]\n\n'); };
  if (background || released) record.complete(); else target = record;
});
const feed = createServer(async (req, res) => {
  const name = new URL(req.url, 'http://127.0.0.1').pathname.slice(1);
  if (name.includes('..') || name.includes('%')) return res.writeHead(404).end();
  try { const bytes = await readFile(join(feedDir, name)); transfers.push({ path: name, bytes: bytes.length }); res.end(bytes); }
  catch { res.writeHead(404).end(); }
});
await Promise.all([new Promise(done => model.listen(0, '127.0.0.1', done)), new Promise(done => feed.listen(0, '127.0.0.1', done))]);
const feedUrl = `http://127.0.0.1:${feed.address().port}/manifest-ui.json`;
const env = { ...process.env };
for (const name of Object.keys(env)) if (name.startsWith('WEFTMATE_') || name.startsWith('MEMOWEFT_') || name === 'ELECTRON_RUN_AS_NODE' || /MIMO_API_KEY|MODEL_SWITCH_UNIFIED_KEY/.test(name)) delete env[name];
Object.assign(env, { WEFTMATE_UI_UPDATE_FEED: feedUrl, WEFTMATE_UPDATE_TEST_PUBLIC_KEYS_PATH: keysFile });
const password = `synthetic-${randomUUID()}-password`;
const backend = Object.fromEntries(['getStatus', 'listModels', 'preflight', 'createSession', 'sendMessage', 'cancelSession', 'readEvents', 'describeSession'].map(method => [method, async () => method === 'listModels' ? [] : {}]));
const preparation = await createPersonalAccessService({ root: join(profile, 'personal-access'), port: 0, backend });
const initial = await preparation.start(); const grant = await preparation.issueSetupGrant();
const setup = await fetch(initial.origin + '/personal/v1/auth/setup', { method: 'POST', headers: { origin: initial.origin, 'content-type': 'application/json' },
  body: JSON.stringify({ grant: grant.grant, username: 'Upd1Fixture', password, deviceName: 'Preparation' }) });
assert.equal(setup.status, 201); await preparation.close();
let log = '';
const pause = ms => new Promise(done => setTimeout(done, ms));
async function until(check, timeout = 60000) { const end = Date.now() + timeout; while (Date.now() < end) { const value = await check(); if (value) return value; await pause(200); } throw new Error('UPD-1 condition timeout: ' + log.slice(-1500)); }
const report = { realElectron: true, productMain: true, realDsh: true, syntheticModel: true, paidModelRequests: 0 };
async function state() { return page.evaluate(() => weftmateDesktop.updateState()); }
async function api(path, body) {
  return page.evaluate(async ({ path, body }) => {
    const me = await (await fetch('/personal/v1/auth/me')).json();
    const response = await fetch('/personal/v1' + path, { method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', 'x-weftmate-csrf': me.csrfToken }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  }, { path, body });
}
async function reopen() { await application.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('/personal/v1/ui')); win.hide(); win.show(); }); }
async function shot(name) { await page.screenshot({ path: join(evidence, name) }); }
try {
  const v1 = await packageRelease({ layer: 'ui', version: '0.1.0', outputDir: feedDir, privateKey });
  application = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: repository,
    args: ['.', '--personal-host', '--access-port=0', `--user-data-dir=${profile}`, '--force-device-scale-factor=1'], env, timeout: 90000 });
  application.process().stdout?.on('data', part => { log += String(part); }); application.process().stderr?.on('data', part => { log += String(part); });
  page = await application.firstWindow({ timeout: 90000 }); page.setDefaultTimeout(45000);
  await page.waitForURL('**/personal/v1/ui*'); await page.getByRole('heading', { name: '登录 WeftMate' }).waitFor();
  const loggedIn = await page.evaluate(async input => (await fetch('/personal/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })).status,
    { username: 'Upd1Fixture', password, deviceName: 'UPD-1 Electron' }); assert.equal(loggedIn, 200); await page.reload();
  await shot('01-v1.png'); console.log('UPD-1: product v1 logged in');
  const configured = await api('/account/models', { requestId: randomUUID(), name: 'UPD-1 Synthetic', baseUrl: `http://127.0.0.1:${model.address().port}/v1`, modelId: 'upd-1-synthetic', apiKey: 'synthetic-only' });
  assert.equal(configured.status, 202, JSON.stringify(configured.body));
  await until(async () => { const result = await api('/account/models'); return result.body.models?.some(row => row.name === 'UPD-1 Synthetic') });
  console.log('UPD-1: synthetic model configured');
  await page.reload(); await page.getByRole('button', { name: /^新对话/ }).click();
  await until(() => page.getByRole('textbox', { name: '输入消息', exact: true }).isEnabled());
  await page.getByRole('textbox', { name: '输入消息', exact: true }).fill('UPD-1 更新期间保持这个任务运行。');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  try { await until(() => target, 20000); }
  catch (error) { console.log('UPD-1 diagnostic:', await api('/sessions')); console.log(await page.locator('body').innerText()); throw error; }
  await page.getByRole('button', { name: /^停止(?:回复)?$/, exact: true }).waitFor(); await shot('02-v1-running.png'); console.log('UPD-1: real DSH task running');
  const layout = join(root, 'layout-v2.js'); await writeFile(layout, (await readFile(personalAccessUiResources.get('personal-access-ui/layout.js'), 'utf8')).replace('/* layout-test-slot */', "document.querySelector('#new-session').append(document.createTextNode(' · UPD v2'));"));
  const v2Resources = new Map(personalAccessUiResources); v2Resources.set('personal-access-ui/layout.js', layout);
  const v2 = await packageRelease({ layer: 'ui', version: '0.2.0', outputDir: feedDir, privateKey, resources: v2Resources, previousManifest: v1 });
  const transferStart = transfers.length;
  const downloaded = await page.evaluate(() => weftmateDesktop.checkUpdates());
  assert.equal(downloaded.layers[0].status, 'ready');
  const v2Transfers = transfers.slice(transferStart).filter(row => row.path.startsWith('files/'));
  assert.equal(v2Transfers.length, 1); assert.match(v2Transfers[0].path, /layout.js$/);
  report.v2ChangedBytes = v2Transfers[0].bytes; report.v2TotalBytes = v2.files.reduce((sum, row) => sum + row.size, 0);
  report.v2ReusedBytes = downloaded.layers[0].reusedBytes;
  await reopen(); await pause(700);
  assert.equal((await state()).layers[0].currentVersion, '0.1.0'); assert.equal(target.closed, false);
  assert.equal(await page.getByRole('button', { name: /UPD v2/ }).count(), 0);
  await shot('03-v2-ready-task-running.png'); report.taskUnaffected = true;
  released = true; target.complete();
  await page.getByRole('button', { name: '发送', exact: true }).waitFor();
  await until(async () => { await reopen(); return (await state()).layers[0].currentVersion === '0.2.0' });
  await page.getByRole('button', { name: /UPD v2/ }).waitFor();
  await until(async () => (await state()).layers[0].status === 'current'); await shot('04-v2-active.png');
  report.taskCompletedNormally = target.completed;
  const appV3 = join(root, 'app-v3.js'); await writeFile(appV3, 'throw new Error("UPD-1 intentional startup failure");');
  const v3Resources = new Map(v2Resources); v3Resources.set('personal-access-ui/app.js', appV3);
  await packageRelease({ layer: 'ui', version: '0.3.0', outputDir: feedDir, privateKey, resources: v3Resources, previousManifest: v2 });
  await page.evaluate(() => weftmateDesktop.checkUpdates()); await reopen();
  await until(async () => (await state()).layers[0].currentVersion === '0.2.0' && (await state()).layers[0].status === 'failed');
  await page.getByRole('button', { name: /UPD v2/ }).waitFor(); await shot('05-v3-rollback-v2.png');
  const pointer = JSON.parse(await readFile(join(profile, 'updates/ui/current.json'), 'utf8'));
  assert.equal(pointer.rejected.length, 1); assert.ok(pointer.lastFailure); report.rollback = true;
  report.layers = (await state()).layers; report.downloads = v2Transfers; report.rejectedCount = pointer.rejected.length;
  // Persisted verified v2 survives another full product launch; failed v3 stays rejected.
  await application.close(); application = null;
  application = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: repository,
    args: ['.', '--personal-host', '--access-port=0', `--user-data-dir=${profile}`], env, timeout: 90000 });
  page = await application.firstWindow({ timeout: 90000 }); await page.waitForURL('**/personal/v1/ui*');
  await page.getByRole('button', { name: /UPD v2/ }).waitFor(); report.restartRetainsV2 = true;
  await writeFile(join(evidence, 'desktop-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await application?.close().catch(() => {}); await browser?.close().catch(() => {});
  for (const request of modelRequests) if (!request.closed) request.complete?.();
  await Promise.all([new Promise(done => feed.close(done)), new Promise(done => model.close(done))]);
  await rm(root, { recursive: true, force: true });
}
