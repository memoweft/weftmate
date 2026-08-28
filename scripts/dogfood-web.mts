// 开发者 dogfood：以契约同款组合事实起持久真机（官方 DSH Web UI + WeftMate Gateway）。
// 用法：WEFTMATE_CHECKOUT=<checkout> node --import tsx/esm scripts/dogfood-web.mts [port]
// 无凭据 —— LLM 走 llm-replay mock（web-chat-replay.jsonl，一回合演示）。
import { mkdtemp, mkdir, rm, writeFile, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const checkout = process.env.WEFTMATE_CHECKOUT
if (checkout === undefined || checkout === '') {
  console.error('[dogfood] 需要 WEFTMATE_CHECKOUT')
  process.exit(2)
}
const PORT = Number(process.argv[2] ?? 3210)
const here = dirname(fileURLToPath(import.meta.url))
const toUrl = (p: string) => pathToFileURL(p).href

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

const WEFTMATE_SRC = join(here, '..', 'src')
const workspaceCwd = await mkdtemp(join(tmpdir(), 'weftmate-dogfood-'))
const harnessHome = join(workspaceCwd, '.dsh-home')
const persistenceRoot = join(workspaceCwd, 'sessions')
await mkdir(persistenceRoot, { recursive: true }).catch(async () => {
  // mkdir 在 boot 前调用即可；此处兜底保证目录存在。
  await mkdir(persistenceRoot, { recursive: true })
})
process.env.DSH_HOME = harnessHome
process.env.DSH_AGENTS_HOME = join(workspaceCwd, '.agents-home')
process.env.DSH_BUNDLED_SKILL_DIR = join(workspaceCwd, '.bundled-skills')
process.env.DSH_PERMISSION_MODE = 'danger-full-access'

const ctx = new Context()
try {
  process.chdir(workspaceCwd)
  const patches = [
    ...loadOverlayPatches('weftmate dogfood', join(checkout, 'packages/bundle/base/cordis.patch.yml')),
    ...loadOverlayPatches('weftmate dogfood', join(checkout, 'packages/bundle/web-app/cordis.patch.yml')),
    { insert: [{ id: 'weftmate-host', name: './plugins/weftmate-host.mjs' }] },
    { id: 'agent-presets', config: { default: 'standard', roots: [{ path: join(checkout, 'apps/cli/config/agent-presets'), trust: 'system' }], includeUserRoot: false } },
    { id: 'session-persistence-jsonl', config: { root: persistenceRoot } },
    { id: 'storage-json', config: { root: join(workspaceCwd, '.dsh-storages') } },
    {
      id: 'skill-filesystem',
      config: { dshHome: harnessHome, agentsHome: join(workspaceCwd, '.agents-home'), bundledSkillDir: join(workspaceCwd, '.bundled-skills'), watch: false },
    },
    { id: 'agent-instructions', disabled: true },
    { id: 'session-title-llm', disabled: true },
    { id: 'session-telemetry-otel', disabled: true },
    { id: 'webserver', config: { host: '127.0.0.1', port: PORT } },
    { id: 'web-runtime', config: { printUrl: false, surfaceContext: true } },
    { id: 'settings', config: { dshHome: harnessHome } },
    { id: 'credentials', config: { dshHome: harnessHome } },
    { id: 'llm-deepseek', disabled: true },
  ]
  healProfilesModuleFallback(join(checkout, 'apps/cli/package.json'), harnessHome)
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
  provideCmdline(ctx, { args: [], exit: (code: number) => { throw new Error(`dogfood: exit ${code}`) } })
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.builtins.group = Group
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(rootConfig).href, patches } })
  await ctx.loader.await()
  assertEntriesLoaded(ctx, 'weftmate dogfood')

  // replay 提供可演示回合（无凭据 mock 模型）。
  installLlmReplay(ctx, {
    file: join(here, '..', 'tests', 'contract', 'fixtures', 'web-chat-replay.jsonl'),
    providers: [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', contextWindow: 128_000 }],
    }],
  })

  const port = ctx.get('webServer')?.port ?? null
  if (typeof port !== 'number') throw new Error('webServer 未就绪')
  console.log('[dogfood] READY 官方UI  -> http://127.0.0.1:' + port + '/')
  console.log('[dogfood] READY 诊断面  -> http://127.0.0.1:' + port + '/weftmate/api/v1/diagnostics')
  console.log('[dogfood] READY 错误环  -> http://127.0.0.1:' + port + '/weftmate/api/v1/last-errors')
  console.log('[dogfood] workspace=' + workspaceCwd)

  let stopping = false
  const shutdown = async () => {
    if (stopping) return
    stopping = true
    try { await ctx.fiber.dispose() } catch { /* 尽力 */ }
    await rm(workspaceCwd, { recursive: true, force: true }).catch(() => undefined)
    process.exit(0)
  }
  process.on('SIGINT', () => { void shutdown() })
  process.on('SIGTERM', () => { void shutdown() })
  setInterval(() => {}, 60_000) // 保持进程存活
} catch (error) {
  console.error('[dogfood] FAIL ' + (error instanceof Error ? error.message : String(error)))
  process.exit(1)
}
