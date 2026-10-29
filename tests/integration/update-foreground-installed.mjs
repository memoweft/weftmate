/** Signed feed -> production update IPC -> real NSIS/watchdog -> native HWND. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { migrationHost, until } from '../helpers/migration-host.mjs';
import { managedMkdtempSync, disposeManagedTemp, startManagedTempLease } from '../helpers/managed-temp.mjs';
const execute = promisify(execFile);
const out = process.env.WEFTMATE_EVIDENCE_DIR;
assert.ok(out, 'External evidence directory required'); mkdirSync(out, { recursive: true });
const builds = resolve(process.env.WEFTMATE_UPDATE_FOREGROUND_BUILDS || '.local/update-foreground-build');
const baseline = process.argv.includes('--baseline');
const initial = baseline ? '0.2.1-preview.1' : '0.2.1-preview.3';
const next = baseline ? '0.2.1-preview.2' : '0.2.1-preview.3';
const scenarios = baseline ? ['normal'] : (process.env.WEFTMATE_UPDATE_FOREGROUND_MODES || 'normal,tray,minimized,rollback').split(',');
const control = join(process.env.APPDATA, 'WeftMate upfgqa');
const cache = join(process.env.LOCALAPPDATA, 'weftmate-upfgqa-updater');
assert.equal(existsSync(control), false, 'Do not reuse an unowned recovery identity');
const report = { baseline, identity: 'upfgqa', actualUpdateEntry: 'wm:desktop:update-restart', scenarios: [] };
const buildRoot = version => version === '0.2.1-preview.4' ? resolve('.local/update-foreground-bad') : version === '0.2.1-preview.2' && baseline ? resolve('.local/update-foreground-original') : builds;
const installer = version => join(buildRoot(version), version, 'build', `WeftMate-Setup-${version}.exe`);
const feedRoot = version => join(buildRoot(version), version, 'upload/updates/windows/x64/preview');
let serving = null;
const server = createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname).replace(/^\/preview\//, '');
  // UI-only behavior is exercised separately; this feed authorizes the app layer.
  if (!serving || name === 'manifest-ui.json' || name.includes('..') || name.includes('/')) return res.writeHead(404).end();
  const file = join(feedRoot(serving), name);
  if (!existsSync(file)) return res.writeHead(404).end();
  const data = readFileSync(file), range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
  res.setHeader('Accept-Ranges', 'bytes');
  if (range) { const start = Number(range[1]), end = range[2] ? Number(range[2]) : data.length - 1;
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': end - start + 1 });
    return res.end(data.subarray(start, end + 1)); }
  res.writeHead(200, { 'Content-Length': data.length }); createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/`;
const run = (file, args) => execute(file, args, { windowsHide: true, timeout: 180000, maxBuffer: 1024 * 1024 });
const native = async (executable, screenshot) => {
  const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', resolve('tests/helpers/update-foreground-window.ps1'),
    '-Executable', executable, ...(screenshot ? ['-Screenshot', screenshot] : [])]);
  return JSON.parse(result.stdout);
};
const logs = profile => readdirSync(join(profile, 'logs')).filter(n => /^host-.*\.jsonl$/.test(n)).flatMap(n => readFileSync(join(profile, 'logs', n), 'utf8').trim().split('\n').map(JSON.parse));
try {
  for (const mode of scenarios) {
    const root = managedMkdtempSync('weftmate-upfg-install-', { prune: false }), stopLease = startManagedTempLease(root);
    const installation = join(root, 'installed'), executable = join(installation, 'WeftMate-upfgqa.exe');
    const recovery = join(control, 'WeftMate/app-recovery'), target = mode === 'rollback' ? '0.2.1-preview.4' : next;
    const row = { mode, initial: baseline || mode !== 'rollback' ? '0.2.1-preview.1' : initial, target, installation, root };
    let h, installed = false;
    report.scenarios.push(row);
    try {
      serving = null;
      await run(installer(row.initial), ['--updated', '/S', '/currentuser', `/D=${installation}`]); installed = true;
      console.log(`${mode}: isolated install ready`);
      const reservation = createServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
      const accessPort = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
      h = await migrationHost({ nativeSession: true, executable, tempRoot: root, updateBaseUrl: baseUrl, accessPort });
      console.log(`${mode}: native account and synthetic model ready`);
      row.profile = h.profile; row.configFile = join(h.root, 'desktop-config.json');
      // Keep this fixture's scheduled daily copy out of the explicit update
      // transaction. The production before-upgrade backup remains mandatory.
      assert.equal((await h.api('/backups/settings', { enabled: false }, 'PATCH')).status, 200);
      await h.page.locator('#message-text').fill('更新验收的合成对话');
      await h.page.locator('#message-text').press('Enter');
      await h.page.getByText('主对话首条消息成功，合成回复。', { exact: true }).last().waitFor();
      await until(async () => !(await h.api('/sessions')).body.sessions?.some(s => s.running));
      row.ownerBefore = (await h.api('/auth/me')).body.account.ownerId;
      row.contextBefore = await h.page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => /chat|conversation|scope|project/.test(key))));
      serving = target;
      await h.page.evaluate(() => globalThis.weftmateDesktop.checkUpdates());
      await until(async () => {
        const state = await h.page.evaluate(() => globalThis.weftmateDesktop.updateState());
        const layer = state.layers.find(layer => layer.layer === 'app');
        if (layer.status === 'error') throw Error(JSON.stringify(layer));
        return layer.status === 'downloaded' && state;
      }, 120000);
      console.log(`${mode}: signed installer downloaded`);
      if (mode === 'tray') await h.app.evaluate(({ BrowserWindow }, url) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === url).hide(), h.page.url());
      if (mode === 'minimized') await h.app.evaluate(({ BrowserWindow }, url) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === url).minimize(), h.page.url());
      row.before = await native(executable);
      row.backupBefore = (await h.api('/backups')).body;
      writeFileSync(join(out, 'installed.json'), JSON.stringify(report, null, 2));
      if (process.env.WEFTMATE_UPDATE_FOREGROUND_FOCUS_GATE) {
        const gate = `${process.env.WEFTMATE_UPDATE_FOREGROUND_FOCUS_GATE}.${mode}`;
        writeFileSync(`${gate}.ready`, JSON.stringify({ mode, at: new Date().toISOString() }));
        console.log(`${mode}: awaiting coordinated foreground gate`);
        await until(() => existsSync(gate), 1800000);
      }
      // This is the same trusted native bridge used by the About-page button.
      // Dispatch without waiting on a promise owned by the exiting renderer.
      const oldPid = row.before[0].pid, actionFile = join(h.root, 'update-action.json');
      await h.app.evaluate(({ BrowserWindow }, { url, actionFile }) => {
        const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === url);
        const fs = process.getBuiltinModule('fs');
        setImmediate(() => { void win.webContents.executeJavaScript('globalThis.weftmateDesktop.restartForUpdate()').then(
          result => fs.writeFileSync(actionFile, JSON.stringify(result)),
          error => fs.writeFileSync(actionFile, JSON.stringify({ error: error.message }))); });
      }, { url: h.page.url(), actionFile });
      // app.exit() tears down the renderer before its IPC response can arrive.
      // Observe the actual OS process and watchdog receipt, rather than waiting
      // for a response owned by that renderer or a stale debugging connection.
      await until(() => {
        if (existsSync(actionFile)) { row.accepted = JSON.parse(readFileSync(actionFile, 'utf8')); assert.notEqual(row.accepted.restarted, false, JSON.stringify(row.accepted)); }
        try { process.kill(oldPid, 0); return false; } catch { return true; }
      }, 600000);
      h.app = null;
      console.log(`${mode}: old host exited; watchdog owns installation`);
      row.result = await until(() => {
        const file = join(recovery, 'last-result.json');
        if (!existsSync(file)) return false;
        const result = JSON.parse(readFileSync(file, 'utf8'));
        return result;
      }, 360000);
      assert.equal(row.result.phase, mode === 'rollback' ? 'rolled-back' : 'healthy', JSON.stringify(row.result));
      const expected = mode === 'rollback' ? initial : target;
      row.after = await until(async () => { const windows = await native(executable); return windows.length && windows; }, 90000);
      await native(executable, join(out, `${mode}.png`));
      assert.equal(row.after.length, 1, 'one native main window');
      if (!baseline && mode !== 'rollback') {
        assert.equal(row.after[0].visible, true, JSON.stringify(row.after));
        assert.equal(row.after[0].minimized, false, JSON.stringify(row.after));
        assert.equal(row.after[0].foreground, true, JSON.stringify(row.after));
      }
      row.programVersion = JSON.parse(readFileSync(join(installation, 'resources/weftmate-install.json'), 'utf8')).version;
      assert.equal(row.result.version, expected);
      const pid = row.after[0].pid;
      await run(executable, [`--desktop-config=${row.configFile}`]);
      assert.equal((await native(executable))[0].pid, pid, 'a second launch must retain the same main process');
      await run(executable, ['--quit', `--desktop-config=${row.configFile}`]);
      await until(async () => (await native(executable)).length === 0);
      const history = logs(h.profile), runId = history.find(item => item.event === 'host.start' && item.pid === pid)?.runId;
      row.normalExit = !!runId && history.some(item => item.event === 'host.exit' && item.normal === true && item.runId === runId);
      assert.equal(row.normalExit, true);
      await h.launch();
      row.ownerAfter = (await h.api('/auth/me')).body.account.ownerId;
      row.contextAfter = await h.page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => /chat|conversation|scope|project/.test(key))));
      assert.equal(row.ownerAfter, row.ownerBefore);
      assert.deepEqual(row.contextAfter, row.contextBefore);
      await h.page.getByText('主对话首条消息成功，合成回复。', { exact: true }).last().waitFor();
      row.accountAndConversationRetained = true;
      if (mode === 'rollback') {
        row.rejected = JSON.parse(readFileSync(join(recovery, 'rejected.json'), 'utf8'));
        assert.ok(row.rejected.includes(target));
        assert.equal((await h.page.evaluate(() => globalThis.weftmateDesktop.updateState())).completedVersion, null);
      }
      row.passed = true;
    } catch (error) {
      row.failure = error.stack;
      if (h?.app) {
        row.backupAfterFailure = await h.api('/backups').catch(() => null);
        row.stderr = h.stderr;
      }
      writeFileSync(join(out, 'installed.json'), JSON.stringify(report, null, 2));
      console.error(error); throw error;
    } finally {
      try {
        if (h?.app) { await h.app.close(); h.app = null; }
        if (existsSync(executable)) await run(executable, ['--quit', `--desktop-config=${row.configFile}`]).catch(() => {});
        if (installed) {
          const uninstaller = readdirSync(installation).find(n => /^Uninstall.*\.exe$/.test(n));
          assert.ok(uninstaller); await run(join(installation, uninstaller), ['/S', '/currentuser']);
          await until(() => !existsSync(executable), 30000);
        }
        await h?.close();
        // These exact names belong solely to the synthetic identity above.
        for (const directory of [control, cache]) rmSync(directory, { recursive: true, force: true });
        row.cleaned = true;
      } finally { stopLease(); disposeManagedTemp(root); writeFileSync(join(out, 'installed.json'), JSON.stringify(report, null, 2)); }
    }
  }
  report.passed = true;
} finally {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  writeFileSync(join(out, 'installed.json'), JSON.stringify(report, null, 2));
}
console.log('UPDATE-FOREGROUND: signed installed upgrades, native window states and recovery passed');
process.exit(0);
