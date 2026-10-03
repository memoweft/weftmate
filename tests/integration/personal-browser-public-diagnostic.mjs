/** Opt-in read-only default-reader diagnostic: two fixed public official pages, no model. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32' || process.env.WEFTMATE_BROWSER_PUBLIC_DIAGNOSTIC !== '1') {
  throw new Error('Set WEFTMATE_BROWSER_PUBLIC_DIAGNOSTIC=1 for the fixed official-page read-only diagnostic.');
}
const repository = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const electron = createRequire(import.meta.url)('electron');
const root = mkdtempSync(join(tmpdir(), 'weftmate-browser-public-diagnostic-'));
assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
const profile = join(root, 'profile');
mkdirSync(profile);
const child = spawn(electron, [join(repository, 'tests', 'fixtures', 'personal-browser-public-child.mjs'),
  `--user-data-dir=${profile}`], { cwd: repository, windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WEFTMATE_BROWSER_PUBLIC_DIAGNOSTIC: '1' } });
let stdout = '', stderr = '';
child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => { stdout = (stdout + chunk).slice(-16_000) });
child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4_000) });
let timer;
let timedOut = false;
const exit = await Promise.race([
  new Promise((resolve) => child.once('close', (code) => resolve(code))),
  new Promise((resolve) => { timer = setTimeout(() => { timedOut = true; resolve(null) }, 45_000) }),
]);
clearTimeout(timer);
if (timedOut && child.pid) {
  const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'],
    { stdio: 'ignore', windowsHide: true });
  await new Promise((resolve) => killer.once('close', resolve));
}
const results = stdout.split(/\r?\n/).filter((line) => line.startsWith('DIAG_JSON:'))
  .map((line) => JSON.parse(line.slice('DIAG_JSON:'.length)));
console.log(JSON.stringify({ exitCode: exit, timedOut, results,
  errorTail: stderr.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(-500) }));
if (child.exitCode !== null && realpathSync(root).startsWith(realpathSync(tmpdir()) + sep)) {
  rmSync(root, { recursive: true, force: true });
}
