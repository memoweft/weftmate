import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import executablePath from 'electron';
import { launchWindowElectron, closeWindowElectron, stopWindowElectron } from '../helpers/bounded-window-electron.mjs';

const root = mkdtempSync(join(tmpdir(), 'weftmate-window-recovery-'));
const server = createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>WeftMate</title>Window recovery fixture'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const fixtures = [undefined, '{broken', JSON.stringify({ bounds: { x: 'bad', y: 80, width: 1000, height: 600 } }),
  JSON.stringify({ bounds: { x: 80, y: 80, width: 100, height: 100 } }),
  JSON.stringify({ bounds: { x: 30000, y: 30000, width: 1000, height: 600 } }),
  JSON.stringify({ bounds: { x: -20, y: -20, width: 1000, height: 600 } })];
let application;
const rows = [];
try {
  for (let index = 0; index < fixtures.length; index++) {
    const profile = join(root, String(index)); mkdirSync(profile);
    const stateFile = join(profile, 'desktop-window.json');
    if (fixtures[index] !== undefined) writeFileSync(stateFile, fixtures[index]);
    const env = { ...process.env, WINDOW_BOUNDS_PROFILE: profile,
      WINDOW_BOUNDS_ORIGIN: `http://127.0.0.1:${server.address().port}`, WEFTMATE_TEST_HOST_NAME: 'synthetic-host' };
    delete env.ELECTRON_RUN_AS_NODE;
    application = await launchWindowElectron({ executablePath, cwd: fileURLToPath(new URL('../../', import.meta.url)), env,
      args: ['tests/helpers/window-bounds-electron.mjs', '--force-device-scale-factor=1.25'] }, join(profile, 'process.log'));
    const observed = await application.evaluate(async ({ screen }) => {
      await globalThis.windowBoundsDesktop.ready;
      const win = globalThis.windowBoundsDesktop.window;
      return { visible: win.isVisible(), bounds: win.getBounds(), area: screen.getDisplayMatching(win.getBounds()).workArea };
    });
    assert.equal(observed.visible, true);
    const { bounds, area } = observed;
    assert.ok(Object.values(bounds).every(Number.isFinite)); assert.ok(bounds.width >= 760 && bounds.height >= 520);
    assert.ok(bounds.x >= area.x && bounds.y >= area.y && bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height);
    if (index === 5) assert.deepEqual(bounds, { x: area.x, y: area.y, width: 1000, height: 600 });
    await closeWindowElectron(application); application = null;
    assert.deepEqual(JSON.parse(readFileSync(stateFile, 'utf8')).bounds, bounds);
    rows.push({ index, ...observed });
  }
} finally {
  await stopWindowElectron(application); await new Promise(resolve => server.close(resolve));
  if (process.env.WEFTMATE_EVIDENCE_DIR) {
    mkdirSync(process.env.WEFTMATE_EVIDENCE_DIR, { recursive: true });
    writeFileSync(join(process.env.WEFTMATE_EVIDENCE_DIR, 'window-bounds-recovery.json'), JSON.stringify(rows, null, 2));
  }
}
console.log('Window recovery 6/6 passed');
