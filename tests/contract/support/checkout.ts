/**
 * 契约测试公共支撑：DSH pin 校验、checkout 定位、隔离环境、运行目录与渲染。
 *
 * 与 docs/ARCHITECTURE.md 的打包边界对齐：
 *  - 不碰 DSH 源码：本模块只读 checkout 的 package.json / .git / node_modules，测试只 spawn。
 *  - 不碰运行中的 DSH_HOME：子进程 DSH_HOME 一律指向当次运行目录下的隔离 home。
 *  - 凭据绝不带进测试：子进程环境删除 *_API_KEY / *_API_TOKEN / *_API_SECRET。
 */

import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
/** tests/contract/ */
export const contractDir = dirname(here)
/** 仓库根（D:\\MemoWeft\\weftmate）。 */
export const repoRoot = resolve(contractDir, '..', '..')

export interface DshPin {
  repo: string
  packageVersion: string
  commit: string
  commitSubject: string
  recordedAt: string
  notes: string[]
}

/**
 * 默认读取正式 pin；隔离候选可显式给出只读 pin 副本。候选覆盖不修改正式
 * `tests/contract/dsh-pin.json`，因此不能意外把日常 vendor 指到新 generation。
 */
export async function loadPin(): Promise<DshPin> {
  const configured = process.env.WEFTMATE_DSH_PIN_FILE
  const pinPath = configured === undefined || configured === ''
    ? join(contractDir, 'dsh-pin.json')
    : resolve(repoRoot, configured)
  const text = await readFile(pinPath, 'utf8')
  const pin = JSON.parse(text) as DshPin
  if (typeof pin.packageVersion !== 'string' || typeof pin.commit !== 'string' || typeof pin.repo !== 'string') {
    throw new Error(`DSH pin 缺字段（${pinPath}）：${text}`)
  }
  return pin
}

/** checkout 候选：env 覆盖 → 本机惯例 → 仓库兄弟目录。 */
function checkoutCandidates(): string[] {
  const fromEnv = process.env.WEFTMATE_DSH_CHECKOUT
  const candidates = [
    fromEnv === undefined || fromEnv === '' ? undefined : fromEnv,
    'D:/AIProjects/Shared/Dependencies/DeepSeekHarness',
    join(homedir(), 'deepseek-harness'),
    resolve(repoRoot, '..', 'deepseek-harness'),
  ].filter((candidate): candidate is string => candidate !== undefined)
  return candidates
}

/**
 * Resolve a normal checkout `.git` directory or a linked-worktree `.git`
 * pointer.  A worktree keeps HEAD in its private gitdir while refs and packed
 * refs normally live in `commondir`; both locations must be considered.
 */
async function resolveGitLayout(root: string): Promise<{ gitDir: string; commonDir: string } | undefined> {
  const marker = join(root, '.git')
  try {
    const stat = await import('node:fs/promises').then(({ stat }) => stat(marker))
    if (stat.isDirectory()) return { gitDir: marker, commonDir: marker }
    if (!stat.isFile()) return undefined
    const text = (await readFile(marker, 'utf8')).trim()
    const match = /^gitdir:\s*(.+)$/i.exec(text)
    if (match === null) return undefined
    const gitDir = isAbsolute(match[1]) ? match[1] : resolve(dirname(marker), match[1])
    let commonDir = gitDir
    try {
      const declared = (await readFile(join(gitDir, 'commondir'), 'utf8')).trim()
      if (declared !== '') commonDir = isAbsolute(declared) ? declared : resolve(gitDir, declared)
    } catch { /* ordinary linked worktree metadata may omit commondir */ }
    return { gitDir, commonDir }
  } catch {
    return undefined
  }
}

async function readRef(gitDir: string, commonDir: string, ref: string): Promise<string | undefined> {
  for (const base of [gitDir, commonDir]) {
    try {
      const value = (await readFile(join(base, ...ref.split('/')), 'utf8')).trim()
      if (/^[0-9a-f]{40}$/i.test(value)) return value
    } catch { /* try next location */ }
  }
  for (const base of [gitDir, commonDir]) {
    try {
      const value = (await readFile(join(base, 'packed-refs'), 'utf8'))
        .split('\n')
        .filter((line) => !line.startsWith('#') && !line.startsWith('^') && line.endsWith(` ${ref}`))
        .map((line) => line.split(' ')[0])
        .find((hash) => /^[0-9a-f]{40}$/i.test(hash))
      if (value !== undefined) return value
    } catch { /* try next location */ }
  }
  return undefined
}

