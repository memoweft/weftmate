import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

test('materialization keeps the explicit parent boundary before any writes', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-materialize-path-'));
  try {
    const parent = join(root, 'allowed'), outside = join(root, 'outside');
    await mkdir(parent); await mkdir(outside);
    await writeFile(join(outside, 'keep.txt'), 'unchanged');
    for (const name of ['materialize-dsh-stage4b-build.ps1', 'materialize-dsh-stage4b-workspace-dependencies.ps1']) {
      const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', resolve('scripts', name),
        '-SourceRoot', outside, '-ExpectedParent', parent], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /SourceRoot must remain below/);
      assert.equal(await readFile(join(outside, 'keep.txt'), 'utf8'), 'unchanged');
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('MuMu executable overrides reach the existing manager lookup unchanged', async () => {
  const before = [process.env.WEFTMATE_MUMU_MANAGER, process.env.WEFTMATE_ADB];
  const root = resolve('synthetic-toolchain');
  try {
    process.env.WEFTMATE_MUMU_MANAGER = join(root, 'manager.exe');
    process.env.WEFTMATE_ADB = join(root, 'adb.exe');
    const configured = await import('../scripts/nightly/mumu.mjs?explicit-path-test');
    assert.equal(configured.adbExecutable, process.env.WEFTMATE_ADB);
    const info = configured.readMuMuInfo((command, args) => {
      assert.equal(command, process.env.WEFTMATE_MUMU_MANAGER);
      assert.deepEqual(args, ['info', '-v', '0']);
      return JSON.stringify({ adb_port: 19001, is_android_started: true, is_process_started: true });
    });
    assert.equal(info.serial, '127.0.0.1:19001');
  } finally {
    for (const [index, key] of ['WEFTMATE_MUMU_MANAGER', 'WEFTMATE_ADB'].entries()) {
      if (before[index] === undefined) delete process.env[key]; else process.env[key] = before[index];
    }
  }
});
