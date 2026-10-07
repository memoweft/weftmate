#!/usr/bin/env node
/**
 * vendor-dsh.mjs — 把 pin 对应的 DSH 编译产物装配进 `vendor/dsh-runtime/`。
 *
 * R1（2026-08-16，docs/ARCHITECTURE.md v3 §3）：发货闭包从「SDK jsonrpc 运行时」扩为
 * 「官方 web 运行时」——直接行新增 apps/cli（@deepseek-ai/dsh）+ dsh-base + dsh-web-app
 * + dsh-web-frontend（前端 dist）。R4 退役（docs/ARCHITECTURE.md §4）：v2 的四个纯 SDK
 * 直接行（dsh-sdk-jsonrpc-demo / dsh-agent-spine-demo / dsh-sdk-jsonrpc-server /
 * dsh-sdk-client）与 packaged-bin 入口、tsx 插件加载垫片已移除；发货闭包 = web 四根
 * 传递闭包。v2 的「机制包不挂行」裁决（2026-08-14）随 v3 作废：web profile 两层
 * bundle patch 全挂，subagent/workflow/goal 等机制全启用（v2 边界 C 退役），
 * manifest.carriedButNotMounted 恒为空数组（字段保留供审计）。
 *
 * 流程（对应 docs/VENDOR-PACKAGING.md §6.1）：
 *   1. resolve+verify：复用契约测试的 pin 校验（tests/contract/support/checkout.ts，单一事实源）；
 *   2. preflight：验证 checkout 已有的官方编译入口；构建属于 Harness 所有者职责，
 *      本脚本绝不在 checkout 内执行 build/install/clean；
 *   3. closure：从直接行（§发货子集）按 dependencies/peerDependencies/optionalDependencies 推导
 *      @deepseek-ai 传递闭包（workspace 扫描含 packages/vendor/apps 与 native/landlock-run/packages）；
 *   4. pack：逐包 `pnpm pack`（pnpm 会把 workspace: 协议替换为具体版本）；
 *   5. assemble：vendor/dsh-runtime/{package.json, tarballs/, bin/} → `pnpm install` 产出闭包 node_modules；
 *      package.json 带 pnpm.overrides 把闭包内全部 @deepseek-ai 包锁到逐包精确版本——
 *      上游发布包的依赖区间是 `^0.1.0-rc.N`，按 semver 会匹配到同 tuple 的新 rc（rc.N+1），
 *      若无 override 会在 `dsh/node_modules` 下嵌套漂移出一整棵新版本世界；双实例会使
 *      `dsh-tools` 的 unique symbol（TOOL_RUNTIME_SCHEDULER）跨实例断裂，工具执行时报
 *      `Cannot read properties of undefined (reading 'prepare')`（2026-08-17 真机事故，见 docs/VENDOR-PACKAGING.md §6.1）。
 *      装配后随即做单实例结构检查，发现嵌套 @deepseek-ai 副本立即失败；
 *   6. manifest：VENDOR-MANIFEST.json（pin 信息 + 逐包 name/version/tarball/sha256 + 工具链版本）。
 *
 * 用法：
 *   node scripts/vendor-dsh.mjs [--dry-run]   # --dry-run 只计算并打印闭包，不构建/打包/安装
 *
 * 红线：本脚本只读 checkout 并只执行逐包 pack；不在 checkout 内执行 build/install/clean，
 * 不修改 checkout 中任何被 git 跟踪的文件。
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPin, resolveCheckout } from '../tests/contract/support/checkout.ts'
import {
  VENDOR_SCRIPT_VERSION,
  assertPackageEntrypoints,
  assertWorkspaceClosureEntrypoints,
  computeClosure,
  isSkippedPlatformOptional,
  loadWorkspaceIndex,
  manifestClosureEntries,
  platformConstraint,
  runtimeDependencySections,
} from './dsh-vendor-closure.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
// A candidate can redirect only its generated output. The default remains the
// rc5 production vendor, so normal package/release commands retain their
// existing source and output identity.
const RUNTIME_DIR = process.env.WEFTMATE_DSH_RUNTIME_DIR === undefined || process.env.WEFTMATE_DSH_RUNTIME_DIR === ''
  ? join(repoRoot, 'vendor', 'dsh-runtime')
  : resolve(repoRoot, process.env.WEFTMATE_DSH_RUNTIME_DIR)
const TARBALLS_DIR = join(RUNTIME_DIR, 'tarballs')

/** 发货子集·直接行（行集合变更需 owner 拍板；R1 起 = 官方 web 运行时 + v2 直接行保留）。 */
const LEGACY_SUBSET = [
  // ── R1（2026-08-16 owner 拍板完全重构）：官方 web 运行时四件 ───────────────────
  //   启动面 = 官方 CLI `dsh --profile weftmate`（apps/cli，bin=dsh → lib/bin.js）；
  //   profile 的 bundles [dsh-base, dsh-web-app] 从 dsh 安装目录解析（vendor hoisted 闭包），
  //   前端 dist 由 dsh-web-app 经 `require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html')` 定位。
  { name: '@deepseek-ai/dsh', why: '官方 CLI 启动器（apps/cli，lib/bin.js；--profile 组装 + 内置 shipped agent presets）' },
  { name: '@deepseek-ai/dsh-base', why: 'web profile 第一层 bundle patch（dsh 核心 78 行）' },
  { name: '@deepseek-ai/dsh-web-app', why: 'web 宿主 bundle patch（web 宿主行 + 32 个 dsh.client 客户端插件清单）' },
  { name: '@deepseek-ai/dsh-web-frontend', why: '官方前端 vite dist（frontend-static 托管；build:web 产出）' },
  // ── web 基座传递行（R4 退役收口：v2 的四个纯 SDK 直接行已移除，不再进 vendor 闭包；
  //    以下行全部在 web 四根传递闭包内，保留直接行只为审计「为什么在闭包里」） ─────────
  { name: '@deepseek-ai/dsh-app-boot', why: 'boot / loadEnv / fail-loud / 配置解析' },
  { name: '@deepseek-ai/dsh-llm-deepseek', why: 'DeepSeek 官方 llm 适配器' },
  { name: '@deepseek-ai/dsh-agent-default-model', why: '默认 provider/model 路由' },
  { name: '@deepseek-ai/dsh-credentials-local', why: '凭据提供者（env > $DSH_HOME/.credentials.yaml > .env 回退）' },
  { name: '@deepseek-ai/dsh-settings-file', why: '设置落盘 + 热加载' },
  { name: '@deepseek-ai/dsh-subprocess-local', why: '工具子进程执行' },
  { name: '@deepseek-ai/dsh-sandbox-local', why: '本地沙箱' },
  { name: '@deepseek-ai/dsh-sandbox-policy', why: '沙箱策略' },
  { name: '@deepseek-ai/dsh-pwsh-sandbox', why: 'Windows pwsh 执行器（Windows profile）' },
  { name: '@deepseek-ai/dsh-session-persistence-jsonl', why: '会话落盘 session.jsonl.zstd' },
  // M4-01 工具/沙箱/审批直接行（owner 拍板 2026-08-15：Harness 原生工具行 + 自建审批通道）：
  { name: '@deepseek-ai/dsh-user-approval', why: '审批缝（approval 服务；应答方=weftmate-approval-channel 插件）' },
  { name: '@deepseek-ai/dsh-shell-env', why: 'tool-pwsh 硬依赖的共享环境注册表（spine toolBash:false 后独立挂行）' },
  // dsh-fs-local 不进直接行：fs-sandbox 自带 LocalFileSystem 并注册 'fs'（官方语义「挂 fs-sandbox 替代 fs-local」），
  // fs-local 随 fs-sandbox 依赖闭包带入。
  { name: '@deepseek-ai/dsh-fs-sandbox', why: '沙箱文件系统后端（内部 LocalFileSystem；读 sandbox-policy，单一策略源）' },
  { name: '@deepseek-ai/dsh-tool-fs', why: '文件工具 read/read_image/edit/write' },
  { name: '@deepseek-ai/dsh-tool-pwsh', why: 'Windows PowerShell 命令工具（pwsh）' },
  // W-UI（owner 拍板：目标/步骤/思考过程产品可读）：官方结构化计划工具；单 Agent 的
  // allowParallelInProgress:false 在 cordis 组合中锁为单活跃步骤，工具调用写 todo/write 会话事件。
  { name: '@deepseek-ai/dsh-tool-todo', why: '结构化计划 todo_write（单活跃步骤；会话 todo/write 事件）' },
  // M4-03 工作区直接行（owner 拍板：官方 dsh-workspace 行；storage 三件套是其硬依赖）：
  { name: '@deepseek-ai/dsh-storage', why: '领域存储基础服务（storage）' },
  { name: '@deepseek-ai/dsh-storage-json', why: 'json 存储后端（storage-json，root=DSH_HOME/storages）' },
  { name: '@deepseek-ai/dsh-storage-domain', why: '领域数据门面（storageDomain，backend: json）' },
  { name: '@deepseek-ai/dsh-workspace', why: '工作区注册表（workspaceRegistry；会话按 header.cwd 分组）' },
  // M4-04 MCP 直接行（owner 拍板：官方 dsh-mcp-client 行采纳、自研 mcp.ts 退役）：
  { name: '@deepseek-ai/dsh-mcp-client', why: 'MCP 客户端桥（每 server 一实例；工具名 mcp__<server>__<tool>）' },
  // M4-05 附件直接行（owner 拍板 2026-08-15：官方附件行解禁、以官方行为主）。
  // dsh-attachment（服务定义）不进直接行：attachment-local extends 其 AttachmentStore 并注册
  // 'attachments'（官方语义「挂 attachment-local 替代 attachment」），随依赖闭包带入。
  { name: '@deepseek-ai/dsh-attachment-local', why: '本地附件后端（DSH_HOME/attachments/v1，注册 attachments 服务）' },
  // M4-05 视觉模型（owner 拍板 2026-08-15）：非官方模型档走 pi-ai 多供应商适配器（可看图）。
  // @earendil-works/pi-ai 等非 @deepseek-ai 依赖由 tarball 依赖图在装配时从 registry 解析。
  { name: '@deepseek-ai/dsh-llm-pi-ai', why: 'pi-ai 多供应商适配器（视觉模型路由 wm-active；无档 dormant）' },
]