/** 读取 checkout 的 HEAD commit（含 worktree `.git` pointer；不依赖 git 可执行文件）。 */
export async function readCheckoutHead(root: string): Promise<string | undefined> {
  try {
    const layout = await resolveGitLayout(root)
    if (layout === undefined) return undefined
    const head = (await readFile(join(layout.gitDir, 'HEAD'), 'utf8')).trim()
    if (head.startsWith('ref:')) {
      const ref = head.slice('ref:'.length).trim()
      return readRef(layout.gitDir, layout.commonDir, ref)
    }
    return /^[0-9a-f]{40}$/i.test(head) ? head : undefined
  } catch {
    return undefined
  }
}

/** 定位 DSH checkout 并校验与 pin 一致；失败抛错并给出修复指引。 */
export async function resolveCheckout(pin: DshPin): Promise<string> {
  const candidates = checkoutCandidates()
  const found = candidates.find((candidate) => existsSync(join(candidate, 'package.json')))
  if (found === undefined) {
    throw new Error(
      '找不到 DSH checkout。契约测试需要一个与 pin 一致的 deepseek-harness checkout：\n'
      + `  candidates: ${candidates.join(' | ')}\n`
      + `  获取方式：git clone ${pin.repo} && cd deepseek-harness && git checkout ${pin.commit} && pnpm install\n`
      + '  或用环境变量指定路径：WEFTMATE_DSH_CHECKOUT=D:/path/to/deepseek-harness',
    )
  }

  const rootPkg = JSON.parse(await readFile(join(found, 'package.json'), 'utf8')) as { version?: string }
  if (rootPkg.version !== pin.packageVersion) {
    throw new Error(
      `DSH checkout 版本与 pin 不一致：checkout=${rootPkg.version ?? '?'} pin=${pin.packageVersion}\n`
      + '  M0 纪律：不升级 DSH 版本。升级只由 owner 触发（docs/VENDOR-PACKAGING.md §8），触发后先更新 dsh-pin.json。',
    )
  }

  const head = await readCheckoutHead(found)
  if (head !== pin.commit) {
    throw new Error(
      `DSH checkout commit 与 pin 不一致：checkout=${head ?? '(unknown)'} pin=${pin.commit}\n`
      + `  恢复指引：cd ${found} && git fetch origin master && git checkout ${pin.commit}（或按 dsh-pin.json 重新 clone）\n`
      + '  pin 更新只由 owner 触发：更新 dsh-pin.json → 重跑 npm run test:contract。',
    )
  }

  if (!existsSync(join(found, 'node_modules', 'tsx'))) {
    throw new Error(`DSH checkout 缺少依赖（node_modules/tsx 不存在）：cd ${found} && pnpm install`)
  }
  return found
}

/**
 * M5-02：契约测试的运行时根——vendor 形态（WEFTMATE_DSH_RUNTIME 指向 vendor/dsh-runtime）时
 * 不需要本机 checkout，pin 一致性改由 VENDOR-MANIFEST.json 校验（CI 干净克隆场景；版本/commit
 * 不符即失败，先重跑 npm run vendor:dsh）。未设该环境变量时走 checkout 形态（开发机）。
 */
export async function resolveRuntimeRoot(pin: DshPin): Promise<string> {
  const vendorRoot = process.env.WEFTMATE_DSH_RUNTIME
  if (vendorRoot !== undefined && vendorRoot !== '') {
    const manifestPath = join(vendorRoot, 'VENDOR-MANIFEST.json')
    if (!existsSync(manifestPath)) {
      throw new Error(`WEFTMATE_DSH_RUNTIME 指向的目录缺 VENDOR-MANIFEST.json：${vendorRoot}（先跑 npm run vendor:dsh 生成）`)
    }
    let manifest: { dsh?: { packageVersion?: unknown; commit?: unknown } } | null = null
    try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) } catch { /* 坏 manifest 走下方一致报错 */ }
    if (manifest?.dsh?.packageVersion !== pin.packageVersion || manifest?.dsh?.commit !== pin.commit) {
      throw new Error(
        `vendor 运行时与 pin 不一致：vendor=${JSON.stringify(manifest?.dsh ?? null)} pin=${pin.packageVersion}@${pin.commit}\n`
        + '  恢复指引：npm run vendor:dsh 重新生成（升级 DSH 只由 owner 触发，见 docs/VENDOR-PACKAGING.md §8）。',
      )
    }
    return vendorRoot
  }
  return resolveCheckout(pin)
}

/** 子进程隔离环境：无凭据、DSH_HOME 指向隔离目录（不碰运行中的 DSH_HOME）。 */
export function isolatedEnv(isolatedHome: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of Object.keys(env)) {
    if (
      key.endsWith('_API_KEY')
      || key.endsWith('_API_TOKEN')
      || key.endsWith('_API_SECRET')
      || key === 'DEEPSEEK_API_KEY'
      || key === 'PI_AI_API_KEY'
    ) {
      delete env[key]
    }
  }
  env.DSH_HOME = isolatedHome
  return env
}

