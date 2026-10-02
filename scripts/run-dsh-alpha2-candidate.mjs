#!/usr/bin/env node
/**
 * Boots the pinned DSH alpha.2 candidate in an empty, dedicated DSH_HOME.
 * It never reads the active dogfood home, does not provide model credentials,
 * and has an upstream-only profile policy until WeftMate's V4 adapters exist.
 *
 * `--smoke` starts the official web surface, fetches its HTML, then closes it.
 * Without the flag, keep the process open for a manual browser inspection.
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { DshWebRuntime, redactWebToken } from '../src/dsh-web-runtime.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const configPath = join(repoRoot, 'runtime', 'dsh-candidates', 'dsh-v0.1.7-alpha.2.json')
const candidate = JSON.parse(readFileSync(configPath, 'utf8'))
const resolveFromRepo = (path) => resolve(repoRoot, path)
const checkoutPath = process.env.WEFTMATE_DSH_ALPHA2_CHECKOUT || resolveFromRepo(candidate.checkoutPath)
const homeDir = process.env.WEFTMATE_DSH_ALPHA2_HOME || resolveFromRepo(candidate.runtimeHome)
const workspaceDir = process.env.WEFTMATE_DSH_ALPHA2_WORKSPACE || resolveFromRepo(candidate.workspacePath)
const runtimePath = process.env.WEFTMATE_DSH_ALPHA2_RUNTIME || ''

if (process.argv.includes('--memory-smoke')) {
  process.env.WEFTMATE_ALPHA2_MEMOWEFT_ENABLED = '1'
  process.env.WEFTMATE_MEMOWEFT_PYTHONPATH = join(repoRoot, 'tests', 'fixtures', 'alpha2-memoweft-stub')
}
if (process.argv.includes('--mods-smoke')) {
  process.env.WEFTMATE_ALPHA2_MODS_SYNTHETIC = '1'
  process.env.WEFTMATE_ALPHA2_MODS_SMOKE = '1'
  process.env.WEFTMATE_ALPHA2_SMOKE_CHALLENGE = randomUUID()
}
const credentialValues = new Map()
if (process.argv.includes('--credential-smoke')) {
  process.env.WEFTMATE_ALPHA2_TEST_PROBE = '1'
  // This value is intentionally present only in the runner's parent process.
  // DshWebRuntime must scrub it before both the config preflight and secure
  // child; the probe reports only the boolean result, never this literal.
  process.env.WEFTMATE_ALPHA2_SCRUB_API_KEY = 'synthetic-env-secret'
}

function fail(message) {
  console.error(`[dsh-alpha2] ${message}`)
  process.exit(1)
}

if (!existsSync(join(checkoutPath, '.git'))) fail(`独立 checkout 不存在：${checkoutPath}`)
const head = execFileSync('git', ['-C', checkoutPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (head !== candidate.commit) fail(`checkout commit 不匹配：${head}，预期 ${candidate.commit}`)
const packageJson = JSON.parse(readFileSync(join(checkoutPath, 'package.json'), 'utf8'))
if (packageJson.version !== candidate.packageVersion) fail(`checkout package 版本不匹配：${packageJson.version}`)
if (runtimePath === '' && !existsSync(join(checkoutPath, 'apps', 'cli', 'lib', 'bin.js'))) fail('官方 checkout 尚未构建 apps/cli/lib/bin.js；先在该独立 checkout 执行 corepack pnpm run build:official')
if (runtimePath !== '' && !existsSync(join(runtimePath, 'VENDOR-MANIFEST.json'))) fail(`候选 vendor 不完整：${runtimePath}`)

await Promise.all([mkdir(homeDir, { recursive: true }), mkdir(workspaceDir, { recursive: true })])
const logs = []
const createRuntime = () => new DshWebRuntime({
  homeDir,
  workspaceDir,
  ...(runtimePath === '' ? { checkoutPath } : { runtimePath }),
  profileName: candidate.profileName,
  profilePolicy: candidate.profilePolicy,
  ...(process.argv.includes('--credential-smoke') ? { credentialRequestHandler: async ({ operation, ref, value }) => {
    if (operation === 'set') { credentialValues.set(ref, value); return {} }
    if (operation === 'resolve') return credentialValues.has(ref) ? { value: credentialValues.get(ref), source: 'synthetic' } : {}
    if (operation === 'unset') { credentialValues.delete(ref); return {} }
    return { configured: credentialValues.has(ref), writable: true }
  } } : {}),
  noOpen: true,
  readyTimeoutMs: 120_000,
  log: (line) => { logs.push(line); console.log(line) },
})

async function browserAuth(origin) {
  const handoff = await fetch(origin, { redirect: 'manual' })
  if (handoff.status !== 303 || !handoff.headers.get('set-cookie')) {
    fail(`官方 web token 交接失败（status=${handoff.status} setCookie=${handoff.headers.has('set-cookie')}）`)
  }
  return { headers: { cookie: handoff.headers.get('set-cookie').split(';', 1)[0] } }
}

async function callRemote(origin, auth, endpoint, args) {
  const rpcId = `weftmate-alpha2-smoke-${randomUUID()}`
  const response = await fetch(new URL(`/api/${endpoint}`, origin), {
    method: 'POST',
    headers: { ...auth.headers, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { args } }),
  })
  if (!response.ok) fail(`official Remote ${endpoint} transport failed (${response.status})`)
  const body = await response.json().catch(() => null)
  if (body?.type !== 'server-response' || body?.rpcId !== rpcId || body?.result?.ok !== true) {
    fail(`official Remote ${endpoint} did not accept synthetic request (${body?.result?.error?.code ?? 'invalid_response'})`)
  }
  return body.result.value
}

async function callMods(origin, auth, input) {
  const response = await fetch(new URL('/api/weftmate/mods/request', origin), {
    method: 'POST',
    headers: { ...auth.headers, 'content-type': 'application/json', 'x-weftmate-alpha2-smoke-challenge': process.env.WEFTMATE_ALPHA2_SMOKE_CHALLENGE },
    body: JSON.stringify(input),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) fail(`WeftMate alpha.2 Mod lifecycle failed (${response.status}: ${body?.error ?? 'invalid_response'})`)
  return body
}

async function expectModsFailure(origin, auth, input, expected) {
  const response = await fetch(new URL('/api/weftmate/mods/request', origin), {
    method: 'POST',
    headers: { ...auth.headers, 'content-type': 'application/json', 'x-weftmate-alpha2-smoke-challenge': process.env.WEFTMATE_ALPHA2_SMOKE_CHALLENGE },
    body: JSON.stringify(input),
  })
  const body = await response.json().catch(() => null)
  if (response.status !== 400 || typeof body?.error !== 'string' || !body.error.includes(expected)) {
    fail(`WeftMate alpha.2 Mod failure path changed (${response.status}: ${body?.error ?? 'invalid_response'})`)
  }
}

async function modsLifecycleSmoke(origin, auth) {
  const created = await callMods(origin, auth, { action: 'create', name: `Alpha2 lifecycle ${randomUUID()}` })
  const projectId = created?.project?.projectId
  const sessionId = created?.project?.maintainerSessionId
  if (typeof projectId !== 'string' || typeof sessionId !== 'string') fail('WeftMate alpha.2 Mod create did not return a durable project/session identity')
  const modified = await callMods(origin, auth, { action: 'modify', project_id: projectId, sessionId })
  if (modified?.revision !== 'counter-increment-two' || modified?.project?.workspace_revision !== 2) fail('WeftMate alpha.2 Mod workspace edit was not durable')
  const candidate = await callMods(origin, auth, { action: 'candidate', project_id: projectId, sessionId })
  const versionId = candidate?.version?.versionId
  if (typeof versionId !== 'string') fail('WeftMate alpha.2 Mod candidate did not return a version identity')
  await expectModsFailure(origin, auth, { action: 'invoke', project_id: projectId, sessionId, request: { action: 'increment' } }, 'Start the Mod before invoking')
  const validated = await callMods(origin, auth, { action: 'validate', project_id: projectId, sessionId, version_id: versionId })
  if (validated?.version?.status !== 'validated' || validated?.version?.validationReceipt?.host_oracle?.kind !== 'alpha2-host-isolated-state-observation') {
    fail('WeftMate alpha.2 Mod validation did not retain a host-observed selfTest receipt')
  }
  const enabled = await callMods(origin, auth, { action: 'enable', project_id: projectId, sessionId, version_id: versionId })
  if (enabled?.project?.activeVersionId !== versionId || enabled?.project?.desiredState !== 'stopped') fail('WeftMate alpha.2 Mod activation changed the stopped execution policy')
  const started = await callMods(origin, auth, { action: 'start', project_id: projectId, sessionId })
  if (started?.run?.status !== 'running') fail('WeftMate alpha.2 Mod did not enter a real running child state')
  const invoked = await callMods(origin, auth, { action: 'invoke', project_id: projectId, sessionId, request: { action: 'increment' } })
  if (invoked?.result?.count !== 2) fail('WeftMate alpha.2 Mod modified business handler did not execute')
  const stopped = await callMods(origin, auth, { action: 'stop', project_id: projectId, sessionId })
  if (stopped?.run?.status !== 'stopped') fail('WeftMate alpha.2 Mod stop did not settle the live run')
  const final = await callMods(origin, auth, { action: 'status', project_id: projectId, sessionId })
  if (final?.project?.desiredState !== 'stopped' || final?.run?.status !== 'stopped') fail('WeftMate alpha.2 Mod durable stopped state is missing')
  return { projectId, sessionId }
}

async function sessionLifecycleSmoke(runtime, origin, auth) {
  const sessionId = `weftmate-alpha2-synthetic-${randomUUID()}`
  const workspace = await callRemote(origin, auth, 'workspace/create', { request: { path: workspaceDir } })
  if (typeof workspace?.workspace?.workspaceId !== 'string' || workspace.workspace.path !== workspaceDir) {
    fail('official workspace/create did not return the isolated candidate workspace')
  }
  const created = await callRemote(origin, auth, 'session/create', { request: { sessionId, workspaceId: workspace.workspace.workspaceId } })
  if (created?.sessionId !== sessionId) fail('official session/create did not return the synthetic session id')
  const listed = await callRemote(origin, auth, 'session/list', { _request: {} })
  if (!Array.isArray(listed?.items) || !listed.items.some(item => item?.sessionId === sessionId)) {
    fail('official session/list did not expose the synthetic session')
  }
  // This is intentionally an idle Agent: cancellation is checked as the
  // formal receipt only.  No model request or synthetic assistant turn is
  // produced, so there is no honest turn/end assertion to make here.
  const cancelled = await callRemote(origin, auth, 'session/cancel', { request: { sessionId } })
  if (cancelled?.accepted !== true) fail('official session/cancel did not return its receipt')
  const catalog = await callRemote(origin, auth, 'permissionPresets/catalog', {})
  const beforePermissions = await callRemote(origin, auth, 'session/projections', { request: { sessionId } })
  const currentPreset = beforePermissions?.values?.permissions?.currentValue
  const preset = catalog?.options?.map(option => option?.value).find(value => typeof value === 'string' && value !== currentPreset)
  if (typeof preset !== 'string') fail('official permissionPresets/catalog returned no selectable preset')
  // The public V4 setter is the official command path. It writes the durable
  // permission events without asking a model to generate a reply.
  const changed = await callRemote(origin, auth, 'commands/execute', { agentId: sessionId, line: `/permission ${preset}`, submittedAttachments: [] })
  if (changed?.result?.kind !== 'success') fail('official /permission command did not accept the synthetic preset')
  const appliedPermissions = await callRemote(origin, auth, 'session/projections', { request: { sessionId } })
  if (appliedPermissions?.values?.permissions?.currentValue !== preset) fail('official /permission command did not apply the requested preset')
  // Persisted Session logs flush asynchronously; wait for the observed state
  // to cross the process boundary before exercising recovery.
  await new Promise(resolve => setTimeout(resolve, 250))
  const modsBeforeRestart = process.argv.includes('--mods-smoke')
    ? await fetch(new URL('/api/weftmate/mods/status', origin), auth).then(response => response.json())
    : null
  await runtime.close()
  const restarted = createRuntime()
  const restartedOrigin = await restarted.start()
  const restartedAuth = await browserAuth(restartedOrigin)
  const restored = await callRemote(restartedOrigin, restartedAuth, 'session/list', { _request: {} })
  if (!Array.isArray(restored?.items) || !restored.items.some(item => item?.sessionId === sessionId)) {
    await restarted.close()
    fail('official session/list did not recover the synthetic session after restart')
  }
  const restoredPermissions = await callRemote(restartedOrigin, restartedAuth, 'session/projections', { request: { sessionId } })
  if (restoredPermissions?.values?.permissions?.currentValue !== preset) {
    await restarted.close(); fail(`official permission preset was not durable after restart (${JSON.stringify(restoredPermissions?.values?.permissions ?? null)})`)
  }
  if (modsBeforeRestart !== null) {
    let modsAfterRestart
    for (let attempt = 0; attempt < 20; attempt += 1) {
      modsAfterRestart = await fetch(new URL('/api/weftmate/mods/status', restartedOrigin), restartedAuth).then(response => response.json())
      if (modsAfterRestart?.ready === true || modsAfterRestart?.phase === 'error') break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    const before = modsBeforeRestart.projects?.map(project => `${project.projectId}:${project.maintainerSessionId}`).sort()
    const after = modsAfterRestart.projects?.map(project => `${project.projectId}:${project.maintainerSessionId}`).sort()
    if (!Array.isArray(before) || !Array.isArray(after) || before.length === 0 || JSON.stringify(before) !== JSON.stringify(after)
      || modsAfterRestart.execution?.enabled !== false || modsAfterRestart.projects?.some(project => project.desiredState !== 'stopped')) {
      await restarted.close(); fail(`alpha2 Mod project/session binding or stopped execution gate did not recover after restart (${JSON.stringify(modsAfterRestart)})`)
    }
  }
  console.log('[dsh-alpha2] session smoke passed: official workspace/create, session create/list/cancel, permission preset and restart recovery; no model request was sent')
  return restarted
}

let runtime = createRuntime()

try {
  const origin = await runtime.start()
  // `origin` keeps the one-time token for the in-process cookie hand-off
  // below. Console output is user-visible diagnostic data, so it must never
  // disclose that bearer token.
  console.log(`[dsh-alpha2] ready ${redactWebToken(origin)} (DSH_HOME=${homeDir})`)
  if (process.argv.includes('--smoke')) {
    // Alpha.2 turns the one-time query token into an HTTP-only browser cookie
    // through a 303 response. Node's fetch has no cookie jar, so following that
    // redirect would correctly end in 401. Assert the authenticated hand-off
    // itself instead of pretending that an unauthenticated follow-up is HTML.
    let auth = await browserAuth(origin)
    const page = await fetch(new URL('/', origin), auth).then(async (response) => ({ ok: response.ok, body: await response.text() }))
    // Credential P0 is a host-side secure-bootstrap proof. A separate client
    // asset regression must not mask whether the authenticated host, its
    // credential provider and the protected probe route actually came up.
    if (!page.ok || (!process.argv.includes('--credential-smoke') && !page.body.includes('@weftmate/alpha2-client'))) {
      fail('WeftMate alpha.2 client 未进入官方 web boot 图')
    }
    const statusUrl = new URL('/api/weftmate/status', origin)
    const denied = await fetch(statusUrl, { redirect: 'manual' })
    if (denied.status !== 401) {
      fail(`WeftMate alpha.2 status 未受官方 /api 认证保护（anonymous status=${denied.status}）`)
    }
    const status = await fetch(statusUrl, auth).then(async (response) => ({ status: response.status, ok: response.ok, body: await response.json().catch(() => null) }))
    if (!status.ok || status.body?.app?.name !== 'WeftMate' || status.body?.capabilities?.chatShell !== true
      || status.body?.capabilities?.transport !== 'official-typert-remote-v4') {
      fail(`WeftMate alpha.2 status 路由不可用（status=${status.status} code=${status.body?.error ?? 'invalid'}）`)
    }
    console.log('[dsh-alpha2] smoke passed: official token hand-off, authenticated WeftMate chat client graph, protected status route; no model request was sent')
    if (process.argv.includes('--prepared-settings-smoke')) {
      const prepared = await fetch(new URL('/api/weftmate/models', origin), auth).then(async response => ({ status: response.status, body: await response.json().catch(() => null) }))
      const route = prepared.body?.providers?.find(item => item?.provider === 'prepared-loopback')
      const group = prepared.body?.modelCatalog?.groups?.find(item => item?.id === 'prepared-loopback')
      if (prepared.status !== 200 || route?.baseURL !== 'http://127.0.0.1:1/v1' || route?.apiKeyRef !== 'WEFTMATE_ALPHA2_PREPARED_LOOPBACK_API_KEY'
        || !Array.isArray(group?.models) || !group.models.some(model => model?.id === 'prepared-model')) {
        fail(`WeftMate alpha.2 离线设置未进入签名候选（status=${prepared.status}）`)
      }
      console.log('[dsh-alpha2] prepared settings smoke passed: offline non-secret overlay entered signed model catalog; no model request was sent')
    }
    if (process.argv.includes('--owner-nine-models-smoke')) {
      const prepared = await fetch(new URL('/api/weftmate/models', origin), auth).then(async response => ({ status: response.status, body: await response.json().catch(() => null) }))
      const route = prepared.body?.providers?.find(item => item?.provider === 'dai-models')
      const group = prepared.body?.modelCatalog?.groups?.find(item => item?.id === 'dai-models')
      const expected = ['muse-glimmer-30b-q5', 'occamy-10-35b-a3b', 'occamy-miniplus-v21', 'ornith-15-35b-a3b', 'qwen3.8-27b-ablated-128k', 'qwen3.8-27b-ablated-q5-96k', 'qwen3.8-27b', 'qwen3.8-27b-original', 'qwen3.8-27b-u']
      if (prepared.status !== 200 || route?.baseURL !== 'http://127.0.0.1:8081/v1' || route?.apiKeyRef !== 'WEFTMATE_DAI_PROXY_API_KEY'
        || !Array.isArray(group?.models) || group.models.length !== expected.length || expected.some(id => !group.models.some(model => model?.id === id))) {
        fail(`WeftMate alpha.2 OwnerDogfood 九模型目录未进入签名候选（status=${prepared.status}）`)
      }
      console.log('[dsh-alpha2] OwnerDogfood nine-model catalog smoke passed: signed directory only; no model request was sent')
    }
    if (process.argv.includes('--credential-smoke')) {
      const probeUrl = new URL('/api/weftmate/credential-probe', origin)
      const deniedProbe = await fetch(probeUrl, { redirect: 'manual' })
      if (deniedProbe.status !== 401) fail(`alpha2 credential probe 未受官方 /api 认证保护（anonymous=${deniedProbe.status}）`)
      let probe
      for (let n = 0; n < 20; n += 1) { probe = await fetch(probeUrl, auth).then(r => r.json()); if (probe.complete || probe.error) break; await new Promise(r => setTimeout(r, 100)) }
      if (probe?.complete !== true || probe?.environmentClear !== true || credentialValues.size !== 0
        || logs.some(line => line.includes('synthetic-value') || line.includes('synthetic-env-secret'))) {
        fail(`alpha2 credential IPC probe failed state=${probe?.error === 'credential_probe_failed' ? 'failed' : 'incomplete'} records=${credentialValues.size}`)
      }
      console.log('[dsh-alpha2] credential smoke passed: set/resolve/unset via Alpha2 IPC')
    }
    if (process.argv.includes('--model-settings-smoke')) {
      const modelSettingsUrl = new URL('/api/weftmate/models', origin)
      const modelSettingsRequestUrl = new URL('/api/weftmate/models/request', origin)
      const deniedRead = await fetch(modelSettingsUrl, { redirect: 'manual' })
      const deniedWrite = await fetch(modelSettingsRequestUrl, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'diagnose', provider: 'alpha2-synthetic' }),
      })
      if (deniedRead.status !== 401 || deniedWrite.status !== 401) {
        fail(`WeftMate alpha.2 模型设置路由未受官方 /api 认证保护（read=${deniedRead.status} write=${deniedWrite.status}）`)
      }
      const syntheticSecret = 'synthetic-key-must-not-persist-or-log'
      const saved = await fetch(modelSettingsRequestUrl, {
        method: 'POST', headers: { ...auth.headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'saveProvider', provider: {
            provider: 'alpha2-synthetic', displayName: 'Alpha2 synthetic loopback', api: 'openai-completions',
            baseURL: 'http://127.0.0.1:1/v1', models: [{ id: 'synthetic-model', contextWindow: 4096, maxTokens: 256 }],
            // An untrusted custom field must neither be accepted as a key nor
            // reach the settings document. A future UI uses credentials.set.
            apiKey: syntheticSecret,
          },
        }),
      }).then(async response => ({ status: response.status, body: await response.text() }))
      const secureSnapshot = process.argv.includes('--credential-smoke')
      if (secureSnapshot) {
        if (saved.status !== 400 || !saved.body.includes('alpha2_model_settings_requires_restart') || saved.body.includes(syntheticSecret)) {
          fail(`WeftMate alpha.2 安全 snapshot 未拒绝模型设置写入（status=${saved.status}）`)
        }
        const preserved = await fetch(modelSettingsUrl, auth)
        if (preserved.status !== 200) fail(`WeftMate alpha.2 安全设置拒绝后路由未保留（status=${preserved.status}）`)
        console.log('[dsh-alpha2] model settings secure smoke passed: signed snapshot rejects live write and preserves authenticated route')
      } else if (saved.status !== 200 || saved.body.includes(syntheticSecret)) {
        fail(`WeftMate alpha.2 模型设置保存未保持密钥隔离（status=${saved.status}）`)
      }
      const modelRead = secureSnapshot
        ? { status: 200, body: { providers: [] } }
        : await fetch(modelSettingsUrl, auth).then(async response => ({ status: response.status, body: await response.json().catch(() => null) }))
      const configured = modelRead.body?.providers?.find(item => item?.provider === 'alpha2-synthetic')
      if (!secureSnapshot && (modelRead.status !== 200 || configured?.baseURL !== 'http://127.0.0.1:1/v1'
        || configured?.apiKeyRef !== 'WEFTMATE_ALPHA2_ALPHA2_SYNTHETIC_API_KEY'
        || JSON.stringify(modelRead.body).includes(syntheticSecret)
        || logs.some(line => line.includes(syntheticSecret)))) {
        fail(`WeftMate alpha.2 模型设置读回或脱敏失败（status=${modelRead.status}）`)
      }
      // The temporary route was admitted through the formal V4 settings API;
      // remove it through that same API so a smoke run leaves no selectable
      // fake model in the isolated candidate home.
      if (!secureSnapshot) {
      const settings = await callRemote(origin, auth, 'settings/describe', {})
      const settingsNamespace = settings?.namespaces?.find(item => item?.ns === 'llm-pi-ai')
      if (!settingsNamespace || !Number.isInteger(settingsNamespace.revision)) fail('官方 settings/describe 未返回 llm-pi-ai revision')
      await callRemote(origin, auth, 'settings/mutate', {
        ns: 'llm-pi-ai', ops: [{ op: 'unset', path: ['providers', 'alpha2-synthetic'] }], expectedRevision: settingsNamespace.revision,
      })
      const afterCleanup = await fetch(modelSettingsUrl, auth).then(response => response.json())
      if (afterCleanup?.providers?.some(item => item?.provider === 'alpha2-synthetic')) fail('模型设置 smoke 清理未移除临时 provider')
      }
      if (!secureSnapshot) console.log('[dsh-alpha2] model settings smoke passed: authenticated V4 settings read/write, route readback, anonymous rejection and synthetic-key isolation; no model request was sent')
    }
    if (!process.argv.includes('--mods-smoke')) {
      const disabledLifecycle = await fetch(new URL('/api/weftmate/mods/request', origin), {
        method: 'POST', headers: { ...auth.headers, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'list' }),
      })
      if (disabledLifecycle.status !== 404) fail(`WeftMate alpha.2 Mod lifecycle route is present outside explicit smoke mode (${disabledLifecycle.status})`)
    }
    if (process.argv.includes('--memory-smoke')) {
      let memory
      for (let attempt = 0; attempt < 20; attempt += 1) {
        memory = await fetch(new URL('/api/weftmate/memory/status', origin), auth).then(response => response.json())
        if (memory?.initialized === true || memory?.error) break
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      if (memory?.enabled !== true || memory?.initialized !== true || memory?.protocol !== 'memoweft.dsh_rpc') fail('WeftMate alpha.2 synthetic MemoWeft bridge did not initialize')
      console.log('[dsh-alpha2] memory smoke passed: protected synthetic MemoWeft RPC initialized; no model request was sent')
    }
    if (process.argv.includes('--mods-smoke')) {
      let mods
      for (let attempt = 0; attempt < 20; attempt += 1) {
        mods = await fetch(new URL('/api/weftmate/mods/status', origin), auth).then(response => response.json())
        if (mods?.projectCount > 0) break
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      if (mods?.ready !== true || mods?.projectCount < 1 || mods.projects?.some(project => project.desiredState !== 'stopped')) {
        fail(`WeftMate alpha.2 seeded Mod runtime did not create a stopped project (${JSON.stringify(mods)})`)
      }
      const deniedMods = await fetch(new URL('/api/weftmate/mods/request', origin), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'list' }) })
      if (deniedMods.status !== 401) fail(`WeftMate alpha.2 Mod lifecycle route is not protected (${deniedMods.status})`)
      const unauthorisedMods = await fetch(new URL('/api/weftmate/mods/request', origin), { method: 'POST', headers: { ...auth.headers, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'list' }) })
      if (unauthorisedMods.status !== 404) fail(`WeftMate alpha.2 Mod lifecycle route accepted an authenticated request without its smoke capability (${unauthorisedMods.status})`)
      await modsLifecycleSmoke(origin, auth)
      const afterLifecycle = await fetch(new URL('/api/weftmate/mods/status', origin), auth).then(response => response.json())
      if (afterLifecycle?.execution?.enabled !== false || afterLifecycle?.projects?.some(project => project.desiredState !== 'stopped')) fail('WeftMate alpha.2 Mod lifecycle left execution enabled or a project running')
      console.log('[dsh-alpha2] mods smoke passed: official Workspace/Session/Permission binding, tool registration, host-observed validation, lifecycle invocation, failure gate, and stopped recovery; no model request was sent')
    }
    if (process.argv.includes('--session-smoke')) runtime = await sessionLifecycleSmoke(runtime, origin, auth)
    await runtime.close()
  } else {
    const close = async () => { await runtime.close(); process.exit(0) }
    process.once('SIGINT', close); process.once('SIGTERM', close)
  }
} catch (error) {
  await runtime.close()
  fail(error instanceof Error ? error.message : String(error))
}
