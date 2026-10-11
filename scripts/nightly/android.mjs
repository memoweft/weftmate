import { execFileSync, spawn } from 'node:child_process';
import { writeFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { assertSystemBars } from './system-bars.mjs';
import { readMuMuInfo, verifyAndroidSerial, AndroidEnvironmentError, adbExecutable as adb } from './mumu.mjs';
import { redactEvidenceText } from '../../tests/helpers/process-evidence.mjs';
import { repository, option } from '../review-gallery/common.mjs';
const pkg = 'com.memoweft.weftmate.mobile.nightly';
async function until(fn) { for (let i = 0; i < 100; i++) { try { if (await fn()) return; } catch {} await new Promise(done => setTimeout(done, 300)); } throw Error('Android WebView readiness timed out'); }
export async function startAndroid(out, deviceInfo) {
  const info = deviceInfo || readMuMuInfo(), serial = info.serial;
  if (!deviceInfo) execFileSync(adb, ['connect',serial], { windowsHide:true,timeout:10000 });
  const command = (...args) => {
    try { verifyAndroidSerial(serial, execFileSync(adb, ['-s', serial, 'get-serialno'], {encoding:'utf8',windowsHide:true,timeout:10000})); }
    catch (error) {
      if (error instanceof AndroidEnvironmentError) throw error;
      const detail = redactEvidenceText(String(error.stderr || error.code || error.message)).trim().slice(0,1000);
      throw new AndroidEnvironmentError('本轮安卓设备连接不可核实：' + detail);
    }
    return execFileSync(adb, ['-s', serial, ...args], { windowsHide: true, timeout: 10000, maxBuffer: 20 * 1024 * 1024 });
  };
  let uiMode = '';
  try { uiMode = command('shell','dumpsys','uimode').toString(); } catch { /* Metadata stays explicitly unknown; no settings changes. */ }
  const systemTheme = /mComputedNightMode=true/.test(uiMode) ? 'dark' : /mComputedNightMode=false/.test(uiMode) ? 'light' : 'unknown';
  const statePath = option('--state', join(out, '../android-state.json'));
  try {
    const previous = JSON.parse(await readFile(statePath, 'utf8'));
    if (previous.serial !== serial) throw new AndroidEnvironmentError('采集状态中的安卓序列号与本轮不一致');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const state = { serial, installed: [], forward: [], reverse: [] }, persist = () => writeFile(statePath, JSON.stringify(state));
  let browser, probe, probeLog = '';
  const reverse = async port => { port = String(port); if (['8080', '8081', '18186'].includes(port)) throw Error('Forbidden personal port'); if (state.reverse.includes(port)) return; command('reverse', `tcp:${port}`, `tcp:${port}`); state.reverse.push(port); await persist(); };
  let closed = false;
  const close = async () => {
    if (closed) return; closed = true;
    const errors = [], uninstalled = [];
    const attempt = async (label, action) => { try { return await action(); } catch (error) { errors.push(label + ': ' + redactEvidenceText(error.message)); } };
    try {
      if (probe) await attempt('probe stop', async () => {
        command('shell', 'run-as', pkg, 'touch', 'files/nightly-probe.done');
        await until(() => probe.exitCode !== null);
      });
      if (probe && probe.exitCode === null) probe.kill();
      await attempt('CDP close', () => browser?.close());
      for (const port of [...state.reverse]) await attempt('reverse remove', async () => { command('reverse', '--remove', `tcp:${port}`); state.reverse = state.reverse.filter(p => p !== port); await persist(); });
      for (const port of [...state.forward]) await attempt('forward remove', async () => { command('forward', '--remove', `tcp:${port}`); state.forward = state.forward.filter(p => p !== port); await persist(); });
      for (const name of [...state.installed].reverse()) await attempt('uninstall ' + name, async () => {
        if (!command('uninstall', name).toString().includes('Success')) throw Error('uninstall not confirmed');
        uninstalled.push(name); state.installed = state.installed.filter(p => p !== name); await persist();
      });
      const packages = await attempt('package confirmation', () => command('shell','pm','list','packages',pkg).toString());
      await persist();
      await writeFile(join(statePath, '../android-probe.log'), redactEvidenceText(probeLog));
      const result = { packageRemoved: typeof packages === 'string' && !packages.includes(pkg), reverseRemoved:state.reverse.length === 0, forwardRemoved:state.forward.length === 0, probePassed:/OK \(1 test\)/.test(probeLog), uninstalled, settingsChanged:false, errors };
      await writeFile(join(statePath, '../android-cleanup.json'), JSON.stringify(result,null,2));
      if (errors.length) throw Error('Android cleanup failed: ' + errors.join('; '));
    } finally { execFileSync(adb,['disconnect',serial],{windowsHide:true,timeout:5000}); }
  };
  try {
    if (command('shell', 'pm', 'list', 'packages', pkg).toString().split(/\r?\n/).some(line=>line.trim() === 'package:'+pkg || line.trim() === 'package:'+pkg+'.test')) throw Error('被占用，未拍（已有 WeftMate 测试应用）');
    await persist();
    for (const [file, name] of [['debug/app-debug.apk', pkg], ['androidTest/debug/app-debug-androidTest.apk', pkg + '.test']]) {
      state.installed.push(name); await persist(); command('install', join(repository, 'apps/android/app/build/outputs/apk', file));
    }
    probe = spawn(adb, ['-s', serial, 'shell', 'am', 'instrument', '-w', '-e', 'class', 'com.memoweft.weftmate.mobile.NightlyWebViewProbeTest', '-e', 'nightlyProbe', '1', '-e', 'nightlyRunRoot', out, `${pkg}.test/androidx.test.runner.AndroidJUnitRunner`], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    probe.stdout.on('data', bytes => { probeLog += bytes; }); probe.stderr.on('data', bytes => { probeLog += bytes; });
    await until(() => command('shell', 'pidof', pkg).toString().trim());
    const reserve = createServer(); await new Promise(done => reserve.listen(0, '127.0.0.1', done)); const port = reserve.address().port; await new Promise(done => reserve.close(done));
    command('forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${command('shell', 'pidof', pkg).toString().trim()}`); state.forward.push(port); await persist();
    await until(async () => (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).some(row => row.url.includes('appassets')));
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true });
    const page = browser.contexts()[0].pages().find(row => row.url().includes('appassets'));
    if (!page) throw Error('Actual HybridActivity WebView missing');
    await page.waitForFunction(() => document.documentElement.dataset.nativeInsets === 'true');
    await page.waitForFunction(() => state.booted);
    const entryUrl = page.url();
    const safe = await page.evaluate(() => Object.fromEntries(['top','right','bottom','left'].map(side => [side, getComputedStyle(document.documentElement).getPropertyValue(`--native-safe-${side}`).trim()])));
    // Gallery fixtures replace only the presentation transport. Preserve real native
    // geometry when their synthetic pages navigate away from the asset-loader origin.
    await page.addInitScript(safe => document.addEventListener('DOMContentLoaded', () => {
      for (const [side, value] of Object.entries(safe)) document.documentElement.style.setProperty(`--native-safe-${side}`, value);
      document.documentElement.dataset.nativeInsets = 'true';
    }), safe);
    return { browser, page, entryUrl, reverse, theme: async () => {}, screenshot: async (scene, theme) => {
      const renderedTheme = await page.evaluate(() => document.documentElement.dataset.theme);
      await until(() => command('shell', 'run-as', pkg, 'cat', 'files/nightly-bars-theme.txt').toString().trim() === renderedTheme);
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
      const image = command('exec-out', 'screencap', '-p');
      const scale = await page.evaluate(() => devicePixelRatio);
      const bars = assertSystemBars(image, { statusHeight: parseFloat(safe.top) * scale });
      const bottomInset = parseFloat(safe.bottom) * scale;
      await writeFile(join(out, `system-bars-${scene}-${theme}.json`), JSON.stringify({ pageTheme:renderedTheme, systemTheme, systemSettingsChanged:false, systemVersion:info.androidVersion, nativeRenderedBarTheme:renderedTheme, statusBarIcons:renderedTheme === 'dark' ? 'light' : 'dark', bottomNavigationVisible:bottomInset > 0, bottomInset, fullScreen:true, ...bars },null,2));
      return image;
    }, close };
  } catch (error) { console.error(redactEvidenceText(error.stack || error)); await close().catch(cleanupError => console.error(redactEvidenceText(cleanupError.stack))); throw error; }
}
