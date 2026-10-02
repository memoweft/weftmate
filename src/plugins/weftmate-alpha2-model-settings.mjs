/**
 * Alpha.2 model-settings product seam.
 *
 * DSH V4 owns provider configuration, credential storage and the model
 * catalog.  This module deliberately composes those official services instead
 * of reviving WeftMate's legacy settings store.  It exposes redacted provider
 * facts for a future Weave settings page and one stable route lookup for
 * policy consumers such as MemoWeft.
 */

export const name = 'weftmate-alpha2-model-settings'
// These are V4 service dependencies, not structural assumptions about the
// legacy web client. `accountController` is intentionally optional because a
// local-only profile may omit the DeepSeek account composition.
export const inject = ['connection', 'settingsController', 'sessionController', 'credentials']

const PROVIDER_ID = /^[a-z][a-z0-9-]{0,63}$/
const API_KEY_REF = /^[A-Za-z_][A-Za-z0-9_]*$/
const MODEL_ID = /^[^\s]{1,160}$/
const MAX_MODELS = 64
const DIAGNOSTIC_TIMEOUT_MS = 5_000
const SETTINGS_NAMESPACE = 'llm-pi-ai'
export const ALPHA2_OFFLINE_SETTINGS_SCHEMA_VERSION = 1

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function text(value, label, limit = 512) {
  if (typeof value !== 'string') throw new Error(`${label}_required`)
  const normalized = value.trim()
  if (!normalized || normalized.length > limit) throw new Error(`${label}_invalid`)
  return normalized
}

function providerId(value) {
  const id = text(value, 'provider', 64)
  if (!PROVIDER_ID.test(id)) throw new Error('provider_invalid')
  return id
}

function credentialRefFor(provider) {
  return `WEFTMATE_ALPHA2_${provider.replace(/-/g, '_').toUpperCase()}_API_KEY`
}

function endpoint(value) {
  const baseURL = text(value, 'baseURL', 2048)
  let parsed
  try { parsed = new URL(baseURL) } catch { throw new Error('baseURL_invalid') }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
    throw new Error('baseURL_invalid')
  }
  // The Settings schema preserves the string as given.  A canonical trailing
  // slash prevents `new URL('models', ...)` from accidentally dropping `/v1`.
  return parsed.href.endsWith('/') ? parsed.href.slice(0, -1) : parsed.href
}

function isLoopback(baseURL) {
  try {
    const host = new URL(baseURL).hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  } catch { return false }
}

function normalizeModels(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MODELS) throw new Error('models_invalid')
  const seen = new Set()
  return value.map((candidate, index) => {
    const row = object(candidate)
    if (row === null) throw new Error(`models_${index}_invalid`)
    const id = text(row.id, `models_${index}_id`, 160)
    if (!MODEL_ID.test(id) || seen.has(id)) throw new Error(`models_${index}_id_invalid`)
    seen.add(id)
    const result = { id }
    if (row.name !== undefined) result.name = text(row.name, `models_${index}_name`, 240)
    if (row.contextWindow !== undefined) {
      if (!Number.isInteger(row.contextWindow) || row.contextWindow < 1) throw new Error(`models_${index}_contextWindow_invalid`)
      result.contextWindow = row.contextWindow
    }
    if (row.maxTokens !== undefined) {
      if (!Number.isInteger(row.maxTokens) || row.maxTokens < 1) throw new Error(`models_${index}_maxTokens_invalid`)
      result.maxTokens = row.maxTokens
    }
    if (row.input !== undefined) {
      if (!Array.isArray(row.input) || !row.input.every(item => item === 'text' || item === 'image')) throw new Error(`models_${index}_input_invalid`)
      result.input = [...row.input]
    }
    return result
  })
}

