/**
 * DSH web 运行时管理器（R1-02）——WeftMate 与官方 DSH web profile 之间的接缝。
 *
 * 职责（docs/ARCHITECTURE.md v3 §2）：
 *  - boot 时把 profile `weftmate` 写进 `$DSH_HOME/profiles/weftmate/`
 *    （package.json 的 dsh.profile.bundles = [dsh-base, dsh-web-app] + cordis.patch.yml 补丁层）；
 *  - spawn 官方 CLI `dsh --profile weftmate --port 0`（端口由 OS 分配，避免与本机其它 DSH 冲突）；
 *  - 就绪信号 = 官方 web-app 行打印的 URL 行 `dsh web: http://127.0.0.1:<port>`（printUrl: true）；
 *  - 凭据接缝：官方 `ctx.credentials` 经 child IPC 请求 main；值不进配置、日志或子进程环境；
 *  - 崩溃隔离：就绪后子进程意外退出 → 后台退避重拉；端口会换 → onOrigin 通知 main 换源重载。
 *
 * 运行时形态（docs/VENDOR-PACKAGING.md §2 D5）：
 *  - dev（checkout）：跑 checkout 的 apps/cli/lib/bin.js（编译产物，不 import 源码树）；
 *  - vendor：跑 vendor/dsh-runtime 的 node_modules/@deepseek-ai/dsh/lib/bin.js（发货闭包）。
 *
 * 不 import electron（可 headless 测试）；凭据绝不落盘、绝不 console.log。
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 官方 web profile 的 bundle 层（dsh --profile 组装顺序 = 本列表顺序 + cordis.patch.yml）。 */
export const DEFAULT_PROFILE_BUNDLES: readonly string[] = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
]

/** R1 旧补丁层模板（只有注释 + 空列表 `[]`）；仅用于识别并升级 owner 未手改的旧 profile。 */
export const PROFILE_PATCH_TEMPLATE_LEGACY = `# WeftMate 补丁层（R1）：叠加在 bundle patch（dsh-base → dsh-web-app）之上，最后写者赢。
# R3 起在此挂 weftmate 自有宿主/客户端插件行；当前为官方 web 全集基线，无覆盖。
[]
`

/** R7 补丁层：仅用于识别并升级尚未手改的 WeftMate 自生成模板。 */
export const PROFILE_PATCH_TEMPLATE_R7 = `# WeftMate 补丁层（R7）：叠加在 bundle patch（dsh-base → dsh-web-app）之上，最后写者赢。
# 挂 weftmate 自有宿主/客户端插件行（宿主行 + 客户端 dsh.client 行 + 记忆桥宿主行）。
- insert:
    - id: weftmate-host
      name: ./plugins/weftmate-host.mjs
    - id: weftmate-memory
      name: ./plugins/weftmate-memory.mjs
    - id: '@weftmate/client'
      name: '@weftmate/client'
# 目录选择器钉 browse（官方 overlay 语义）：auto 行在 Windows/Electron 下解析到 native，
# 其 win32 folder dialog worker 在运行时子进程环境下不可用（真机报「win32 folder dialog
# worker exited before reporting a result」）。disable auto + 插 browse 宿主行与客户端 UI 行。
- id: directory-picker
  disabled: true
- insert:
    - id: directory-picker-browse
      name: '@deepseek-ai/dsh-host-directory-picker-browse'
    - id: ui-directory-picker-browse
      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'
`

/** R8 generated template retained only so exact old generated profiles upgrade. */
export const PROFILE_PATCH_TEMPLATE_R8 = `# WeftMate 补丁层（R8）：官方 DSH 全功能 + WeftMate 安全凭据宿主。
- insert:
    - id: weftmate-host
      name: ./plugins/weftmate-host.mjs
    - id: weftmate-memory
      name: ./plugins/weftmate-memory.mjs
    - id: weftmate-credentials
      name: ./plugins/weftmate-credentials.mjs
    - id: '@weftmate/client'
      name: '@weftmate/client'
# 只允许一个 credentials provider。官方文件 provider 会落 DSH_HOME/.credentials.yaml，
# 因而在 WeftMate profile 中明确关闭；上面的 provider 通过 Node child IPC 走 Electron safeStorage。
- id: credentials
  disabled: true
- id: directory-picker
  disabled: true
- insert:
    - id: directory-picker-browse
      name: '@deepseek-ai/dsh-host-directory-picker-browse'
    - id: ui-directory-picker-browse
      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'
`

/**
 * R9 generated template intentionally contains no credential provider. The
 * host-owned final `--patch` inserts the sole safe provider after every
 * preserved/owner profile patch, so an owner patch cannot omit or replace it.
 */
export const PROFILE_PATCH_TEMPLATE_R9 = `# WeftMate 补丁层（R9）：官方 DSH 功能与最小桌面扩展。
- insert:
    - id: weftmate-host
      name: ./plugins/weftmate-host.mjs
    - id: weftmate-memory
      name: ./plugins/weftmate-memory.mjs
    - id: '@weftmate/client'
      name: '@weftmate/client'
# Credential providers are deliberately absent here. The final host security
# overlay is the only authority for safeStorage credential IPC.
- id: directory-picker
  disabled: true
- insert:
    - id: directory-picker-browse
      name: '@deepseek-ai/dsh-host-directory-picker-browse'
    - id: ui-directory-picker-browse
      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'
`

/** R10 adds one independent official host tool without changing the client graph/details slot. */
export const PROFILE_PATCH_TEMPLATE = `# WeftMate 补丁层（R10）：官方 DSH 功能、最小桌面扩展与 AI-Game 工具接缝。
- insert:
    - id: weftmate-host
      name: ./plugins/weftmate-host.mjs
    - id: weftmate-memory
      name: ./plugins/weftmate-memory.mjs
    - id: weftmate-aigame-host
      name: ./plugins/weftmate-aigame-host.mjs
    - id: '@weftmate/client'
      name: '@weftmate/client'
# Credential providers are deliberately absent here. The final host security
# overlay is the only authority for safeStorage credential IPC.
- id: directory-picker
  disabled: true
- insert:
    - id: directory-picker-browse
      name: '@deepseek-ai/dsh-host-directory-picker-browse'
    - id: ui-directory-picker-browse
      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'
`

