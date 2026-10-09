/** Real desktop entrypoint/DSH/Core + synthetic cloud, loopback TCP relay, real MiMo. */
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { createServer, connect } from 'node:net';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';

const repository = resolve(import.meta.dirname, '../..'), evidence = join(repository, 'tests/evidence/m3-a');
const android = process.argv.includes('--android'), packageName = 'com.memoweft.weftmate.mobile.m3a';
const adb = 'D:/Software/MuMuPlayer/nx_main/adb.exe', serial = '127.0.0.1:7555';
const adbRun = (...args) => execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
let instrumentation, installed = false, debugPort;
const root = await mkdtemp(join(tmpdir(), 'weftmate-m3a-e2e-')), profile = join(root, 'profile');
await mkdir(profile); await mkdir(evidence, { recursive: true });
await writeFile(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const key = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "[Console]::Out.Write([Environment]::GetEnvironmentVariable('MIMO_API_KEY','Machine'))"], { encoding: 'utf8', windowsHide: true }).trim();
assert.ok(key, 'MiMo environment key required');
const report = { syntheticAccounts: true, realDesktop: true, realCore: true, cloud: 'local WSL', relay: 'loopback TCP fixture', checks: [], usage: [], requests: 0 };
let cloud, cloudProxy, relay, app, page, browser, mobile, cloudConfig, desktopAuth, phoneAuth, hostId, modelId, controller;
const sockets = new Set(), pending = new Map(); let nextId = 0, diagnostics = '';
const pause = ms => new Promise(done => setTimeout(done, ms));
async function until(fn, label, timeout = 90000) { const end = Date.now() + timeout; while (Date.now() < end) { const result = await fn(); if (result) return result; await pause(300); } throw Error(label); }
async function freePort() { const server = createServer(); await new Promise(done => server.listen(0, '127.0.0.1', done)); const port = server.address().port; await new Promise(done => server.close(done)); return port; }
const hostPort = await freePort(), relayPort = await freePort();
const hostOrigin = `http://127.0.0.1:${hostPort}`, relayOrigin = `http://127.0.0.1:${relayPort}`;
function cleanEnv() { return Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(WEFTMATE_|MEMOWEFT_|CLOUD_)/.test(name) && !['ELECTRON_RUN_AS_NODE', 'MIMO_API_KEY'].includes(name))); }
function bridge(port, targetPort, address = '127.0.0.1') {
  const server = createServer(socket => { const upstream = connect(targetPort, address); sockets.add(socket); sockets.add(upstream);
    socket.on('close', () => sockets.delete(socket)); upstream.on('close', () => sockets.delete(upstream));
    socket.on('error', () => upstream.destroy()); upstream.on('error', () => socket.destroy()); socket.pipe(upstream).pipe(socket); });
  return new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => done(server)); });
}
function rpc(input) { const id = ++nextId; return new Promise((resolve, reject) => {
  const timeout = setTimeout(() => { pending.delete(id); reject(Error('cloud fixture RPC timeout: ' + input.action)); }, 30000);
  pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } }); cloud.stdin.write(JSON.stringify({ id, ...input }) + '\n'); }); }