/**
 * R1（2026-08-16）起 carriedButNotMounted 恒为空：v3 重构后发货组合 = 官方 web profile
 * （dsh-base + dsh-web-app 两层 bundle patch 全挂），subagent/workflow/goal/mcp 等机制随
 * profile 全启用（v2 边界 C 作废，见 docs/ARCHITECTURE.md v3 §1.2）。字段保留在
 * VENDOR-MANIFEST.json 供审计历史与 verify 脚本兼容；v2 的 DENY 名单逻辑已退役。
 */
function classifyCarried() {
  return []
}

/** pnpm pack 产出的 tarball 文件名（scoped 包：@deepseek-ai/x@v → deepseek-ai-x-v.tgz）。 */
function tarballName(name, version) {
  return `${name.replace('@', '').replace('/', '-')}-${version}.tgz`
}

/** 解析 pnpm 可执行（WEFTMATE_PNPM 覆盖，可含子命令如 'corepack pnpm' → PATH 上找 pnpm.cmd/.exe/pnpm → corepack.cmd pnpm 回退）。 */
function resolvePnpm() {
  const findInPath = (name) => {
    for (const dir of (process.env.PATH ?? '').split(';')) {
      const path = join(dir || '.', name)
      if (existsSync(path)) return path
    }
    return null
  }
  const resolveCommand = (name) => {
    const hasExecutableExtension = /\.(?:cmd|exe)$/i.test(name)
    // Windows 的 Node 安装目录会同时留下无扩展名 corepack 占位文件和真正可执行的
    // corepack.cmd；必须先选 .cmd/.exe，不能把前者交给 spawnSync。
    if (!hasExecutableExtension && process.platform === 'win32') {
      const windowsShim = findInPath(`${name}.cmd`) ?? findInPath(`${name}.exe`)
      if (windowsShim !== null) return windowsShim
    }
    if (existsSync(name)) return name
    return findInPath(name)
      ?? (!hasExecutableExtension ? findInPath(`${name}.cmd`) : null)
      ?? (!hasExecutableExtension ? findInPath(`${name}.exe`) : null)
      ?? name
  }
  const override = process.env.WEFTMATE_PNPM
  if (override !== undefined && override !== '') {
    const parts = override.split(/\s+/).filter(Boolean)
    return [resolveCommand(parts[0]), ...parts.slice(1)]
  }
  const direct = findInPath('pnpm.cmd') ?? findInPath('pnpm.exe') ?? findInPath('pnpm')
  if (direct !== null) return [direct]
  const corepack = findInPath('corepack.cmd')
  if (corepack !== null) return [corepack, 'pnpm']
  return ['pnpm']
}

