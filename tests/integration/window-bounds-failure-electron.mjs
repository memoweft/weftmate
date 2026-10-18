import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import executablePath from 'electron';
import { launchWindowBoundsProcess } from '../helpers/bounded-window-electron.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'weftmate-window-failure-'));
const expected = { bounds: { x: 80, y: 80, width: 1000, height: 600 }, maximized: false };
const server = createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>WeftMate</title>Isolated window fixture'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const report = [], failures = [];
let application;
try {
  for (const scale of [1.25, 1.5, 1.75]) for (const fault of ['missing', 'hung', 'close-hung']) {
    const profile = join(root, `${scale}-${fault}`); mkdirSync(profile);
    const stateFile = join(profile, 'desktop-window.json'), original = JSON.stringify(expected);
    writeFileSync(stateFile, original);
    const env = { ...process.env, WINDOW_BOUNDS_PROFILE: profile,
      WINDOW_BOUNDS_ORIGIN: `http://127.0.0.1:${server.address().port}`, WINDOW_BOUNDS_EARLY_SHOW: 'true',
      WINDOW_BOUNDS_FAULT: fault === 'missing' ? 'missing' : 'hung', WEFTMATE_TEST_HOST_NAME: 'synthetic-host' };
    delete env.ELECTRON_RUN_AS_NODE;
    if (fault === 'missing') { for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key]; env.PATH = profile; }
    try {
      application = await launchWindowBoundsProcess({ executablePath, cwd: repository, env,
        args: ['tests/helpers/window-bounds-electron.mjs', `--force-device-scale-factor=${scale}`] }, join(profile, 'process.log'));
      const observed = await application.request(fault === 'close-hung' ? 'close' : 'status');
      if (fault !== 'close-hung' && observed.ready) await application.request('close');
      const saved = readFileSync(stateFile, 'utf8');
      let pids = observed.bridgePid ? [observed.bridgePid] : [];
      try { pids = JSON.parse(readFileSync(join(profile, 'bridge-pids.json'), 'utf8')); } catch {}
      const alive = pids.filter(pid => { try { process.kill(pid, 0); return true; } catch { return false; } });
      const row = { scale, fault, observed, saved: JSON.parse(saved), remaining: alive.length }; report.push(row); console.log(JSON.stringify(row));
      if (fault === 'close-hung') assert.equal(observed.closed, true, 'close must cancel the pending bridge');
      else { assert.equal(observed.ready, true, 'restore must finish or fall back within its deadline'); assert.equal(observed.visible, true); }
      assert.equal(saved, original, 'failed/cancelled native restoration must preserve the original state bytes');
      assert.equal(alive.length, 0, 'bridge and descendant must be gone before shutdown completes');
    } catch (error) { failures.push({ scale, fault, error: error.message }); }
    finally { await application?.stop(); application = null; }
  }
} finally {
  await application?.stop(); await new Promise(resolve => server.close(resolve));
  if (process.env.WEFTMATE_EVIDENCE_DIR) {
    mkdirSync(process.env.WEFTMATE_EVIDENCE_DIR, { recursive: true });
    writeFileSync(join(process.env.WEFTMATE_EVIDENCE_DIR, 'window-bounds-failure.json'), JSON.stringify({ report, failures }, null, 2));
  }
}
assert.deepEqual(failures, []);