/** R3 旧补丁层模板（两行 + 目录选择器覆盖，无记忆行）；识别为「未手改旧模板」自动升级。 */
export const PROFILE_PATCH_TEMPLATE_R3_PICKER = `# WeftMate 补丁层（R3）：叠加在 bundle patch（dsh-base → dsh-web-app）之上，最后写者赢。
# 挂 weftmate 自有宿主/客户端插件行（宿主行 + 客户端 dsh.client 行）。
- insert:
    - id: weftmate-host
      name: ./plugins/weftmate-host.mjs
    - id: '@weftmate/client'
      name: '@weftmate/client'
# 目录选择器钉 browse（官方 overlay 语义）：auto 行在 Windows/Electron 下解析到 native，
# 其 win32 folder dialog worker 在运行时子进程环境下不可用（真机报「win32 folder dialog
# worker exited before reporting a result」）。disable auto + 插 browse 宿主行与客户端 UI 行。
- id: directory-picker
  disabled: true
- insert:
    - id: directory-picker-browse
      name: '@deepseek-ai/dsh-host-directory-picker-browse'
    - id: ui-directory-picker-browse
      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'
`

/** R3 旧补丁层模板（挂 weftmate 两行，无目录选择器覆盖）；识别为「未手改旧模板」自动升级。 */
export const PROFILE_PATCH_TEMPLATE_R3 = `# WeftMate 补丁层（R3）：叠加在 bundle patch（dsh-base → dsh-web-app）之上，最后写者赢。
# 挂 weftmate 自有宿主/客户端插件行（宿主行 + 客户端 dsh.client 行）。
- insert:
    - id: weftmate-host
      name: ./plugins/weftmate-host.mjs
    - id: '@weftmate/client'
      name: '@weftmate/client'
`

/** 插件资产源目录（相对本文件 src/，运行时用 import.meta.url 定位——dev/vendor/测试三形态同源）。 */
const here = dirname(fileURLToPath(import.meta.url))
const PLUGINS_DIR = join(here, 'plugins')
const CLIENT_PLUGIN_SRC = join(PLUGINS_DIR, 'weftmate-client')
const HOST_PLUGIN_SRC = join(PLUGINS_DIR, 'weftmate-host.mjs')
const AI_GAME_HOST_PLUGIN_SRC = join(PLUGINS_DIR, 'weftmate-aigame-host.mjs')
const CREDENTIALS_PLUGIN_SRC = join(PLUGINS_DIR, 'weftmate-credentials.mjs')
const SECURE_SNAPSHOT_BOOTSTRAP_SRC = join(PLUGINS_DIR, 'weftmate-secure-snapshot-bootstrap.mjs')
/** Gateway 运行时源目录（P1-02 起）：宿主插件以相对路径 import，profile 侧同形落位
 *  `profiles/<name>/runtime/gateway/`（插件进程从 profile 副本运行，必须复制过去）。 */
const GATEWAY_SRC = join(here, 'runtime', 'gateway')
const DSH_ADAPTER_SRC = join(here, 'runtime', 'dsh-adapter')
const AI_GAME_RUNTIME_SRC = join(here, 'runtime', 'ai-game')

/** 官方就绪信号行（web-app 行 printUrl: true）：`dsh web: http://127.0.0.1:<port>[ (LAN: …)]`。 */
const WEB_URL_LINE = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)/

/**
 * 解析 stdout/stderr 单行里的官方 URL 行。
 * @param line - 去掉换行符的一行输出。
 * @returns `http://127.0.0.1:<port>` 或 null。
 */
export function parseWebUrlLine(line: string): string | null {
  const match = WEB_URL_LINE.exec(line.trim())
  return match === null ? null : match[1]
}

export type WriteProfileResult = 'created' | 'repaired' | 'unchanged'

/** 幂等复制：源/目标内容一致不重写；返回是否发生了写入。 */
async function copyFileIfChanged(src: string, dest: string): Promise<boolean> {
  const content = await readFile(src, 'utf8')
  try {
    if (await readFile(dest, 'utf8') === content) return false
  } catch { /* 目标缺失，走写入 */ }
  await mkdir(dirname(dest), { recursive: true })
  await writeFile(dest, content, 'utf8')
  return true
}

/**
 * 递归幂等复制目录：逐文件比对内容，一致不重写；返回是否发生了写入。
 * @param srcDir - 源目录。
 * @param destDir - 目标目录（不存在则递归创建）。
 */
async function copyDirIfChanged(srcDir: string, destDir: string): Promise<boolean> {
  const entries = await readdir(srcDir, { withFileTypes: true })
  let changed = false
  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name)
    const destPath = join(destDir, entry.name)
    if (entry.isDirectory()) {
      if (await copyDirIfChanged(srcPath, destPath)) changed = true
    } else {
      if (await copyFileIfChanged(srcPath, destPath)) changed = true
    }
  }
  return changed
}

/**
 * 写补丁层：只在「缺失 或 内容等于已知旧模板」时写为新模板；内容等于新模板或 owner 手改则保留。
 * @returns 是否发生了写入。
 */
async function writeProfilePatch(patchPath: string): Promise<boolean> {
  let existing: string
  try {
    existing = await readFile(patchPath, 'utf8')
  } catch {
    await writeFile(patchPath, PROFILE_PATCH_TEMPLATE, 'utf8')
    return true
  }
  if (existing === PROFILE_PATCH_TEMPLATE) return false // 已是新模板
  if (existing === PROFILE_PATCH_TEMPLATE_LEGACY || existing === PROFILE_PATCH_TEMPLATE_R3
    || existing === PROFILE_PATCH_TEMPLATE_R3_PICKER || existing === PROFILE_PATCH_TEMPLATE_R7
    || existing === PROFILE_PATCH_TEMPLATE_R8 || existing === PROFILE_PATCH_TEMPLATE_R9) {
    await writeFile(patchPath, PROFILE_PATCH_TEMPLATE, 'utf8')
    return true // 已知旧模板升级
  }
  return false // owner 手改（非任何已知模板）→ 保留
}

/**
 * 落位插件资产：客户端包 → `profiles/<name>/node_modules/@weftmate/client/`（profile 自己的 node_modules，
 * Node 就近解析命中，不动官方 heal 的 `profiles/node_modules`）；宿主插件 → `profiles/<name>/plugins/`；
 * Gateway + DSH adapter（P1-03 起）→ profile runtime（宿主插件从 profile 副本运行；
 * schemas/ 等 TS 契约不进 profile）。
 * @returns 是否有文件被创建或改写。
 */
