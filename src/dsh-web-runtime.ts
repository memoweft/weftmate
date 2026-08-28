/**
 * DSH web 运行时管理器（R1-02）——WeftMate 与官方 DSH web profile 之间的接缝。
 *
 * 职责（docs/ARCHITECTURE.md v3 §2）：
 *  - boot 时把 profile `weftmate` 写进 `$DSH_HOME/profiles/weftmate/`
 *    （package.json 的 dsh.profile.bundles = [dsh-base, dsh-web-app] + cordis.patch.yml 补丁层）；
 *  - spawn 官方 CLI `dsh --profile weftmate --port 0`（端口由 OS 分配，避免与本机其它 DSH 冲突）；
 *  - 就绪信号 = 官方 web-app 行打印的 URL 行 `dsh web: http://127.0.0.1:<port>`（printUrl: true）；
 *  - 凭据接缝：credentialEnv() 由 main 注入（safeStorage 解密后的 key，只经子进程 env，不明文落盘）；
 *  - 崩溃隔离：就绪后子进程意外退出 → 后台退避重拉；端口会换 → onOrigin 通知 main 换源重载。
 *
 * 运行时形态（docs/VENDOR-PACKAGING.md §2 D5）：
 *  - dev（checkout）：跑 checkout 的 apps/cli/lib/bin.js（编译产物，不 import 源码树）；
 *  - vendor：跑 vendor/dsh-runtime 的 node_modules/@deepseek-ai/dsh/lib/bin.js（发货闭包）。
 *
 * 不 import electron（可 headless 测试）；凭据绝不落盘、绝不 console.log。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
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

/** weftmate profile 的补丁层（R7）：官方 bundle patch 之上挂 weftmate 自有行 + 目录选择器钉 browse。 */
export const PROFILE_PATCH_TEMPLATE = `# WeftMate 补丁层（R7）：叠加在 bundle patch（dsh-base → dsh-web-app）之上，最后写者赢。
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
/** Gateway 运行时源目录（P1-02 起）：宿主插件以相对路径 import，profile 侧同形落位
 *  `profiles/<name>/runtime/gateway/`（插件进程从 profile 副本运行，必须复制过去）。 */
const GATEWAY_SRC = join(here, 'runtime', 'gateway')
const DSH_ADAPTER_SRC = join(here, 'runtime', 'dsh-adapter')

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
    || existing === PROFILE_PATCH_TEMPLATE_R3_PICKER) {
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
  const memoryDest = join(dir, 'plugins', 'weftmate-memory.mjs')
  const gatewayDest = join(dir, 'runtime', 'gateway')
  const tasks: Array<[string, string]> = [
    [join(CLIENT_PLUGIN_SRC, 'package.json'), join(clientDest, 'package.json')],
    [join(CLIENT_PLUGIN_SRC, 'index.js'), join(clientDest, 'index.js')],
    [join(CLIENT_PLUGIN_SRC, 'client.js'), join(clientDest, 'client.js')],
    [HOST_PLUGIN_SRC, hostDest],
    [join(PLUGINS_DIR, 'weftmate-memory.mjs'), memoryDest],
    [join(GATEWAY_SRC, 'index.mjs'), join(gatewayDest, 'index.mjs')],
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
  /** dev 形态的 checkout 路径（缺省 WEFTMATE_DSH_CHECKOUT → D:/AIProjects/Shared/Dependencies/DeepSeekHarness）。 */
  checkoutPath?: string
  /** vendor 形态的 vendor/dsh-runtime 路径（缺省 WEFTMATE_DSH_RUNTIME；空 = dev 形态）。 */
  runtimePath?: string
  /** Electron 主进程形态：用 process.execPath + ELECTRON_RUN_AS_NODE=1 当 node 用（不依赖 PATH 里的 node）。 */
  nodeElectron?: boolean
  /** 每次 spawn 注入子进程的凭据 env（R1-04 接缝；key 只经 env 传递，不落盘）。 */
  credentialEnv?: () => NodeJS.ProcessEnv
  /** 子进程输出透传（main 打日志；绝不打印凭据）。 */
  log?: (line: string) => void
  /** 就绪等待上限（缺省 120s）。 */
  readyTimeoutMs?: number
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })

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
    log: (line: string) => void
    readyTimeoutMs: number
  }

  private child: ChildProcess | undefined
  private originValue: string | null = null
  private closed = false
  private startInFlight: Promise<string> | undefined
  private respawnTimer: NodeJS.Timeout | undefined
  private respawnBackoffMs = 1000
  private logTail: string[] = []

  /** 就绪后崩溃重拉换源时回调（首启的 origin 由 start() 的返回值给出，不走本回调）。 */
  onOrigin: ((origin: string | null) => void) | undefined

  constructor(options: DshWebRuntimeOptions) {
    this.opts = {
      homeDir: options.homeDir,
      workspaceDir: options.workspaceDir,
      profileName: options.profileName ?? 'weftmate',
      port: options.port ?? 0,
      checkoutPath: process.env.WEFTMATE_DSH_CHECKOUT ?? options.checkoutPath ?? 'D:/AIProjects/Shared/Dependencies/DeepSeekHarness',
      runtimePath: process.env.WEFTMATE_DSH_RUNTIME ?? options.runtimePath ?? '',
      nodeElectron: options.nodeElectron ?? false,
      credentialEnv: options.credentialEnv ?? (() => ({})),
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
      throw new Error(`checkout 缺官方 CLI 编译产物 ${bin} —— 在 checkout 里跑 pnpm run build:lib`)
    }
    return { command, nodeArgs, bin, cwd: this.opts.workspaceDir }
  }

  /** 子进程环境：隔离 DSH_HOME + 清洗凭据 + 注入 main 给的凭据（R1-04 接缝）。 */
  private childEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env }
    for (const key of Object.keys(env)) {
      if (key.endsWith('_API_KEY') || key.endsWith('_API_TOKEN') || key.endsWith('_API_SECRET')) delete env[key]
    }
    env.DSH_HOME = this.opts.homeDir
    // 官方 session-telemetry 行默认 DISABLED；桌面壳再显式关掉整行（隐私默认关，官方开关语义）。
    env.DSH_TELEMETRY_DISABLED = '1'
    if (this.opts.nodeElectron) env.ELECTRON_RUN_AS_NODE = '1'
    return { ...env, ...this.opts.credentialEnv() }
  }

  private tail(): string {
    return this.logTail.slice(-40).join('\n')
  }

  private rememberLine(line: string): void {
    this.logTail.push(line)
    if (this.logTail.length > 200) this.logTail.shift()
  }

  /** spawn 一次并等到官方 URL 行；boot 即退出 / 超时则 reject。 */
  private spawnOnce(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const spec = this.launchSpec()
      const args = [...spec.nodeArgs, spec.bin, '--profile', this.opts.profileName, '--port', String(this.opts.port)]
      const child = spawn(spec.command, args, {
        cwd: spec.cwd,
        env: this.childEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      this.child = child
      let state: 'starting' | 'ready' | 'failed' | 'stopped' = 'starting'
      let buffer = ''
      const feed = (chunk: string, stream: 'stdout' | 'stderr'): void => {
        if (state === 'failed' || state === 'stopped') return
        buffer += chunk
        let index = buffer.indexOf('\n')
        while (index !== -1) {
          const line = buffer.slice(0, index).replace(/\r$/, '')
          buffer = buffer.slice(index + 1)
          this.opts.log(`[dsh:${stream}] ${line}`)
          this.rememberLine(line)
          const origin = parseWebUrlLine(line)
          if (origin !== null && state === 'starting') {
            state = 'ready'
            this.originValue = origin
            this.respawnBackoffMs = 1000
            resolve(origin)
            return
          }
          index = buffer.indexOf('\n')
        }
      }
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => { feed(chunk, 'stdout') })
      child.stderr.on('data', (chunk: string) => { feed(chunk, 'stderr') })
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
        if (this.closed || state === 'stopped' || state === 'failed') return
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

  private scheduleRespawn(): void {
    if (this.closed || this.respawnTimer !== undefined) return
    const backoff = this.respawnBackoffMs
    this.respawnBackoffMs = Math.min(15_000, this.respawnBackoffMs * 2)
    this.respawnTimer = setTimeout(() => {
      this.respawnTimer = undefined
      void this.spawnOnce().then(
        (origin) => { this.onOrigin?.(origin) },
        (error: unknown) => {
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
    if (this.closed) throw new Error('DshWebRuntime is closed')
    if (this.originValue !== null && this.child !== undefined) return this.originValue
    if (this.startInFlight !== undefined) return this.startInFlight
    const run = async (attempt: number): Promise<string> => {
      await mkdir(this.opts.homeDir, { recursive: true })
      await mkdir(this.opts.workspaceDir, { recursive: true })
      const profileResult = await writeWebProfile(this.opts.homeDir, this.opts.profileName)
      if (profileResult !== 'unchanged') {
        this.opts.log(`[dsh] profile ${this.opts.profileName} ${profileResult === 'created' ? '已写入' : '已修复'}（${this.opts.homeDir}）`)
      }
      try {
        return await this.spawnOnce()
      } catch (error) {
        if (attempt >= 3 || this.closed) throw error
        this.opts.log(`[dsh] 启动失败（第 ${attempt} 次），1s 后重试：${error instanceof Error ? error.message : String(error)}`)
        await delay(1000)
        return run(attempt + 1)
      }
    }
    this.startInFlight = run(1).finally(() => { this.startInFlight = undefined })
    return this.startInFlight
  }

  /** 关运行时子进程（SIGKILL 语义；官方会话 jsonl 逐轮落盘，丢失面小）。幂等、终态。 */
  async close(): Promise<void> {
    this.closed = true
    if (this.respawnTimer !== undefined) {
      clearTimeout(this.respawnTimer)
      this.respawnTimer = undefined
    }
    const child = this.child
    this.child = undefined
    if (child !== undefined) {
      try { child.kill() } catch { /* 子进程已亡 */ }
    }
  }
}
