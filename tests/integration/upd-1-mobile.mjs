import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { publishMobileUi } from '../../src/personal-access/mobile-ui-release.mjs';
import { keyId } from '../../src/personal-update/manifest.mjs';
import { UpdateStore } from '../../src/personal-update/store.mjs';
const run = promisify(execFile);
const repository = resolve(import.meta.dirname, '../..');
const evidence = join(repository, 'tests/evidence/upd-1'); await mkdir(evidence, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'weftmate-upd-1-mobile-'));
const sourceDir = join(root, 'source'); await cp(join(repository, 'apps/mobile-ui/www'), sourceDir, { recursive: true });
const privateKey = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }); const trustedKeys = { [keyId(publicKey)]: publicKey };
const mobileUiDir = join(root, 'releases');
const backend = Object.fromEntries(['getStatus', 'listModels', 'preflight', 'createSession', 'sendMessage', 'cancelSession', 'readEvents', 'describeSession'].map(method => [method, async () => method === 'listModels' ? [] : {}]));
const service = await createPersonalAccessService({ root: join(root, 'access'), port: 0, backend, mobileUiDir, mobileUiTrustedKeys: trustedKeys });
const { origin, hostId } = await service.start(); const grant = await service.issueSetupGrant();
const setup = await fetch(origin + '/personal/v1/auth/setup', { method: 'POST', headers: { origin, 'content-type': 'application/json' },
  body: JSON.stringify({ grant: grant.grant, username: 'Upd1Mobile', password: 'temporary synthetic mobile password', deviceName: 'Mobile probe' }) });
assert.equal(setup.status, 201); const identity = await setup.json(), cookie = setup.headers.get('set-cookie').split(';')[0];
let downloadedBytes = 0;
const store = await new UpdateStore({ root: join(root, 'browser-updates'), layer: 'mobile-ui', trustedKeys, builtInVersion: '0.8.8',
  versions: { host: '0.1.0', native: '0.8.8', bridge: 1 }, builtInFile: name => join(repository, 'apps/mobile-ui/www', name),
  fetcher: async (url, options) => { const response = await fetch(url, { ...options, headers: { cookie } }); if (String(url).includes('/assets/')) downloadedBytes += Number(response.headers.get('content-length') || 0); return response; } }).init();
