import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { assertMainSource } from './build-source.mjs';

test('build provenance rejects changed hooks and untracked packaging inputs, allowing acceptance-only changes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'build-source-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, windowsHide: true, stdio: 'pipe', timeout: 5000 }).toString().trim();
  try {
    git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
    for (const file of ['src/main.mjs', 'scripts/memory-runtime-package.mjs', 'scripts/stage-dsh-runtime.mjs',
      'scripts/release/installer-assets.cjs', 'scripts/release/memory-runtime-after-pack.cjs', 'package.json', '.gitignore']) {
      await mkdir(join(dir, file, '..'), { recursive: true }); await writeFile(join(dir, file), file === '.gitignore' ? '*.ignored\n' : 'baseline');
    }
    git('add', '.'); git('commit', '-qm', 'fixture'); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    const source = git('rev-parse', 'origin/main');
    assert.equal(assertMainSource(dir), source);
    for (const file of ['scripts/memory-runtime-package.mjs', 'scripts/stage-dsh-runtime.mjs',
      'scripts/release/installer-assets.cjs', 'scripts/release/memory-runtime-after-pack.cjs']) {
      const path = join(dir, file), original = await readFile(path);
      await writeFile(path, 'changed build hook');
      assert.throws(() => assertMainSource(dir), /differs|input/i, file);
      await writeFile(path, original);
    }
    for (const file of ['src/injected.mjs', 'runtime/extra.ignored', 'scripts/release/extra.cjs']) {
      const path = join(dir, file); await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, 'untracked input');
      assert.throws(() => assertMainSource(dir), /untracked|input/i, file);
      await rm(path);
    }
    await mkdir(join(dir, 'scripts/acceptance'), { recursive: true });
    await writeFile(join(dir, 'scripts/acceptance/fixture.mjs'), 'acceptance-only');
    assert.equal(assertMainSource(dir), source);
    // Run the real entry point: reject dirty build hooks before importing/evaluating them.
    const runner = join(dir, 'scripts/acceptance/windows');
    await mkdir(runner, { recursive: true });
    for (const file of ['build.mjs', 'build-source.mjs']) await copyFile(new URL(file, import.meta.url), join(runner, file));
    await writeFile(join(dir, 'scripts/memory-runtime-package.mjs'), "throw Error('BUILD_HOOK_EXECUTED_BEFORE_VALIDATION')");
    const result = spawnSync(process.execPath, [join(runner, 'build.mjs'), join(dir, 'output'), join(dir, 'memory'), '0.0.0', 'fixture'],
      { cwd: dir, encoding: 'utf8', windowsHide: true, timeout: 5000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Build input differs/);
    assert.doesNotMatch(result.stderr, /BUILD_HOOK_EXECUTED_BEFORE_VALIDATION/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
