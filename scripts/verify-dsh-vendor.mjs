#!/usr/bin/env node
/**
 * verify-dsh-vendor.mjs — 校验 vendor/dsh-runtime 的完整性与行为。
 *
 * 校验项（docs/VENDOR-PACKAGING.md §6.2）：
 *   1. manifest 存在且与 pin 一致（repo/version/commit）；
 *   2. 逐包 tarball 存在且 sha256 与 manifest 一致；
 *   3. node_modules 闭包完整（逐包 package.json 版本一致）；
 *   3b. @deepseek-ai 单实例（无嵌套版本漂移副本；2026-08-17 事故根因检查）；
 *   4. 编译产物纯净：node_modules/@deepseek-ai 下无 src/ 目录、无 .ts 源文件（.d.ts 允许）；
 *   5. carriedButNotMounted 已记录（R1 起恒为空：web profile 全挂官方树）；
 *   6. 行为冒烟（R4 退役后仅剩官方 web 冒烟）：vendored CLI `dsh --profile weftmate --port 0`
 *      → 官方 URL 行 → 首页含 window.__DSH_BOOT__ → 客户端插件 bundle 200 —— 证明 profile
 *      写入接缝、bundle patch 解析（dsh-base/dsh-web-app）、前端 dist 服务、32 个客户端
 *      插件清单全通。（v2 遗产的 packaged-bin + SDK client 冒烟随旧运行时移除。）
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { loadPin, isolatedEnv } from '../tests/contract/support/checkout.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const RUNTIME_DIR = join(repoRoot, 'vendor', 'dsh-runtime')

function fail(message) {
  console.error(`[vendor-verify] FAIL：${message}`)
  process.exit(1)
}

async function walkForSources(dir, pkgName) {
  const bad = []
  const utilWithSrc = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      // node_modules 一律跳过：pnpm pack 不含嵌套依赖，包目录下的 node_modules 来自装配期
      // 版本冲突嵌套（如 @opentelemetry 编译产物 build/src）——不是发货 payload，不属检查面。
      if (entry.name === 'node_modules') continue
      // 顶层目录名即包名（node_modules/@deepseek-ai/<pkg>）；子目录沿用所属包名。
      const childPkg = pkgName === '' ? entry.name : pkgName
      if (entry.name === 'src') {
        // M5-01（hoisted 布局）：src 禁入只针对 harness 自身包（dsh-*）——cordis 工具族
        // （cordis/cosmokit/schemastery/node-addon-landlock-run）上游 npm 发布自带 src，
        // 任何 npm 安装都含这些文件，属上游发布选择；记入审计信息，不挡校验。
        if (childPkg.startsWith('dsh-')) bad.push(path)
        else utilWithSrc.push(path)
        continue
      }
      const sub = await walkForSources(path, childPkg)
      bad.push(...sub.bad)
      utilWithSrc.push(...sub.utilWithSrc)
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      if (pkgName.startsWith('dsh-')) bad.push(path)
      else utilWithSrc.push(path)
    }
  }
  return { bad, utilWithSrc }
}

/**
 * 收集 node_modules 树内所有物理 `node_modules/@deepseek-ai/<pkg>` 目录（含任意深度嵌套）。
 * 只沿 `node_modules` / `@deepseek-ai` 目录下钻，代价有界。同一包名出现 >1 份即嵌套双实例。
 * 2026-08-17 事故：dsh 的 `^0.1.0-rc.5` 区间在装配期漂移到 rc.6，嵌套在 dsh/node_modules 下，
 * 与顶层 rc.5 双实例并存；dsh-tools 的 TOOL_RUNTIME_SCHEDULER unique symbol 跨实例断裂，
 * 真机工具执行报 `Cannot read properties of undefined (reading 'prepare')`（旧校验的源码
 * 纯净检查跳过所有 node_modules 子目录，看不到这层漂移——此检查补上该盲区）。
 */
async function collectDeepseekCopies(dir) {
  const copies = []
  const walk = async (current) => {
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const path = join(current, entry.name)
      if (entry.name === '@deepseek-ai' && basename(current) === 'node_modules') {
        const pkgs = await readdir(path, { withFileTypes: true })
        for (const pkg of pkgs) {
          if (!pkg.isDirectory()) continue
          copies.push({ name: pkg.name, path: join(path, pkg.name) })
          await walk(join(path, pkg.name))
        }
      } else if (entry.name === 'node_modules') {
        await walk(path)
      }
    }
  }
  await walk(dir)
  return copies
}

