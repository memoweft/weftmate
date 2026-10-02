/**
 * DSH vendor 闭包的纯逻辑。保持与实际 build/pack 分离，以便用临时 checkout fixture
 * 覆盖 workspace 布局变化，而不触碰外部 Harness。
 */

import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const VENDOR_SCRIPT_VERSION = '3'

const INTERNAL_SCOPE = '@deepseek-ai/'
// Alpha.2's Web bundle declares this released package under the DeepSeek
// scope, but it is intentionally not part of the checkout workspace. Treat
// it like any registry dependency; only actual workspace packages belong in
// the locally packed closure.
const RELEASED_EXTERNAL_PACKAGES = new Set(['@deepseek-ai/libreoffice-kit'])
const DEPENDENCY_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies']

/** DSH pnpm workspace 的包根。native 路径是 2026-08 的 Landlock 子工作区。 */
const WORKSPACE_PACKAGE_ROOTS = [
  { relative: 'packages', depth: 2 },
  { relative: 'vendor', depth: 1 },
  { relative: 'apps', depth: 1 },
  { relative: 'native/landlock-run/packages', depth: 1 },
  { relative: 'native/system', depth: 0 },
  { relative: 'native/system/packages', depth: 1 },
]

function isInternal(name) {
  return typeof name === 'string' && name.startsWith(INTERNAL_SCOPE) && !RELEASED_EXTERNAL_PACKAGES.has(name)
}

async function scanPackageLeaves(root, depth, loadPackage) {
  if (!existsSync(root)) return
  if (depth === 0) {
    const packageJson = join(root, 'package.json')
    if (existsSync(packageJson)) await loadPackage(packageJson)
    return
  }
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) await scanPackageLeaves(join(root, entry.name), depth - 1, loadPackage)
  }
}

/** 从 checkout workspace 收集全部 DSH 内部包；目录缺失留给真正依赖引用处 fail loud。 */
export async function loadWorkspaceIndex(checkout) {
  const index = new Map()
  const loadPackage = async (packageJson) => {
    const pkg = JSON.parse(await readFile(packageJson, 'utf8'))
    if (!isInternal(pkg.name)) return
    if (index.has(pkg.name)) throw new Error(`DSH workspace 包名重复：${pkg.name}`)
    index.set(pkg.name, { dir: dirname(packageJson), pkg })
  }
  for (const root of WORKSPACE_PACKAGE_ROOTS) {
    await scanPackageLeaves(join(checkout, ...root.relative.split('/')), root.depth, loadPackage)
  }
  return index
}

export function internalDependencies(pkg) {
  const dependencies = []
  for (const field of DEPENDENCY_FIELDS) {
    for (const [name, specifier] of Object.entries(pkg[field] ?? {})) {
      if (isInternal(name)) dependencies.push({ name, field, specifier })
    }
  }
  return dependencies
}

/**
 * 直接行到全部内部依赖的传递闭包。
 *
 * 任何 @deepseek-ai 依赖没有 checkout workspace 条目都会立即失败。这里绝不能跳过后
 * 交给 pnpm 从 registry 猜测，否则 vendor 不是一个可审计的本地闭包。
 */
export function computeClosure(index, roots) {
  const closure = new Map()
  const queue = roots.map((name) => ({ name, from: '<root>', field: 'roots' }))
  const missing = []
  while (queue.length > 0) {
    const next = queue.shift()
    if (closure.has(next.name)) continue
    const entry = index.get(next.name)
    if (entry === undefined) {
      missing.push(next)
      continue
    }
    closure.set(next.name, entry)
    for (const dependency of internalDependencies(entry.pkg)) {
      queue.push({ ...dependency, from: next.name })
    }
  }
  if (missing.length > 0) {
    const details = missing.map(({ name, from, field }) => `  ${from} -> ${name} (${field})`).join('\n')
    throw new Error(`DSH workspace index 缺少内部 @deepseek-ai 依赖；拒绝回退 registry：\n${details}`)
  }
  assertPlatformPackagesAreOptional(closure)
  return closure
}

export function platformConstraint(pkg) {
  const os = Array.isArray(pkg.os) ? pkg.os.filter((value) => typeof value === 'string') : []
  const cpu = Array.isArray(pkg.cpu) ? pkg.cpu.filter((value) => typeof value === 'string') : []
  return os.length > 0 || cpu.length > 0 ? { os, cpu } : null
}

function assertPlatformPackagesAreOptional(closure) {
  for (const [from, entry] of closure) {
    for (const dependency of internalDependencies(entry.pkg)) {
      const target = closure.get(dependency.name)
      if (target === undefined || platformConstraint(target.pkg) === null) continue
      if (dependency.field !== 'optionalDependencies') {
        throw new Error(`平台限定包必须经 optionalDependencies 引用：${from} -> ${dependency.name} (${dependency.field})`)
      }
    }
  }
}

/**
 * runtime 根 package 的依赖区。Linux-only tarball 必须作为根 optionalDependencies：
 * 这样 Linux 能由本地 tarball 安装，Windows 又不会把它当成 direct dependency。
 */
export function runtimeDependencySections(packed, closure) {
  const dependencies = {}
  const optionalDependencies = {}
  for (const entry of packed) {
    const source = closure.get(entry.name)
    if (source === undefined) throw new Error(`无法为未在闭包中的包生成 runtime 依赖：${entry.name}`)
    const target = platformConstraint(source.pkg) === null ? dependencies : optionalDependencies
    target[entry.name] = `file:tarballs/${entry.tarball}`
  }
  return { dependencies, optionalDependencies }
}