async function writePluginAssets(dir: string): Promise<boolean> {
  const clientDest = join(dir, 'node_modules', '@weftmate', 'client')
  const hostDest = join(dir, 'plugins', 'weftmate-host.mjs')
  const aiGameHostDest = join(dir, 'plugins', 'weftmate-aigame-host.mjs')
  const memoryDest = join(dir, 'plugins', 'weftmate-memory.mjs')
  const credentialsDest = join(dir, 'plugins', 'weftmate-credentials.mjs')
  const secureBootstrapDest = join(dir, 'plugins', 'weftmate-secure-snapshot-bootstrap.mjs')
  const gatewayDest = join(dir, 'runtime', 'gateway')
  const tasks: Array<[string, string]> = [
    [join(CLIENT_PLUGIN_SRC, 'package.json'), join(clientDest, 'package.json')],
    [join(CLIENT_PLUGIN_SRC, 'index.js'), join(clientDest, 'index.js')],
    [join(CLIENT_PLUGIN_SRC, 'client.js'), join(clientDest, 'client.js')],
    [HOST_PLUGIN_SRC, hostDest],
    [AI_GAME_HOST_PLUGIN_SRC, aiGameHostDest],
    [join(PLUGINS_DIR, 'weftmate-memory.mjs'), memoryDest],
    [CREDENTIALS_PLUGIN_SRC, credentialsDest],
    [SECURE_SNAPSHOT_BOOTSTRAP_SRC, secureBootstrapDest],
    [join(GATEWAY_SRC, 'index.mjs'), join(gatewayDest, 'index.mjs')],
    [join(GATEWAY_SRC, 'diagnostics.mjs'), join(gatewayDest, 'diagnostics.mjs')],
  ]
  let changed = false
  for (const [src, dest] of tasks) {
    if (await copyFileIfChanged(src, dest)) changed = true
  }
  if (await copyDirIfChanged(join(GATEWAY_SRC, 'legacy'), join(gatewayDest, 'legacy'))) changed = true
  if (await copyDirIfChanged(join(GATEWAY_SRC, 'routes'), join(gatewayDest, 'routes'))) changed = true
  if (await copyDirIfChanged(join(GATEWAY_SRC, 'event-stream'), join(gatewayDest, 'event-stream'))) changed = true
  if (await copyDirIfChanged(join(GATEWAY_SRC, 'errors'), join(gatewayDest, 'errors'))) changed = true
  if (await copyDirIfChanged(DSH_ADAPTER_SRC, join(dir, 'runtime', 'dsh-adapter'))) changed = true
  if (await copyDirIfChanged(AI_GAME_RUNTIME_SRC, join(dir, 'runtime', 'ai-game'))) changed = true
  return changed
}

/**
 * 把 profile `weftmate` 写进 `$DSH_HOME/profiles/<name>/`（R1-02 的「profile 由 main 写进 dsh-home」）。
 * 幂等：manifest 不存在则创建；bundles 与预期不符则修复（保留 manifest 其它字段）；
 * 补丁层只在「缺失 或 等于已知旧模板」时写为新模板（owner 手改保留）；插件资产内容一致不重写。
 */
export async function writeWebProfile(
  homeDir: string,
  profileName = 'weftmate',
  bundles: readonly string[] = DEFAULT_PROFILE_BUNDLES,
): Promise<WriteProfileResult> {
  const dir = join(homeDir, 'profiles', profileName)
  await mkdir(dir, { recursive: true })
  const manifestPath = join(dir, 'package.json')

  let manifest: Record<string, unknown>
  let result: WriteProfileResult = 'created'
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    result = 'unchanged'
  } catch {
    manifest = {}
  }
  let dirty = result === 'created'
  const dsh = (typeof manifest.dsh === 'object' && manifest.dsh !== null && !Array.isArray(manifest.dsh)
    ? manifest.dsh : {}) as Record<string, unknown>
  const profile = (typeof dsh.profile === 'object' && dsh.profile !== null && !Array.isArray(dsh.profile)
    ? dsh.profile : {}) as Record<string, unknown>
  const current = Array.isArray(profile.bundles) ? profile.bundles : null
  const same = current !== null && current.length === bundles.length
    && current.every((value, index) => value === bundles[index])
  if (!same) {
    profile.bundles = [...bundles]
    dsh.profile = profile
    manifest.dsh = dsh
    dirty = true
  }
  if (typeof manifest.name !== 'string') {
    manifest.name = `dsh-profile-${profileName}`
    dirty = true
  }
  if (manifest.private !== true) {
    manifest.private = true
    dirty = true
  }
  if (typeof manifest.dependencies !== 'object' || manifest.dependencies === null || Array.isArray(manifest.dependencies)) {
    manifest.dependencies = {}
    dirty = true
  }
  if (dirty) {
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  }
  if (result === 'unchanged' && dirty) result = 'repaired'

  if (await writeProfilePatch(join(dir, 'cordis.patch.yml')) && result === 'unchanged') result = 'repaired'
  if (await writePluginAssets(dir) && result === 'unchanged') result = 'repaired'
  return result
}

export interface DshWebRuntimeOptions {
  /** 运行时 home（DSH_HOME）：profiles/、sessions/、settings.yaml、.credentials.yaml 都在这下面。 */
  homeDir: string
  /** 子进程 cwd（sandbox-policy 的 workspaceRoot = process.cwd()；缺省 DSH_HOME/workspace）。 */
  workspaceDir: string
  /** profile 名（缺省 'weftmate'）。 */
  profileName?: string
  /** 监听端口（缺省 0 = OS 分配，URL 行回报实际端口）。 */
  port?: number
  /** dev 形态的 checkout 路径（缺省只认显式 WEFTMATE_DSH_CHECKOUT；安装版不使用此路径）。 */
  checkoutPath?: string
  /** vendor 形态的 vendor/dsh-runtime 路径（缺省 WEFTMATE_DSH_RUNTIME；空 = dev 形态）。 */
  runtimePath?: string
  /** Electron 主进程形态：用 process.execPath + ELECTRON_RUN_AS_NODE=1 当 node 用（不依赖 PATH 里的 node）。 */
  nodeElectron?: boolean
  /**
   * 已弃用的 legacy credential env 接缝。仅在尚未接上 `credentialRequestHandler` 的
   * 老调用方中保留兼容；一旦提供 IPC handler，本函数的结果绝不合入 child 环境。
   */
  credentialEnv?: () => NodeJS.ProcessEnv
  /**
   * Electron main 的安全凭据回调。runtime 只把经过结构校验的请求和 correlation id
   * 交给它，绝不记录 request/response 的 value；main 后续可用 safeStorage 实现此接口。
   */
  credentialRequestHandler?: WeftMateCredentialRequestHandler
  /** Unit-test seam only; production callers leave this unset. */
  testOnlySecureCompositionPreflight?: () => Promise<void>
  /** Test-only race seam, after the verified snapshot exists and before child spawn. */
  testOnlyAfterSecureCompositionSnapshot?: (snapshot: Readonly<{ digest: string, entries: readonly unknown[] }>) => Promise<void>
  /** 单次凭据 IPC 往返上限；超时统一回给 child `timeout`，不会遗留 pending request。 */
  credentialRequestTimeoutMs?: number
  /** 官方 CLI 额外 patch 覆盖层；由宿主拥有，绝不改 owner 的 profile patch。 */
  patchFiles?: readonly string[]
  /** 子进程输出透传（main 打日志；绝不打印凭据）。 */
  log?: (line: string) => void
  /** 就绪等待上限（缺省 120s）。 */
  readyTimeoutMs?: number
}

