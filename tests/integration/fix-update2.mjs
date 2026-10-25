import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { _electron } from 'playwright';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { keyId, signManifest, sha256 } from '../../src/personal-update/manifest.mjs';
import { protectProcessOutput } from '../../src/process-output.mjs';
protectProcessOutput();
const out = process.env.WEFTMATE_EVIDENCE_DIR;
if (!out) throw Error('External WEFTMATE_EVIDENCE_DIR required');
await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'weftmate-fix-update2-'));
const fixture = await startTimelineCandidate({ historyCount: 0 });
const privateKey = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
const keys = join(profile, 'public-keys.json'); await writeFile(keys, JSON.stringify({ [keyId(publicKey)]: publicKey }));
const content = Buffer.from('new component');
const manifest = signManifest({ schemaVersion: 1, layer: 'ui', version: '0.2.0-preview.14', channel: 'preview',
  minAppVersion: '0.2.0-preview.14', publishedAt: new Date().toISOString(),
  files: [{ path: 'personal-access-ui/new-component.js', size: content.length, sha256: sha256(content) }] }, privateKey);
let assets = 0;
const server = createServer((req, res) => { if (req.url !== '/manifest-ui.json') assets++; res.end(JSON.stringify(manifest)); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_|ELECTRON_RUN_AS_NODE)/.test(key)) delete env[key];
Object.assign(env, { FIX_UPDATE_PROFILE: profile, FIX_UPDATE_ORIGIN: fixture.origin, FIX_UPDATE_TOKEN: fixture.libraryDesktopToken,
  FIX_UPDATE_UI_FEED: `http://127.0.0.1:${server.address().port}/manifest-ui.json`, FIX_UPDATE_KEYS: keys,
  WEFTMATE_TEST_HOST_NAME: 'synthetic-host' });
let application, child;
const kill = () => {
  if (child?.pid && child.exitCode === null && child.signalCode === null)
    try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 10000 }); } catch {}
};
const timer = setTimeout(kill, 90000);
try {
  application = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: resolve('.'),
    args: [resolve('tests/helpers/update-electron.mjs'), '--noerrdialogs'], env, timeout: 30000 });
  child = application.process();
  for (const stream of [child.stdout, child.stderr, child.stdin]) stream?.on('error', error => { if (error.code !== 'EPIPE') throw error; });
  const page = await application.firstWindow(); page.setDefaultTimeout(15000);
  await page.waitForFunction(() => globalThis.__WeftUiStarted === true);
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(win => win.isVisible())), false);
  for (const theme of ['light', 'dark']) {
    await application.evaluate(({ nativeTheme }, theme) => { nativeTheme.themeSource = theme; }, theme);
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    if (theme === 'light') {
      await application.evaluate(() => globalThis.fixUpdateFixture.publish({ status: 'downloaded', version: '0.2.0-preview.14' }));
      await page.locator('.desktop-update-notice').click();
    }
    await page.getByRole('dialog', { name: '设置', exact: true }).waitFor();
    await page.getByText('需要更新程序', { exact: true }).waitFor();
    assert.equal(await page.getByText(/更新下载失败/).count(), 0);
    const state = await application.evaluate(() => globalThis.fixUpdateFixture.updates.state());
    assert.equal(state.layers[0].status, 'app-update-required'); assert.equal(state.canRestart, true);
    assert.equal(assets, 0, 'an incompatible UI must not download any assets');
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => {
      for (const animation of document.getAnimations()) {
        if (Number.isFinite(animation.effect.getComputedTiming().iterations)) animation.finish();
      }
    });
    await page.screenshot({ path: join(out, `requires-app-${theme}.png`), animations: 'disabled' });
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(win => win.isVisible())), false);
  }
  await application.evaluate(() => globalThis.fixUpdateFixture.close());
  await application.close();
  console.log('FIX-UPDATE2: hidden production Electron, signed minimum app version, zero asset downloads and light/dark About passed');
} finally {
  clearTimeout(timer); kill(); await fixture.close(); await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
