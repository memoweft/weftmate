/** Real NSIS install + packaged Electron/DSH + range downloads + native rollback; synthetic account only. */
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, cp, rm, readdir } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import asar from '@electron/asar';
import { saveDesktopConfig } from '../../src/desktop-config.mjs';
import { packageRelease } from '../../scripts/release/package.mjs';
import { personalAccessUiResources } from '../../src/personal-access-ui/index.mjs';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';

const repository = resolve(import.meta.dirname, '../..'), run = promisify(execFile);
const evidence = join(repository, 'tests/evidence/r0-1'); await mkdir(evidence, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'weftmate-r01-'));
const installation = join(root, 'Programs/WeftMate'), executable = join(installation, 'WeftMate.exe');
const profile = join(root, 'profile'), control = join(process.env.APPDATA, 'WeftMate r01qa');
const configFile = join(control, 'WeftMate/desktop-config.json'), recovery = join(control, 'WeftMate/app-recovery');
const release = version => join(resolve(process.argv[2] || '.local/r0-1/final-releases'), version);
const v1 = '0.1.1-preview.1', v2 = '0.1.1-preview.2', v3 = '0.1.1-preview.3';
const installer = version => join(release(version), 'build', `WeftMate-Setup-${version}.exe`);
const builtIn = join(root, 'built-in');
const archive = join(release(v1), 'build/win-unpacked/resources/app.asar');
const archivedPaths = new Set(asar.listPackage(archive).map(path => path.replace(/^[/\\]+/, '')));
const baselineResources = new Map();
for (const [name, file] of personalAccessUiResources) {
  const path = join('src', relative(join(repository, 'src'), file));
  if (!archivedPaths.has(path)) continue;
  const target = join(builtIn, path); await mkdir(resolve(target, '..'), { recursive: true });
  await writeFile(target, asar.extractFile(archive, path)); baselineResources.set(name, target);
}
const feedDir = join(root, 'feed'); await mkdir(feedDir);
const privateKey = await readFile(join(repository, '.local/r0-1/private.pem'), 'utf8');
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_|ELECTRON_RUN_AS_NODE|MIMO_API_KEY|MODEL_SWITCH_UNIFIED_KEY)/.test(key)) delete env[key];
env.LOCALAPPDATA = join(root, 'Local'); await mkdir(env.LOCALAPPDATA);
let application, page, log = '', held, completed = false;
const transfers = [], report = { syntheticAccount: true, realNsis: true, realElectron: true, realDsh: true, paidModelRequests: 0 };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 90000) { const end = Date.now() + timeout; while (Date.now() < end) { const value = await check(); if (value) return value; await pause(300); } throw new Error('R0-1 condition timed out: ' + log.slice(-1800)); }
const feed = createServer(async (req, res) => {
  const name = new URL(req.url, 'http://127.0.0.1').pathname.split('/').filter(Boolean).slice(1).join('/');
  if (name.includes('..') || name.includes('%')) return res.writeHead(404).end();
  try {
    const bytes = await readFile(join(feedDir, name));
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    if (range) {
      const start = Number(range[1]), end = range[2] ? Number(range[2]) : bytes.length - 1;
      const part = bytes.subarray(start, end + 1); transfers.push({ path: name, bytes: part.length, range: true });
      res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${bytes.length}`, 'content-length': part.length, 'accept-ranges': 'bytes' }); res.end(part);
    } else { transfers.push({ path: name, bytes: bytes.length, range: false }); res.writeHead(200, { 'content-length': bytes.length, 'accept-ranges': 'bytes' }); res.end(bytes); }
  } catch { res.writeHead(404).end(); }
});
const model = createServer(async (req, res) => {
  if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'r01-synthetic', object: 'model' }] }));
  if (req.url !== '/v1/chat/completions') return res.writeHead(404).end();
  let raw = ''; for await (const part of req) raw += part;
  const body = JSON.parse(raw), background = !body.tools?.length;
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const frame = (text, stop = false) => res.write(`data: ${JSON.stringify({ id: 'r01', model: body.model, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: stop ? 'stop' : null }] })}\n\n`);
  frame('R0-1 合成任务正在运行。');
  const task = { closed: false, finish() { completed = true; frame('R0-1 合成任务正常完成。', true); res.end('data: [DONE]\n\n'); } };
  res.on('close', () => task.closed = true);
  if (background) task.finish(); else held = task;
});
await Promise.all([new Promise(done => feed.listen(0, '127.0.0.1', done)), new Promise(done => model.listen(0, '127.0.0.1', done))]);
async function stage(version) {
  const source = join(release(version), 'upload/updates/windows/x64/preview');
  if (version === v1) return cp(source, feedDir, { recursive: true });
  for (const name of await readdir(source)) if (/\.(exe|blockmap|yml)$/.test(name) || name === 'manifest-app.json') await copyFile(join(source, name), join(feedDir, name));
}
async function start() {
  application = await _electron.launch({ executablePath: executable, args: [], env, cwd: root, timeout: 90000 });
  application.process().stdout?.on('data', part => log += String(part)); application.process().stderr?.on('data', part => log += String(part));
  page = await application.firstWindow({ timeout: 90000 }); page.setDefaultTimeout(60000); await page.waitForURL('**/personal/v1/ui*');
  await until(() => page.evaluate(() => globalThis.__WeftUiStarted === true));
}
async function shot(name) {
  const base64 = await application.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
    const win = BrowserWindow.getAllWindows().find(row => row.getTitle() === 'WeftMate'); win.show();
    const handle = win.getNativeWindowHandle(), id = handle.length === 8 ? handle.readBigUInt64LE().toString() : handle.readUInt32LE().toString();
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1600, height: 1200 } });
    const image = sources.find(row => row.id.split(':')[1] === id)?.thumbnail; if (!image || image.isEmpty()) throw new Error('Native capture unavailable');
    return image.toPNG().toString('base64');
  }); await writeFile(join(evidence, name), Buffer.from(base64, 'base64'));
}
async function stopAutoLaunched() {
  const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$target=$env:WEFTMATE_QA_EXE; Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $target } | Select-Object -ExpandProperty ProcessId'],
    { windowsHide: true, env: { ...env, WEFTMATE_QA_EXE: executable } });
  for (const pid of result.stdout.trim().split(/\s+/)) if (/^\d+$/.test(pid)) await run('taskkill.exe', ['/pid', pid, '/T', '/F'], { windowsHide: true }).catch(() => {});
  await pause(500);
}
const api = (path, body) => page.evaluate(async ({ path, body }) => {
  const me = await (await fetch('/personal/v1/auth/me')).json();
  const response = await fetch('/personal/v1' + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-weftmate-csrf': me.csrfToken }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
}, { path, body });
const reopen = () => application.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows().find(row => row.getTitle() === 'WeftMate'); win.hide(); win.show(); });
const state = () => page.evaluate(() => weftmateDesktop.updateState());
try {
  assert.equal(await readdir(control).catch(() => null), null, 'QA control namespace must be clean');
  await stage(v1); await mkdir(profile);
  const { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } = await import('../../src/host-mode.mjs');
  await writeFile(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
  saveDesktopConfig(configFile, { schemaVersion: 1, dataDirectory: profile, accessPort: 0, production: { cloudIssuer: '', relayEnabled: false, acmeEnabled: false },
    updates: { channel: 'preview', baseUrl: `http://127.0.0.1:${feed.address().port}/` } });
  await run(installer(v1), ['/S', '/currentuser', `/D=${installation}`], { env, windowsHide: true, timeout: 600000 });
  report.installation = 'isolated per-user directory';
  const shortcut = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "$shell=New-Object -ComObject Shell.Application; $folder=$shell.NameSpace([Environment]::GetFolderPath('Programs')); $link=$folder.ParseName('WeftMate r01qa.lnk'); if (-not $link) { throw 'QA shortcut missing' }; [Console]::Out.Write($link.ExtendedProperty('System.AppUserModel.ID'))"], { windowsHide: true });
  assert.equal(shortcut.stdout.trim(), 'com.memoweft.weftmate.r01qa'); report.shortcutAppUserModelId = shortcut.stdout.trim();
  await mkdir(join(env.LOCALAPPDATA, 'weftmate-r01qa-updater'), { recursive: true });
  await copyFile(installer(v1), join(env.LOCALAPPDATA, 'weftmate-r01qa-updater/installer.exe'));
  await start(); await shot('01-first-start.png'); report.firstLaunch = true;
  await application.close(); application = null;
  const password = `synthetic-${randomUUID()}-password`;
  const backend = Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(name => [name, async () => name === 'listModels' ? [] : {}]));
  const preparation = await createPersonalAccessService({ root: join(profile, 'personal-access'), port: 0, backend });
  const started = await preparation.start(), grant = await preparation.issueSetupGrant();
  const setup = await fetch(started.origin + '/personal/v1/auth/setup', { method: 'POST', headers: { origin: started.origin, 'content-type': 'application/json' }, body: JSON.stringify({ grant: grant.grant, username: 'R01Fixture', password, deviceName: 'R0-1' }) });
  assert.equal(setup.status, 201); await preparation.close(); await start();
  assert.equal(await page.evaluate(async input => (await fetch('/personal/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })).status, { username: 'R01Fixture', password, deviceName: 'Installed QA' }), 200);
  await page.reload(); await page.locator('#assistant-view').waitFor({ state: 'visible' });
  // Real login-item bridge, under the QA name only. Normal uninstall must remove it.
  await page.evaluate(() => weftmateDesktop.setAutoStart(true));
  report.autoStart = await page.evaluate(() => weftmateDesktop.settings());
  const configured = await api('/account/models', { requestId: randomUUID(), name: 'R01 Synthetic', baseUrl: `http://127.0.0.1:${model.address().port}/v1`, modelId: 'r01-synthetic', apiKey: 'synthetic-only' });
  assert.equal(configured.status, 202); await until(async () => (await api('/account/models')).body.models?.some(row => row.name === 'R01 Synthetic'));
  await page.reload(); await page.getByRole('button', { name: /^新对话/ }).click();
  await until(() => page.getByRole('textbox', { name: '输入消息', exact: true }).isEnabled());
  await page.getByRole('textbox', { name: '输入消息', exact: true }).fill('R0-1 保持运行直到合成模型完成。'); await page.getByRole('button', { name: '发送', exact: true }).click();
  await until(() => held);
  const layout = join(root, 'layout.js'); await writeFile(layout, (await readFile(baselineResources.get('personal-access-ui/layout.js'), 'utf8')).replace('/* layout-test-slot */', "document.querySelector('#new-session').append(document.createTextNode(' · R01 UI v2'));"));
  const resources = new Map(baselineResources); resources.set('personal-access-ui/layout.js', layout);
  const uiManifest = await packageRelease({ layer: 'ui', version: '0.1.1-preview.9', channel: 'preview', outputDir: feedDir, privateKey, resources, releaseNotes: 'R0-1 合成界面更新说明。' });
  const beforeUi = transfers.length; await page.evaluate(() => weftmateDesktop.checkUpdates()); await reopen(); await pause(600);
  assert.equal(held.closed, false); assert.equal((await state()).layers[0].currentVersion, v1);
  report.uiDownloads = transfers.slice(beforeUi).filter(row => row.path.startsWith('files/ui/'));
  assert.equal(report.uiDownloads.length, 1); report.uiTotalBytes = uiManifest.files.reduce((sum, row) => sum + row.size, 0);
  await stage(v2); const beforeApp = transfers.length; await page.evaluate(() => weftmateDesktop.checkUpdates());
  await until(async () => (await state()).canRestart);
  const blocked = await page.evaluate(() => weftmateDesktop.restartForUpdate()); assert.equal(blocked.restarted, false); assert.equal(held.closed, false); report.busyRestartDeferred = true;
  await shot('02-updates-task-running.png'); held.finish();
  await until(() => page.getByRole('button', { name: '发送', exact: true }).isVisible());
  await until(async () => { await reopen(); return (await state()).layers[0].currentVersion === '0.1.1-preview.9'; });
  await page.getByRole('button', { name: /R01 UI v2/ }).waitFor(); await shot('03-ui-hot-update.png'); report.taskCompleted = completed;
  await page.getByRole('button', { name: '账户菜单', exact: true }).click(); await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '关于', exact: true }).click();
  await page.getByRole('combobox', { name: '更新通道' }).waitFor(); await page.getByText('R0-1 合成界面更新说明。', { exact: true }).waitFor();
  await shot('03-about-updates.png'); await page.getByRole('button', { name: '关闭设置' }).click(); report.aboutVersionsChannelNotes = true;
  report.appTransfers = transfers.slice(beforeApp).filter(row => row.path.endsWith('.exe'));
  report.newInstallerBytes = (await readFile(installer(v2))).length;
  report.downloadedInstallerBytes = report.appTransfers.reduce((sum, row) => sum + row.bytes, 0);
  assert.ok(report.appTransfers.some(row => row.range)); assert.ok(report.downloadedInstallerBytes < report.newInstallerBytes);
  assert.equal((await page.evaluate(() => weftmateDesktop.restartForUpdate())).restarted, true);
  application = null;
  await until(async () => (await readFile(join(recovery, 'last-result.json'), 'utf8').then(JSON.parse).catch(() => null))?.version === v2, 720000);
  report.appUpgrade = JSON.parse(await readFile(join(recovery, 'last-result.json'), 'utf8'));
  assert.equal(report.appUpgrade.phase, 'healthy'); await stopAutoLaunched(); await start(); await shot('04-app-v2.png');
  await page.evaluate(() => WeftUiComponents); // Window is still the product surface after upgrade.
  if (!process.argv.includes('--normal-only')) {
  await stage(v3); await page.evaluate(() => weftmateDesktop.checkUpdates()); await until(async () => (await state()).canRestart);
  assert.equal((await page.evaluate(() => weftmateDesktop.restartForUpdate())).restarted, true); application = null;
  await until(async () => (await readFile(join(recovery, 'last-result.json'), 'utf8').then(JSON.parse).catch(() => null))?.phase === 'rolled-back', 720000);
  report.rollback = JSON.parse(await readFile(join(recovery, 'last-result.json'), 'utf8'));
  assert.equal(report.rollback.version, v2); await stopAutoLaunched(); await start(); await shot('05-app-rollback.png');
  assert.equal(JSON.parse(asar.extractFile(join(installation, 'resources/app.asar'), 'package.json')).version, v2);
  await page.evaluate(() => weftmateDesktop.checkUpdates()); assert.equal((await state()).layers[1].status, 'error'); report.badVersionRejected = true;
  } else report.rollbackEvidence = 'rollback-report.json (independent automatic bad-version trial)';
  const channel = await page.evaluate(() => weftmateDesktop.setUpdateChannel('stable')); assert.equal(channel.channel, 'stable');
  assert.equal(JSON.parse(await readFile(configFile, 'utf8')).updates.channel, 'stable'); report.channelPersisted = true;
  await application.close(); application = null;
  await writeFile(join(profile, 'retained-data.txt'), 'R0-1 uninstall must retain this file');
  // Optional native-page evidence: the controller only captures, then cancels this QA dialog.
  if (process.argv.includes('--capture-uninstaller')) {
    const dialog = spawn(join(installation, 'Uninstall WeftMate.exe'), [], { env, windowsHide: false, stdio: 'ignore' });
    await writeFile(join(repository, '.local/r0-1/uninstaller-ready.json'), JSON.stringify({ pid: dialog.pid, installation }));
    console.log('QA uninstall dialog ready for native screenshot');
    await until(async () => readFile(join(repository, '.local/r0-1/uninstaller-captured'), 'utf8').catch(() => false), 120000);
    await run('taskkill.exe', ['/pid', String(dialog.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
    await pause(400);
  }
  await run(join(installation, 'Uninstall WeftMate.exe'), ['/S'], { env, windowsHide: true, timeout: 600000 });
  assert.equal(await readFile(join(profile, 'retained-data.txt'), 'utf8'), 'R0-1 uninstall must retain this file'); report.uninstallRetainsData = true;
  report.passed = true;
  await writeFile(join(evidence, 'installed-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await application?.close().catch(() => {}); held?.finish(); await stopAutoLaunched().catch(() => {});
  if (await readFile(join(installation, 'Uninstall WeftMate.exe')).then(() => true).catch(() => false))
    await run(join(installation, 'Uninstall WeftMate.exe'), ['/S'], { env, windowsHide: true, timeout: 600000 }).catch(() => {});
  await Promise.all([new Promise(done => feed.close(done)), new Promise(done => model.close(done))]);
  await writeFile(join(evidence, 'installed.log'), log.replaceAll(root, '<isolated>').replace(/synthetic-[a-z0-9-]+-password/g, '<synthetic>'));
  // Delete only this run's exact temporary root and the explicit QA control namespace.
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  await rm(control, { recursive: true, force: true });
  await rm(join(process.env.LOCALAPPDATA, 'weftmate-r01qa-updater'), { recursive: true, force: true });
}
