// WeftMate-DSH 契约 R2-03「mock LLM 链路契约测试」fixture（checkout 形态）。
//
// 在 Node 测试进程里 in-process boot 官方 web 组合（dsh-base + dsh-web-app 两层
// bundle patch，照 apps/web/tests/scaffold.ts 的 launchWebScaffold），用
// InProcessApiClient + toFetchHandler(ctx.apiProxy) 驱动同一套 RPC 契约
// （session.create / session.prompt / events.mux 订阅），以 dsh-llm-replay 注入
// 无凭据 mock LLM（一回合 = 读工具调用 + 助手文本），随后断言事件形状、会话
// session.jsonl.zstd 落盘、replay 全量消费与干净 dispose。
//
// 只读 checkout（WEFTMATE_CHECKOUT）；fixture 内 import checkout 包走 tsx。
// 证据打印器：`[p1-03-b] EVIDENCE <json>`，失败 `[p1-03-b] REJECT <json>`。

import { mkdtemp, mkdir, readdir, rm, writeFile, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const checkout = process.env.WEFTMATE_CHECKOUT
if (checkout === undefined || checkout === '') {
  console.error('[web-chat] FAIL fixture requires WEFTMATE_CHECKOUT (checkout 路径)')
  process.exit(2)
}

const here = dirname(fileURLToPath(import.meta.url))
const toUrl = (absolutePath: string): string => pathToFileURL(absolutePath).href

// ── checkout 包（走 tsx 源码入口；传递 import 经各包自身 node_modules 解析）────
const { Context } = await import(toUrl(join(checkout, 'vendor/cordis/src/index.ts')))
const { default: Loader } = await import(toUrl(join(checkout, 'vendor/loader/src/index.ts')))
const { default: Include } = await import(toUrl(join(checkout, 'vendor/include/src/index.ts')))
const { default: Group } = await import(toUrl(join(checkout, 'vendor/group/src/index.ts')))
const { assertEntriesLoaded, healProfilesModuleFallback, loadOverlayPatches } = await import(
  toUrl(join(checkout, 'packages/boot/app-boot/src/index.ts')),
)
const { dshHomePath } = await import(toUrl(join(checkout, 'packages/util/home-paths/src/index.ts')))
const { provideCmdline } = await import(toUrl(join(checkout, 'packages/boot/cmdline/src/index.ts')))
const { installLlmReplay } = await import(toUrl(join(checkout, 'packages/test-support/llm-replay/src/index.ts')))
const { InProcessApiClient, toFetchHandler } = await import(
  toUrl(join(checkout, 'packages/host/apiproxy/src/index.ts')),
)

// ── 与 scaffold.ts 相同的组合事实 ───────────────────────────────────────────────
const INSTALL_ANCHOR = join(checkout, 'apps/cli/package.json')
const SHIPPED_PRESET_DIR = join(checkout, 'apps/cli/config/agent-presets')
const BASE_PATCH_PATH = join(checkout, 'packages/bundle/base/cordis.patch.yml')
const WEB_PATCH_PATH = join(checkout, 'packages/bundle/web-app/cordis.patch.yml')
const REPLAY_FIXTURE = join(here, 'web-chat-replay.jsonl')
const WEFTMATE_SRC = join(here, '..', '..', '..', 'src')
const NOTE_FILE_NAME = 'weftmate-note.txt'
const NOTE_CONTENT = 'hello-weftmate-note'
const REPLAY_PROVIDERS = [{
  id: 'deepseek-official',
  name: 'DeepSeek',
  models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', contextWindow: 128_000 }],
}]

/** 递归收集某目录下所有文件路径（参照 tests/contract/support/checkout.ts 的 findSessionArchive 模式）。 */
async function readdirRecursive(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const found: string[] = []
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) found.push(...await readdirRecursive(path))
    else found.push(path)
  }
  return found
}

/** 从 content block 数组里抽取全部 text 叶文本（含 tool-result 内层）。 */
function collectTextLeaves(blocks: unknown): string[] {
  if (typeof blocks === 'string') return [blocks]
  if (!Array.isArray(blocks)) return []
  const out: string[] = []
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') continue
    const record = block as Record<string, unknown>
    if (record.type === 'text' && typeof record.text === 'string') out.push(record.text)
    if (Array.isArray(record.content)) out.push(...collectTextLeaves(record.content))
  }
  return out
}

