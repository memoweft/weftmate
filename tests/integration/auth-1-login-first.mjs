import { evidencePath } from '../helpers/evidence-path.mjs';
// All accounts, mail, hosts and content are synthetic; no model is contacted.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer as netServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { developmentCertificate, createHostTlsAdapter } from '../../src/personal-relay/tls.mjs';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { servePersonalAccessUi } from '../../src/personal-access-ui/index.mjs';
import { PASSWORD, EMAIL } from '../../services/cloud/test/identity-helpers.mjs';
import { fixture } from '../helpers/auth-1-https-cloud.mjs';
import { registration, appDevice } from '../../services/cloud/test/app-helpers.mjs';

const repo = resolve(import.meta.dirname, '../..'), baseline = join(repo, '.local/auth-1-baseline');
const out = evidencePath('auth-1'); await mkdir(out, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'wm-auth1-migration-'));
const cleanups = [], report = { modelRequests: 0, realElectron: true, productionNativeShell: true,
  syntheticCloud: true, syntheticMail: true, oldCommit: 'fa6d96a8', checks: [], pageErrors: [] };
let cloud, host, app, browser, origin, localAuth;
const reservation = netServer(); await new Promise(done => reservation.listen(0, '127.0.0.1', done));
const relayPort = reservation.address().port; await new Promise(done => reservation.close(done));
const relayDomain = `h-${randomUUID().replaceAll('-', '')}.localhost`, relayOrigin = `https://${relayDomain}:${relayPort}`;
const backend = { getStatus: async () => ({ runtime: 'ready', capabilities: { chat: { available: true } } }),
  listModels: async () => [{ id: 'local', name: '合成模型设置', model: 'synthetic', configured: true }], preflight: async () => ({ ok: true }),
  createSession: async ({ sessionId }) => ({ sessionId }), sendMessage: async () => { throw Error('No model request permitted'); },
  cancelSession: async () => ({}), describeSession: async sessionId => ({ sessionId, agentPreset: 'personal-remote', modelProfileId: 'local', title: '升级前的合成对话', running: false }),
  readEvents: async ({ sessionId, afterSeq }) => ({ events: afterSeq < 0 ? [{ seq: 0, at: '2026-10-10T08:00:00Z', type: 'user.message', data: { text: '保留下来的合成对话原文', messageId: 'synthetic-original' } }] : [], nextSeq: 0, hasMore: false }) };
const memoryManager = { enabled: true, peek: () => 'ready', status: async () => ({ state: 'ready', capabilities: {} }),
  query: async (_owner, operation) => operation === 'query_jobs' ? { jobs: [] } : { world_revision: 1, items: [], evidence: [] },
  submitCommand: async () => ({ result_state: 'applied', after_revision: 1 }), receiptByRequest: async () => ({ result_state: 'applied' }),
  retryCleanupByRequest: async () => ({ result_state: 'applied' }) };