/** The verified, memory-only config tree sent exactly once to the secure child. */
interface SecureCompositionSnapshot {
  entries: unknown[]
  digest: string
  nonce: string
}

export const WEFTMATE_CREDENTIALS_IPC_PROTOCOL = 'weftmate.credentials.v1'

export type WeftMateCredentialOperation = 'resolve' | 'describe' | 'set' | 'unset'

export interface WeftMateCredentialRequest {
  id: string
  operation: WeftMateCredentialOperation
  ref: string
  /** 只允许 `set` 携带；runtime 不记录此字段。 */
  value?: string
}

export interface WeftMateCredentialResponse {
  /** resolve 仅在已配置时提供，绝不用于 describe。 */
  value?: string
  configured?: boolean
  source?: string
  writable?: boolean
  /** set/unset 是否实际改变存储；省略按 true 处理，兼容主进程最小实现。 */
  changed?: boolean
}

export type WeftMateCredentialRequestHandler = (
  request: Readonly<WeftMateCredentialRequest>,
) => Promise<WeftMateCredentialResponse> | WeftMateCredentialResponse

interface CredentialIpcRequestFrame {
  protocol: typeof WEFTMATE_CREDENTIALS_IPC_PROTOCOL
  id: string
  operation: WeftMateCredentialOperation
  ref: string
  value?: string
}

interface CredentialIpcResponseFrame {
  protocol: typeof WEFTMATE_CREDENTIALS_IPC_PROTOCOL
  id: string
  ok: boolean
  result?: WeftMateCredentialResponse
  error?: 'closed' | 'invalid_request' | 'timeout' | 'unavailable' | 'failed'
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })

const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const CREDENTIAL_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/

/** IPC 入站解析绝不把未知字段、错误文本或 value 送进日志。 */
function parseCredentialRequestFrame(message: unknown): CredentialIpcRequestFrame | undefined {
  if (message === null || typeof message !== 'object' || Array.isArray(message)) return undefined
  const raw = message as Record<string, unknown>
  if (raw.protocol !== WEFTMATE_CREDENTIALS_IPC_PROTOCOL
    || typeof raw.id !== 'string' || !CREDENTIAL_REQUEST_ID_PATTERN.test(raw.id)
    || typeof raw.ref !== 'string' || !CREDENTIAL_REF_PATTERN.test(raw.ref)
    || (raw.operation !== 'resolve' && raw.operation !== 'describe' && raw.operation !== 'set' && raw.operation !== 'unset')) {
    return undefined
  }
  if (raw.operation === 'set') {
    if (typeof raw.value !== 'string' || raw.value.length === 0) return undefined
    return { protocol: WEFTMATE_CREDENTIALS_IPC_PROTOCOL, id: raw.id, operation: raw.operation, ref: raw.ref, value: raw.value }
  }
  if (raw.value !== undefined) return undefined
  return { protocol: WEFTMATE_CREDENTIALS_IPC_PROTOCOL, id: raw.id, operation: raw.operation, ref: raw.ref }
}

/** 将 main 回调的结果压缩为官方 provider 的最小结果，避免 describe/set 意外回传 secret。 */
function normalizeCredentialResponse(
  operation: WeftMateCredentialOperation,
  response: unknown,
): WeftMateCredentialResponse {
  if (response === null || typeof response !== 'object' || Array.isArray(response)) return {}
  const safe = response as WeftMateCredentialResponse
  if (operation === 'resolve') {
    return typeof safe.value === 'string' && safe.value.length > 0
      ? { value: safe.value, source: typeof safe.source === 'string' ? safe.source : 'weftmate' }
      : {}
  }
  if (operation === 'describe') {
    const configured = safe.configured === true
    return {
      configured,
      ...(configured && typeof safe.source === 'string' ? { source: safe.source } : {}),
      writable: safe.writable !== false,
    }
  }
  return safe.changed === false ? { changed: false } : {}
}

/** 关闭前的统一 fence（栅栏）：异步阶段返回后必须重新检查，避免 close 后复活子进程。 */
const closedRuntimeError = (): Error => new Error('DshWebRuntime is closed')

/** 不会因重试自行恢复的 checkout 完整性问题：直接交给 Harness 所有者处理。 */
class DshCheckoutPreflightError extends Error {}

/**
 * Secure bridge mode must never boot a composition whose credentials service
 * can be isolated away from Cordis' normal service collision checks. The CLI
 * dump is composed by the exact pinned runtime, then parsed by that runtime's
 * own js-yaml dialect (including its `!!js` scalar tag) before any web child
 * is spawned. No dump content is logged because a third-party patch may put
 * sensitive literals in arbitrary configuration fields.
 */
function assertSecureCredentialComposition(entries: unknown): void {
  let safeProviderActive = 0
  let modelsActive = 0
  let rejected = false
  const seen = new Set<object>()
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return
    if (seen.has(value)) return
    seen.add(value)
    if (Array.isArray(value)) {
      for (const child of value) visit(child)
      return
    }
    const row = value as Record<string, unknown>
    const active = row.disabled !== true
    const id = typeof row.id === 'string' ? row.id : ''
    const name = typeof row.name === 'string' ? row.name : ''
    if (row.isolate !== null && typeof row.isolate === 'object' && !Array.isArray(row.isolate)) {
      const isolatedCredentials = (row.isolate as Record<string, unknown>).credentials
      if (isolatedCredentials !== undefined && isolatedCredentials !== null && isolatedCredentials !== false) rejected = true
    }
    if (active && name === '@deepseek-ai/dsh-credentials-local') rejected = true
    if (active && name === './plugins/weftmate-credentials.mjs') {
      if (id === 'weftmate-safe-credentials') safeProviderActive += 1
      else rejected = true
    }
    if (active && id === 'ui-settings-models'
      && name === '@deepseek-ai/dsh-client-ui-settings-models') modelsActive += 1
    // A user patch must not turn the official HMR entry back on: it would make
    // the running tree observe mutable profile/home files after this snapshot
    // has been verified and booted.
    if (active && id === 'hmr') rejected = true
    for (const child of Object.values(row)) visit(child)
  }
  visit(entries)
  if (rejected || safeProviderActive !== 1 || modelsActive < 1) {
    throw new Error('安全凭据配置预检拒绝：最终 DSH 配置必须仅启用一个非隔离 WeftMate safe credentials provider，并保留官方 Models。')
  }
}

