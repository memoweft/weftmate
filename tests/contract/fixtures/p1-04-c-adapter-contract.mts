// P1-04 exact-pin L2「adapter contract」fixture：与通过的 P1-03 strict-C 同一
// 组合事实（in-process boot 官方 dsh-base + dsh-web-app 两层 bundle patch，
// llm-replay 注入无凭据 mock LLM），但不驱动回合 —— 只经 Gateway HTTP 对
// workspace / model / permission 三个新适配面做真实往返：
//   POST/GET/PATCH/DELETE /weftmate/api/v1/workspaces
//   GET /weftmate/api/v1/models
//   GET|PUT /weftmate/api/v1/sessions/:id/models
//   GET|PUT /weftmate/api/v1/settings/permission
//
// 只读 checkout（WEFTMATE_CHECKOUT）；证据 `[p1-04] EVIDENCE <json>`。

import { mkdtemp, mkdir, rm, writeFile, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const checkout = process.env.WEFTMATE_CHECKOUT
if (checkout === undefined || checkout === '') {
  console.error('[p1-04] FAIL fixture requires WEFTMATE_CHECKOUT (checkout 路径)')
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

async function jsonFetch(base: string, path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const response = await fetch(`${base}${path}`, init)
  return { status: response.status, body: await response.json() }
}

// ── 落盘前临时世界（workspace 目标目录必须真实存在）──────────────────────────
const workspaceCwd = await mkdtemp(join(tmpdir(), 'weftmate-p104-ws-'))
const harnessHome = join(workspaceCwd, '.dsh-home')
const persistenceRoot = await mkdtemp(join(tmpdir(), 'weftmate-p104-sessions-'))

process.env.DSH_HOME = harnessHome
process.env.DSH_AGENTS_HOME = join(workspaceCwd, '.agents-home')
process.env.DSH_BUNDLED_SKILL_DIR = join(workspaceCwd, '.bundled-skills')
process.env.DSH_PERMISSION_MODE = 'danger-full-access'

const originalCwd = process.cwd()
const ctx = new Context()

try {
  process.chdir(workspaceCwd)
  const basePatches = loadOverlayPatches('weftmate p1-04 contract', BASE_PATCH_PATH)
  const surfacePatches = loadOverlayPatches('weftmate p1-04 contract', WEB_PATCH_PATH)
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
      throw new Error(`weftmate p1-04 contract: web app requested exit ${String(code)} with no arguments to reject`)
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
  assertEntriesLoaded(ctx, 'weftmate p1-04 contract')

  installLlmReplay(ctx, { file: REPLAY_FIXTURE, providers: REPLAY_PROVIDERS })

  const webServerPort = ctx.get('webServer')?.port ?? null
  if (typeof webServerPort !== 'number') throw new Error('webServer 服务在 boot 后缺失')
  const base = `http://127.0.0.1:${webServerPort}/weftmate/api/v1`

  // ── workspace：create → list 含它 → rename → delete → list 不含 ────────────
  const created = await jsonFetch(base, '/workspaces', { method: 'POST', body: JSON.stringify({ path: workspaceCwd }) })
  if (created.status !== 201 || created.body?.created !== true || typeof created.body?.workspace?.workspaceId !== 'string') {
    throw new Error(`workspace create 意外：HTTP ${created.status} ${JSON.stringify(created.body)?.slice(0, 200)}`)
  }
  const workspaceId: string = created.body.workspace.workspaceId
  const listed = await jsonFetch(base, '/workspaces')
  if (!listed.body?.items?.some((item: any) => item.workspaceId === workspaceId)) throw new Error('workspace.list 未含新建项')
  const renamed = await jsonFetch(base, `/workspaces/${encodeURIComponent(workspaceId)}`, { method: 'PATCH', body: JSON.stringify({ title: 'p104-renamed' }) })
  if (renamed.status !== 200 || renamed.body?.workspace?.title !== 'p104-renamed') throw new Error(`workspace rename 意外：${JSON.stringify(renamed.body).slice(0, 200)}`)
  // 幂等重解析：同一路径再次 create → created:false。
  const resolved = await jsonFetch(base, '/workspaces', { method: 'POST', body: JSON.stringify({ path: workspaceCwd }) })
  if (resolved.body?.created !== false) throw new Error('workspace 二次 create 应幂等返回 created:false')
  const removed = await jsonFetch(base, `/workspaces/${encodeURIComponent(workspaceId)}`, { method: 'DELETE' })
  if (removed.status !== 200 || removed.body?.deleted !== true) throw new Error(`workspace delete 意外：${JSON.stringify(removed.body)}`)
  const missing = await jsonFetch(base, `/workspaces/${encodeURIComponent(workspaceId)}`, { method: 'PATCH', body: JSON.stringify({ title: 'x' }) })
  if (missing.status !== 404) throw new Error(`未知 workspace rename 应回 404，实为 ${missing.status}`)

  // ── model：宿主目录 → 会话视图 → 选择写回 ─────────────────────────────────
  const catalog = await jsonFetch(base, '/models')
  if (catalog.status !== 200 || !Array.isArray(catalog.body?.groups)) throw new Error('models.catalog 形状意外')
  const group = catalog.body.groups.find((entry: any) => entry.id === 'deepseek-official')
  if (group === undefined) throw new Error(`models.catalog 未含 replay provider；groups=${JSON.stringify(catalog.body.groups).slice(0, 200)}`)
  const sessionCreated = await jsonFetch(base, '/sessions', { method: 'POST', body: '{}' })
  if (sessionCreated.status !== 201) throw new Error(`session create 失败：HTTP ${sessionCreated.status}`)
  const sessionId: string = sessionCreated.body.sessionId
  const view = await jsonFetch(base, `/sessions/${encodeURIComponent(sessionId)}/models`)
  if (view.status !== 200 || typeof view.body?.current?.provider !== 'string' || typeof view.body?.routable !== 'boolean') {
    throw new Error(`session models 视图形状意外：${JSON.stringify(view.body).slice(0, 200)}`)
  }
  const selected = await jsonFetch(base, `/sessions/${encodeURIComponent(sessionId)}/models`, {
    method: 'PUT', body: JSON.stringify({ provider: group.id, model: group.models[0]?.id }),
  })
  if (selected.status !== 200 || selected.body?.selected?.provider !== group.id || selected.body?.selected?.model !== group.models[0]?.id) {
    throw new Error(`selectModel 往返意外：${JSON.stringify(selected.body).slice(0, 200)}`)
  }

  // ── permission：describe 非空 + revision 回传 no-op update ────────────────
  const describe = await jsonFetch(base, '/settings/permission')
  if (describe.status !== 200 || describe.body?.namespace?.ns !== 'permission') {
    throw new Error(`permission 命名空间未注册或形状意外：${JSON.stringify(describe.body).slice(0, 200)}`)
  }
  const revision = describe.body.namespace.revision
  const updated = await jsonFetch(base, '/settings/permission', { method: 'PUT', body: JSON.stringify({ patch: {}, expectedRevision: revision }) })
  if (updated.status !== 200 || updated.body?.namespace?.ns !== 'permission' || typeof updated.body?.namespace?.revision !== 'number') {
    throw new Error(`permission update 意外：${JSON.stringify(updated.body).slice(0, 200)}`)
  }

  const evidence = {
    booted: true,
    workspace: { createIdempotentResolved: resolved.body.created === false, notFound404: missing.status === 404 },
    models: { groups: catalog.body.groups.length, selectedProvider: selected.body.selected.provider, selectedModel: selected.body.selected.model },
    permission: { revisionBefore: revision, revisionAfter: updated.body.namespace.revision },
  }
  await ctx.fiber.dispose()
  await rm(workspaceCwd, { recursive: true, force: true }).catch(() => undefined)
  await rm(persistenceRoot, { recursive: true, force: true }).catch(() => undefined)
  console.log('[p1-04] EVIDENCE ' + JSON.stringify(evidence))
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
  console.log('[p1-04] REJECT ' + JSON.stringify({
    name: (error as Error | null)?.name ?? null,
    message: error instanceof Error ? error.message : String(error),
  }))
  process.exitCode = 1
} finally {
  if (process.cwd() !== originalCwd) process.chdir(originalCwd)
}