async function api(path, body, auth = localAuth, headers = {}, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(origin + '/personal/v1' + path, { method,
    headers: { origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(auth ? { cookie: auth.cookie, 'x-weftmate-csrf': auth.csrfToken } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw Error(`${path}: ${response.status} ${JSON.stringify(value)}`);
  return { ...value, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function launch(directory, desktopToken) {
  const profile = join(root, 'electron-profile'); await mkdir(profile, { recursive: true });
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_|CLOUD_)/.test(key) || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
  Object.assign(env, { REVIEW_PROFILE: profile, REVIEW_THEME: 'light', REVIEW_ORIGIN: origin,
    REVIEW_LIBRARY_TOKEN: desktopToken, WEFTMATE_TEST_HOST_NAME: 'synthetic-host', WEFTMATE_CLOUD_ISSUER: cloud.config.issuer,
    WEFTMATE_CLOUD_DESKTOP_CLIENT_ID: 'test-native', WEFTMATE_CLOUD_DESKTOP_REDIRECT_URI: 'com.example.weftmate:/callback' });
  app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: directory,
    args: [join(directory, 'scripts/review-gallery/electron.mjs'), '--force-device-scale-factor=1',
      `--ignore-certificate-errors-spki-list=${cloud.cloudTlsSpki}`], env, timeout: 60000 });
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', e => report.pageErrors.push(e.message));
  await page.waitForURL('**/personal/v1/ui'); return page;
}
async function latestCode(email = EMAIL) {
  const row = cloud.db.prepare('SELECT id FROM email_challenges WHERE email=? ORDER BY rowid DESC LIMIT 1').get(email);
  assert.ok(row); return cloud.mailCode(row.id);
}
async function login(page, codeOnly = false) {
  if (codeOnly) await page.getByRole('button', { name: '用邮箱验证码登录', exact: true }).click();
  await page.locator('#cloud-auth-form').getByLabel('邮箱', { exact: true }).fill(EMAIL);
  if (!codeOnly) await page.locator('#cloud-auth-form').getByLabel('密码', { exact: true }).fill(PASSWORD);
  await page.locator('#cloud-auth-form [type=submit]').click();
  await page.getByLabel(/^(邮箱)?验证码$/, { exact: true }).waitFor();
  await page.getByLabel(/^(邮箱)?验证码$/, { exact: true }).fill(await latestCode());
  await page.locator('#cloud-auth-form [type=submit]').click();
}
async function capture(page, prefix, state) {
  for (const theme of ['light', 'dark']) for (const width of [1200, 480]) {
    await app.evaluate(({ nativeTheme, BrowserWindow }, { theme, width }) => { nativeTheme.themeSource = theme; BrowserWindow.getAllWindows()[0].setContentSize(width, 800); }, { theme, width });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; localStorage.setItem('weftmate:theme', theme); }, theme);
    await page.waitForTimeout(180);
    await page.screenshot({ path: join(out, `${prefix}-${width}-${theme}-${state}.png`) });
  }
}
async function captureNativePopup(page, state, open) {
  for (const theme of ['light', 'dark']) for (const width of [1200, 480]) {
    await app.evaluate(({ nativeTheme, BrowserWindow }, { theme, width }) => { nativeTheme.themeSource = theme; BrowserWindow.getAllWindows()[0].setContentSize(width, 800); }, { theme, width });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await open(); await page.waitForTimeout(160);
    await page.screenshot({ path: join(out, `desktop-${width}-${theme}-${state}.png`) });
    await page.keyboard.press('Escape');
  }
}
try {
  cloud = await fixture({ after: fn => cleanups.push(fn) }, { realProcess: true, env: { CLOUD_OIDC_CLIENTS: JSON.stringify([
    { client_id: 'test-native', redirect_uris: ['com.example.weftmate:/callback'] },
    { client_id: 'auth1-web', application_type: 'web', redirect_uris: [relayOrigin + '/personal/v1/ui/'] }
  ]) } });
  await registration(cloud); const control = await appDevice(cloud, 'synthetic-prior-desktop');
  const oldFactory = (await import(pathToFileURL(join(baseline, 'src/personal-access/index.mjs')))).createPersonalAccessService;
  const oldUi = (await import(pathToFileURL(join(baseline, 'src/personal-access-ui/index.mjs')))).servePersonalAccessUi;
  const data = join(root, 'personal-access');
  host = await oldFactory({ root: data, port: 0, backend, memoryManager, uiHandler: oldUi,
    cloudIdentity: { issuer: cloud.config.issuer, allowInsecureLoopback: true, clientId: 'auth1-web' } });
  origin = (await host.start()).origin;
  const grant = await host.issueSetupGrant();
  localAuth = await api('/auth/setup', { grant: grant.grant, username: 'synthetic-original-owner', password: 'synthetic local password only for old version', deviceName: 'synthetic-prior-desktop' }, null);
  const secondOwner = await api('/auth/register', { username: 'synthetic-second-owner', password: 'synthetic second local password', deviceName: 'synthetic-second-desktop' });
  await api('/settings/models', { defaultModelProfileId: 'local', backgroundModelProfileId: 'local' }, localAuth, {}, 'PATCH');
  const memoryFile = join(data, 'synthetic-retained-memory.json');
  const memoryBytes = JSON.stringify({ synthetic: true, ownerId: localAuth.account.ownerId, remembered: '机主的合成记忆仍在原目录' });
  await writeFile(memoryFile, memoryBytes);
  await host.attachSession('synthetic-preserved-session');
  const claim = await api('/cloud/claims', {});
  await api('/cloud/binding', { claimId: claim.claimId, accessToken: control.tokens.access_token });
  const ownerId = localAuth.account.ownerId;
  const original = JSON.parse(await readFile(join(data, 'store.json'), 'utf8'));
  original.accounts[ownerId].devices[localAuth.device.id].expiresAt = new Date(Date.now() - 60000).toISOString();
  await host.close(); await writeFile(join(data, 'store.json'), JSON.stringify(original));
  host = await oldFactory({ root: data, port: 0, backend, memoryManager, uiHandler: oldUi,
    cloudIdentity: { issuer: cloud.config.issuer, allowInsecureLoopback: true, clientId: 'auth1-web' } });
  origin = (await host.start()).origin;
  report.expiredLocalSessionBeforeUpgrade = true;
  let page = await launch(baseline, host.libraryDesktopToken);
  await login(page); await page.locator('#cloud-wait-view').waitFor({ state: 'visible' });
  await page.screenshot({ path: join(out, 'old-desktop-waiting.png') });
  const oldIdentity = JSON.parse(await readFile(join(data, 'cloud-identity/identity.json'), 'utf8'));
  assert.ok(Object.values(oldIdentity.devices).some(d => d.status === 'pending'));
  report.checks.push('old-real-Electron-cloud-login-stuck-pending');
  await app.close(); app = null; await host.close();
  host = await createPersonalAccessService({ root: data, port: 0, backend, memoryManager, uiHandler: servePersonalAccessUi,
    allowedOrigins: [relayOrigin], trustedProxy: true,
    cloudIdentity: { issuer: cloud.config.issuer, allowInsecureLoopback: true, clientId: 'auth1-web' } });
  origin = (await host.start()).origin; localAuth = null;
  page = await launch(repo, host.libraryDesktopToken);
  await page.locator('#assistant-view').waitFor({ state: 'visible' });
  await page.evaluate(() => {
    globalThis.__auth1Errors = [];
    const original = globalThis.WeftUiCore.CloudAuthClient.prototype.request;
    globalThis.WeftUiCore.CloudAuthClient.prototype.request = async function(url, options) {
      try { return await original.call(this, url, options); }
      catch (error) { globalThis.__auth1Errors.push({ route: new URL(url).pathname, code: error.code, status: error.status }); throw error; }
    };
  });
  await page.getByRole('button', { name: /升级前的合成对话/ }).first().waitFor();
  assert.equal(await page.locator('#login-view').isVisible(), false);
  const me = await page.evaluate(async () => (await fetch('/personal/v1/auth/me')).json());
  assert.equal(me.account.ownerId, ownerId); assert.equal(me.local, true);
  const upgraded = JSON.parse(await readFile(join(data, 'store.json'), 'utf8'));
  assert.deepEqual(upgraded.accounts[ownerId].account.password, original.accounts[ownerId].account.password);
  assert.ok(upgraded.accounts[ownerId].sessions['synthetic-preserved-session']);
  assert.equal(upgraded.accounts[ownerId].defaultModelProfileId, original.accounts[ownerId].defaultModelProfileId);
  assert.equal(upgraded.accounts[ownerId].backgroundModelProfileId, original.accounts[ownerId].backgroundModelProfileId);
  assert.equal(await readFile(memoryFile, 'utf8'), memoryBytes);
  assert.equal((await page.evaluate(async () => (await fetch('/personal/v1/cloud/binding')).json())).status, 'active');
  report.checks.push('upgrade-keeps-owner-conversation-password-model-setting-active-binding', 'native-window-opens-without-cloud-or-local-password');
  await capture(page, 'desktop', 'local');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1200, 800));
  if (!await page.locator('#settings-dialog').isVisible()) await page.keyboard.press('Control+,');
  await page.getByRole('navigation', { name: '设置分类', exact: true }).getByRole('button', { name: '账户', exact: true }).click();
  await captureNativePopup(page, 'local-account-menu', () => page.getByRole('combobox', { name: /^切换本机账户/ }).click());
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1200, 800));
  await page.getByRole('combobox', { name: /^切换本机账户/ }).click();
  await page.getByRole('option', { name: 'synthetic-second-owner', exact: true }).click();
  await page.waitForFunction(async owner => (await (await fetch('/personal/v1/auth/me')).json()).account?.ownerId === owner, secondOwner.account.ownerId);
  await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#login-view').isVisible(), false);
  if (!await page.locator('#settings-dialog').isVisible()) await page.keyboard.press('Control+,');
  await page.getByRole('navigation', { name: '设置分类', exact: true }).getByRole('button', { name: '账户', exact: true }).click();
  await page.getByRole('combobox', { name: /^切换本机账户/ }).click();
  await page.getByRole('option', { name: 'synthetic-original-owner', exact: true }).click();
  await page.waitForFunction(async owner => (await (await fetch('/personal/v1/auth/me')).json()).account?.ownerId === owner, ownerId);
  await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
  report.checks.push('native-settings-switches-existing-local-owners-without-password');
  if (!await page.locator('#settings-dialog').isVisible()) await page.keyboard.press('Control+,');
  await page.getByRole('navigation', { name: '设置分类', exact: true }).getByRole('button', { name: '设备', exact: true }).click();
  await page.getByRole('button', { name: '登录以使用远程访问', exact: true }).click();
  await page.locator('#cloud-login-dialog').waitFor({ state: 'visible' });
  await capture(page, 'desktop', 'login-modal');
  await page.locator('#cloud-auth-form').getByLabel('邮箱', { exact: true }).fill(EMAIL);
  await page.locator('#cloud-auth-form').getByLabel('密码', { exact: true }).fill('incorrect synthetic password');
  await page.locator('#cloud-auth-form [type=submit]').click();
  await page.locator('#cloud-auth-error').waitFor({ state: 'visible' });
  await capture(page, 'desktop', 'error');
  await page.getByRole('button', { name: '关闭登录', exact: true }).click();
  assert.equal((await page.evaluate(async () => (await fetch('/personal/v1/auth/me')).json())).account.ownerId, ownerId);
  report.checks.push('close-cloud-login-retains-local-session');
  await page.getByRole('button', { name: '登录以使用远程访问', exact: true }).click();
  await page.getByRole('button', { name: '用邮箱验证码登录', exact: true }).click();
  await page.locator('#cloud-auth-form').getByLabel('邮箱', { exact: true }).fill(EMAIL);
  await page.locator('#cloud-auth-form [type=submit]').click();
  await page.getByLabel(/^(邮箱)?验证码$/, { exact: true }).waitFor();
  await capture(page, 'desktop', 'email-code');
  await page.getByLabel(/^(邮箱)?验证码$/, { exact: true }).fill(await latestCode());
  await page.locator('#cloud-auth-form [type=submit]').click();
  await page.locator('#cloud-login-dialog').waitFor({ state: 'hidden' });
  report.checks.push('native-pure-email-code-login-retains-local-cookie');
  await capture(page, 'desktop', 'signed-in');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1200, 800));
  await page.getByRole('navigation', { name: '设置分类', exact: true }).getByRole('button', { name: '设备', exact: true }).click();
  await capture(page, 'desktop', 'devices');
  const tlsIdentity = JSON.parse(await readFile(join(data, 'cloud-identity/identity.json'), 'utf8')).tls;
  const certificate = await developmentCertificate({ root, domain: relayDomain, privateJwk: tlsIdentity.privateJwk });
  const relay = await createHostTlsAdapter({ origin, publicOrigin: relayOrigin, privateJwk: tlsIdentity.privateJwk,
    spki: tlsIdentity.spki, certFile: certificate.certFile, port: relayPort });
  cleanups.push(() => relay.close());
  // Production host TLS adapter terminates TLS and injects the proxy headers;
  // the synthetic loopback relay carries bytes without gaining native authority.
  browser = await chromium.launch({ headless: true, args: ['--no-proxy-server', `--host-resolver-rules=MAP ${relayDomain} 127.0.0.1`] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, colorScheme: 'light', ignoreHTTPSErrors: true });
  const phone = await context.newPage(); phone.setDefaultTimeout(15000);
  phone.on('pageerror', error => report.pageErrors.push(error.message));
  const capturePhone = async state => {
    for (const width of [360,390]) for (const theme of ['light','dark']) {
      await phone.setViewportSize({ width, height: width === 360 ? 780 : 844 }); await phone.emulateMedia({ colorScheme: theme });
      await phone.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme); await phone.waitForTimeout(150);
      await phone.screenshot({ path: join(out, `phone-web-${width}-${theme}-${state}.png`) });
    }
  };
  await phone.goto(relayOrigin + '/personal/v1/ui/');
  const nativeRejected = await phone.evaluate(async () => (await fetch('/personal/v1/auth/desktop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status);
  assert.equal(nativeRejected, 403);
  await phone.locator('#login-view').waitFor({ state: 'visible' }); await capturePhone('login');
  await phone.getByRole('button', { name: '用邮箱验证码登录', exact: true }).click();
  await phone.locator('#cloud-auth-form').getByLabel('邮箱', { exact: true }).fill(EMAIL);
  await phone.locator('#cloud-auth-form [type=submit]').click();
  await phone.getByLabel(/^(邮箱)?验证码$/).waitFor(); await capturePhone('email-code');
  await phone.getByLabel(/^(邮箱)?验证码$/).fill('000000'); await phone.locator('#cloud-auth-form [type=submit]').click();
  await phone.locator('#cloud-auth-error').waitFor({ state: 'visible' }); await capturePhone('error');
  await phone.getByLabel(/^(邮箱)?验证码$/).fill(await latestCode()); await phone.locator('#cloud-auth-form [type=submit]').click();
  await phone.locator('#assistant-view').waitFor({ state: 'visible' });
  const content = await phone.evaluate(async () => { const response = await fetch('/personal/v1/sessions/synthetic-preserved-session/events?afterSeq=-1&limit=20'); return { status: response.status, body: await response.json() }; });
  assert.equal(content.status, 200); assert.ok(JSON.stringify(content.body).includes('保留下来的合成对话原文')); await capturePhone('signed-in');
  assert.equal(await phone.evaluate(async () => (await fetch('/personal/v1/backups')).status), 403, 'whole-host backup management stays on the local computer');
  const cookies = await context.cookies(relayOrigin + '/personal/v1/ui/');
  const contentCookie = cookies.find(cookie => cookie.name === 'wm_personal_session');
  assert.ok(contentCookie?.secure && contentCookie.httpOnly && contentCookie.sameSite === 'Strict');
  await phone.keyboard.press('Control+,');
  await phone.getByRole('combobox', { name: /^设置分类/ }).click();
  await phone.getByRole('option', { name: /设备$/ }).click();
  await capturePhone('devices');
  const capturePhonePopup = async (state, open) => {
    for (const width of [360,390]) for (const theme of ['light','dark']) {
      await phone.setViewportSize({ width, height: width === 360 ? 780 : 844 }); await phone.emulateMedia({ colorScheme: theme });
      await phone.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      await open(); await phone.waitForTimeout(150);
      await phone.screenshot({ path: join(out, `phone-web-${width}-${theme}-${state}.png`) }); await phone.keyboard.press('Escape');
    }
  };
  const phoneOwnRow = () => phone.getByRole('group', { name: '这个浏览器', exact: true });
  const phoneMore = () => phoneOwnRow().getByRole('button', { name: '这个浏览器的更多操作', exact: true }).click();
  await capturePhonePopup('device-menu', phoneMore);
  await capturePhonePopup('device-details', () => phoneOwnRow().getByRole('button', { name: '查看 这个浏览器', exact: true }).click());
  await capturePhonePopup('rename-device', async () => { await phoneMore(); await phone.getByRole('menuitem', { name: '修改名称', exact: true }).click(); });
  await capturePhonePopup('logout-device', async () => { await phoneMore(); await phone.getByRole('menuitem', { name: '移除设备', exact: true }).click(); });
  await phone.getByRole('button', { name: '关闭设置', exact: true }).click();
  await phone.locator('#rail-open').click();
  await phone.getByRole('button', { name: /^动态(?:，|$)/ }).click();
  await phone.getByText('有一台新设备登录', { exact: true }).first().waitFor(); await capturePhone('new-device-notification');
  report.checks.push('relay-cannot-obtain-native-session', 'phone-browser-real-cloud-code-login-through-synthetic-TLS-relay-reads-original-content');
  const identity = JSON.parse(await readFile(join(data, 'cloud-identity/identity.json'), 'utf8'));
  assert.ok(Object.values(identity.devices).some(d => d.status === 'trusted'));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1200, 800));
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByRole('button', { name: /^动态(?:，|$)/ }).click();
  await page.getByText('有一台新设备登录', { exact: true }).first().waitFor();
  await capture(page, 'desktop', 'new-device-notification');
  report.checks.push('new-device-notification-in-local-activity');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1200, 800));
  await page.getByRole('article').filter({ hasText: '这个浏览器' }).getByRole('button', { name: '查看设备', exact: true }).click();
  await page.getByRole('heading', { name: '设备', exact: true, level: 1 }).waitFor();
  const phoneRow = () => page.getByRole('group', { name: '这个浏览器', exact: true });
  const more = () => phoneRow().getByRole('button', { name: '这个浏览器的更多操作', exact: true }).click();
  await captureNativePopup(page, 'device-menu', more);
  await captureNativePopup(page, 'device-details', () => phoneRow().getByRole('button', { name: '查看 这个浏览器', exact: true }).click());
  await captureNativePopup(page, 'rename-device', async () => { await more(); await page.getByRole('menuitem', { name: '修改名称', exact: true }).click(); });
  await captureNativePopup(page, 'logout-device', async () => { await more(); await page.getByRole('menuitem', { name: '移除设备', exact: true }).click(); });
  await more(); await page.getByRole('menuitem', { name: '移除设备', exact: true }).click();
  await page.getByRole('button', { name: '确认下线', exact: true }).click();
  await page.getByRole('dialog', { name: '让设备下线', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await phone.evaluate(async () => (await fetch('/personal/v1/auth/me')).status), 401);
  assert.equal((await page.evaluate(async () => (await fetch('/personal/v1/auth/me')).json())).account.ownerId, ownerId);
  report.checks.push('notification-opens-devices-and-confirmed-logout-immediately-rejects-phone-cookie-keeps-local-owner');
  await context.close();
} catch (error) {
  if (app) { const windows = await app.windows(); const page = windows[0]; if (page) {
    report.visibleError = await page.locator('#cloud-auth-error').textContent().catch(() => '');
    report.requestErrors = await page.evaluate(() => globalThis.__auth1Errors || []).catch(() => []);
    await page.screenshot({ path: join(out, 'failure-latest.png') }).catch(() => {});
  } }
  report.error = String(error.message).replaceAll(root, '%TEMP%/wm-auth1-migration'); throw error;
} finally {
  if (browser) await browser.close(); if (app) await app.close(); if (host) await host.close();
  for (const cleanup of cleanups.reverse()) await cleanup();
  await writeFile(join(out, 'migration-verification.json'), JSON.stringify(report, null, 2) + '\n');
  await rm(root, { recursive: true, force: true });
}
console.log(JSON.stringify(report));
