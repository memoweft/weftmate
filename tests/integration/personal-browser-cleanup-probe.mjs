/** Opt-in owned fixture only: measure Electron session cleanup while window is alive/blank. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (process.platform !== 'win32' || process.env.WEFTMATE_BROWSER_CLEANUP_PROBE !== '1' ||
    !['alive', 'blank'].includes(mode)) throw new Error('Run only the owned cleanup fixture with alive or blank mode.');
const repository = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const electron = createRequire(import.meta.url)('electron');
const root = mkdtempSync(join(tmpdir(), 'weftmate-synthetic-stop-stage11-'));
assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
const profile = join(root, 'profile');
mkdirSync(profile);
writeFileSync(join(profile, 'stage11-browser-fixture.json'),
  JSON.stringify({ purpose: 'stage11-owned-browser-fixture' }), { flag: 'wx', mode: 0o600 });
const fixture = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><html><title>Owned</title><main>Rendered owned fixture.</main></html>');
});
await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
const fixturePort = fixture.address().port;
const child = spawn(electron, [join(repository, 'tests', 'fixtures', 'personal-browser-child.mjs'),
  `--user-data-dir=${profile}`], { cwd: repository, windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  env: { ...process.env, WEFTMATE_BROWSER_SYNTHETIC_FIXTURE: '1',
    WEFTMATE_BROWSER_FIXTURE_PORT: String(fixturePort) } });
const phases = [];
let ready;
const readyPromise = new Promise((resolve) => { ready = resolve });
let finish;
const done = new Promise((resolve) => { finish = resolve });
child.on('error', (error) => phases.push(`child-error:${error.code ?? 'unknown'}`));
child.on('message', (frame) => {
  if (frame?.type === 'ready') ready();
  if (frame?.id === probeId && frame.type === 'probe-phase') phases.push(frame.phase);
  if (frame?.id === probeId && frame.type === 'probe-result') finish(frame);
});
const probeId = `probe-${randomUUID()}`;
let result = null;
let timedOut = false;
try {
  await Promise.race([readyPromise, new Promise((_, reject) => setTimeout(() => reject(new Error('fixture not ready')), 10_000))]);
  child.send({ type: 'probeCleanup', id: probeId, mode });
  result = await Promise.race([done, new Promise((resolve) => setTimeout(() => { timedOut = true; resolve(null); }, 6_000))]);
  console.log(JSON.stringify({ mode, phases, timedOut, result }));
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    const closed = new Promise((resolve) => child.once('close', resolve));
    if (timedOut) {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'],
        { stdio: 'ignore', windowsHide: true });
      await new Promise((resolve) => killer.once('close', resolve));
    } else if (child.connected) child.send({ type: 'close' }, () => {});
    await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 8_000))]);
    if (child.exitCode === null && child.pid) child.kill();
  }
  fixture.closeAllConnections?.();
  await new Promise((resolve) => fixture.close(resolve));
  if (child.exitCode !== null && realpathSync(root).startsWith(realpathSync(tmpdir()) + sep)) {
    rmSync(root, { recursive: true, force: true });
  }
}