export interface RunDir {
  /** 当次运行目录（含 sessions/、home/、渲染后的配置与插件）。 */
  dir: string
  /**
   * 渲染 fixtures/ 下模板并写入运行目录；返回绝对路径。
   * @param templateRel 模板相对 fixtures/ 的路径
   * @param vars __占位符__ → 值
   * @param targetName 写入运行目录的文件名（缺省 = templateRel 原样，如探针 C 需改名 memoweft-plugin.ts）
   */
  render: (templateRel: string, vars?: Record<string, string>, targetName?: string) => Promise<string>
  /** 尽力清理（Windows 文件锁可能残留，失败不致命）。 */
  cleanup: () => Promise<void>
}

/** 建当次运行目录（os.tmpdir 下，不进仓库）。 */
export async function setupRunDir(): Promise<RunDir> {
  const dir = await mkdtemp(join(tmpdir(), 'weftmate-dsh-contract-'))
  await mkdir(join(dir, 'sessions'), { recursive: true })
  await mkdir(join(dir, 'home'), { recursive: true })

  const forward = (path: string): string => path.replaceAll('\\', '/')

  async function render(templateRel: string, vars: Record<string, string> = {}, targetName?: string): Promise<string> {
    let text = await readFile(join(contractDir, 'fixtures', templateRel), 'utf8')
    for (const [key, value] of Object.entries(vars)) text = text.replaceAll(key, value)
    const target = join(dir, targetName ?? templateRel)
    await writeFile(target, text, 'utf8')
    return target
  }

  return {
    dir,
    render,
    async cleanup() {
      try {
        await rm(dir, { recursive: true, force: true })
      } catch {
        // 子进程残留句柄（Windows）→ 残留于 tmpdir，不影响仓库与后续运行。
      }
    },
  }
}

export interface ChildResult {
  code: number | null
  stdout: string
  stderr: string
  /** true = 超时被测试杀掉。 */
  timedOut: boolean
  spawnError?: string
}

export interface SpawnSpec {
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
  /** 收到 stdout/stderr 中的标记后关闭 stdin（探针 C 的「boot 完成 → stdin EOF → 干净 dispose」）。 */
  endStdinOnMarker?: RegExp
}

/**
 * POSIX timeout 后的第二道终止围栏。Windows 不走这里：它必须先以根 PID 做 taskkill /T /F，
 * 否则单杀 root 后，继承 stdout/stderr pipe 的 descendant 可能令 close 永久不来。
 */
function hardKillPosixChild(child: ReturnType<typeof spawn>): void {
  try {
    child.kill('SIGKILL')
  } catch {
    // close/error 监听仍负责结算；不可因 cleanup 失败吞掉测试输出。
  }
}

/**
 * spawn 一个 node 子进程并收集完整输出；支持「标记到达后关 stdin」。
 * 超时先请求终止、再由有界 watchdog 强制终止；无论哪个路径，最终只在 child close 后结算。
 */
