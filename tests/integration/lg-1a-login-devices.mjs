/** LG-1a acceptance: real cloud entrypoint, real Electron entrypoint, isolated browser. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer, connect } from 'node:net';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';
import { _electron, chromium } from 'playwright';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';

const repository = resolve(import.meta.dirname, '../..');
const evidence = join(repository, 'tests/evidence/lg-1a');
const run = randomUUID();
const email = `lg1-${run}@example.com`, changedEmail = `lg1-changed-${run}@example.com`;
const password = randomBytes(24).toString('base64url');
const resetPassword = randomBytes(24).toString('base64url');
const emergencyPassword = randomBytes(24).toString('base64url');
const report = { startedAt: new Date().toISOString(), realCloudEntrypoint: 'services/cloud/src/main.mjs',
  realElectronEntrypoint: '.', modelRequests: 0, steps: [], cloudTransport: process.platform === 'win32' ? 'WSL Ubuntu' : 'native' };
const profile = await mkdtemp(join(tmpdir(), 'weftmate-lg-1a-'));
await mkdir(evidence, { recursive: true });
await writeFile(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
let cloud, application, browser, cloudRoot, cloudData, mailDirectory, cloudProxy, cloudAccountId, currentDesktop, resumeWebPolling;
const pageErrors = [], requests = [], failedRequests = [];
let mainObserverInstalled = false, mainRequestOffset = 0;

async function installMainNetworkObserver() {
  await application.evaluate(({ session }) => {
    globalThis.__lgMainRequests = [];
    session.fromPartition('persist:weftmate-desktop').webRequest.onCompleted(details => {
      const path = new URL(details.url).pathname;
      if (path.startsWith('/personal/v1')) globalThis.__lgMainRequests.push({ path, status: details.statusCode });
    });
  });
  mainObserverInstalled = true;
}
async function collectMainRequests() {
  if (!mainObserverInstalled) return;
  const rows = await application.evaluate((_electron, offset) => globalThis.__lgMainRequests.slice(offset), mainRequestOffset);
  mainRequestOffset += rows.length;
  requests.push(...rows);
  failedRequests.push(...rows.filter(row => row.status >= 400));
}

async function until(check, message, milliseconds = 30000) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) { await collectMainRequests(); const value = await check(); if (value) return value; await sleep(milliseconds > 60000 ? 1000 : 100); }
  throw new Error(message);
}
async function freePort() {
  const server = createServer(); await new Promise(done => server.listen(0, '127.0.0.1', done));
  const port = server.address().port; await new Promise(done => server.close(done)); return port;
}
function cleanEnvironment() {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_|CLOUD_)/.test(name) || name === 'ELECTRON_RUN_AS_NODE') delete env[name];
  return env;
}
async function startCloud(hostOrigin) {
  const port = await freePort(), origin = `http://127.0.0.1:${port}`;
  const env = { CLOUD_HOST: '0.0.0.0', CLOUD_PORT: String(port), CLOUD_MAIL_TRANSPORT: 'file',
    CLOUD_MAIL_FROM: 'test@example.com', CLOUD_ISSUER: `${origin}/personal/v1/cloud/oidc`,
    CLOUD_OIDC_CLIENTS: JSON.stringify([{ client_id: 'weftmate-web', application_type: 'web',
      redirect_uris: [`${hostOrigin}/personal/v1/ui/`] }]) };
  if (process.platform === 'win32') {
    const distro = process.env.WEFTMATE_LG1_WSL_DISTRO || 'Ubuntu';
    const linuxNode = process.env.WEFTMATE_LG1_WSL_NODE || '/tmp/weftmate-s1d-node/bin/node';
    cloudRoot = execFileSync('wsl.exe', ['-d', distro, '--exec', 'mktemp', '-d', '/tmp/weftmate-lg-1a-XXXXXXXX'], { encoding: 'utf8', windowsHide: true }).trim();
    assert.match(cloudRoot, /^\/tmp\/weftmate-lg-1a-[a-zA-Z0-9]+$/);
    cloudData = cloudRoot;
    mailDirectory = `\\\\wsl.localhost\\${distro}${cloudRoot.replaceAll('/', '\\')}\\mail`;
    const source = execFileSync('wsl.exe', ['-d', distro, '--exec', 'wslpath', '-a', repository], { encoding: 'utf8', windowsHide: true }).trim();
    env.CLOUD_DATA_DIR = cloudData; env.CLOUD_MAIL_DIR = `${cloudData}/mail`;
    // Closing stdin terminates only this launcher’s cloud child. No global process matching.
    const launcher = `import {spawn} from 'node:child_process'; const child=spawn(process.execPath,[${JSON.stringify(`${source}/services/cloud/src/main.mjs`)}],{stdio:['ignore','inherit','inherit']}); process.stdin.resume(); process.stdin.on('end',()=>child.kill('SIGTERM')); child.on('exit',code=>process.exit(code??1));`;
    cloud = spawn('wsl.exe', ['-d', distro, '--exec', 'env', ...Object.entries(env).map(([key, value]) => `${key}=${value}`), linuxNode, '--input-type=module', '-e', launcher], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: cleanEnvironment() });
    // WSL localhost forwarding is disabled on some Windows machines. A byte-only
    // loopback bridge keeps the public issuer and host verification unchanged.
    const linuxAddress = execFileSync('wsl.exe', ['-d', distro, '--exec', 'hostname', '-I'], { encoding: 'utf8', windowsHide: true }).trim().split(/\s+/)[0];
    assert.match(linuxAddress, /^\d+\.\d+\.\d+\.\d+$/);
    cloudProxy = createServer(socket => {
      const upstream = connect(port, linuxAddress);
      socket.on('error', () => upstream.destroy()); upstream.on('error', () => socket.destroy());
      socket.pipe(upstream).pipe(socket);
    });
    await new Promise(done => cloudProxy.listen(port, '127.0.0.1', done));
  } else {
    cloudRoot = await mkdtemp(join(tmpdir(), 'weftmate-lg-1a-cloud-')); cloudData = cloudRoot;
    mailDirectory = join(cloudRoot, 'mail'); env.CLOUD_DATA_DIR = cloudRoot; env.CLOUD_MAIL_DIR = mailDirectory;
    cloud = spawn(process.execPath, [join(repository, 'services/cloud/src/main.mjs')], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...cleanEnvironment(), ...env } });
  }
  let started = false, failed = false;
  cloud.stderr.on('data', () => {});
  createInterface({ input: cloud.stdout }).on('line', line => {
    try { const event = JSON.parse(line); if (event.event === 'service.started') started = true; if (event.event === 'service.start_failed') failed = true; } catch { /* provider diagnostics */ }
  });
  await until(() => { if (failed || cloud.exitCode !== null) throw Error('Real cloud entrypoint failed to start'); return started; }, 'Real cloud readiness timeout', 30000);
  const health = await fetch(`${origin}/healthz`); assert.equal(health.status, 200); await health.text();
  report.steps.push('Real cloud entrypoint health'); return { origin, issuer: env.CLOUD_ISSUER };
}
async function latestCode(recipient, since) {
  return until(async () => {
    const names = await readdir(mailDirectory).catch(() => []);
    const messages = await Promise.all(names.filter(name => name.endsWith('.json')).map(name => readFile(join(mailDirectory, name), 'utf8').then(JSON.parse)));
    const message = messages.filter(value => value.to === recipient && Date.parse(value.createdAt) >= since && /\b\d{6}\b/.test(value.text)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    return message?.text.match(/\b\d{6}\b/)?.[0];
  }, 'File mail verification code timeout');
}
function observe(page) {
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/personal/v1')) requests.push({ path: url.pathname, status: response.status() });
    if (url.pathname.startsWith('/personal/v1') && response.status() >= 400) {
      failedRequests.push({ path: url.pathname, status: response.status() });
    }
  });
}
const button = (page, name) => page.getByRole('button', { name: name === '新对话' ? /^新对话/ : name, exact: true }).filter({ visible: true });
const field = (page, name) => page.getByLabel(name, { exact: true }).filter({ visible: true });
async function shot(page, name) {
  await page.getByRole('status').filter({ hasText: /^(离线密码已设置。|已允许.*|密码已重设，请登录。)$/ }).waitFor({ state: 'hidden' });
  await page.mouse.move(0, 0); await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(evidence, `${name}.png`), animations: 'disabled' });
}
async function themeShot(page, name) {
  const colors = page.getByRole('combobox', { name: '颜色模式', exact: true });
  await colors.selectOption('dark'); await shot(page, `${name}-dark`);
  await colors.selectOption('light'); await shot(page, `${name}-light`);
}
async function systemThemeShots(page, name) {
  await page.emulateMedia({ colorScheme: 'dark' }); await shot(page, `${name}-dark`);
  await page.emulateMedia({ colorScheme: 'light' }); await shot(page, `${name}-light`);
}
async function login(page, recipient, secret, respectThrottle = false) {
  await page.getByRole('heading', { name: '登录 WeftMate', exact: true }).waitFor();
  await field(page, '邮箱').fill(recipient); await field(page, '密码').fill(secret); await button(page, '登录').click();
  if (respectThrottle) {
    const throttle = page.getByRole('alert').filter({ hasText: /^尝试太多次/ });
    await until(async () => await field(page, '验证码').count() || await button(page, '新对话').count() || await throttle.count(), 'New-key login did not advance');
    if (await throttle.count()) {
      await shot(page, 'desktop-login-rate-limit-light');
      console.log(JSON.stringify({ event: 'waiting.for.real.mail.throttle', seconds: 600 }));
      await until(() => button(page, '登录').isEnabled(), 'Real mail throttle did not expire', 660000);
      report.steps.push('Real delivery throttle displays a wait countdown and permits retry after expiry');
      await field(page, '密码').fill(secret); await button(page, '登录').click();
    }
  }
}
async function instrumentAuthFailures(page) {
  await page.evaluate(() => {
    globalThis.__lgAuthErrors = [];
    const prototype = globalThis.WeftUiCore.CloudAuthClient.prototype;
    for (const name of ['verify', 'finish', 'exchange']) {
      const original = prototype[name];
      prototype[name] = async function (...args) {
        try { return await original.apply(this, args); }
        catch (error) { globalThis.__lgAuthErrors.push({ action: name, name: error.name, code: error.code, message: error.message }); throw error; }
      };
    }
  });
}
async function confirmMail(page, recipient, since) {
  await field(page, '验证码').waitFor(); await field(page, '验证码').fill(await latestCode(recipient, since));
  await button(page, '验证').click();
}
async function openSettings(page, tab) {
  if (await button(page, tab).count()) { await button(page, tab).click(); return; }
  if (await button(page, '设置').count()) await button(page, '设置').click();
  else { await button(page, '账户菜单').click(); await button(page, '设置').click(); }
  await button(page, tab).click();
}
async function deleteAndVerifyDesktop(desktop, currentPassword) {
  await openSettings(desktop, '账户'); await button(desktop, '注销账号').click();
  await desktop.getByText('云端账号数据全部删除且不可恢复，本机的对话与记忆仍留在设备上', { exact: true }).waitFor();
  await field(desktop, '密码').fill(currentPassword); await button(desktop, '确认注销').click();
  await desktop.getByRole('heading', { name: '登录 WeftMate', exact: true }).waitFor();
  assert.equal((await desktop.context().cookies()).filter(cookie => cookie.name === 'wm_personal_session').length, 0, 'Host session cookie survived account deletion');
  const noCloudTokens = await desktop.evaluate(async () => {
    const config = await fetch('/personal/v1/cloud/config').then(response => response.json());
    const scope = 'app-tokens:' + config.issuer + ':' + config.clientId + ':' + config.hostId;
    return !(await globalThis.weftmateDesktop.credentials(scope));
  });
  assert.equal(noCloudTokens, true, 'Protected desktop cloud credentials survived account deletion');
  report.steps.push('Account deletion clears host Cookie and protected desktop cloud credentials');
  assert.ok(cloudAccountId);
  await button(desktop, '离线使用这台电脑').click();
  if (await field(desktop, '云端账号').count()) await field(desktop, '云端账号').fill(cloudAccountId);
  await field(desktop, '离线密码').fill(emergencyPassword); await button(desktop, '登录').click();
  await button(desktop, '新对话').waitFor(); report.steps.push('Offline emergency login after cloud deletion preserves local account');
}
async function registered(page, recipient, secret, deviceName) {
  await button(page, '还没有账号？注册').click();
  for (const title of ['服务条款', '隐私政策']) {
    await button(page, `《${title}》`).click();
    const reader = page.getByRole('dialog', { name: title, exact: true }); await reader.waitFor();
    await until(async () => (await reader.innerText()).includes('WeftMate'), 'Bundled legal document did not load');
    await reader.getByRole('button', { name: '关闭', exact: true }).click();
  }
  await field(page, '邮箱').fill(recipient);
  const since = Date.now(); await button(page, '发送验证码').click();
  const resend = page.getByRole('button', { name: /秒后可重发/ }); await resend.waitFor(); assert.equal(await resend.isDisabled(), true);
  await confirmMail(page, recipient, since);
  await field(page, '设置密码').fill(secret); await field(page, '确认密码').fill(secret);
  await field(page, '设备名称').fill(deviceName); await button(page, '完成注册').click();
}