/** Credential-like names are never reachable from a secure child, including through `.env`. */
function isCredentialLikeEnvironmentName(name: string): boolean {
  return /(?:^|[_-])(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)(?:$|[_-])/i.test(name)
    || name.endsWith('_API_KEY') || name.endsWith('_API_TOKEN') || name.endsWith('_API_SECRET')
    || name.startsWith('WEFTMATE_LLM_KEY_')
}

/** Copy only data the Node IPC serializer can carry, with the same finite bound as the CLI dump. */
function encodeSecureSnapshot(entries: unknown[]): string {
  let encoded: string
  try { encoded = JSON.stringify(entries) } catch { throw new Error('invalid composed tree') }
  if (Buffer.byteLength(encoded) > 512 * 1024) throw new Error('composed tree too large')
  return encoded
}

/** Windows 只针对已登记根 PID 调 taskkill；不经 shell，避免把路径或参数拼进命令行。 */
function taskkillProcessTree(pid: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('taskkill', ['/pid', String(pid), '/t', '/f'], {
      windowsHide: true,
      timeout: 5_000,
    }, (error) => {
      if (error === null) resolve()
      else reject(error)
    })
  })
}

export class DshWebRuntime {
  private readonly opts: {
    homeDir: string
    workspaceDir: string
    profileName: string
    port: number
    checkoutPath: string
    runtimePath: string
    nodeElectron: boolean
    credentialEnv: () => NodeJS.ProcessEnv
    credentialRequestHandler: WeftMateCredentialRequestHandler | undefined
    testOnlySecureCompositionPreflight: (() => Promise<void>) | undefined
    testOnlyAfterSecureCompositionSnapshot: ((snapshot: Readonly<{ digest: string, entries: readonly unknown[] }>) => Promise<void>) | undefined
    credentialRequestTimeoutMs: number
    patchFiles: readonly string[]
    log: (line: string) => void
    readyTimeoutMs: number
  }

  private child: ChildProcess | undefined
  private originValue: string | null = null
  private closed = false
  private startInFlight: Promise<string> | undefined
  private closeInFlight: Promise<void> | undefined
  private respawnTimer: NodeJS.Timeout | undefined
  private respawnBackoffMs = 1000
  private logTail: string[] = []
  /** 所有 spawn 过的 child 都登记到 close 事件为止，close 不得只杀当前引用。 */
  private readonly children = new Set<ChildProcess>()
  private readonly closedChildren = new WeakSet<ChildProcess>()
  /** 正在等待 main safeStorage 回调的 IPC；close/child exit 都会立即失效，不等待回调自行结束。 */
  private readonly credentialPending = new Map<ChildProcess, Set<{ timer: NodeJS.Timeout, settled: boolean }>>()

  /** 就绪后崩溃重拉换源时回调（首启的 origin 由 start() 的返回值给出，不走本回调）。 */
  onOrigin: ((origin: string | null) => void) | undefined

  constructor(options: DshWebRuntimeOptions) {
    this.opts = {
      homeDir: options.homeDir,
      workspaceDir: options.workspaceDir,
      profileName: options.profileName ?? 'weftmate',
      port: options.port ?? 0,
      // 显式 options 是 Electron/main 的确定性配置，必须压过开发 shell 遗留环境变量。
      checkoutPath: options.checkoutPath ?? process.env.WEFTMATE_DSH_CHECKOUT ?? '',
      runtimePath: options.runtimePath ?? process.env.WEFTMATE_DSH_RUNTIME ?? '',
      nodeElectron: options.nodeElectron ?? false,
      credentialEnv: options.credentialEnv ?? (() => ({})),
      credentialRequestHandler: options.credentialRequestHandler,
      testOnlySecureCompositionPreflight: options.testOnlySecureCompositionPreflight,
      testOnlyAfterSecureCompositionSnapshot: options.testOnlyAfterSecureCompositionSnapshot,
      credentialRequestTimeoutMs: options.credentialRequestTimeoutMs ?? 10_000,
      patchFiles: [...(options.patchFiles ?? [])],
      log: options.log ?? (() => {}),
      readyTimeoutMs: options.readyTimeoutMs ?? 120_000,
    }
  }

  /** 运行时形态：vendor（发货产物）或 checkout（开发）。 */
  form(): 'vendor' | 'checkout' {
    return this.opts.runtimePath !== '' ? 'vendor' : 'checkout'
  }

  /** 当前就绪 origin（崩溃后重拉期间为 null）。 */
  origin(): string | null {
    return this.originValue
  }

  /** 子进程当前是否存活。 */
  isRunning(): boolean {
    return this.child !== undefined
  }

