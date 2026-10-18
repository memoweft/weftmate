import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, watch } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import executablePath from 'electron';
import { launchWindowElectron, closeWindowElectron, stopWindowElectron } from '../helpers/bounded-window-electron.mjs';

const root = mkdtempSync(join(tmpdir(), 'weftmate-window-early-show-'));
const repository = fileURLToPath(new URL('../../', import.meta.url));
const expected = { x: 80, y: 80, width: 1000, height: 600 };
const server = createServer((request, response) => {
  if (request.url === '/personal/v1/ui') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><title>WeftMate</title><script>globalThis.startupConversations=[];globalThis.settingsCalls=[];globalThis.WeftSettingsNavigation={open:category=>settingsCalls.push(category)};window.weftmateDesktop.onConversation(value=>{globalThis.startupConversation=value;startupConversations.push(value)});</script>Window startup fixture');
  }
  else { response.writeHead(401); response.end('{}'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const report = [], failures = [];
let application, observer;
try {
  for (const scale of [1.25, 1.5, 1.75]) for (let attempt = 1; attempt <= 3; attempt++) {
    const profile = join(root, `${scale}-${attempt}`); mkdirSync(profile);
    const stateFile = join(profile, 'desktop-window.json');
    writeFileSync(stateFile, JSON.stringify({ bounds: expected, maximized: true }));
    const snapshots = [];
    // Side-channel observation only: ignore our read/parse errors without
    // replacing a production function, changing its return, or adding waits.
    observer = watch(profile, (_event, file) => {
      if (!['desktop-window.json', 'desktop-window.json.tmp'].includes(String(file))) return;
      try { snapshots.push(JSON.parse(readFileSync(join(profile, String(file)), 'utf8'))); } catch {}
    });
    const action = ['show', 'settings', 'send-to'][attempt - 1];
    const env = { ...process.env, WINDOW_BOUNDS_PROFILE: profile, WINDOW_BOUNDS_EARLY_SHOW: 'true',
      WINDOW_BOUNDS_EARLY_ACTION: action, WINDOW_BOUNDS_TRAY: String(attempt !== 1),
      WINDOW_BOUNDS_ORIGIN: `http://127.0.0.1:${server.address().port}`, WEFTMATE_TEST_HOST_NAME: 'synthetic-host' };
    delete env.ELECTRON_RUN_AS_NODE;
    application = await launchWindowElectron({ executablePath, cwd: repository, env,
      args: ['tests/helpers/window-bounds-electron.mjs', `--force-device-scale-factor=${scale}`] }, join(profile, 'process.log'));
    const observed = await application.evaluate(async ({ screen }) => {
      const desktop = globalThis.windowBoundsDesktop;
      await desktop.ready;
      const win = desktop.window, maximized = win.isMaximized();
      if (maximized) await new Promise(resolve => { win.once('unmaximize', resolve); win.unmaximize(); });
      return { early: globalThis.windowBoundsEarlyShow, maximized, visible: win.isVisible(),
        bounds: win.getBounds(), normal: win.getNormalBounds(), scale: screen.getPrimaryDisplay().scaleFactor };
    });
    const page = await application.firstWindow();
    if (action === 'settings') {
      await page.waitForFunction(() => globalThis.settingsCalls.length === 1);
      assert.deepEqual(await page.evaluate(() => globalThis.settingsCalls), ['general']);
    }
    if (action === 'send-to') {
      await page.waitForFunction(() => globalThis.startupConversation?.sessionId === 'early-last');
      assert.deepEqual(await page.evaluate(() => globalThis.startupConversations), [{ sessionId: 'early-last' }]);
    }
    await closeWindowElectron(application);
    application = null; observer.close(); observer = null;
    const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
    const row = { scale, attempt, action, expected, ...observed, saved, snapshots }; report.push(row);
    console.log(JSON.stringify(row));
    try {
      assert.equal(observed.scale, scale); assert.equal(observed.maximized, true); assert.equal(observed.visible, true);
      assert.deepEqual(observed.bounds, expected); assert.deepEqual(observed.normal, expected);
      assert.deepEqual(saved, { bounds: expected, maximized: false });
      for (const snapshot of snapshots) assert.deepEqual(snapshot.bounds, expected, 'Intermediate geometry must never be persisted');
      assert.deepEqual(observed.early, { visible: false, maximized: false }, 'Showing waits for initial geometry restoration');
    } catch (error) { failures.push({ scale, attempt, error: error.message }); }
  }
} finally {
  observer?.close(); await stopWindowElectron(application); await new Promise(resolve => server.close(resolve));
  if (process.env.WEFTMATE_EVIDENCE_DIR) {
    mkdirSync(process.env.WEFTMATE_EVIDENCE_DIR, { recursive: true });
    writeFileSync(join(process.env.WEFTMATE_EVIDENCE_DIR, 'window-bounds-early-show.json'), JSON.stringify({ report, failures }, null, 2));
  }
}
assert.deepEqual(failures, [], 'Early activation must preserve saved normal bounds through unmaximize and shutdown');