async function api(path, body, auth = desktopAuth, method = body === undefined ? 'GET' : 'POST', origin = hostOrigin) {
  const response = await fetch(origin + '/personal/v1' + path, { method, headers: { origin: hostOrigin,
    ...(auth ? { cookie: auth.cookie, 'x-weftmate-csrf': auth.csrfToken } : {}), 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000) });
  return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function exchange(device, route, resource) {
  const nonce = (await api('/auth/cloud-nonce', {}, null)).body.nonce;
  const material = await rpc({ action: 'exchange', device, url: hostOrigin + '/personal/v1' + route, nonce, resource });
  const response = await fetch(hostOrigin + '/personal/v1' + route, { method: 'POST', headers: { origin: hostOrigin, dpop: material.dpop, 'content-type': 'application/json' },
    body: JSON.stringify({ accessToken: material.accessToken, deviceName: material.deviceName }) });
  return { ...await response.json(), status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function startHost() {
  app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: repository,
    args: [repository, `--user-data-dir=${profile}`, '--personal-host', `--access-port=${hostPort}`, `--personal-memory-config=${join(root, 'memory.json')}`],
    env: { ...cleanEnv(), WEFTMATE_CLOUD_ISSUER: cloudConfig.issuer, WEFTMATE_CLOUD_ALLOW_INSECURE_LOOPBACK: 'true', WEFTMATE_CLOUD_WEB_CLIENT_ID: 'test-native' }, timeout: 90000 });
  const capture = part => { diagnostics = (diagnostics + String(part).replaceAll(key, '[redacted]')).slice(-100000); };
  app.process().stdout?.on('data', capture); app.process().stderr?.on('data', capture);
  page = await app.firstWindow({ timeout: 90000 });
  await until(async () => { try { return (await api('/cloud/config', undefined, null)).status === 200; } catch { return false; } }, 'desktop did not listen');
}
async function command(body) {
  const accepted = await api('/commands', { requestId: randomUUID(), targetDeviceId: hostId, ...body });
  assert.equal(accepted.status, 202, JSON.stringify(accepted.body));
  const result = await until(async () => { const { command } = (await api('/commands/' + accepted.body.command.commandId)).body; return ['pending', 'dispatching'].includes(command.state) ? null : command; }, 'command not accepted');
  assert.equal(result.state, 'accepted_by_dsh', JSON.stringify(result)); return result;
}
async function chat(text) {
  const created = await command({ kind: 'session.create', modelProfileId: modelId });
  const sent = await command({ kind: 'session.message', sessionId: created.sessionId, text });
  const events = await until(async () => { const result = (await api(`/sessions/${created.sessionId}/events?limit=200`)).body.events;
    return result?.some(e => e.type === 'turn.ended') ? result : null; }, 'real model turn not complete', 180000);
  report.requests++;
  return { sessionId: created.sessionId, text: events.filter(e => e.type === 'assistant.message').map(e => e.data.text).join('\n'), events };
}
async function formal(pattern) { return until(async () => (await api('/memory/items?kind=cognition')).body.items?.find(i => i.currentState === 'current' && pattern.test(i.text)), 'Core did not form formal memory', 180000); }
async function scan(directory, needles) {
  let files = 0, matches = [];
  async function walk(dir) { for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const file = join(dir, entry.name); if (entry.isDirectory()) await walk(file); else if (entry.isFile()) {
      const bytes = await readFile(file).catch(() => null); if (!bytes) continue; files++;
      if (needles.some(text => bytes.includes(Buffer.from(text)) || bytes.includes(Buffer.from(text, 'utf16le')))) matches.push(entry.name);
    }
  } } await walk(directory); return { files, matches };
}
try {
  cloud = spawn('wsl.exe', ['-d', 'Ubuntu', '--exec', '/tmp/weftmate-s1d-node/bin/node', '/mnt/d/AIProjects/WeftMate/Worktrees/w2/tests/integration/m3-a-cloud-fixture.mjs'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: cleanEnv() });
  cloud.stderr.on('data', () => {});
  createInterface({ input: cloud.stdout }).on('line', line => { try { const data = JSON.parse(line); if (data.ready) cloudConfig = data;
    else if (pending.has(data.id)) { const task = pending.get(data.id); pending.delete(data.id); data.error ? task.reject(Error(data.error)) : task.resolve(data.value); } } catch {} });
  await until(() => cloudConfig, 'cloud fixture did not start');
  const address = execFileSync('wsl.exe', ['-d', 'Ubuntu', '--exec', 'hostname', '-I'], { encoding: 'utf8', windowsHide: true }).trim().split(/\s+/)[0];
  const forwarded = await fetch(cloudConfig.origin + '/healthz', { signal: AbortSignal.timeout(2000) }).then(r => r.ok).catch(() => false);
  if (!forwarded) cloudProxy = await bridge(Number(new URL(cloudConfig.origin).port), Number(new URL(cloudConfig.origin).port), address);
  relay = await bridge(relayPort, hostPort);
  await writeFile(join(root, 'memory.json'), JSON.stringify({ python: 'D:/AIProjects/MemoWeft/Core/py/.venv/Scripts/python.exe',
    pythonPath: 'D:/AIProjects/MemoWeft/Core/py/src', baseUrl: `http://127.0.0.1:${hostPort}/v1`, model: '@current', authRef: 'm3a' }));
  await startHost();
  desktopAuth = await exchange('desktop', '/auth/cloud-desktop'); assert.equal(desktopAuth.status, 200, JSON.stringify(desktopAuth));
  hostId = (await api('/status')).body.hostId;
  const selected = await rpc({ action: 'control', device: 'phone', route: '/hosts/connect', body: { hostId } });
  phoneAuth = await exchange('phone', '/auth/cloud-session', selected.resource); assert.equal(phoneAuth.status, 202);
  assert.equal((await api(`/cloud/devices/${phoneAuth.requestId}/decision`, { decision: 'allow' })).status, 200);
  phoneAuth = await exchange('phone', '/auth/cloud-session', selected.resource); assert.equal(phoneAuth.status, 200);
  const requestId = randomUUID(); assert.equal((await api('/account/models', { requestId, name: 'M3-A MiMo', baseUrl: 'https://api.xiaomimimo.com/v1', modelId: 'mimo-v2.6-flash', apiKey: key, modelTier: 'cloud' })).status, 202);
  await until(async () => (await api('/account/models/by-request/' + requestId)).body.operation?.status === 'succeeded', 'model setup failed');
  modelId = (await api('/models')).body.models.find(m => m.name === 'M3-A MiMo').id;
  assert.equal((await api('/settings/models', { defaultModelProfileId: modelId, backgroundModelProfileId: modelId }, desktopAuth, 'PATCH')).status, 200);
  const first = await chat('请记住我的日常喝咖啡偏好：加一小撮肉桂粉，不加糖。简短确认即可。');
  await formal(/肉桂/); report.checks.push('real desktop turn formed a formal coffee preference'); console.log('M3-A: formal memory formed');
  const identity = { origin: hostOrigin, ownerId: phoneAuth.account.ownerId, hostId, deviceId: phoneAuth.device.id };
  if (android) {
    assert.ok(!adbRun('shell', 'ps', '-A').split('\n').some(row => /weftmate.*qa/.test(row)), 'QA is using MuMu');
    adbRun('install', join(repository, 'apps/android/app/build/outputs/apk/debug/app-debug.apk'));
    installed = true;
    adbRun('install', join(repository, 'apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'));
    const cryptoTest = adbRun('shell', 'am', 'instrument', '-w', '-e', 'class', 'com.memoweft.weftmate.mobile.M3aOfflineVaultTest', `${packageName}.test/androidx.test.runner.AndroidJUnitRunner`);
    assert.match(cryptoTest, /OK \(1 test\)/); report.checks.push('native Keystore-wrapped device encryption, secret isolation and old-key erasure');
    adbRun('reverse', `tcp:${hostPort}`, `tcp:${relayPort}`);
    adbRun('reverse', `tcp:${new URL(cloudConfig.origin).port}`, `tcp:${new URL(cloudConfig.origin).port}`);
    execFileSync(adb, ['-s', serial, 'shell', 'run-as', packageName, 'sh', '-c', '"mkdir -p files; cat > files/m3a-identity.json"'], {
      input: JSON.stringify({ ...identity, cookie: phoneAuth.cookie, csrf: phoneAuth.csrfToken }), windowsHide: true });
    instrumentation = spawn(adb, ['-s', serial, 'shell', 'am', 'instrument', '-w', '-e', 'class', 'com.memoweft.weftmate.mobile.M3aOfflineProbeTest', '-e', 'm3aProbe', '1', `${packageName}.test/androidx.test.runner.AndroidJUnitRunner`], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    instrumentation.stdout.on('data', () => {}); instrumentation.stderr.on('data', () => {});
    const pid = await until(() => { try { return adbRun('shell', 'pidof', packageName).trim(); } catch { return null; } }, 'native app did not start');
    debugPort = await freePort(); adbRun('forward', `tcp:${debugPort}`, `localabstract:webview_devtools_remote_${pid}`);
    await until(async () => { try { return (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).some(row => row.url.includes('appassets')); } catch { return false; } }, 'native WebView not available');
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { noDefaults: true });
    mobile = browser.contexts()[0].pages().find(p => p.url().includes('appassets'));
  } else {
    browser = await chromium.launchPersistentContext(join(root, 'browser'), { headless: true, viewport: { width: 390, height: 844 } });
    mobile = await browser.newPage();
  }
  await mobile.addInitScript(() => {
    let implementation; globalThis.__m3aViews = [];
    Object.defineProperty(globalThis, 'WeftOfflineView', { configurable: true, get: () => implementation, set: value => {
      implementation = value; const mount = value.mount;
      value.mount = options => { const view = mount(options); if (view) globalThis.__m3aViews.push(view); return view; };
    } });
  });
  // The fixture supplies only an already approved session; all feature endpoints are production handlers.
  if (!android) {
    const [name, value] = phoneAuth.cookie.split('='); await browser.addCookies([{ name, value, url: hostOrigin }]);
    await mobile.goto(hostOrigin + '/personal/v1/ui/');
  } else { await mobile.reload(); await mobile.waitForFunction(() => globalThis.WeftMobileCloud?.core); }
  mobile.on('pageerror', error => console.log('Phone UI error:', error.message));
  mobile.on('console', message => { if (message.type() === 'error') console.log('Phone console:', message.text().slice(0, 500)); });
  mobile.on('response', async response => { if (response.url().includes('api.xiaomimimo.com') && response.url().endsWith('/chat/completions')) {
    const usage = (await response.json().catch(() => ({}))).usage; if (usage) report.usage.push({ source: 'phone', usage });
  } });
  await mobile.exposeFunction('__m3aControl', hostId => rpc({ action: 'control', route: '/hosts/offline/status', body: { hostId } }));
  await mobile.exposeFunction('__m3aUsage', usage => report.usage.push({ source: 'android', usage }));
  await mobile.evaluate(async ({ identity, csrf, android }) => {
    for (const view of globalThis.__m3aViews || []) view.close();
    const nativeCall = async (...args) => { const result = await call(...args); if (args[0] === 'offline.complete' && result.usage) await __m3aUsage(result.usage); return result; };
    const host = async (path, body) => { if (android) return call('host.business', { path: '/personal/v1' + path, method: 'POST', body });
      const response = await fetch('/personal/v1' + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-weftmate-csrf': csrf }, body: JSON.stringify(body) });
      const result = await response.json(); if (!response.ok) throw Object.assign(new Error(result.error?.code), { status: response.status, code: result.error?.code }); return result; };
    globalThis.__m3aController = WeftOfflineView.mount({ core: { cloudOfflineStatus: globalThis.__m3aControl }, identity: async () => identity, nativeCall: android ? nativeCall : null, host });
    await globalThis.__m3aController.tick();
  }, { identity, csrf: phoneAuth.csrfToken, android });
  await mobile.getByRole('button', { name: '离线对话 · 已同步', exact: true }).waitFor({ timeout: 60000 });
  report.checks.push('approved phone encrypted replica synchronized'); console.log('M3-A: replica synced, stopping host');
  await app.close(); app = null;
  console.log('M3-A: host closed');
  await mobile.evaluate(() => globalThis.__m3aController.tick());
  console.log('M3-A: offline status checked');
  await mobile.getByRole('heading', { name: '离线模式', exact: true }).waitFor();
  await mobile.getByRole('textbox', { name: '离线消息' }).fill('我喝咖啡时喜欢加什么？');
  await mobile.getByRole('button', { name: '发送', exact: true }).last().click();
  console.log('M3-A: sent recall question');
  await until(async () => {
    const error = await mobile.locator('.offline-composer [role=status]').last().textContent();
    if (error?.includes('回复未完成')) throw Error('Offline reply failed: ' + error);
    return await mobile.locator('.offline-message.assistant').filter({ hasText: '肉桂' }).count() > 0;
  }, 'offline recall did not answer', 180000); report.requests++;
  await mobile.screenshot({ path: join(evidence, `${android ? 'android' : 'web'}-offline-memory.png`) });
  if (android) await writeFile(join(evidence, 'android-native-offline-memory.png'), execFileSync(adb, ['-s', serial, 'exec-out', 'screencap', '-p'], { windowsHide: true, maxBuffer: 12 * 1024 * 1024 }));
  report.checks.push('host stopped; MiMo answered with recalled coffee preference'); console.log('M3-A: host-offline recall answered');
  await mobile.getByRole('textbox', { name: '离线消息' }).fill('请记住我的徒步偏好：用墨绿色的双肩背包。');
  await mobile.getByRole('button', { name: '发送', exact: true }).last().click();
  await until(async () => await mobile.locator('.offline-message.assistant').count() === 2, 'offline preference not answered', 180000); report.requests++;
  await startHost(); await mobile.evaluate(() => globalThis.__m3aController.tick());
  await formal(/墨绿色/); report.checks.push('offline preference imported and formed a formal Core item');
  const next = await chat('我徒步时会选什么颜色的背包？'); assert.match(next.text, /墨绿/);
  report.checks.push('new desktop conversation recalled the imported preference');
  const old = await formal(/肉桂/), revision = (await api('/memory/status')).body.worldRevision;
  const forgotten = await api(`/memory/items/cognition/${old.id}`, { requestId: randomUUID(), expectedWorldRevision: revision, deleteConversationSnippets: true }, desktopAuth, 'DELETE');
  assert.equal(forgotten.status, 200, JSON.stringify(forgotten.body));
  await mobile.evaluate(() => globalThis.__m3aController.tick());
  await mobile.screenshot({ path: join(evidence, `${android ? 'android' : 'web'}-synced-after-forget.png`) });
  await browser.close(); browser = null;
  if (android) {
    const bytes = execFileSync(adb, ['-s', serial, 'exec-out', 'run-as', packageName, 'tar', '-cf', '-', 'files', 'no_backup', 'databases', 'shared_prefs', 'app_webview'], { windowsHide: true, maxBuffer: 100 * 1024 * 1024 });
    report.storageScan = { bytes: bytes.length, matches: ['肉桂粉', '墨绿色', key].filter(text => bytes.includes(Buffer.from(text)) || bytes.includes(Buffer.from(text, 'utf16le'))).map(() => 'private-marker') };
  } else report.storageScan = await scan(join(root, 'browser'), ['肉桂粉', '墨绿色', key]);
  assert.deepEqual(report.storageScan.matches, []);
  report.checks.push('phone profile byte scan contains no remembered text or credential');
  report.usage.push((await api('/usage')).body);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = String(error.message).replaceAll(key, '[redacted]');
  await writeFile(join(root, 'diagnostics.log'), diagnostics);
  if (mobile) await mobile.screenshot({ path: join(root, 'failure.png') }).catch(() => {});
  console.log('M3-A failure:', report.error);
  throw error;
} finally {
  await browser?.close().catch(() => {}); await app?.close().catch(() => {});
  if (android && installed) {
    try { adbRun('shell', 'run-as', packageName, 'touch', 'files/m3a-probe.done'); } catch {}
    try { adbRun('shell', 'am', 'force-stop', packageName); adbRun('uninstall', `${packageName}.test`); adbRun('uninstall', packageName); } catch {}
    for (const port of [String(hostPort), new URL(cloudConfig.origin).port]) try { adbRun('reverse', '--remove', `tcp:${port}`); } catch {}
    if (debugPort) try { adbRun('forward', '--remove', `tcp:${debugPort}`); } catch {}
    instrumentation?.kill();
  }
  for (const socket of sockets) socket.destroy();
  for (const server of [relay, cloudProxy]) if (server) await new Promise(done => server.close(done));
  if (cloud) { const closed = new Promise(done => cloud.once('exit', done)); cloud.stdin.end(); await Promise.race([closed, pause(10000)]); }
  await writeFile(join(evidence, `verification-${android ? 'android' : 'web'}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, checks: report.checks, root }));
}
