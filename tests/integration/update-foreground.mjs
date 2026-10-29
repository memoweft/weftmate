/** Real main/window startup; every profile and port belongs to this fixture. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { _electron } from 'playwright';
import { managedMkdtempSync, disposeManagedTemp, startManagedTempLease } from '../helpers/managed-temp.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
const out = process.env.WEFTMATE_EVIDENCE_DIR;
assert.ok(out, 'External WEFTMATE_EVIDENCE_DIR required');
mkdirSync(out, { recursive: true });
const report = { scenarios: [] };
for (const mode of (process.env.WEFTMATE_UPDATE_FOREGROUND_MODES || 'normal,tray,minimized,ordinary-tray').split(',')) {
  const root = managedMkdtempSync('weftmate-update-foreground-', { prune: false });
  const stopLease = startManagedTempLease(root);
  writeFileSync(join(root, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
  const config = join(root, 'desktop-config.json');
  writeFileSync(config, JSON.stringify({ schemaVersion: 1, dataDirectory: root, accessPort: 0, updates: { channel: 'preview' } }));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_|ELECTRON_RUN_AS_NODE)/.test(key)) delete env[key];
  Object.assign(env, { WEFTMATE_MEMOWEFT_ENABLED: '0', WEFTMATE_TEST_HOST_NAME: 'synthetic-host' });
  let app;
  try {
    const executable = process.env.WEFTMATE_UPDATE_FOREGROUND_EXECUTABLE;
    app = await _electron.launch({ executablePath: executable || createRequire(import.meta.url)('electron'), cwd: resolve('.'),
      args: [...(executable ? [] : [resolve('.')]), `--desktop-config=${config}`,
        ...(mode === 'ordinary-tray' ? [] : ['--updated']), ...(mode.includes('tray') ? ['--start-in-tray'] : [])], env, timeout: 90000 });
    const page = await app.firstWindow();
    if (mode === 'minimized') await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.on('did-start-navigation', (_event, url, _inPlace, main) => { if (main && url.includes('/personal/v1/ui')) win.minimize(); });
    });
    await page.waitForURL(/\/personal\/v1\/ui/, { timeout: 90000 });
    await page.waitForFunction(() => globalThis.__WeftUiStarted === true);
    // host.ready follows the main-process health/activation checkpoint.
    await app.evaluate(async ({ app }) => {
      const fs = process.getBuiltinModule('fs'), path = process.getBuiltinModule('path');
      const root = path.join(app.getPath('userData'), 'logs');
      for (let i = 0; i < 500; i++) {
        if (fs.readdirSync(root).filter(n => /^host-.*\.jsonl$/.test(n)).some(n => fs.readFileSync(path.join(root, n), 'utf8').includes('"event":"host.ready"'))) return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw Error('host.ready missing');
    });
    const state = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      return { visible: window.isVisible(), minimized: window.isMinimized(), focused: window.isFocused(), windows: BrowserWindow.getAllWindows().length };
    });
    report.scenarios.push({ mode, state });
    if (state.visible && !state.minimized) await page.screenshot({ path: join(out, `startup-${mode}.png`) });
    if (!process.env.WEFTMATE_RECORD_BASELINE) {
      assert.equal(state.visible, mode !== 'ordinary-tray', JSON.stringify({ mode, state }));
      if (mode !== 'ordinary-tray') { assert.equal(state.minimized, false); assert.equal(state.focused, true); }
      assert.equal(state.windows, 1);
    }
  } finally {
    await app?.close(); stopLease(); disposeManagedTemp(root);
    writeFileSync(join(out, 'startup.json'), JSON.stringify(report, null, 2));
  }
}
console.log('UPDATE-FOREGROUND: real main update startup and ordinary tray passed');
