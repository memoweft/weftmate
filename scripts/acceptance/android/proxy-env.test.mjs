import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
test('relay launch clears inherited proxy opt-in unless explicitly requested', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-env-'));
  try {
    for (const enabled of [false, true]) {
      const file = join(dir, 'observed.json');
      const result = spawnSync(process.execPath, ['--import', new URL('./mock-launch.mjs', import.meta.url).href,
        fileURLToPath(new URL('./relay-session.mjs', import.meta.url)), dir, dir, '--desktop-executable', 'mock.exe', ...(enabled ? ['--use-env-proxy'] : [])],
        { env: { ...process.env, NODE_USE_ENV_PROXY: '1', LAUNCH_ENV_FILE: file }, windowsHide: true, stdio: 'pipe', timeout: 5000 });
      assert.equal(result.status, 1, 'stub ends before a real desktop is started');
      assert.match(result.stdout.toString(), /MockLaunchComplete/, result.stderr.toString());
      assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), enabled ? { proxy: '1' } : {});
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