function quoteCmd(arg) {
  return /[\s"&|<>^]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg
}

function run(command, args, cwd, label, env = process.env) {
  // command 可为多段（如 'corepack pnpm'）；Windows 上 .cmd shim 需 shell 包装（args 已逐项引号）。
  const parts = Array.isArray(command) ? command : [command]
  const useShell = /\.cmd$/i.test(parts[0] ?? '')
  const result = useShell
    ? spawnSync([...parts, ...args].map(quoteCmd).join(' '), [], { cwd, env, encoding: 'utf8', shell: true })
    : spawnSync(parts[0], [...parts.slice(1), ...args], { cwd, env, encoding: 'utf8' })
  if (result.status !== 0) {
    const tail = (result.stderr ?? result.stdout ?? (result.error ? String(result.error) : '')).split('\n').slice(-15).join('\n')
    throw new Error(`${label} 失败（exit ${result.status}）：\n${tail}`)
  }
  return result
}

function sha256Of(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/** 运行时装配沿用已验证 checkout 声明的 Corepack pnpm 版本，避免 PATH 上的全局 pnpm 漂移。 */
function checkoutPackageManager(checkout) {
  const packageManager = JSON.parse(readFileSync(join(checkout, 'package.json'), 'utf8')).packageManager
  if (typeof packageManager !== 'string' || !/^pnpm@\d/.test(packageManager)) {
    throw new Error(`checkout 未声明可用的 pnpm packageManager：${String(packageManager)}`)
  }
  return packageManager
}

/** pnpm 11 只从 workspace root 读取 overrides；运行时自己就是一个隔离 workspace。 */
function runtimeWorkspaceYaml(packed) {
  const overrides = packed
    .map((entry) => `  '${entry.name}': 'file:tarballs/${entry.tarball}'`)
    .join('\n')
  return `packages:\n  - '.'\noverrides:\n${overrides}\n`
}

/** 大闭包的 pnpm 解析在 Node 默认堆上限下会 OOM；仅 vendor 产物 install 提高其子进程堆。 */
function runtimeInstallEnv() {
  const raw = process.env.WEFTMATE_VENDOR_NODE_HEAP_MB ?? '8192'
  const heapMb = Number(raw)
  if (!Number.isInteger(heapMb) || heapMb < 1024 || heapMb > 16384) {
    throw new Error(`WEFTMATE_VENDOR_NODE_HEAP_MB 必须是 1024-16384 的整数，当前为 ${raw}`)
  }
  const existing = process.env.NODE_OPTIONS?.trim()
  return {
    env: { ...process.env, NODE_OPTIONS: [existing, `--max-old-space-size=${heapMb}`].filter(Boolean).join(' ') },
    heapMb,
  }
}

/**
 * 收集 node_modules 树内所有物理 `node_modules/@deepseek-ai/<pkg>` 目录（含任意深度嵌套）。
 * 只沿 `node_modules` / `@deepseek-ai` 目录下钻，代价有界。
 * 同一包名出现 >1 份 = 版本漂移双实例（unique symbol 跨实例断裂的根因）。
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

/** 断言闭包内每个 @deepseek-ai 包在装配产物中只有一份物理副本。 */
async function assertSingleInstance(nodeModulesDir) {
  const copies = await collectDeepseekCopies(nodeModulesDir)
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
    throw new Error(`装配产物存在 @deepseek-ai 包多实例（依赖区间漂移出嵌套副本；unique symbol 会跨实例断裂）：\n${listing}${more > 0 ? `\n  …及另外 ${more} 个包` : ''}`)
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const subset = LEGACY_SUBSET
  const pin = await loadPin()
  const checkout = await resolveCheckout(pin)
  const packageManager = checkoutPackageManager(checkout)
  console.log(`[vendor-dsh] checkout ${checkout} @ ${pin.commit}（${pin.packageVersion}）`)
  console.log(`[vendor-dsh] Corepack packageManager：${packageManager}`)

  const index = await loadWorkspaceIndex(checkout)
  const closure = computeClosure(index, subset.map((entry) => entry.name))
  const carriedButNotMounted = classifyCarried()
  console.log(`[vendor-dsh] 发货闭包：${closure.size} 个包（直接行 ${subset.length} + 传递 ${closure.size - subset.length}）`)
  if (dryRun) {
    for (const [name, entry] of [...closure].sort(([a], [b]) => a.localeCompare(b))) {
      const tag = carriedButNotMounted.includes(name) ? '  [carried-not-mounted]' : ''
      console.log(`  ${name}@${entry.pkg.version}  ${entry.dir.slice(checkout.length + 1)}${tag}`)
    }
    console.log('[vendor-dsh] --dry-run 完成（未构建/打包/安装）')
    return
  }

  await assertWorkspaceClosureEntrypoints(closure)
  console.log('[vendor-dsh] checkout 已有编译入口检查通过（只读；未在 Harness checkout 执行 build/install/clean）')

  await rm(RUNTIME_DIR, { recursive: true, force: true })
  await mkdir(TARBALLS_DIR, { recursive: true })

  console.log('[vendor-dsh] pack：逐包 pnpm pack')
  const packed = []
  const skippedPlatformOptionals = []
  const sorted = [...closure].sort(([a], [b]) => a.localeCompare(b))
  for (const [name, entry] of sorted) {
    const platformOptional = platformConstraint(entry.pkg)
    if (platformOptional !== null && isSkippedPlatformOptional({ platformOptional })) {
      skippedPlatformOptionals.push({ name, platformOptional })
      continue
    }
    run(resolvePnpm(), ['--dir', entry.dir, 'pack', '--pack-destination', TARBALLS_DIR], checkout, `pack ${name}`)
    const tgz = join(TARBALLS_DIR, tarballName(name, entry.pkg.version))
    if (!existsSync(tgz)) throw new Error(`${name} 未产出预期 tarball：${tgz}`)
    packed.push({ name, version: entry.pkg.version, tarball: basename(tgz), sha256: sha256Of(tgz) })
  }
  console.log(`[vendor-dsh] 当前平台合法跳过的 optional 包：${skippedPlatformOptionals.map((entry) => entry.name).join(', ') || '(无)'}`)

  const runtimeSections = runtimeDependencySections(packed, closure)
  const manifestClosure = manifestClosureEntries(packed, closure, { allowSkippedPlatformOptionals: true })

  const runtimePkg = {
    name: 'weftmate-dsh-runtime',
    version: '0.0.0',
    private: true,
    packageManager,
    description: `WeftMate 内嵌 DSH 运行时闭包（pin ${pin.packageVersion} @ ${pin.commit.slice(0, 7)}；生成物，勿手改）`,
    engines: { node: '^22.19.0 || >=24.0.0' },
    dependencies: runtimeSections.dependencies,
    // Linux-only Landlock launcher tarballs remain optional.  They are present for Linux
    // assemblies but must never become mandatory direct dependencies on Windows.
    optionalDependencies: runtimeSections.optionalDependencies,
  }
  await writeFile(join(RUNTIME_DIR, 'package.json'), JSON.stringify(runtimePkg, null, 2) + '\n', 'utf8')
  // pnpm 11 从 pnpm-workspace.yaml 的 root overrides 读取传递依赖来源。所有已打包
  // @deepseek-ai 包都必须指向本地 tarball，不能因 ^rc 区间回退 registry。
  await writeFile(join(RUNTIME_DIR, 'pnpm-workspace.yaml'), runtimeWorkspaceYaml(packed), 'utf8')

  const install = runtimeInstallEnv()
  console.log(`[vendor-dsh] install：pnpm install --ignore-scripts --node-linker=hoisted（隔离 runtime workspace；Node heap ${install.heapMb} MiB）`)
  // --ignore-scripts：node-pty/koffi 的 build 与 subprocess-local 的 postinstall 一律跳过——
  // 与探针验证过的 checkout 状态一致（那里同样未构建，DSH 照常运行；两包均带平台 prebuild，
  // subprocess-local 的 postinstall 只是 POSIX chmod）。manifest.buildScriptsIgnored 记录此决策。
  // M5-01：--node-linker=hoisted——pnpm 默认布局用 junction 链接 node_modules/@deepseek-ai/*，
  // electron-builder 的 extraResources 不跟随 junction，打包会丢整个闭包；hoisted 布局是真实目录，
  // 复制语义可靠（运行时解析行为不变，contract/T8/verify 冒烟锁行为）。
  run(resolvePnpm(), ['install', '--ignore-scripts', '--node-linker=hoisted'], RUNTIME_DIR, 'runtime pnpm install', install.env)

  // 单实例结构检查：任何 @deepseek-ai 包出现嵌套第二副本即失败（见 runtimePkg.pnpm.overrides 注释）。
  await assertSingleInstance(join(RUNTIME_DIR, 'node_modules'))
  console.log('[vendor-dsh] 单实例检查通过：闭包内 @deepseek-ai 包无嵌套重复副本')
  await assertPackageEntrypoints(join(RUNTIME_DIR, 'node_modules'), manifestClosure)
  console.log('[vendor-dsh] 包 main / exports 默认入口检查通过')

  await mkdir(join(RUNTIME_DIR, 'bin'), { recursive: true })
  // R1：官方 CLI 启动器（main 用 process.execPath + ELECTRON_RUN_AS_NODE=1 直跑 lib/bin.js，
  // 不经此 shim；shim 是外部诊断入口）。R4 退役：v2 SDK packaged-bin 入口随旧运行时移除。
  const cliBinRel = 'node_modules/@deepseek-ai/dsh/lib/bin.js'
  const cliBin = join(RUNTIME_DIR, cliBinRel)
  if (!existsSync(cliBin)) throw new Error(`装配后缺官方 CLI 入口：${cliBin}`)
  await writeFile(
    join(RUNTIME_DIR, 'bin', 'dsh-web.cmd'),
    `@echo off\r\nnode "%~dp0..\\${cliBinRel.replaceAll('/', '\\')}" %*\r\n`,
    'utf8',
  )
  await writeFile(
    join(RUNTIME_DIR, 'bin', 'dsh-web'),
    `#!/bin/sh\nexec node "$(dirname "$0")/../${cliBinRel}" "$@"\n`,
    'utf8',
  )

  const pnpmVersion = run(resolvePnpm(), ['--version'], RUNTIME_DIR, 'pnpm --version').stdout.trim()
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scriptVersion: VENDOR_SCRIPT_VERSION,
    dsh: { repo: pin.repo, packageVersion: pin.packageVersion, commit: pin.commit },
    toolchain: { node: process.version, pnpm: pnpmVersion },
    subset: subset.map(({ name, why }) => ({ name, why })),
    closure: manifestClosure,
    // R1：web profile 全挂官方树，机制包不再有「带入不挂行」审计项；字段保留（恒为空）。
    carriedButNotMounted,
    buildScriptsIgnored: true,
    sourceArtifacts: {
      mode: 'prebuilt-checkout',
      verifiedEntrypoints: true,
      harnessBuildInvoked: false,
      skippedPlatformOptionals,
      runtimeInstallNodeHeapMb: install.heapMb,
      workspaceOverrides: true,
    },
    webRuntimeEntry: `node_modules/@deepseek-ai/dsh/lib/bin.js`,
  }
  await writeFile(join(RUNTIME_DIR, 'VENDOR-MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')

  console.log(`[vendor-dsh] 完成：${packed.length} 包 → ${RUNTIME_DIR}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[vendor-dsh] 失败：${error instanceof Error ? error.stack : String(error)}`)
    process.exit(1)
  })
}
