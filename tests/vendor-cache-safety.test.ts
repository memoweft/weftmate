import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, realpath, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { managedMkdtemp } from './helpers/managed-temp.mjs'
import { prepareMatrixProject, runCacheMatrix, treeDigest } from './helpers/vendor-cache-matrix.mjs'
import { DEFAULT_WINDOWS_CACHE_ROOT, assertRuntimeDestination, createRuntimeScratch, pointRuntime } from '../scripts/dsh-runtime-storage.mjs'
import { stageDshRuntime } from '../scripts/stage-dsh-runtime.mjs'
import { assertRuntimeIdentity } from '../scripts/dsh-runtime-identity.mjs'

const linkType = process.platform === 'win32' ? 'junction' : 'dir'

test('vendor preserves both caches in the 5 pointer x 3 cache x 5 outcome matrix', async () => {
  const root = await managedMkdtemp('weftmate-vendor-safety-')
  try {
    const rows = await runCacheMatrix(root, await prepareMatrixProject(root))
    assert.equal(rows.length, 75)
    assert.ok(rows.every(row => row.unchanged))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('PowerShell 5.1 and 7 npm wrappers preserve caches for every starting state', { skip: process.platform !== 'win32' }, async () => {
  const root = await managedMkdtemp('weftmate-vendor-shell-')
  try {
    const shells = [resolve(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe'), 'pwsh.exe']
    const rows = await runCacheMatrix(root, await prepareMatrixProject(root), { shells, phases: ['success', 'interrupt'] })
    assert.equal(rows.length, 60)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('regression: inherited pnpm install paths cannot purge a published cache from an isolated cwd', async () => {
  const root = await managedMkdtemp('weftmate-vendor-install-env-')
  try {
    const rows = await runCacheMatrix(root, await prepareMatrixProject(root), { inheritedInstallPaths: true })
    assert.equal(rows.length, 75)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('runtime output under a parent junction is rejected before unlink, mkdir or assembly', async () => {
  const root = await managedMkdtemp('weftmate-vendor-parent-')
  try {
    const shared = join(root, 'cache'), other = join(shared, 'other-cache'), parent = join(root, 'vendor')
    await mkdir(join(other, 'dsh-runtime/node_modules'), { recursive: true })
    await writeFile(join(other, 'dsh-runtime/node_modules/keep'), 'immutable cache')
    await symlink(other, parent, linkType)
    const before = await treeDigest(other)
    await assert.rejects(pointRuntime(join(parent, 'dsh-runtime'), other, shared), /拒绝经联接/)
    assert.deepEqual(await treeDigest(other), before)
    await unlink(parent)
    await assert.rejects(assertRuntimeDestination(other, shared), /只读缓存根重叠/)
    await assert.rejects(assertRuntimeDestination(root, shared), /只读缓存根重叠/)
    if (process.platform === 'win32') {
      await assert.rejects(assertRuntimeDestination(shared.toUpperCase(), shared), /只读缓存根重叠/)
      await assert.rejects(assertRuntimeDestination(join(DEFAULT_WINDOWS_CACHE_ROOT, 'synthetic-output'), shared), /只读缓存根重叠/)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('normal invocation reads a valid runtime through linked vendor parents without changing either link', async () => {
  const root = await managedMkdtemp('weftmate-vendor-readonly-')
  try {
    const context = await prepareMatrixProject(root)
    await runCacheMatrix(root, context, { phases: ['success'] })
    const cache = join(root, 'node-absent-good-success/cache/other-cache')
    const physicalVendor = join(root, 'physical-vendor'), vendor = join(root, 'linked-vendor')
    await mkdir(physicalVendor); await symlink(cache, join(physicalVendor, 'dsh-runtime'), linkType)
    await symlink(physicalVendor, vendor, linkType)
    const before = await treeDigest(cache)
    const env = { ...process.env, WEFTMATE_DSH_RUNTIME_DIR: join(vendor, 'dsh-runtime'), WEFTMATE_DSH_PIN_FILE: join(context.project, 'tests/contract/dsh-pin.json') }
    delete env.WEFTMATE_DSH_CACHE_ROOT
    const result = spawnSync(process.execPath, [join(context.project, 'scripts/vendor-dsh.mjs')], { encoding: 'utf8', windowsHide: true, env })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /复用固定提交/)
    assert.equal(await realpath(vendor), await realpath(physicalVendor))
    assert.equal(await realpath(join(vendor, 'dsh-runtime')), await realpath(cache))
    assert.deepEqual(await treeDigest(cache), before)
    await unlink(vendor); await unlink(join(physicalVendor, 'dsh-runtime'))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('replacement retains an existing ordinary directory and never traverses its nested junction', async () => {
  const root = await managedMkdtemp('weftmate-vendor-retain-')
  try {
    const shared = join(root, 'cache'), other = join(shared, 'other'), output = join(root, 'vendor/dsh-runtime')
    await mkdir(other, { recursive: true }); await writeFile(join(other, 'keep'), 'immutable')
    await mkdir(output, { recursive: true }); await writeFile(join(output, 'local'), 'existing runtime')
    await symlink(other, join(output, 'node_modules'), linkType)
    const before = await treeDigest(other)
    await pointRuntime(output, other, shared)
    const retained = (await readdir(join(root, 'vendor'))).find(name => name.startsWith('dsh-runtime.replaced-'))!
    assert.equal(await readFile(join(root, 'vendor', retained, 'local'), 'utf8'), 'existing runtime')
    assert.deepEqual(await treeDigest(other), before)
    await unlink(join(root, 'vendor', retained, 'node_modules'))
    await unlink(output)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('owned scratch cleanup unlinks nested junctions and refuses a replaced scratch root', async () => {
  const root = await managedMkdtemp('weftmate-vendor-owned-')
  try {
    const other = join(root, 'published'); await mkdir(other); await writeFile(join(other, 'keep'), 'immutable')
    const before = await treeDigest(other)
    const scratch = await createRuntimeScratch(join(root, 'scratch'))
    await symlink(other, join(scratch.runtime, 'node_modules'), linkType)
    await scratch.dispose()
    assert.deepEqual(await treeDigest(other), before)
    const replaced = await createRuntimeScratch(join(root, 'scratch'))
    const retained = replaced.root + '-retained'
    await rename(replaced.root, retained)
    await symlink(other, replaced.root, linkType)
    await assert.rejects(replaced.dispose(), /拒绝经联接/)
    await assert.rejects(replaced.publish(join(root, 'cache')), /拒绝经联接/)
    assert.deepEqual(await treeDigest(other), before)
    await unlink(replaced.root)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('publication refuses an existing invalid cache and leaves its bytes unchanged', async () => {
  const root = await managedMkdtemp('weftmate-vendor-publish-')
  try {
    const cache = join(root, 'cache'); await mkdir(cache); await writeFile(join(cache, 'keep'), 'invalid but immutable')
    const scratch = await createRuntimeScratch(join(root, 'scratch'))
    await writeFile(join(scratch.runtime, 'new'), 'new assembly')
    const before = await treeDigest(cache)
    await assert.rejects(scratch.publish(cache), /保留缓存，拒绝重新发布/)
    assert.deepEqual(await treeDigest(cache), before)
    await scratch.dispose()
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('cache identity rejects an incomplete manifest closure even while the CLI still exists', async () => {
  const root = await managedMkdtemp('weftmate-vendor-closure-cache-')
  try {
    const context = await prepareMatrixProject(root), runtime = join(root, 'runtime')
    await mkdir(join(runtime, 'node_modules/@deepseek-ai/dsh/lib'), { recursive: true })
    await writeFile(join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '// surviving CLI')
    await writeFile(join(runtime, 'VENDOR-MANIFEST.json'), JSON.stringify({ dsh: context.pin, runtimeIdentity: context.identity,
      closure: [{ name: '@deepseek-ai/missing', version: '1', tarball: null, sha256: null }] }))
    const before = await treeDigest(runtime)
    await assert.rejects(assertRuntimeIdentity(runtime, context.project), /缓存内容不完整/)
    assert.deepEqual(await treeDigest(runtime), before)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('staging refuses parent junctions and source overlap; interrupted copy leaves published cache intact', async () => {
  const root = await managedMkdtemp('weftmate-vendor-stage-')
  try {
    const context = await prepareMatrixProject(root)
    const rows = await runCacheMatrix(root, context, { phases: ['success'] })
    assert.equal(rows.length, 15)
    const runtime = join(root, 'node-absent-good-success/cache/other-cache')
    if (process.platform !== 'win32') {
      await mkdir(join(runtime, 'node_modules/.bin'), { recursive: true });
      // Excluded pnpm shims do not ship. A link in a live runtime entry still
      // fails before copying; the check must not broadly allow POSIX links.
      await symlink('manifest.json', join(runtime, 'live-link'));
      await assert.rejects(stageDshRuntime({ projectRoot: context.project, runtimePath: runtime, stageRoot: join(root, 'link-rejected') }), /reparse point/);
      await unlink(join(runtime, 'live-link'));
    }
    const before = await treeDigest(runtime)
    if (process.platform !== 'win32') await symlink('../excluded-cli', join(runtime, 'node_modules/.bin/synthetic'));
    const alias = join(root, 'alias'); await symlink(runtime, alias, linkType)
    await assert.rejects(stageDshRuntime({ projectRoot: context.project, runtimePath: runtime, stageRoot: alias }), /拒绝经联接/)
    await assert.rejects(stageDshRuntime({ projectRoot: context.project, runtimePath: runtime, stageRoot: runtime }), /只读缓存根重叠/)
    const stageRoot = join(root, 'stage')
    await mkdir(stageRoot); await symlink(runtime, join(stageRoot, 'dsh-runtime'), linkType)
    await assert.rejects(stageDshRuntime({ projectRoot: context.project, runtimePath: runtime, stageRoot, copy: async (_source: string, dest: string) => {
      await writeFile(join(dest, 'partial'), 'partial copy'); throw Error('synthetic interrupted copy')
    } }), /synthetic interrupted copy/)
    assert.equal(await realpath(join(stageRoot, 'dsh-runtime')), await realpath(runtime))
    await stageDshRuntime({ projectRoot: context.project, runtimePath: runtime, stageRoot })
    assert.notEqual(await realpath(join(stageRoot, 'dsh-runtime')), await realpath(runtime))
    assert.equal(await readdir(join(stageRoot, 'dsh-runtime/node_modules')).then(rows => rows.includes('.bin')), false);
    if (process.platform !== 'win32') {
      assert.equal(await readFile(join(runtime, 'node_modules/.bin/synthetic')).then(() => true).catch(() => false), false);
      await unlink(join(runtime, 'node_modules/.bin/synthetic'));
    }
    assert.deepEqual(await treeDigest(runtime), before)
    await unlink(alias)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('regression: deleting a node_modules child through a junction is blocked at the scratch boundary', async () => {
  const root = await managedMkdtemp('weftmate-vendor-child-')
  try {
    const cache = join(root, 'published'); await mkdir(join(cache, 'node_modules'), { recursive: true })
    await writeFile(join(cache, 'node_modules/keep'), 'immutable dependency')
    await writeFile(join(cache, 'VENDOR-MANIFEST.json'), 'manifest')
    const scratch = await createRuntimeScratch(join(root, 'scratch'))
    await rename(scratch.runtime, scratch.runtime + '-original')
    await symlink(cache, scratch.runtime, linkType)
    const before = await treeDigest(cache)
    await assert.rejects(scratch.assertOwned(join(scratch.runtime, 'node_modules')), /拒绝经联接/)
    await assert.rejects(scratch.publish(join(root, 'another-cache')), /拒绝经联接/)
    assert.deepEqual(await treeDigest(cache), before)
    await scratch.dispose()
    assert.deepEqual(await treeDigest(cache), before)
  } finally { await rm(root, { recursive: true, force: true }) }
})
