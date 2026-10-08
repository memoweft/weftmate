/** One visible-name flow for 390x844 Chromium and the actual Android WebView. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, join, extname } from 'node:path';
import { chromium } from 'playwright';
import { startFe1bFixture, fixtureTime } from './fe-1b-fixture.mjs';
import { baselineCommit, exportBaseline, repository } from './fe-1b-baseline.mjs';

const phase = process.argv.includes('--before') ? 'before' : 'after';
const device = process.argv.includes('--device');
const relocated = process.argv.includes('--relocated');
const mode = device ? 'mumu' : 'chromium';
const resultPrefix = relocated ? `relocated-${mode}` : `${phase}-${mode}`;
const evidence = join(repository, 'tests/evidence/fe-1b');
const apk = process.argv.includes('--apk') ? process.argv[process.argv.indexOf('--apk') + 1] : null;
const probeApk = process.argv.includes('--probe-apk') ? process.argv[process.argv.indexOf('--probe-apk') + 1] : null;
const adb = process.env.FE1B_ADB || 'D:/Software/MuMuPlayer/nx_main/adb.exe';
const serial = process.env.FE1B_SERIAL || '127.0.0.1:7555';
const packageName = 'com.memoweft.weftmate.mobile.fe1bqa';
const adbRun = (...args) => execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8', maxBuffer: 12 * 1024 * 1024 });
const delay = ms => new Promise(done => setTimeout(done, ms));
async function until(fn) { const deadline = performance.now() + 30000; while (performance.now() < deadline) { if (await fn()) return; await delay(100); } throw new Error('Fixture condition timed out'); }
const fixture = await startFe1bFixture();
assert.ok(!relocated || !device && phase === 'after', 'Relocation is a response-only current Chromium check');
const port = new URL(fixture.origin).port;
let browser, page, webServer, instrumentation, debugPort, nativeLogin = null, cookie = '', csrf = '', appearance = 'system';
let appInstalled = false, probeInstalled = false, instrumentationLog = '';
const errors = [], nativeRequests = [], checks = [];
await mkdir(evidence, { recursive: true });
async function request(path, method = 'GET', body) {
  const response = await fetch(fixture.origin + path, { method, headers: { origin: fixture.origin, cookie, 'content-type': 'application/json', ...(csrf ? { 'x-weftmate-csrf': csrf } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error?.code || `HTTP_${response.status}`);
  const cookies = response.headers.getSetCookie(); if (cookies.length) cookie = cookies.map(row => row.split(';')[0]).join('; ');
  if (value.csrfToken) csrf = value.csrfToken;
  return value;
}
const profile = payload => ({ loggedIn: true, ...payload.account, device: payload.device, deviceId: payload.device?.id, owner: fixture.ownerId, connectionVerified: true, backgroundSync: 'scheduled' });
async function bridge({ method, params = {} }) {
  nativeRequests.push({ method, params: method.startsWith('auth.') ? undefined : params });
  if (method === 'app.bootstrap') return { loggedIn: !!nativeLogin, username: nativeLogin?.username || '', owner: nativeLogin ? fixture.ownerId : '', deviceId: nativeLogin?.deviceId || '', model: null, busy: false, backgroundSync: 'scheduled', ui: { activeVersion: '0.8.6' } };
  if (method === 'auth.login' || method === 'auth.register') { const { username, password, deviceName, displayName } = params; nativeLogin = profile(await request(`/personal/v1/auth/${method.split('.')[1]}`, 'POST', { username, password, deviceName, ...(method === 'auth.register' ? { displayName } : {}) })); return nativeLogin; }
  if (method === 'auth.me') { if (!nativeLogin) throw Error('LOGIN_REQUIRED'); return profile(await request('/personal/v1/auth/me')); }
  if (method === 'auth.state') return request('/personal/v1/auth/state');
  if (method === 'settings.appearance') { if (params.value) appearance = params.value; return { value: appearance }; }
  if (method === 'conversations.list') return { conversations: [], source: 'phone' };
  if (method === 'shared.sessions.list') { if (!nativeLogin) throw Error('LOGIN_REQUIRED'); const result = await request('/personal/v1/sessions'); return { ...result, sessions: result.sessions.map(row => ({ ...row, source: 'host' })), source: 'host', hostAvailable: true }; }
  if (method === 'shared.sessions.events') { const query = new URLSearchParams(); for (const key of ['afterSeq', 'beforeSeq']) if (params[key] != null) query.set(key, params[key]); return { ...await request(`/personal/v1/sessions/${params.sessionId}/events?${query}`), source: 'host', sessionId: params.sessionId, hostAvailable: true }; }
  if (method === 'shared.sessions.eventDetail') return request(`/personal/v1/sessions/${params.sessionId}/events/${params.seq}/detail`);
  if (method === 'shared.approvals.list' || method === 'shared.questions.list') return request(`/personal/v1/sessions/${params.sessionId}/${method.includes('approvals') ? 'approvals' : 'questions'}`);
  if (method === 'shared.approvals.decide') return request(`/personal/v1/sessions/${params.sessionId}/approvals/${params.approvalId}`, 'POST', params);
  if (method === 'shared.tasks.detail') return request(`/personal/v1/tasks/${params.taskId}`);
  if (method === 'shared.artifacts.preview') return request(`/personal/v1/artifacts/${params.artifactId}/preview`);
  if (method === 'host.business') return request(params.path, params.method, params.body);
  if (method === 'shared.send' || method === 'shared.stop') { const kind = method === 'shared.send' ? 'session.message' : 'session.cancel'; const result = await request('/personal/v1/commands', 'POST', { ...params, kind, targetDeviceId: 'synthetic-host', ...(kind === 'session.message' ? { mode: 'queue' } : {}) }); return { source: 'host', sessionId: params.sessionId, requestId: params.requestId, state: 'accepted', command: result.command }; }
  if (method === 'shared.commands.byRequest') return { ...await request(`/personal/v1/commands/by-request/${params.requestId}`), source: 'host' };
  if (method === 'shared.commands.detail') return { ...await request(`/personal/v1/commands/${params.commandId}`), source: 'host' };
  if (method === 'shared.outbox.list' || method === 'shared.outbox.reconcile') return { source: 'host', commands: [] };
  if (method === 'shared.activity.list' || method === 'activity.list') return { activities: [] };
  if (method === 'attachments.list') return { attachments: [] };
  if (method === 'cloud.tokens') return { value: null };
  if (method === 'cloud.login.state') return { configured: false };
  return {};
}
try {
  if (device) {
    assert.ok(apk && probeApk, 'Device evidence requires --apk and --probe-apk');
    const installed = adbRun('shell', 'pm', 'list', 'packages');
    const running = adbRun('shell', 'ps', '-A').split('\n').filter(row => row.includes('weftmate'));
    assert.deepEqual(running, [], 'Another WeftMate application is running; do not take its MuMu slot');
    assert.ok(!installed.includes(`package:${packageName}\n`) && !installed.includes(`package:${packageName}.test`), 'Fresh isolated package required');
    adbRun('install', apk); appInstalled = true; adbRun('install', probeApk); probeInstalled = true; adbRun('reverse', `tcp:${port}`, `tcp:${port}`);
    instrumentation = spawn(adb, ['-s', serial, 'shell', 'am', 'instrument', '-w', '-e', 'class', 'com.memoweft.weftmate.mobile.Fe1bWebViewProbeTest', '-e', 'fe1bProbe', '1', `${packageName}.test/androidx.test.runner.AndroidJUnitRunner`], { stdio: ['ignore', 'pipe', 'pipe'] });
    instrumentation.stdout.on('data', value => { instrumentationLog += value; }); instrumentation.stderr.on('data', value => { instrumentationLog += value; });
    await until(() => { try { return adbRun('shell', 'pidof', packageName).trim(); } catch { return false; } });
    const reservation = createServer(); await new Promise(done => reservation.listen(0, '127.0.0.1', done)); debugPort = reservation.address().port; await new Promise(done => reservation.close(done));
    adbRun('forward', `tcp:${debugPort}`, `localabstract:webview_devtools_remote_${adbRun('shell', 'pidof', packageName).trim()}`);
    await until(async () => { try { const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json(); return targets.some(row => row.url.includes('appassets')); } catch { return false; } });
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { noDefaults: true }); page = browser.contexts()[0].pages().find(row => row.url().includes('appassets'));
    assert.ok(page, 'Real HybridActivity WebView must exist');
    checks.push('fresh isolated package and actual HybridActivity WebView');
  } else {
    const assets = phase === 'before' ? exportBaseline() : join(repository, 'apps/mobile-ui/www');
    webServer = createServer(async (req, res) => { try { const path = new URL(req.url, 'http://localhost').pathname; const file = resolve(assets, '.' + (path === '/' ? '/index.html' : path)); if (!file.startsWith(assets)) return res.writeHead(404).end(); res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[extname(file)] || 'application/octet-stream');
      const source = await readFile(file); res.end(relocated && path === '/layout.js' ? source.toString() + '\n/* Test response only: move the same named control to the composer. */\ndocument.querySelector(".composer-card").prepend(document.getElementById("outputs-button"));\n' : source);
    } catch { res.writeHead(404).end(); } });
    await new Promise(done => webServer.listen(0, '127.0.0.1', done));
    browser = await chromium.launch({ headless: true }); page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.exposeFunction('__fe1bNative', async payload => { try { return { id: payload.id, ok: true, result: await bridge(payload) }; } catch (error) { return { id: payload.id, ok: false, error: { code: error.message } }; } });
    await page.addInitScript(() => { window.weftNative = { postMessage(value) { window.__fe1bNative(JSON.parse(value)).then(result => window.weftNative.onmessage({ data: JSON.stringify(result) })); } }; });
  }
  page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(error.message));
  const fixClock = () => { const NativeDate = Date, fixed = Date.parse('2026-10-08T06:00:00.000Z'); globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return fixed; } }; };
  await page.addInitScript(fixClock);
  if (device) await page.reload(); else await page.goto(`http://127.0.0.1:${webServer.address().port}/`);
  await page.waitForFunction(() => typeof state !== 'undefined' && state.booted && state.page === 'home');
  async function click(locator) {
    await locator.waitFor({ state: 'visible' });
    if (!device) return locator.click();
    let box;
    // Account-scoped list refresh can replace a row between lookup and its screen coordinates.
    await until(async () => { try { await locator.scrollIntoViewIfNeeded(); box = await locator.boundingBox(); return !!box; }
      catch (error) { if (error.message.includes('not attached')) return false; throw error; } });
    const metrics = await page.evaluate(() => ({ dpr: devicePixelRatio, height: innerHeight }));
    const offset = 24 * metrics.dpr;
    adbRun('shell', 'input', 'tap', String(Math.round((box.x + box.width / 2) * metrics.dpr)), String(Math.round((box.y + box.height / 2) * metrics.dpr + offset)));
    await delay(250);
  }
  async function fill(locator, value) {
    if (!device) return locator.fill(value);
    await locator.evaluate((node, text) => { node.value = text; node.dispatchEvent(new Event('input', { bubbles: true })); }, value);
  }
  async function shot(name) {
    if (relocated) return;
    await delay(450); await page.evaluate(() => document.fonts.ready);
    await page.getByRole('button', { name: /已登录账户/ }).waitFor({ state: 'hidden' }).catch(() => {});
    if (!device) { await page.mouse.move(0, 0); await page.screenshot({ path: join(evidence, `${phase}-${mode}-${name}.png`), animations: 'disabled' }); }
    else await writeFile(join(evidence, `${phase}-${mode}-${name}.png`), execFileSync(adb, ['-s', serial, 'exec-out', 'screencap', '-p'], { maxBuffer: 12 * 1024 * 1024 }));
  }
  const button = (name, exact = true) => page.getByRole('button', { name, exact });
  const conversation = title => button(new RegExp(`^${title} [0-9]`), false);
  await click(button('登录或连接')); await page.getByRole('heading', { name: '电脑账户与连接', exact: true }).waitFor(); await shot('login');
  await fill(page.getByLabel('个人服务地址', { exact: true }), fixture.origin);
  await fill(page.getByLabel('账户名（3–64个字符）', { exact: true }), fixture.credentials.username);
  await fill(page.getByLabel('密码（注册时15–128个字符）', { exact: true }), fixture.credentials.password);
  await fill(page.getByLabel('设备名称', { exact: true }), '合成手机验收');
  await click(button('检查服务连接')); await button('注册新账户').waitFor();
  checks.push('existing login and registration form verified by real account-state route');
  await click(button('登录')); await page.waitForFunction(() => state.loggedIn); await click(button('返回'));
  await conversation('整理项目进展').waitFor(); await shot('list'); checks.push('real personal login and session list');
  await click(conversation('准备下周的安排')); await page.getByText('正在处理…', { exact: true }).waitFor(); await shot('running');
  await fill(page.getByRole('textbox', { name: '输入消息', exact: true }), '把安排写得简短一些');
  await click(button('停止'));
  await until(() => fixture.requests.some(row => row.method === 'POST' && row.path === '/personal/v1/commands' && row.body?.kind === 'session.cancel'));
  assert.equal(await page.getByRole('textbox', { name: '输入消息', exact: true }).inputValue(), '把安排写得简短一些');
  checks.push('stop through original native command receipt and retain draft');
  await click(button('返回')); await click(conversation('整理项目进展'));
  await fill(page.getByRole('textbox', { name: '输入消息', exact: true }), '把报告写得简短一些'); await click(button('发送'));
  await until(() => fixture.requests.some(row => row.method === 'POST' && row.path === '/personal/v1/commands' && row.body?.text === '把报告写得简短一些'));
  await page.getByText('把报告写得简短一些', { exact: true }).waitFor(); await shot('sent'); checks.push('send through account CSRF route and durable native command receipt');
  await click(button('返回')); await click(conversation('整理临时文件'));
  for (const name of ['允许一次', '总是允许此类', '拒绝']) await button(name).waitFor();
  await shot('approval'); await click(button(/^审批模式/, false)); await page.getByRole('menuitemradio', { name: /每次询问/ }).waitFor(); await shot('mode');
  await click(page.getByRole('menuitemradio', { name: /每次询问/ })); await page.waitForFunction(() => document.getElementById('approval-mode-label').textContent.includes('每次询问'));
  await click(button('允许一次')); await button('总是允许此类').waitFor({ state: 'hidden' }); await shot('resolved-approval');
  assert.ok(fixture.requests.some(row => row.body?.outcome === 'allowed-once' && row.body?.scope === 'once')); checks.push('three approval buttons, five modes, native PATCH and approval POST');
  await click(button('返回')); await click(conversation('整理项目进展'));
  await click(page.getByText(/执行了 1 步/, { exact: false })); await shot('steps');
  await click(page.getByText('读取项目记录 · notes.md', { exact: true })); await page.getByText(/本周已经完成两项界面工作/).waitFor(); await shot('raw-step'); checks.push('readable steps and lazy raw detail');
  await fill(page.getByRole('textbox', { name: '输入消息', exact: true }), '保留这段合成草稿');
  await click(button('输出与来源')); await button(/^notes.md 1 次使用$/, false).waitFor(); await shot('outputs-sources');
  await click(button(/^项目进展.md text\/markdown/, false)); await page.getByRole('table').waitFor(); await shot('artifact'); await click(button('返回对话'));
  assert.equal(await page.getByRole('textbox', { name: '输入消息', exact: true }).inputValue(), '保留这段合成草稿');
  await click(button('输出与来源')); await click(button(/^notes.md 1 次使用$/, false)); await page.getByText('读取 1 次', { exact: true }).waitFor(); await shot('source'); await click(button('返回对话')); checks.push('fullscreen artifact/source and retained draft');
  await click(button('返回')); await click(button('打开导航')); await click(button('记忆')); await button(/使用中文说明/, false).waitFor(); await shot('memory');
  await click(button(/使用中文说明/, false)); await page.getByText('合成偏好：使用中文解释。', { exact: true }).waitFor(); await shot('memory-source'); checks.push('account-scoped memory snapshot and source');
  await click(button('返回')); await click(button('设置与账户')); await page.getByRole('heading', { name: '设置', exact: true }).waitFor(); await shot('settings');
  await click(button(/^外观 /, false)); await click(button(/^深色/, false)); await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark'); await shot('appearance');
  await click(button('返回')); await shot('dark-list');
  await page.reload(); await page.waitForFunction(() => typeof state !== 'undefined' && state.booted && state.page === 'home');
  await click(conversation('整理项目进展')); assert.equal(await page.getByRole('textbox', { name: '输入消息', exact: true }).inputValue(), '保留这段合成草稿');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark'); checks.push('appearance and draft restored after reload');
  assert.deepEqual(errors, []);
  await writeFile(join(evidence, `${resultPrefix}-verification.json`), JSON.stringify({ baselineCommit, phase, surface: mode, viewport: device ? { width: 720, height: 1280 } : { width: 390, height: 844 }, realPersonalAuthentication: true, realNativeBridge: device, syntheticProjection: true, modelRequests: 0, fixtureTime, locators: 'visible accessible names and roles', relocated, checks, errors }, null, 2) + '\n');
  await writeFile(join(evidence, `${resultPrefix}-requests.json`), JSON.stringify(fixture.requests.map(row => ({ ...row, ...(row.body?.requestId ? { body: { ...row.body, requestId: '<synthetic-request-id>' } } : {}) })), null, 2) + '\n');
  console.log(`FE-1b ${phase} ${mode} flows passed (${checks.length} checks).`);
} catch (error) {
  if (page) { console.error((await page.locator('body').innerText()).slice(-1800)); await page.screenshot({ path: join(fixture.root, 'failure.png') }).catch(() => {}); }
  await writeFile(join(fixture.root, 'requests.json'), JSON.stringify(fixture.requests, null, 2) + '\n');
  console.error('Isolated diagnostics:', fixture.root); throw error;
} finally {
  if (device && appInstalled) {
    if (instrumentation) { try { adbRun('shell', 'run-as', packageName, 'touch', 'files/fe1b-probe.done'); await until(() => instrumentation.exitCode !== null); } catch {} }
    await browser?.close().catch(() => {});
    if (debugPort) try { adbRun('forward', '--remove', `tcp:${debugPort}`); } catch {}
    try { adbRun('reverse', '--remove', `tcp:${port}`); } catch {}
    for (const name of [...(probeInstalled ? [`${packageName}.test`] : []), packageName]) try { adbRun('uninstall', name); } catch {}
    await writeFile(join(evidence, `${phase}-mumu-cleanup.json`), JSON.stringify({ packageName, applicationRemoved: !adbRun('shell', 'pm', 'list', 'packages', packageName).includes(packageName),
      reverseRemoved: !adbRun('reverse', '--list').includes(`tcp:${port}`), forwardRemoved: !debugPort || !adbRun('forward', '--list').includes(`tcp:${debugPort}`),
      probePassed: /OK \(1 test\)/.test(instrumentationLog), originalPackagesUntouched: true }, null, 2) + '\n');
  } else await browser?.close().catch(() => {});
  if (webServer) { webServer.closeAllConnections(); await new Promise(done => webServer.close(done)); }
  await fixture.close();
}
