import { execFileSync, spawn } from 'node:child_process';
import { writeFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { assertSystemBars } from './system-bars.mjs';
import { repository, option } from '../review-gallery/common.mjs';
const adb = 'D:/Software/MuMuPlayer/nx_main/adb.exe', serial = '127.0.0.1:7555', pkg = 'com.memoweft.weftmate.mobile.nightly';
const command = (...args) => execFileSync(adb, ['-s', serial, ...args], { windowsHide: true, timeout: 10000, maxBuffer: 20 * 1024 * 1024 });
async function until(fn) { for (let i = 0; i < 100; i++) { try { if (await fn()) return; } catch {} await new Promise(done => setTimeout(done, 300)); } throw Error('Android WebView readiness timed out'); }
export async function startAndroid(out) {
  const statePath = option('--state', join(out, '../android-state.json'));
  const state = { installed: [], forward: [], reverse: [] }, persist = () => writeFile(statePath, JSON.stringify(state));
  let browser, probe, probeLog = '';
  const reverse = async port => { port = String(port); if (['8081', '18186'].includes(port)) throw Error('Forbidden personal port'); if (state.reverse.includes(port)) return; command('reverse', `tcp:${port}`, `tcp:${port}`); state.reverse.push(port); await persist(); };
  const close = async () => {
    if (probe) {
      try { command('shell', 'run-as', pkg, 'touch', 'files/nightly-probe.done'); await until(() => probe.exitCode !== null); } catch { probe.kill(); }
    }
    await browser?.close().catch(() => {});
    for (const port of state.reverse) try { command('reverse', '--remove', `tcp:${port}`); } catch {}
    for (const port of state.forward) try { command('forward', '--remove', `tcp:${port}`); } catch {}
    const uninstalled = [];
    for (const name of [...state.installed].reverse()) try { command('uninstall', name); uninstalled.push(name); state.installed = state.installed.filter(p=>p!==name); await persist(); } catch {}
    state.reverse = state.reverse.filter(port=>command('reverse','--list').toString().includes(`tcp:${port}`));
    state.forward = state.forward.filter(port=>command('forward','--list').toString().includes(`tcp:${port}`));
    await persist();
    const packages = command('shell', 'pm', 'list', 'packages', 'weftmate').toString();
    await writeFile(join(statePath, '../android-cleanup.json'), JSON.stringify({ packageRemoved: !packages.includes(pkg), reverseRemoved: !command('reverse', '--list').toString().split('\n').some(line => state.reverse.some(port => line.includes(`tcp:${port}`))), forwardRemoved: !command('forward', '--list').toString().split('\n').some(line => state.forward.some(port => line.includes(`tcp:${port}`))), probePassed: /OK \(1 test\)/.test(probeLog), uninstalled, settingsChanged:false }, null, 2));
  };
  try {
    if (command('shell', 'pm', 'list', 'packages', pkg).toString().split(/\r?\n/).some(line=>line.trim() === 'package:'+pkg || line.trim() === 'package:'+pkg+'.test')) throw Error('被占用，未拍（已有 WeftMate 测试应用）');
    await persist();
    for (const [file, name] of [['debug/app-debug.apk', pkg], ['androidTest/debug/app-debug-androidTest.apk', pkg + '.test']]) {
      state.installed.push(name); await persist(); command('install', join(repository, 'apps/android/app/build/outputs/apk', file));
    }
    probe = spawn(adb, ['-s', serial, 'shell', 'am', 'instrument', '-w', '-e', 'class', 'com.memoweft.weftmate.mobile.NightlyWebViewProbeTest', '-e', 'nightlyProbe', '1', `${pkg}.test/androidx.test.runner.AndroidJUnitRunner`], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
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
    return { browser, page, entryUrl, reverse, theme: async () => {}, screenshot: async () => {
      const renderedTheme = await page.evaluate(() => document.documentElement.dataset.theme);
      await until(() => command('shell', 'run-as', pkg, 'cat', 'files/nightly-bars-theme.txt').toString().trim() === renderedTheme);
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
      const image = command('exec-out', 'screencap', '-p');
      const scale = await page.evaluate(() => devicePixelRatio);
      assertSystemBars(image, { statusHeight: parseFloat(safe.top) * scale });
      return image;
    }, close };
  } catch (error) { await close().catch(() => {}); throw error; }
}
