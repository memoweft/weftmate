import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import {
  VENDOR_SCRIPT_VERSION,
  assertManifestClosureClosed,
  assertManifestScriptVersion,
  assertPackageEntrypoints,
  assertWorkspaceClosureEntrypoints,
  computeClosure,
  isSkippedPlatformOptional,
  loadWorkspaceIndex,
  manifestClosureEntries,
  runtimeDependencySections,
} from '../scripts/dsh-vendor-closure.mjs'

let fixture: string

async function writePackage(relative: string, pkg: object) {
  const directory = join(fixture, ...relative.split('/'))
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8')
}

before(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'weftmate-vendor-closure-'))
  await writePackage('packages/runtime/core', {
    name: '@deepseek-ai/core', version: '1.0.0', main: 'lib/index.js',
    dependencies: { '@deepseek-ai/node-addon-landlock-run': 'workspace:*' },
  })
  await writePackage('native/landlock-run/packages/entry', {
    name: '@deepseek-ai/node-addon-landlock-run', version: '1.0.0', main: 'lib/index.js',
    optionalDependencies: {
      '@deepseek-ai/node-addon-landlock-run-linux-x64': 'workspace:*',
      '@deepseek-ai/node-addon-landlock-run-linux-arm64': 'workspace:*',
    },
  })
  await writePackage('native/landlock-run/packages/linux-x64', {
    name: '@deepseek-ai/node-addon-landlock-run-linux-x64', version: '1.0.0', os: ['linux'], cpu: ['x64'], main: 'lib/index.js',
  })
  await writePackage('native/landlock-run/packages/linux-arm64', {
    name: '@deepseek-ai/node-addon-landlock-run-linux-arm64', version: '1.0.0', os: ['linux'], cpu: ['arm64'], main: 'lib/index.js',
  })
})

after(async () => {
  await rm(fixture, { recursive: true, force: true })
})

describe('DSH vendor workspace closure', () => {
  test('索引 native/landlock-run/packages，并把 Linux 包留在 optionalDependencies', async () => {
    const index = await loadWorkspaceIndex(fixture)
    assert.ok(index.has('@deepseek-ai/node-addon-landlock-run'))
    assert.ok(index.has('@deepseek-ai/node-addon-landlock-run-linux-x64'))
    const closure = computeClosure(index, ['@deepseek-ai/core'])
    const packed = [...closure].map(([name, source]) => ({ name, version: source.pkg.version, tarball: `${name.slice(14)}.tgz`, sha256: 'fixture' }))
    const sections = runtimeDependencySections(packed, closure)
    assert.ok(sections.dependencies['@deepseek-ai/node-addon-landlock-run'])
    assert.equal(sections.dependencies['@deepseek-ai/node-addon-landlock-run-linux-x64'], undefined)
    assert.ok(sections.optionalDependencies['@deepseek-ai/node-addon-landlock-run-linux-x64'])
    assert.equal(isSkippedPlatformOptional({ platformOptional: { os: ['linux'], cpu: ['x64'] } }, { platform: 'win32', arch: 'x64' }), true)
    const manifest = { scriptVersion: VENDOR_SCRIPT_VERSION, closure: manifestClosureEntries(packed, closure) }
    assert.doesNotThrow(() => assertManifestScriptVersion(manifest))
    assert.doesNotThrow(() => assertManifestClosureClosed(manifest))
  })

  test('缺失内部 workspace 依赖会 fail loud，绝不回退 registry', async () => {
    const index = await loadWorkspaceIndex(fixture)
    index.get('@deepseek-ai/core')!.pkg.dependencies['@deepseek-ai/missing'] = 'workspace:*'
    assert.throws(() => computeClosure(index, ['@deepseek-ai/core']), /拒绝回退 registry[\s\S]*@deepseek-ai\/missing/)
  })

  test('stale manifest 与不闭合 manifest 都明确失败', () => {
    assert.throws(() => assertManifestScriptVersion({ scriptVersion: 'old' }), /已过期/)
    assert.throws(() => assertManifestClosureClosed({
      closure: [{ name: '@deepseek-ai/a', internalDependencies: [{ name: '@deepseek-ai/missing', field: 'dependencies' }] }],
    }), /闭包不完整/)
  })

  test('当前平台可把未构建的外部平台 optional 包留在闭包 manifest 中', async () => {
    const index = await loadWorkspaceIndex(fixture)
    const closure = computeClosure(index, ['@deepseek-ai/core'])
    const packed = [{ name: '@deepseek-ai/core', version: '1.0.0', tarball: 'core.tgz', sha256: 'fixture' },
      { name: '@deepseek-ai/node-addon-landlock-run', version: '1.0.0', tarball: 'entry.tgz', sha256: 'fixture' }]
    const manifestEntries = manifestClosureEntries(packed, closure, { allowSkippedPlatformOptionals: true })
    const linux = manifestEntries.find((entry) => entry.name === '@deepseek-ai/node-addon-landlock-run-linux-x64')
    assert.deepEqual(linux?.platformOptional, { os: ['linux'], cpu: ['x64'] })
    assert.equal(linux?.tarball, null)
    assert.equal(linux?.sha256, null)
    assert.doesNotThrow(() => assertManifestClosureClosed({ closure: manifestEntries }))
  })

  test('检查 main 与 exports default 入口存在', async () => {
    const nodeModules = join(fixture, 'installed', 'node_modules')
    const packageDir = join(nodeModules, '@deepseek-ai', 'entry-fixture')
    await mkdir(join(packageDir, 'lib'), { recursive: true })
    await writeFile(join(packageDir, 'package.json'), JSON.stringify({
      name: '@deepseek-ai/entry-fixture', main: 'lib/main.js', exports: { '.': { default: './lib/default.js' } },
    }), 'utf8')
    await writeFile(join(packageDir, 'lib', 'main.js'), 'export {}', 'utf8')
    await writeFile(join(packageDir, 'lib', 'default.js'), 'export {}', 'utf8')
    await assert.doesNotReject(() => assertPackageEntrypoints(nodeModules, [{ name: '@deepseek-ai/entry-fixture', platformOptional: null }]))
    await rm(join(packageDir, 'lib', 'default.js'))
    await assert.rejects(() => assertPackageEntrypoints(nodeModules, [{ name: '@deepseek-ai/entry-fixture', platformOptional: null }]), /入口不存在/)
    assert.equal(existsSync(join(packageDir, 'lib', 'main.js')), true)
  })

  test('已构建 checkout 缺入口时在 pack 前明确失败', async () => {
    const index = await loadWorkspaceIndex(fixture)
    const closure = computeClosure(index, ['@deepseek-ai/core'])
    await assert.rejects(
      () => assertWorkspaceClosureEntrypoints(closure),
      /checkout 编译入口不存在：[\s\S]*@deepseek-ai\/core -> lib\/index\.js/,
    )
  })
})