function publicRoute(provider, profile) {
  const row = object(profile)
  if (row === null || typeof row.baseURL !== 'string') return undefined
  try {
    const baseURL = endpoint(row.baseURL)
    const apiKeyRef = typeof row.apiKeyEnv === 'string' && API_KEY_REF.test(row.apiKeyEnv) ? row.apiKeyEnv : undefined
    return Object.freeze({
      provider,
      baseURL,
      ...(typeof row.displayName === 'string' ? { displayName: row.displayName } : {}),
      ...(typeof row.api === 'string' ? { api: row.api } : {}),
      ...(apiKeyRef === undefined ? {} : { apiKeyRef }),
    })
  } catch { return undefined }
}

function providerProfile(input, previous) {
  const value = object(input)
  if (value === null) throw new Error('provider_payload_invalid')
  const provider = providerId(value.provider)
  const baseURL = endpoint(value.baseURL)
  const api = text(value.api ?? previous?.api ?? 'openai-completions', 'api', 80)
  const displayName = text(value.displayName ?? previous?.displayName ?? provider, 'displayName', 240)
  const models = normalizeModels(value.models ?? previous?.models)
  // `apiKeyEnv` is only a safe reference.  The key value is intentionally
  // never accepted here; a UI must call the official credentials Remote API.
  const suppliedRef = value.apiKeyRef ?? value.apiKeyEnv
  const apiKeyEnv = typeof suppliedRef === 'string' && API_KEY_REF.test(suppliedRef)
    ? suppliedRef
    : typeof previous?.apiKeyEnv === 'string' && API_KEY_REF.test(previous.apiKeyEnv)
      ? previous.apiKeyEnv : credentialRefFor(provider)
  return { provider, profile: { displayName, api, baseURL, models, apiKeyEnv } }
}

function allowedKeys(value, permitted, label) {
  const row = object(value)
  if (row === null) throw new Error(`${label}_invalid`)
  for (const key of Object.keys(row)) if (!permitted.has(key)) throw new Error(`${label}_field_not_allowed:${key}`)
  return row
}

const OFFLINE_DOCUMENT_KEYS = new Set(['schemaVersion', 'providers'])
const OFFLINE_PROVIDER_KEYS = new Set(['displayName', 'api', 'baseURL', 'models', 'apiKeyRef', 'apiKeyEnv'])
const OFFLINE_MODEL_KEYS = new Set(['id', 'name', 'contextWindow', 'maxTokens', 'input'])

/** Strict single-source schema for the offline candidate document and launch overlay. */
export function normalizeAlpha2OfflineSettingsDocument(document) {
  const source = allowedKeys(document, OFFLINE_DOCUMENT_KEYS, 'alpha2_offline_settings_document')
  if (source.schemaVersion !== ALPHA2_OFFLINE_SETTINGS_SCHEMA_VERSION) throw new Error('alpha2_offline_settings_schema_version_invalid')
  const providers = object(source.providers)
  if (providers === null) throw new Error('alpha2_offline_settings_providers_invalid')
  const normalized = {}
  for (const [id, profile] of Object.entries(providers)) {
    const row = allowedKeys(profile, OFFLINE_PROVIDER_KEYS, `alpha2_offline_provider:${id}`)
    if (Array.isArray(row.models)) row.models.forEach((model, index) => allowedKeys(model, OFFLINE_MODEL_KEYS, `alpha2_offline_model:${id}:${index}`))
    const next = providerProfile({ provider: id, ...row })
    normalized[next.provider] = Object.freeze(next.profile)
  }
  return Object.freeze({ schemaVersion: ALPHA2_OFFLINE_SETTINGS_SCHEMA_VERSION, providers: Object.freeze(normalized) })
}

/** Validate one offline, non-secret candidate transaction before it touches candidate HOME. */
export function prepareAlpha2OfflineSettings(input, existing = { schemaVersion: ALPHA2_OFFLINE_SETTINGS_SCHEMA_VERSION, providers: {} }) {
  const prior = normalizeAlpha2OfflineSettingsDocument(existing)
  const value = allowedKeys(input, new Set(['provider', ...OFFLINE_PROVIDER_KEYS]), 'alpha2_offline_settings_payload')
  if (Array.isArray(value.models)) value.models.forEach((model, index) => allowedKeys(model, OFFLINE_MODEL_KEYS, `alpha2_offline_payload_model:${index}`))
  const next = providerProfile(value, object(prior.providers)[providerId(value.provider)])
  return Object.freeze({
    schemaVersion: ALPHA2_OFFLINE_SETTINGS_SCHEMA_VERSION,
    providers: Object.freeze({ ...object(prior.providers), [next.provider]: Object.freeze(next.profile) }),
  })
}