/** 打开 mux 流、建会话、发消息，收集本会话事件直到 turn/end。 */
async function driveTurn(client: any, promptText: string, timeoutMs: number): Promise<{
  sessionId: string
  events: any[]
}> {
  const createRes = await client.sessions.create({})
  if (!createRes.result.ok) {
    throw new Error(`session.create failed: ${JSON.stringify(createRes.result)}`)
  }
  const sessionId: string = createRes.result.value.sessionId

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  const events: any[] = []
  try {
    // 先建会话再开流：mux() 同步推 session/subscribed 基线并注册 session/event 监听。
    // 首个 next() 既证明订阅已生效，也消费了基线帧——之后才发消息，事件零丢失。
    const iterator = client.events.mux({}, ac.signal)[Symbol.asyncIterator]()
    await iterator.next()

    const promptRes = await client.sessions.prompt({
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: promptText }],
    })
    if (!promptRes.result.ok) {
      throw new Error(`session.prompt failed: ${JSON.stringify(promptRes.result)}`)
    }

    while (true) {
      const { value, done } = await iterator.next()
      if (done) break
      const frame = value.payload
      if (frame.type === 'session/event' && frame.sessionId === sessionId) {
        events.push(frame.event)
        if (frame.event.type === 'turn/end') break
      }
    }
  } finally {
    clearTimeout(timer)
    ac.abort()
  }

  if (!events.some((event) => event.type === 'turn/end')) {
    throw new Error(`未在 ${timeoutMs}ms 内收到 turn/end（已收 ${events.length} 个事件）`)
  }
  return { sessionId, events }
}

// ── 落盘前临时世界 ─────────────────────────────────────────────────────────────
const workspaceCwd = await mkdtemp(join(tmpdir(), 'weftmate-web-chat-ws-'))
const harnessHome = join(workspaceCwd, '.dsh-home')
const persistenceRoot = await mkdtemp(join(tmpdir(), 'weftmate-web-chat-sessions-'))
const notePath = join(workspaceCwd, NOTE_FILE_NAME)
await writeFile(notePath, NOTE_CONTENT, 'utf8')

// boot 前进程 env（scaffold.ts 335-339、352 + 权限模式）
process.env.DSH_HOME = harnessHome
process.env.DSH_AGENTS_HOME = join(workspaceCwd, '.agents-home')
process.env.DSH_BUNDLED_SKILL_DIR = join(workspaceCwd, '.bundled-skills')
process.env.DSH_PERMISSION_MODE = 'danger-full-access'

const originalCwd = process.cwd()
const ctx = new Context()
let replayHandle: { assertConsumed(): void } | undefined