export function runNode(spec: SpawnSpec): Promise<ChildResult> {
  return new Promise((resolve) => {
    const child = spawn('node', spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let markerSeen = false
    let settled = false
    let timedOut = false
    let stdinEndTimer: NodeJS.Timeout | undefined
    let timeoutTimer: NodeJS.Timeout | undefined
    let hardKillTimer: NodeJS.Timeout | undefined
    let taskkillCallbackSeen = false
    // spawn 成功后立即固定本次 root PID；Windows watchdog 绝不做名称/模糊 PID 匹配。
    const rootPid = child.pid

    const clearTimers = (): void => {
      if (stdinEndTimer !== undefined) clearTimeout(stdinEndTimer)
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer)
      if (hardKillTimer !== undefined) clearTimeout(hardKillTimer)
    }

    const finish = (result: ChildResult): void => {
      if (settled) return
      settled = true
      clearTimers()
      resolve(result)
    }

    const endStdinAfterMarker = (): void => {
      // 给 roundtrip 后的收尾留一拍，再 EOF stdin → runner disposeAndExit(0)。
      stdinEndTimer = setTimeout(() => {
        if (!settled && !child.stdin.destroyed) child.stdin.end()
      }, 250)
    }

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      if (spec.endStdinOnMarker !== undefined && !markerSeen && spec.endStdinOnMarker.test(stdout + stderr)) {
        markerSeen = true
        endStdinAfterMarker()
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
      if (spec.endStdinOnMarker !== undefined && !markerSeen && spec.endStdinOnMarker.test(stdout + stderr)) {
        markerSeen = true
        endStdinAfterMarker()
      }
    })

    timeoutTimer = setTimeout(() => {
      timedOut = true
      if (process.platform === 'win32' && rootPid !== undefined && rootPid > 0) {
        // 先收整棵树，不能先 child.kill()：root 消失后 descendant 继承的 pipe 会拖住 close。
        execFile('taskkill', ['/PID', String(rootPid), '/T', '/F'], { windowsHide: true }, (error) => {
          taskkillCallbackSeen = true
          // taskkill 启动/执行失败时才回退到精确的 child handle；仍由 close 结算。
          if (error !== null && !settled) {
            try { child.kill() } catch { /* close/error 监听保留诊断 */ }
          }
        })
      } else {
        try {
          child.kill()
        } catch {
          // 仍启动 watchdog；close 是唯一结算点。
        }
      }
      hardKillTimer = setTimeout(() => {
        if (settled) return
        if (process.platform === 'win32') {
          // taskkill callback 迟迟不回时，精确 child handle 是最后兜底；不按名称/PID 模糊匹配。
          if (!taskkillCallbackSeen) {
            try { child.kill() } catch { /* close/error 监听保留诊断 */ }
          }
          return
        }
        hardKillPosixChild(child)
      }, 5_000)
    }, spec.timeoutMs)

    child.on('error', (error) => {
      if (!timedOut) finish({ code: null, stdout, stderr, timedOut: false, spawnError: error.message })
    })
    child.on('close', (code) => {
      finish(timedOut
        ? { code: null, stdout, stderr, timedOut: true }
        : { code, stdout, stderr, timedOut: false })
    })
  })
}

/** 递归找 sessions 根下属于某 sessionId 的 session.jsonl.zstd（会话落盘证据）。 */
export async function findSessionArchive(sessionsRoot: string, sessionId: string): Promise<string | undefined> {
  const entries = await readdirRecursive(sessionsRoot)
  return entries.find((path) => path.includes(sessionId) && path.endsWith('session.jsonl.zstd'))
}

async function readdirRecursive(root: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises')
  const entries = await readdir(root, { withFileTypes: true })
  const found: string[] = []
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) found.push(...await readdirRecursive(path))
    else found.push(path)
  }
  return found
}

export type RuntimeMode = 'checkout' | 'vendor'

/** 一次契约运行的运行时来源规格（SDK 入口、运行时 bin、fixture 启动参数）。 */
export interface RuntimeSpec {
  mode: RuntimeMode
  /** SDK 客户端入口（file URL）。 */
  sdkUrl: string
  /** 运行时 bin 的 node 参数（不含 cordis.yml 路径）。 */
  binArgs: string[]
  /** 运行时子进程 cwd。 */
  launchCwd: string
  /** 运行 fixture 时 node 的额外参数（checkout 模式需要 tsx）。 */
  fixtureArgs: string[]
  /** 运行 fixture 的 cwd（tsx 从该目录解析）。 */
  fixtureCwd: string
}

/**
 * 运行时来源：环境变量 WEFTMATE_DSH_RUNTIME 指向 vendor/dsh-runtime 时用 vendored 编译产物
 * （发货验证），否则用 checkout 源码形态（开发验证）。同一套断言锁两种形态（docs/VENDOR-PACKAGING.md §2 D5）。
 */
export function runtimeSpec(checkout: string): RuntimeSpec {
  const vendorRoot = process.env.WEFTMATE_DSH_RUNTIME
  if (vendorRoot !== undefined && vendorRoot !== '') {
    const forward = vendorRoot.replaceAll('\\', '/')
    return {
      mode: 'vendor',
      sdkUrl: `file:///${forward}/node_modules/@deepseek-ai/dsh-sdk-client/lib/index.js`,
      binArgs: [join(vendorRoot, 'node_modules', '@deepseek-ai', 'dsh-sdk-jsonrpc-demo', 'lib', 'packaged-bin.js')],
      launchCwd: vendorRoot,
      fixtureArgs: [],
      fixtureCwd: vendorRoot,
    }
  }
  const forward = checkout.replaceAll('\\', '/')
  return {
    mode: 'checkout',
    sdkUrl: `file:///${forward}/packages/sdk/client/src/index.ts`,
    binArgs: ['--import', 'tsx/esm', join(checkout, 'packages', 'examples', 'jsonrpc-demo', 'src', 'bin.ts')],
    launchCwd: checkout,
    fixtureArgs: ['--import', 'tsx/esm'],
    fixtureCwd: checkout,
  }
}