export function manifestClosureEntries(packed, closure, { allowSkippedPlatformOptionals = false } = {}) {
  const packedByName = new Map(packed.map((entry) => [entry.name, entry]))
  return [...closure].map(([name, source]) => {
    const packedEntry = packedByName.get(name)
    const platformOptional = platformConstraint(source.pkg)
    if (packedEntry === undefined) {
      if (!allowSkippedPlatformOptionals || platformOptional === null
        || !isSkippedPlatformOptional({ platformOptional })) {
        throw new Error(`无法为未打包包生成 manifest：${name}`)
      }
      return {
        name,
        version: source.pkg.version,
        tarball: null,
        sha256: null,
        platformOptional,
        internalDependencies: internalDependencies(source.pkg).map(({ name: dependencyName, field }) => ({ name: dependencyName, field })),
      }
    }
    return {
      ...packedEntry,
      platformOptional,
      internalDependencies: internalDependencies(source.pkg).map(({ name: dependencyName, field }) => ({ name: dependencyName, field })),
    }
  })
}

export function assertManifestScriptVersion(manifest) {
  if (manifest?.scriptVersion !== VENDOR_SCRIPT_VERSION) {
    throw new Error(`vendor manifest 已过期：scriptVersion=${String(manifest?.scriptVersion ?? '(missing)')}，需要 ${VENDOR_SCRIPT_VERSION}；请重新运行 npm run vendor:dsh`)
  }
}

/** 清单自己的内部边必须落在清单闭包中；平台包只能走 optionalDependencies。 */
export function assertManifestClosureClosed(manifest) {
  if (!Array.isArray(manifest?.closure)) throw new Error('manifest 缺 closure 数组')
  const names = new Set(manifest.closure.map((entry) => entry?.name))
  for (const entry of manifest.closure) {
    if (!Array.isArray(entry?.internalDependencies)) {
      throw new Error(`manifest closure 缺 internalDependencies：${entry?.name ?? '(unknown)'}`)
    }
    for (const dependency of entry.internalDependencies) {
      if (!names.has(dependency.name)) {
        throw new Error(`manifest 闭包不完整：${entry.name} -> ${dependency.name} 未收录`)
      }
      const target = manifest.closure.find((candidate) => candidate.name === dependency.name)
      if (target?.platformOptional !== null && target?.platformOptional !== undefined && dependency.field !== 'optionalDependencies') {
        throw new Error(`manifest 平台包不是 optionalDependencies：${entry.name} -> ${dependency.name}`)
      }
    }
  }
}

export function isSkippedPlatformOptional(entry, target = { platform: process.platform, arch: process.arch }) {
  const constraint = entry?.platformOptional
  if (constraint === null || constraint === undefined) return false
  const osOk = !Array.isArray(constraint.os) || constraint.os.length === 0 || constraint.os.includes(target.platform)
  const cpuOk = !Array.isArray(constraint.cpu) || constraint.cpu.length === 0 || constraint.cpu.includes(target.arch)
  return !osOk || !cpuOk
}

function rootExport(pkg) {
  if (pkg.exports === undefined) return undefined
  if (typeof pkg.exports === 'string' || Array.isArray(pkg.exports)) return pkg.exports
  if (Object.hasOwn(pkg.exports, '.')) return pkg.exports['.']
  return undefined
}

function defaultExportPaths(value) {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(defaultExportPaths)
  if (value === null || typeof value !== 'object') return []
  if (typeof value.default === 'string') return [value.default]
  // 一些上游包只有 import/require 条件；它们同样是根入口，必须验证存在。
  return ['import', 'require', 'node'].flatMap((condition) => defaultExportPaths(value[condition]))
}

export function declaredDefaultEntrypoints(pkg) {
  const paths = []
  if (typeof pkg.main === 'string') paths.push(pkg.main)
  paths.push(...defaultExportPaths(rootExport(pkg)))
  return [...new Set(paths.filter((entry) => typeof entry === 'string' && entry !== ''))]
}

/** 仅检查声明的 main / exports 根默认入口；没有根入口的纯资源包不被误判。 */
export async function assertPackageEntrypoints(nodeModules, entries, target = { platform: process.platform, arch: process.arch }) {
  for (const entry of entries) {
    if (isSkippedPlatformOptional(entry, target)) continue
    const packageDir = join(nodeModules, ...entry.name.split('/'))
    const packageJson = join(packageDir, 'package.json')
    if (!existsSync(packageJson)) throw new Error(`入口检查缺 package.json：${entry.name}`)
    const pkg = JSON.parse(await readFile(packageJson, 'utf8'))
    for (const relative of declaredDefaultEntrypoints(pkg)) {
      const normalized = relative.replace(/^\.\//, '')
      if (!existsSync(join(packageDir, normalized))) {
        throw new Error(`包入口不存在：${entry.name} -> ${relative}`)
      }
    }
  }
}

/**
 * vendor:dsh 消费已经由 Harness 所有者构建并验证过的 checkout；这里仅验证其将要被
 * 打包的工作区入口，不在外部 checkout 中触发 build/install。这样缺产物会在 pack 前
 * 明确失败，而 WeftMate 不会越界修复或重建 Harness。
 */
export async function assertWorkspaceClosureEntrypoints(closure, target = { platform: process.platform, arch: process.arch }) {
  for (const [name, entry] of closure) {
    const platformOptional = platformConstraint(entry.pkg)
    if (isSkippedPlatformOptional({ platformOptional }, target)) continue
    for (const relative of declaredDefaultEntrypoints(entry.pkg)) {
      const normalized = relative.replace(/^\.\//, '')
      if (!existsSync(join(entry.dir, normalized))) {
        throw new Error(`checkout 编译入口不存在：${name} -> ${relative}（请由 Harness 所有者提供已构建 checkout）`)
      }
    }
  }
}
