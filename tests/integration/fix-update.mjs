import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { _electron } from 'playwright';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { protectProcessOutput } from '../../src/process-output.mjs';
protectProcessOutput();
const out = process.env.WEFTMATE_EVIDENCE_DIR;
if (!out) throw Error('External WEFTMATE_EVIDENCE_DIR required');
await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'weftmate-fix-update-'));
const fixture = await startTimelineCandidate({ historyCount: 0 });
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_|ELECTRON_RUN_AS_NODE)/.test(key)) delete env[key];
Object.assign(env, { FIX_UPDATE_PROFILE: profile, FIX_UPDATE_ORIGIN: fixture.origin, FIX_UPDATE_TOKEN: fixture.libraryDesktopToken,
  WEFTMATE_TEST_HOST_NAME: 'synthetic-host' });
let application, child;
const kill = () => {
  if (child?.pid && child.exitCode === null && child.signalCode === null)
    try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 10000 }); } catch {}
};
const timer = setTimeout(kill, 90000);
try {
  application = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: resolve('.'),
    args: [resolve('tests/helpers/update-electron.mjs'), '--updated', '--noerrdialogs'], env, timeout: 30000 });
  child = application.process();
  for (const stream of [child.stdout, child.stderr, child.stdin]) stream?.on('error', error => { if (error.code !== 'EPIPE') throw error; });
  const page = await application.firstWindow(); page.setDefaultTimeout(15000);
  await page.waitForURL(fixture.origin + '/personal/v1/ui');
  await page.waitForFunction(() => globalThis.__WeftUiStarted === true);
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(win => win.isVisible())), false);
  const notice = page.locator('.desktop-update-notice');
  const capture = async (name, theme) => {
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const png = await application.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows()[0].capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64'));
    await writeFile(join(out, `${name}-${theme}.png`), Buffer.from(png, 'base64'));
  };
  for (const theme of ['light', 'dark']) {
    await application.evaluate(({ nativeTheme }, theme) => { nativeTheme.themeSource = theme; }, theme);
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await application.evaluate(() => globalThis.fixUpdateFixture.publish({ status: 'not-available' }));
    await page.waitForFunction(() => document.querySelector('.desktop-update-notice').textContent === '已更新到 0.2.0-preview.13');
    await capture('completed', theme);
    await application.evaluate(() => globalThis.fixUpdateFixture.publish({ status: 'available', version: '0.2.0-preview.14', progress: { percent: 37.5 } }));
    await page.waitForFunction(() => document.querySelector('.desktop-update-notice').textContent.includes('37%'));
    await capture('downloading', theme);
    const bounds = await notice.boundingBox(); assert.ok(bounds.width > 100 && bounds.x + bounds.width <= 1040);
    await notice.click();
    await page.getByRole('dialog', { name: '设置', exact: true }).waitFor();
    await page.getByRole('heading', { name: '关于', exact: true, level: 1 }).waitFor();
    await page.getByText('正在后台下载 37%', { exact: true }).waitFor();
    await capture('about-progress', theme);
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    await application.evaluate(() => globalThis.fixUpdateFixture.publish({ status: 'downloaded', progress: undefined }));
    await page.waitForFunction(() => document.querySelector('.desktop-update-notice').textContent === '新版已就绪 · 重启并更新');
    await capture('ready', theme);
  }
  // Exercise the production load-health callback with a failed trial and a
  // throwing rollback. The same native process must reload the bundled UI.
  await application.evaluate(() => {
    const { updates, desktop } = globalThis.fixUpdateFixture;
    updates.store.pointer.trial = true; updates.store.pointer.active = 'a'.repeat(64);
    updates.store.rollback = async () => { throw Error('synthetic rollback failure'); };
    desktop.window.webContents.emit('did-finish-load');
  });
  await page.waitForFunction(() => globalThis.__WeftUiStarted === true);
  await application.evaluate(async () => {
    const { updates } = globalThis.fixUpdateFixture;
    if (updates.store.pointer.trial) await new Promise(resolve => setTimeout(resolve, 100));
    if (updates.store.pointer.active !== null) throw Error('trial was not retired');
    await globalThis.fixUpdateFixture.close();
  });
  await application.close();
  console.log('FIX-UPDATE: hidden production Electron, light/dark notices, measured progress, About navigation and UI rollback passed');
} catch (error) { console.error(error); throw error; }
finally {
  clearTimeout(timer); kill(); await fixture.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(error => console.error('Synthetic profile cleanup:', error.code));
}