/** JSON is valid YAML, so this generated non-secret overlay needs no custom serializer. */
export function alpha2OfflineSettingsPatch(document) {
  const prepared = normalizeAlpha2OfflineSettingsDocument(document)
  return `${JSON.stringify([{ id: SETTINGS_NAMESPACE, config: { providers: prepared.providers } }], null, 2)}\n`
}

function redactedAccount(value) {
  const state = object(value)
  if (state === null) return { available: false }
  // AccountController already provides a browser-safe AccountView.  Preserve
  // only its structural state to avoid making this product route a second
  // account/profile API surface.
  return {
    available: true,
    ...(typeof state.status === 'string' ? { status: state.status } : {}),
    ...(typeof state.loginVisible === 'boolean' ? { loginVisible: state.loginVisible } : {}),
    ...(typeof state.onboarding === 'boolean' ? { onboarding: state.onboarding } : {}),
  }
}

export function createAlpha2ModelSettings({ settingsController, sessionController, credentials, accountController, fetchImpl = fetch }) {
  if (!settingsController || typeof settingsController.describe !== 'function'
    || typeof settingsController.update !== 'function') throw new Error('alpha2_model_settings_missing_settings_controller')
  if (!sessionController || typeof sessionController.modelCatalog !== 'function') throw new Error('alpha2_model_settings_missing_session_controller')
  if (!credentials || typeof credentials.describe !== 'function') throw new Error('alpha2_model_settings_missing_credentials')

  const namespace = async () => {
    const described = await settingsController.describe()
    const row = described?.namespaces?.find(candidate => candidate?.ns === SETTINGS_NAMESPACE)
    if (!row) throw new Error('alpha2_model_settings_namespace_unavailable')
    const value = object(row.value)
    const providers = object(value?.providers) ?? {}
    return { row, providers }
  }

  const routeFor = async (candidate) => {
    let provider
    try { provider = providerId(candidate) } catch { return undefined }
    // Policy readers must fail closed while a profile is reloading or an
    // upstream settings provider is temporarily unavailable.
    try {
      const { providers } = await namespace()
      return publicRoute(provider, providers[provider])
    } catch { return undefined }
  }

  const providers = async () => {
    const { providers: configured } = await namespace()
    const records = []
    for (const [provider, profile] of Object.entries(configured)) {
      if (!PROVIDER_ID.test(provider)) continue
      const route = publicRoute(provider, profile)
      if (route === undefined) continue
      const credential = route.apiKeyRef === undefined ? { configured: false, writable: false }
        : await credentials.describe(route.apiKeyRef).catch(() => ({ configured: false, writable: false }))
      records.push({ ...route, credential: { configured: credential?.configured === true, writable: credential?.writable !== false } })
    }
    return records
  }

  const account = async () => {
    if (!accountController || typeof accountController.getState !== 'function') return { available: false }
    try { return redactedAccount(await accountController.getState()) } catch { return { available: false } }
  }

  const snapshot = async () => {
    const [configured, catalog, accountState] = await Promise.all([
      providers(), sessionController.modelCatalog(), account(),
    ])
    return {
      settingsNamespace: SETTINGS_NAMESPACE,
      providers: configured,
      modelCatalog: catalog,
      account: accountState,
      credentialWrite: { remote: 'credentials.set', valueTransport: 'official-typert-remote' },
    }
  }

  const saveProvider = async input => {
    // V4 ConfigEditor persists through profileContext.patchPath and reconciles
    // the complete Loader tree. A secure bootstrap starts from an IPC-signed
    // tree that must never be reconstructed from a mutable patch file, so an
    // in-process write would discard the signed insert layer. Refuse before
    // touching SettingsForms; a later host-owned re-sign/restart transaction
    // is the only admissible persistence path for this candidate.
    if (process.env.WEFTMATE_SECURE_SNAPSHOT_ACTIVE === '1') {
      throw new Error('alpha2_model_settings_requires_restart')
    }
    const { row, providers: existing } = await namespace()
    const id = providerId(object(input)?.provider)
    const next = providerProfile(input, object(existing[id]))
    const changed = await settingsController.update(
      SETTINGS_NAMESPACE,
      { providers: { [next.provider]: next.profile } },
      row.revision,
    )
    const route = publicRoute(next.provider, object(changed?.value)?.providers?.[next.provider])
    if (route === undefined) throw new Error('alpha2_model_settings_readback_failed')
    const credential = await credentials.describe(route.apiKeyRef).catch(() => ({ configured: false, writable: false }))
    return { route, credential: { configured: credential?.configured === true, writable: credential?.writable !== false } }
  }

  const diagnose = async candidate => {
    const route = await routeFor(candidate)
    if (route === undefined) return { status: 'not_configured', provider: typeof candidate === 'string' ? candidate : '' }
    if (!isLoopback(route.baseURL)) return { status: 'blocked_non_loopback', provider: route.provider }
    const configured = route.apiKeyRef === undefined ? false : (await credentials.describe(route.apiKeyRef)).configured === true
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DIAGNOSTIC_TIMEOUT_MS)
    timer.unref?.()
    try {
      // This is OpenAI-compatible endpoint reachability only, never a model
      // generation request.  Credentials remain inside the official provider
      // bridge and are not included in any returned diagnostic.
      const headers = {}
      if (configured && route.apiKeyRef !== undefined && typeof credentials.resolve === 'function') {
        const hit = await credentials.resolve(route.apiKeyRef)
        if (hit?.value) headers.authorization = `Bearer ${hit.value}`
      }
      const target = new URL('models', `${route.baseURL}/`)
      const response = await fetchImpl(target, { method: 'GET', headers, redirect: 'error', signal: controller.signal })
      const payload = await response.json().catch(() => null)
      return {
        status: response.ok ? 'reachable' : 'http_error', provider: route.provider,
        httpStatus: response.status, credentialConfigured: configured,
        ...(Array.isArray(payload?.data) ? { discoveredModels: payload.data.filter(item => typeof item?.id === 'string').length } : {}),
      }
    } catch {
      return { status: 'unreachable', provider: route.provider, credentialConfigured: configured }
    } finally {
      clearTimeout(timer)
    }
  }

  return Object.freeze({ routeFor, providers, snapshot, saveProvider, diagnose })
}

