/** Real Android + Electron pairing. All accounts, cloud keys, ports and profiles are disposable. */
import './and-2-fixture.mjs';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer, request as httpRequest } from 'node:http';
import { mkdir, mkdtemp, open, unlink, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { _electron, chromium } from 'playwright';
import { fixture as cloudFixture } from '../../services/cloud/test/identity-helpers.mjs';
import { registration } from '../../services/cloud/test/app-helpers.mjs';
import { startAnd3Fixture } from './and-3-fixture.mjs';

const root = resolve(import.meta.dirname, '../..'), pkg = 'com.memoweft.weftmate.mobile.andpairqa';
const adb = process.env.AND_PAIR_ADB || 'D:/Software/MuMuPlayer/nx_main/adb.exe';
const out = process.env.WEFTMATE_EVIDENCE_DIR; assert.ok(out, 'Private evidence directory is required'); await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'wm-and-pair-'));
const lockRoot = process.env.WEFTMATE_HEAVY_LOCK_DIR; assert.ok(lockRoot);
const runFile = (file, args, options = {}) => execFileSync(file, args, { windowsHide: true, timeout: 20000, maxBuffer: 12 * 1024 ** 2, ...options });
let serial, fixture, cloud, gate, hostGate, browser, phone, application, desktop, forward, probe, installed, testInstalled;
let probeLog = ''; const locks = [], reversed = [], cleanups = [], errors = [], hostFailures = [];
const run = (...args) => runFile(adb, ['-s', serial, ...args]);
const pause = ms => new Promise(done => setTimeout(done, ms));
async function until(fn, label, timeout = 45000) { const end = Date.now() + timeout; while (Date.now() < end) { try { const value = await fn(); if (value) return value; } catch {} await pause(150); } throw Error('AND-PAIR: ' + label); }
async function lock(name) { const path = join(lockRoot, name), file = await open(path, 'wx'); await file.writeFile('AND-PAIR ' + new Date().toISOString()); await file.close(); locks.push(path); }
async function route(name) {
  assert.ok(['login', 'devices'].includes(name));
  run('shell', 'run-as', pkg, 'sh', '-c', `'echo ${name}:${crypto.randomUUID()} > files/and-pair.route'`);
}
async function shot(name) {
  await phone.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  await writeFile(join(out, name + '.png'), run('exec-out', 'screencap', '-p'));
}
async function startPairing() {
  await desktop.evaluate(() => testUi.openSettings('devices'));
  await desktop.waitForFunction(() => document.getElementById('settings-dialog').open);
  await desktop.locator('#cloud-pairing-open').click();
  await desktop.waitForFunction(() => document.getElementById('pairing-code').value.startsWith('wm1.'));
  return desktop.locator('#pairing-code').inputValue();
}
try {
  for (let i = 1; i <= 3; i++) { try { await lock('heavy-' + i + '.lock'); break; } catch (e) { if (e.code !== 'EEXIST') throw e; } }
  assert.equal(locks.length, 1, 'Heavy slot unavailable'); await lock('mumu.lock');
  const info = JSON.parse(runFile('D:/Software/MuMuPlayer/nx_main/MuMuManager.exe', ['info', '-v', '0']).toString());
  assert.ok(info.is_android_started); serial = '127.0.0.1:' + info.adb_port; runFile(adb, ['connect', serial]);
  assert.ok(!run('shell', 'pm', 'list', 'packages', pkg).toString().includes(pkg), 'Disposable package already installed');
  cloud = await cloudFixture({ after: fn => cleanups.push(fn) }, { realProcess: false, env: { CLOUD_OIDC_CLIENTS: JSON.stringify([
    { client_id: 'test-native', redirect_uris: ['com.example.weftmate:/callback'] },
    { client_id: 'weftmate-android', redirect_uris: ['com.memoweft.weftmate:/oauth'] }]) } });
  await registration(cloud); fixture = await startAnd3Fixture({ existingCloud: cloud });
  hostGate = createServer((request, response) => {
    const upstream = httpRequest(fixture.origin + request.url, { method: request.method, headers: request.headers }, reply => {
      response.writeHead(reply.statusCode, reply.headers);
      if (reply.statusCode >= 400) {
        const chunks = []; reply.on('data', data => chunks.push(data)); reply.on('end', () => {
          const bytes = Buffer.concat(chunks); let code;
          try { code = JSON.parse(bytes.toString()).error?.code; } catch {}
          hostFailures.push({ path: new URL(request.url, fixture.origin).pathname, status: reply.statusCode, code }); response.end(bytes);
        });
      } else reply.pipe(response);
    });
    upstream.on('error', () => { response.writeHead(503); response.end('{}'); }); request.pipe(upstream);
  });
  await new Promise(done => hostGate.listen(0, '127.0.0.1', done));
  gate = createServer((request, response) => { response.setHeader('content-type', 'application/json');
    if (request.url === '/personal/v1/cloud/config') return response.end(JSON.stringify({ issuer: cloud.config.issuer, hostId: 'unconnected', clientId: 'weftmate-android' }));
    response.writeHead(404); response.end('{}'); });
  await new Promise(done => gate.listen(0, '127.0.0.1', done));
  const gateOrigin = 'http://127.0.0.1:' + gate.address().port;
  for (const [port, target] of [[gate.address().port, gate.address().port], [Number(new URL(cloud.origin).port), Number(new URL(cloud.origin).port)], [Number(new URL(fixture.origin).port), hostGate.address().port]]) { run('reverse', 'tcp:' + port, 'tcp:' + target); reversed.push(port); }
  const env = { ...process.env, PAIR_CODE_PROFILE: profile, PAIR_CODE_ORIGIN: fixture.origin, PAIR_CODE_TOKEN: fixture.candidate.libraryDesktopToken }; delete env.ELECTRON_RUN_AS_NODE;
  application = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: root, args: ['tests/helpers/pair-code-electron.mjs'], env });
  application.process().stdout?.resume(); application.process().stderr?.resume(); desktop = await application.firstWindow();
  await desktop.route('**/personal/v1/ui/app.js', async request => request.fulfill({ contentType: 'text/javascript', body: (await readFile(join(root, 'src/personal-access-ui/app.js'), 'utf8')).replace('ui.loadAttachmentHasher =', 'globalThis.testCore=core;globalThis.testUi=ui;ui.loadAttachmentHasher =') }));
  await desktop.reload(); await desktop.waitForFunction(() => globalThis.testCore?.state.account);
  await desktop.getByRole('textbox', { name: '输入消息', exact: true }).waitFor();
  await desktop.waitForFunction(() => testCore.state.cloudAuth.restoreState === 'none');
  const material = await startPairing();
  run('install', join(root, 'apps/android/app/build/outputs/apk/debug/app-debug.apk')); installed = true;
  run('install', join(root, 'apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk')); testInstalled = true;
  const upgrade = run('shell', 'am', 'instrument', '-w', '-e', 'class',
    'com.memoweft.weftmate.mobile.PairingWebViewProbeTest#cachedSingleStepPairingPageUpgradesToBuiltInWithoutDeletingFiles',
    pkg + '.test/androidx.test.runner.AndroidJUnitRunner').toString();
  assert.match(upgrade, /OK \(1 test\)/, 'Cached UI upgrade: ' + upgrade);
  probe = spawn(adb, ['-s', serial, 'shell', 'am', 'instrument', '-w', '-e', 'class', 'com.memoweft.weftmate.mobile.PairingWebViewProbeTest#inspectPairing', '-e', 'host', gateOrigin, pkg + '.test/androidx.test.runner.AndroidJUnitRunner'], { windowsHide: true });
  probe.stdout.on('data', d => probeLog += d); probe.stderr.on('data', d => probeLog += d);
  const pid = await until(() => run('shell', 'pidof', pkg).toString().trim(), 'Android start');
  forward = run('forward', 'tcp:0', 'localabstract:webview_devtools_remote_' + pid).toString().trim();
  browser = await until(() => chromium.connectOverCDP('http://127.0.0.1:' + forward, { noDefaults: true }), 'WebView debugging');
  phone = await until(() => browser.contexts()[0].pages().find(page => page.url().includes('appassets')), 'packaged page');
  phone.on('pageerror', e => errors.push(e.message));
  await phone.waitForFunction(() => typeof state !== 'undefined' && state.booted);
  // Synthetic discovery only. All auth/DPoP/nonce/commit/reveal/redeem calls use Kotlin and the real host routes.
  await phone.evaluate(host => {
    globalThis.andPairRequests = [];
    globalThis.andPairEntering = 0; globalThis.andPairEntered = 0;
    const enter = WeftMobileCloud.core.enterAssistant;
    WeftMobileCloud.core.enterAssistant = async function (...args) {
      andPairEntering++;
      try { return await enter.apply(this, args); }
      finally { andPairEntering--; andPairEntered++; }
    };
    const call = androidBridge.call;
    androidBridge.call = async (method, params, ...rest) => {
      const result = await call(method, params, ...rest);
      if (method === 'cloud.app.request') {
        const path = new URL(params.url).pathname;
        if (path.endsWith('/hosts/connect')) Object.assign(result.body, { status: 'online', baseUrl: host });
        if (path.includes('/pairings/')) andPairRequests.push({ path, status: result.status, code: result.body?.error?.code });
      }
      return result;
    };
  }, fixture.origin);
  await route('login');
  await phone.waitForFunction(() => window.weftNativeRoute?.name === 'login');
  await phone.evaluate(() => WeftMobileCloud.core.startCloudJourney());
  await phone.getByLabel('邮箱', { exact: true }).waitFor();
  await phone.getByLabel('邮箱', { exact: true }).fill(fixture.email); await phone.getByLabel('密码', { exact: true }).fill(fixture.password);
  await phone.locator('#cloud-auth-form [type=submit]').click(); await phone.getByLabel('邮箱验证码', { exact: true }).waitFor();
  const challenge = cloud.db.prepare('SELECT id FROM email_challenges WHERE consumed=0 ORDER BY rowid DESC LIMIT 1').get();
  assert.ok(challenge);
  await phone.getByLabel('邮箱验证码', { exact: true }).fill(await cloud.mailCode(challenge.id));
  await phone.getByRole('button', { name: '确认并登录', exact: true }).click();
  await phone.waitForFunction(() => WeftMobileCloud.core.state.cloudAuth.cloudOnly && state.loggedIn);
  await phone.waitForFunction(() => window.weftNativeChatActive === true);
  await route('devices');
  await phone.getByLabel('输入电脑的配对码', { exact: true }).waitFor();
  await phone.getByLabel('输入电脑的配对码', { exact: true }).fill(material);
  await phone.getByRole('button', { name: '配对连接', exact: true }).click();
  await phone.getByText('请在电脑上核对这六位数字并确认', { exact: true }).waitFor();
  const number = (await phone.locator('#cloud-pairing-number').innerText()).replace(/\s/g, ''); assert.match(number, /^\d{6}$/);
  await desktop.waitForFunction(code => document.getElementById('pairing-number').textContent.replace(/\s/g, '') === code, number);
  await until(() => phone.evaluate(() => andPairRequests.some(r => r.code === 'PAIRING_CONFIRMATION_REQUIRED')), 'confirmation blocks redemption');
  await phone.evaluate(async () => { await androidBridge.call('settings.appearance', { value: 'light' }); applyTheme('light'); });
  await shot('compare-light'); await desktop.screenshot({ path: join(out, 'desktop-compare.png') });
  await phone.evaluate(async () => { await androidBridge.call('settings.appearance', { value: 'dark' }); applyTheme('dark'); }); await shot('compare-dark');
  await desktop.locator('#pairing-confirm').click();
  await phone.waitForFunction(() => !WeftMobileCloud.core.state.cloudAuth.pairing && !WeftMobileCloud.core.state.cloudAuth.cloudOnly);
  await desktop.getByRole('heading', { name: '配对成功', exact: true }).waitFor();
  await until(async () => await phone.evaluate(async () => (await call('auth.me')).connectionVerified === true), 'confirmed native session');
  await phone.waitForFunction(() => andPairEntered >= 1 && andPairEntering === 0);
  await phone.waitForFunction(() => window.weftNativeChatActive === true);
  await until(() => {
    const state = JSON.parse(run('shell', 'run-as', pkg, 'cat', 'files/and-pair-state.json').toString());
    return state.loggedIn && !state.loading && state.tab === 'chat';
  }, 'native confirmed account ready');
  await desktop.locator('#pairing-dismiss').click(); await route('devices');
  await until(() => {
    const state = JSON.parse(run('shell', 'run-as', pkg, 'cat', 'files/and-pair-state.json').toString());
    return state.loggedIn && state.webShown && state.webPage === 'devices';
  }, 'native device page visible');
  // The existing device now starts a fresh v2 round; cancellation must still stop it.
  const cancelled = await startPairing(); await phone.getByLabel('输入电脑的配对码', { exact: true }).fill(cancelled);
  await phone.getByRole('button', { name: '配对连接', exact: true }).click();
  await phone.getByText('请在电脑上核对这六位数字并确认', { exact: true }).waitFor();
  await desktop.locator('#pairing-cancel').click();
  await phone.getByText('电脑已取消配对，或配对码已失效。请重新扫码。', { exact: true }).first().waitFor();
  await phone.getByRole('button', { name: '重新扫码', exact: true }).waitFor();
  const native = JSON.parse(run('shell', 'run-as', pkg, 'cat', 'files/and-pair-state.json').toString());
  console.log('Native cancellation presentation', native, hostFailures);
  assert.equal(native.loggedIn, true, 'Pairing cancellation must preserve the active native account');
  assert.equal(native.webShown, true, 'The native shell must show the pairing failure');
  await shot('cancelled-dark');
  assert.deepEqual(errors, []);
  await writeFile(join(out, 'result.json'), JSON.stringify({ success: true, nativeEntry: true, nativeTransport: true, phoneComputesCode: true,
    comparisonMatches: true, confirmationRequiredBeforeRedeem: true, connected: true, cancelled: true,
    discovery: 'synthetic loopback mapping only', transport: 'synthetic HTTP loopback', requests: await phone.evaluate(() => andPairRequests), errors }, null, 2));
  console.log('AND-PAIR Android + Electron: same independent SAS, pre-confirm refusal, confirmed session, desktop cancellation passed');
} catch (error) {
  if (phone) { await shot('failure').catch(() => {}); console.log('Android view', await phone.evaluate(() => ({ mode: WeftMobileCloud.core.cloudAuthView().mode, error: WeftMobileCloud.core.cloudAuthView().error, pairing: WeftMobileCloud.core.cloudAuthView().pairing, requests: globalThis.andPairRequests })).catch(() => ({})), hostFailures); }
  throw error;
} finally {
  if (probe) { try { run('shell', 'run-as', pkg, 'touch', 'files/and-pair.done'); } catch {} await until(() => probe.exitCode !== null, 'probe exit', 10000).catch(() => {}); }
  await browser?.close().catch(() => {}); await application?.close().catch(() => {});
  if (forward) run('forward', '--remove', 'tcp:' + forward);
  for (const port of reversed) run('reverse', '--remove', 'tcp:' + port);
  if (testInstalled) run('uninstall', pkg + '.test'); if (installed) run('uninstall', pkg);
  if (serial) runFile(adb, ['disconnect', serial]);
  if (gate) await new Promise(done => { gate.close(done); gate.closeAllConnections(); });
  if (hostGate) await new Promise(done => { hostGate.close(done); hostGate.closeAllConnections(); });
  await fixture?.close(); for (const cleanup of cleanups.reverse()) await cleanup();
  await rm(profile, { recursive: true, force: true }); for (const path of locks.reverse()) await unlink(path);
}
