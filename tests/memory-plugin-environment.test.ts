import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repository = fileURLToPath(new URL('../', import.meta.url));
const selected = 'G9 legacy initialize uses UI locale|真实 Core RPC';
const files = ['tests/memory-plugin-contract.test.ts', 'tests/helpers/memoweft-environment.mjs',
  'src/plugins/weftmate-memory.mjs', 'src/dsh-web-runtime.ts', 'src/main.mjs',
  'src/plugins/weftmate-client/client.js'];

for (const fixture of [
  { name: 'no vendor, explicit Core inputs', vendor: false, core: true, reason: /Pinned DSH vendor runtime is unavailable/ },
  { name: 'no vendor or Core inputs', vendor: false, core: false, reason: /Pinned DSH vendor runtime is unavailable/ },
  { name: 'vendor present, no Core inputs', vendor: true, core: false, reason: /No explicit Core environment/ },
]) test(`optional plugin environment: ${fixture.name}`, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'weftmate-plugin-environment-')));
  try {
    for (const file of files) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await copyFile(join(repository, file), join(root, file));
    }
    const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };
    delete env.NODE_TEST_CONTEXT;
    for (const key of ['WEFTMATE_MEMOWEFT_PYTHON', 'WEFTMATE_MEMOWEFT_PYTHONPATH',
      'WEFTMATE_TEST_MEMOWEFT_PYTHON', 'WEFTMATE_TEST_MEMOWEFT_SOURCE']) delete env[key];
    if (fixture.core) {
      // Presence-only sentinels test the environment gate. They must never be
      // executed and do not count as a real Core integration result.
      env.WEFTMATE_TEST_MEMOWEFT_PYTHON = join(root, 'python-sentinel');
      env.WEFTMATE_TEST_MEMOWEFT_SOURCE = join(root, 'core-source');
      const entry = join(env.WEFTMATE_TEST_MEMOWEFT_SOURCE, 'memoweft/integrations/dsh_bridge/__main__.py');
      await mkdir(dirname(entry), { recursive: true });
      await writeFile(entry, 'raise RuntimeError("Core must not start")\n');
      await writeFile(env.WEFTMATE_TEST_MEMOWEFT_PYTHON, 'must not execute');
    }
    if (fixture.vendor) {
      const entry = join(root, 'vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-tools/lib/index.js');
      await mkdir(dirname(entry), { recursive: true });
      await writeFile(entry, 'export {}; throw new Error("Vendor must not import without Core inputs");\n');
    }
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap',
      `--test-name-pattern=${selected}`, 'tests/memory-plugin-contract.test.ts'],
    { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /# tests 5\r?\n/);
    assert.match(result.stdout, /# pass 0\r?\n/);
    assert.match(result.stdout, /# skipped 5\r?\n/);
    assert.match(result.stdout, fixture.reason);
  } finally { await rm(root, { recursive: true, force: true }); }
});
