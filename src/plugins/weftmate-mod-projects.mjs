import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage, freezeMessage } from '@deepseek-ai/dsh-llm'
import { ModProjectRuntime } from '../runtime/mod-projects/index.mjs'
import { EXTERNAL_AGENT_TEMPLATE } from '../runtime/mod-projects/template.mjs'
import { atomicJson, readJson, safeRelative, sourceDigest } from '../runtime/mod-projects/store.mjs'
import { MOD_WINDOW_CSS, MOD_WINDOW_HTML, MOD_WINDOW_JS } from './weftmate-client/mod-window/assets.mjs'

export const name = 'weftmate-mod-projects'
export const inject = ['tools', 'sessions', 'webServer', 'apiProxy', 'llm', 'agents', 'agentDefaultModel']
const MAX_BODY = 64 * 1024
const MOD_MAINTAINER_PRESET = 'mod-maintainer'
const MOD_MAINTENANCE_CHANNEL = 1
const MANUAL_MAINTENANCE_BINDING = 'current-session-preset'
const SDK_MAX_FILE_BYTES = 256 * 1024
const SDK_MAX_WORKSPACE_BYTES = 2 * 1024 * 1024
const SDK_MAX_WORKSPACE_FILES = 128
const reply = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], value })
const sid = exec => exec?.agent?.session?.id ?? exec?.agent?.session?.header?.id
function selectedAgentPreset(session) {
  for (let index = (session?.events?.length ?? 0) - 1; index >= 0; index -= 1) {
    const event = session.events[index]
    if (event?.type === 'agent-preset/selected') return event.data?.agentPreset
  }
  return session?.header?.agentPreset
}
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)
const noCache = { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' }
const digest = value => createHash('sha256').update(value).digest('hex')
function throwIfAborted(signal) { if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Mod update was cancelled before it could be published') }
function requirementDigest(requirement) {
  return digest(JSON.stringify({
    projectId: requirement.projectId, requirementId: requirement.requirementId, text: requirement.text,
    sessionId: requirement.sessionId, versionId: requirement.versionId, origin: requirement.origin ?? null,
    createdAt: requirement.created_at,
  }))
}
function hasPassedBehaviorChecks(receipt, expectedCount) {
  const assertions = receipt?.assertions?.filter(assertion => assertion?.id?.startsWith('behavior-check:') && ['isolated-handleUi', 'isolated-handleUi-json'].includes(assertion?.evidence?.kind)) ?? []
  return assertions.length === expectedCount && assertions.every(assertion => assertion.passed === true)
}
const ISOLATED_BEHAVIOR_CHECKS = Object.freeze({ NOT_RUN: 'not-run', PASSED: 'passed', FAILED: 'failed', UNKNOWN: 'unknown' })
function isolatedBehaviorAssertions(receipt) { return receipt?.assertions?.filter(assertion => assertion?.id?.startsWith('behavior-check:') && ['isolated-handleUi', 'isolated-handleUi-json'].includes(assertion?.evidence?.kind)) ?? [] }
function detailValidation(project, versions) {
  const version = versions.find(item => item.versionId === project.activeVersionId)
  if (!version) return { isolatedBehaviorChecks: ISOLATED_BEHAVIOR_CHECKS.NOT_RUN, behaviorCheckCount: 0, scenarioValidated: null, userAcceptance: 'not-tracked-by-mod-runtime' }
  const receipt = version.validationReceipt
  if (!receipt || !Array.isArray(receipt.assertions)) return { isolatedBehaviorChecks: ISOLATED_BEHAVIOR_CHECKS.UNKNOWN, behaviorCheckCount: 0, scenarioValidated: null, userAcceptance: 'not-tracked-by-mod-runtime' }
  const assertions = isolatedBehaviorAssertions(receipt)
  const scenarioValidated = typeof receipt.host_oracle?.scenarioValidated === 'boolean' ? receipt.host_oracle.scenarioValidated : null
  return {
    isolatedBehaviorChecks: assertions.length === 0 ? ISOLATED_BEHAVIOR_CHECKS.NOT_RUN : assertions.every(assertion => assertion.passed === true) ? ISOLATED_BEHAVIOR_CHECKS.PASSED : assertions.some(assertion => assertion.passed === false) ? ISOLATED_BEHAVIOR_CHECKS.FAILED : ISOLATED_BEHAVIOR_CHECKS.UNKNOWN,
    behaviorCheckCount: assertions.length,
    scenarioValidated,
    userAcceptance: 'not-tracked-by-mod-runtime',
  }
}
function detailControls(execution, update, memoryPublishing) {
  const publishing = Boolean(memoryPublishing || update.status === 'running')
  const active = typeof execution.project?.activeVersionId === 'string' && execution.project.activeVersionId.length > 0
  const run = execution.run
  const canStop = Boolean(run && !['stopped', 'failed', 'completed', 'interrupted'].includes(run.status))
  const blocked = execution.project?.health === 'blocked' || execution.project?.stopReason === 'blocked_missing_capabilities'
  const startBlockedReason = blocked ? 'BLOCKED_MISSING_CAPABILITIES' : !active ? 'NO_ACTIVE_VERSION' : publishing ? 'PUBLISH_IN_PROGRESS' : canStop ? 'ALREADY_RUNNING' : null
  return { canStart: startBlockedReason === null, canStop, canInvoke: run?.status === 'running', startBlockedReason, publishing }
}
function normalizedUpdate(value) {
  if (value.status === 'completed') return { ...value, completionScope: 'candidate-published' }
  const { completionScope: _completionScope, ...rest } = value
  return rest
}
const SDK_FAILURE_MAX_ITEMS = 4
const SDK_FAILURE_MAX_TEXT = 480
function boundedFailureText(value) {
  const text = String(value ?? '').split(/\r?\n/, 1)[0]
    .replace(/file:\/\/\/[^\s)]+/gi, '<path>')
    .replace(/\b[A-Za-z]:[\\/][^\s)]+/g, '<path>')
    .replace(/(^|[\s(])\/(?:[^\s)]+)/g, '$1<path>')
  return text.length <= SDK_FAILURE_MAX_TEXT ? text : `${text.slice(0, SDK_FAILURE_MAX_TEXT - 1)}…`
}
function boundedFailureValue(value, depth = 0) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return Number.isFinite(value) || typeof value !== 'number' ? value : String(value)
  if (typeof value === 'string') return boundedFailureText(value)
  if (depth >= 3) return '[truncated]'
  if (Array.isArray(value)) return value.slice(0, SDK_FAILURE_MAX_ITEMS).map(item => boundedFailureValue(item, depth + 1))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, SDK_FAILURE_MAX_ITEMS).map(([key, item]) => [boundedFailureText(key), boundedFailureValue(item, depth + 1)]))
  return value === undefined ? null : boundedFailureText(value)
}
function firstOwnFailureValue(value, keys) { for (const key of keys) if (Object.hasOwn(value, key)) return { found: true, value: value[key] }; return { found: false, value: undefined } }
function checkPath(check = {}) { return check.expect?.path ?? (typeof check.stateField === 'string' ? `state.${check.stateField}` : null) }
function failedBehaviorCheckDetail(behaviorChecks, version, cause) {
  const assertions = version?.validation_receipt?.assertions?.filter(assertion => assertion?.id?.startsWith('behavior-check:') && ['isolated-handleUi', 'isolated-handleUi-json'].includes(assertion?.evidence?.kind)) ?? []
  const failures = assertions.map((assertion, index) => ({ assertion, index, check: behaviorChecks[index] ?? {} })).filter(item => item.assertion.passed !== true).slice(0, SDK_FAILURE_MAX_ITEMS).map(({ assertion, index, check }) => {
    const evidence = assertion.evidence ?? {}
    const evidenceExpected = firstOwnFailureValue(evidence, ['expected', 'expectedDelta'])
    const checkExpected = firstOwnFailureValue(check.expect ?? {}, ['value'])
    const observed = firstOwnFailureValue(evidence, ['observed', 'delta', 'after'])
    return {
      index,
      action: boundedFailureText(evidence.action ?? check.action ?? ''),
      assertionPath: boundedFailureText(evidence.path ?? checkPath(check) ?? ''),
      expected: boundedFailureValue(evidenceExpected.found ? evidenceExpected.value : (checkExpected.found ? checkExpected.value : check.expectedDelta)),
      observed: boundedFailureValue(observed.value),
    }
  })
  const validationError = version?.validation_error?.message ?? cause?.message
  return {
    code: 'MOD_SDK_BEHAVIOR_CHECK_FAILED',
    message: 'The requested behavior check failed; correct the implementation or the exact requested check, then run check again.',
    isolation: 'Checks run in submitted order against one candidate-only state. They do not read or change the user data, and this candidate was not published.',
    failures: failures.length ? failures : [{
      index: behaviorChecks.length === 1 ? 0 : null,
      action: behaviorChecks.length === 1 ? boundedFailureText(behaviorChecks[0]?.action ?? '') : null,
      assertionPath: behaviorChecks.length === 1 ? boundedFailureText(checkPath(behaviorChecks[0]) ?? '') : null,
      businessError: boundedFailureText(validationError ?? 'The candidate did not produce a behavior-check receipt'),
    }],
    attemptedChecks: behaviorChecks.slice(0, SDK_FAILURE_MAX_ITEMS).map((check, index) => ({ index, action: boundedFailureText(check?.action ?? ''), assertionPath: boundedFailureText(checkPath(check) ?? ''), payloadProvided: Object.hasOwn(check ?? {}, 'payload'), payloadTopLevelKeys: check?.payload && typeof check.payload === 'object' && !Array.isArray(check.payload) ? Object.keys(check.payload).slice(0, SDK_FAILURE_MAX_ITEMS).map(boundedFailureText) : [] })),
  }
}
function throwBehaviorCheckFailure(behaviorChecks, version, cause) {
  const error = new Error(JSON.stringify(failedBehaviorCheckDetail(behaviorChecks, version, cause)))
  error.code = 'MOD_SDK_BEHAVIOR_CHECK_FAILED'
  throw error
}

// DSH's typed-tool compiler supports explicit arrays, objects, and unions.
// Keep the two executable check forms separate so a model cannot wrap the
// array in {checks:[...]} or accidentally use an array state field as a delta.
// Do not use the vendor's `json` node here: it compiles to `{}`, which gives
// a grammar-constrained provider no scalar cue for a length expectation.
const behaviorCheckValueParameter = {
  oneOf: [
    { type: 'number', description: 'Use a number for counts and lengths, for example 1.' },
    { type: 'string' },
    { type: 'boolean' },
    { type: 'null' },
    { type: 'array', description: 'A JSON array value.' },
    { type: 'object', additionalProperties: true, description: 'A JSON object value.' },
  ],
}
const behaviorCheckParameter = {
  type: 'array',
  description: 'A direct array of one or more isolated behavior checks. Do not wrap it in {checks:[...]}. Use the expect form for returned or state arrays, including items.length.',
  items: {
    oneOf: [
      {
        type: 'object', additionalProperties: false,
        properties: {
          action: { type: 'string', required: true },
          steps: { type: 'integer', required: true },
          payload: { type: 'object', additionalProperties: true },
          stateField: { type: 'string', required: true },
          expectedDelta: { type: 'number', required: true },
        },
      },
      {
        type: 'object', additionalProperties: false,
        properties: {
          action: { type: 'string', required: true },
          steps: { type: 'integer', required: true },
          payload: { type: 'object', additionalProperties: true },
          expect: {
            type: 'object', required: true, additionalProperties: false,
            properties: {
              path: { type: 'string', required: true },
              op: { type: 'string', required: true, enum: ['equals', 'contains'] },
              value: { ...behaviorCheckValueParameter, required: true },
            },
          },
        },
      },
    ],
  },
}

