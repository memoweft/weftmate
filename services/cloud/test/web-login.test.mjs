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

test('AUTH-1 real browser: password or email-code login → session → directory/rename/offline; desktop-confirmed pairing and unlink stay protected', { skip: !enabled, timeout: 180000 }, async t => {
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
  async function cloudLogin(page, codeLogin = false) {
    await page.goto(origin + '/personal/v1/ui/');
    assert.equal((await page.request.get(origin+'/personal/v1/sessions')).status(),401,'unauthenticated browsers must not see host content');
    await page.getByRole('heading', { name: '登录 WeftMate', exact: true }).waitFor();
    assert.equal(await field(page, '配对码').isVisible(), false);
    assert.equal(await button(page, '离线使用这台电脑').count(), 0, 'remote browsers have no local emergency login');
    if(codeLogin) await button(page,'用邮箱验证码登录').click();
    await field(page, '邮箱').fill(email);
    if(!codeLogin) await field(page, '密码').fill(password);
    const response = page.waitForResponse(value => value.url().endsWith(P + (codeLogin ? '/auth/login/code/request' : '/auth/login')) && value.request().method() === 'POST');
    await button(page, codeLogin ? '发送验证码' : '登录').click();
    const logged = await response;
    assert.equal(logged.status(), 202);
    const challenge = (await logged.json()).challengeId;
    await field(page, '邮箱验证码').waitFor();
    await field(page, '邮箱验证码').fill(await f.mailCode(challenge));
    await button(page, '确认并登录').click();
    await loggedIn(page);
    assert.equal(await page.getByRole('heading',{name:'在你已登录的设备上允许这台设备',exact:true}).count(),0);
    assert.equal(await page.getByRole('dialog',{name:'可信交付',exact:true}).count(),0);
    assert.equal(page.url(), origin + '/personal/v1/ui/');
  }
  async function openSettings(page) {
    // This fixture serves the current host: wait for its workspace before using
    // the account menu. The transient legacy rail disappears when status arrives.
    const menu = button(page, '账户菜单'), sidebar = button(page, '切换会话侧栏');
    await sidebar.waitFor({ state: 'visible' });
    // A closing/off-canvas mobile rail can still have visible layout boxes.
    // Use its accessible open state before attempting a real pointer click.
    const narrow = await page.evaluate(() => matchMedia('(max-width: 640px)').matches);
    if (narrow) {
      if (await sidebar.getAttribute('aria-expanded') !== 'true') await sidebar.click();
      assert.equal(await sidebar.getAttribute('aria-expanded'), 'true');
    } else if (!(await menu.isVisible())) await sidebar.click();
    await menu.click();
    await button(page, '设置').click();
    const picker = page.getByRole('combobox', { name: '设置分类', exact: true });
    if (await picker.isVisible()) { await picker.click(); await page.getByRole('option', { name: '设置 · 设备', exact: true }).click(); }
    else await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '设备', exact: true }).click();
    await page.getByRole('heading', { name: '设备', exact: true, level: 1 }).waitFor();
  }
  async function rename(page, before, after) {
    const row = page.locator('#cloud-directory .cloud-device-row').filter({has:page.getByRole('button',{name:`查看 ${before}`,exact:true})});
    await row.getByRole('button',{name:`${before}的更多操作`,exact:true}).click();
    await page.getByRole('menuitem',{name:'修改名称',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'修改设备名称',exact:true}); await dialog.waitFor();
    await dialog.getByRole('textbox', { name: '设备名称', exact: true }).fill(after);
    await dialog.getByRole('button', { name: '保存名称', exact: true }).click();
    await page.getByRole('button',{name:`查看 ${after}`,exact:true}).waitFor();
  }
  async function offline(page,name) {
    await page.getByRole('button',{name:`${name}的更多操作`,exact:true}).click();
    await page.getByRole('menuitem',{name:'移除设备',exact:true}).click();
    const confirm=page.getByRole('dialog',{name:'让设备下线',exact:true}); await confirm.waitFor();
    await confirm.getByRole('button',{name:'确认下线',exact:true}).click();
    await confirm.waitFor({state:'hidden'}); await host.syncCloudRevocations();
  }

  const { context: ownerContext, page: owner } = await pageFor({ viewport: { width: 1280, height: 850 } });
  await cloudLogin(owner);
  assert.equal((await ownerContext.request.get(origin + '/personal/v1/sessions')).status(), 200);
  const firstPending = await hostApi('/cloud/devices/pending', undefined, local);
  assert.equal(firstPending.devices.length, 0);
  await loggedIn(owner);
  assert.equal((await ownerContext.request.get(origin + '/personal/v1/sessions')).status(), 200);
  await owner.reload(); await loggedIn(owner);
  await openSettings(owner); await rename(owner, '这个浏览器', 'Approved owner browser');
  await owner.screenshot({ path: '.local/s1c-web/owner-devices.png' });
  await button(owner, '关闭设置').click();

  const { context: phoneContext, page: phone } = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true });
  await cloudLogin(phone,true);
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

  // The phone independently computes SAS; only the direct computer can confirm.
  const pairing = await hostApi('/cloud/pairings', {}, local, 201);
  const pairingCookies = await phoneContext.cookies(origin);
  const sas=await phone.evaluate(async pairing=>{
    const client = new WeftUiCore.CloudAuthClient({ fetch: (...args) => fetch(...args), crypto,
      credentials: (...args) => WeftCloud.storage(...args), vendor: WeftCloudVendor, host: location.origin });
    await client.configure();const key=await client.key(),saved=await client.saved();
    const jkt=await client.hash(JSON.stringify({crv:key.publicJwk.crv,kty:key.publicJwk.kty,x:key.publicJwk.x,y:key.publicJwk.y}));
    const bytes=crypto.getRandomValues(new Uint8Array(32)),nonce=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    const token=await client.access(client.base+'/hosts/'+client.config.hostId);
    const send=async(path,body)=>{const n=await client.request(client.host+'/personal/v1/auth/cloud-nonce',{method:'POST',body:{}});
      const url=client.host+'/personal/v1'+path,proof=await client.proof(url,{token,nonce:n.nonce});
      const result=await client.request(url,{method:'POST',headers:{DPoP:proof},body:{accessToken:token,deviceName:saved.deviceName||'Browser',challenge:pairing.challenge,...body}});
      if(result.account || result.csrfToken || result.hostTrust)throw Error('PAIRING_CREATED_SESSION_BEFORE_CONFIRMATION');
      return result;};
    const joined=await send('/cloud/pairings/join',{phoneCommitment:await client.hash(JSON.stringify(['wm-pair-phone-v2',pairing.challenge,key.deviceId,jkt,nonce]))});
    const hostJkt=await client.hash(JSON.stringify({crv:pairing.publicJwk.crv,kty:pairing.publicJwk.kty,x:pairing.publicJwk.x,y:pairing.publicJwk.y}));
    const T=[2,pairing.issuer,pairing.sub,pairing.hostId,pairing.tlsSpki,hostJkt,pairing.challenge,pairing.expiresAt,pairing.origin,pairing.relay?.baseUrl||''];
    if(await client.hash(JSON.stringify(['wm-pair-host-v2',...T,joined.hostNonce]))!==pairing.hostCommitment)throw Error('HOST_COMMITMENT_MISMATCH');
    await send('/cloud/pairings/reveal',{phoneNonce:nonce});
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['wm-pair-sas-v2',...T,joined.hostNonce,key.deviceId,jkt,nonce])));
    return (new DataView(digest).getUint32(0,false)%1000000).toString().padStart(6,'0');
  },pairing);
  const redeem=()=>phone.evaluate(async pairing=>{
    const client = new WeftUiCore.CloudAuthClient({ fetch: (...args) => fetch(...args), crypto,
      credentials: (...args) => WeftCloud.storage(...args), vendor: WeftCloudVendor, host: location.origin });
    await client.configure();
    const saved=await client.saved(),token=await client.access(client.base+'/hosts/'+client.config.hostId);
    const nonce=await client.request(client.host+'/personal/v1/auth/cloud-nonce',{method:'POST',body:{}});
    const url=client.host+'/personal/v1/cloud/pairings/redeem',proof=await client.proof(url,{token,nonce:nonce.nonce});
    try {
      const result=await client.request(url,{method:'POST',headers:{DPoP:proof},
        body:{accessToken:token,deviceName:saved.deviceName||'Browser',challenge:pairing.challenge}});
      await client.acceptHostTrust(result,saved,pairing);
      return {ownerId:result.account.ownerId};
    }
    catch(error){return {error:error.code,status:error.status};}
  },pairing);
  assert.deepEqual(await redeem(),{error:'PAIRING_CONFIRMATION_REQUIRED',status:403});
  assert.deepEqual(await phoneContext.cookies(origin),pairingCookies,'join, reveal and rejected redeem must not issue a session');
  assert.equal((await hostApi('/cloud/pairings/status',{challenge:pairing.challenge},local)).verificationCode,sas);
  const phoneAuth=await (await phoneContext.request.get(origin+'/personal/v1/auth/me')).json();
  const remoteDecision=await phoneContext.request.post(origin+'/personal/v1/cloud/pairings/decision',{
    headers:{origin,'x-weftmate-csrf':phoneAuth.csrfToken},
    data:{challenge:pairing.challenge,decision:'confirm',verificationCode:sas}});
  assert.equal(remoteDecision.status(),403,'phone sessions cannot confirm pairing');
  assert.equal((await remoteDecision.json()).error.code,'LOCAL_SESSION_REQUIRED');
  const confirmed=await hostApi('/cloud/pairings/decision',{challenge:pairing.challenge,decision:'confirm',verificationCode:sas},local);
  assert.equal(confirmed.state,'confirmed');
  assert.equal(confirmed.cookie,undefined,'computer confirmation alone must not issue a session');
  assert.deepEqual(await phoneContext.cookies(origin),pairingCookies);
  assert.equal((await redeem()).ownerId,local.account.ownerId);
  assert.deepEqual(await redeem(),{error:'PAIRING_INVALID',status:401});
  await phone.reload(); await loggedIn(phone);

  const { context: revokedContext, page: revoked } = await pageFor();
  await cloudLogin(revoked); await openSettings(revoked); await rename(revoked,'这个浏览器','Revoked browser');
  await openSettings(owner); await offline(owner,'Revoked browser');
  assert.equal((await revokedContext.request.get(origin + '/personal/v1/sessions')).status(),401);
  await owner.screenshot({path:'.local/s1c-web/device-offlined.png'});
  const pairedAuth=await (await phoneContext.request.get(origin+'/personal/v1/auth/me')).json();
  const remoteUnlink=await phoneContext.request.delete(origin+'/personal/v1/cloud/binding',{
    headers:{origin,'x-weftmate-csrf':pairedAuth.csrfToken},data:{}});
  assert.equal(remoteUnlink.status(),403,'phone sessions cannot unlink the cloud account');
  assert.equal((await remoteUnlink.json()).error.code,'LOCAL_SESSION_REQUIRED');
  await hostApi('/cloud/binding', {}, local, 200, 'DELETE');
  assert.equal((await phoneContext.request.get(origin + '/personal/v1/sessions')).status(), 401);
  assert.equal((await ownerContext.request.get(origin + '/personal/v1/sessions')).status(), 401);
  assert.equal((await hostApi('/sessions', undefined, local)).sessions.length, 0, 'local owner survives cloud unbinding');
  for (const route of ['/auth/authorization', '/auth/authorization/resume', '/devices', '/devices/rename'])
    assert.ok(requests.some(request => request.path === P + route && request.status === 200), route);
  assert.ok(requests.some(request => request.path === P + '/oidc/token' && request.status === 200 && request.proof));
  assert.deepEqual(errors, []);
});
