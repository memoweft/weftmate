import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, P } from './identity-helpers.mjs';
import { createPersonalAccessService } from '../../../src/personal-access/index.mjs';
import { servePersonalAccessUi } from '../../../src/personal-access-ui/index.mjs';

const enabled = process.env.WEFTMATE_WEB_E2E === 'true';
const button = (page, name) => page.getByRole('button', { name, exact: true });
const field = (page, name) => page.getByLabel(name, { exact: true }).filter({ visible: true });

test('D29 real browser: in-app login → device approval → remembered session → settings directory/rename/pairing; deny and unlink', { skip: !enabled, timeout: 180000 }, async t => {
  const { chromium } = await import('../../../apps/mobile-ui/node_modules/playwright/index.mjs');
  const reserved = createServer(); reserved.listen(0, '127.0.0.1'); await once(reserved, 'listening');
  const port = reserved.address().port; await new Promise(resolve => reserved.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const f = await fixture(t, { env: { CLOUD_OIDC_CLIENTS: JSON.stringify([
    { client_id: 'weftmate-web', application_type: 'web', redirect_uris: [origin + '/personal/v1/ui/'] },
    { client_id: 'test-native', redirect_uris: ['com.example.weftmate:/callback'] },
  ]) } });
  const email = `${randomUUID()}@example.com`, password = randomBytes(24).toString('base64url');
  const registration = (await f.api(`${P}/auth/register`, { method: 'POST', status: 201,
    body: { email, password } })).data;
  await f.api(`${P}/auth/register/verify`, { method: 'POST', status: 200,
    body: { challengeId: registration.challengeId, code: await f.mailCode(registration.challengeId) } });
  const seed = await f.signedIn({ email, password, deviceId: 'setup-device' });
  const root = await realpath(await mkdtemp(join(tmpdir(), 'wm-browser-host-')));
  const host = await createPersonalAccessService({ root, port, uiHandler: servePersonalAccessUi,
    cloudIdentity: { issuer: f.config.issuer, allowInsecureLoopback: true },
    backend: { getStatus: async () => ({ runtime: 'ready' }), listModels: async () => [], preflight: async () => ({ ok: true }),
      createSession: async ({ sessionId }) => ({ sessionId }), sendMessage: async () => ({}), cancelSession: async () => ({}),
      readEvents: async () => ({ events: [], nextSeq: -1, hasMore: false }), describeSession: async () => null } });
  t.after(async () => { await host.close(); await rm(root, { recursive: true, force: true }); });
  await host.start();
  async function hostApi(route, body, auth, status = 200, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(origin + '/personal/v1' + route, { method, headers: {
      origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(auth ? { cookie: auth.cookie, 'x-weftmate-csrf': auth.csrfToken } : {}),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal(response.status, status, `${method} ${route}`);
    const data = await response.json();
    return { ...data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  // Compatibility setup uses the public APIs, leaving the browser to exercise
  // the complete D29 account flow and real provider/DPoP exchange itself.
  const grant = await host.issueSetupGrant();
  const local = await hostApi('/auth/setup', { grant: grant.grant, username: 'synthetic-local',
    password: randomBytes(24).toString('base64url'), deviceName: 'Setup computer' }, undefined, 201);
  const claim = await hostApi('/cloud/claims', {}, local);
  await hostApi('/cloud/binding', { claimId: claim.claimId, accessToken: seed.access_token }, local);
  await host.syncCloudRevocations();

  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const errors = [], requests = [];
  await mkdir('.local/s1c-web', { recursive: true });
  async function pageFor(options = {}) {
    const context = await browser.newContext(options), page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { const request = response.request();
      const url = new URL(response.url());
      if (url.pathname.startsWith('/personal/v1/')) requests.push({ path: url.pathname, status: response.status(),
        proof: !!request.headers().dpop });
    });
    return { context, page };
  }
  async function loggedIn(page) {
    try { await page.getByRole('textbox', { name: '输入消息', exact: true }).waitFor({ state: 'visible' }); }
    catch (error) {
      await page.screenshot({ path: '.local/s1c-web/failure.png' });
      t.diagnostic(JSON.stringify({ headings: await page.getByRole('heading').allTextContents(),
        status: await page.getByRole('status').filter({ visible: true }).allTextContents(),
        alerts: await page.getByRole('alert').allTextContents(), requests: requests.slice(-15), errors }));
      throw error;
    }
    assert.equal(page.url(), origin + '/personal/v1/ui/', 'authorization stays inside the app');
  }
  async function cloudLogin(page) {
    await page.goto(origin + '/personal/v1/ui/');
    await page.getByRole('heading', { name: '登录 WeftMate', exact: true }).waitFor();
    assert.equal(await field(page, '配对码').isVisible(), false);
    assert.equal(await button(page, '离线使用这台电脑').count(), 0, 'remote browsers have no local emergency login');
    await field(page, '邮箱').fill(email); await field(page, '密码').fill(password);
    const response = page.waitForResponse(value => value.url().endsWith(P + '/auth/login') && value.request().method() === 'POST');
    await button(page, '登录').click();
    const logged = await response;
    assert.equal(logged.status(), 202);
    const challenge = (await logged.json()).challengeId;
    await page.getByRole('heading', { name: '确认新设备', exact: true }).waitFor();
    await field(page, '验证码').fill(await f.mailCode(challenge));
    await button(page, '验证').click();
    await page.getByRole('heading', { name: '在你已登录的设备上允许这台设备', exact: true }).waitFor();
    assert.equal(page.url(), origin + '/personal/v1/ui/');
  }
  async function openSettings(page) {
    // This fixture serves the current host: wait for its workspace before using
    // the account menu. The transient legacy rail disappears when status arrives.
    const menu = button(page, '账户菜单'), sidebar = button(page, '切换会话侧栏');
    await sidebar.waitFor({ state: 'visible' });
    if (!(await menu.isVisible())) await sidebar.click();
    await menu.click();
    await button(page, '设置').click();
    const picker = page.getByRole('combobox', { name: '设置分类', exact: true });
    if (await picker.isVisible()) { await picker.click(); await page.getByRole('option', { name: '设置 · 设备', exact: true }).click(); }
    else await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '设备', exact: true }).click();
    await page.getByRole('heading', { name: '设备', exact: true, level: 1 }).waitFor();
  }
  async function rename(page, before, after) {
    const row = page.getByRole('group', { name: before, exact: true });
    await row.getByRole('button', { name: '改名', exact: true }).click();
    await row.getByRole('textbox', { name: '设备名称', exact: true }).fill(after);
    await row.getByRole('button', { name: '保存名称', exact: true }).click();
    await page.getByRole('group', { name: after, exact: true }).waitFor();
  }

  const { context: ownerContext, page: owner } = await pageFor({ viewport: { width: 1280, height: 850 } });
  await cloudLogin(owner);
  assert.equal((await ownerContext.request.get(origin + '/personal/v1/sessions')).status(), 401);
  const firstPending = await hostApi('/cloud/devices/pending', undefined, local);
  assert.equal(firstPending.devices.length, 1);
  await hostApi(`/cloud/devices/${firstPending.devices[0].id}/decision`, { decision: 'allow' }, local);
  await loggedIn(owner);
  assert.equal((await ownerContext.request.get(origin + '/personal/v1/sessions')).status(), 200);
  await owner.reload(); await loggedIn(owner);
  await openSettings(owner); await rename(owner, '这个浏览器', 'Approved owner browser');
  await owner.screenshot({ path: '.local/s1c-web/owner-devices.png' });
  await button(owner, '关闭设置').click();

  const { context: phoneContext, page: phone } = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true });
  await cloudLogin(phone);
  assert.equal((await phoneContext.request.get(origin + '/personal/v1/sessions')).status(), 401);
  await phone.screenshot({ path: '.local/s1c-web/mobile-wait.png' });
  await phone.reload();
  await phone.getByRole('heading', { name: '在你已登录的设备上允许这台设备', exact: true }).waitFor();
  // Settings reads the same pending requests that appear in the top banner.
  await openSettings(owner);
  await owner.getByRole('heading', { name: '待批准设备', exact: true }).waitFor();
  await button(owner, '允许').click();
  const trust = owner.getByRole('dialog', { name: '可信交付', exact: true });
  await trust.waitFor();
  assert.match(await trust.getByRole('textbox', { name: '可信交付码', exact: true }).inputValue(), /^wmt1\./);
  await trust.getByRole('button', { name: '关闭', exact: true }).click();
  await loggedIn(phone);
  assert.equal((await phoneContext.request.get(origin + '/personal/v1/sessions')).status(), 200);
  assert.equal(await phone.evaluate(() => Object.keys(localStorage).some(key => /refresh|cloud.*token/i.test(key))), false);
  const protectedState = await phone.evaluate(async () => {
    const client = new WeftUiCore.CloudAuthClient({ fetch: (...args) => fetch(...args), crypto,
      credentials: (...args) => WeftCloud.storage(...args), vendor: WeftCloudVendor, host: location.origin });
    await client.configure(); const key = await client.key(), saved = await client.saved();
    return { extractable: key.privateKey.extractable, hasRefreshToken: !!saved.refreshToken };
  });
  assert.deepEqual(protectedState, { extractable: false, hasRefreshToken: true });
  await phone.screenshot({ path: '.local/s1c-web/mobile-conversation.png' });
  await openSettings(phone); await rename(phone, '这个浏览器', 'Mobile browser');
  await phone.getByText(/这台设备/).filter({ visible: true }).first().waitFor();
  await phone.screenshot({ path: '.local/s1c-web/remote-devices.png' });

  // The remote web client consumes a QR/typed code in Settings → Devices.
  // Only the directly authenticated computer can create pairing material.
  const pairing = await hostApi('/cloud/pairings', {}, local, 201);
  const code = 'wm1.' + Buffer.from(JSON.stringify(pairing)).toString('base64url');
  await field(phone, '输入电脑的配对码').fill(code);
  const redeemed = phone.waitForResponse(response => response.url().endsWith('/cloud/pairings/redeem') && response.request().method() === 'POST');
  await button(phone, '配对连接').click(); assert.equal((await redeemed).status(), 200);
  await loggedIn(phone); await openSettings(phone);
  await field(phone, '输入电脑的配对码').fill(code); await button(phone, '配对连接').click();
  await phone.getByRole('status').filter({ hasText: '配对码已失效或不属于这台电脑，请获取新码。' }).waitFor();

  const { context: deniedContext, page: denied } = await pageFor();
  await cloudLogin(denied);
  await button(owner, '关闭设置').click(); await openSettings(owner);
  await owner.getByRole('heading', { name: '待批准设备', exact: true }).waitFor();
  await button(owner, '拒绝').click();
  await denied.getByText('这台设备未获允许，请在已登录设备上重新批准。', { exact: true }).waitFor();
  assert.equal((await deniedContext.request.get(origin + '/personal/v1/sessions')).status(), 401);
  await denied.screenshot({ path: '.local/s1c-web/device-denied.png' });
  await hostApi('/cloud/binding', {}, local, 200, 'DELETE');
  assert.equal((await phoneContext.request.get(origin + '/personal/v1/sessions')).status(), 401);
  assert.equal((await ownerContext.request.get(origin + '/personal/v1/sessions')).status(), 401);
  assert.equal((await hostApi('/sessions', undefined, local)).sessions.length, 0, 'local owner survives cloud unbinding');
  for (const route of ['/auth/authorization', '/auth/authorization/resume', '/devices', '/devices/rename'])
    assert.ok(requests.some(request => request.path === P + route && request.status === 200), route);
  assert.ok(requests.some(request => request.path === P + '/oidc/token' && request.status === 200 && request.proof));
  assert.deepEqual(errors, []);
});