export function apply(ctx) {
  const modelSettings = createAlpha2ModelSettings({
    settingsController: ctx.settingsController,
    sessionController: ctx.sessionController,
    credentials: ctx.credentials,
    accountController: ctx.get?.('accountController'),
  })
  ctx.provide('weftmateAlpha2ModelSettings', modelSettings)
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/weftmate/models', methods: ['GET'], requestBody: 'buffered',
    fetch: async () => Response.json(await modelSettings.snapshot(), { headers: { 'cache-control': 'no-store' } }),
  }), 'weftmate-alpha2-model-settings: protected read')
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/weftmate/models/request', methods: ['POST'], requestBody: 'buffered',
    fetch: async request => {
      try {
        const input = object(await request.json())
        if (input?.action === 'saveProvider') return Response.json(await modelSettings.saveProvider(input.provider), { headers: { 'cache-control': 'no-store' } })
        if (input?.action === 'diagnose') return Response.json(await modelSettings.diagnose(input.provider), { headers: { 'cache-control': 'no-store' } })
        return Response.json({ error: 'alpha2_model_settings_action_not_supported' }, { status: 400, headers: { 'cache-control': 'no-store' } })
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : 'alpha2_model_settings_failed' }, { status: 400, headers: { 'cache-control': 'no-store' } })
      }
    },
  }), 'weftmate-alpha2-model-settings: protected mutation')
}