try {
  const hostPort = await freePort(), hostOrigin = `http://127.0.0.1:${hostPort}`;
  const configuration = await startCloud(hostOrigin);
  if (process.argv.includes('--cloud-smoke')) {
    const since = Date.now(); const response = await fetch(`${configuration.origin}/personal/v1/cloud/auth/registration/request`, { method: 'POST', headers: { origin: hostOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
    assert.equal(response.status, 200); assert.ok((await response.json()).challengeId);
    assert.match(await latestCode(email, since), /^\d{6}$/);
    report.steps.push('Real cloud registration request and file mail read');
  } else {
    const env = { ...cleanEnvironment(), WEFTMATE_CLOUD_ISSUER: configuration.issuer, WEFTMATE_CLOUD_WEB_CLIENT_ID: 'weftmate-web', WEFTMATE_CLOUD_ALLOW_INSECURE_LOOPBACK: 'true' };
    application = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: repository,
      args: ['.', '--personal-host', `--access-port=${hostPort}`, `--user-data-dir=${profile}`, '--force-device-scale-factor=1'], env, timeout: 90000 });
    await installMainNetworkObserver();
    const desktop = await application.firstWindow({ timeout: 90000 }); currentDesktop = desktop; observe(desktop);
    await desktop.waitForURL('**/personal/v1/ui*');
    await desktop.getByRole('heading', { name: '登录 WeftMate', exact: true }).waitFor();
    await instrumentAuthFailures(desktop);
    assert.equal(await desktop.getByText('配对码', { exact: true }).filter({ visible: true }).count(), 0);
    assert.equal(await desktop.getByText('电脑地址', { exact: true }).filter({ visible: true }).count(), 0);
    await button(desktop, '离线使用这台电脑').waitFor(); await systemThemeShots(desktop, 'desktop-login');
    await button(desktop, '显示密码').click(); assert.equal(await field(desktop, '密码').getAttribute('type'), 'text');
    await button(desktop, '隐藏密码').click(); assert.equal(await field(desktop, '密码').getAttribute('type'), 'password');
    await login(desktop, `missing-${run}@example.com`, randomBytes(20).toString('base64url'));
    await desktop.getByRole('alert').filter({ hasText: '邮箱或密码' }).waitFor(); report.steps.push('Non-enumerating login error');
    await registered(desktop, email, password, '合成桌面');
    await button(desktop, '新对话').waitFor();
    cloudAccountId = await desktop.evaluate(async () => (await globalThis.weftmateDesktop.credentials('offline-account'))?.sub);
    assert.equal(typeof cloudAccountId, 'string', 'Registered desktop did not remember its offline account');
    await until(() => requests.some(row => row.path === '/personal/v1/auth/cloud-desktop' && row.status === 200), 'Desktop did not automatically bind local host');
    report.steps.push('Registration, file code, automatic login and local desktop binding');
    await desktop.clock.install({ time: Date.now() });
    await desktop.reload(); await button(desktop, '新对话').waitFor(); report.steps.push('Remembered device restores login after reload');
    await openSettings(desktop, '账户');
    await button(desktop, '设置离线密码').click(); await field(desktop, '离线密码').fill(emergencyPassword);
    await field(desktop, '确认密码').fill(emergencyPassword); await button(desktop, '保存').click();
    await until(() => requests.some(row => row.path === '/personal/v1/cloud/emergency-password' && row.status === 200), 'Emergency password was not configured');
    report.steps.push('Local emergency password configured');
    await button(desktop, '设备').click(); await desktop.getByText(/这台设备/).filter({ visible: true }).first().waitFor();
    await desktop.getByText(/可执行任务/).filter({ visible: true }).first().waitFor(); await themeShot(desktop, 'desktop-devices');
    const connectCount = requests.filter(row => row.path === '/personal/v1/cloud/hosts/connect' && row.status === 200).length;
    await button(desktop, '连接').first().click();
    await until(() => requests.filter(row => row.path === '/personal/v1/cloud/hosts/connect' && row.status === 200).length > connectCount, 'Computer connection did not use the real cloud contract');
    report.steps.push('Computer Connect uses the real hosts/connect contract');
    await desktop.clock.pauseAt(Date.now()); await desktop.clock.setFixedTime(Date.now());
    await desktop.evaluate(() => {
      const original = globalThis.setTimeout; globalThis.__lgPairingTimers = [];
      globalThis.setTimeout = function (callback, delay, ...args) {
        if (delay !== 120000) return original(callback, delay, ...args);
        globalThis.__lgPairingTimers.push('scheduled');
        return original((...values) => { globalThis.__lgPairingTimers.push('fired'); return callback(...values); }, delay, ...args);
      };
    });
    const pairingsBefore = requests.filter(row => row.path === '/personal/v1/cloud/pairings' && row.status === 201).length;
    await button(desktop, '添加设备').click();
    const pairingImage = desktop.getByRole('img', { name: '一次性设备配对二维码', exact: true });
    await pairingImage.waitFor(); await until(() => pairingImage.evaluate(image => image.naturalWidth > 0), 'Pairing QR did not render');
    await until(() => desktop.evaluate(() => globalThis.__lgPairingTimers.includes('scheduled')), 'Pairing refresh timer was not installed after QR generation');
    const firstPairing = await field(desktop, '配对码').inputValue();
    // The real component’s two-minute timer fires once after device sleep.
    // Fixed UTC keeps DPoP iat valid while only browser timer time advances.
    await desktop.clock.fastForward(120100);
    await until(() => requests.filter(row => row.path === '/personal/v1/cloud/pairings' && row.status === 201).length >= pairingsBefore + 2, 'Two-minute pairing timer did not refresh');
    await until(async () => (await field(desktop, '配对码').inputValue()) !== firstPairing, 'Pairing material did not change after refresh');
    await button(desktop, '关闭配对码').click(); await desktop.clock.setSystemTime(Date.now()); await desktop.clock.resume();
    report.steps.push('Real pairing QR renders and refreshes after two browser minutes');
    if (process.argv.includes('--logout-recovery-smoke')) {
      report.logoutRecoveryOnly = true;
      await openSettings(desktop, '账户'); await button(desktop, '退出登录').click();
      await desktop.getByRole('heading', { name: '登录 WeftMate', exact: true }).waitFor();
      const beforeRelogin = Date.now(); await login(desktop, email, password, true); await confirmMail(desktop, email, beforeRelogin);
      await desktop.getByText('在你已登录的设备上允许这台设备', { exact: true }).waitFor();
      await field(desktop, '离线密码').fill(emergencyPassword); await button(desktop, '用离线密码允许这台电脑').click();
      await button(desktop, '新对话').waitFor();
      await openSettings(desktop, '账户'); await sleep(4000); await button(desktop, '账户').waitFor();
      report.steps.push('Logout rotates the desktop key, offline password approves it and later polling preserves Settings');
      await deleteAndVerifyDesktop(desktop, password);
      assert.deepEqual(pageErrors, []);
    } else {
    browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const web = await browserContext.newPage(); observe(web); await web.goto(`${hostOrigin}/personal/v1/ui/`);
    await web.getByRole('heading', { name: '登录 WeftMate', exact: true }).waitFor();
    assert.equal(await button(web, '离线使用这台电脑').count(), 0); await systemThemeShots(web, 'web-login');
    const beforeWebLogin = Date.now(); await login(web, email, password); await confirmMail(web, email, beforeWebLogin);
    await web.getByText('在你已登录的设备上允许这台设备', { exact: true }).waitFor(); await systemThemeShots(web, 'web-waiting');
    // Hold automatic exchange retries briefly so the real recipient can import
    // the desktop’s trusted delivery before polling enters the conversation.
    const approvalGate = new Promise(done => { resumeWebPolling = done; });
    await web.route('**/personal/v1/auth/cloud-session', async route => { await approvalGate; await route.continue().catch(() => {}); });
    await button(desktop, '关闭设置').click();
    await button(desktop, '允许').first().click();
    const trustDialog = desktop.getByRole('dialog', { name: '可信交付', exact: true }); await trustDialog.waitFor();
    const trustMaterial = await trustDialog.getByRole('textbox', { name: '可信交付码', exact: true }).inputValue();
    assert.ok(/^wmt1\./.test(trustMaterial), 'Unexpected trusted delivery format'); await field(web, '已登录设备的可信交付码').fill(trustMaterial);
    await button(web, '接收可信交付').click(); resumeWebPolling();
    await trustDialog.getByRole('button', { name: '关闭', exact: true }).click();
    await button(web, '新对话').waitFor(); report.steps.push('Second web device email confirmation, waiting and desktop approval');
    report.steps.push('Trusted delivery imported by the actual recipient');
    await openSettings(web, '设备'); await web.getByText(/这台设备/).filter({ visible: true }).first().waitFor(); await themeShot(web, 'web-devices');
    if (process.argv.includes('--visual-smoke')) report.visualOnly = true;
    else {
    await web.getByRole('group', { name: '这个浏览器', exact: true }).getByRole('button', { name: '改名', exact: true }).click();
    await field(web, '设备名称').fill('合成网页'); await button(web, '保存名称').click(); await web.getByText('合成网页', { exact: true }).waitFor();
    report.steps.push('Web device renamed through the shared flow');
    await openSettings(desktop, '设备');
    await button(desktop, '改名').first().click(); await field(desktop, '设备名称').fill('合成电脑已改名');
    await button(desktop, '保存名称').click(); await desktop.getByText('合成电脑已改名', { exact: true }).first().waitFor(); report.steps.push('Cloud device renamed');
    const rejectedContext = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const rejectedWeb = await rejectedContext.newPage(); observe(rejectedWeb); await rejectedWeb.goto(`${hostOrigin}/personal/v1/ui/`);
    const beforeRejectedLogin = Date.now(); await login(rejectedWeb, email, password); await confirmMail(rejectedWeb, email, beforeRejectedLogin);
    await rejectedWeb.getByText('在你已登录的设备上允许这台设备', { exact: true }).waitFor();
    await button(desktop, '关闭设置').click(); await button(desktop, '拒绝').first().click();
    await rejectedWeb.getByText('这台设备未获允许，请在已登录设备上重新批准。', { exact: true }).waitFor();
    await openSettings(desktop, '设备');
    await desktop.getByRole('group', { name: '这个浏览器', exact: true }).getByRole('button', { name: '移除', exact: true }).click();
    const removal = desktop.getByRole('dialog', { name: '移除设备', exact: true });
    await removal.getByRole('button', { name: '确认', exact: true }).click(); await removal.waitFor({ state: 'hidden' });
    assert.equal(await desktop.getByRole('group', { name: '这个浏览器', exact: true }).count(), 0);
    await rejectedContext.close(); report.steps.push('Third device refused content access and removed from cloud directory');
    await button(desktop, '账户').click(); await button(desktop, '换绑邮箱').click(); await field(desktop, '新邮箱').fill(changedEmail);
    const beforeEmail = Date.now(); await button(desktop, '发送验证码').click();
    await field(desktop, '验证码').fill(await latestCode(changedEmail, beforeEmail)); await button(desktop, '确认换绑').click();
    await login(desktop, changedEmail, password); await button(desktop, '新对话').waitFor(); report.steps.push('Email change and reauthentication');
    await openSettings(desktop, '账户'); await button(desktop, '退出所有其他设备').click();
    await desktop.getByRole('dialog', { name: '退出所有其他设备', exact: true }).getByRole('button', { name: '确认', exact: true }).click();
    await desktop.getByRole('dialog', { name: '退出所有其他设备', exact: true }).waitFor({ state: 'hidden' });
    await web.reload(); await web.getByRole('heading', { name: '登录 WeftMate', exact: true }).waitFor();
    report.steps.push('Logout other devices');
    // Recover in the already signed-out second browser. The trusted desktop key
    // stays registered; recovery does not explicitly remove trusted devices.
    await button(web, '忘记密码？').click(); await field(web, '邮箱').fill(changedEmail);
    const beforeReset = Date.now(); await button(web, '发送验证码').click(); await confirmMail(web, changedEmail, beforeReset);
    await field(web, '新密码').fill(resetPassword); await field(web, '确认密码').fill(resetPassword);
    await button(web, '重设密码').click(); await web.getByRole('heading', { name: '登录 WeftMate', exact: true }).waitFor();
    assert.equal(await field(web, '邮箱').inputValue(), changedEmail); report.steps.push('Password recovery and email prefill');
    await desktop.reload(); await desktop.getByRole('heading', { name: '登录 WeftMate', exact: true }).waitFor();
    await shot(desktop, 'desktop-login-after-recovery-light');
    await login(desktop, changedEmail, resetPassword);
    await button(desktop, '新对话').waitFor();
    await deleteAndVerifyDesktop(desktop, resetPassword);
    assert.deepEqual(pageErrors, []);
    await collectMainRequests();
    for (const route of ['/auth/authorization', '/auth/login', '/auth/authorization/resume', '/oidc/token', '/devices', '/devices/rename', '/auth/email/change/confirm', '/auth/logout/others', '/auth/account/delete'])
      assert.ok(requests.some(row => row.path === `/personal/v1/cloud${route}` && row.status === 200), `Missing real successful cloud route: ${route}`);
    }
    }
  }
  report.passed = true;
  await rm(join(evidence, 'failure-desktop.png'), { force: true });
} catch (error) {
  await collectMainRequests().catch(() => {});
  report.passed = false;
  report.failedRequests = failedRequests;
  report.pageErrors = pageErrors;
  report.error = String(error.stack || error).replaceAll(password, '[process-only password]').replaceAll(resetPassword, '[process-only password]').replaceAll(emergencyPassword, '[process-only password]');
  if (currentDesktop) {
    await currentDesktop.clock.setSystemTime(Date.now()).catch(() => {}); await currentDesktop.clock.resume().catch(() => {});
    report.authErrors = await currentDesktop.evaluate(() => globalThis.__lgAuthErrors || []).catch(() => []);
    report.pairingTimers = await currentDesktop.evaluate(() => globalThis.__lgPairingTimers || []).catch(() => []);
    for (const input of await field(currentDesktop, '验证码').all()) await input.fill('').catch(() => {});
    for (const input of await field(currentDesktop, '设备名称').all()) await input.evaluate(node => { node.value = '合成测试设备'; }).catch(() => {});
    for (const input of await field(currentDesktop, '可信交付码').all()) await input.evaluate(node => { node.value = '[process-only delivery]'; }).catch(() => {});
    for (const input of await field(currentDesktop, '配对码').all()) await input.evaluate(node => { node.value = '[process-only pairing]'; }).catch(() => {});
    for (const image of await currentDesktop.getByRole('img', { name: '可信交付二维码', exact: true }).all()) await image.evaluate(node => { node.hidden = true; }).catch(() => {});
    for (const image of await currentDesktop.getByRole('img', { name: '一次性设备配对二维码', exact: true }).all()) await image.evaluate(node => { node.hidden = true; }).catch(() => {});
    await currentDesktop.screenshot({ path: join(evidence, 'failure-desktop.png'), animations: 'disabled' }).catch(() => {});
  }
  throw new Error(report.error);
} finally {
  resumeWebPolling?.();
  await collectMainRequests().catch(() => {}); mainObserverInstalled = false;
  await browser?.close(); await application?.close();
  if (cloud && cloud.exitCode === null) {
    if (process.platform === 'win32') cloud.stdin.end(); else cloud.kill('SIGTERM');
    await until(() => cloud.exitCode !== null, 'Cloud child cleanup timed out', 15000).catch(() => cloud.kill());
  }
  await new Promise(done => cloudProxy ? cloudProxy.close(done) : done());
  report.finishedAt = new Date().toISOString();
  const reportName = process.argv.includes('--cloud-smoke') ? 'cloud-smoke.json' : process.argv.includes('--visual-smoke') ? 'visual-smoke.json' : process.argv.includes('--logout-recovery-smoke') ? 'logout-recovery-smoke.json' : 'verification.json';
  await writeFile(join(evidence, reportName), JSON.stringify(report, null, 2) + '\n');
  await rm(profile, { recursive: true, force: true });
  if (cloudRoot && process.platform === 'win32') {
    assert.match(cloudRoot, /^\/tmp\/weftmate-lg-1a-[a-zA-Z0-9]+$/);
    execFileSync('wsl.exe', ['-d', process.env.WEFTMATE_LG1_WSL_DISTRO || 'Ubuntu', '--exec', 'rm', '-rf', '--', cloudRoot], { windowsHide: true });
  } else if (cloudRoot) await rm(cloudRoot, { recursive: true, force: true });
}
console.log(JSON.stringify({ passed: report.passed, steps: report.steps, evidence: 'tests/evidence/lg-1a' }));
