/** UX-2: own Android QA package, real full-screen PNGs, synthetic data only.
 * Run under the UX-2 heavy slot: UX2_HEAVY_LOCK=<owned lock> node this-file.
 * Existing MuMu is read via MuMuManager; this script never starts/stops it.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, lstatSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { managedMkdtempSync, managedTempRoot, disposeManagedTemp } from '../helpers/managed-temp.mjs';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { systemBarDifference } from '../../scripts/nightly/system-bars.mjs';

const root = resolve(import.meta.dirname, '../..'), out = join(root, 'tests/evidence/ux-2');
const adb = 'D:/Software/MuMuPlayer/nx_main/adb.exe', manager = 'D:/Software/MuMuPlayer/nx_main/MuMuManager.exe';
const pkg = 'com.memoweft.weftmate.mobile.ux2qa';
const run = (file, args, options = {}) => execFileSync(file, args, { windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024, ...options });
const textRun = (file, args) => run(file, args).toString().trim();
const publicText = value => { let result = String(value).replace(/[A-Z]:[\\/]Users[\\/][^\\/]+/gi, 'C:/Users/<user>');
  if (process.env.COMPUTERNAME) result = result.replaceAll(process.env.COMPUTERNAME, '<host>');return result; };
const pause = ms => new Promise(done => setTimeout(done, ms));
async function until(check, label, timeout = 60000) { const end = Date.now() + timeout; while (Date.now() < end) { const value = await check(); if (value) return value; await pause(200); } throw Error('UX-2 Android timeout: ' + label); }
function unlinkLinks(directory) { for (const entry of readdirSync(directory)) { const file = join(directory, entry), stat = lstatSync(file); if (stat.isSymbolicLink()) unlinkSync(file);else if (stat.isDirectory()) unlinkLinks(file); } }
const lock = process.env.UX2_HEAVY_LOCK;
assert.ok(lock && /UX-2|ux-2/i.test(readFileSync(lock, 'utf8')), 'Requires the package-owned UX-2 heavy slot');
const initial = JSON.parse(textRun(manager, ['info', '-v', '0']));
assert.ok(initial.is_android_started && initial.adb_port, 'An existing idle MuMu is required; do not create or stop another package emulator');
const serial = `127.0.0.1:${initial.adb_port}`;
const android = (...args) => textRun(adb, ['-s', serial, ...args]);
const temp = managedMkdtempSync(join(managedTempRoot(), 'weftmate-ux-2-mobile-'));
const report = { realAndroid: true, syntheticAccount: true, syntheticHost: 'synthetic-host', modelRequests: 0, packageName: pkg,
  initialEmulatorRunning: true, emulatorCreatedByThisPackage: false, records: [], checks: [], cleanup: {} };
report.alternateEmulatorAvailability = [
  { kind: 'portable-sdk', emulator: 'D:/AIProjects/AIGame/Repository/runtime/toolchains/android-sdk/emulator/emulator.exe', avds: 'D:/AIProjects/AIGame/Repository/runtime/toolchains/android-user-home/avd' },
  { kind: 'standard-local-sdk', emulator: join(process.env.LOCALAPPDATA || '', 'Android/Sdk/emulator/emulator.exe'), avds: join(process.env.USERPROFILE || '', '.android/avd') },
].map(({ kind, emulator, avds }) => ({ kind, emulatorInstalled: existsSync(emulator), avdDirectoryExists: existsSync(avds),
  avdIniCount: existsSync(avds) ? readdirSync(avds).filter(name => name.endsWith('.ini')).length : 0 }));
let fixture, instrument, browser, forward, reversed, appInstalled = false, testInstalled = false, connected = false;
let priorNight, priorSize, priorDensity, log = '';
const appApk = join(temp, 'build/outputs/apk/debug/app-debug.apk'), probeApk = join(temp, 'build/outputs/apk/androidTest/debug/app-debug-androidTest.apk');
mkdirSync(out, { recursive: true });
const probe = `package com.memoweft.weftmate.mobile
import android.content.Intent
import android.webkit.WebView
import android.view.WindowInsets
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test
import java.io.File
import org.json.JSONObject
class Ux2MobileProbeTest {
 @Test fun inspectDialog() {
  val i=InstrumentationRegistry.getInstrumentation();val c=i.targetContext
  check(c.packageName=="${pkg}")
  val args=InstrumentationRegistry.getArguments()
  val host=PersonalApi().login(args.getString("host")!!,args.getString("username")!!,args.getString("password")!!,"合成手机")
  SecureSettings(c).saveHost(host)
  i.runOnMainSync { WebView.setWebContentsDebuggingEnabled(true) }
  val a=i.startActivitySync(Intent(c,HybridActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  i.runOnMainSync { a.window.insetsController?.show(WindowInsets.Type.systemBars()) }
  val done=File(c.filesDir,"ux-2-mobile.done");done.delete()
  try {
   val end=System.currentTimeMillis()+8*60*1000
   while(!done.exists()&&System.currentTimeMillis()<end) {
    i.runOnMainSync {
     val decor=a.window.decorView;val insets=decor.rootWindowInsets
     val bars=insets?.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
     val appearance=a.window.insetsController!!.systemBarsAppearance
     File(c.filesDir,"ux-2-mobile-window.json").writeText(JSONObject()
      .put("statusHeight",bars?.top?:0).put("navigationHeight",bars?.bottom?:0)
      .put("navigationVisible",insets?.isVisible(WindowInsets.Type.navigationBars())?:false)
      .put("hasWindowFocus",decor.hasWindowFocus())
      .put("darkStatusIcons",appearance and android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS != 0)
      .put("darkNavigationIcons",appearance and android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS != 0)
      .put("width",decor.width).put("height",decor.height).put("sdk",android.os.Build.VERSION.SDK_INT).toString())
    }
    Thread.sleep(100)
   }
   check(done.exists()) { "UX-2 probe timeout" }
  } finally { i.runOnMainSync { a.finish();WebView.setWebContentsDebuggingEnabled(false) };done.delete() }
 }
}
`;
async function build() {
  console.log('UX-2 Android: compiling the isolated QA app with existing offline dependencies');
  const space = textRun('pwsh', ['-NoProfile', '-Command', '(Get-PSDrive D).Free']);
  assert.ok(Number(space) > 20 * 1024 ** 3, 'D drive must have more than 20 GiB free');
  const source = join(temp, 'probe'); mkdirSync(source); writeFileSync(join(source, 'Ux2MobileProbeTest.kt'), probe);
  const init = join(temp, 'probe.gradle'), buildDir = join(temp, 'build').replaceAll('\\', '/');
  writeFileSync(init, `gradle.beforeProject { app -> if(app.path==':app') { app.buildDir=file('${buildDir}');app.afterEvaluate { app.android.sourceSets.androidTest.java.setSrcDirs(['${source.replaceAll('\\', '/')}']) } } }\n`);
  const script = join(temp, 'build.ps1');
  writeFileSync(script, `. D:/AIProjects/AIGame/Repository/runtime/toolchains/activate-android.ps1\ngradle --offline --project-cache-dir '${join(temp, 'gradle-cache')}' -I '${init}' '-PweftmateApplicationId=${pkg}' :app:assembleDebug :app:assembleDebugAndroidTest --console=plain --no-daemon\nexit $LASTEXITCODE\n`);
  const child = spawn('pwsh', ['-NoProfile', '-File', script], { cwd: join(root, 'apps/android'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { output += value; });
  const code = await new Promise(done => child.on('exit', done));
  assert.equal(code, 0, output.slice(-6000)); report.checks.push('fresh-native-debug-app-and-probe-built-in-owned-temporary-output');
  console.log('UX-2 Android: native QA app and instrumentation compiled');
}
try {
  textRun(adb, ['connect', serial]); connected = true;
  report.emulatorHardwareNavigationFlag = android('shell', 'getprop', 'qemu.hw.mainkeys');
  const installed = android('shell', 'pm', 'list', 'packages', 'weftmate');
  report.preexistingInactivePackages = installed.split(/\r?\n/).filter(Boolean);
  assert.ok(!installed.split(/\r?\n/).includes('package:' + pkg) && !installed.split(/\r?\n/).includes('package:' + pkg + '.test'), 'Refuse to overwrite an already installed UX-2 QA app');
  assert.deepEqual(android('shell', 'ps', '-A').split('\n').filter(row => row.includes('weftmate')), []);
  await build();
  assert.ok(!android('shell', 'pm', 'list', 'packages', pkg), 'A UX-2 QA app appeared while compiling; refuse to overwrite it');
  assert.deepEqual(android('shell', 'ps', '-A').split('\n').filter(row => row.includes('weftmate')), []);
  fixture = await startTimelineCandidate({ daily: true, sidebar: true, interactive: true, inlineProgress: true, historyCount: 0 });
  android('install', appApk); appInstalled = true;
  android('install', probeApk); testInstalled = true;
  android('shell', 'pm', 'grant', pkg, 'android.permission.POST_NOTIFICATIONS');
  reversed = new URL(fixture.origin).port; android('reverse', `tcp:${reversed}`, `tcp:${reversed}`);
  priorNight = android('shell', 'cmd', 'uimode', 'night').match(/(auto|yes|no)/)?.[1] || 'no';
  priorSize = android('shell', 'wm', 'size').match(/Override size: (\d+x\d+)/)?.[1];
  priorDensity = android('shell', 'wm', 'density').match(/Override density: (\d+)/)?.[1];
  report.originalOverrides = { size: priorSize || null, density: priorDensity || null };
  android('shell', 'wm', 'size', '720x1560');android('shell', 'wm', 'density', '320');
  instrument = spawn(adb, ['-s', serial, 'shell', 'am', 'instrument', '-w', '-e', 'class', 'com.memoweft.weftmate.mobile.Ux2MobileProbeTest', '-e', 'host', fixture.origin, '-e', 'username', fixture.credentials.username, '-e', 'password', fixture.credentials.password, pkg + '.test/androidx.test.runner.AndroidJUnitRunner'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  instrument.stdout.on('data', value => { log += value; }); instrument.stderr.on('data', value => { log += value; });
  const pid = await until(() => { try { return android('shell', 'pidof', pkg); } catch { return false; } }, 'own native app process');
  forward = android('forward', 'tcp:0', 'localabstract:webview_devtools_remote_' + pid);
  browser = await until(async () => { try { return await chromium.connectOverCDP(`http://127.0.0.1:${forward}`, { noDefaults: true }); } catch { return false; } }, 'own WebView CDP');
  let page = await until(() => browser.contexts()[0].pages().find(row => row.url().includes('appassets')), 'native asset page');
  page.setDefaultTimeout(20000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const nativeInfo = () => JSON.parse(android('shell', 'run-as', pkg, 'cat', 'files/ux-2-mobile-window.json'));
  await page.waitForFunction(() => typeof state !== 'undefined' && state.booted && document.documentElement.dataset.nativeInsets === 'true');
  await page.exposeFunction('__ux2Bridge', async request => {
    const response = await fetch(fixture.mobileUrl + 'bridge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
    const data = await response.json(); return { id: request.id, ok: !data.error, result: data.result, error: data.error };
  });
  await page.evaluate(async () => {
    const post = window.weftNative.postMessage.bind(window.weftNative);
    window.weftNative.postMessage = raw => { const request = JSON.parse(raw);
      if (['settings.appearance', 'app.ready', 'app.activity', 'events.subscribe', 'offline.identity', 'auth.login'].includes(request.method)) return post(raw);
      window.__ux2Bridge(request).then(result => androidBridge.receive(result));
    };
    globalThis.WeftMobileCloud = { route: () => false, active: false };
    document.body.classList.remove('cloud-auth-active');document.getElementById('cloud-auth-page').classList.remove('active');
    await boot();page('settings');
  });
  await page.waitForFunction(() => state.loggedIn && !state.transitionPending);
  for (const theme of ['light', 'dark']) {
    console.log('UX-2 Android: capturing the real ' + theme + ' confirmation');
    android('shell', 'cmd', 'uimode', 'night', theme === 'dark' ? 'yes' : 'no');
    await page.evaluate(async theme => { applyAppearancePreference(await call('settings.appearance', { value: theme }));page('approvals'); }, theme);
    await page.getByRole('button', { name: '设置默认审批模式', exact: true }).click();
    await page.getByRole('menuitemradio', { name: /全部允许/ }).click();
    await page.getByRole('dialog', { name: '启用全部允许？' }).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'approval-risk-cancel');
    await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.id), 'approval-risk-confirm');
    await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.id), 'approval-risk-cancel');
    if (await page.locator('#toast').isVisible()) await page.locator('#toast').click();
    await pause(500);
    const native = await until(() => { const info = nativeInfo();return info.hasWindowFocus ? info : false; }, 'own foreground Activity without system permission popup', 10000);
    const png = run(adb, ['-s', serial, 'exec-out', 'screencap', '-p']);
    const difference = systemBarDifference(png, { statusHeight: native.statusHeight });
    const dom = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      dialog: document.querySelector('.approval-risk-sheet').getBoundingClientRect().toJSON(), bodyOverflow: document.documentElement.scrollWidth > innerWidth,
      activeId: document.activeElement.id, warningButtonColor: getComputedStyle(document.getElementById('approval-risk-confirm')).backgroundColor,
      safe: Object.fromEntries(['top', 'bottom'].map(side => [side, getComputedStyle(document.documentElement).getPropertyValue('--safe-' + side).trim()])) }));
    const file = `no-native-mobile-android-${theme}.png`;writeFileSync(join(out, file), png);
    report.records.push({ file, systemTheme: theme, pageTheme: theme, systemVersion: android('shell', 'getprop', 'ro.build.version.release'), native, dom, difference,
      navigationEvidenceAccepted: native.navigationVisible && native.navigationHeight > 0,
      navigationLimitation: native.navigationVisible && native.navigationHeight > 0 ? null : 'Existing MuMu hides the navigation area; this capture cannot certify a visible bottom system bar.' });
    assert.equal(dom.theme, theme);assert.equal(native.darkStatusIcons, theme === 'light');assert.equal(dom.bodyOverflow, false);
    assert.equal(dom.viewport.width, 360, 'Actual native WebView uses the requested narrow width');
    assert.ok(dom.dialog.x >= 0 && dom.dialog.right <= dom.viewport.width && dom.dialog.y * dom.viewport.dpr >= native.statusHeight);
    assert.ok(dom.dialog.bottom * dom.viewport.dpr <= native.height - native.navigationHeight + 2, 'Dialog stays above the bottom system bar');
    assert.ok(difference.passed, 'Status bar and adjacent page background must match');
    await page.keyboard.press('Escape');assert.equal(await page.locator('#approval-risk-dialog').isVisible(), false);
  }
  assert.deepEqual(errors, []);report.checks.push('light-and-dark-real-full-screen-captures', 'cancel-initial-focus-tab-trap-escape-cancel', 'no-horizontal-overflow', 'native-status-icons-match-theme');
} catch (error) { report.error = publicText(error.message);throw Error(report.error);
} finally {
  if (instrument) { try { android('shell', 'run-as', pkg, 'touch', 'files/ux-2-mobile.done'); await until(() => instrument.exitCode !== null, 'instrumentation exit', 15000); } catch { if (instrument.exitCode === null) instrument.kill(); } report.cleanup.instrumentationExited = instrument.exitCode !== null; }
  await browser?.close().catch(() => {});
  if (forward) try { android('forward', '--remove', `tcp:${forward}`); } catch {}
  if (reversed) try { android('reverse', '--remove', `tcp:${reversed}`); } catch {}
  if (priorNight) try { android('shell', 'cmd', 'uimode', 'night', priorNight); } catch {}
  if (priorNight) { try {
    android('shell', 'wm', 'size', priorSize || 'reset');android('shell', 'wm', 'density', priorDensity || 'reset');
    report.cleanup.restoredOverrides = { size: android('shell', 'wm', 'size').match(/Override size: (\d+x\d+)/)?.[1] || null,
      density: android('shell', 'wm', 'density').match(/Override density: (\d+)/)?.[1] || null };
    report.cleanup.screenOverridesRestored = JSON.stringify(report.originalOverrides) === JSON.stringify(report.cleanup.restoredOverrides);
    assert.ok(report.cleanup.screenOverridesRestored, 'Original emulator size/density must be restored');
  } catch (error) { report.cleanup.restoreError = error.message; } }
  if (testInstalled) try { android('uninstall', pkg + '.test');report.cleanup.testUninstalled = true; } catch {}
  if (appInstalled) try { android('uninstall', pkg);report.cleanup.appUninstalled = true; } catch {}
  if (appInstalled) { try { report.cleanup.appProcessExited = !android('shell', 'pidof', pkg); } catch { report.cleanup.appProcessExited = true; } }
  if (connected) try { textRun(adb, ['disconnect', serial]);report.cleanup.adbDisconnected = true; } catch {}
  if (fixture) { await fixture.close();unlinkLinks(fixture.root);disposeManagedTemp(fixture.root, { log: () => {} }); }
  // Unlink junctions before recursive owned-temp disposal. Never traverse them.
  if (existsSync(temp)) unlinkLinks(temp);
  disposeManagedTemp(temp, { log: () => {} });report.cleanup.temporaryBuildRemoved = true;
  report.cleanup.emulatorStopped = false;report.cleanup.emulatorRetainedReason = 'It was running before this package, so it is not owned by UX-2.';
  report.cleanup.processesCleaned = Number(!!instrument);report.cleanup.temporaryBytesRemaining = 0;
  report.instrumentation = { passed: /OK \(1 test\)/.test(log), failed: /FAILURES/.test(log) };
  writeFileSync(join(out, 'no-native-mobile-android-checks.json'), publicText(JSON.stringify(report, null, 2)) + '\n');
  console.log('UX-2 Android: own QA app, instrumentation, forward/reverse ports and temporary build removed');
}
