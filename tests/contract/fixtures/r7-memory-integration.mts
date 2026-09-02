// WeftMate R7「记忆插件集成」fixture（checkout 形态）：
// in-process boot 官方 web 组合 + weftmate 补丁层（宿主/记忆/客户端行）→
// 真实 session.append 构造一轮对话与 compaction/start+summary+end 事件 →
// 真实 weftmate-memory 插件 → 真实 stdio 桥（MEMOWEFT_TEST_MODEL_RESPONSE=__smart__ 自适应解释）→
// Job applied → /weftmate/memory/world.json 浏览到 cognition → search.json 确定性召回命中。
// 证据打印器：`[r7-memory] EVIDENCE <json>`；失败 `[r7-memory] REJECT <json>`。

import { mkdtemp, mkdir, rm, writeFile, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const checkout = process.env.WEFTMATE_CHECKOUT
if (checkout === undefined || checkout === '') {
  console.error('[r7-memory] FAIL fixture requires WEFTMATE_CHECKOUT')
  process.exit(2)
}
const here = dirname(fileURLToPath(import.meta.url))
const toUrl = (absolutePath: string): string => pathToFileURL(absolutePath).href

const { Context } = await import(toUrl(join(checkout, 'vendor/cordis/src/index.ts')))
const { default: Loader } = await import(toUrl(join(checkout, 'vendor/loader/src/index.ts')))
const { default: Include } = await import(toUrl(join(checkout, 'vendor/include/src/index.ts')))
const { default: Group } = await import(toUrl(join(checkout, 'vendor/group/src/index.ts')))
const { assertEntriesLoaded, healProfilesModuleFallback, loadOverlayPatches } = await import(
  toUrl(join(checkout, 'packages/boot/app-boot/src/index.ts')),
)
const { dshHomePath } = await import(toUrl(join(checkout, 'packages/util/home-paths/src/index.ts')))
const { provideCmdline } = await import(toUrl(join(checkout, 'packages/boot/cmdline/src/index.ts')))
const { InProcessApiClient, toFetchHandler } = await import(
  toUrl(join(checkout, 'packages/host/apiproxy/src/index.ts')),
)
const { createUserMessage, createAssistantMessage } = await import(toUrl(join(checkout, 'packages/llm/llm/src/index.ts')))

const INSTALL_ANCHOR = join(checkout, 'apps/cli/package.json')
const SHIPPED_PRESET_DIR = join(checkout, 'apps/cli/config/agent-presets')
const BASE_PATCH_PATH = join(checkout, 'packages/bundle/base/cordis.patch.yml')
const WEB_PATCH_PATH = join(checkout, 'packages/bundle/web-app/cordis.patch.yml')
const WEFTMATE_SRC = join(here, '..', '..', '..', 'src')

// 与 PROFILE_PATCH_TEMPLATE（src/dsh-web-runtime.ts）同构的 JS 补丁数组。
const weftmatePatches = [
  {
    insert: [
      { id: 'weftmate-host', name: './plugins/weftmate-host.mjs' },
      { id: 'weftmate-memory', name: './plugins/weftmate-memory.mjs' },
      { id: '@weftmate/client', name: '@weftmate/client' },
    ],
  },
  { id: 'directory-picker', disabled: true },
  {
    insert: [
      { id: 'directory-picker-browse', name: '@deepseek-ai/dsh-host-directory-picker-browse' },
      { id: 'ui-directory-picker-browse', name: '@deepseek-ai/dsh-client-ui-directory-picker-browse' },
    ],
  },
]

const workspaceCwd = await mkdtemp(join(tmpdir(), 'weftmate-r7-memory-ws-'))
const harnessHome = join(workspaceCwd, '.dsh-home')
process.env.DSH_HOME = harnessHome
process.env.DSH_AGENTS_HOME = join(workspaceCwd, '.agents-home')
process.env.DSH_BUNDLED_SKILL_DIR = join(workspaceCwd, '.bundled-skills')
process.env.DSH_PERMISSION_MODE = 'danger-full-access'

const originalCwd = process.cwd()
const ctx = new Context()
try {
  process.chdir(workspaceCwd)
  const basePatches = loadOverlayPatches('weftmate r7-memory', BASE_PATCH_PATH)
  const surfacePatches = loadOverlayPatches('weftmate r7-memory', WEB_PATCH_PATH)
  const patches = [
    ...basePatches,
    ...surfacePatches,
    ...weftmatePatches,
    { id: 'agent-presets', config: { default: 'standard', roots: [{ path: SHIPPED_PRESET_DIR, trust: 'system' }], includeUserRoot: false } },
    { id: 'session-persistence-jsonl', config: { root: join(workspaceCwd, '.sessions') } },
    { id: 'storage-json', config: { root: join(workspaceCwd, '.dsh-storages') } },
    {
      id: 'skill-filesystem',
      config: {
        dshHome: harnessHome,
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
  const rootConfig = join(profileDir, 'cordis.yml')
  await writeFile(rootConfig, '[]\n')
  // 复制 weftmate 插件资产（同 writePluginAssets 落位语义）。
  await mkdir(join(profileDir, 'plugins'), { recursive: true })
  await cp(join(WEFTMATE_SRC, 'plugins', 'weftmate-host.mjs'), join(profileDir, 'plugins', 'weftmate-host.mjs'))
  await cp(join(WEFTMATE_SRC, 'plugins', 'weftmate-memory.mjs'), join(profileDir, 'plugins', 'weftmate-memory.mjs'))
  // P1-02：宿主插件相对 import ../runtime/gateway → 同形复制 gateway 运行时（index + legacy/*.mjs）。
  await mkdir(join(profileDir, 'runtime', 'gateway'), { recursive: true })
  await cp(join(WEFTMATE_SRC, 'runtime', 'gateway', 'index.mjs'), join(profileDir, 'runtime', 'gateway', 'index.mjs'))
  await cp(join(WEFTMATE_SRC, 'runtime', 'gateway', 'legacy'), join(profileDir, 'runtime', 'gateway', 'legacy'), { recursive: true })
  // P1-03：同形 staging 新 Gateway/adapter graph，避免 fixture 的 profile 运行时漏模块。
  await cp(join(WEFTMATE_SRC, 'runtime', 'gateway', 'routes'), join(profileDir, 'runtime', 'gateway', 'routes'), { recursive: true })
  await cp(join(WEFTMATE_SRC, 'runtime', 'gateway', 'event-stream'), join(profileDir, 'runtime', 'gateway', 'event-stream'), { recursive: true })
  await cp(join(WEFTMATE_SRC, 'runtime', 'gateway', 'errors'), join(profileDir, 'runtime', 'gateway', 'errors'), { recursive: true })
  await cp(join(WEFTMATE_SRC, 'runtime', 'dsh-adapter'), join(profileDir, 'runtime', 'dsh-adapter'), { recursive: true })
  await mkdir(join(profileDir, 'node_modules', '@weftmate', 'client'), { recursive: true })
  for (const file of ['package.json', 'index.js', 'client.js']) {
    await cp(join(WEFTMATE_SRC, 'plugins', 'weftmate-client', file), join(profileDir, 'node_modules', '@weftmate', 'client', file))
  }

  ctx.baseUrl = pathToFileURL(profileDir).href + '/'
  ctx.provide('dshHomePath', dshHomePath)
  provideCmdline(ctx, {
    args: [],
    exit: (code: number) => {
      throw new Error(`weftmate r7-memory: web app requested exit ${String(code)} with no arguments to reject`)
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
  assertEntriesLoaded(ctx, 'weftmate r7-memory')

  const apiProxy = ctx.get('apiProxy')
  if (apiProxy === undefined) throw new Error('apiProxy 服务在 boot 后缺失')
  const client = new InProcessApiClient(toFetchHandler(apiProxy))

  const createRes = await client.sessions.create({})
  if (!createRes.result.ok) throw new Error(`session.create failed: ${JSON.stringify(createRes.result)}`)
  const sessionId: string = createRes.result.value.sessionId
  const session = ctx.sessions.get(sessionId)
  if (session === undefined) throw new Error(`会话未在 store 中：${sessionId}`)

  // 构造一轮对话（逐字 user Evidence + assistant 仅上下文；surfaceOp 对齐官方 append 合同）。
  session.append('turn/start', { turn: 1 })
  const user1 = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: '我喜欢喝茉莉花茶' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('step/start', { turn: 1, step: 1 })
  const assistant1 = session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text: '好的，记下了。' }],
      source: { provider: 'mock', model: 'mock' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  const user2 = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: '今天天气不错' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const shadowedSeqs = [user1.seq, assistant1.seq, user2.seq]

  // 模拟官方 compaction 事件序列（A+B 事件源）。
  const compactionId = `c-${Date.now().toString(16)}`
  session.append('compaction/start', { compactionId, turn: null })
  session.append('compaction/summary', {
    compactionId,
    summary: [{ type: 'text', text: '[压缩摘要]' }],
    shadowedRange: { start: user1.seq, end: user2.seq },
    shadowedSeqs,
    shadowedTokenCount: 0,
    provider: 'mock',
    model: 'mock',
  })
  session.append('compaction/end', { compactionId, turn: null })

  // 轮询管理面（真实插件 → 真实桥 → applied → 浏览/搜索命中）。
  const port = ctx.get('webServer')?.port
  if (typeof port !== 'number') throw new Error('webserver 端口不可用')
  const worldUrl = `http://127.0.0.1:${port}/weftmate/memory/world.json`
  let world = null
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(worldUrl)
      if (res.ok) {
        world = await res.json()
        if (Array.isArray(world?.cognitions) && world.cognitions.length >= 1) break
      }
    } catch { /* 桥尚未就绪，重试 */ }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  const searchRes = await fetch(`http://127.0.0.1:${port}/weftmate/memory/search.json?q=${encodeURIComponent('茉莉花茶')}`)
  const search = searchRes.ok ? await searchRes.json() : null
  const negativeRes = await fetch(`http://127.0.0.1:${port}/weftmate/memory/search.json?q=${encodeURIComponent('我开的什么车')}`)
  const negative = negativeRes.ok ? await negativeRes.json() : null

  const evidence = {
    cognitions: Array.isArray(world?.cognitions) ? world.cognitions : null,
    searchHit: typeof search?.count === 'number' ? search.count : null,
    searchText: typeof search?.text === 'string' ? search.text : null,
    negativeCount: typeof negative?.count === 'number' ? negative.count : null,
  }
  await ctx.fiber.dispose()
  await rm(workspaceCwd, { recursive: true, force: true }).catch(() => undefined)
  console.log('[r7-memory] EVIDENCE ' + JSON.stringify(evidence))
  process.exitCode = 0
} catch (error) {
  try { await ctx.fiber.dispose() } catch { /* boot 失败不掩盖原始错误 */ }
  await rm(workspaceCwd, { recursive: true, force: true }).catch(() => undefined)
  console.log('[r7-memory] REJECT ' + JSON.stringify({
    name: (error as Error | null)?.name ?? null,
    message: error instanceof Error ? error.message : String(error),
  }))
  process.exitCode = 1
} finally {
  if (process.cwd() !== originalCwd) process.chdir(originalCwd)
}
