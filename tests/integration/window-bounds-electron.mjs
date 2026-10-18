import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';
import executablePath from 'electron';
import { closeTestElectron } from '../helpers/close-test-electron.mjs';

const root = mkdtempSync(join(tmpdir(), 'weftmate-window-bounds-'));
const repository = fileURLToPath(new URL('../../', import.meta.url));
// The real production BrowserWindow/persistence path, with an inert page and
// no runtime, model, cloud, account or native OS setting operations.
const server = createServer((request, response) => {
  if (request.url === '/personal/v1/ui') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><meta name="color-scheme" content="light dark"><title>WeftMate</title><style>body{box-sizing:border-box;margin:0;padding:80px;min-height:100vh;font:24px system-ui;background:#fff;color:#202020}@media(prefers-color-scheme:dark){body{background:#202020;color:#f1f1f1}}</style><h1>窗口尺寸验证</h1><p>合成数据 · 保存后重新打开</p>');
  } else { response.writeHead(401); response.end('{}'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const report = [], failures = [];
let application;
try {
  for (const scale of [1, 1.25, 1.5]) {
    const profile = join(root, String(scale)); mkdirSync(profile);
    const stateFile = join(profile, 'desktop-window.json');
    let expected = { x: 80, y: 80, width: 1000, height: 600 };
    writeFileSync(stateFile, JSON.stringify({ bounds: expected, maximized: false }));
    for (let cycle = 1; cycle <= 5; cycle++) {
      const env = { ...process.env, WINDOW_BOUNDS_PROFILE: profile,
        WEFTMATE_TEST_HOST_NAME: 'synthetic-host', WINDOW_BOUNDS_TRAY: String(cycle === 5),
        WINDOW_BOUNDS_ORIGIN: origin };
      delete env.ELECTRON_RUN_AS_NODE;
      const launchStarted = Date.now();
      application = await _electron.launch({ executablePath, cwd: repository, env,
        args: ['tests/helpers/window-bounds-electron.mjs', `--force-device-scale-factor=${scale}`] });
      const page = await application.firstWindow();
      const observed = await application.evaluate(async ({ screen }) => {
        await globalThis.windowBoundsDesktop.ready;
        const win = globalThis.windowBoundsDesktop.window;
        return { bounds: win.getBounds(), normal: win.getNormalBounds(), content: win.getContentBounds(),
          scale: screen.getPrimaryDisplay().scaleFactor };
      });
      assert.equal(observed.scale, scale);
      if (cycle === 1 && process.platform === 'win32') {
        const cases = await application.evaluate(async ({ screen }) => {
          const win = globalThis.windowBoundsDesktop.window, original = win.getBounds(), rows = [];
          for (const target of [{ x: 81, y: 81, width: 1001, height: 601 },
            { x: 82, y: 83, width: 1003, height: 603 }, original]) {
            await globalThis.restoreWindowsDesktopBounds(win, target, screen.getDisplayMatching(target));
            rows.push({ target, actual: win.getBounds() });
          }
          return rows;
        });
        for (const row of cases) assert.deepEqual(row.actual, row.target);
      }
      if (cycle <= 2 && process.env.WEFTMATE_EVIDENCE_DIR) {
        await application.evaluate(({ nativeTheme }, theme) => { nativeTheme.themeSource = theme; }, cycle === 1 ? 'light' : 'dark');
        await page.getByRole('heading', { name: '窗口尺寸验证' }).waitFor();
        await page.waitForFunction(dark => matchMedia('(prefers-color-scheme: dark)').matches === dark, cycle === 2);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        const png = await application.evaluate(async ({ desktopCapturer }) => {
          const win = globalThis.windowBoundsDesktop.window, handle = win.getNativeWindowHandle();
          const id = (handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())).toString();
          const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1600, height: 1000 } });
          const source = sources.find(item => item.id.split(':')[1] === id);
          return source?.thumbnail.toPNG().toString('base64');
        });
        assert.ok(png, 'native window screenshot is available');
        mkdirSync(process.env.WEFTMATE_EVIDENCE_DIR, { recursive: true });
        writeFileSync(join(process.env.WEFTMATE_EVIDENCE_DIR, `${scale}-${cycle === 1 ? 'light' : 'dark'}.png`), Buffer.from(png, 'base64'));
      }
      if (cycle === 4) {
        assert.deepEqual(await application.evaluate(() => {
          const win = globalThis.windowBoundsDesktop.window; win.maximize(); return win.getNormalBounds();
        }), expected);
      }
      if (cycle === 5) {
        const tray = await application.evaluate(() => {
          const desktop = globalThis.windowBoundsDesktop, hidden = !desktop.window.isVisible(); desktop.show();
          return { hidden, maximized: desktop.window.isMaximized(), normal: desktop.window.getNormalBounds() };
        });
        assert.equal(tray.hidden, true); assert.equal(tray.maximized, true); assert.deepEqual(tray.normal, expected);
      }
      await closeTestElectron(application, async () => { await globalThis.windowBoundsDesktop.close(); });
      application = null;
      const saved = JSON.parse(readFileSync(stateFile, 'utf8')).bounds;
      const row = { scale, cycle, expected, ...observed, saved, cycleMs: Date.now() - launchStarted }; report.push(row);
      console.log(JSON.stringify(row));
      try { assert.deepEqual(observed.bounds, expected); assert.deepEqual(observed.normal, expected); assert.deepEqual(saved, expected); }
      catch (error) { failures.push({ scale, cycle, error: error.message }); }
      expected = saved;
    }
  }
} finally {
  await application?.close(); await new Promise(resolve => server.close(resolve));
  if (process.env.WEFTMATE_EVIDENCE_DIR) {
    mkdirSync(process.env.WEFTMATE_EVIDENCE_DIR, { recursive: true });
    writeFileSync(join(process.env.WEFTMATE_EVIDENCE_DIR, 'window-bounds.json'), JSON.stringify({ report, failures }, null, 2));
  }
}
assert.deepEqual(failures, [], 'Every restart must restore the exact saved outer DIP rectangle');
