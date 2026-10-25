import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareWindowsRuntimeComponents } from '../scripts/windows-runtime-components.mjs';
import { packagedRuntimeDirectory } from '../src/runtime-components.mjs';
import { applyDesktopConfig } from '../src/desktop-config.mjs';

test('Windows packaging separates immutable runtimes; unchanged components survive a shell replacement', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fix-update2-components-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const appOutDir = join(root, 'app'), resources = join(appOutDir, 'resources'), out = join(root, 'headers');
  const context = { appOutDir, packager: { projectDir: root, config: { appId: 'test.fixupdate2' } } };
  const payload = async (dsh: string) => {
    for (const [name, text] of [['dsh-runtime', dsh], ['memory-runtime', 'same memory']]) {
      await mkdir(join(resources, name), { recursive: true });
      await writeFile(join(resources, name, 'entry.js'), text);
    }
  };
  await payload('DSH one');
  await prepareWindowsRuntimeComponents(context, out);
  assert.equal(existsSync(join(resources, 'dsh-runtime')), false, 'runtime files must leave the shell payload');
  const dsh1 = packagedRuntimeDirectory(resources, 'dsh-runtime');
  const memory1 = packagedRuntimeDirectory(resources, 'memory-runtime');
  assert.equal(await readFile(join(dsh1, 'entry.js'), 'utf8'), 'DSH one');
  const before = (await stat(join(memory1, 'entry.js'))).mtimeMs;
  const profile = applyDesktopConfig({ appData: join(root, 'profile'), argv: ['app'], env: {}, packaged: true, platform: 'win32', resourcesPath: resources });
  // This is what the previous uninstaller removes. Components must survive it.
  await rm(appOutDir, { recursive: true });
  await payload('DSH two');
  await prepareWindowsRuntimeComponents(context, out);
  assert.notEqual(packagedRuntimeDirectory(resources, 'dsh-runtime'), dsh1);
  assert.equal(packagedRuntimeDirectory(resources, 'memory-runtime'), memory1);
  assert.equal((await stat(join(memory1, 'entry.js'))).mtimeMs, before, 'unchanged memory must not be rewritten');
  assert.equal(await readFile(join(dsh1, 'entry.js'), 'utf8'), 'DSH one', 'keep the previous runtime for rollback');
  const upgraded = applyDesktopConfig({ appData: join(root, 'profile'), argv: ['app'], env: {}, packaged: true, platform: 'win32', resourcesPath: resources });
  assert.equal(upgraded.config.dataDirectory, profile.config.dataDirectory);
  assert.equal(upgraded.memoryRuntimeDirectory, memory1);
});

test('regenerating vendor metadata does not reinstall an unchanged DSH version', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fix-update2-vendor-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const appOutDir = join(root, 'app'), resources = join(appOutDir, 'resources');
  const versions = [];
  for (const generatedAt of ['2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z']) {
    for (const name of ['dsh-runtime', 'memory-runtime']) {
      await mkdir(join(resources, name), { recursive: true });
      await writeFile(join(resources, name, 'entry.js'), 'same runtime');
    }
    await writeFile(join(resources, 'dsh-runtime/VENDOR-MANIFEST.json'), JSON.stringify({ generatedAt, runtimeIdentity: { key: 'same-commit-and-patches' } }));
    versions.push((await prepareWindowsRuntimeComponents({ appOutDir, packager: { projectDir: root, config: { appId: 'test.fixupdate2' } } })).components['dsh-runtime']);
  }
  assert.equal(versions[0], versions[1]);
});

test('legacy unpacked resources still resolve without a component descriptor', () => {
  assert.equal(packagedRuntimeDirectory('/synthetic/resources', 'memory-runtime'), join('/synthetic/resources', 'memory-runtime'));
});
