/** One real Mac source host, real synthetic cloud, headless phone webpage. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { createServer as reservePort } from 'node:net';
import { chromium } from 'playwright';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, realpath, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fixture, P } from '../../services/cloud/test/identity-helpers.mjs';
import { appDevice, proof, control } from '../../services/cloud/test/app-helpers.mjs';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';

assert.equal(process.platform, 'darwin');
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-mac';
const repository = resolve(import.meta.dirname, '../..'), root = await realpath(await mkdtemp(join(tmpdir(), 'weftmate-synthetic-stop-m3-3-phone-')));
const profile = join(root, 'profile'); await mkdir(profile);
await writeFile(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const cleanups = [], password = randomBytes(24).toString('base64url'), modelKey = randomBytes(24).toString('hex');
const email = `m3-3-${randomUUID()}@example.com`;
const report = { realMacSourceHost: true, realCloudImplementation: true, phone: 'headless Chromium 390x844',
  computerName: 'synthetic-mac', relay: 'direct loopback; production relay not exercised', electronHeadlessLaunches: 0, mimoRequests: 0, checks: [], completed: false };
let cloud, prep, child, browser, page, log = '', local, phase = 'cloud';
const until = async (fn, label, timeout = 45000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 100)); }
  throw Error('M3-3 phone timeout: ' + label);
};
const port = reservePort(); await new Promise(r => port.listen(0, '127.0.0.1', r));
const hostPort = port.address().port; await new Promise(r => port.close(r));
const origin = `http://127.0.0.1:${hostPort}`;
const model = createServer(async (req, res) => {
  if (req.url.endsWith('/models')) return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'synthetic-stop-model' }] }));
  if (req.method === 'GET') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ total_slots: 1, n_ctx: 8192, currentModelId: 'synthetic-stop-model', probe: { health: true } }));
  let body = ''; for await (const part of req) body += part;
  const input = JSON.parse(body); report.modelRequests = (report.modelRequests || 0) + 1;
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: 'M3-3 手机已在 Mac 上开聊。' }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
});
await new Promise(r => model.listen(0, '127.0.0.1', r));
async function api(path, body, auth = local, extra = {}, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(origin + '/personal/v1' + path, { method, headers: { origin, 'content-type': 'application/json',
    ...(auth ? { cookie: auth.cookie, 'x-weftmate-csrf': auth.csrfToken } : {}), ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, ...await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] || auth?.cookie };
}
try {
  cloud = await fixture({ after: fn => cleanups.push(fn) }, { env: { CLOUD_OIDC_CLIENTS: JSON.stringify([
    { client_id: 'test-native', redirect_uris: ['com.example.weftmate:/callback'] },
    { client_id: 'm3-3-web', application_type: 'web', redirect_uris: [origin + '/personal/v1/ui/'] },
  ]) } });
  const challenge = (await cloud.api(P + '/auth/registration/request', { method: 'POST', body: { email }, status: 200 })).data;
  const ticket = (await cloud.api(P + '/auth/registration/verify', { method: 'POST', body: { challengeId: challenge.challengeId, code: await cloud.mailCode(challenge.challengeId) }, status: 200 })).data;
  await cloud.api(P + '/auth/registration/complete', { method: 'POST', body: { passwordTicket: ticket.passwordTicket, password }, status: 200 });
  const desktop = await appDevice(cloud, 'synthetic-mac', email, password);
  const backend = Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(name => [name, async () => ({})]));
  prep = await createPersonalAccessService({ root: join(profile, 'personal-access'), port: hostPort, backend,
    cloudIdentity: { issuer: cloud.config.issuer, clientId: 'm3-3-web', allowInsecureLoopback: true } });
  const started = await prep.start(); report.hostId = started.hostId;
  local = await api('/auth/desktop', { deviceName: 'synthetic-mac' }, null, { 'x-weftmate-desktop': prep.libraryDesktopToken });
  assert.equal(local.status, 200);
  const nonce = await api('/auth/cloud-nonce', {}, null);
  local = await api('/auth/cloud-desktop', { accessToken: desktop.tokens.access_token, deviceName: 'synthetic-mac' }, local,
    { 'x-weftmate-desktop': prep.libraryDesktopToken, dpop: await proof(desktop, origin + '/personal/v1/auth/cloud-desktop', desktop.tokens.access_token, { nonce: nonce.nonce }) });
  assert.equal(local.status, 200);
  await prep.syncCloudRevocations();
  const directory = (await control(desktop, '/devices')).data;
  assert.equal(directory.hosts.length, 1); assert.equal(directory.hosts[0].hostId, started.hostId);
  report.checks.push('verified synthetic account binds and registers exactly one synthetic-mac host');
  await prep.close(); prep = null;
  phase = 'source-host';
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_|MIMO_API_KEY|ELECTRON_RUN_AS_NODE|NODE_OPTIONS)/.test(name)) delete env[name];
  Object.assign(env, { WEFTMATE_TEST_HOST_NAME: 'synthetic-mac', WEFTMATE_CLOUD_ISSUER: cloud.config.issuer,
    WEFTMATE_CLOUD_WEB_CLIENT_ID: 'm3-3-web', WEFTMATE_CLOUD_ALLOW_INSECURE_LOOPBACK: 'true',
    WEFTMATE_DOGFOOD_CONTROL: '1', WEFTMATE_SYNTHETIC_STOP_FIXTURE: '1', M3_3_TEST_VAULT_KEY: randomBytes(32).toString('base64') });
  child = spawn(createRequire(import.meta.url)('electron'), [join(repository, 'tests/helpers/m3-3-electron-bootstrap.mjs'),
    '--disable-gpu', '--disable-gpu-compositing', '--use-mock-keychain', '--headless', '--personal-host', `--access-port=${hostPort}`, `--user-data-dir=${profile}`],
    { cwd: repository, env, stdio: ['ignore','pipe','pipe','ipc'] });
  report.electronHeadlessLaunches++;
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { log = (log + data).slice(-100000); });
  await until(() => /personal-access listening/.test(log), 'source Mac host');
  // Configure through the existing process-local fixture management seam.
  // A cloud cookie deliberately cannot act as native model administration.
  await new Promise((resolve, reject) => {
    const requestId = randomUUID(), timer = setTimeout(() => { child.off('message', listener); reject(Error('fixture model management timeout')); }, 30000);
    const listener = value => { if (value?.type !== 'weftmate:manage-result' || value.requestId !== requestId) return;
      clearTimeout(timer); child.off('message', listener); value.ok ? resolve(value.result) : reject(Error(value.code)); };
    child.on('message', listener); child.send({ type: 'weftmate:manage', requestId, action: 'model.configure-synthetic-stop-fixture', baseUrl: `http://127.0.0.1:${model.address().port}/v1` });
  });
  const modelId = (await until(async () => (await api('/models')).models?.find(m => m.id === 'synthetic-stop-fixture'), 'model catalog')).id;
  assert.equal((await api('/settings/models', { defaultModelProfileId: modelId, backgroundModelProfileId: modelId }, local, {}, 'PATCH')).status, 200);
  phase = 'phone-login';
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(origin + '/personal/v1/ui/');
  const form = page.locator('#cloud-auth-form');
  await form.getByLabel('邮箱', { exact: true }).fill(email);
  await form.getByLabel('密码', { exact: true }).fill(password);
  await form.locator('[type=submit]').click();
  const code = page.getByLabel(/^(邮箱)?验证码$/, { exact: true }); await code.waitFor();
  const row = cloud.db.prepare('SELECT id FROM email_challenges WHERE email=? ORDER BY rowid DESC LIMIT 1').get(email);
  await code.fill(await cloud.mailCode(row.id)); await form.locator('[type=submit]').click();
  await page.locator('#assistant-view').waitFor({ state: 'visible', timeout: 45000 });
  report.checks.push('headless phone webpage completes password + synthetic mailbox verification into the Mac account');
  phase = 'phone-directory';
  await page.evaluate(() => WeftSettingsNavigation.open('devices'));
  await page.getByText('synthetic-mac', { exact: true }).first().waitFor();
  await page.screenshot({ path: 'tests/evidence/m3-3/phone-web-devices.png' });
  report.checks.push('phone settings visibly lists synthetic-mac');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  phase = 'phone-chat';
  await page.locator('#message-text').fill('M3-3_PHONE 在这台 Mac 上聊一句。'); await page.locator('#message-text').press('Enter');
  await page.getByText('M3-3 手机已在 Mac 上开聊。', { exact: true }).first().waitFor({ timeout: 60000 });
  await page.screenshot({ path: 'tests/evidence/m3-3/phone-web-chat.png' });
  report.checks.push('phone creates a conversation and receives the real Mac DSH synthetic-model reply'); report.completed = true;
} catch (error) {
  report.phase = phase; report.failure = String(error.message).replaceAll(password, '[private]').replaceAll(modelKey, '[private]').replaceAll(root, '<synthetic-temp>').replace(/\/Users\/[^/\s]+/g, '/Users/<user>');
  if (page) await page.screenshot({ path: 'tests/evidence/m3-3/phone-web-failure.png' }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close(); await prep?.close();
  if (child && child.exitCode === null) {
    const exited = new Promise(r => child.once('close', r)); child.send({ type: 'weftmate:quit' });
    await Promise.race([exited, new Promise(r => setTimeout(r, 15000))]);
    if (child.exitCode === null) { child.kill('SIGTERM'); await exited; }
  }
  model.closeAllConnections(); await new Promise(r => model.close(r));
  for (const close of cleanups.reverse()) await close();
  await rm(root, { recursive: true, force: true });
  await writeFile('tests/evidence/m3-3/phone.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ completed: report.completed, phase: report.phase, launches: report.electronHeadlessLaunches }));
}
