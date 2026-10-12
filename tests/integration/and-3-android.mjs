process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, writeFile, open, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createServer, request as httpRequest } from 'node:http';
import { chromium } from 'playwright';
import { startAnd3Fixture } from './and-3-fixture.mjs';
import { systemBarDifference } from '../../scripts/nightly/system-bars.mjs';
import { pixels } from '../../scripts/nightly/report.mjs';

const repo = resolve(import.meta.dirname, '../..'), out = join(repo, 'tests/evidence/and-3');
const local = process.platform === 'win32';
const adb = process.env.AND3_ADB || 'D:/Software/MuMuPlayer/nx_main/adb.exe';
const pkg = 'com.memoweft.weftmate.mobile.and3qa';
let serial = process.env.AND3_SERIAL, heavy, lock, installed, testInstalled, probe, browser, page, forward, fixture, gate, offline = false;
let originalSize, originalDensity, probeLog = '', reversed = [];
const report = { realNativeShell: true, realNativeTransport: true, syntheticCloud: true, syntheticHost: true,
  modelRequests: 0, mimoRequests: 0, checks: [], screenshots: [], cleanup: {}, errors: [] };
const pause = ms => new Promise(done => setTimeout(done, ms));
const execute = (file, args, options = {}) => execFileSync(file, args, { windowsHide: true, timeout: 20000, maxBuffer: 24 * 1024 * 1024, ...options });
const run = (...args) => execute(adb, ['-s', serial, ...args]).toString();
async function until(check, label, milliseconds = 45000) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) { try { const result = await check(); if (result) return result; } catch {} await pause(200); }
  throw Error('AND-3 timed out: ' + label);
}
async function takeLock(path, purpose) { const file = await open(path, 'wx'); await file.writeFile('AND-3 ' + new Date().toISOString() + ' ' + purpose); await file.close(); return path; }
async function attach() {
  const pid = await until(() => run('shell', 'pidof', pkg).trim(), 'native process');
  forward = run('forward', 'tcp:0', 'localabstract:webview_devtools_remote_' + pid).trim();
  await until(async () => { browser = await chromium.connectOverCDP('http://127.0.0.1:' + forward, { noDefaults: true }); return browser; }, 'WebView');
  page = await until(() => browser.contexts()[0].pages().find(row => row.url().includes('appassets')), 'packaged interface');
  page.setDefaultTimeout(35000);
  page.on('pageerror', error => report.errors.push(error.message));
  await page.waitForFunction(() => typeof state !== 'undefined' && state.booted);
}
async function finishProbe() {
  if (probe?.exitCode === null) { run('shell', 'run-as', pkg, 'touch', 'files/and3-probe.done'); await until(() => probe.exitCode !== null, 'probe exit', 15000); }
  if (probe) assert.match(probeLog, /OK \(1 test\)/);
  await browser?.close(); browser = null; page = null;
  if (forward) run('forward', '--remove', 'tcp:' + forward); forward = null;
}
async function startProbe() {
  probeLog = '';
  probe = spawn(adb, ['-s', serial, 'shell', 'am', 'instrument', '-w', '-e', 'class',
    'com.memoweft.weftmate.mobile.And3ShellProbeTest', '-e', 'host', fixture.origin,
    pkg + '.test/androidx.test.runner.AndroidJUnitRunner'], { windowsHide: true });
  probe.stdout.on('data', value => { probeLog += value; }); probe.stderr.on('data', value => { probeLog += value; });
  await attach();
}
function bottomDifference(png, height) {
  if (!(height > 2)) return null;
  const image = pixels(png), average = (y0, y1) => {
    const sum = [0, 0, 0]; let count = 0;
    // Exclude the real gesture handle / navigation button glyphs.
    for (let y = y0; y < y1; y++) for (let x = 2; x < image.width * .16; x++) {
      for (let c = 0; c < 3; c++) sum[c] += image.rgba[(y * image.width + x) * 4 + c]; count++;
    }
    return sum.map(value => value / count);
  };
  const bar = average(image.height - height + 2, image.height - 2), content = average(image.height - height - 3, image.height - height - 1);
  return { bar, content, delta: Math.max(...bar.map((value, i) => Math.abs(value - content[i]))) };
}
async function shot(scene, theme) {
  await page.evaluate(theme => applyTheme(theme), theme); await pause(450);
  const geometry = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scale: devicePixelRatio,
    pageTheme: document.documentElement.dataset.theme,
    top: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--native-safe-top')) || 0,
    bottom: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--native-safe-bottom')) || 0,
    overflow: document.documentElement.scrollWidth > innerWidth,
    tabs: [...document.querySelectorAll('.mobile-tab')].map(row => row.getAttribute('aria-label') || row.textContent) }));
  assert.equal(geometry.pageTheme, theme); assert.equal(geometry.overflow, false, scene);
  const png = execute(adb, ['-s', serial, 'exec-out', 'screencap', '-p']);
  const file = `${local ? 'mumu' : 'cloud'}-${geometry.width}-${theme}-${scene}.png`;
  await writeFile(join(out, file), png);
  const status = systemBarDifference(png, { statusHeight: geometry.top * geometry.scale });
  const navigation = bottomDifference(png, Math.round(geometry.bottom * geometry.scale));
  const native = JSON.parse(run('shell', 'run-as', pkg, 'cat', 'files/and3-window.json'));
  assert.equal(native.darkStatusIcons, theme === 'light', file + ' status icons');
  if (geometry.bottom > 0) assert.equal(native.darkNavigationIcons, theme === 'light', file + ' navigation icons');
  assert.ok(status.passed, file + ' status color');
  if (!local) { assert.ok(geometry.bottom > 0, 'Real SystemUI navigation area required'); assert.ok(navigation.delta <= 18, file + ' navigation color'); }
  report.screenshots.push({ file, ...geometry, osVersion: report.osVersion, systemTheme: run('shell', 'cmd', 'uimode', 'night').trim(),
    bottomNavigationVisible: geometry.bottom > 0, native, status, navigation });
}
async function both(scene) { for (const theme of ['light', 'dark']) await shot(scene, theme); }
async function login(method) {
  if (method === 'code') await page.getByRole('button', { name: '用邮箱验证码登录', exact: true }).click();
  await page.getByLabel('邮箱', { exact: true }).fill(fixture.email);
  if (method === 'password') await page.getByLabel('密码', { exact: true }).fill(fixture.password);
  await page.locator('#cloud-auth-form [type=submit]').click();
  await page.getByLabel('邮箱验证码', { exact: true }).waitFor(); await both(method + '-email-confirm');
  const challenge = fixture.cloud.db.prepare('SELECT id FROM email_challenges WHERE consumed=0 ORDER BY rowid DESC LIMIT 1').get();
  assert.ok(challenge); await page.getByLabel('邮箱验证码', { exact: true }).fill(await fixture.cloud.mailCode(challenge.id));
  await page.locator('#cloud-auth-form [type=submit]').click();
  await page.waitForFunction(() => state.loggedIn && !document.body.classList.contains('cloud-auth-active'));
  assert.equal(await page.locator('#cloud-wait-view').isVisible(), false);
  report.checks.push(method + '-real-native-login-mail-confirm-direct-host-trust');
}
async function scene(name, ready, capture = name) {
  await page.evaluate(name => page(name), name);
  if (ready) await page.getByText(ready, { exact: false }).first().waitFor();
  await pause(500);
  const text = await page.locator('#generic-page').innerText();
  assert.ok(!/暂时无法读取|暂不可读取|未能读取/.test(text), name + ': ' + text);
  await both(capture); report.checks.push('native-page-' + name);
}
try {
  await mkdir(out, { recursive: true });
  if (local) {
    const orchestrator = 'D:/AIProjects/WeftMate/Runtime/Orchestrator';
    while (!heavy) {
      for (let slot = 1; slot <= 3; slot++) { try { heavy = await takeLock(join(orchestrator, `heavy-${slot}.lock`), 'native acceptance'); break; } catch (error) { if (error.code !== 'EEXIST') throw error; } }
      if (!heavy) { console.log('AND-3 waiting for a heavy slot'); await pause(120000); }
    }
    lock = await takeLock(join(orchestrator, 'mumu.lock'), 'native acceptance');
    const info = JSON.parse(execute('D:/Software/MuMuPlayer/nx_main/MuMuManager.exe', ['info', '-v', '0']).toString());
    assert.ok(info.is_android_started); assert.ok(Number(info.adb_port) > 0); serial = '127.0.0.1:' + info.adb_port;
    execute(adb, ['connect', serial]);
  }
  assert.ok(serial);
  assert.ok(!run('shell', 'pm', 'list', 'packages', pkg).includes(pkg), 'Never overwrite an existing test installation');
  assert.deepEqual(run('shell', 'ps', '-A').split('\n').filter(row => row.includes('com.memoweft.weftmate')), [], 'Another WeftMate app is active');
  originalSize = run('shell', 'wm', 'size'); originalDensity = run('shell', 'wm', 'density');
  run('shell', 'wm', 'density', '160'); run('shell', 'wm', 'size', '390x844');
  report.osVersion = run('shell', 'getprop', 'ro.build.version.release').trim();
  fixture = await startAnd3Fixture();
  gate = createServer((request, response) => {
    if (offline) { response.writeHead(503, { 'content-type': 'application/json' }); response.end('{"error":{"code":"HOST_UNAVAILABLE"}}'); return; }
    const upstream = httpRequest(fixture.origin + request.url, { method: request.method, headers: request.headers }, reply => { response.writeHead(reply.statusCode, reply.headers); reply.pipe(response); });
    upstream.on('error', () => { response.writeHead(503, { 'content-type': 'application/json' }); response.end('{"error":{"code":"HOST_UNAVAILABLE"}}'); }); request.pipe(upstream);
  });
  await new Promise(done => gate.listen(0, '127.0.0.1', done));
  for (const [port, target] of [[new URL(fixture.origin).port, gate.address().port], [new URL(fixture.cloud.origin).port, new URL(fixture.cloud.origin).port]]) {
    run('reverse', 'tcp:' + port, 'tcp:' + target); reversed.push(port);
  }
  run('install', join(repo, 'apps/android/app/build/outputs/apk/debug/app-debug.apk')); installed = true;
  run('install', join(repo, 'apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk')); testInstalled = true;
  // Grant the isolated test identity's existing notification permission before
  // capturing app pages, so the OS permission dialog cannot cover the evidence.
  run('shell', 'pm', 'grant', pkg, 'android.permission.POST_NOTIFICATIONS');
  await startProbe(); await both('password-login'); await login('password');
  await page.waitForFunction(() => state.logicalChats);
  await page.evaluate(async () => { state.model = await call('models.selectHost', { profileId: 'local' }); updateComposer(); });
  await page.locator('#draft').fill('原生壳里的合成问候'); await page.getByRole('button', { name:'发送', exact:true }).click();
  await until(() => fixture.candidate.operations.some(row => row.kind === 'message' && row.text === '原生壳里的合成问候'), 'real native main message');
  fixture.candidate.progress.text('合成回复：原生壳里的合成问候'); fixture.candidate.progress.finish();
  report.mainReply = await page.evaluate(async () => ({ selected:uiCore.state.selectedChatId, session:state.sharedSessionId,
    reply:await call('host.business',{path:'/personal/v1/chats/'+encodeURIComponent(uiCore.state.selectedChatId)+'/events',method:'GET'}) }));
  await page.getByText('合成回复：原生壳里的合成问候', {exact:true}).first().waitFor();
  report.checks.push('real-native-main-chat-send-and-synthetic-reply'); await both('chat');
  await scene('activity', '这周回顾'); await scene('health', '接上后，这里会显示你自己的记录'); await scene('goals', '目标'); await scene('library', '成果');
  await scene('settings', '设置'); await scene('approvals', '权限'); await scene('executionRecords', '执行记录'); await scene('system', '系统状态');
  await scene('notifications', '回顾与洞察', 'review-settings');
  await page.getByText('健康数据', { exact: true }).first().scrollIntoViewIfNeeded(); await both('health-settings');
  await page.evaluate(async id => { await selectSharedSession(id); page('chat'); }, fixture.candidate.sessionId);
  await page.getByText('另一个模型看过', { exact: false }).first().waitFor(); await both('approval-second-opinion');
  report.checks.push('native-approval-second-opinion-visible');
  await page.locator('#draft').fill('保留的合成草稿'); offline = true;
  for (let n = 0; n < 4; n++) { await page.evaluate(() => { void uiCore.retryConnection(); }); await pause(1200); }
  await page.waitForFunction(() => uiCore.connectionView().kind === 'host_offline', null, { timeout: 55000 });
  assert.equal(await page.evaluate(() => state.loggedIn), true); assert.equal(await page.locator('#draft').inputValue(), '保留的合成草稿'); await both('computer-offline');
  offline = false; await page.evaluate(() => uiCore.retryConnection()); await page.waitForFunction(() => uiCore.connectionView().kind === 'online');
  await both('computer-retry-restored'); report.checks.push('native-computer-offline-retry-preserves-cache-and-draft');
  await finishProbe(); run('shell', 'am', 'force-stop', pkg); await startProbe();
  assert.equal(await page.evaluate(() => state.loggedIn), true); report.checks.push('native-process-reopen-cached-account-without-login');
  // Expire only the synthetic phone session; its cached content stays readable.
  const device = await page.evaluate(() => state.deviceId); await fixture.expire(device);
  await page.evaluate(async () => { try { await uiCore.readMobileSystem(); } catch {} });
  await page.waitForFunction(() => state.connection === 'expired');
  assert.equal(await page.locator('#cloud-login-dialog').count(), 0); assert.equal(await page.evaluate(() => state.loggedIn), true);
  await both('expired-cache-readable'); await page.evaluate(() => { state.connection = 'expired'; send(); });
  report.expiredPrompt = await page.evaluate(() => ({ native:!!window.weftNative, cloudView:WeftMobileCloud.core.cloudAuthView(),
    dialogCount:document.querySelectorAll('#cloud-login-dialog').length, dialogOpen:document.getElementById('cloud-login-dialog')?.open,
    currentView:WeftMobileCloud.core.state.currentView }));
  await page.getByRole('dialog', { name: '登录以使用云端功能' }).waitFor(); await both('server-use-login-prompt');
  await page.getByRole('button', { name: '关闭登录', exact: true }).click();
  assert.equal(await page.evaluate(() => state.loggedIn), true); report.checks.push('expired-native-cache-readable-server-use-dismissible-login');
  await finishProbe(); run('shell', 'am', 'force-stop', pkg); run('shell', 'pm', 'clear', pkg);
  run('shell', 'pm', 'grant', pkg, 'android.permission.POST_NOTIFICATIONS');
  await startProbe(); await both('code-login'); await login('code'); await both('code-signed-in');
  await finishProbe(); report.completed = true;
} catch (error) {
  report.completed = false; report.failure = String(error).replace(/C:[\\/]Users[\\/][^\\/\s]+/gi, 'C:/Users/<user>');
  try { if (page) report.visibleFailure = await page.locator('body').innerText(); } catch {}
  try { if (page) report.uiFailure = await page.evaluate(() => ({ page:state.page,chatSource:state.chatSource,logical:state.logicalChats,
    connection:uiCore.connectionView(),main:uiCore.state.mainChat,selected:uiCore.state.selectedChatId,identity:uiCore.state.identityGeneration,
    historyResult:uiCore.state.historyReadResult,historyGeneration:uiCore.state.historyGeneration,refreshing:uiCore.mainChatRefreshing,
    events:[...(uiCore.state.chatWindow?.events?.values?.() || [])],pollActive:!!state.sharedPollTimer,
    cloud:WeftMobileCloud.core.cloudAuthView(),cloudDialog:document.getElementById('cloud-login-dialog')?.open })); } catch {}
  try { if (serial && installed) await writeFile(join(out, (local ? 'mumu' : 'cloud') + '-failure.png'), execute(adb, ['-s', serial, 'exec-out', 'screencap', '-p'])); } catch {}
  throw error;
} finally {
  try { await finishProbe(); } catch { if (probe?.exitCode === null) { probe.kill(); report.cleanup.killedProbe = 1; } }
  await browser?.close().catch(() => {});
  if (serial) {
    if (forward) try { run('forward', '--remove', 'tcp:' + forward); } catch {}
    for (const port of reversed) try { run('reverse', '--remove', 'tcp:' + port); } catch {}
    for (const [property, original] of [['size', originalSize], ['density', originalDensity]]) if (original) try { run('shell', 'wm', property, original.match(/Override [^:]+:\s*([^\r\n]+)/)?.[1] || 'reset'); } catch {}
    if (testInstalled) run('uninstall', pkg + '.test'); if (installed) run('uninstall', pkg);
    execute(adb, ['disconnect', serial]); report.cleanup.testPackagesRemoved = true; report.cleanup.adbDisconnected = true;
  }
  if (gate) { gate.closeAllConnections(); await new Promise(done => gate.close(done)); }
  await fixture?.close();
  if (lock) await unlink(lock); if (heavy) await unlink(heavy);
  report.cleanup.locksReleased = true;
  await writeFile(join(out, (local ? 'mumu' : 'cloud') + '-verification.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ completed: report.completed, checks: report.checks.length, screenshots: report.screenshots.length, modelRequests: 0 }));