  private launchSpec(): { command: string; nodeArgs: string[]; bin: string; cwd: string } {
    const command = this.opts.nodeElectron ? process.execPath : 'node'
    // Electron 自带的 node 缺 node-addon-require-builtin 所需的 V8 符号
    // （GetAlignedPointerFromEmbedderData），cordis-loader 的「内部 ESM loader」通道拿不到；
    // 官方兜底 = process.execArgv 含 --expose-internals 时走 createRequire 的 CJS 通道
    // （vendor/loader/src/internal.ts requireInternal）→ 入口包名从 profile baseUrl 经
    // profiles/node_modules junction 兜底解析。Electron-as-node 实测两条通道都成立。
    const nodeArgs = this.opts.nodeElectron ? ['--expose-internals'] : []
    if (this.form() === 'vendor') {
      const bin = join(this.opts.runtimePath, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
      if (!existsSync(bin)) {
        throw new Error(`vendor 运行时不完整（缺 ${bin}）——先 npm run vendor:dsh`)
      }
      return { command, nodeArgs, bin, cwd: this.opts.workspaceDir }
    }
    const bin = join(this.opts.checkoutPath, 'apps', 'cli', 'lib', 'bin.js')
    if (!existsSync(bin)) {
      throw new DshCheckoutPreflightError(
        `DSH checkout 编译产物不完整（缺 ${bin}）：pin 可能匹配，但 checkout 尚未完成上游构建；需 Harness 所有者提供已构建 checkout。`,
      )
    }
    // 当前官方 CLI 在启动阶段会加载此 vendor 包的编译入口；pin 命中并不能证明 checkout
    // 已完成上游构建。WeftMate 只做集成 preflight，不在这里触发或建议修改外部 Harness。
    const groupEntry = join(this.opts.checkoutPath, 'vendor', 'group', 'lib', 'index.js')
    if (!existsSync(groupEntry)) {
      throw new DshCheckoutPreflightError(
        `DSH checkout 编译产物不完整（缺 ${groupEntry}）：pin 可能匹配，但 checkout 编译产物不完整；需 Harness 所有者提供已构建 checkout。`,
      )
    }
    return { command, nodeArgs, bin, cwd: this.opts.workspaceDir }
  }

  /** The exact package closure that composed the dump also owns secure boot's imports. */
  private runtimeNodeModulesDir(): string {
    return this.form() === 'vendor'
      ? join(this.opts.runtimePath, 'node_modules')
      : join(this.opts.checkoutPath, 'node_modules')
  }

  /** Exact CLI package that owns the dependency graph used by secure boot. */
  private runtimePackageAnchor(): string {
    return this.form() === 'vendor'
      ? join(this.opts.runtimePath, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
      : join(this.opts.checkoutPath, 'apps', 'cli', 'package.json')
  }

  /** Mirror runProfile()'s shipped agent-preset overlay over the flattened CLI dump. */
  private finalizeSecureComposition(entries: unknown[]): SecureCompositionSnapshot {
    const finalized = structuredClone(entries) as unknown[]
    const shippedPresetRoot = this.form() === 'vendor'
      ? join(this.opts.runtimePath, 'node_modules', '@deepseek-ai', 'dsh', 'config', 'agent-presets')
      : join(this.opts.checkoutPath, 'apps', 'cli', 'config', 'agent-presets')
    const visit = (value: unknown): void => {
      if (value === null || typeof value !== 'object') return
      if (Array.isArray(value)) { for (const child of value) visit(child); return }
      const row = value as Record<string, unknown>
      if (row.id === 'agent-presets') {
        const config = row.config !== null && typeof row.config === 'object' && !Array.isArray(row.config)
          ? row.config as Record<string, unknown> : {}
        row.config = { ...config, roots: [{ path: shippedPresetRoot, trust: 'system' }] }
      }
      // childEnv() always turns telemetry off. runProfile() adds this after
      // composition, so a flattened --dump-config needs the same final row.
      if (row.id === 'session-telemetry-otel') row.disabled = true
      for (const child of Object.values(row)) visit(child)
    }
    visit(finalized)
    assertSecureCredentialComposition(finalized)
    const encoded = encodeSecureSnapshot(finalized)
    return {
      entries: finalized,
      digest: createHash('sha256').update(encoded).digest('hex'),
      nonce: randomBytes(24).toString('hex'),
    }
  }

  /** 在 secure bridge 模式下，以同一 pinned CLI 组成并校验最终 patch 树。 */
  private async preflightSecureCredentialComposition(): Promise<SecureCompositionSnapshot | undefined> {
    if (this.opts.credentialRequestHandler === undefined) return
    if (this.opts.testOnlySecureCompositionPreflight !== undefined) {
      await this.opts.testOnlySecureCompositionPreflight()
      // The fake-CLI lifecycle tests intentionally exercise the IPC carrier
      // without a pinned package closure. Production has no such option and
      // therefore cannot take this non-snapshot branch.
      return
    }
    const spec = this.launchSpec()
    const args = [...spec.nodeArgs, spec.bin, '--profile', this.opts.profileName,
      ...this.opts.patchFiles.flatMap((file) => ['--patch', file]), '--dump-config']
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(spec.command, args, {
        cwd: spec.cwd,
        env: this.childEnv(),
        windowsHide: true,
        timeout: 15_000,
        maxBuffer: 512 * 1024,
      }, (error, output) => {
        if (error !== null) {
          reject(new Error('安全凭据配置预检失败：无法获得最终 DSH 配置。'))
          return
        }
        resolve(String(output))
      })
    })
    try {
      const packageRoot = this.runtimeNodeModulesDir()
      const runtimeRequire = createRequire(join(packageRoot, 'package.json'))
      const yaml = runtimeRequire('js-yaml') as {
        Type: new (tag: string, options: Record<string, unknown>) => unknown
        JSON_SCHEMA: { extend: (...types: unknown[]) => unknown }
        load: (source: string, options: { schema: unknown }) => unknown
      }
      const jsExpression = new yaml.Type('tag:yaml.org,2002:js', {
        kind: 'scalar',
        resolve: (data: unknown) => typeof data === 'string',
        construct: (data: unknown) => ({ __jsExpr: data }),
      })
      const entries = yaml.load(stdout, { schema: yaml.JSON_SCHEMA.extend(jsExpression) })
      if (!Array.isArray(entries)) throw new Error('invalid composed tree')
      return this.finalizeSecureComposition(entries)
    } catch {
      // Deliberately collapse all parser/composition details: neither the dump
      // nor owner patch contents are safe to surface through ordinary logs.
      throw new Error('安全凭据配置预检拒绝：最终 DSH 配置不满足 WeftMate 凭据隔离要求。')
    }
  }

