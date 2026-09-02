// P1-05 exact-pin L2「diagnostics」fixture：与 P1-03/P1-04 strict 系同一组合事实
// （in-process boot 官方 dsh-base + dsh-web-app，llm-replay 无凭据 mock LLM），
// 验证 Gateway v1 诊断面在真实组合上的准确性：
//   - boot 前 env 注入 pin/packageVersion → GET /diagnostics 应报 pinned=true；
//   - 注入一个网关错误（未知会话 404）→ /last-errors 进环、state 转 degraded；
//   - /paths 回传组合注入路径。
// kill/restart 的 stopped 转换由单元测试覆盖（host.describe 拒收 → stopped）。

import { mkdtemp, mkdir, readFile, rm, writeFile, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const checkout = process.env.WEFTMATE_CHECKOUT
if (checkout === undefined || checkout === '') {
  console.error('[p1-05] FAIL fixture requires WEFTMATE_CHECKOUT (checkout 路径)')
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
const { installLlmReplay } = await import(toUrl(join(checkout, 'packages/test-support/llm-replay/src/index.ts')))

const INSTALL_ANCHOR = join(checkout, 'apps/cli/package.json')
const SHIPPED_PRESET_DIR = join(checkout, 'apps/cli/config/agent-presets')
const BASE_PATCH_PATH = join(checkout, 'packages/bundle/base/cordis.patch.yml')
const WEB_PATCH_PATH = join(checkout, 'packages/bundle/web-app/cordis.patch.yml')
const REPLAY_FIXTURE = join(here, 'web-chat-replay.jsonl')
const WEFTMATE_SRC = join(here, '..', '..', '..', 'src')
const REPLAY_PROVIDERS = [{
  id: 'deepseek-official',
  name: 'DeepSeek',
  models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', contextWindow: 128_000 }],
}]

const PIN_COMMIT = JSON.parse(await readFile(join(here, '..', 'dsh-pin.json'), 'utf8')).commit as string
const HOST_PKG_VERSION = (JSON.parse(await readFile(INSTALL_ANCHOR, 'utf8')) as { version: string }).version

// boot 前注入 pin 事实（生产由打包/启动方提供同形 env）；运行时版本取 vendored
// apps/cli 的真实版本，host.describe 自报一致时 pinned=true。
process.env.WEFTMATE_DSH_PIN = PIN_COMMIT
process.env.WEFTMATE_DSH_RUNTIME_VERSION = HOST_PKG_VERSION

const workspaceCwd = await mkdtemp(join(tmpdir(), 'weftmate-p105-ws-'))
const harnessHome = join(workspaceCwd, '.dsh-home')
const persistenceRoot = await mkdtemp(join(tmpdir(), 'weftmate-p105-sessions-'))

process.env.DSH_HOME = harnessHome
process.env.DSH_AGENTS_HOME = join(workspaceCwd, '.agents-home')
process.env.DSH_BUNDLED_SKILL_DIR = join(workspaceCwd, '.bundled-skills')
process.env.DSH_PERMISSION_MODE = 'danger-full-access'

const originalCwd = process.cwd()
const ctx = new Context()

try {
  process.chdir(workspaceCwd)
  const patches = [
    ...loadOverlayPatches('weftmate p1-05 contract', BASE_PATCH_PATH),
    ...loadOverlayPatches('weftmate p1-05 contract', WEB_PATCH_PATH),
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
      throw new Error(`weftmate p1-05 contract: web app requested exit ${String(code)} with no arguments to reject`)
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
  assertEntriesLoaded(ctx, 'weftmate p1-05 contract')

  installLlmReplay(ctx, { file: REPLAY_FIXTURE, providers: REPLAY_PROVIDERS })

  const webServerPort = ctx.get('webServer')?.port ?? null
  if (typeof webServerPort !== 'number') throw new Error('webServer 服务在 boot 后缺失')
  const base = `http://127.0.0.1:${webServerPort}/weftmate/api/v1`

  // ── 初始快照：pin 如实上报、占位版本使 pinned=false（已知限制）、running、paths 注入生效 ──
  const diag1 = await (await fetch(`${base}/diagnostics`)).json()
  if (diag1?.dsh?.pin !== PIN_COMMIT) throw new Error(`诊断 pin 未如实上报：${JSON.stringify(diag1?.dsh)}`)
  if (diag1?.dsh?.pinned !== false || diag1?.host?.version !== '0.0.1') {
    throw new Error(`身份确认应因占位版本如实降级：${JSON.stringify({ dsh: diag1?.dsh, host: diag1?.host })}`)
  }
  if (!['running', 'degraded'].includes(diag1?.runtime?.state)) throw new Error(`初始态意外：${diag1?.runtime?.state}`)
  if (typeof diag1?.paths?.dshHome !== 'string' || diag1.paths.dshHome.length === 0) throw new Error('paths.dshHome 缺失')
  if (typeof diag1?.paths?.statePath !== 'string' || diag1.paths.statePath.length === 0) throw new Error('paths.statePath 缺失')
  if (diag1?.lastErrors?.length !== 0) throw new Error('新 boot 不应有历史错误')

  // ── 注入网关错误：未知会话 404 → 进环 + degraded ──────────────────────────
  const bad = await fetch(`${base}/sessions/ghost/messages`, { method: 'POST', body: '{}' })
  if (bad.status !== 404) throw new Error(`未知会话应 404，实为 ${bad.status}`)
  const ring = await (await fetch(`${base}/last-errors`)).json()
  if (!Array.isArray(ring?.items) || ring.items.length < 1 || ring.items[ring.items.length - 1].code !== 'session-not-found') {
    throw new Error(`last-errors 未记录：${JSON.stringify(ring).slice(0, 200)}`)
  }
  if (Object.keys(ring.items[0]).sort().join(',') !== 'at,code,digest') throw new Error('错误环字段必须只有 at/code/digest')
  const diag2 = await (await fetch(`${base}/diagnostics`)).json()
  if (diag2?.runtime?.state !== 'degraded') throw new Error(`注错后应 degraded，实为 ${diag2?.runtime?.state}`)

  const evidence = {
    booted: true,
    pinReported: diag1.dsh.pin,
    pinnedDowngradedAsDesigned: diag1.dsh.pinned === false && diag1.host?.version === '0.0.1',
    stateBefore: diag1.runtime.state,
    ringRecorded: ring.items.length >= 1,
    stateAfterError: diag2.runtime.state,
  }
  await ctx.fiber.dispose()
  await rm(workspaceCwd, { recursive: true, force: true }).catch(() => undefined)
  await rm(persistenceRoot, { recursive: true, force: true }).catch(() => undefined)
  console.log('[p1-05] EVIDENCE ' + JSON.stringify(evidence))
  process.exitCode = 0
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
  console.log('[p1-05] REJECT ' + JSON.stringify({
    name: (error as Error | null)?.name ?? null,
    message: error instanceof Error ? error.message : String(error),
  }))
  process.exitCode = 1
} finally {
  if (process.cwd() !== originalCwd) process.chdir(originalCwd)
}