const assets = createServer(async (req, res) => {
  try {
    const name = req.url === '/' ? 'index.html' : new URL(req.url, 'http://127.0.0.1').pathname.slice(1);
    if (!/^[A-Za-z0-9_./-]+$/.test(name) || name.includes('..')) return res.writeHead(404).end();
    const bytes = await store.resource(name) || await readFile(join(repository, 'apps/mobile-ui/www', name));
    res.writeHead(200, { 'content-type': name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.html') ? 'text/html' : 'text/plain' }); res.end(bytes);
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => assets.listen(0, '127.0.0.1', done));
let browser, nativeInstalled = false, reverse = false;
const adb = 'D:/Software/MuMuPlayer/nx_main/adb.exe'; const packageId = 'com.memoweft.weftmate.mobile.upd1qa';
try {
  browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const url = `http://127.0.0.1:${assets.address().port}/`;
  await page.goto(url); await page.getByRole('heading', { name: '登录 WeftMate', exact: true }).waitFor(); await page.screenshot({ path: join(evidence, 'mobile-chromium-v1.png') });
  const viewFile = join(sourceDir, 'components/cloud-auth.js'); await writeFile(viewFile, (await readFile(viewFile, 'utf8')).replace("'登录 WeftMate'", "'登录 WeftMate · UPD mobile v2'"));
  const manifest = await publishMobileUi({ sourceDir, outputDir: mobileUiDir, uiVersion: '0.9.0', minNativeVersionCode: 21, privateKey,
    releaseNotes: '签名兼容 / \u2028 😀\n"手机更新"' });
  await store.check(origin + '/personal/v1/app/manifest'); assert.equal(store.state.status, 'ready');
  const changed = manifest.files.find(row => row.path === 'components/cloud-auth.js'); assert.equal(store.state.downloadedBytes, changed.size);
  await store.activate({ idle: true }); await page.reload(); await page.getByRole('heading', { name: '登录 WeftMate · UPD mobile v2', exact: true }).waitFor(); await store.healthy();
  await page.screenshot({ path: join(evidence, 'mobile-chromium-v2.png') });
  const report = { chromium: '390x844', signedManifest: true, changedFiles: ['components/cloud-auth.js'], downloadedBytes: store.state.downloadedBytes,
    reusedBytes: store.state.reusedBytes, totalBytes: manifest.files.reduce((sum, row) => sum + row.size, 0), switched: true, native: null };
  if (process.argv.includes('--mumu')) {
    const packages = (await run(adb, ['shell', 'pm', 'list', 'packages'])).stdout.split('\n').map(line => line.trim().replace('package:', '')).filter(name => name.includes('weftmate') && name !== packageId && name !== packageId + '.test');
    for (const name of packages) {
      const pid = await run(adb, ['shell', 'pidof', name]).catch(() => ({ stdout: '' }));
      if (pid.stdout.trim()) throw new Error('MuMu is occupied by another WeftMate process; rerun when free');
    }
    const keysDir = join(root, 'keys'); await mkdir(keysDir); await writeFile(join(keysDir, 'update-trusted-keys.json'), JSON.stringify(trustedKeys));
    const initFile = join(root, 'isolate.gradle');
    await writeFile(initFile, `allprojects { afterEvaluate { project -> if (project.name == 'app') { project.android.sourceSets.main.assets.setSrcDirs([project.file('../../mobile-ui/www'), project.file('${keysDir.replaceAll('\\', '/')}')]) } } }\n`);
    const buildScript = `. D:/AIProjects/AIGame/Repository/runtime/toolchains/activate-android.ps1\ngradle -I '${initFile.replaceAll('\\', '/')}' '-PweftmateApplicationId=${packageId}' :app:assembleDebug :app:assembleDebugAndroidTest --console=plain\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`;
    await run('powershell.exe', ['-NoProfile', '-Command', buildScript], { cwd: join(repository, 'apps/android'), windowsHide: true, timeout: 240000, maxBuffer: 1024 * 1024 });
    await run(adb, ['install', '-r', join(repository, 'apps/android/app/build/outputs/apk/debug/app-debug.apk')]); nativeInstalled = true;
    await run(adb, ['install', '-r', join(repository, 'apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk')]);
    const port = new URL(origin).port; await run(adb, ['reverse', `tcp:${port}`, `tcp:${port}`]); reverse = true;
    const result = await run(adb, ['shell', 'am', 'instrument', '-w', '-e', 'class', 'com.memoweft.weftmate.mobile.Upd1BundlesInstrumentedTest',
      '-e', 'upd1', '1', '-e', 'origin', origin, '-e', 'ownerId', identity.account.ownerId, '-e', 'hostId', hostId,
      '-e', 'deviceId', identity.device.id, '-e', 'cookie', cookie, '-e', 'csrf', identity.csrfToken,
      packageId + '.test/androidx.test.runner.AndroidJUnitRunner'], { timeout: 120000 });
    assert.match(result.stdout, /OK \(1 test\)/);
    for (const name of ['upd-1-native-v1.png', 'upd-1-native-v2.png', 'upd-1-native-rollback.png', 'upd-1-native-report.json']) {
      const result = await run(adb, ['exec-out', 'run-as', packageId, 'cat', 'files/' + name], { encoding: 'buffer', maxBuffer: 5 * 1024 * 1024 });
      await writeFile(join(evidence, name), result.stdout);
    }
    report.native = { packageId, signedDownload: true, switched: true, rollback: true };
  }
  await writeFile(join(evidence, 'mobile-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally {
  if (reverse) await run(adb, ['reverse', '--remove', `tcp:${new URL(origin).port}`]).catch(() => {});
  if (nativeInstalled) { await run(adb, ['uninstall', packageId + '.test']).catch(() => {}); await run(adb, ['uninstall', packageId]).catch(() => {}); }
  await browser?.close(); await service.close(); await new Promise(done => assets.close(done)); await rm(root, { recursive: true, force: true });
}