function send(res, status, value, headers = {}) { res.writeHead(status, { ...noCache, ...headers }); res.end(typeof value === 'string' ? value : JSON.stringify(value)) }
function sendText(res, status, value, contentType) { res.writeHead(status, { 'cache-control': 'no-store', 'content-type': contentType, 'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; frame-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'", 'x-content-type-options': 'nosniff' }); res.end(value) }
function sendAsset(res, asset) { res.writeHead(200, { 'cache-control': 'no-store', 'content-type': asset.mimeType, 'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'self'", 'x-content-type-options': 'nosniff' }); res.end(asset.bytes) }
function sameOrigin(req) {
  const host = req.headers.host
  if (!host || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(`http://${host}`).hostname)) return false
  return req.headers.origin === `http://${host}`
}
async function body(req) {
  let text = ''
  for await (const chunk of req) { text += chunk.toString('utf8'); if (Buffer.byteLength(text) > MAX_BODY) throw Object.assign(new Error('Request too large'), { status: 413 }) }
  return JSON.parse(text || '{}')
}
function rpcValue(result) {
  if (result?.result?.ok === true) return result.result.value
  if (result?.ok === true && result.value !== undefined) return result.value
  if (result?.sessionId) return result
  throw new Error(result?.result?.error?.message ?? result?.error?.message ?? 'DSH session creation failed')
}
function textFromStream(chunks) {
  const text = []
  for (const chunk of chunks) {
    if (chunk?.type === 'error' || chunk?.type === 'aborted' || (chunk?.type === 'finish' && ['error', 'aborted'].includes(chunk.reason?.kind))) throw new Error(chunk.error?.message ?? chunk.reason?.failure?.message ?? chunk.message ?? 'DSH model request failed')
    if (typeof chunk?.delta === 'string') text.push(chunk.delta)
    if (typeof chunk?.text === 'string') text.push(chunk.text)
    for (const block of chunk?.content ?? []) if (block?.type === 'text' && typeof block.text === 'string') text.push(block.text)
  }
  return { text: text.join('') }
}

// This is deliberately a capability skeleton, not an implementation of a
// bookmark/favourite product.  The maintenance model receives the user's goal
// and writes the actual business source through mod_sdk.
const MOD_DEVELOPMENT_SKELETON = Object.freeze({
  manifest: { entry: 'src/main.mjs', state: 'data/state.json', validate: 'selfTest', stateSchemaVersion: 1, manifestVersion: 1, capabilities: { required: ['state.read', 'state.write', 'ui.customAsset'] }, ui: { assets: 'ui' } },
  files: {
    'src/main.mjs': `export async function start(api) { await api.state.write((await api.state.read()) ?? {}) }
export async function selfTest() { return { ok: true, assertions: [{ id: 'starter-project', passed: true }] } }
export async function handleUi(api, request) { return { action: request?.action ?? 'status', state: (await api.state.read()) ?? {} } }
`,
    'ui/index.html': '<!doctype html><meta charset="utf-8"><title>新 Mod</title><main><h1>新 Mod</h1><p id="status">正在连接…</p><label>动作 <input id="action" value="status"></label><label>JSON 参数 <textarea id="payload">{}</textarea></label><button id="run">执行</button><pre id="result"></pre></main><script defer src="./app.js"></script>',
    'ui/app.js': `let port, token, sequence = 0
const status = document.getElementById('status'), result = document.getElementById('result')
function send(action, payload) { if (!port || !token) return; port.postMessage({ type: 'weftmate-mod-action', token, requestId: 'request-' + (++sequence), action, payload }) }
window.addEventListener('message', event => { const data = event.data
  if (data?.type === 'weftmate-mod-init' && typeof data.token === 'string') { token = data.token; parent.postMessage({ type: 'weftmate-mod-ready', token }, '*'); return }
  if (data?.type !== 'weftmate-mod-connect' || data.token !== token || !event.ports[0]) return
  port = event.ports[0]; port.onmessage = event => { const reply = event.data; if (reply?.token !== token) return; status.textContent = reply?.type === 'weftmate-mod-error' ? '操作失败' : '已连接'; result.textContent = JSON.stringify(reply?.result ?? reply?.error ?? null, null, 2) }; send('status', {})
})
document.getElementById('run').onclick = () => { try { send(document.getElementById('action').value.trim(), JSON.parse(document.getElementById('payload').value || '{}')) } catch { status.textContent = 'JSON 参数无效' } }`,
  },
})

const MOD_SDK_GUIDE = Object.freeze({
  version: 1,
  layout: { entry: 'src/main.mjs', ui: 'ui/index.html', state: 'data/state.json (host-owned persistent state, not workspace source; do not read it with mod_sdk)' },
  lifecycle: {
    start: 'export async function start(api) { const state = await api.state.read() || {}; await api.state.write(state) }',
    selfTest: "export async function selfTest(api) { return { ok: true, assertions: [{ id: 'project-test', passed: true }] } }",
    ui: "export async function handleUi(api, request) { return { action: request.action, state: await api.state.read() } }",
  },
  grants: {
    state: 'api.state.read() and api.state.write(value) access only this Mod persistent state',
    model: 'api.model.call(input) needs both a manifest declaration and an explicit host grant; it is not granted to new Mods by default',
    network: 'unavailable through this SDK',
    dependencies: 'installation is unavailable',
    memory: 'unavailable; do not read a Memo DB',
    sharedUi: 'unavailable; only the declared custom asset view is currently available',
  },
  manifest: { actions: ['manifest_read', 'manifest_update'], compatibleFields: ['entry', 'state', 'validate', 'stateSchemaVersion', 'ui.assets'], supportedFields: ['manifestVersion', 'capabilities'], hostOwned: ['host capability grants', 'maintainer binding', 'project root'], proposalOnly: ['settings.schema', 'contributes.views', 'contributes.commands'] },
  behaviorChecks: {
    shape: '[{ action, steps, payload?, stateField, expectedDelta } | { action, steps, payload?, expect: { path, op, value } }]',
    numericExample: [{ action: 'increment', steps: 2, stateField: 'count', expectedDelta: 2 }],
    resultEqualsExample: [{ action: 'status', steps: 1, expect: { path: 'result.ready', op: 'equals', value: true } }],
    arrayLengthExample: [{ action: 'list', steps: 1, payload: { query: 'example' }, expect: { path: 'result.items.length', op: 'equals', value: 1 } }],
    writeThenReadItemExample: [{ action: 'append', steps: 1, payload: { value: 'example' }, expect: { path: 'state.entries.0.value', op: 'equals', value: 'example' } }, { action: 'list', steps: 1, expect: { path: 'result.entries.0.value', op: 'equals', value: 'example' } }],
    rules: 'Pass the array directly, never {checks:[...]}. action is the non-empty business operation passed to handleUi (for example append or list), never a lifecycle or function name such as handleUi or start. steps is 1..32; payload is a bounded JSON object. One array runs in submitted order against one candidate-only state. Exercise the requested write behavior with realistic input, then read or return data and assert the exact value or retained state; do not replace a requested write behavior with a read-only empty-list check. Use stateField plus finite expectedDelta only for numeric state. For arrays such as items, use expect.path state.items.length or result.items.length and literal numeric value: 1. To assert a concrete item after a write then read, use your own business actions and fields with a canonical numeric segment such as result.entries.0.value; numeric segments are 0 or a positive integer without a leading zero. Do not send value:{} or {items_length:1} for a length assertion; expect.op is equals or contains.',
  },
  uiBridge: {
    protocol: 'The declared ui/index.html runs in a sandboxed frame. It receives weftmate-mod-init {token}, must reply weftmate-mod-ready {token}, then receives weftmate-mod-connect with one MessagePort. Send {type:"weftmate-mod-action", token, requestId, action, payload} on that port; render weftmate-mod-result or weftmate-mod-error replies. Do not use fetch, parent DOM access, browser storage, project ids, or frame tokens.',
    acceptance: 'Replace the generic action form with the requested user interface. Keep the handshake and route every user action through handleUi. Validate a realistic write followed by a concrete read, then check the active UI through the owner-visible Mod window; a placeholder or an empty-list check is not completion.',
  },
  manifestExamples: {
    read: { action: 'manifest_read' },
    update: { action: 'manifest_update', expected_sha256: '<sha256 returned by manifest_read>', manifest: { manifestVersion: 1, entry: 'src/main.mjs', state: 'data/state.json', validate: 'selfTest', stateSchemaVersion: 1, capabilities: { required: ['state.read', 'state.write', 'ui.customAsset'] }, ui: { assets: 'ui' } } },
    rules: 'Read first and send the exact returned hash. A Mod may change only supported manifest fields. Host capability grants, maintainer binding, and project root are never editable here; declaring model.call does not grant it.',
  },
  readReceipts: 'read(path) records one session-bound SHA-256 receipt for that exact project path. A later write/edit may omit expected_sha256 only while that receipt still matches the actual file; a first write to an existing file still requires read, another writer still causes rejection, and an explicit stale SHA-256 still causes rejection. manifest_read/manifest_update follow the same rule for the manifest.',
  correction: 'If check rejects its arguments, send behavior_checks as the direct array shown above. Do not retry {checks:[...]}; use expect with *.items.length and the literal number 1 for an array length, never value:{} or {items_length:1}. If a behavior check fails, use its returned structured failure facts to correct the implementation or the exact requested check; do not weaken the check or invent a passing scenario. If a source receipt is missing or stale, call read(path) once, make the intended edit/write again, then run check again. A successful check may be completed without behavior_checks only while the bound source, manifest, requirement, project session, and workspace revision remain unchanged.',
  workflow: ['Call mod_sdk list/read to inspect bounded source.', 'Use write or edit with the SHA-256 returned by read.', 'Use manifest_read then manifest_update with its exact SHA-256 only when the manifest itself needs an allowed change.', 'Call check with an explicit direct behavior_checks array for isolated validation.', 'Call complete with that array, or omit behavior_checks only to reuse the unchanged successful check; host publishes without a version-selection UI step and keeps recovery evidence.'],
  security: 'The SDK enforces one server-bound workspace and rejects path traversal, links, hard links, stale hashes, and oversized source. It does not provide an OS sandbox, network block, or resource isolation for arbitrary Mod runtime code.',
  deviceBridge: 'This SDK has no device-control or weftmod API injection. Do not write api.weftmod, claim automatic device actions, or treat a generated demo as device validation. Isolated checks prove only candidate-only state behavior; they do not prove a real device or business outcome.',
})

function textContent(value, label = 'content') {
  if (typeof value !== 'string' || value.includes('\0')) throw new Error(`${label} must be UTF-8 text without NUL bytes`)
  if (Buffer.byteLength(value, 'utf8') > SDK_MAX_FILE_BYTES) throw new Error(`${label} exceeds the ${SDK_MAX_FILE_BYTES}-byte Mod SDK limit`)
  return value
}

function sdkPath(value) {
  if (typeof value !== 'string' || value.length > 240 || value.includes('\\') || value.startsWith('/') || value.includes('\0')) throw new Error('Mod SDK path must be a short relative slash-separated source path')
  return value
}

async function ordinaryDirectory(path, { create = false } = {}) {
  if (create) await mkdir(path, { recursive: true })
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Mod SDK workspace contains a symbolic link, reparse point, or non-directory path')
}

async function ordinaryWorkspacePath(workspace, requested, { createParents = false } = {}) {
  const path = safeRelative(workspace, sdkPath(requested))
  await ordinaryDirectory(workspace)
  const pieces = requested.split('/')
  let cursor = resolve(workspace)
  for (const piece of pieces.slice(0, -1)) {
    cursor = join(cursor, piece)
    await ordinaryDirectory(cursor, { create: createParents })
  }
  if (relative(resolve(workspace), path).startsWith('..')) throw new Error('Mod SDK path escaped its bound workspace')
  return path
}

async function ordinaryFile(path, { missing = false } = {}) {
  const info = await lstat(path).catch(error => error?.code === 'ENOENT' ? null : Promise.reject(error))
  if (!info) {
    if (missing) return null
    throw new Error('Mod SDK source file does not exist')
  }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1) throw new Error('Mod SDK refuses symbolic links, reparse points, non-files, and hard-linked source files')
  if (info.size > SDK_MAX_FILE_BYTES) throw new Error(`Mod SDK source file exceeds the ${SDK_MAX_FILE_BYTES}-byte limit`)
  return info
}

async function scanSdkWorkspace(root, prefix = '') {
  await ordinaryDirectory(root)
  const files = []
  let totalBytes = 0
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`
    const target = join(root, entry.name)
    const info = await lstat(target)
    if (info.isSymbolicLink()) throw new Error(`Mod SDK refuses a symbolic link or reparse point: ${name}`)
    if (info.isDirectory()) files.push(...await scanSdkWorkspace(target, `${name}/`))
    else if (info.isFile()) {
      if (info.nlink > 1) throw new Error(`Mod SDK refuses a hard-linked source file: ${name}`)
      if (info.size > SDK_MAX_FILE_BYTES) throw new Error(`Mod SDK source file exceeds the ${SDK_MAX_FILE_BYTES}-byte limit: ${name}`)
      totalBytes += info.size
      files.push({ path: name, bytes: info.size, sha256: digest(await readFile(target)) })
    } else throw new Error(`Mod SDK refuses a non-ordinary source entry: ${name}`)
  }
  // The caller sums nested paths too; keeping the individual byte count lets
  // the model make a bounded read decision without a raw host directory view.
  if (files.length > SDK_MAX_WORKSPACE_FILES) throw new Error(`Mod SDK workspace exceeds ${SDK_MAX_WORKSPACE_FILES} files`)
  if (totalBytes > SDK_MAX_WORKSPACE_BYTES) throw new Error(`Mod SDK workspace exceeds the ${SDK_MAX_WORKSPACE_BYTES}-byte limit`)
  return files
}

/** Host-only durable ownership. Project source execution never reads this map. */
class ModHostService {
  constructor(ctx, options, runtime) {
    this.ctx = ctx; this.options = options; this.runtime = runtime
    this.ownersPath = join(runtime.store.root, 'host-project-owners.json')
    this.owners = {}; this.frames = new Map(); this.frameKeys = new Map(); this.delivery = new Map(); this.requirementDelivery = new Map(); this.ownerDelivery = new Map(); this.ownerDeliveryTimer = null; this.ownerDeliveryDueAt = null; this.ownerDeliveryCycle = Promise.resolve(); this.ownerDeliveryCycleResolve = null; this.ownerDeliveryChain = Promise.resolve(); this.ownerDeliveryClosed = false; this.updateOps = new Map(); this.sdkPublishingProjects = new Set(); this.maintenanceBindings = new Map(); this.modMaintainers = new Map(); this.manualMaintenanceInitializations = new Map(); this.creationTurns = new Set(); this.creationTurnDisposers = new Map(); this.sdkReadReceipts = new Map(); this.sdkCheckReceipts = new Map()
  }
  async open() {
    this.owners = (await readJson(this.ownersPath)) ?? {}
    for (const project of await this.runtime.listProjects()) if (project.maintenance_preset === MOD_MAINTAINER_PRESET) this.modMaintainers.set(project.maintainerSessionId, project.projectId)
    return this
  }
  async readBridgeModule() {
    if (this.options.clientBridgePath) return readFile(this.options.clientBridgePath, 'utf8')
    const pluginDir = dirname(fileURLToPath(import.meta.url))
    // Source runs keep the client beside this plugin; a written DSH profile
    // keeps it in its profile-local @weftmate package. These are fixed host
    // locations, never a browser-provided path.
    return readFile(join(pluginDir, 'weftmate-client', 'mod-projects-client.js'), 'utf8').catch(async error => {
      if (error?.code !== 'ENOENT') throw error
      return readFile(join(pluginDir, '..', 'node_modules', '@weftmate', 'client', 'mod-projects-client.js'), 'utf8')
    })
  }
  async own(projectId, ownerSessionId) { this.owners[projectId] = ownerSessionId; await atomicJson(this.ownersPath, this.owners) }
  async stampModMaintainer(projectId) {
    const raw = await this.runtime.store.project(projectId)
    if (!raw) throw new Error('Mod project disappeared before its maintenance channel was configured')
    if (raw.maintenance_preset && raw.maintenance_preset !== MOD_MAINTAINER_PRESET) throw new Error('A project maintenance preset is immutable once created')
    const updated = { ...raw, maintenance_preset: MOD_MAINTAINER_PRESET, maintenance_channel_version: MOD_MAINTENANCE_CHANNEL, updated_at: new Date().toISOString() }
    await this.runtime.store.saveProject(updated)
    const publicProject = await this.runtime.getProject(projectId)
    this.modMaintainers.set(publicProject.maintainerSessionId, projectId)
    return publicProject
  }
  isModMaintainerSession(sessionId) { return this.modMaintainers.has(sessionId) }
  isFormalUnboundMaintainerSession(session) {
    return selectedAgentPreset(session) === MOD_MAINTAINER_PRESET && session?.header?.origin !== 'subagent'
  }
  canInitializeModMaintainerSession(exec) {
    return exec?.name === 'mod_sdk' && ['describe', 'create'].includes(exec?.arguments?.action) && this.isFormalUnboundMaintainerSession(exec?.agent?.session)
  }
  assertSdkInitializationArguments(args) {
    const allowed = new Set(['action', 'name'])
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !allowed.has(key))) throw new Error('Mod SDK create accepts only action and an optional name; project, session, path, source, and workspace arguments are host-owned')
    if (args.name !== undefined && (typeof args.name !== 'string' || !args.name.trim())) throw new Error('Mod SDK create name must be a non-empty string when provided')
  }
  restrictCreationTurn(agent) {
    const session = agent?.session
    const id = session?.id
    const started = [...(session?.events ?? [])].reverse().find(event => event.type === 'turn/start')?.data?.turn
    const ended = started === undefined ? undefined : [...(session?.events ?? [])].reverse().find(event => event.type === 'turn/end' && event.data?.turn === started)
    if (typeof id === 'string' && started !== undefined && !ended) {
      this.creationTurns.add(id)
      if (!this.creationTurnDisposers.has(id) && typeof agent?.ctx?.tools?.restrict === 'function') {
        this.creationTurnDisposers.set(id, agent.ctx.tools.restrict({ allow: ['mod_project'] }))
      }
    }
  }
  releaseCreationTurn(sessionId) { this.creationTurns.delete(sessionId); const dispose = this.creationTurnDisposers.get(sessionId); this.creationTurnDisposers.delete(sessionId); dispose?.() }
  creationTurnGuard(exec) {
    const sessionId = sid(exec)
    if (!sessionId || !this.creationTurns.has(sessionId)) return
    if (exec.name === 'mod_project' && ['create', 'list', 'status'].includes(exec.arguments?.action)) return
    return 'The create result is this owner turn\'s final result. The Mod is delegated to its internal maintenance session: do not write source, create a candidate, validate, poll, use shell/import/subagent tools, or retry other work. Report only the creation.state and end this turn.'
  }
  pauseOwnerGoal(agent) {
    // GoalService requires the exact live agent and current id/revision.
    // ctx.get is Cordis's formal optional-service access; property access
    // requires a declared inject and throws when this plugin is scoped below
    // the goal service.
    const goals = this.ctx.get('goals')
    const goal = goals?.get?.(agent)
    if (!goal || goal.phase !== 'active' || goal.activation !== 'armed') return false
    goals.pause(agent, { id: goal.id, revision: goal.revision })
    return true
  }
  async sdkProject(sessionId) {
    const projectId = this.modMaintainers.get(sessionId)
    if (!projectId) throw new Error('This maintenance session is legacy or unbound; the restricted Mod SDK is available only to newly created mod-maintainer sessions')
    const project = await this.runtime.getProject(projectId)
    if (project.maintainerSessionId !== sessionId || project.maintenance_preset !== MOD_MAINTAINER_PRESET) throw new Error('The Mod SDK session binding is invalid')
    return project
  }
  async ensureMaintenanceWorkspace(project) {
    const cached = this.maintenanceBindings.get(project.projectId)
    if (cached) return cached
    // A user can deliberately start a session in the formal mod-maintainer
    // preset before a project exists.  Its header and event log are immutable
    // DSH state; attaching it again with a new cwd would either be rejected by
    // DSH or silently rewrite the meaning of an existing conversation.  The
    // SDK already resolves its workspace from the durable project binding, so
    // retain this session as-is and never call session.create for it.
    if (project.maintenance_binding === MANUAL_MAINTENANCE_BINDING) {
      const binding = Promise.resolve({ workspaceId: null, workspaceCreated: false, attached: false, binding: MANUAL_MAINTENANCE_BINDING })
      this.maintenanceBindings.set(project.projectId, binding)
      return binding
    }
    const binding = (async () => {
      const api = this.options.apiProxy ?? this.ctx.apiProxy
      if (!api?.workspace?.create || !api?.sessions?.create) throw new Error('DSH apiProxy.workspace.create and apiProxy.sessions.create are required for a Mod maintenance session')
      const cwd = await this.runtime.workspacePath(project.projectId)
      const createdWorkspace = rpcValue(await api.workspace.create({ payload: { path: cwd } }))
      const workspace = createdWorkspace?.workspace ?? createdWorkspace
      const workspaceId = workspace?.workspaceId ?? workspace?.id
      if (typeof workspaceId !== 'string' || !workspaceId) throw new Error('DSH workspace.create did not return a workspaceId')
      // DSH's formal session.create schema accepts workspaceId in place of cwd.
      // Repeating it for a recovered session is the supported attach operation
      // and retains the durable maintenance conversation.
      // A persisted standard session may contain logged standard-tool calls.  DSH
      // deliberately refuses changing a nonblank session's preset, so only the
      // durable new channel asks for mod-maintainer.  Legacy projects remain
      // recoverable and are explicitly never labelled restricted.
      const preset = project.maintenance_preset === MOD_MAINTAINER_PRESET ? MOD_MAINTAINER_PRESET : undefined
      const createdSession = rpcValue(await api.sessions.create({ payload: { sessionId: project.maintainerSessionId, workspaceId, ...(preset ? { agentPreset: preset } : {}) } }))
      if (createdSession.sessionId !== project.maintainerSessionId) throw new Error('DSH did not retain the preallocated maintenance session id')
      return { workspaceId, workspaceCreated: createdWorkspace?.created === true }
    })()
    this.maintenanceBindings.set(project.projectId, binding)
    try { return await binding } catch (error) { this.maintenanceBindings.delete(project.projectId); throw error }
  }
  async restoreMaintenanceWorkspaces() {
    for (const project of await this.runtime.listProjects()) {
      try { await this.ensureMaintenanceWorkspace(project) }
      catch (error) { await this.markCreationFailure(project.projectId, error, { recovered: true }) }
    }
  }
  async markCreationFailure(projectId, error, { recovered = false } = {}) {
    const raw = await this.runtime.store.project(projectId)
    if (!raw) return null
    const missingPreset = /agent-presets: preset .*not found|preset .*not found/i.test(error?.message ?? '')
    const failure = {
      code: missingPreset ? 'MOD_MAINTAINER_PRESET_UNAVAILABLE' : 'MOD_MAINTENANCE_CHANNEL_UNAVAILABLE',
      message: missingPreset ? '受控 Mod 维护预设当前不可用，需要宿主维护后再重试。' : '受控 Mod 维护通道当前不可用，需要宿主维护后再重试。',
      recovered: recovered === true,
      recordedAt: new Date().toISOString(),
    }
    await this.runtime.store.saveProject({ ...raw, creation_status: 'needs_host_maintenance', creation_error: failure, updated_at: new Date().toISOString() })
    return failure
  }
  creationFailure(project, failure) {
    return { project: { projectId: project.projectId, name: project.name, creationStatus: 'needs_host_maintenance' }, creation: { state: 'needs_host_maintenance', code: failure.code, message: failure.message, businessVersionId: null, delegated: false, ownerAction: 'report_failure_and_end_turn', ownerMessage: '内部维护会话当前不可用。只报告创建失败并结束本回合；不要写源码、创建候选、验证或轮询。' } }
  }
  updateFile(projectId) { return join(this.runtime.store.projectRoot(projectId), 'host-update.json') }
  async update(projectId, patch = null) { const current = normalizedUpdate((await readJson(this.updateFile(projectId))) ?? { status: 'ready', requirementId: null, requestMessageId: null, candidateVersionId: null, lastError: null, startedAt: null, completedAt: null }); if (!patch) return current; const next = normalizedUpdate({ ...current, ...patch }); await atomicJson(this.updateFile(projectId), next); return next }
  owner(projectId) { return this.owners[projectId] ?? null }
  async assertAccess(projectId, sessionId) {
    if (!validId(projectId) || !validId(sessionId)) throw new Error('Invalid project or session identifier')
    const project = await this.runtime.getProject(projectId)
    if (this.owner(projectId) !== sessionId && project.maintainerSessionId !== sessionId) throw new Error('This conversation does not own the Mod project')
    return project
  }
  async list(sessionId) {
    if (!validId(sessionId)) throw new Error('A valid DSH session is required')
    return (await this.runtime.listProjects()).filter(project => this.owner(project.projectId) === sessionId || project.maintainerSessionId === sessionId)
  }
  async priorCreate(ownerSessionId, messageId) {
    if (typeof messageId !== 'string' || !messageId) return null
    for (const projectId of await this.runtime.store.projectIds()) {
      const project = await this.runtime.store.project(projectId)
      if (project?.creator_session_id === ownerSessionId && project.creation_request_message_id === messageId) return this.runtime.getProject(projectId)
    }
    return null
  }
  async create(ownerSessionId, { name, files, manifest, initialRequirement = null } = {}) {
    if (files !== undefined || manifest !== undefined) throw new Error('New Mod creation accepts only a name and a user goal; source files and manifest are written by the restricted maintenance session')
    const prior = await this.priorCreate(ownerSessionId, initialRequirement?.messageId)
    if (prior) {
      if (prior.creation_status === 'needs_host_maintenance') return this.creationFailure(prior, prior.creation_error)
      return { project: prior, maintenanceSessionId: prior.maintainerSessionId, creation: { state: 'prepared', requirementId: null, businessVersionId: null, delegated: true, ownerAction: 'end_turn', ownerMessage: '已交给内部维护会话。只报告已开始创建并结束本回合；不要写源码、创建候选、验证或轮询。prepared 不代表业务完成。' } }
    }
    // Runtime needs the durable maintenance identity before it creates the
    // project. DSH receives that exact preallocated ID after workspace exists.
    const maintenanceSessionId = `mod-maintenance-${randomUUID()}`
    let project = await this.runtime.createProject({ name: name ?? '新 Mod', maintainerSessionId: maintenanceSessionId, files: MOD_DEVELOPMENT_SKELETON.files, manifest: MOD_DEVELOPMENT_SKELETON.manifest })
    project = await this.stampModMaintainer(project.projectId)
    const cwd = await this.runtime.workspacePath(project.projectId)
    await this.own(project.projectId, ownerSessionId)
    const raw = await this.runtime.store.project(project.projectId)
    if (raw) await this.runtime.store.saveProject({ ...raw, creator_session_id: ownerSessionId, creation_request_message_id: initialRequirement?.messageId ?? null, creation_status: 'provisioning', creation_error: null, updated_at: new Date().toISOString() })
    try { await this.ensureMaintenanceWorkspace(project) } catch (error) {
      return this.creationFailure(project, await this.markCreationFailure(project.projectId, error))
    }
    const provisioned = await this.runtime.store.project(project.projectId)
    if (provisioned) await this.runtime.store.saveProject({ ...provisioned, creation_status: 'ready', creation_error: null, updated_at: new Date().toISOString() })
    let requirement = null
    if (initialRequirement?.text?.trim()) {
      requirement = await this.runtime.recordRequirement(project.projectId, {
        text: initialRequirement.text,
        sessionId: maintenanceSessionId,
        origin: { kind: 'user', messageId: initialRequirement.messageId ?? null, sourceSessionId: ownerSessionId },
      })
      const delivery = await this.deliverRequirements()
      initialRequirement.delivery = delivery.get(project.projectId) ?? this.requirementDelivery.get(`mod-requirement-${requirement.requirementId}`) ?? 'queued'
    }
    const state = requirement ? (initialRequirement.delivery === 'followup' ? 'generating' : 'queued') : 'prepared'
    return { project, maintenanceSessionId, workspacePath: cwd, creation: { state, requirementId: requirement?.requirementId ?? null, businessVersionId: null, delegated: true, ownerAction: 'end_turn', ownerMessage: `已交给内部维护会话。只报告${state === 'generating' ? '已开始创建' : '已排队创建'}并结束本回合；不要写源码、创建候选、验证或轮询。${state} 不代表业务完成。` } }
  }
  async initializeCurrentMaintainerSession(sessionId, agent, { name } = {}) {
    const bound = this.modMaintainers.get(sessionId)
    if (bound) {
      const project = await this.sdkProject(sessionId)
      if (project.maintenance_binding === MANUAL_MAINTENANCE_BINDING && (project.creation_status !== 'ready' || this.owner(project.projectId) !== sessionId) && this.isFormalUnboundMaintainerSession(agent?.session)) return this.resumeCurrentMaintainerInitialization(project, sessionId, agent, { created: false })
      return { project, created: false, binding: 'existing' }
    }
    if (!this.isFormalUnboundMaintainerSession(agent?.session)) throw new Error('Mod SDK initialization requires the formal mod-maintainer preset on this direct user session')
    const existing = (await this.runtime.listProjects()).find(project => project.maintainerSessionId === sessionId)
    if (existing) {
      if (existing.maintenance_preset !== MOD_MAINTAINER_PRESET) throw new Error('This session is already bound to a legacy Mod project and cannot be converted to the restricted Mod SDK')
      if (existing.maintenance_binding !== MANUAL_MAINTENANCE_BINDING) throw new Error('This session is already bound to another Mod maintenance channel and cannot be rebound')
      return this.resumeCurrentMaintainerInitialization(existing, sessionId, agent, { created: false })
    }
    const active = this.manualMaintenanceInitializations.get(sessionId)
    if (active) return active
    const initialize = (async () => {
      const project = await this.runtime.createProject({
        name: name ?? '新 Mod', maintainerSessionId: sessionId, files: MOD_DEVELOPMENT_SKELETON.files, manifest: MOD_DEVELOPMENT_SKELETON.manifest,
        maintenancePreset: MOD_MAINTAINER_PRESET, maintenanceBinding: MANUAL_MAINTENANCE_BINDING, maintenanceChannelVersion: MOD_MAINTENANCE_CHANNEL,
      })
      return this.resumeCurrentMaintainerInitialization(project, sessionId, agent, { created: true })
    })()
    this.manualMaintenanceInitializations.set(sessionId, initialize)
    try { return await initialize } finally { this.manualMaintenanceInitializations.delete(sessionId) }
  }
  async resumeCurrentMaintainerInitialization(project, sessionId, agent, { created }) {
    if (project.maintainerSessionId !== sessionId || project.maintenance_preset !== MOD_MAINTAINER_PRESET || project.maintenance_binding !== MANUAL_MAINTENANCE_BINDING) throw new Error('The manual Mod maintenance binding is invalid')
    const owner = this.owner(project.projectId)
    if (owner && owner !== sessionId) throw new Error('The manually selected maintenance session cannot take ownership of this Mod project')
    if (!owner) await this.own(project.projectId, sessionId)
    const raw = await this.runtime.store.project(project.projectId)
    if (!raw) throw new Error('The manual Mod project disappeared before initialization completed')
    const initialRequirement = latestUserRequirement(agent?.session)
    let requirement = null
    if (initialRequirement) {
      requirement = (await this.runtime.listRequirements(project.projectId)).find(item => item.origin?.messageId === initialRequirement.messageId) ?? await this.runtime.recordRequirement(project.projectId, {
        text: initialRequirement.text,
        sessionId,
        origin: { kind: 'user', messageId: initialRequirement.messageId },
        notify: false,
      })
      await this.update(project.projectId, { status: 'ready', requirementId: requirement.requirementId, requestMessageId: initialRequirement.messageId, candidateVersionId: null, lastError: null, startedAt: null, completedAt: null })
    }
    if (raw.creation_status !== 'ready' || raw.creation_error !== null) await this.runtime.store.saveProject({ ...raw, creation_status: 'ready', creation_error: null, updated_at: new Date().toISOString() })
    this.modMaintainers.set(sessionId, project.projectId)
    return { project: await this.runtime.getProject(project.projectId), created, binding: MANUAL_MAINTENANCE_BINDING, initialRequirementRecorded: Boolean(requirement) }
  }
  async import(ownerSessionId, directory, input = {}) {
    const maintenanceSessionId = `mod-maintenance-${randomUUID()}`
    const project = await this.runtime.importProject(directory, { name: input.name, maintainerSessionId: maintenanceSessionId, manifest: input.manifest })
    const cwd = await this.runtime.workspacePath(project.projectId)
    await this.ensureMaintenanceWorkspace(project)
    await this.own(project.projectId, ownerSessionId)
    return { project, maintenanceSessionId, workspacePath: cwd }
  }
  async sdkFiles(sessionId) {
    const project = await this.sdkProject(sessionId)
    const workspace = await this.runtime.workspacePath(project.projectId)
    const files = await scanSdkWorkspace(workspace)
    const total = files.reduce((sum, file) => sum + file.bytes, 0)
    if (files.length > SDK_MAX_WORKSPACE_FILES || total > SDK_MAX_WORKSPACE_BYTES) throw new Error('Mod SDK workspace exceeds its bounded source limits')
    return { project: { name: project.name, maintenancePreset: MOD_MAINTAINER_PRESET, channelVersion: project.maintenance_channel_version ?? MOD_MAINTENANCE_CHANNEL }, files, limits: { maxFileBytes: SDK_MAX_FILE_BYTES, maxWorkspaceBytes: SDK_MAX_WORKSPACE_BYTES, maxFiles: SDK_MAX_WORKSPACE_FILES } }
  }
  async sdkRead(sessionId, requested) {
    const project = await this.sdkProject(sessionId)
    const workspace = await this.runtime.workspacePath(project.projectId)
    let path
    try { path = await ordinaryWorkspacePath(workspace, requested) } catch (error) {
      if (error?.code === 'ENOENT') throw new Error('Mod SDK source file does not exist; call mod_sdk list first and read one listed source path.')
      throw error
    }
    await ordinaryFile(path)
    const bytes = await readFile(path)
    const content = bytes.toString('utf8')
    if (!Buffer.from(content, 'utf8').equals(bytes)) throw new Error('Mod SDK reads text source only; binary source is not supported')
    const sha256 = digest(bytes)
    this.sdkReadReceipts.set(`${sessionId}:${project.projectId}:${requested}`, sha256)
    return { path: requested, content, sha256, bytes: bytes.length }
  }
  async sdkWrite(sessionId, requested, content, expectedHash) {
    const project = await this.sdkProject(sessionId)
    this.assertSdkWorkspaceMutable(project.projectId)
    const text = textContent(content)
    const workspace = await this.runtime.workspacePath(project.projectId)
    const path = await ordinaryWorkspacePath(workspace, requested, { createParents: true })
    const previous = await ordinaryFile(path, { missing: true })
    if (previous) {
      const receipt = this.sdkReadReceipts.get(`${sessionId}:${project.projectId}:${requested}`)
      if (expectedHash === undefined || expectedHash === null) expectedHash = receipt
      if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error('Mod SDK writes to an existing source file require its current sha256; first call read(path), then retry without expected_sha256 or send that exact sha256')
      const actual = digest(await readFile(path))
      if (actual !== expectedHash) throw new Error('Mod SDK write rejected because the source hash changed; read the file again before editing')
    } else if (expectedHash !== null && expectedHash !== undefined) throw new Error('Mod SDK creates require expected_sha256 to be null or omitted')
    const current = await this.sdkFiles(sessionId)
    const existingBytes = previous?.size ?? 0
    const predictedCount = current.files.length + (previous ? 0 : 1)
    const predictedBytes = current.files.reduce((sum, file) => sum + file.bytes, 0) - existingBytes + Buffer.byteLength(text, 'utf8')
    if (predictedCount > SDK_MAX_WORKSPACE_FILES || predictedBytes > SDK_MAX_WORKSPACE_BYTES) throw new Error('Mod SDK write would exceed workspace source limits')
    const temporary = `${path}.mod-sdk-${randomUUID()}.tmp`
    await writeFile(temporary, text, { encoding: 'utf8', flag: 'wx' })
    try {
      // Recheck after preparing the replacement so a concurrent mutation cannot
      // turn this optimistic edit into an unreviewed overwrite.
      const latest = await ordinaryFile(path, { missing: true })
      if (previous) {
        if (!latest || digest(await readFile(path)) !== expectedHash) throw new Error('Mod SDK write rejected because the source changed during editing')
      } else if (latest) throw new Error('Mod SDK write rejected because another writer created the source file')
      await rename(temporary, path)
    } finally { await rm(temporary, { force: true }).catch(() => {}) }
    await this.bumpWorkspaceRevision(project.projectId)
    const sha256 = digest(text)
    this.sdkReadReceipts.set(`${sessionId}:${project.projectId}:${requested}`, sha256)
    return { path: requested, sha256, bytes: Buffer.byteLength(text, 'utf8') }
  }
  async sdkEdit(sessionId, requested, find, replace, expectedHash) {
    if (typeof find !== 'string' || !find || typeof replace !== 'string') throw new Error('Mod SDK edit requires non-empty find text and replacement text')
    const project = await this.sdkProject(sessionId)
    this.assertSdkWorkspaceMutable(project.projectId)
    const workspace = await this.runtime.workspacePath(project.projectId)
    const path = await ordinaryWorkspacePath(workspace, requested)
    await ordinaryFile(path)
    const bytes = await readFile(path); const actual = digest(bytes)
    if (expectedHash === undefined || expectedHash === null) expectedHash = this.sdkReadReceipts.get(`${sessionId}:${project.projectId}:${requested}`)
    if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error('Mod SDK edit requires its current sha256; first call read(path), then retry without expected_sha256 or send that exact sha256')
    if (actual !== expectedHash) throw new Error('Mod SDK edit rejected because the source hash changed; read the file again before editing')
    const content = bytes.toString('utf8')
    if (!Buffer.from(content, 'utf8').equals(bytes)) throw new Error('Mod SDK edits text source only; binary source is not supported')
    const first = content.indexOf(find)
    if (first < 0 || content.indexOf(find, first + find.length) >= 0) throw new Error('Mod SDK edit requires exactly one matching source fragment')
    return this.sdkWrite(sessionId, requested, `${content.slice(0, first)}${replace}${content.slice(first + find.length)}`, expectedHash)
  }
  async bumpWorkspaceRevision(projectId) {
    const raw = await this.runtime.store.project(projectId)
    if (!raw) throw new Error('Mod project disappeared while updating its workspace')
    await this.runtime.store.saveProject({ ...raw, workspace_revision: (raw.workspace_revision ?? 0) + 1, updated_at: new Date().toISOString() })
  }
  async sdkStatus(sessionId) {
    const project = await this.sdkProject(sessionId)
    const execution = await this.runtime.inspectRun(project.projectId)
    const versioned = project.manifest?.manifestVersion === 1
    const requested = new Set([...(project.manifest?.capabilities?.required ?? []), ...(project.manifest?.capabilities?.optional ?? [])])
    const hostGrants = new Set(project.host_capability_grants ?? [])
    const capability = (id, provider = true) => {
      if (!versioned) return provider ? 'legacy-compatible-not-new-isolation' : 'unavailable-provider'
      if (!requested.has(id)) return 'unavailable-not-declared'
      if (!hostGrants.has(id)) return 'declared-not-host-granted'
      return provider ? 'available' : 'granted-provider-unavailable'
    }
    return {
      project: { name: project.name, maintenancePreset: MOD_MAINTAINER_PRESET, channelVersion: project.maintenance_channel_version ?? MOD_MAINTENANCE_CHANNEL },
      workspaceRevision: project.workspace_revision,
      run: execution.run,
      capabilityStatus: {
        'ui.customAsset': project.manifest?.ui?.assets ? capability('ui.customAsset') : 'unavailable',
        'ui.shared': 'unavailable',
        'memory.read': 'unavailable',
        'memory.write': 'unavailable',
        'model.call': capability('model.call', typeof this.runtime.model === 'function'),
        'state.read': capability('state.read'),
        'state.write': capability('state.write'),
        'dependencies.install': 'unavailable',
        'device.control': 'unavailable-no-weftmod-api-injection',
        network: 'unavailable',
        resourceIsolation: 'unavailable',
      },
      enforcement: {
        toolScope: 'formal-dsh-preset-restrict',
        filesystem: 'server-bound-project-workspace-path-checks',
        network: 'no-sdk-capability-only; direct-runtime-network-is-not-proven-blocked',
        resourceIsolation: 'not-provided',
        osSandbox: false,
      },
    }
  }
  async sdkDescribe(sessionId, agent) {
    if (!this.isModMaintainerSession(sessionId)) {
      if (!this.isFormalUnboundMaintainerSession(agent?.session)) throw new Error('The restricted Mod SDK is available only to a bound mod-maintainer session')
      return {
        ...MOD_SDK_GUIDE,
        initialization: {
          state: 'unbound',
          action: 'create',
          instruction: 'This formal mod-maintainer session has no Mod yet. You may discuss the user goal normally. When the user asks to create a Mod, call mod_sdk create with only a concise name. The host will create one bounded skeleton and bind this exact session; do not use or request a project id, path, workspace, or another tool.',
        },
      }
    }
    const bound = await this.sdkProject(sessionId)
    const status = await this.sdkStatus(sessionId)
    return { ...MOD_SDK_GUIDE, capabilityFacts: { capabilityStatus: status.capabilityStatus, required: bound.manifest?.capabilities?.required ?? [], isolatedChecks: 'Candidate checks use isolated state only and are not device or user acceptance evidence.' } }
  }
  async sdkManifestRead(sessionId) {
    const project = await this.sdkProject(sessionId)
    const text = JSON.stringify(project.manifest)
    const sha256 = digest(text)
    this.sdkReadReceipts.set(`${sessionId}:${project.projectId}:@manifest`, sha256)
    return { manifest: structuredClone(project.manifest), sha256, workspaceRevision: project.workspace_revision }
  }
  async sdkManifestUpdate(sessionId, manifest, expectedHash) {
    const project = await this.sdkProject(sessionId)
    this.assertSdkWorkspaceMutable(project.projectId)
    if (expectedHash === undefined || expectedHash === null) expectedHash = this.sdkReadReceipts.get(`${sessionId}:${project.projectId}:@manifest`)
    if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error('Manifest update requires manifest_read first; retry without expected_sha256 only after that bound read receipt exists')
    const updated = await this.runtime.updateManifest(project.projectId, manifest, { expectedManifestSha256: expectedHash })
    const sha256 = digest(JSON.stringify(updated.manifest))
    this.sdkReadReceipts.set(`${sessionId}:${project.projectId}:@manifest`, sha256)
    return { manifest: structuredClone(updated.manifest), sha256, workspaceRevision: updated.workspace_revision }
  }
  async sdkCheck(sessionId, behaviorChecks) {
    const project = await this.sdkProject(sessionId)
    if (!Array.isArray(behaviorChecks) || behaviorChecks.length === 0) throw new Error('Mod SDK check requires a direct non-empty behavior_checks array that executes the requested business behavior')
    const receiptKey = this.sdkCheckReceiptKey(sessionId, project.projectId)
    // A new check attempt supersedes an earlier authorization immediately.
    // Otherwise a later failed or stricter check could leave an old candidate
    // silently publishable through complete without behavior_checks.
    this.sdkCheckReceipts.delete(receiptKey)
    const requirement = await this.sdkPendingRequirement(project)
    const candidate = await this.runtime.createCandidate(project.projectId, { behaviorChecks })
    let validated
    try { validated = await this.runtime.validateVersion(project.projectId, candidate.versionId) } catch (error) {
      throwBehaviorCheckFailure(behaviorChecks, await this.runtime.store.version(project.projectId, candidate.versionId), error)
    }
    const stored = await this.runtime.store.version(project.projectId, candidate.versionId)
    const workspace = await this.runtime.workspacePath(project.projectId)
    if (!stored || stored.status !== 'validated' || stored.source_digest !== stored.validation_digest || !stored.validation_receipt?.host_oracle || !hasPassedBehaviorChecks(stored.validation_receipt, behaviorChecks.length)) throwBehaviorCheckFailure(behaviorChecks, stored)
    this.sdkCheckReceipts.set(receiptKey, {
      sessionId, projectId: project.projectId, requirementId: requirement.requirementId,
      requirementDigest: requirementDigest(requirement), workspaceRevision: project.workspace_revision,
      workspaceDigest: await sourceDigest(workspace), manifestDigest: digest(JSON.stringify(project.manifest)),
      versionId: candidate.versionId, sourceDigest: stored.source_digest,
      validationDigest: stored.validation_digest, candidateManifestDigest: digest(JSON.stringify(stored.manifest)), behaviorChecksDigest: digest(JSON.stringify(stored.manifest.behaviorChecks)),
      validationReceipt: structuredClone(stored.validation_receipt),
    })
    const capabilityFacts = await this.sdkStatus(sessionId)
    return { ...validated, capabilityFacts: { required: project.manifest?.capabilities?.required ?? [], capabilityStatus: capabilityFacts.capabilityStatus, scope: 'isolated-behavior-only' } }
  }
  async sdkComplete(sessionId, behaviorChecks, signal) {
    const project = await this.sdkProject(sessionId)
    if (behaviorChecks !== undefined && behaviorChecks !== null) {
      this.sdkCheckReceipts.delete(this.sdkCheckReceiptKey(sessionId, project.projectId))
      const requirement = await this.sdkPendingRequirement(project)
      return this.completeUpdate(project.projectId, requirement.requirementId, behaviorChecks, { signal })
    }
    const receipt = this.sdkCheckReceipts.get(this.sdkCheckReceiptKey(sessionId, project.projectId))
    if (!receipt) throw new Error('Mod SDK complete without behavior_checks requires a successful check in this same maintenance session')
    const requirements = await this.runtime.listRequirements(project.projectId)
    const receiptRequirement = requirements.find(requirement => requirement.requirementId === receipt.requirementId)
    if (receiptRequirement?.status !== 'resolved') {
      const currentRequirement = requirements.find(requirement => requirement.status !== 'resolved')
      if (currentRequirement && currentRequirement.requirementId !== receipt.requirementId) throw new Error('A different pending requirement exists; run check again for that requirement before complete')
    }
    return this.completeUpdate(project.projectId, receipt.requirementId, null, { signal, reusableCheckSessionId: sessionId })
  }
  sdkCheckReceiptKey(sessionId, projectId) { return `${sessionId}:${projectId}` }
  async sdkPendingRequirement(project) {
    const requirement = (await this.runtime.listRequirements(project.projectId)).find(item => item.status !== 'resolved')
    if (!requirement) throw new Error('Mod SDK complete requires one pending requirement for this maintenance session')
    return requirement
  }
  async sdkReusableCheck(sessionId, project, requirement) {
    const receipt = this.sdkCheckReceipts.get(this.sdkCheckReceiptKey(sessionId, project.projectId))
    if (!receipt) throw new Error('Mod SDK complete without behavior_checks requires a successful check in this same maintenance session')
    if (receipt.sessionId !== sessionId || receipt.projectId !== project.projectId || receipt.requirementId !== requirement.requirementId || receipt.requirementDigest !== requirementDigest(requirement)) throw new Error('The successful check belongs to a different or changed requirement; run check again before complete')
    if (receipt.workspaceRevision !== project.workspace_revision || receipt.manifestDigest !== digest(JSON.stringify(project.manifest))) throw new Error('Source or manifest changed after check; run check again before complete')
    const workspaceDigest = await sourceDigest(await this.runtime.workspacePath(project.projectId))
    if (workspaceDigest !== receipt.workspaceDigest || workspaceDigest !== receipt.sourceDigest) throw new Error('Source changed after check; run check again before complete')
    const version = await this.runtime.store.version(project.projectId, receipt.versionId)
    if (!version || version.project_id !== project.projectId || version.status !== 'validated' || version.source_digest !== receipt.sourceDigest || version.validation_digest !== receipt.validationDigest || version.validation_digest !== version.source_digest || digest(JSON.stringify(version.manifest)) !== receipt.candidateManifestDigest || digest(JSON.stringify(version.manifest.behaviorChecks)) !== receipt.behaviorChecksDigest || JSON.stringify(version.validation_receipt) !== JSON.stringify(receipt.validationReceipt)) throw new Error('The successful check receipt is no longer an exact host-validated candidate; run check again before complete')
    return { versionId: receipt.versionId, behaviorChecks: structuredClone(version.manifest.behaviorChecks) }
  }
  assertSdkWorkspaceMutable(projectId) { if (this.sdkPublishingProjects.has(projectId)) throw new Error('Mod SDK source and manifest are locked while a checked candidate is being published') }
  async sdkAction(args, exec) {
    const sessionId = sid(exec); if (!sessionId) throw new Error('A DSH maintenance session is required')
    if (args.action === 'describe') return this.sdkDescribe(sessionId, exec?.agent)
    if (args.action === 'create') { this.assertSdkInitializationArguments(args); return this.initializeCurrentMaintainerSession(sessionId, exec?.agent, args) }
    await this.sdkProject(sessionId)
    if (args.action === 'list') return this.sdkFiles(sessionId)
    if (args.action === 'read') return this.sdkRead(sessionId, args.path)
    if (args.action === 'write') return this.sdkWrite(sessionId, args.path, args.content, args.expected_sha256)
    if (args.action === 'edit') return this.sdkEdit(sessionId, args.path, args.find, args.replace, args.expected_sha256)
    if (args.action === 'status') return this.sdkStatus(sessionId)
    if (args.action === 'manifest_read') return this.sdkManifestRead(sessionId)
    if (args.action === 'manifest_update') return this.sdkManifestUpdate(sessionId, args.manifest, args.expected_sha256)
    if (args.action === 'check') return this.sdkCheck(sessionId, args.behavior_checks)
    if (args.action === 'complete') return this.sdkComplete(sessionId, args.behavior_checks, exec?.signal)
    throw new Error('Unsupported Mod SDK action')
  }
  issueFrame(projectId, sessionId, versionId = null) {
    const key = `${projectId}:${sessionId}:${versionId ?? 'none'}`
    const current = this.frameKeys.get(key)
    const existing = current ? this.frames.get(current) : null
    // An open trusted host page refreshes its detail snapshot every 1.5s.  It
    // extends the same bound capability instead of replacing the iframe (and
    // thereby destroying an in-progress business form). Once the view stops
    // refreshing, the token naturally expires after ten minutes.
    if (current && existing && existing.expiresAt > Date.now()) {
      existing.expiresAt = Date.now() + 10 * 60_000
      return current
    }
    const token = randomUUID()
    this.frames.set(token, { projectId, sessionId, versionId, expiresAt: Date.now() + 10 * 60_000 })
    this.frameKeys.set(key, token)
    return token
  }
  verifyFrame(projectId, sessionId, token, versionId = undefined) {
    const item = this.frames.get(token)
    if (!item || item.expiresAt <= Date.now()) { this.frames.delete(token); throw new Error('Mod frame token is invalid or expired') }
    if (item.projectId !== projectId || item.sessionId !== sessionId) throw new Error('Mod frame token is not bound to this project and conversation')
    if (versionId !== undefined && item.versionId !== versionId) throw new Error('Mod frame token is not bound to the active version')
    return item
  }
  async detail(projectId, sessionId) {
    const project = await this.assertAccess(projectId, sessionId); await this.ensureMaintenanceWorkspace(project); const ui = await this.runtime.describeUi(projectId)
    const [versions, execution, update] = await Promise.all([this.runtime.listVersions(projectId), this.runtime.inspectRun(projectId), this.update(projectId)])
    const frameToken = ui.assetsRoot ? this.issueFrame(projectId, sessionId, ui.version?.versionId ?? null) : null
    // Capability and session are path segments so relative UI assets inherit
    // both without relaxing ordinary asset access or leaking a query token.
    const latestVersionError = versions.find(version => version.validationError)?.validationError ?? null
    return { project, versions, run: execution.run, runs: execution.runs, activation: execution.activation, recentError: execution.run?.error ?? latestVersionError, blocked: execution.project?.health === 'blocked' ? { code: 'blocked_missing_capabilities', reason: execution.project?.stopReason ?? execution.project?.stop_reason } : null, update, controls: detailControls(execution, update, this.sdkPublishingProjects.has(projectId)), validation: detailValidation(execution.project, versions), ui: { ...ui, assetUrl: frameToken ? `/weftmate/mods/assets/${encodeURIComponent(projectId)}/${encodeURIComponent(sessionId)}/${encodeURIComponent(frameToken)}/index.html` : null, frameToken } }
  }
  async captureRequirement(projectId, sessionId, message) {
    const existing = (await this.runtime.listRequirements(projectId)).find(item => item.origin?.messageId === message.id)
    if (existing) return existing
    const requirement = await this.runtime.recordRequirement(projectId, { text: message.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? '', sessionId, origin: { kind: 'user', messageId: message.id }, notify: false })
    await this.update(projectId, { status: 'ready', requirementId: requirement.requirementId, requestMessageId: message.id, candidateVersionId: null, lastError: null, startedAt: null, completedAt: null })
    // The current maintenance turn already receives its guide below. Waking
    // the same AgentLoop again here can create a duplicate generation turn.
    return requirement
  }
  async completeUpdate(projectId, requirementId, behaviorChecks = null, { signal = null, reusableCheckSessionId = null } = {}) {
    const prior = this.updateOps.get(projectId) ?? Promise.resolve()
    let release
    const barrier = new Promise(resolve => { release = resolve })
    const queued = prior.catch(() => {}).then(() => barrier)
    this.updateOps.set(projectId, queued)
    await prior.catch(() => {})
    this.sdkPublishingProjects.add(projectId)
    try { return await this.#completeUpdate(projectId, requirementId, behaviorChecks, signal, reusableCheckSessionId) } finally {
      this.sdkPublishingProjects.delete(projectId)
      release()
      if (this.updateOps.get(projectId) === queued) this.updateOps.delete(projectId)
    }
  }
  async #completeUpdate(projectId, requirementId, behaviorChecks, signal, reusableCheckSessionId) {
    const project = await this.runtime.getProject(projectId); const requirement = (await this.runtime.listRequirements(projectId)).find(item => item.requirementId === requirementId)
    if (!requirement) throw new Error('Requirement not found')
    const prior = await this.update(projectId)
    let recovery = null
    if (requirement.status === 'resolved') {
      if (prior.status === 'completed' && prior.requirementId === requirementId) return prior
      throw new Error('Requirement is already resolved by another update')
    }
    const validatedCandidate = reusableCheckSessionId ? await this.sdkReusableCheck(reusableCheckSessionId, project, requirement) : null
    if (!validatedCandidate && (!Array.isArray(behaviorChecks) || behaviorChecks.length === 0)) throw new Error('complete_update requires explicit behavior_checks that execute the requested business behavior')
    throwIfAborted(signal)
    await this.update(projectId, { status: 'running', requirementId, lastError: null, startedAt: new Date().toISOString(), completedAt: null })
    try {
      await this.runtime.claimRequirement(projectId, requirementId, project.maintainerSessionId)
      const candidate = validatedCandidate
        ? { versionId: validatedCandidate.versionId }
        : await this.runtime.createCandidate(projectId, { behaviorChecks })
      if (!validatedCandidate) await this.runtime.validateVersion(projectId, candidate.versionId)
      throwIfAborted(signal)
      const validation = (await this.runtime.listVersions(projectId)).find(version => version.versionId === candidate.versionId)
      const expectedCheckCount = validatedCandidate?.behaviorChecks?.length ?? behaviorChecks.length
      if (!hasPassedBehaviorChecks(validation?.validationReceipt, expectedCheckCount)) throw new Error('Updated Mod did not pass every requested isolated behavior check')
      await this.runtime.assertRunnableCapabilities(projectId, candidate.versionId)
      const current = await this.runtime.inspectRun(projectId)
      const hadActiveVersion = Boolean(current.project.activeVersionId)
      if (hadActiveVersion && (current.project.stopLatch || current.project.desiredState !== 'running')) throw new Error('User stop or another control change interrupted this update; it was not completed')
      if (current.run && !['stopped', 'failed', 'completed', 'interrupted'].includes(current.run.status)) await this.runtime.stop(projectId, { reason: 'update-pause' })
      throwIfAborted(signal)
      const beforeActivation = await this.runtime.inspectRun(projectId)
      if (beforeActivation.project.stopLatch || (hadActiveVersion && beforeActivation.project.desiredState !== 'stopped')) throw new Error('User stop or another control change interrupted this update; it was not completed')
      if (reusableCheckSessionId) {
        const currentProject = await this.runtime.getProject(projectId)
        const currentRequirement = (await this.runtime.listRequirements(projectId)).find(item => item.requirementId === requirementId)
        const refreshed = currentRequirement && await this.sdkReusableCheck(reusableCheckSessionId, currentProject, currentRequirement)
        if (!refreshed || refreshed.versionId !== candidate.versionId) throw new Error('The successful check changed before publish; run check again before complete')
      }
      if (hadActiveVersion) {
        const checkpoint = `publish-${randomUUID()}`
        await this.runtime.store.checkpointData(projectId, checkpoint)
        recovery = { checkpoint, previousVersionId: beforeActivation.project.activeVersionId, restart: current.project.desiredState === 'running', expectedControlRevision: beforeActivation.project.controlRevision + 1 }
        const raw = await this.runtime.store.project(projectId)
        if (raw) await this.runtime.store.saveProject({ ...raw, last_recovery_checkpoint: checkpoint, updated_at: new Date().toISOString() })
      }
      await this.runtime.activateVersion(projectId, candidate.versionId)
      throwIfAborted(signal)
      const run = await this.runtime.start(projectId)
      if (run.status !== 'running') throw new Error('Updated Mod did not reach healthy running state')
      const afterStart = await this.runtime.inspectRun(projectId)
      if (afterStart.project.desiredState !== 'running' || afterStart.run?.runId !== run.runId || afterStart.run.status !== 'running') throw new Error('User stop or another control change interrupted this update; it was not completed')
      await this.runtime.resolveRequirement(projectId, requirementId, project.maintainerSessionId, { versionId: candidate.versionId })
      const completed = await this.update(projectId, {
        status: 'completed', candidateVersionId: candidate.versionId, completedAt: new Date().toISOString(),
        ownerNotification: {
          messageId: `mod-owner-outcome-${requirementId}-completed`, state: 'pending', outcome: 'completed',
          attempts: 0, lastError: null, nextAttemptAt: null, updatedAt: new Date().toISOString(),
        },
      })
      // The durable outbox is already committed.  Delivery is driven by the
      // host's normal outcome/restore pump so a publish response cannot race
      // a caller that is still binding the original owner Agent.
      this.scheduleOwnerDelivery(0); return completed
    } catch (error) {
      // A new version can write part of persistent state before failing startup.
      // Restore the checkpoint only while no explicit user stop/cancel changed
      // durable intent; a recovery must never resurrect a user-stopped Mod.
      if (recovery) {
        try {
          const permitted = async expected => {
            const control = await this.runtime.getProject(projectId)
            return control.controlRevision === expected && !control.stopLatch && control.stopReason !== 'user-stop'
          }
          if (await permitted(recovery.expectedControlRevision)) {
            await this.runtime.stop(projectId, { reason: 'publish-rollback' }).catch(() => {})
            const afterStop = await this.runtime.getProject(projectId)
            if (afterStop.stopLatch || afterStop.stopReason === 'user-stop') throw new Error('User stop superseded rollback before data restoration')
            await this.runtime.store.restoreData(projectId, recovery.checkpoint)
            const afterRestore = await this.runtime.getProject(projectId)
            if (afterRestore.stopLatch || afterRestore.stopReason === 'user-stop') throw new Error('User stop superseded rollback during data restoration')
            await this.runtime.activateVersion(projectId, recovery.previousVersionId)
            const beforeRestart = await this.runtime.getProject(projectId)
            if (recovery.restart && !beforeRestart.stopLatch && beforeRestart.stopReason !== 'user-stop') await this.runtime.start(projectId)
          }
        } catch (rollbackError) { error.rollbackError = rollbackError.message }
      }
      await this.update(projectId, {
        status: 'failed', lastError: boundedFailureText(error.message), completedAt: new Date().toISOString(),
        ownerNotification: {
          messageId: `mod-owner-outcome-${requirementId}-failed`, state: 'pending', outcome: 'failed',
          attempts: 0, lastError: null, nextAttemptAt: null, updatedAt: new Date().toISOString(),
        },
      })
      // Failure delivery uses the same durable outbox; it never changes the
      // publish/rollback result above.
      this.scheduleOwnerDelivery(0); throw error
    }
  }
  async deliverIncidents() {
    // A host may have claimed just before a crash. Re-read its own durable
    // claim on recovery so it can complete the same stable-id delivery; an
    // incident delivered to a maintenance session remains deliberately not
    // resolved until a later receipt-backed repair action.
    const incidents = (await this.runtime.listIncidents()).filter(incident => incident.status === 'pending' || (incident.status === 'claimed' && incident.claimed_by === incident.maintainerSessionId))
    for (const incident of incidents) {
      if (this.delivery.has(incident.incidentId)) continue
      this.delivery.set(incident.incidentId, true)
      try {
        const session = this.ctx.sessions?.get(incident.maintainerSessionId)
        if (!session) continue // durable pending; agent/session recovery retries it.
        await this.runtime.claimIncident(incident.incidentId, incident.maintainerSessionId)
        const marker = `mod-incident:${incident.incidentId}`
        // Search raw events too: a compacted or otherwise hidden notification
        // is still a delivered inbox item and must retain its stable id.
        const existing = [...(session.events ?? [])].map(event => event.data).find(message => message?.id === `mod-incident-${incident.incidentId}` || (message?.source?.plugin === 'weftmate-mod-projects' && message.source?.sections?.some(section => section.name === 'mod-incident' && section.text === marker)))
        const message = existing ?? freezeMessage({ id: `mod-incident-${incident.incidentId}`, role: 'user', content: [{ type: 'text', text: `A durable Mod incident needs maintenance. Incident id: ${incident.incidentId}. Project: ${incident.projectId}. This notice is delivery only; inspect and repair through the Mod project tools. Automatic repair is limited to three turns.` }], source: { kind: 'plugin', plugin: 'weftmate-mod-projects', form: 'snapshot', sections: [{ name: 'mod-incident', text: marker }] } })
        const appended = existing ? null : session.append('user/message', message, { surfaceOp: 'append' })
        // SessionStore.flush is the public checkpoint barrier: acknowledgement
        // is forbidden until an inbox append is durable.
        if (this.options.flushSession) await this.options.flushSession(incident.maintainerSessionId, session)
        else await this.ctx.sessions.flush?.(session)
        await this.runtime.ackIncident(incident.incidentId, incident.maintainerSessionId, { messageId: message.id, sessionSequence: appended?.seq ?? session.seq })
      } finally { this.delivery.delete(incident.incidentId) }
    }
  }
  async deliverRequirements() {
    const delivery = new Map()
    for (const project of await this.runtime.listProjects()) {
      for (const requirement of await this.runtime.listRequirements(project.projectId)) {
        if (requirement.status === 'resolved') continue
        const session = this.ctx.sessions?.get(project.maintainerSessionId)
        if (!session) continue
        const messageId = `mod-requirement-${requirement.requirementId}`
        const existing = [...(session.events ?? [])].map(event => event.data).find(message => message?.id === messageId)
        if (existing || this.requirementDelivery.has(messageId)) continue
        const message = freezeMessage({ id: messageId, role: 'user', content: [{ type: 'text', text: `A Mod requirement was recorded for maintenance. Requirement id: ${requirement.requirementId}. Project: ${project.projectId}. Requirement: ${requirement.text}` }], source: { kind: 'plugin', plugin: 'weftmate-mod-projects', form: 'snapshot', sections: [{ name: 'mod-requirement', text: requirement.requirementId }] } })
        const agent = this.options.resolveAgent?.(project.maintainerSessionId) ?? this.ctx.agents?.get?.(project.maintainerSessionId)
        // followup is the formal AgentLoop wake path.  A cold/recovering
        // session keeps a durable inbox record and is resumed by DSH later;
        // this method never fabricates a synchronous model dispatch.
        if (agent?.followup) { this.requirementDelivery.set(messageId, 'followup'); agent.followup(message); delivery.set(project.projectId, 'followup') }
        else { this.requirementDelivery.set(messageId, 'queued'); session.append('user/message', message, { surfaceOp: 'append' }); delivery.set(project.projectId, 'queued') }
        if (this.options.flushSession) await this.options.flushSession(project.maintainerSessionId, session)
        else await this.ctx.sessions.flush?.(session)
      }
    }
    return delivery
  }
  deliverOwnerOutcomes(options = {}) {
    const operation = this.ownerDeliveryChain.catch(() => {}).then(() => this.#deliverOwnerOutcomes(options))
    this.ownerDeliveryChain = operation
    return operation
  }
  async #deliverOwnerOutcomes({ ownerSessionId: onlyOwnerSessionId = null } = {}) {
    // Completion is a durable maintenance result, never a user acceptance.
    // Keep its receipt in host-update.json before touching an inbox so a
    // process crash can resume exactly the same message after restart.
    for (const project of await this.runtime.listProjects()) {
      if (onlyOwnerSessionId && this.owner(project.projectId) !== onlyOwnerSessionId) continue
      const update = await this.update(project.projectId)
      if (!['completed', 'failed'].includes(update.status) || !update.requirementId) continue
      const notification = update.ownerNotification
      if (notification?.state === 'delivered' || notification?.state === 'suppressed_by_same_session' || notification?.state === 'owner_missing' || notification?.state === 'owner_cancelled' || notification?.state === 'delivery_exhausted') continue
      const messageId = notification?.messageId ?? `mod-owner-outcome-${update.requirementId}-${update.status}`
      const due = Date.parse(notification?.nextAttemptAt ?? '')
      const now = this.options.ownerDeliveryNow?.() ?? Date.now()
      if (Number.isFinite(due) && due > now) { this.scheduleOwnerDelivery(due - now); continue }
      if (this.ownerDelivery.has(messageId)) continue
      this.ownerDelivery.set(messageId, true)
      try {
        const ownerSessionId = this.owner(project.projectId)
        if (typeof ownerSessionId !== 'string' || !ownerSessionId) {
          await this.update(project.projectId, { ownerNotification: { messageId, state: 'owner_missing', outcome: update.status, updatedAt: new Date().toISOString() } })
          continue
        }
        const session = this.ctx.sessions?.get(ownerSessionId)
        const agent = this.options.resolveAgent?.(ownerSessionId) ?? this.ctx.agents?.get?.(ownerSessionId)
        if (ownerSessionId === project.maintainerSessionId) {
          // complete is already a tool result in this maintenance turn.  A
          // followup to the same AgentLoop creates a duplicate user turn.
          await this.update(project.projectId, { ownerNotification: { messageId, state: 'suppressed_by_same_session', outcome: update.status, ownerSessionId, deliveredAt: new Date().toISOString() } })
          continue
        }
        if (!session || !agent?.followup) {
          await this.update(project.projectId, { ownerNotification: { messageId, state: 'pending_offline', outcome: update.status, ownerSessionId, attempts: Number(notification?.attempts ?? 0), lastError: null, nextAttemptAt: null, updatedAt: new Date().toISOString() } })
          continue
        }
        await this.update(project.projectId, { ownerNotification: { messageId, state: 'prepared', outcome: update.status, ownerSessionId, attempts: Number(notification?.attempts ?? 0), updatedAt: new Date().toISOString() } })
        const marker = `mod-owner-outcome:${project.projectId}:${update.requirementId}:${update.status}`
        const existing = [...(session.events ?? [])].map(event => event.data).find(message => message?.id === messageId || message?.source?.sections?.some(section => section.name === 'mod-owner-outcome' && section.text === marker))
        const text = update.status === 'completed'
          ? '后台维护已完成并发布了候选版本。请在 Mod 业务界面自行查看结果；这不是用户验收。'
          : `后台维护未完成：${update.lastError || '维护过程失败'}。当前 Mod 未自动重启；请按需要查看状态或重新发起维护。`
        const message = existing ?? freezeMessage({ id: messageId, role: 'user', content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'weftmate-mod-projects', form: 'snapshot', sections: [{ name: 'mod-owner-outcome', text: marker }] } })
        // AgentLoop.followup owns durable inbox append and wake-up as one
        // operation. Appending here first would create two user turns.
        if (!existing) await agent.followup(message)
        await this.update(project.projectId, { ownerNotification: { messageId, state: 'delivered', outcome: update.status, ownerSessionId, deliveredAt: new Date().toISOString() } })
      } catch (error) {
        // A followup/flush/status failure is delivery-only.  The successfully
        // published version and its running state remain untouched; retry is
        // bounded and resumes from this durable outbox after restart.
        const attempts = Math.min(3, Number(notification?.attempts ?? 0) + 1)
        await this.update(project.projectId, {
          ownerNotification: {
            messageId, state: attempts >= 3 ? 'delivery_exhausted' : 'pending_retry', outcome: update.status,
            ownerSessionId: this.owner(project.projectId) ?? null, attempts,
            lastError: boundedFailureText(error?.message ?? String(error)),
            nextAttemptAt: attempts >= 3 ? null : new Date(now + (this.options.ownerDeliveryRetryBaseMs ?? 1_000) * (2 ** attempts)).toISOString(), updatedAt: new Date().toISOString(),
          },
        }); if (attempts < 3) this.scheduleOwnerDelivery((this.options.ownerDeliveryRetryBaseMs ?? 1_000) * (2 ** attempts))
      } finally { this.ownerDelivery.delete(messageId) }
    }
  }
  scheduleOwnerDelivery(delayMs) {
    if (this.ownerDeliveryClosed) return
    const now = this.options.ownerDeliveryNow?.() ?? Date.now()
    const boundedDelay = Math.max(0, Number(delayMs) || 0)
    const dueAt = now + boundedDelay
    if (boundedDelay === 0 && !this.ownerDeliveryTimer) {
      this.ownerDeliveryCycle = this.deliverOwnerOutcomes().catch(() => {})
      return
    }
    if (this.ownerDeliveryTimer) {
      if (this.ownerDeliveryDueAt !== null && this.ownerDeliveryDueAt <= dueAt) return
      const clearTimer = this.options.clearOwnerDeliveryTimer ?? clearTimeout
      clearTimer(this.ownerDeliveryTimer)
      this.ownerDeliveryCycleResolve?.()
      this.ownerDeliveryTimer = null
    }
    const setTimer = this.options.setOwnerDeliveryTimer ?? setTimeout
    this.ownerDeliveryDueAt = dueAt
    let resolveCycle
    this.ownerDeliveryCycle = new Promise(resolve => { resolveCycle = resolve })
    this.ownerDeliveryCycleResolve = resolveCycle
    this.ownerDeliveryTimer = setTimer(() => {
      this.ownerDeliveryTimer = null
      this.ownerDeliveryDueAt = null
      if (this.ownerDeliveryClosed) { resolveCycle(); return }
      void this.deliverOwnerOutcomes().catch(() => {}).finally(resolveCycle)
    }, boundedDelay)
    this.ownerDeliveryTimer?.unref?.()
  }
  async waitForOwnerDeliveryIdle() {
    await this.ownerDeliveryCycle
    await this.ownerDeliveryChain.catch(() => {})
  }
  disposeOwnerDelivery() {
    this.ownerDeliveryClosed = true
    if (this.ownerDeliveryTimer) {
      const clearTimer = this.options.clearOwnerDeliveryTimer ?? clearTimeout
      clearTimer(this.ownerDeliveryTimer)
      this.ownerDeliveryTimer = null
      this.ownerDeliveryDueAt = null
    }
    this.ownerDeliveryCycleResolve?.()
    this.ownerDeliveryCycleResolve = null
  }
}

async function hostValidation({ validationRoot, receipt }) {
  if (!receipt?.assertions?.length) return { ok: false, message: 'No candidate project-test evidence exists' }
  // Candidate state is not a passed marker. This is a host-owned isolated plan.
  const state = JSON.parse(await readFile(join(validationRoot, 'state.json'), 'utf8').catch(() => 'null'))
  if (state?.validation !== true || state?.started === true) return { ok: false, message: 'Host isolated validation plan was not satisfied' }
  return { ok: true, receipt: { kind: 'host-isolated-state-plan', observed: 'validation=true' } }
}
export async function dshModelBroker(ctx, options, input) {
  const agent = options.agents?.get?.(input.maintenanceSessionId) ?? ctx.agents?.get?.(input.maintenanceSessionId)
  const session = agent?.session ?? ctx.sessions?.get?.(input.maintenanceSessionId)
  const logged = session?.requestHeader?.()?.config
  const target = logged ?? (agent?.options?.provider && agent?.options?.model
    ? { provider: agent.options.provider, model: agent.options.model }
    : ctx.agentDefaultModel?.currentSelection?.() ?? options.defaultModelSelection?.())
  if (!target?.provider || !target?.model) throw new Error('No maintenance-session DSH provider/model route is available')
  // One new message only: no maintenance-chat history is implicitly mixed in.
  const message = createUserMessage({ content: [{ type: 'text', text: JSON.stringify(input.input ?? null) }], source: { kind: 'plugin', plugin: 'weftmate-mod-projects', form: 'snapshot', sections: [{ name: 'mod-model-request', text: `${input.projectId}:${input.versionId}:${input.runId}` }] } })
  const chunks = []
  for await (const chunk of ctx.llm.stream({ provider: target.provider, model: target.model, messages: [message], sessionId: session?.id, signal: input.signal })) chunks.push(chunk)
  return textFromStream(chunks)
}

export function createModProjectsService(ctx, options = {}) {
  let hostService
  const runtime = new ModProjectRuntime({
    root: options.root ?? join(process.env.DSH_HOME ?? process.cwd(), 'mod-projects'),
    model: async input => options.modelBroker ? options.modelBroker(input) : dshModelBroker(ctx, options, { ...input, maintenanceSessionId: (await runtime.getProject(input.projectId)).maintainerSessionId }),
    validationModel: options.validationModel ?? (async () => ({ validation: 'keyless-host-validator' })),
    assertValidation: options.assertValidation ?? (async input => {
      const manifest = (await runtime.store.version(input.projectId, input.versionId))?.manifest
      const defaultTemplate = JSON.stringify(manifest) === JSON.stringify(EXTERNAL_AGENT_TEMPLATE.manifest)
      // A custom project can be trialled after its isolated project self-test.
      // Its receipt makes the limited evidence explicit; a deployment may pass
      // assertValidation for a real business scenario without inventing a DSL.
      if (!defaultTemplate) return { ok: true, receipt: { kind: 'project-self-test-only', scenarioValidated: false, message: 'No independent business-scenario plan is registered for this custom Mod' } }
      return hostValidation(input)
    }),
    emit: async event => { if (event.type === 'mod.incident') queueMicrotask(() => { void hostService?.deliverIncidents() }); if (event.type === 'mod.requirement') queueMicrotask(() => { void hostService?.deliverRequirements() }); return { accepted: true } },
  })
  hostService = new ModHostService(ctx, options, runtime)
  return { runtime, service: hostService, ready: runtime.open().then(() => hostService.open()).then(() => hostService.restoreMaintenanceWorkspaces()).then(() => hostService.deliverOwnerOutcomes()).then(() => hostService) }
}

async function toolAction(service, args, exec) {
  const sessionId = sid(exec); if (!sessionId) throw new Error('A DSH session is required')
  await service.ready
  if (service.service.isModMaintainerSession(sessionId)) throw new Error('mod_project is unavailable to a mod-maintainer session; use the server-bound mod_sdk tool')
  if (args.action === 'list') return service.service.list(sessionId)
  if (args.action === 'create') {
    const value = await service.service.create(sessionId, { ...args, initialRequirement: latestUserRequirement(exec?.agent?.session) })
    if (['generating', 'queued', 'needs_host_maintenance'].includes(value.creation?.state) && service.service.pauseOwnerGoal(exec?.agent)) {
      value.creation.ownerGoalPaused = true
      value.creation.ownerMessage = value.creation.state === 'needs_host_maintenance'
        ? '宿主已暂停当前目标；内部维护当前不可用。只报告创建失败并结束本回合；业务尚未完成，不要写源码、创建候选、验证或轮询。'
        : '宿主已暂停当前目标，等待内部维护。只报告当前创建状态并结束本回合；业务尚未完成，不要写源码、创建候选、验证或轮询。'
    } else if (value.creation) value.creation.ownerGoalPaused = false
    service.service.restrictCreationTurn(exec?.agent)
    // This formal ToolRunContext boundary keeps the owner from taking another
    // model step after it has delegated work to the maintenance session.
    // The structured create result is still returned to the owner normally.
    exec.concludeTurn()
    return value
  }
  if (args.action === 'import') return service.service.import(sessionId, args.directory, args)
  if (!args.project_id) throw new Error('project_id is required')
  await service.service.assertAccess(args.project_id, sessionId)
  if (args.action === 'candidate') return service.runtime.createCandidate(args.project_id)
  if (args.action === 'validate') return service.runtime.validateVersion(args.project_id, args.version_id)
  if (args.action === 'activate') return service.runtime.activateVersion(args.project_id, args.version_id)
  if (args.action === 'start') return service.runtime.start(args.project_id) // Agent cannot clear stopLatch.
  if (args.action === 'stop') return service.runtime.stop(args.project_id)
  if (args.action === 'status') return service.runtime.inspectRun(args.project_id)
  if (args.action === 'requirement') { const requirement = await service.runtime.recordRequirement(args.project_id, { text: args.text, sessionId, origin: { kind: 'plugin-relay', tool: 'mod_project' } }); await service.service.deliverRequirements(); return requirement }
  if (args.action === 'complete_update') return service.service.completeUpdate(args.project_id, args.requirement_id, args.behavior_checks, { signal: exec?.signal })
  throw new Error('Unsupported action')
}

function latestUserRequirement(session) {
  const message = [...(session?.deriveMessages?.() ?? [])].reverse().find(item => item?.source?.kind === 'user' && typeof item.id === 'string')
  const text = message?.content?.filter(block => block?.type === 'text').map(block => block.text).join('\n')
  return typeof text === 'string' && text.trim() ? { text, messageId: message.id } : null
}

export function createModProjectsHandler(service) {
  return async (req, res) => {
    const url = new URL(req.url, 'http://weftmate.invalid')
    try {
      if (req.method === 'GET' && url.pathname === '/weftmate/mods/bridge.mjs') {
        if (req.headers.origin && !sameOrigin(req)) return send(res, 403, { error: 'Origin rejected' })
        const source = await service.readBridgeModule()
        res.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'text/javascript; charset=utf-8', 'x-content-type-options': 'nosniff' })
        return res.end(source)
      }
      if (req.method === 'GET' && url.pathname === '/weftmate/mods/state.mjs') {
        if (req.headers.origin && !sameOrigin(req)) return send(res, 403, { error: 'Origin rejected' })
        return sendText(res, 200, await readFile(new URL('./weftmate-client/mod-state.mjs', import.meta.url), 'utf8'), 'text/javascript; charset=utf-8')
      }
      if (req.method === 'GET' && url.pathname === '/weftmate/mods/window.html') return sendText(res, 200, MOD_WINDOW_HTML, 'text/html; charset=utf-8')
      if (req.method === 'GET' && url.pathname === '/weftmate/mods/window.css') return sendText(res, 200, MOD_WINDOW_CSS, 'text/css; charset=utf-8')
      if (req.method === 'GET' && url.pathname === '/weftmate/mods/window.js') return sendText(res, 200, MOD_WINDOW_JS, 'text/javascript; charset=utf-8')
      if (req.method === 'GET' && url.pathname === '/weftmate/mods/v2-shell/skeleton.css') return sendText(res, 200, await readFile(new URL('./weftmate-client/v2-shell/skeleton-v2.scoped.css', import.meta.url), 'utf8'), 'text/css; charset=utf-8')
      if (req.method === 'GET' && url.pathname === '/weftmate/mods/v2-shell/pages.css') return sendText(res, 200, await readFile(new URL('./weftmate-client/v2-shell/pages-v2.scoped.css', import.meta.url), 'utf8'), 'text/css; charset=utf-8')
      if (req.method === 'GET' && url.pathname === '/weftmate/mods/window/snapshot') {
        if (!sameOrigin(req)) return send(res, 403, { error: 'Origin rejected' })
        const projectId = url.searchParams.get('project_id'), sessionId = url.searchParams.get('session_id')
        if (!validId(projectId) || !validId(sessionId)) throw new Error('A valid project_id and session_id are required')
        const previousFrame = url.searchParams.get('frame_token')
        if (previousFrame) service.verifyFrame(projectId, sessionId, previousFrame)
        return send(res, 200, await service.detail(projectId, sessionId))
      }
      if (req.method === 'GET' && url.pathname === '/weftmate/mods/projects.json') return send(res, 200, { projects: await service.list(url.searchParams.get('session_id')) })
      if (req.method === 'GET' && url.pathname.startsWith('/weftmate/mods/assets/')) {
        const [projectId, sessionId, token, ...parts] = url.pathname.slice('/weftmate/mods/assets/'.length).split('/')
        await service.assertAccess(projectId, sessionId); const frame = service.verifyFrame(projectId, sessionId, token)
        const asset = await service.runtime.readUiAsset(projectId, parts.join('/'), { versionId: frame.versionId })
        return sendAsset(res, asset)
      }
      if (req.method !== 'POST' || url.pathname !== '/weftmate/mods/request') return send(res, 404, { error: 'Not found' })
      if (!sameOrigin(req)) return send(res, 403, { error: 'Origin rejected' })
      const input = await body(req); const sessionId = input.session_id
      if (!validId(sessionId)) throw new Error('A valid session_id is required')
      let value
      if (input.action === 'list') value = { projects: await service.list(sessionId) }
      else if (input.action === 'create-template') value = await service.create(sessionId, input)
      else if (input.action === 'import') value = await service.import(sessionId, input.directory, input)
      else {
        const accessibleProject = await service.assertAccess(input.project_id, sessionId)
        if (input.action === 'detail') value = await service.detail(input.project_id, sessionId)
        else if (input.action === 'candidate') value = await service.runtime.createCandidate(input.project_id)
        else if (input.action === 'validate') value = await service.runtime.validateVersion(input.project_id, input.version_id)
        else if (input.action === 'select') value = await service.runtime.activateVersion(input.project_id, input.version_id)
        else if (input.action === 'start') value = await service.runtime.start(input.project_id, { userInitiated: input.user_initiated === true })
        else if (input.action === 'stop') value = await service.runtime.stop(input.project_id)
        else if (input.action === 'status') value = await service.runtime.inspectRun(input.project_id)
        else if (input.action === 'asset') value = await service.detail(input.project_id, sessionId)
        else if (input.action === 'invoke') { service.verifyFrame(input.project_id, sessionId, input.frame_token, accessibleProject.activeVersionId ?? accessibleProject.active_version_id ?? null); value = await service.runtime.invokeUi(input.project_id, input.request) }
        else if (input.action === 'requirement') { value = await service.runtime.recordRequirement(input.project_id, { text: input.text, sessionId, origin: { kind: 'user', messageId: input.message_id ?? null } }); await service.deliverRequirements() }
        else if (input.action === 'complete-update') value = await service.completeUpdate(input.project_id, input.requirement_id, input.behavior_checks)
        else throw new Error('Unsupported action')
      }
      return send(res, 200, value)
    } catch (error) { return send(res, error.status ?? 400, { error: error.message }) }
  }
}

export function registerModProjects(ctx, options = {}) {
  const service = createModProjectsService(ctx, options)
  ctx.inject(['tools', 'sessions', 'webServer'], host => {
    host.tools.register(defineTool({ name: 'mod_project', description: 'Manage durable multi-file Node ESM Mods for their owner. create accepts only a name and the current user goal; it delegates source generation and validation to the isolated maintenance session, then ends the owner turn. The owner must not supply files, manifests, project paths, candidate actions, or polling work.', parameters: { action: { type: 'string', required: true, enum: ['list', 'create', 'import', 'candidate', 'validate', 'activate', 'start', 'stop', 'status', 'requirement', 'complete_update'] }, project_id: { type: 'string' }, name: { type: 'string' }, directory: { type: 'string' }, files: { type: 'json' }, manifest: { type: 'json' }, version_id: { type: 'string' }, requirement_id: { type: 'string' }, text: { type: 'string' }, behavior_checks: behaviorCheckParameter }, output: { schema: { type: 'json' }, render: (_a, value) => reply(value).content }, execute: (args, exec) => toolAction(service, args, exec) }))
    host.tools.register(defineTool({ name: 'mod_sdk', description: 'Server-bound Mod development SDK. An unbound formal mod-maintainer session may use describe or create with only a name to create its first bound skeleton. Once bound, use list/read/write/edit/manifest_read/manifest_update/check/complete for that one project. behavior_checks is a direct array of numeric-state or result/state expectation checks; use result.items.length or state.items.length for arrays. It accepts no project id, directory, shell command, import, activation, or lifecycle-control argument.', parameters: { action: { type: 'string', required: true, enum: ['describe', 'create', 'list', 'read', 'write', 'edit', 'manifest_read', 'manifest_update', 'status', 'check', 'complete'] }, name: { type: 'string' }, path: { type: 'string' }, content: { type: 'string' }, manifest: { type: 'json' }, expected_sha256: { type: 'string' }, find: { type: 'string' }, replace: { type: 'string' }, behavior_checks: behaviorCheckParameter }, output: { schema: { type: 'json' }, render: (_a, value) => reply(value).content }, execute: (args, exec) => service.service.sdkAction(args, exec) }))
    host.tools.guard(exec => {
      const sessionId = sid(exec)
      if (sessionId && service.service.isModMaintainerSession(sessionId) && exec.name === 'mod_project') return 'mod_project is denied for a mod-maintainer session; use server-bound mod_sdk'
      if (sessionId && !service.service.isModMaintainerSession(sessionId) && exec.name === 'mod_sdk') {
        if (service.service.canInitializeModMaintainerSession(exec)) return service.service.creationTurnGuard(exec)
        if (service.service.isFormalUnboundMaintainerSession(exec?.agent?.session)) return 'This formal mod-maintainer session has no bound Mod yet. Use mod_sdk describe, then mod_sdk create with only a name when the user asks to create a Mod.'
        return 'mod_sdk is denied for user chat sessions; use mod_project to create or maintain a Mod.'
      }
      return service.service.creationTurnGuard(exec)
    })
    host.on('session/event', (session, event) => { if (event.type === 'turn/end') service.service.releaseCreationTurn(session?.id) })
    host.on('agent/pre-step', async (payload, next) => {
      const decision = await next()
      if (decision.kind !== 'enter') return decision
      const sessionId = payload.agent?.session?.id
      if (!sessionId) return decision
      const projects = (await service.runtime.listProjects()).filter(project => project.maintainerSessionId === sessionId)
      if (!projects.length) return decision
      const user = [...(payload.messages ?? [])].reverse().find(message => message?.source?.kind === 'user')
      const additions = []
      for (const project of projects) {
        if (user) await service.service.captureRequirement(project.projectId, sessionId, user)
        const requirement = (await service.runtime.listRequirements(project.projectId)).find(item => item.status !== 'resolved')
        if (!requirement) continue
        const marker = `mod-maintenance:${project.projectId}:${requirement.requirementId}`
        if ((payload.agent.session.deriveMessages?.() ?? []).some(message => message.source?.sections?.some(section => section.text === marker)) || decision.messages?.some(message => message.source?.sections?.some(section => section.text === marker))) continue
        const restricted = project.maintenance_preset === MOD_MAINTAINER_PRESET
        const guide = restricted
          ? `You maintain one server-bound Mod project. Current user goal: ${requirement.text}. First call mod_sdk describe, then list/read to learn the bounded source and SDK lifecycle. Implement the actual requested business behavior yourself with mod_sdk write/edit. Use check for isolated validation, then complete with explicit behavior_checks after the real edit; the host publishes without a version-selection step. The starter source is generic. Shared UI and memory are unavailable. Do not use a shell, import, create another Mod, select/start/stop a version, install dependencies, use network, access memory, or request a path/project id. After completion, reply in concise Chinese describing the actual behavior and any retained existing data; do not expose IDs, workspace paths, JSON, or tool parameters.`
          : `You maintain Mod project ${project.projectId}. Workspace: ${await service.runtime.workspacePath(project.projectId)}. Current user requirement: ${requirement.text}. Use existing DSH read/write/edit tools to modify the workspace. After the real edit, call mod_project complete_update with project_id ${project.projectId}, requirement_id ${requirement.requirementId}, and explicit behavior_checks that execute the requested behavior in isolated state. For a request to make increment add 2, use [{action:'increment',steps:2,stateField:'count',expectedDelta:4}]. Do not claim a business behavior from a bare passed flag. After complete_update succeeds, reply in concise Chinese for the user: state the actual behavior changed, that existing data was retained, and that they can check the Mod business interface. Unless the user explicitly asks, do not show project/requirement/version ids, workspace or file paths, behavior_checks, tool parameters, JSON, or other engineering execution details.`
        additions.push(createUserMessage({ content: [{ type: 'text', text: guide }], source: { kind: 'plugin', plugin: 'weftmate-mod-projects', form: 'snapshot', sections: [{ name: 'mod-maintenance-update', text: marker }] } }))
      }
      return additions.length ? { ...decision, messages: [...decision.messages, ...additions] } : decision
    })
    host.effect(() => host.webServer.register({ kind: 'prefix', path: '/weftmate/mods', handler: createModProjectsHandler(service.service) }))
    host.effect(() => () => service.service.disposeOwnerDelivery(), 'weftmate-mod-projects: owner outcome timer')
    host.on('agent/created', ({ agent }) => {
      const ownerSessionId = agent?.id ?? agent?.session?.id
      return service.ready.then(() => Promise.all([
        service.service.deliverIncidents(),
        typeof ownerSessionId === 'string'
          ? service.service.deliverOwnerOutcomes({ ownerSessionId })
          : Promise.resolve(),
      ]))
    })
  })
  return service
}
export function apply(ctx) { registerModProjects(ctx) }
export default { name, inject, apply }