function runNodeFixture(args, env, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn('node', args, { cwd: env.WEFTMATE_LAUNCH_CWD, env, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { stderr += chunk })
    const timer = setTimeout(() => {
      child.kill()
      finish({ code: null, stdout, stderr, timedOut: true })
    }, timeoutMs)
    child.on('error', (error) => finish({ code: null, stdout, stderr, timedOut: false, spawnError: error.message }))
    child.on('close', (code) => finish({ code, stdout, stderr, timedOut: false }))
  })
}

async function main() {
  if (!existsSync(join(RUNTIME_DIR, 'VENDOR-MANIFEST.json'))) {
    fail(`缺 ${RUNTIME_DIR}\\VENDOR-MANIFEST.json —— 先运行 npm run vendor:dsh`)
  }
  const manifest = JSON.parse(await readFile(join(RUNTIME_DIR, 'VENDOR-MANIFEST.json'), 'utf8'))
  const pin = await loadPin()

  console.log(`[vendor-verify] manifest: ${manifest.closure.length} 包, dsh ${manifest.dsh.packageVersion} @ ${manifest.dsh.commit.slice(0, 7)}`)

  // 1. pin 一致
  if (manifest.dsh.commit !== pin.commit || manifest.dsh.packageVersion !== pin.packageVersion) {
    fail(`manifest 与 pin 不一致：${JSON.stringify(manifest.dsh)} vs ${JSON.stringify({ packageVersion: pin.packageVersion, commit: pin.commit })}`)
  }

  // 2. tarball sha256
  for (const entry of manifest.closure) {
    const tgz = join(RUNTIME_DIR, 'tarballs', entry.tarball)
    if (!existsSync(tgz)) fail(`tarball 缺失：${entry.tarball}`)
    const actual = createHash('sha256').update(readFileSync(tgz)).digest('hex')
    if (actual !== entry.sha256) fail(`tarball sha256 不符：${entry.tarball}`)
  }
  console.log('[vendor-verify] tarball sha256 全部一致')

  // 3. node_modules 闭包完整
  for (const entry of manifest.closure) {
    const pkgPath = join(RUNTIME_DIR, 'node_modules', ...entry.name.split('/'), 'package.json')
    if (!existsSync(pkgPath)) fail(`node_modules 缺包：${entry.name}`)
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
    if (pkg.version !== entry.version) fail(`${entry.name} 版本不符：安装 ${pkg.version} vs 清单 ${entry.version}`)
  }
  console.log('[vendor-verify] node_modules 闭包版本全部一致')

  // 3b. @deepseek-ai 单实例：任何包出现嵌套第二副本即失败（版本漂移双实例会切断
  //     dsh-tools 的 unique symbol，真机表现为工具执行报 reading 'prepare'）。
  const copies = await collectDeepseekCopies(join(RUNTIME_DIR, 'node_modules'))
  const byName = new Map()
  for (const copy of copies) {
    const paths = byName.get(copy.name) ?? []
    paths.push(copy.path)
    byName.set(copy.name, paths)
  }
  const dupes = [...byName.entries()].filter(([, paths]) => paths.length > 1)
  if (dupes.length > 0) {
    const shown = dupes.slice(0, 15)
    const more = dupes.length - shown.length
    const listing = shown.map(([name, paths]) => `  ${name}:\n${paths.map((p) => `    ${p}`).join('\n')}`).join('\n')
    fail(`发现 @deepseek-ai 包多实例（依赖区间漂移出嵌套副本）：\n${listing}${more > 0 ? `\n  …及另外 ${more} 个包` : ''}`)
  }
  console.log(`[vendor-verify] @deepseek-ai 单实例检查通过（${copies.length} 个包，无嵌套重复副本）`)

  // 4. 编译产物纯净（无源码树）：dsh-* 自身包禁 src/ 与 .ts；cordis 工具族上游发布自带 src，
  //    只记审计信息不挡校验（M5-01 hoisted 布局后可见，junction 布局时这些文件同样在闭包内）。
  const dshNodeModules = join(RUNTIME_DIR, 'node_modules', '@deepseek-ai')
  const { bad, utilWithSrc } = await walkForSources(dshNodeModules, '')
  if (bad.length > 0) fail(`发现源码残留（红线：只发货编译产物）：\n  ${bad.slice(0, 10).join('\n  ')}`)
  const utilNames = [...new Set(utilWithSrc.map((p) => /@deepseek-ai[\\/]([^\\/]+)/.exec(p)?.[1] ?? ''))].filter(Boolean)
  console.log(`[vendor-verify] 闭包无 dsh-* 源码（编译产物纯净）；上游自带 src 的工具族（审计）：${utilNames.join(', ') || '(无)'}`)

  // 5. carriedButNotMounted 已记录
  if (!Array.isArray(manifest.carriedButNotMounted)) fail('manifest 缺 carriedButNotMounted')
  console.log(`[vendor-verify] carriedButNotMounted：${manifest.carriedButNotMounted.join(', ') || '(无)'}`)

  // 6. 行为冒烟：R1 官方 web 冒烟——vendored CLI --profile weftmate（profile 由 DshWebRuntime
  //    写入隔离 DSH_HOME；URL 行 = 就绪信号）→ 首页含 __DSH_BOOT__ 引导图 → 客户端插件
  //    bundle 200。证明：profile 写入接缝、bundle patch 解析、前端 dist 服务、官方客户端
  //    插件清单全通。R4 退役：v2 packaged-bin + SDK client 冒烟随旧运行时移除。
  const webRunDir = await mkdtemp(join(tmpdir(), 'weftmate-vendor-verify-web-'))
  try {
    const forward = RUNTIME_DIR.replaceAll('\\', '/')
    const repoForward = repoRoot.replaceAll('\\', '/')
    const webRunnerPath = join(webRunDir, 'vendor-web-smoke-runner.mts')
    await writeFile(webRunnerPath, `
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { DshWebRuntime } from 'file:///${repoForward}/src/dsh-web-runtime.ts'
const home = await mkdtemp(join(tmpdir(), 'weftmate-vendor-web-smoke-'))
const runtime = new DshWebRuntime({
  homeDir: join(home, 'dsh-home'),
  workspaceDir: join(home, 'dsh-home', 'workspace'),
  runtimePath: '${forward}',
  readyTimeoutMs: 150_000,
})
let evidence
try {
  const origin = await runtime.start()
  const index = await fetch(origin).then((r) => r.text())
  const bootGraph = index.includes('window.__DSH_BOOT__')
  const rootDiv = index.includes('id="root"')
  const profileDir = join(home, 'dsh-home', 'profiles', 'weftmate')
  const profileManifest = existsSync(join(profileDir, 'package.json'))
  const profilePatch = existsSync(join(profileDir, 'cordis.patch.yml'))
  const pluginMatch = /\\/plugins\\/[^"?\\s\\\\]+\\/client\\.js\\?rev=[^"'\\\\s]+/.exec(index)
  let pluginUrl = null
  let pluginOk = false
  let pluginStatus = null
  if (pluginMatch !== null) {
    pluginUrl = pluginMatch[0]
    const res = await fetch(origin + pluginUrl)
    pluginStatus = res.status
    pluginOk = res.status === 200 && (await res.text()).length > 0
  }
  // R3-03 种子契约：boot 图含 @weftmate/client 行 + 其 bundle 200（锁扩展点）。
  const bootMarker = 'window.__DSH_BOOT__ = '
  const bootStart = index.indexOf(bootMarker)
  let weftmateRow = false
  let weftmateClientUrl = null
  let weftmateClientOk = false
  let weftmateClientStatus = null
  if (bootStart !== -1) {
    const jsonStart = bootStart + bootMarker.length
    const jsonEnd = index.indexOf('</script>', jsonStart)
    const graph = JSON.parse(index.slice(jsonStart, jsonEnd).trim())
    const row = (graph.entries ?? []).find((e) => e.id === '@weftmate/client')
    weftmateRow = row !== undefined
    weftmateClientUrl = row?.url ?? '/plugins/@weftmate/client/client.js'
    const res = await fetch(origin + '/plugins/@weftmate/client/client.js')
    weftmateClientStatus = res.status
    weftmateClientOk = res.status === 200 && (await res.text()).length > 0
  }
  // R3-02：weftmate 宿主插件接缝路由（状态面；main 未起的冒烟形态走 env 回退组合）。
  let seamOk = false
  let seamStatus = null
  let seamAppName = null
  let seamDshHome = null
  try {
    const res = await fetch(origin + '/weftmate/status.json')
    seamStatus = res.status
    const seam = await res.json()
    seamAppName = seam?.app?.name ?? null
    seamDshHome = seam?.dataDirs?.dshHome ?? null
    seamOk = res.status === 200 && seamAppName === 'WeftMate' && typeof seamDshHome === 'string' && seamDshHome.length > 0
  } catch { /* 接缝失败 → seamOk 保持 false */ }
  evidence = {
    ok: true, origin, bootGraph, rootDiv, profileManifest, profilePatch,
    pluginUrl, pluginOk, pluginStatus,
    weftmateRow, weftmateClientUrl, weftmateClientOk, weftmateClientStatus,
    seamOk, seamStatus, seamAppName,
  }
} catch (error) {
  evidence = { ok: false, error: error && error.message ? String(error.message) : String(error) }
} finally {
  await runtime.close().catch(() => {})
  await rm(home, { recursive: true, force: true }).catch(() => {})
}
console.log('[vendor-web-smoke] EVIDENCE ' + JSON.stringify(evidence))
`, 'utf8')

    const env = isolatedEnv(join(webRunDir, 'home'))
    const result = await runNodeFixture([webRunnerPath], env, 240_000)
    if (result.timedOut) fail(`web 冒烟超时。stderr 尾部：\n${(result.stderr ?? '').slice(-3000)}`)
    if (result.spawnError !== undefined) fail(`web 冒烟 spawn 失败：${result.spawnError}`)
    if (result.code !== 0) fail(`web 冒烟退出 ${result.code}。stderr 尾部：\n${(result.stderr ?? '').slice(-3000)}`)

    const webEvidenceMatch = /\[vendor-web-smoke\] EVIDENCE (.*)/.exec(result.stdout ?? '')
    if (webEvidenceMatch === null) fail(`web 冒烟未输出 EVIDENCE。stdout 尾部：\n${(result.stdout ?? '').slice(-2000)}`)
    const webEvidence = JSON.parse(webEvidenceMatch[1])
    if (webEvidence.ok !== true) fail(`web 冒烟抛错：${JSON.stringify(webEvidence).slice(0, 3000)}`)
    if (webEvidence.bootGraph !== true || webEvidence.rootDiv !== true) {
      fail(`web 冒烟：首页缺官方引导（bootGraph=${webEvidence.bootGraph} rootDiv=${webEvidence.rootDiv}）——前端 dist 或 __DSH_BOOT__ 注入失败`)
    }
    if (webEvidence.profileManifest !== true || webEvidence.profilePatch !== true) {
      fail(`web 冒烟：profile weftmate 未写入（manifest=${webEvidence.profileManifest} patch=${webEvidence.profilePatch}）`)
    }
    if (webEvidence.pluginOk !== true) {
      fail(`web 冒烟：客户端插件 bundle 不可用（${webEvidence.pluginUrl} → ${webEvidence.pluginStatus}）`)
    }
    if (webEvidence.weftmateRow !== true) {
      fail(`web 冒烟：__DSH_BOOT__ 图缺 @weftmate/client 行（weftmateRow=${webEvidence.weftmateRow}）——weftmate 客户端行未挂上`)
    }
    if (webEvidence.weftmateClientOk !== true) {
      fail(`web 冒烟：@weftmate/client bundle 不可用（${webEvidence.weftmateClientUrl} → ${webEvidence.weftmateClientStatus}）`)
    }
    if (webEvidence.seamOk !== true) {
      fail(`web 冒烟：weftmate 宿主插件接缝不可用（/weftmate/status.json → ${webEvidence.seamStatus}，app=${webEvidence.seamAppName}）`)
    }
    console.log(`[vendor-verify] 官方 web 冒烟通过：${webEvidence.origin}（__DSH_BOOT__ 引导图 + profile 写入 + 插件 bundle 200 + @weftmate/client 行/bundle 200 + 宿主插件状态接缝 200）`)
  } finally {
    await rm(webRunDir, { recursive: true, force: true }).catch(() => {})
  }

  console.log('[vendor-verify] 全部通过')
}

main().catch((error) => {
  fail(error instanceof Error ? error.stack : String(error))
})
