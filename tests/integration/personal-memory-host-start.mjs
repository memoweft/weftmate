/** Isolated real Electron/DSH/account/Core startup, without inference or real user data. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32' || process.env.WEFTMATE_REAL_MEMORY_HOST_START !== '1') {
  throw new Error('Set WEFTMATE_REAL_MEMORY_HOST_START=1 for isolated model-free Electron startup.');
}
const repository = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const python = 'D:/AIProjects/MemoWeft/Core/py/.venv/Scripts/python.exe';
const pythonPath = 'D:/AIProjects/MemoWeft/Core/py/src';
if (!existsSync(python)) throw new Error('MemoWeft Core Python runtime is unavailable');
const root = mkdtempSync(join(tmpdir(), 'weftmate-memory-host-'));
assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
const profile = join(root, 'profile');
const config = join(root, 'memory-config.json');
writeFileSync(config, JSON.stringify({ python, pythonPath, baseUrl: 'http://127.0.0.1:8081/v1',
  model: '@current', authRef: 'personal-local-occamy-miniplus-v21' }));
let output = '';
const child = spawn(process.execPath, [join(repository, 'scripts', 'run-personal-host.mjs'),
  '--user-data-dir', profile, '--access-port', '0', '--personal-memory-config', config], {
  cwd: repository, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
});
for (const stream of [child.stdout, child.stderr]) stream.on('data', (part) => { output += String(part); });
async function waitFor(pattern, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = pattern.exec(output);
    if (match) return match;
    if (child.exitCode !== null) throw new Error(`isolated host exited ${child.exitCode}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('isolated memory host did not become ready');
}
async function register(origin, username) {
  const response = await fetch(`${origin}/personal/v1/auth/register`, { method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'synthetic memory host password 123', deviceName: 'Fixture' }) });
  assert.equal(response.status, 201);
  return { ownerId: (await response.json()).account.ownerId, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
try {
  const origin = (await waitFor(/personal-access listening origin=(http:\/\/127\.0\.0\.1:\d+)/))[1];
  const [a, b] = await Promise.all([register(origin, 'SyntheticMemoryA'), register(origin, 'SyntheticMemoryB')]);
  assert.notEqual(a.ownerId, b.ownerId);
  for (const account of [a, b]) {
    const response = await fetch(`${origin}/personal/v1/memory/status`, { headers: { cookie: account.cookie } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ownerId, account.ownerId);
    assert.equal(body.state, 'degraded', 'no formal local model credential was configured');
    assert.equal(body.capabilities.list, true);
    assert.equal(body.capabilities.inject, false);
    assert.equal(body.pendingBoundaryCount, 0);
    assert.equal(body.discardedBoundaryCount, 0);
  }
  assert.ok(output.includes('dsh web: http://127.0.0.1:'), 'real DSH child was started');
  const pluginPatch = readFileSync(join(profile, 'dsh-home', 'profiles', 'weftmate', 'cordis.patch.yml'), 'utf8');
  assert.equal(pluginPatch.match(/id: weftmate-personal-memory/g)?.length, 1,
    'the managed real DSH profile must register the account-memory plugin exactly once');
  assert.equal(existsSync(join(profile, 'dsh-home', 'profiles', 'weftmate', 'plugins',
    'weftmate-personal-memory.mjs')), true);
  console.log('[personal-memory-host-start] Electron/DSH loaded the account-memory plugin; two accounts have model-free Core status; no inference');
} finally {
  if (child.exitCode === null) {
    const closed = new Promise((resolve) => child.once('close', resolve));
    child.stdin.write('q\n');
    await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('isolated host close timeout')), 20_000))]);
  }
  assert.equal(child.exitCode, 0);
  assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
  rmSync(root, { recursive: true, force: true });
}
