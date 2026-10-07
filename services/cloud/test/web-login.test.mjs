import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, realpath, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, EMAIL, PASSWORD, P } from './identity-helpers.mjs';
import { createPersonalAccessService } from '../../../src/personal-access/index.mjs';
import { servePersonalAccessUi } from '../../../src/personal-access-ui/index.mjs';
const enabled = process.env.WEFTMATE_WEB_E2E === 'true';
test('S1c real browser: local login → bind → new mobile browser waits → desktop allows → conversation; QR, deny and unlink', { skip: !enabled, timeout: 180000 }, async t => {
  const { chromium } = await import('../../../apps/mobile-ui/node_modules/playwright/index.mjs');
  const reserved = createServer(); reserved.listen(0, '127.0.0.1'); await once(reserved, 'listening');
  const port = reserved.address().port; await new Promise(resolve => reserved.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const f = await fixture(t, { env: { CLOUD_OIDC_CLIENTS: JSON.stringify([
    { client_id: 'weftmate-web', application_type: 'web', redirect_uris: [origin + '/personal/v1/ui/'] },
    { client_id: 'weftmate-android', redirect_uris: ['com.memoweft.weftmate:/oauth'] },
  ]) } });
  await f.verified();
  const root = await realpath(await mkdtemp(join(tmpdir(), 'wm-browser-host-')));
  const host = await createPersonalAccessService({ root, port, uiHandler: servePersonalAccessUi,
    cloudIdentity: { issuer: f.config.issuer, allowInsecureLoopback: true },
    backend: { getStatus: async () => ({ runtime: 'ready' }), listModels: async () => [], preflight: async () => ({ ok: true }),
      createSession: async ({ sessionId }) => ({ sessionId }), sendMessage: async () => ({}), cancelSession: async () => ({}),
      readEvents: async () => ({ events: [], nextSeq: -1, hasMore: false }), describeSession: async () => null } });
  t.after(async () => { await host.close(); await rm(root, { recursive: true, force: true }); });
  await host.start();
  const grant = await host.issueSetupGrant();
  const localPassword = 'synthetic local browser password';
  const setup = await fetch(origin + '/personal/v1/auth/setup', { method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ grant: grant.grant, username: 'synthetic-local', password: localPassword, deviceName: 'Computer' }) });
  assert.equal(setup.status, 201);
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const owner = await desktop.newPage(); const errors = [];
  owner.on('pageerror', error => errors.push(error.message));
  await mkdir('.local/s1c-web', { recursive: true });
  async function visible(page, selector) { try { await page.locator(selector).waitFor({ state: 'visible', timeout: 15000 }); } catch (error) { await page.screenshot({path: '.local/s1c-web/failure.png'}); console.log({selector,url:page.url(),errors,body:await page.locator('body').innerText()}); throw error; } }
  async function cloudForm(page) {
    await page.locator('input[name=email]').fill(EMAIL);
    await page.locator('input[name=password]').fill(PASSWORD);
    const response = page.waitForResponse(r => r.url().endsWith('/auth/login') && r.request().method() === 'POST');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    const logged = await response;
    if ((await logged.text()).includes('challengeId')) {
      const id = await page.locator('input[name=challengeId]').inputValue();
      await page.locator('input[name=code]').fill(await f.mailCode(id));
      await page.getByRole('button', { name: '确认登录', exact: true }).click();
    }
  }
  await owner.goto(origin + '/personal/v1/ui/'); await visible(owner, '#login-view');
  await owner.locator('#login-name').fill('synthetic-local'); await owner.locator('#login-password').fill(localPassword);
  await owner.locator('#login-device').fill('Desktop'); await owner.locator('#login-form button[type=submit]').click();
  await visible(owner, '#assistant-view'); await owner.locator('#rail-account').click();
  await visible(owner, '#cloud-bind'); await owner.locator('#cloud-bind').click(); await cloudForm(owner);
  await visible(owner, '#account-view');
  await owner.getByText('已绑定 WeftMate 账号', { exact: true }).waitFor();
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const phone = await phoneContext.newPage(); phone.on('pageerror', e => errors.push(e.message));
  await phone.goto(origin + '/personal/v1/ui/'); await visible(phone, '#cloud-login');
  await phone.locator('#login-device').fill('Mobile browser'); await phone.locator('#cloud-login').click(); await cloudForm(phone);
  await visible(phone, '#cloud-wait-view');
  assert.equal((await phoneContext.request.get(origin + '/personal/v1/sessions')).status(), 401);
  await phone.screenshot({ path: '.local/s1c-web/mobile-wait.png' });
  await phone.reload(); await visible(phone, '#cloud-wait-view');
  // Opening settings performs the foreground pending read; no push service is involved.
  await owner.locator('#account-back').click(); await owner.locator('#rail-account').click();
  await visible(owner, '#pending-devices');
  await owner.locator('#pending-device-list button').filter({ hasText: /^允许$/ }).click();
  await visible(phone, '#assistant-view');
  assert.equal((await phoneContext.request.get(origin + '/personal/v1/sessions')).status(), 200);
  assert.equal(await phone.evaluate(() => Object.keys(localStorage).some(k => /refresh|cloud.*token/i.test(k))), false);
  const privateKeyState = await phone.evaluate(async () => {
    const client = new WeftCloud.Client(); const key = await client.key();
    return { extractable: key.privateKey.extractable, tokens: await WeftCloud.storage(client.tokenId) };
  });
  assert.equal(privateKeyState.extractable, false); assert.equal(privateKeyState.tokens, undefined);
  await phone.screenshot({ path: '.local/s1c-web/mobile-conversation.png' });
  // One-time QR challenge is both encoded for a camera and usable as a typed code.
  await owner.clock.install();
  await owner.locator('#pairing-open').click();
  await owner.waitForFunction(() => document.getElementById('pairing-code').value.startsWith('wm1.'));
  const firstCode = await owner.locator('#pairing-code').inputValue();
  await owner.clock.fastForward(120100);
  await owner.waitForFunction(first => { const code = document.getElementById('pairing-code').value; return code.startsWith('wm1.') && code !== first; }, firstCode);
  const code = await owner.locator('#pairing-code').inputValue();
  await owner.clock.resume();
  assert.match(await owner.locator('#pairing-qr').getAttribute('src'), /^data:image\/png;base64,/);
  const qrContext = await browser.newContext(); const qr = await qrContext.newPage();
  await qr.goto(origin + '/personal/v1/ui/#pair=' + code.slice(4)); await visible(qr, '#cloud-login');
  assert.equal(await qr.locator('#cloud-pairing-input').inputValue(), code);
  await qr.locator('#cloud-login').click(); await cloudForm(qr); await visible(qr, '#assistant-view');
  assert.equal((await qrContext.request.get(origin + '/personal/v1/sessions')).status(), 200);
  // A separate browser's ordinary cloud login can still be denied.
  const deniedContext = await browser.newContext(); const denied = await deniedContext.newPage();
  await denied.goto(origin + '/personal/v1/ui/'); await visible(denied, '#cloud-login');
  await denied.locator('#login-device').fill('Denied browser'); await denied.locator('#cloud-login').click(); await cloudForm(denied);
  await visible(denied, '#cloud-wait-view');
  await owner.locator('#devices-refresh').click(); await visible(owner, '#pending-devices');
  await owner.locator('#pending-device-list button').filter({ hasText: /^拒绝$/ }).click();
  await denied.getByText('这台设备未获允许。请在电脑上重新配对。').waitFor();
  assert.equal((await deniedContext.request.get(origin + '/personal/v1/sessions')).status(), 401);
  await denied.screenshot({ path: '.local/s1c-web/device-denied.png' });
  await owner.locator('#cloud-unbind').click(); await owner.getByText('未绑定', { exact: true }).waitFor();
  assert.equal((await phoneContext.request.get(origin + '/personal/v1/sessions')).status(), 401);
  assert.equal((await desktop.request.get(origin + '/personal/v1/sessions')).status(), 200);
  assert.deepEqual(errors, []);
});