try {
  process.chdir(workspaceCwd)
  const basePatches = loadOverlayPatches('weftmate web-chat contract', BASE_PATCH_PATH)
  const surfacePatches = loadOverlayPatches('weftmate web-chat contract', WEB_PATCH_PATH)
  const patches = [
    ...basePatches,
    ...surfacePatches,
    { insert: [{ id: 'weftmate-host', name: './plugins/weftmate-host.mjs' }] },
    { id: 'agent-presets', config: { default: 'standard', roots: [{ path: SHIPPED_PRESET_DIR, trust: 'system' }], includeUserRoot: false } },
    { id: 'session-persistence-jsonl', config: { root: persistenceRoot } },
    { id: 'storage-json', config: { root: join(workspaceCwd, '.dsh-storages') } },
    {
      id: 'skill-filesystem',
      config: {
        dshHome: join(workspaceCwd, '.dsh-home'),
        agentsHome: join(workspaceCwd, '.agents-home'),
        bundledSkillDir: join(workspaceCwd, '.bundled-skills'),
        watch: false,
      },
    },
    { id: 'agent-instructions', disabled: true },
    { id: 'session-title-llm', disabled: true },
    { id: 'session-telemetry-otel', disabled: true },
    { id: 'webserver', config: { host: '127.0.0.1', port: 0 } },
    { id: 'web-runtime', config: { printUrl: false, surfaceContext: true } },
    { id: 'settings', config: { dshHome: harnessHome } },
    { id: 'credentials', config: { dshHome: harnessHome } },
    { id: 'llm-deepseek', disabled: true },
  ]

  healProfilesModuleFallback(INSTALL_ANCHOR, harnessHome)
  const profileDir = join(harnessHome, 'profiles', 'scaffold')
  await mkdir(profileDir, { recursive: true })
  await mkdir(join(profileDir, 'plugins'), { recursive: true })
  await mkdir(join(profileDir, 'runtime'), { recursive: true })
  await cp(join(WEFTMATE_SRC, 'plugins', 'weftmate-host.mjs'), join(profileDir, 'plugins', 'weftmate-host.mjs'))
  await cp(join(WEFTMATE_SRC, 'runtime', 'gateway'), join(profileDir, 'runtime', 'gateway'), { recursive: true })
  await cp(join(WEFTMATE_SRC, 'runtime', 'dsh-adapter'), join(profileDir, 'runtime', 'dsh-adapter'), { recursive: true })
  const rootConfig = join(profileDir, 'cordis.yml')
  await writeFile(rootConfig, '[]\n')
  ctx.baseUrl = pathToFileURL(profileDir).href + '/'
  ctx.provide('dshHomePath', dshHomePath)
  provideCmdline(ctx, {
    args: [],
    exit: (code: number) => {
      throw new Error(`weftmate web-chat contract: web app requested exit ${String(code)} with no arguments to reject`)
    },
  })
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.builtins.group = Group
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(rootConfig).href, patches },
  })
  await ctx.loader.await()
  assertEntriesLoaded(ctx, 'weftmate web-chat contract')

  replayHandle = installLlmReplay(ctx, { file: REPLAY_FIXTURE, providers: REPLAY_PROVIDERS })

  const apiProxy = ctx.get('apiProxy')
  if (apiProxy === undefined) throw new Error('apiProxy 服务在 boot 后缺失')

  const client = new InProcessApiClient(toFetchHandler(apiProxy))
  const { sessionId, events } = await driveTurn(client, '读一下文件 weftmate-note.txt', 60_000)

  // 落盘：显式 flush 后递归找 session.jsonl.zstd。
  const session = ctx.sessions.get(sessionId)
  if (session === undefined) throw new Error(`会话未在 store 中：${sessionId}`)
  await ctx.sessions.flush(session)
  const archive = (await readdirRecursive(persistenceRoot)).find(
    (path) => path.endsWith('session.jsonl.zstd'),
  )

  // replay 全量消费（一个回合 = 两次模型调用：读工具 + 助手文本）。
  replayHandle.assertConsumed()

  const eventTypes = events.map((event) => event.type)
  const toolCalls = events
    .filter((event) => event.type === 'tool/call')
    .map((event) => ({ name: event.data.name, arguments: event.data.arguments }))
  const toolResultTexts = events
    .filter((event) => event.type === 'tool/result')
    .flatMap((event) => collectTextLeaves(event.data.message?.content ?? []))
  const assistantTexts = events
    .filter((event) => event.type === 'assistant/message')
    .flatMap((event) => collectTextLeaves(event.data.message?.content ?? []))
  const turnEnd = events.find((event) => event.type === 'turn/end')
  const webServerPort = ctx.get('webServer')?.port ?? null

  const evidence = {
    booted: true,
    webServerPort,
    sessionId,
    eventTypes,
    toolCalls,
    toolResultTexts,
    assistantTexts,
    turnEndReason: turnEnd?.data?.reason?.kind ?? null,
    archiveExists: archive !== undefined,
    archivePath: archive ?? null,
    replayConsumed: true,
  }

  await ctx.fiber.dispose()
  await rm(workspaceCwd, { recursive: true, force: true }).catch(() => undefined)
  await rm(persistenceRoot, { recursive: true, force: true }).catch(() => undefined)
  console.log('[p1-03-b] EVIDENCE ' + JSON.stringify(evidence))
  process.exit(0)
} catch (error) {
  try {
    await ctx.fiber.dispose()
  } catch {
    // 已 boot 失败，dispose 失败不掩盖原始错误。
  }
  try {
    await rm(workspaceCwd, { recursive: true, force: true })
    await rm(persistenceRoot, { recursive: true, force: true })
  } catch {
    // Windows 文件锁残留，尽力清理。
  }
  console.log('[p1-03-b] REJECT ' + JSON.stringify({
    name: (error as Error | null)?.name ?? null,
    message: error instanceof Error ? error.message : String(error),
  }))
  process.exit(1)
} finally {
  if (process.cwd() !== originalCwd) process.chdir(originalCwd)
}
