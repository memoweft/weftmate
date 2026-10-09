import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright';
import { localUiSession } from '../helpers/local-ui-session.mjs';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';

const repository = resolve(import.meta.dirname, '../..');
const evidence = join(repository, 'tests/evidence/fix-6'); mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'weftmate-fix6-'));
writeFileSync(join(root, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('WEFTMATE_') || key.startsWith('MEMOWEFT_') || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
const baseline = 'b65cae8f532aefcf9fbd7815643c7eb06578054b';
let application, candidate, phase = 'before';
const report = { realApplication: true, isolatedData: true, themes: [] };
async function until(check) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await new Promise(done => setTimeout(done, 100)); }
  throw Error('FIX-6 condition timed out');
}
async function screenshot(name) {
  const encoded = await application.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
    const win = BrowserWindow.getAllWindows().find(win => win.getTitle() === 'WeftMate');
    const handle = win.getNativeWindowHandle();
    const id = handle.length === 8 ? handle.readBigUInt64LE().toString() : handle.readUInt32LE().toString();
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1600, height: 1200 } });
    const source = sources.find(source => source.id.split(':')[1] === id);
    if (!source || source.thumbnail.isEmpty()) throw Error('Native window capture unavailable');
    return source.thumbnail.toPNG().toString('base64');
  });
  writeFileSync(join(evidence, name), Buffer.from(encoded, 'base64'));
}
try {
  candidate = await startTimelineCandidate({ historyCount: 0, interactive: true });
  application = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: repository,
    args: ['tests/integration/fix-6-desktop.cjs', '--personal-host', '--access-port=0', `--user-data-dir=${root}`, '--force-device-scale-factor=1'], env, timeout: 90000 });
  application.process().stdout.on('data', part => process.stdout.write(part));
  application.process().stderr.on('data', part => process.stderr.write(part));
  const page = await application.firstWindow({ timeout: 90000 }); page.setDefaultTimeout(30000);
  await page.waitForURL(url => url.pathname.startsWith('/personal/v1/ui'));
  await page.route('**/personal/v1/**', async route => {
    const url = new URL(route.request().url());
    if (phase === 'before' && url.pathname.endsWith('/ui/native-desktop.js')) return route.fulfill({ contentType: 'text/javascript',
      body: execFileSync('git', ['show', `${baseline}:src/personal-access-ui/native-desktop.js`], { cwd: repository, encoding: 'utf8' }) });
    const response = await route.fetch({ url: candidate.origin + url.pathname + url.search, headers: { ...route.request().headers(), origin: candidate.origin } });
    return route.fulfill({ response });
  });
  await page.reload(); await localUiSession(page, candidate.credentials);
  const lastPalette = () => application.evaluate(() => globalThis.fix6.palettes.at(-1));
  for (const current of ['before', 'after']) {
    phase = current; await page.reload();
    for (const theme of ['light', 'dark']) {
      await page.getByRole('button', { name: '账户菜单' }).click();
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '外观', exact: true }).click();
      await page.getByRole('button', { name: theme === 'light' ? '浅色' : '深色', exact: true }).click();
      await page.waitForTimeout(350);
      const expected = await page.evaluate(() => {
        const style = getComputedStyle(document.querySelector('.desktop-titlebar'));
        const scrim = getComputedStyle(document.querySelector('dialog:modal'), '::backdrop').backgroundColor;
        const mix = color => {
          const base = color.match(/[\d.]+/g).map(Number), overlay = scrim.match(/[\d.]+/g).map(Number), alpha = overlay[3] ?? 1;
          return `rgb(${base.slice(0, 3).map((value, i) => Math.round(value * (1 - alpha) + overlay[i] * alpha)).join(', ')})`;
        };
        return { base: { color: style.backgroundColor, symbolColor: style.color }, mixed: { color: mix(style.backgroundColor), symbolColor: mix(style.color) }, scrim };
      });
      const opened = await until(async () => { const p = await lastPalette(); return p?.color === (phase === 'after' ? expected.mixed.color : expected.base.color) && p; });
      assert.equal(opened.symbolColor, phase === 'after' ? expected.mixed.symbolColor : expected.base.symbolColor);
      await screenshot(`${phase}-${theme}-settings-open.png`);
      if (phase === 'after') {
        await page.getByRole('combobox', { name: /^主题色/ }).click(); await page.getByRole('option', { name: '紫色', exact: true }).click();
        await page.waitForTimeout(100);
        assert.equal((await lastPalette()).color, expected.mixed.color);
        // Open order deliberately differs from DOM order; only the top scrim wins.
        await page.evaluate(() => {
          const top = document.createElement('dialog'); top.className = 'dialog'; top.id = 'fix6-top';
          top.style.setProperty('--wm-color-desktop-scrim', 'rgba(0, 0, 0, 0.5)');
          document.body.prepend(top); top.showModal();
        });
        await until(async () => (await lastPalette()).color !== expected.mixed.color);
        await page.evaluate(() => document.getElementById('fix6-top').remove());
        await until(async () => (await lastPalette()).color === expected.mixed.color);
      }
      await page.keyboard.press('Escape');
      await until(async () => (await lastPalette()).color === expected.base.color);
      await page.waitForTimeout(200); await screenshot(`${phase}-${theme}-settings-closed.png`);
      report.themes.push({ phase, theme, opened, restored: await lastPalette(), ...expected });
    }
  }
  report.appId = await application.evaluate(() => globalThis.fix6.appId);
  assert.equal(report.appId, 'com.memoweft.weftmate');
  await application.evaluate(() => globalThis.fix6.notify());
  report.notification = await application.evaluate(() => globalThis.fix6.notifications.at(-1));
  report.notification.iconEmpty = await application.evaluate(() => globalThis.fix6.iconEmpty);
  assert.equal(report.notification.title, 'WeftMate · 任务完成'); assert.equal(report.notification.iconEmpty, false);
  await until(() => application.evaluate(() => globalThis.fix6.shown || globalThis.fix6.notificationError));
  report.notificationShown = await application.evaluate(() => !!globalThis.fix6.shown);
  report.notificationError = await application.evaluate(() => globalThis.fix6.notificationError);
  assert.equal(report.notificationShown, true, report.notificationError);
  writeFileSync(join(evidence, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('FIX-6 real desktop checks passed');
} finally { await application?.close(); await candidate?.close(); }