  /** 子进程环境：隔离 DSH_HOME 并清洗所有凭据。IPC 模式绝不将 key/token 注入 env。 */
  private childEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env }
    const secureBridge = this.opts.credentialRequestHandler !== undefined
    for (const key of Object.keys(env)) {
      if ((secureBridge && isCredentialLikeEnvironmentName(key))
        || key.endsWith('_API_KEY') || key.endsWith('_API_TOKEN') || key.endsWith('_API_SECRET')
        || key.startsWith('WEFTMATE_LLM_KEY_')) delete env[key]
    }
    env.DSH_HOME = this.opts.homeDir
    // 官方 session-telemetry 行默认 DISABLED；桌面壳再显式关掉整行（隐私默认关，官方开关语义）。
    env.DSH_TELEMETRY_DISABLED = '1'
    if (this.opts.nodeElectron) env.ELECTRON_RUN_AS_NODE = '1'
    // Main 逐步切到 credentialRequestHandler 前，保持老调用方的可运行性；一旦安全 IPC
    // 接缝已给出，即使 legacy callback 仍存在也不得把其任何值带进 child 环境。
    return !secureBridge
      ? { ...env, ...this.opts.credentialEnv() }
      : env
  }

  private tail(): string {
    return this.logTail.slice(-40).join('\n')
  }

  private rememberLine(line: string): void {
    this.logTail.push(line)
    if (this.logTail.length > 200) this.logTail.shift()
  }

  private ensureOpen(): void {
    if (this.closed) throw closedRuntimeError()
  }

  private registerChild(child: ChildProcess): void {
    this.children.add(child)
    child.once('close', () => {
      this.failCredentialRequests(child)
      this.closedChildren.add(child)
      this.children.delete(child)
    })
  }

  /** 若 child 已断开，发送失败静默丢弃；凭据 error 不得进日志或 stdout/stderr。 */
  private sendCredentialResponse(child: ChildProcess, frame: CredentialIpcResponseFrame): void {
    if (!child.connected) return
    try { child.send(frame) } catch { /* 断线与关闭统一 fail-closed */ }
  }

  private failCredentialRequests(child: ChildProcess): void {
    const pending = this.credentialPending.get(child)
    if (pending === undefined) return
    for (const entry of pending) {
      entry.settled = true
      clearTimeout(entry.timer)
    }
    pending.clear()
    this.credentialPending.delete(child)
  }

  /**
   * 处理官方 credentials provider 发出的单次请求。这里不持久化、不输出 ref/value：
   * 只负责 correlation、生命周期与 fail-closed 边界，safeStorage 留给 main 注入 handler。
   */
  private handleCredentialMessage(child: ChildProcess, message: unknown): void {
    const request = parseCredentialRequestFrame(message)
    if (request === undefined) return
    const reject = (error: CredentialIpcResponseFrame['error']): void => {
      this.sendCredentialResponse(child, {
        protocol: WEFTMATE_CREDENTIALS_IPC_PROTOCOL,
        id: request.id,
        ok: false,
        error,
      })
    }
    const handler = this.opts.credentialRequestHandler
    if (this.closed || this.closedChildren.has(child)) { reject('closed'); return }
    if (handler === undefined) { reject('unavailable'); return }

    const entry = { timer: undefined as unknown as NodeJS.Timeout, settled: false }
    let pending = this.credentialPending.get(child)
    if (pending === undefined) {
      pending = new Set()
      this.credentialPending.set(child, pending)
    }
    pending.add(entry)
    const settle = (frame: CredentialIpcResponseFrame): void => {
      if (entry.settled) return
      entry.settled = true
      clearTimeout(entry.timer)
      pending?.delete(entry)
      if (pending?.size === 0) this.credentialPending.delete(child)
      if (!this.closed && !this.closedChildren.has(child)) this.sendCredentialResponse(child, frame)
    }
    entry.timer = setTimeout(() => {
      settle({ protocol: WEFTMATE_CREDENTIALS_IPC_PROTOCOL, id: request.id, ok: false, error: 'timeout' })
    }, this.opts.credentialRequestTimeoutMs)
    entry.timer.unref?.()

    // Pass an immutable copy. A callback cannot mutate the frame later and accidentally retain/log a mutable object.
    const mainRequest = Object.freeze({
      id: request.id,
      operation: request.operation,
      ref: request.ref,
      ...(request.operation === 'set' ? { value: request.value as string } : {}),
    })
    // Start from an already-resolved promise so a type-valid handler that
    // throws synchronously is converted into the same controlled failure as an
    // async rejection.  No exception may escape the child `message` callback.
    void Promise.resolve().then(() => handler(mainRequest)).then(
      (response) => settle({
        protocol: WEFTMATE_CREDENTIALS_IPC_PROTOCOL,
        id: request.id,
        ok: true,
        result: normalizeCredentialResponse(request.operation, response),
      }),
      () => settle({ protocol: WEFTMATE_CREDENTIALS_IPC_PROTOCOL, id: request.id, ok: false, error: 'failed' }),
    )
  }

  private waitForChildClose(child: ChildProcess): Promise<void> {
    if (this.closedChildren.has(child)) return Promise.resolve()
    return new Promise((resolve) => {
      child.once('close', () => { resolve() })
    })
  }

  /**
   * 结束一个已登记根进程。Windows 使用 root PID 的 taskkill /T /F 结束整个树；
   * 非 Windows 先 SIGTERM 给正常退出机会，再在短暂有界等待后 SIGKILL。
   */
  private async terminateChild(child: ChildProcess): Promise<void> {
    if (this.closedChildren.has(child)) return
    const pid = child.pid
    if (process.platform === 'win32' && typeof pid === 'number') {
      try {
        await taskkillProcessTree(pid)
      } catch {
        // 根进程刚好自行退出或 taskkill 失败时，仍给 ChildProcess 一个本地强杀兜底。
        try { child.kill('SIGKILL') } catch { /* 已退出 */ }
      }
      await this.waitForChildClose(child)
      return
    }

    try { child.kill('SIGTERM') } catch { /* 已退出 */ }
    const exitedGracefully = await Promise.race([
      this.waitForChildClose(child).then(() => true),
      delay(1_000).then(() => false),
    ])
    if (!exitedGracefully) {
      try { child.kill('SIGKILL') } catch { /* 已退出 */ }
      await this.waitForChildClose(child)
    }
  }

  /** Spawn one frozen secure snapshot (or the legacy CLI for non-secure/test-only callers). */
  private spawnOnce(snapshot?: SecureCompositionSnapshot): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      try {
        this.ensureOpen()
      } catch (error) {
        reject(error)
        return
      }
      const spec = this.launchSpec()
      try {
        this.ensureOpen()
      } catch (error) {
        reject(error)
        return
      }
      const secureBootstrap = snapshot === undefined ? undefined
        : join(this.opts.homeDir, 'profiles', this.opts.profileName, 'plugins', 'weftmate-secure-snapshot-bootstrap.mjs')
      const args = secureBootstrap === undefined
        // `--patch` is the pinned DSH CLI's formal, repeatable extra-overlay seam.
        ? [...spec.nodeArgs, spec.bin, '--profile', this.opts.profileName,
            ...this.opts.patchFiles.flatMap((file) => ['--patch', file]), '--port', String(this.opts.port)]
        : [...spec.nodeArgs, secureBootstrap]
      const env = secureBootstrap === undefined ? this.childEnv() : {
        ...this.childEnv(),
        WEFTMATE_SECURE_BOOTSTRAP_PACKAGE_ANCHOR: this.runtimePackageAnchor(),
        WEFTMATE_SECURE_BOOTSTRAP_PROFILE_DIR: join(this.opts.homeDir, 'profiles', this.opts.profileName),
        WEFTMATE_SECURE_BOOTSTRAP_NONCE: snapshot!.nonce,
        WEFTMATE_SECURE_BOOTSTRAP_DIGEST: snapshot!.digest,
        WEFTMATE_SECURE_BOOTSTRAP_PORT: String(this.opts.port),
      }
      const child = spawn(spec.command, args, {
        cwd: spec.cwd,
        env,
        // DSH is normally a plain child. The secure credentials profile adds exactly one Node IPC fd;
        // it is process-local and never opens a localhost listener. Electron-as-node supports this stdio form.
        stdio: this.opts.credentialRequestHandler === undefined ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe', 'ipc'],
        windowsHide: true,
      })
      this.registerChild(child)
      this.child = child
      if (this.opts.credentialRequestHandler !== undefined) {
        child.on('message', (message: unknown) => { this.handleCredentialMessage(child, message) })
      }
      let state: 'starting' | 'ready' | 'failed' | 'stopped' = 'starting'
      let buffer = ''
      const feed = (chunk: string, stream: 'stdout' | 'stderr'): void => {
        if (state === 'failed' || state === 'stopped') return
        if (this.closed) {
          state = 'stopped'
          reject(closedRuntimeError())
          return
        }
        buffer += chunk
        let index = buffer.indexOf('\n')
        while (index !== -1) {
          const line = buffer.slice(0, index).replace(/\r$/, '')
          buffer = buffer.slice(index + 1)
          this.opts.log(`[dsh:${stream}] ${line}`)
          this.rememberLine(line)
          const origin = parseWebUrlLine(line)
          if (origin !== null && state === 'starting') {
            if (this.closed) {
              state = 'stopped'
              reject(closedRuntimeError())
              return
            }
            state = 'ready'
            this.originValue = origin
            this.respawnBackoffMs = 1000
            resolve(origin)
            return
          }
          index = buffer.indexOf('\n')
        }
      }
      if (child.stdout === null || child.stderr === null) {
        state = 'failed'
        try { child.kill() } catch { /* 已亡 */ }
        reject(new Error('spawn 官方 CLI 失败：stdio pipe 不可用'))
        return
      }
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => { feed(chunk, 'stdout') })
      child.stderr.on('data', (chunk: string) => { feed(chunk, 'stderr') })
      if (snapshot !== undefined) {
        try {
          child.send({
            protocol: 'weftmate.secure-snapshot.v1', nonce: snapshot.nonce,
            digest: snapshot.digest, entries: snapshot.entries,
          }, (error) => {
            if (error === undefined || error === null || state !== 'starting') return
            const code = (error as NodeJS.ErrnoException).code
            this.opts.log(`[dsh] 安全凭据快照 IPC 发送失败：${typeof code === 'string' ? code : 'unknown'}`)
            state = 'failed'
            try { child.kill() } catch { /* child 已退出 */ }
            reject(new Error('安全凭据快照启动失败：子进程 IPC 不可用。'))
          })
        } catch {
          state = 'failed'
          try { child.kill() } catch { /* child 已退出 */ }
          reject(new Error('安全凭据快照启动失败：子进程 IPC 不可用。'))
        }
      }
      const timer = setTimeout(() => {
        if (state !== 'starting') return
        state = 'failed'
        try { child.kill() } catch { /* 已亡 */ }
        reject(new Error(
          `官方 web 运行时 ${this.opts.readyTimeoutMs / 1000}s 内未输出 URL 行。日志尾部：\n${this.tail()}`,
        ))
      }, this.opts.readyTimeoutMs)
      timer.unref?.()
      child.on('error', (error) => {
        clearTimeout(timer)
        if (state !== 'starting') return
        state = 'failed'
        reject(new Error(`spawn 官方 CLI 失败：${error.message}`))
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (this.child === child) this.child = undefined
        if (this.closed) {
          if (state === 'starting') {
            state = 'stopped'
            reject(closedRuntimeError())
          }
          return
        }
        if (state === 'stopped' || state === 'failed') return
        if (state === 'starting') {
          reject(new Error(`官方 web 运行时启动即退出（exit ${code}）。日志尾部：\n${this.tail()}`))
          return
        }
        // 就绪后意外退出 → 后台退避重拉（端口会换 → onOrigin 通知换源）。
        this.originValue = null
        this.onOrigin?.(null)
        this.scheduleRespawn()
      })
    })
  }

  /** Every boot path, including crash respawn, must pass the secure composition fence. */
  private async preflightThenSpawn(): Promise<string> {
    this.ensureOpen()
    const snapshot = await this.preflightSecureCredentialComposition()
    this.ensureOpen()
    if (snapshot !== undefined && this.opts.testOnlyAfterSecureCompositionSnapshot !== undefined) {
      await this.opts.testOnlyAfterSecureCompositionSnapshot(Object.freeze({ digest: snapshot.digest, entries: snapshot.entries }))
      this.ensureOpen()
    }
    return this.spawnOnce(snapshot)
  }

  private scheduleRespawn(): void {
    if (this.closed || this.respawnTimer !== undefined) return
    const backoff = this.respawnBackoffMs
    this.respawnBackoffMs = Math.min(15_000, this.respawnBackoffMs * 2)
    this.respawnTimer = setTimeout(() => {
      this.respawnTimer = undefined
      if (this.closed) return
      void this.preflightThenSpawn().then(
        (origin) => {
          if (!this.closed) this.onOrigin?.(origin)
        },
        (error: unknown) => {
          if (this.closed) return
          this.opts.log(`[dsh] 重拉失败：${error instanceof Error ? error.message : String(error)}`)
          this.scheduleRespawn()
        },
      )
    }, backoff)
    this.respawnTimer.unref?.()
  }

  /**
   * 懒启动：写 profile → spawn 官方 CLI → 等 URL 行。失败自动重试（3 次内 1s 间隔）。
   * 已就绪且子进程活着时幂等返回当前 origin。
   */
  async start(): Promise<string> {
    this.ensureOpen()
    if (this.originValue !== null && this.child !== undefined) return this.originValue
    if (this.startInFlight !== undefined) return this.startInFlight
    const run = async (attempt: number): Promise<string> => {
      this.ensureOpen()
      await mkdir(this.opts.homeDir, { recursive: true })
      this.ensureOpen()
      await mkdir(this.opts.workspaceDir, { recursive: true })
      this.ensureOpen()
      const profileResult = await writeWebProfile(this.opts.homeDir, this.opts.profileName)
      this.ensureOpen()
      if (profileResult !== 'unchanged') {
        this.opts.log(`[dsh] profile ${this.opts.profileName} ${profileResult === 'created' ? '已写入' : '已修复'}（${this.opts.homeDir}）`)
      }
      try {
        return await this.preflightThenSpawn()
      } catch (error) {
        if (error instanceof DshCheckoutPreflightError || attempt >= 3 || this.closed) {
          throw (this.closed ? closedRuntimeError() : error)
        }
        this.opts.log(`[dsh] 启动失败（第 ${attempt} 次），1s 后重试：${error instanceof Error ? error.message : String(error)}`)
        await delay(1000)
        this.ensureOpen()
        return run(attempt + 1)
      }
    }
    this.startInFlight = run(1).finally(() => { this.startInFlight = undefined })
    return this.startInFlight
  }

  /** 关运行时子进程（SIGKILL 语义；官方会话 jsonl 逐轮落盘，丢失面小）。幂等、终态。 */
  close(): Promise<void> {
    if (this.closeInFlight !== undefined) return this.closeInFlight
    this.closed = true
    if (this.respawnTimer !== undefined) {
      clearTimeout(this.respawnTimer)
      this.respawnTimer = undefined
    }
    this.child = undefined
    this.originValue = null
    // 同一 Promise 对并发 close 复用；快照在 closed fence 之后取得，之后不可能再登记新 child。
    const registered = [...this.children]
    for (const child of registered) this.failCredentialRequests(child)
    this.closeInFlight = Promise.all(registered.map(async (child) => {
      await this.terminateChild(child)
    })).then(() => undefined)
    return this.closeInFlight
  }
}
