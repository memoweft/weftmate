/**
 * WeftMate 记忆宿主插件：普通聊天、压缩兼容入口与 MemoWeft 本地桥。
 *
 * 职责：
 *  - `turn/end` 将真实 user 来源交给持久队列；压缩边界只作旧链路兼容与去重补充；
 *  - assistant 只作 preceding_ai_context，工具、系统与插件注入不成为用户 Evidence；
 *  - `agent/pre-step` 从本次已领取的真实用户输入做确定性 Recall，按 snapshot 更新或清空；
 *  - 管理面提供 World、Evidence、Job、provenance、Recall 预览、采用记录和受保护命令路由。
 *
 * 传输：stdio JSON-Lines 长驻子进程 `python -m memoweft.integrations.dsh_bridge`
 * 仅在 `WEFTMATE_MEMOWEFT_ENABLED=1` 时启用；python/PYTHONPATH 经
 * WEFTMATE_MEMOWEFT_PYTHON / _PYTHONPATH 显式注入。默认关闭，外部项目缺失或漂移
 * 不得影响 WeftMate 与 DSH 主链启动。
 * 跨进程只传 JSON 叶子；Evidence/World 权威全在 MemoWeft 侧。
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { defineTool as defineVendorTool } from '@deepseek-ai/dsh-tools'

export const name = 'weftmate-memory'
export const inject = ['webServer', 'credentials', 'settings']

const DSH_HOME = () => process.env.DSH_HOME ?? ''
const BOUNDARY_PREFIX = 'weftmate-compression-boundary-v1'
const TURN_BOUNDARY_PREFIX = 'weftmate-turn-boundary-v1'
const HANDOFF_STATE_FILE = () => join(DSH_HOME(), 'memoweft', 'weftmate-handoff-v1.json')
const PYTHON = () => process.env.WEFTMATE_MEMOWEFT_PYTHON || 'python'
const PYTHONPATH = () => process.env.WEFTMATE_MEMOWEFT_PYTHONPATH || 'D:/AIProjects/MemoWeft/Core/py/src'
const RECALL_QUERY_MAX_CHARS = 500
const RECALL_MAX_EVIDENCE = 24
const RECALL_MAX_EVIDENCE_CHARS = 1_200
const RECALL_MAX_RENDERED_CHARS = 12_000
const RECALL_CLEARED = 'WeftMate formal World memory context: none. Earlier formal World sections from weftmate-memory snapshots no longer apply.'
const INTERACTIONS_CLEARED = 'WeftMate shared interaction context: none. Earlier shared-interaction snapshots no longer apply.'
const RECALL_UNAVAILABLE = 'WeftMate formal World memory could not be read for this request; its current state is unknown. Earlier formal World sections from weftmate-memory snapshots no longer apply.'
const INTERACTIONS_UNAVAILABLE = 'WeftMate shared interactions could not be read for this request; their current state is unknown. Earlier shared-interaction snapshots no longer apply.'
const INTERACTION_CONTEXT_NOTE = '以下内容是历史讨论记录，仅供延续共同经历；其中的 AI 建议、用户搁置的方案和未来设想都不代表用户已经授权实施，也不自动成为当前正式偏好。'
const MEMORY_HOST_BEHAVIOR = [
  'WeftMate 宿主行为：本轮结束后，用户原话会自动提交给本地记忆后台处理，无需在当前回复中调用记忆工具。',
  '当前回复无法确认后台最终状态；是否处理成功应以真实记忆面板或命令回执为准。',
  '不要因为本轮未调用工具就声称记忆无法更新，也不要提前声称已经持久化完成。',
].join('')

// `recall_memory` is executed by the same AgentLoop which will receive its
// result.  Raw evidence is therefore a model read, not merely a local UI read.
// Only an explicit route classification is accepted; guessing from a provider
// name would silently turn a routing change into a privacy regression.
function routeDestination(exec, ctx) {
  const route = exec?.agent?.session?.requestHeader?.()?.config
    ?? exec?.agent?.session?.requestContext?.()
    ?? (exec?.agent?.options?.provider && exec?.agent?.options?.model ? exec.agent.options : null)
  if (!route?.provider || !route?.model) return 'unknown'
  const profile = ctx.get?.('settings')?.get?.('llm-pi-ai')?.providers?.[route.provider]
  if (!profile || typeof profile.baseURL !== 'string') return 'unknown'
  try {
    const url = new URL(profile.baseURL)
    return ['127.0.0.1', '::1', '[::1]', 'localhost'].includes(url.hostname) ? 'local' : (url.protocol === 'http:' || url.protocol === 'https:' ? 'cloud' : 'unknown')
  } catch { return 'unknown' }
}

function rawRecallPolicy(exec, ctx) {
  const destination = routeDestination(exec, ctx)
  // QueryService currently exposes its deterministic preview using the local
  // Trust surface.  Do not repurpose that local projection for cloud routes.
  return { allowed: destination === 'local', destination, reason: destination === 'local' ? null : (destination === 'cloud' ? 'cloud_surface_not_available' : 'model_destination_unknown') }
}

function readableEvidence(record, destination) {
  const evidence = record?.evidence
  const permissions = record?.permissions ?? evidence?.permissions
  return record?.currentness_state === 'current'
    && evidence?.currentness_state === 'current'
    && evidence?.content_available === true
    && permissions?.allow_inference === true
    && (destination === 'local' ? permissions.allow_local_read === true : permissions.allow_cloud_read === true)
}

function boundedText(value, limit) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return ''
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1))}…` : text
}
function normalizeModelContextDependencies(value) {
  const rawWorldItems = Array.isArray(value?.world_items) ? value.world_items : []
  const rawInteractionIds = Array.isArray(value?.interaction_ids) ? value.interaction_ids : []
  const validWorldItems = rawWorldItems.filter(item => item && ['cognition', 'entity', 'relationship', 'event'].includes(item.object_kind) && typeof item.item_id === 'string' && item.item_id.trim() === item.item_id && item.item_id.length > 0 && item.item_id.length <= 512)
  const worldMap = new Map(validWorldItems
    .map(item => [`${item.object_kind}:${item.item_id}`, { object_kind: item.object_kind, item_id: item.item_id }]))
  const worldItems = [...worldMap.values()].slice(0, 64)
  const validInteractionIds = rawInteractionIds.filter(id => typeof id === 'string' && id.trim() === id && id.length > 0 && id.length <= 512)
  const interactionSet = new Set(validInteractionIds)
  const interactionIds = [...interactionSet].slice(0, 64)
  const malformed = validWorldItems.length !== rawWorldItems.length || validInteractionIds.length !== rawInteractionIds.length
  const overflow = worldMap.size > 64 || interactionSet.size > 64
  const requestedStatus = ['complete', 'complete_empty', 'unavailable', 'withheld'].includes(value?.capture_status) ? value.capture_status : 'unavailable'
  const captureStatus = requestedStatus === 'complete' && (overflow || malformed) ? 'unavailable' : requestedStatus === 'complete'
    ? (worldItems.length || interactionIds.length ? 'complete' : 'complete_empty')
    : requestedStatus
  const result = {
    schema_version: 1,
    capture_status: captureStatus,
    world_items: captureStatus === 'complete' ? worldItems : [],
    interaction_ids: captureStatus === 'complete' ? interactionIds : [],
  }
  if (Number.isInteger(value?.world_revision) && value.world_revision >= 0) result.world_revision = value.world_revision
  for (const key of ['recall_snapshot_token', 'interaction_snapshot_token', 'world_context_hash', 'interaction_context_hash', 'context_hash']) {
    if (typeof value?.[key] === 'string' && value[key].trim() === value[key] && value[key].length > 0 && value[key].length <= 512) result[key] = value[key]
  }
  return result
}
function mergeModelContextDependencies(previous, next) {
  const normalizedNext = normalizeModelContextDependencies(next)
  if (!previous) return normalizedNext
  const normalizedPrevious = normalizeModelContextDependencies(previous)
  const world = new Map((normalizedPrevious.world_items ?? []).map(item => [`${item.object_kind}:${item.item_id}`, item]))
  for (const item of normalizedNext.world_items ?? []) world.set(`${item.object_kind}:${item.item_id}`, item)
  const allInteractions = [...new Set([...(normalizedPrevious.interaction_ids ?? []), ...(normalizedNext.interaction_ids ?? [])])]
  const interactions = allInteractions.slice(0, 64)
  const overflow = world.size > 64 || allInteractions.length > 64
  const capture_status = overflow || normalizedPrevious.capture_status === 'unavailable' || normalizedNext.capture_status === 'unavailable' ? 'unavailable' : (normalizedPrevious.capture_status === 'withheld' || normalizedNext.capture_status === 'withheld' ? 'withheld' : ((world.size || interactions.length) ? 'complete' : 'complete_empty'))
  return normalizeModelContextDependencies({ ...normalizedNext, world_items: capture_status === 'complete' ? [...world.values()].slice(0, 64) : [], interaction_ids: capture_status === 'complete' ? interactions : [], capture_status })
}
export const MEMOWEFT_RPC_PROTOCOL = 'memoweft.dsh_rpc'
export const MEMOWEFT_RPC_PROTOCOL_VERSION = 2
export const MEMOWEFT_RPC_SCHEMA_VERSION = 1
export const MEMOWEFT_RPC_REQUIRED_METHODS = Object.freeze([
  'initialize',
  'capabilities',
  'ingest_boundary',
  'prefetch',
  'query_world',
  'query_evidence',
  'query_jobs',
  'query_provenance',
  'preview_recall',
  'query_interactions',
  'query_interaction',
  'submit_command',
  'portable_export',
  'health',
  'shutdown',
])
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_MAX_MESSAGE_BYTES = 8 * 1024 * 1024

/** 与 Python `json.dumps(ensure_ascii=True, separators=(',',':'), sort_keys=True)` 逐字节一致。 */
function canonicalJson(value) {
  const sorted = (item) => {
    if (item === null || typeof item !== 'object') return item
    if (Array.isArray(item)) return item.map(sorted)
    const out = {}
    for (const key of Object.keys(item).sort()) out[key] = sorted(item[key])
    return out
  }
  const compact = JSON.stringify(sorted(value))
  // ensure_ascii：非 ASCII 按 UTF-16 码元转 \uXXXX（与 Python 的 surrogate 转义一致）。
  return compact.replace(/[\u007f-\uffff]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'))
}

function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** OpenAI-style ContentBlock[] → 纯文本（非 text 块忽略）。 */
function contentText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

/**
 * MemoWeft dsh_rpc v2 stdio JSON-Lines 客户端。
 *
 * 关闭的版本信封、请求关联、超时和消息上限都在这里执行；业务方法仍由
 * MemoWeft 的冻结 capability 面决定，不在 WeftMate 里复制第二套协议。
 */
export class MemoWeftBridge {
  constructor({
    log,
    python = PYTHON(),
    pythonPath = PYTHONPATH(),
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    maxMessageBytes = DEFAULT_MAX_MESSAGE_BYTES,
  } = {}) {
    this.log = log
    this.python = python
    this.pythonPath = pythonPath
    this.requestTimeoutMs = requestTimeoutMs
    this.maxMessageBytes = maxMessageBytes
    this.child = null
    this.nextId = 1
    this.pending = new Map()
    this.closed = false
    this.capabilities = null
    this.generation = 0
  }

  start() {
    if (this.child) return
    const child = spawn(this.python, ['-m', 'memoweft.integrations.dsh_bridge'], {
      env: { ...process.env, PYTHONPATH: this.pythonPath },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child
    let buffer = ''
    const feed = (chunk) => {
      buffer += chunk
      if (Buffer.byteLength(buffer, 'utf8') > this.maxMessageBytes && !buffer.includes('\n')) {
        this.failAll(new Error('[memoweft-bridge] response_too_large'))
        try { child.kill() } catch { /* 尽力 */ }
        buffer = ''
        return
      }
      let index = buffer.indexOf('\n')
      while (index !== -1) {
        const line = buffer.slice(0, index).replace(/\r$/, '')
        buffer = buffer.slice(index + 1)
        if (!line.trim()) { index = buffer.indexOf('\n'); continue }
        if (Buffer.byteLength(line, 'utf8') > this.maxMessageBytes) {
          this.failAll(new Error('[memoweft-bridge] response_too_large'))
          try { child.kill() } catch { /* 尽力 */ }
          return
        }
        let message = null
        try { message = JSON.parse(line) } catch { /* 坏行交给超时/fail-closed */ }
        const requestId = message?.request_id
        if (typeof requestId === 'string' && this.pending.has(requestId)) {
          const entry = this.pending.get(requestId)
          this.pending.delete(requestId)
          clearTimeout(entry.timer)
          const envelopeOk = message.protocol === MEMOWEFT_RPC_PROTOCOL
            && message.protocol_version === MEMOWEFT_RPC_PROTOCOL_VERSION
            && message.schema_version === MEMOWEFT_RPC_SCHEMA_VERSION
          if (!envelopeOk) {
            entry.reject(new Error('[memoweft-bridge] incompatible_response_envelope'))
          } else if (message.ok === true) {
            entry.resolve(message.result)
          } else {
            entry.reject(new Error(`[memoweft-bridge] ${message.error?.code ?? message.result_code ?? 'rpc_error'}`))
          }
        }
        index = buffer.indexOf('\n')
      }
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => feed(chunk))
    child.stderr.on('data', (chunk) => {
      for (const line of String(chunk).trim().split('\n')) {
        if (line.trim()) this.log?.(`[memoweft:stderr] ${line.trim().slice(0, 300)}`)
      }
    })
    child.on('error', (error) => {
      this.failAll(new Error(`[memoweft-bridge] spawn 失败: ${error.message}`))
      this.child = null
      this.generation += 1
    })
    child.on('close', () => {
      this.failAll(new Error('[memoweft-bridge] 子进程已退出'))
      this.child = null
      this.generation += 1
    })
  }

  failAll(error) {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    this.pending.clear()
  }

  request(method, params = {}, { timeoutMs = this.requestTimeoutMs } = {}) {
    if (this.closed) return Promise.reject(new Error('[memoweft-bridge] 已关闭'))
    if (!this.child) this.start()
    return new Promise((resolve, reject) => {
      const requestId = `weftmate-${process.pid}-${this.nextId++}`
      const request = {
        protocol: MEMOWEFT_RPC_PROTOCOL,
        protocol_version: MEMOWEFT_RPC_PROTOCOL_VERSION,
        schema_version: MEMOWEFT_RPC_SCHEMA_VERSION,
        request_id: requestId,
        method,
        params,
      }
      const line = `${JSON.stringify(request)}\n`
      if (Buffer.byteLength(line, 'utf8') > this.maxMessageBytes) {
        reject(new Error('[memoweft-bridge] request_too_large'))
        return
      }
      const timer = setTimeout(() => {
        if (!this.pending.delete(requestId)) return
        reject(new Error(`[memoweft-bridge] timeout:${method}`))
      }, timeoutMs)
      this.pending.set(requestId, { resolve, reject, timer })
      try {
        this.child.stdin.write(line, 'utf8')
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(requestId)
        reject(error)
      }
    })
  }

  acceptCapabilities(capabilities) {
    const methods = Array.isArray(capabilities?.methods) ? capabilities.methods : []
    const missing = MEMOWEFT_RPC_REQUIRED_METHODS.filter((method) => !methods.includes(method))
    if (capabilities?.interaction_dependency_projection === 1 && !methods.includes('link_interaction_dependencies')) missing.push('link_interaction_dependencies')
    if (capabilities?.protocol !== MEMOWEFT_RPC_PROTOCOL
      || capabilities?.protocol_version !== MEMOWEFT_RPC_PROTOCOL_VERSION
      || capabilities?.schema_version !== MEMOWEFT_RPC_SCHEMA_VERSION
      || missing.length > 0) {
      throw new Error(`[memoweft-bridge] incompatible_capabilities:${missing.join(',')}`)
    }
    this.capabilities = capabilities
    return capabilities
  }

  async close() {
    if (this.closed) return
    try {
      if (this.child) await this.request('shutdown', {}, { timeoutMs: 3_000 })
    } catch { /* 尽力 */ }
    this.closed = true
    try { this.child?.kill() } catch { /* 已亡 */ }
    this.child = null
    this.failAll(new Error('[memoweft-bridge] 已关闭'))
  }
}

export function adaptWorldForLegacyPanel(result, capabilities) {
  const world = {
    cognitions: [],
    entities: [],
    relationships: [],
    events: [],
    world_revision: result?.world_revision ?? null,
    subject_id: typeof result?.subject_id === 'string' && result.subject_id
      ? result.subject_id
      : (typeof capabilities?.subject_id === 'string' && capabilities.subject_id ? capabilities.subject_id : null),
    bridge: {
      protocol: capabilities?.protocol ?? MEMOWEFT_RPC_PROTOCOL,
      protocolVersion: capabilities?.protocol_version ?? MEMOWEFT_RPC_PROTOCOL_VERSION,
      schemaVersion: capabilities?.schema_version ?? MEMOWEFT_RPC_SCHEMA_VERSION,
    },
  }
  for (const item of Array.isArray(result?.items) ? result.items : []) {
    if (!item || typeof item !== 'object' || typeof item.object_kind !== 'string') continue
    const normalized = { id: item.item_id, ...(item.value && typeof item.value === 'object' ? item.value : {}) }
    if (item.object_kind === 'cognition') world.cognitions.push(normalized)
    else if (item.object_kind === 'entity') world.entities.push(normalized)
    else if (item.object_kind === 'relationship') world.relationships.push(normalized)
    else if (item.object_kind === 'event') world.events.push(normalized)
  }
  return world
}

export function requestIsSameLoopbackOrigin(req) {
  const host = String(req.headers?.host ?? '')
  const origin = String(req.headers?.origin ?? '')
  try {
    const expected = new URL(`http://${host}`)
    return ['127.0.0.1', '[::1]'].includes(expected.hostname) && new URL(origin).origin === expected.origin
  } catch { return false }
}

async function readJsonBody(req, maximumBytes = 64 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk)
    if (size > maximumBytes) throw new Error('request_too_large')
    chunks.push(chunk)
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_json_object')
  return value
}

/** 从被压缩段（shadowedSeqs）组装边界 source_messages（user 逐字 / assistant 仅上下文）。 */
export function buildBoundaryMessages(session, shadowedSeqs, dependenciesByUserMessageId = null) {
  const bySeq = new Map()
  for (const event of session.events ?? []) bySeq.set(event.seq, event)
  const messages = []
  let latestUserMessageId = null
  for (const seq of shadowedSeqs ?? []) {
    const event = bySeq.get(seq)
    if (!event) continue
    if (event.type !== 'user/message' && event.type !== 'assistant/message') continue
    if (event.type === 'user/message' && event.data?.source?.kind !== 'user') continue
    const text = contentText(event.type === 'user/message' ? event.data?.content : event.data?.message?.content)
    if (!text) continue
    const message = {
      role: event.type === 'user/message' ? 'user' : 'assistant',
      content: text,
      sourceSeq: seq,
      messageId: event.type === 'user/message' ? event.data?.id : event.data?.message?.id,
    }
    if (event.type === 'user/message' && typeof message.messageId === 'string') latestUserMessageId = message.messageId
    if (event.type === 'assistant/message' && latestUserMessageId && dependenciesByUserMessageId?.has(latestUserMessageId)) {
      message.model_context_dependencies = dependenciesByUserMessageId.get(latestUserMessageId)
      message.dependencyUserMessageId = latestUserMessageId
    }
    const eventTime = Number(event.time)
    if (Number.isFinite(eventTime) && eventTime > 0) message.timestamp = Math.floor(eventTime / 1000)
    messages.push(message)
  }
  return messages.map(({ sourceSeq, messageId, ...message }, index) => ({
    ...message,
    ...(typeof messageId === 'string' && messageId ? { message_id: messageId } : {}),
    source_ref: `source:${index}`,
    sourceSeq,
  }))
}

export function apply(ctx, config = {}) {
  const log = (line) => {
    try { ctx.logger?.info?.(line) } catch { /* 日志尽力 */ }
  }
  if (process.env.WEFTMATE_MEMOWEFT_ENABLED !== '1') {
    log('weftmate-memory: disabled（设置 WEFTMATE_MEMOWEFT_ENABLED=1 才启用试验接缝）')
    return
  }
  const bridge = config.bridge ?? new MemoWeftBridge({ log })
  const credentials = ctx.get('credentials')
  const summaries = new WeakMap() // session → Map<compactionId, { shadowedSeqs }>
  const pending = new Map()
  const deliveredRefs = new Set()
  const queuedRefs = new Set()
  const latestUserBySessionId = new Map()
  const recallAdoptions = []
  const dependenciesByUserMessageId = new Map()
  let retryTimer = null
  let retryDelayMs = 1_000
  let lastHandoffError = null
  let persistChain = Promise.resolve()
  let initialized = false
  let initializedGeneration = -1
  let initializePromise = null
  // Kept only in this process to notice a credentials-service change.  It is
  // never persisted, logged, hashed, or returned through the management API.
  let initializedCredential = undefined
  let disposed = false
  let memoryCapabilities = null
  let latestWorldRevision = null
  let stateLoadFailed = false
  let handoffChain = Promise.resolve()
  let adoptionReconcilePromise = null

  const persistHandoffState = () => {
    const path = HANDOFF_STATE_FILE()
    const snapshot = `${JSON.stringify({
      schema_version: 1,
      pending: [...pending.values()],
      delivered_refs: [...deliveredRefs],
      recall_adoptions: recallAdoptions,
    })}\n`
    persistChain = persistChain.catch(() => {}).then(async () => {
      if (!DSH_HOME()) throw new Error('DSH_HOME 缺失，无法持久化普通聊天交接队列')
      await mkdir(dirname(path), { recursive: true })
      const temporary = `${path}.${process.pid}.tmp`
      await writeFile(temporary, snapshot, 'utf8')
      await rename(temporary, path)
      lastHandoffError = null
    })
    return persistChain
  }

  const normalizeStoredAdoption = (value) => {
    if (!value || typeof value !== 'object') return null
    var adoption = Object.assign({}, value)
    if (typeof adoption.link_state === 'string' && typeof adoption.capture_status === 'string') return adoption
    var identityValid = typeof adoption.session_id === 'string' && adoption.session_id.trim() === adoption.session_id && adoption.session_id.length > 0 && adoption.session_id.length <= 512
      && typeof adoption.user_message_id === 'string' && adoption.user_message_id.trim() === adoption.user_message_id && adoption.user_message_id.length > 0 && adoption.user_message_id.length <= 512
    var rawWorld = Array.isArray(adoption.selected_item_ids) ? adoption.selected_item_ids : []
    var rawInteractions = Array.isArray(adoption.interaction_ids) ? adoption.interaction_ids : []
    var worldKeys = new Set(), interactionKeys = new Set()
    var worldValid = rawWorld.length <= 64 && rawWorld.every(function (pair) { var key = Array.isArray(pair) && pair.length === 2 && ['cognition', 'entity', 'relationship', 'event'].indexOf(pair[0]) >= 0 && typeof pair[1] === 'string' && pair[1].trim() === pair[1] && pair[1].length > 0 && pair[1].length <= 512 ? pair[0] + ':' + pair[1] : null; if (!key || worldKeys.has(key)) return false; worldKeys.add(key); return true })
    var interactionsValid = rawInteractions.length <= 64 && rawInteractions.every(function (id) { if (typeof id !== 'string' || id.trim() !== id || !id.length || id.length > 512 || interactionKeys.has(id)) return false; interactionKeys.add(id); return true })
    var referencesValid = worldValid && interactionsValid && (rawWorld.length > 0 || rawInteractions.length > 0)
    if (typeof adoption.capture_status !== 'string') adoption.capture_status = referencesValid ? 'complete' : 'unavailable'
    if (typeof adoption.link_state !== 'string') adoption.link_state = identityValid && referencesValid && adoption.capture_status === 'complete' ? 'pending' : 'unresolved'
    return adoption
  }

  const stateReady = (async () => {
    if (!DSH_HOME()) return
    try {
      const state = JSON.parse(await readFile(HANDOFF_STATE_FILE(), 'utf8'))
      if (state?.schema_version !== 1) throw new Error('unsupported schema')
      for (const ref of Array.isArray(state.delivered_refs) ? state.delivered_refs : []) {
        if (typeof ref === 'string') deliveredRefs.add(ref)
      }
      for (const item of Array.isArray(state.pending) ? state.pending : []) {
        if (!item || typeof item !== 'object' || typeof item.boundary?.event_id !== 'string') continue
        const refs = Array.isArray(item.refs) ? item.refs.filter((ref) => typeof ref === 'string') : []
        pending.set(item.boundary.event_id, { boundary: item.boundary, refs })
        for (const ref of refs) queuedRefs.add(ref)
      }
      const storedAdoptions = (Array.isArray(state.recall_adoptions) ? state.recall_adoptions : []).map(normalizeStoredAdoption).filter(Boolean)
      const retainedLinked = new Set(storedAdoptions.filter(adoption => adoption?.link_state === 'linked').slice(-200))
      for (const adoption of storedAdoptions) {
        if (adoption?.link_state === 'linked' && !retainedLinked.has(adoption)) continue
        if (adoption && typeof adoption === 'object') recallAdoptions.push(adoption)
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        stateLoadFailed = true
        lastHandoffError = `交接队列不可读取: ${error?.message ?? String(error)}`
        log(`weftmate-memory: ${lastHandoffError}`)
      }
    }
  })()

  const serializeHandoff = (operation) => {
    handoffChain = handoffChain.catch(() => {}).then(operation)
    return handoffChain
  }

  const trimLinkedAdoptions = () => {
    const linked = recallAdoptions.filter(item => item.link_state === 'linked')
    if (linked.length <= 200) return
    const remove = new Set(linked.slice(0, linked.length - 200))
    for (let index = recallAdoptions.length - 1; index >= 0; index--) if (remove.has(recallAdoptions[index])) recallAdoptions.splice(index, 1)
  }
  const dependenciesFromAdoption = (adoption) => normalizeModelContextDependencies({
    schema_version: 1,
    capture_status: adoption?.capture_status ?? ((adoption?.selected_item_ids?.length || adoption?.interaction_ids?.length) ? 'complete' : 'unavailable'),
    world_items: Array.isArray(adoption?.selected_item_ids)
      ? adoption.selected_item_ids.map(pair => ({ object_kind: pair?.[0], item_id: pair?.[1] }))
      : [],
    interaction_ids: Array.isArray(adoption?.interaction_ids) ? adoption.interaction_ids : [],
    world_revision: adoption?.world_revision,
    recall_snapshot_token: adoption?.recall_snapshot_token,
    interaction_snapshot_token: adoption?.interaction_snapshot_token,
    world_context_hash: adoption?.world_context_hash,
    interaction_context_hash: adoption?.interaction_context_hash,
    context_hash: adoption?.context_hash,
  })
  const reconcileAdoptionGroup = async (group, dependenciesOverride = null) => {
    if (!group.length) return
    const first = group[0]
    if (typeof first.session_id !== 'string' || typeof first.user_message_id !== 'string') {
      for (const adoption of group) adoption.link_state = 'unresolved'
      return
    }
    try {
      const history = await bridge.request('query_interactions', { conversation_id: first.session_id, user_message_id: first.user_message_id, projection: 'history' })
      const matches = Array.isArray(history?.items) ? history.items.filter(item => item?.conversation_id === first.session_id && item?.user_message_id === first.user_message_id && typeof item?.assistant_message_id === 'string' && typeof item?.context_hash === 'string') : []
      // Zero matches commonly means the current turn has not reached its
      // committed boundary yet. Keep it pending for turn/end or the next host
      // startup; only an actual ambiguity is terminally unresolved.
      if (matches.length === 0) return
      if (matches.length !== 1) {
        for (const adoption of group) adoption.link_state = 'unresolved'
        return
      }
      const item = matches[0]
      const dependencies = dependenciesOverride
        ? normalizeModelContextDependencies(dependenciesOverride)
        : group.reduce((combined, adoption) => mergeModelContextDependencies(combined, dependenciesFromAdoption(adoption)), null)
      const linked = await bridge.request('link_interaction_dependencies', { conversation_id: first.session_id, user_message_id: first.user_message_id, assistant_message_id: item.assistant_message_id, expected_context_hash: item.context_hash, model_context_dependencies: dependencies })
      if (linked?.result_state === 'applied' || linked?.result_state === 'no_change') {
        for (const adoption of group) {
          adoption.link_state = 'linked'
          adoption.interaction_id = linked.interaction_id
          adoption.linked_context_hash = linked.context_hash
          delete adoption.last_link_error
        }
      } else if (linked?.result_state !== 'not_found') {
        for (const adoption of group) adoption.link_state = 'unresolved'
      }
    } catch (error) {
      // Transport/Core availability is retryable.  Do not turn a temporary
      // startup failure into permanent loss of the causal adoption record.
      for (const adoption of group) adoption.last_link_error = boundedText(error?.message ?? String(error), 300)
    }
  }
  const reconcileAdoptions = async () => {
    if (adoptionReconcilePromise || !(memoryCapabilities?.interaction_dependency_projection === 1 || bridge.capabilities?.interaction_dependency_projection === 1)) return adoptionReconcilePromise
    adoptionReconcilePromise = serializeHandoff(async () => {
      const groups = new Map()
      for (const adoption of recallAdoptions.filter(item => item?.link_state === 'pending')) {
        const key = `${adoption?.session_id ?? ''}\u0000${adoption?.user_message_id ?? ''}`
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(adoption)
      }
      for (const group of groups.values()) await reconcileAdoptionGroup(group)
      trimLinkedAdoptions()
      await persistHandoffState()
    }).finally(() => { adoptionReconcilePromise = null })
    return adoptionReconcilePromise
  }

  const ensureInitialized = async () => {
    if (disposed) throw new Error('weftmate-memory is disposed')
    const authRef = process.env.WEFTMATE_MEMOWEFT_AUTH_REF?.trim()
    let modelApiKey
    if (authRef && credentials?.resolve) {
      const { credentialRef } = await import('@deepseek-ai/dsh-credentials')
      modelApiKey = (await credentials.resolve(credentialRef(authRef)))?.value
    }
    if (initialized && initializedGeneration === bridge.generation && bridge.child && modelApiKey === initializedCredential) return
    if (initialized && initializedCredential !== modelApiKey) {
      // An earlier no-key initialization otherwise remains cached and keeps
      // returning 401 after the user configures a key. Preserve DSH_HOME and
      // the durable pending handoff file; only the bridge process restarts.
      await bridge.close()
      initialized = false
      initializePromise = null
    }
    if (initializedGeneration !== bridge.generation || !bridge.child) {
      initialized = false
      initializePromise = null
    }
    if (!initializePromise) {
      initializePromise = (async () => {
        memoryCapabilities = await bridge.request('capabilities')
        bridge.acceptCapabilities(memoryCapabilities)
        if (Number.isInteger(memoryCapabilities?.world_revision)) latestWorldRevision = memoryCapabilities.world_revision
        const initializeParams = {
          session_id: 'weftmate-host',
          dsh_home: DSH_HOME(),
          platform: 'dsh',
          model_tier: process.env.WEFTMATE_MEMOWEFT_MODEL_TIER || 'local',
          lang: 'zh',
        }
        if (typeof modelApiKey === 'string' && modelApiKey) initializeParams.model_api_key = modelApiKey
        const result = await bridge.request('initialize', initializeParams)
        memoryCapabilities = result?.capabilities ?? memoryCapabilities
        bridge.acceptCapabilities(memoryCapabilities)
        if (Number.isInteger(memoryCapabilities?.world_revision)) latestWorldRevision = memoryCapabilities.world_revision
        initialized = true
        initializedGeneration = bridge.generation
        initializedCredential = modelApiKey
        log(`weftmate-memory: bridge ready (${MEMOWEFT_RPC_PROTOCOL} v${MEMOWEFT_RPC_PROTOCOL_VERSION})`)
      })().catch((error) => {
        initializePromise = null
        throw error
      })
    }
    await initializePromise
  }

  const scheduleRetry = () => {
    if (disposed || retryTimer || pending.size === 0) return
    retryTimer = setTimeout(() => {
      retryTimer = null
      if (disposed) return
      void persistHandoffState()
        .then(() => disposed ? undefined : flushPending())
        .catch((error) => {
          if (disposed) return
          lastHandoffError = error?.message ?? String(error)
          log(`weftmate-memory: 交接队列持久化失败，将重试: ${lastHandoffError}`)
          scheduleRetry()
        })
    }, retryDelayMs)
    retryTimer.unref?.()
    retryDelayMs = Math.min(retryDelayMs * 2, 30_000)
  }

  const flushPendingNow = async () => {
    await stateReady
    if (disposed || pending.size === 0) return
    try {
      await ensureInitialized()
      for (const [eventId, item] of [...pending]) {
        const receipt = await bridge.request('ingest_boundary', { boundary: item.boundary })
        pending.delete(eventId)
        for (const ref of item.refs) { queuedRefs.delete(ref); deliveredRefs.add(ref) }
        await persistHandoffState()
        log(`weftmate-memory: boundary ${receipt?.job_state ?? '?'}（eligible=${receipt?.eligible ?? '?'}）`)
      }
      retryDelayMs = 1_000
    } catch (error) {
      lastHandoffError = error?.message ?? String(error)
      log(`weftmate-memory: boundary 入队失败，将重试: ${error?.message ?? String(error)}`)
      if (!disposed) scheduleRetry()
    }
  }

  const flushPending = () => {
    return serializeHandoff(() => flushPendingNow())
  }

  const queueBoundaryNow = async ({ sessionId, occurrenceKey, prefix, mode, messages }) => {
    await stateReady
    if (stateLoadFailed) throw new Error(lastHandoffError || '交接队列不可读取')
    const fresh = messages.filter((message) => {
      const ref = `${sessionId}:${message.sourceSeq}`
      return !deliveredRefs.has(ref) && !queuedRefs.has(ref)
    })
    if (!fresh.some((message) => message.role === 'user')) return
    const refs = fresh.map((message) => `${sessionId}:${message.sourceSeq}`)
    const sourceMessages = fresh.map(({ sourceSeq, source_ref, dependencyUserMessageId, ...message }, index) => ({ ...message, source_ref: `source:${index}` }))
    const payload = {
      schema_version: 1,
      provider_name: 'memoweft',
      parent_session_id: sessionId,
      result_session_id: sessionId,
      mode,
      source_messages: sourceMessages,
    }
    const payloadHash = sha256Hex(canonicalJson(payload))
    const occurrence = sha256Hex(`${sessionId}|${occurrenceKey}`).slice(0, 32)
    const boundary = { ...payload, event_id: `${prefix}:${occurrence}:${payloadHash}`, payload_hash: payloadHash }
    pending.set(boundary.event_id, { boundary, refs })
    for (const ref of refs) queuedRefs.add(ref)
    try {
      await persistHandoffState()
    } catch (error) {
      lastHandoffError = error?.message ?? String(error)
      scheduleRetry()
      throw error
    }
    await flushPendingNow()
    if (memoryCapabilities?.interaction_dependency_projection === 1 || bridge.capabilities?.interaction_dependency_projection === 1) {
      for (const message of fresh) {
        if (message.role !== 'assistant' || typeof message.message_id !== 'string' || typeof message.dependencyUserMessageId !== 'string' || !message.model_context_dependencies) continue
        const group = recallAdoptions.filter(item => item.session_id === sessionId && item.user_message_id === message.dependencyUserMessageId && item.link_state === 'pending')
        await reconcileAdoptionGroup(group, message.model_context_dependencies)
      }
      trimLinkedAdoptions()
      await persistHandoffState()
    }
  }

  const queueBoundary = (input) => {
    return serializeHandoff(() => queueBoundaryNow(input))
  }

  // ── 边界源（A+B：自动压缩与 /compact 同一事件面）──
  ctx.on('session/event', (session, event) => {
    try {
      if (event.type === 'user/message' && event.data?.source?.kind === 'user') {
        const text = contentText(event.data?.content).trim()
        const sessionId = typeof session.header?.id === 'string' ? session.header.id : ''
        const openTurn = [...(session.events ?? [])].reverse().find((candidate) => candidate.type === 'turn/start')?.data?.turn
        if (sessionId && text) latestUserBySessionId.set(sessionId, { seq: event.seq, messageId: event.data?.id ?? null, text, turn: openTurn })
      }
      if (event.type === 'compaction/summary') {
        let perSession = summaries.get(session)
        if (!perSession) { perSession = new Map(); summaries.set(session, perSession) }
        perSession.set(event.data.compactionId, { shadowedSeqs: event.data.shadowedSeqs ?? [] })
        return
      }
      if (event.type === 'turn/end') {
        const sessionId = typeof session.header?.id === 'string' ? session.header.id : 'unknown'
        const turnStartSeq = [...(session.events ?? [])].reverse()
          .find((candidate) => candidate.type === 'turn/start' && candidate.data?.turn === event.data?.turn)?.seq ?? -1
        const seqs = (session.events ?? [])
          .filter((candidate) => Number(candidate.seq) > Number(turnStartSeq) && Number(candidate.seq) <= Number(event.seq))
          .map((candidate) => candidate.seq)
        const messages = buildBoundaryMessages(session, seqs, (memoryCapabilities?.interaction_dependency_projection === 1 || bridge.capabilities?.interaction_dependency_projection === 1) ? dependenciesByUserMessageId : null)
        void queueBoundary({
          sessionId,
          occurrenceKey: `turn:${event.data?.turn ?? event.seq}`,
          prefix: TURN_BOUNDARY_PREFIX,
          mode: 'turn',
          messages,
        }).catch((error) => log(`weftmate-memory: 普通聊天交接失败，将由持久队列重试: ${error?.message ?? String(error)}`))
        return
      }
      if (event.type !== 'compaction/end') return
      if (event.data?.error) return // 失败压缩不是 committed boundary
      const perSession = summaries.get(session)
      const summary = perSession?.get(event.data.compactionId)
      if (!summary) return
      const messages = buildBoundaryMessages(session, summary.shadowedSeqs, (memoryCapabilities?.interaction_dependency_projection === 1 || bridge.capabilities?.interaction_dependency_projection === 1) ? dependenciesByUserMessageId : null)
      const sessionId = typeof session.header?.id === 'string' ? session.header.id : 'unknown'
      perSession.delete(event.data.compactionId)
      void queueBoundary({ sessionId, occurrenceKey: `compaction:${event.data.compactionId}`, prefix: BOUNDARY_PREFIX, mode: 'in_place', messages })
        .catch((error) => log(`weftmate-memory: 压缩交接失败，将由持久队列重试: ${error?.message ?? String(error)}`))
    } catch (error) {
      log(`weftmate-memory: 边界处理异常: ${error?.message ?? String(error)}`)
    }
  })

  // ── Recall 注入：当轮用户消息确定性查询；命中才注入（0 生成调用、0 写入）──
  const lastRecallByAgent = new WeakMap()
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    try {
      if (decision.kind === 'reject' || payload?.signal?.aborted) return decision
      const session = payload?.agent?.session
      const sessionId = typeof session?.header?.id === 'string' ? session.header.id : ''
      const claimedUser = [...(payload?.messages ?? [])].reverse().find((message) => message?.source?.kind === 'user' && contentText(message?.content).trim())
        ?? [...(decision.messages ?? [])].reverse().find((message) => message?.source?.kind === 'user' && contentText(message?.content).trim())
      const cachedUser = latestUserBySessionId.get(sessionId)
      const currentUser = claimedUser
        ? { seq: null, messageId: claimedUser.id ?? null, text: contentText(claimedUser.content).trim(), turn: payload?.turn }
        : cachedUser?.turn === payload?.turn ? cachedUser : null
      const query = currentUser?.text?.slice(0, RECALL_QUERY_MAX_CHARS)
      if (!session || !query) return decision
      await ensureInitialized()
      await reconcileAdoptions()
      // The automatic snapshot is model input.  The source bridge's local
      // trust designation cannot authorize disclosure to an unknown/cloud
      // destination, so both destination and permissions must be explicit.
      const policy = rawRecallPolicy({ agent: payload.agent }, ctx)
      const dependencyProjection = memoryCapabilities?.interaction_dependency_projection === 1 || bridge.capabilities?.interaction_dependency_projection === 1
      if (!policy.allowed) {
        if (typeof currentUser.messageId === 'string') dependenciesByUserMessageId.set(currentUser.messageId, mergeModelContextDependencies(dependenciesByUserMessageId.get(currentUser.messageId), { schema_version: 1, capture_status: 'withheld', world_items: [], interaction_ids: [] }))
        const createUserMessage = config.createUserMessage ?? (await import('@deepseek-ai/dsh-llm')).createUserMessage
        return { kind: 'enter', messages: [...decision.messages, createUserMessage({ content: [{ type: 'text', text: `${RECALL_CLEARED}\n\n${INTERACTIONS_CLEARED}` }], source: { kind: 'plugin', plugin: 'weftmate-memory' } })] }
      }
      const [worldResult, interactionResult] = await Promise.allSettled([
        bridge.request('preview_recall', { query }),
        dependencyProjection
          ? bridge.request('query_interactions', { query, session_id: sessionId, projection: 'model' })
          : Promise.resolve({ items: [], rendered_context: '', snapshot_token: null, withheld: true }),
      ])
      const context = {}
      if (worldResult.status === 'fulfilled') {
        const preview = worldResult.value?.preview
        const text = typeof preview?.rendered_recall === 'string' ? preview.rendered_recall.trim() : ''
        const ids = Array.isArray(preview?.selected_item_ids) ? preview.selected_item_ids : []
        context.world = {
          status: 'ready', active: Boolean(text && ids.length), text, ids,
          revision: worldResult.value?.world_revision ?? null,
          token: preview?.recall_snapshot_token ?? null,
        }
      } else context.world = { status: 'error', active: false, text: '', ids: [], revision: null, token: null }
      if (interactionResult.status === 'fulfilled') {
        const text = typeof interactionResult.value?.rendered_context === 'string' ? interactionResult.value.rendered_context.trim() : ''
        const items = Array.isArray(interactionResult.value?.items) ? interactionResult.value.items : []
        context.interactions = {
          status: interactionResult.value?.withheld === true ? 'withheld' : 'ready', active: Boolean(text && items.length), text,
          ids: items.map((item) => item?.id).filter((id) => typeof id === 'string'),
          token: interactionResult.value?.snapshot_token ?? null,
        }
      } else context.interactions = { status: 'error', active: false, text: '', ids: [], token: null }
      const requestRef = currentUser.messageId ?? `${payload?.turn ?? 'unknown'}:${payload?.step ?? 'unknown'}:${sha256Hex(query)}`
      const recallKey = `${requestRef}:${context.world?.revision ?? 'unknown'}:${context.world?.token ?? ''}:${context.interactions?.token ?? ''}`
      if (lastRecallByAgent.get(payload.agent) === recallKey) return decision
      const createUserMessage = config.createUserMessage ?? (await import('@deepseek-ai/dsh-llm')).createUserMessage
      if (typeof createUserMessage !== 'function') return decision
      const chunks = []
      const sections = []
      if (context.world?.active) {
        chunks.push(context.world.text)
        sections.push({ name: 'weftmate-memory-world', text: context.world.text })
      } else chunks.push(context.world.status === 'error' ? RECALL_UNAVAILABLE : RECALL_CLEARED)
      if (context.interactions?.active) {
        const interactionText = `[WeftMate 共同经历（历史讨论，仅供参考）]\n${context.interactions.text}\n\n${INTERACTION_CONTEXT_NOTE}`
        chunks.push(interactionText)
        sections.push({ name: 'weftmate-memory-interactions', text: interactionText })
      } else chunks.push(context.interactions.status === 'error' ? INTERACTIONS_UNAVAILABLE : INTERACTIONS_CLEARED)
      chunks.push(MEMORY_HOST_BEHAVIOR)
      const recallContext = chunks.join('\n\n')
      const selectedItemIds = context.world?.active ? context.world.ids.slice(0, 64) : []
      const interactionIds = context.interactions?.active ? context.interactions.ids.slice(0, 64) : []
      if (typeof currentUser.messageId === 'string') {
        const adoption = {
          session_id: sessionId,
          user_seq: currentUser.seq,
          user_message_id: currentUser.messageId,
          world_revision: context.world?.revision ?? null,
          selected_item_ids: selectedItemIds,
          interaction_ids: interactionIds,
          recall_snapshot_token: context.world?.token ?? null,
          interaction_snapshot_token: context.interactions?.token ?? null,
          world_context_hash: context.world?.active ? sha256Hex(context.world.text) : null,
          interaction_context_hash: context.interactions?.active ? sha256Hex(context.interactions.text) : null,
          context_hash: sha256Hex(recallContext),
          capture_status: worldResult.status === 'fulfilled' && interactionResult.status === 'fulfilled' ? (selectedItemIds.length || interactionIds.length ? 'complete' : 'complete_empty') : 'unavailable',
          adopted_at: new Date().toISOString(),
        }
        const dependency = normalizeModelContextDependencies({
          schema_version: 1,
          capture_status: adoption.capture_status,
          world_items: selectedItemIds.map(pair => ({ object_kind: pair[0], item_id: pair[1] })),
          interaction_ids: interactionIds,
          world_revision: context.world?.revision ?? null,
          recall_snapshot_token: context.world?.token ?? null,
          interaction_snapshot_token: context.interactions?.token ?? null,
          world_context_hash: adoption.world_context_hash,
          interaction_context_hash: adoption.interaction_context_hash,
          context_hash: adoption.context_hash,
        })
        dependenciesByUserMessageId.set(currentUser.messageId, mergeModelContextDependencies(dependenciesByUserMessageId.get(currentUser.messageId), dependency))
        try {
          await serializeHandoff(async () => {
            adoption.link_state = 'pending'
            recallAdoptions.push(adoption)
            const linked = recallAdoptions.filter(item => item.link_state === 'linked')
            if (linked.length > 200) {
              const remove = new Set(linked.slice(0, linked.length - 200))
              for (let index = recallAdoptions.length - 1; index >= 0; index--) if (remove.has(recallAdoptions[index])) recallAdoptions.splice(index, 1)
            }
            await persistHandoffState()
          })
        } catch (error) {
          const index = recallAdoptions.indexOf(adoption)
          if (index >= 0) recallAdoptions.splice(index, 1)
          throw error
        }
      }
      lastRecallByAgent.set(payload.agent, recallKey)
      return {
        kind: 'enter',
        messages: [
          ...decision.messages,
          createUserMessage({
            content: [{ type: 'text', text: recallContext }],
            source: sections.length
              ? { kind: 'plugin', plugin: 'weftmate-memory', form: 'snapshot', sections }
              : { kind: 'plugin', plugin: 'weftmate-memory' },
          }),
        ],
      }
    } catch { return decision } // 记忆面任何异常都不挡主链路
  }, { prepend: true })

  const recordToolDependencyCapture = async (exec, dependency) => {
    const sessionId = exec?.agent?.session?.id ?? exec?.agent?.session?.header?.id
    const currentUser = typeof sessionId === 'string' ? latestUserBySessionId.get(sessionId) : null
    if (!currentUser || typeof currentUser.messageId !== 'string') return
    const normalized = normalizeModelContextDependencies(dependency)
    dependenciesByUserMessageId.set(currentUser.messageId, mergeModelContextDependencies(dependenciesByUserMessageId.get(currentUser.messageId), normalized))
    const adoption = {
      session_id: sessionId,
      user_seq: currentUser.seq,
      user_message_id: currentUser.messageId,
      world_revision: normalized.world_revision ?? null,
      selected_item_ids: normalized.world_items.map(item => [item.object_kind, item.item_id]),
      interaction_ids: normalized.interaction_ids,
      recall_snapshot_token: normalized.recall_snapshot_token ?? null,
      interaction_snapshot_token: normalized.interaction_snapshot_token ?? null,
      world_context_hash: normalized.world_context_hash ?? null,
      interaction_context_hash: normalized.interaction_context_hash ?? null,
      context_hash: normalized.context_hash ?? null,
      capture_status: normalized.capture_status,
      adopted_at: new Date().toISOString(),
      link_state: 'pending',
      capture_source: 'recall_memory',
    }
    await serializeHandoff(async () => { recallAdoptions.push(adoption); await persistHandoffState() })
  }

  const registerRecallTool = (tools) => {
    const defineTool = config.defineTool ?? defineVendorTool
    tools?.register?.(defineTool({
      name: 'recall_memory',
      description: 'Search MemoWeft for a specific past preference, experience, person, or prior agreement. Use only when the user asks about relevant prior context; do not use it for self-contained coding or terminal work.',
      parameters: {
        query: { type: 'string', required: true, description: 'A focused memory question or keywords.' },
        level: { type: 'string', enum: ['cognition', 'evidence', 'all'], description: 'cognition is the default summary; evidence requests permission-gated source material.' },
      },
      output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: value?.rendered_context ?? JSON.stringify(value) }] },
      execute: async (args, exec) => {
        const query = boundedText(args?.query, RECALL_QUERY_MAX_CHARS)
        const level = ['cognition', 'evidence', 'all'].includes(args?.level) ? args.level : 'cognition'
        if (!query) return { ok: false, status: 'failed', error: 'query_required', query: '', level, count: 0, cognitions: [], evidence: [], sources: [], rendered_context: '未提供有效检索词。' }
        try { await ensureInitialized() } catch (error) {
          await recordToolDependencyCapture(exec, { schema_version: 1, capture_status: 'unavailable', world_items: [], interaction_ids: [] })
          return { ok: false, status: 'failed', error: 'bridge_unavailable', query, level, count: 0, cognitions: [], evidence: [], sources: [], rendered_context: `记忆桥接不可用：${error?.message ?? String(error)}` }
        }
        const policy = rawRecallPolicy(exec, ctx)
        if (!policy.allowed) {
          await recordToolDependencyCapture(exec, { schema_version: 1, capture_status: 'withheld', world_items: [], interaction_ids: [] })
          return { ok: false, status: 'failed', error: policy.reason, query, level, count: 0, cognitions: [], evidence: [], sources: [{ kind: 'memory', status: 'withheld', destination: policy.destination, reason: policy.reason }], rendered_context: '当前模型路由不允许读取记忆内容。' }
        }
        let preview, previewResult
        try { previewResult = await bridge.request('preview_recall', { query }); preview = previewResult?.preview } catch (error) {
          await recordToolDependencyCapture(exec, { schema_version: 1, capture_status: 'unavailable', world_items: [], interaction_ids: [] })
          return { ok: false, status: 'failed', error: 'preview_failed', query, level, count: 0, cognitions: [], evidence: [], sources: [], rendered_context: `记忆检索失败：${error?.message ?? String(error)}` }
        }
        const selected = Array.isArray(preview?.selected_item_ids) ? preview.selected_item_ids.filter(pair => Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string') : []
        const cognitions = boundedText(preview?.rendered_recall, RECALL_MAX_RENDERED_CHARS).split('\n').map(line => line.trim()).filter(Boolean).map((content, index) => ({ id: selected[index]?.[1] ?? null, content, source_role: 'world_cognition' }))
        const evidence = []
        const sources = []
        const errors = []
        const provenanceWorldItems = new Map()
        let interactionIds = [], interactionToken = null, interactionRendered = ''
        if ((level === 'evidence' || level === 'all') && policy.allowed) {
          for (const [kind, itemId] of selected) {
            try {
              const provenanceResult = await bridge.request('query_provenance', { object_kind: kind, item_id: itemId, projection: 'model' })
              const provenance = provenanceResult?.provenance
              var provenanceDenied = null
              for (const record of Array.isArray(provenance) ? provenance : []) {
                for (const linked of Array.isArray(record?.linked_world_items) ? record.linked_world_items : []) {
                  if (linked && typeof linked.object_kind === 'string' && typeof linked.item_id === 'string') provenanceWorldItems.set(`${linked.object_kind}:${linked.item_id}`, { object_kind: linked.object_kind, item_id: linked.item_id })
                }
                const raw = readableEvidence(record, policy.destination) ? boundedText(record?.evidence?.raw_content, RECALL_MAX_EVIDENCE_CHARS) : ''
                if (record?.model_content_available === false) provenanceDenied = record.model_denial_reason || 'model_content_withheld'
                if (!raw || evidence.length >= RECALL_MAX_EVIDENCE) continue
                evidence.push({ evidence_id: record.evidence_id ?? null, occurred_at: record.evidence?.occurred_at ?? null, raw_content: raw, relation: record.relation ?? 'support', source_role: record.evidence?.source_role ?? record.evidence?.role ?? 'evidence' })
              }
              if (provenanceDenied) { errors.push({ kind: 'provenance', item_id: itemId, code: provenanceDenied }); sources.push({ kind: 'provenance', item_id: itemId, status: 'withheld', reason: provenanceDenied }) }
              else sources.push({ kind: 'provenance', item_id: itemId, status: 'ok' })
            } catch (error) { errors.push({ kind: 'provenance', item_id: itemId, code: 'query_failed' }); sources.push({ kind: 'provenance', item_id: itemId, status: 'failed' }) }
          }
          try {
            const sessionId = exec?.agent?.session?.id ?? exec?.agent?.session?.header?.id
            const interactions = await bridge.request('query_interactions', { query, ...(typeof sessionId === 'string' ? { session_id: sessionId } : {}), projection: 'model' })
            const rendered = boundedText(interactions?.rendered_context, RECALL_MAX_EVIDENCE_CHARS)
            interactionRendered = rendered
            interactionIds = Array.isArray(interactions?.items) ? interactions.items.map(item => item?.id).filter(id => typeof id === 'string') : []
            interactionToken = typeof interactions?.snapshot_token === 'string' ? interactions.snapshot_token : null
            if (rendered && evidence.length < RECALL_MAX_EVIDENCE) evidence.push({ evidence_id: 'shared-interaction', occurred_at: null, raw_content: rendered, relation: 'shared_interaction', source_role: 'shared_interaction' })
            for (const item of Array.isArray(interactions?.commitments) ? interactions.commitments : []) {
              const raw = boundedText(item?.content, RECALL_MAX_EVIDENCE_CHARS)
              if (raw && evidence.length < RECALL_MAX_EVIDENCE) evidence.push({ evidence_id: item.id ?? null, occurred_at: item.created_at ?? null, raw_content: raw, relation: 'commitment', source_role: item.category ?? 'commitment' })
            }
            sources.push({ kind: 'interactions', status: 'ok' })
          } catch (error) { errors.push({ kind: 'interactions', code: 'query_failed' }); sources.push({ kind: 'interactions', status: 'failed' }) }
        } else if (level === 'evidence' || level === 'all') {
          sources.push({ kind: 'raw_evidence', status: 'withheld', destination: policy.destination, reason: policy.reason })
        }
        const visibleCognitions = level === 'evidence' ? [] : cognitions
        const visibleEvidence = level === 'cognition' ? [] : evidence
        const total = visibleCognitions.length + visibleEvidence.length
        const status = errors.length ? (total ? 'partial' : 'failed') : (total ? 'success' : 'zero')
        const sections = []
        if (visibleCognitions.length) sections.push('[记忆认知]\n' + visibleCognitions.map(item => `- ${item.content}`).join('\n'))
        if (visibleEvidence.length) sections.push('[可读取来源]\n' + visibleEvidence.map(item => `- [${item.source_role}] ${item.raw_content}`).join('\n'))
        if (level !== 'cognition' && !policy.allowed) sections.push(`[原文证据未读取：当前模型目的地为 ${policy.destination}，且缺少允许该读取的明确权限。]`)
        if (errors.length) sections.push('[部分记忆来源读取失败；未将其当作零命中。]')
        await recordToolDependencyCapture(exec, {
          schema_version: 1,
          capture_status: errors.length ? 'unavailable' : (selected.length || interactionIds.length ? 'complete' : 'complete_empty'),
          world_items: [...new Map(selected.map(pair => [`${pair[0]}:${pair[1]}`, { object_kind: pair[0], item_id: pair[1] }])).values(), ...provenanceWorldItems.values()],
          interaction_ids: interactionIds,
          world_revision: previewResult?.world_revision,
          recall_snapshot_token: preview?.recall_snapshot_token,
          interaction_snapshot_token: interactionToken,
          world_context_hash: preview?.rendered_recall ? sha256Hex(String(preview.rendered_recall)) : undefined,
          interaction_context_hash: interactionRendered ? sha256Hex(interactionRendered) : undefined,
          context_hash: sha256Hex(sections.join('\n\n') || 'zero'),
        })
        return { ok: status === 'success' || status === 'zero', status, query, level, count: total, limits: { max_evidence: RECALL_MAX_EVIDENCE, max_evidence_chars: RECALL_MAX_EVIDENCE_CHARS, max_rendered_chars: RECALL_MAX_RENDERED_CHARS }, cognitions: visibleCognitions, evidence: visibleEvidence, sources, ...(errors.length ? { errors } : {}), rendered_context: sections.join('\n\n') || '未在记忆库中检索到匹配记录。' }
      },
      presentCall: args => ({ card: 'generic', title: `记忆翻查 · ${args?.query ?? ''}`, kind: 'read' }),
    }))
  }
  const initialTools = ctx.get('tools')
  if (initialTools) registerRecallTool(initialTools)
  else ctx.inject?.(['tools'], host => registerRecallTool(host.tools))

  // ── 管理面（只读）：浏览/搜索/导出 ──
  const webServer = ctx.get('webServer')
  if (webServer) {
    const serveMemory = async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://x')
      if (url.pathname !== '/weftmate/memory/command.json' && req.method !== 'GET') {
        res.writeHead(405, { allow: 'GET', 'content-type': 'application/json; charset=utf-8' })
        res.end(`${JSON.stringify({ ok: false, error: 'method_not_allowed' })}\n`)
        return
      }
      try {
        if (url.pathname === '/weftmate/memory/world.json') {
          await ensureInitialized()
          const result = await bridge.request('query_world', { operation: 'list' })
          if (Number.isInteger(result?.world_revision)) latestWorldRevision = result.world_revision
          const world = adaptWorldForLegacyPanel(result, bridge.capabilities)
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
          res.end(`${JSON.stringify(world)}\n`)
          return
        }
        if (url.pathname === '/weftmate/memory/search.json') {
          const query = String(url.searchParams.get('q') ?? '').slice(0, RECALL_QUERY_MAX_CHARS)
          await ensureInitialized()
          const recall = await bridge.request('prefetch', { query, session_id: '' })
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
          res.end(`${JSON.stringify(recall)}\n`)
          return
        }
        if (url.pathname === '/weftmate/memory/export.json') {
          await ensureInitialized()
          const exported = await bridge.request('portable_export', { exported_at: new Date().toISOString() })
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
          res.end(`${JSON.stringify(exported)}\n`)
          return
        }
        if (url.pathname === '/weftmate/memory/health.json') {
          await ensureInitialized()
          const runtime = await bridge.request('health', {})
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
          res.end(`${JSON.stringify({
            ready: runtime?.runtime?.enabled === true,
            protocol: MEMOWEFT_RPC_PROTOCOL,
            protocolVersion: MEMOWEFT_RPC_PROTOCOL_VERSION,
            schemaVersion: MEMOWEFT_RPC_SCHEMA_VERSION,
            runtime: runtime?.runtime ?? null,
          })}\n`)
          return
        }
        if (url.pathname === '/weftmate/memory/evidence.json') {
          await ensureInitialized()
          const result = await bridge.request('query_evidence', { operation: 'list' })
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
          res.end(`${JSON.stringify(result)}\n`)
          return
        }
        if (url.pathname === '/weftmate/memory/jobs.json') {
          await ensureInitialized()
          const result = await bridge.request('query_jobs', { operation: 'list' })
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
          res.end(`${JSON.stringify({
            ...(result && typeof result === 'object' ? result : { jobs: [] }),
            handoff: { pending: pending.size, error: lastHandoffError },
          })}\n`)
          return
        }
        if (url.pathname === '/weftmate/memory/recall-preview.json') {
          const query = String(url.searchParams.get('q') ?? '').trim().slice(0, RECALL_QUERY_MAX_CHARS)
          await ensureInitialized()
          const result = query ? await bridge.request('preview_recall', { query }) : { preview: { selected_item_ids: [], rendered_recall: '', count: 0 } }
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
          res.end(`${JSON.stringify(result)}\n`)
          return
        }
        if (url.pathname === '/weftmate/memory/provenance.json') {
          const objectKind = String(url.searchParams.get('object_kind') ?? '')
          const itemId = String(url.searchParams.get('item_id') ?? '')
          if (!['cognition', 'entity', 'relationship', 'event'].includes(objectKind) || !itemId || itemId.length > 512) {
            res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
            res.end(`${JSON.stringify({ ok: false, error: 'invalid_provenance_target' })}\n`)
            return
          }
          await ensureInitialized()
          const result = await bridge.request('query_provenance', { object_kind: objectKind, item_id: itemId, projection: 'history' })
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
          res.end(`${JSON.stringify(result)}\n`)
          return
        }
        if (url.pathname === '/weftmate/memory/adoptions.json') {
          const sessionId = String(url.searchParams.get('session_id') ?? '')
          const adoptions = sessionId ? recallAdoptions.filter((item) => item.session_id === sessionId) : recallAdoptions
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
          res.end(`${JSON.stringify({ schema_version: 1, adoptions })}\n`)
          return
        }
        if (url.pathname === '/weftmate/memory/interactions.json') {
          const interactionId = String(url.searchParams.get('id') ?? '').trim()
          const query = String(url.searchParams.get('q') ?? '').trim().slice(0, RECALL_QUERY_MAX_CHARS)
          const sessionId = String(url.searchParams.get('session_id') ?? '').trim()
          if (!interactionId && !query) {
            res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
            res.end(`${JSON.stringify({ ok: false, error: 'interaction_id_or_query_required' })}\n`)
            return
          }
          await ensureInitialized()
          const result = interactionId
            ? await bridge.request('query_interaction', { id: interactionId, projection: 'history' })
            : await bridge.request('query_interactions', { query, ...(sessionId ? { session_id: sessionId } : {}), projection: 'history', search_mode: 'history_search' })
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
          res.end(`${JSON.stringify(result)}\n`)
          return
        }
        if (url.pathname === '/weftmate/memory/command.json') {
          if (req.method !== 'POST') {
            res.writeHead(405, { allow: 'POST', 'content-type': 'application/json; charset=utf-8' })
            res.end(`${JSON.stringify({ ok: false, error: 'method_not_allowed' })}\n`)
            return
          }
          if (!requestIsSameLoopbackOrigin(req) || !String(req.headers?.['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
            res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
            res.end(`${JSON.stringify({ ok: false, error: 'forbidden_origin_or_content_type' })}\n`)
            return
          }
          const body = await readJsonBody(req)
          if (Object.keys(body).length !== 1 || !body.command || typeof body.command !== 'object' || Array.isArray(body.command)) {
            res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
            res.end(`${JSON.stringify({ ok: false, error: 'invalid_command' })}\n`)
            return
          }
          await ensureInitialized()
          const supplied = body.command
          const command = {
            schema_version: supplied.schema_version ?? 1,
            command_id: typeof supplied.command_id === 'string' && supplied.command_id.trim() ? supplied.command_id.trim() : `cmd-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
            subject_id: supplied.subject_id ?? bridge.capabilities?.subject_id ?? memoryCapabilities?.subject_id,
            actor: supplied.actor ?? 'weftmate-ui',
            expected_world_revision: supplied.expected_world_revision ?? latestWorldRevision ?? bridge.capabilities?.world_revision ?? memoryCapabilities?.world_revision,
            operation: supplied.operation,
            target_kind: supplied.target_kind ?? 'cognition',
            target_id: supplied.target_id,
            payload: supplied.payload ?? {},
            submitted_at: supplied.submitted_at ?? new Date().toISOString(),
          }
          if (command.schema_version !== 1 || typeof command.subject_id !== 'string' || !command.subject_id || !Number.isInteger(command.expected_world_revision) || typeof command.operation !== 'string' || !command.operation || typeof command.target_kind !== 'string' || !command.target_kind || typeof command.target_id !== 'string' || !command.target_id || !command.payload || typeof command.payload !== 'object' || Array.isArray(command.payload) || typeof command.submitted_at !== 'string' || !command.submitted_at) {
            res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
            res.end(`${JSON.stringify({ ok: false, error: 'invalid_complete_command' })}\n`)
            return
          }
          const result = await bridge.request('submit_command', { command })
          if (Number.isInteger(result?.world_revision)) latestWorldRevision = result.world_revision
          else if (Number.isInteger(result?.receipt?.world_revision)) latestWorldRevision = result.receipt.world_revision
          const state = result?.receipt?.result_state
          const accepted = state === 'applied' || state === 'no_change'
          const status = accepted ? 200 : (state === 'revision_conflict' || state === 'rejected' ? 409 : 502)
          res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(`${JSON.stringify({ ...result, command_id: result?.command_id ?? command.command_id, accepted })}\n`)
          return
        }
      } catch (error) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(`${JSON.stringify({ ok: false, error: error?.message ?? String(error) })}\n`)
        return
      }
      res.writeHead(404)
      res.end()
    }
    ctx.effect(
      () => webServer.register({ kind: 'prefix', path: '/weftmate/memory', handler: serveMemory }),
      'weftmate-memory: management routes',
    )
  }

  // 首次启动即初始化桥（发现 python 缺失/启动失败只记日志，不拖垮运行时）。
  void stateReady.then(async () => { if (disposed) return; await ensureInitialized(); await reconcileAdoptions(); await flushPending() }).catch((error) => {
    if (!disposed) log(`weftmate-memory: 桥初始化失败: ${error?.message ?? String(error)}`)
  })

  // Cordis disposes effect return values; it does not publish an informal
  // `dispose` event.  This closes Python stdio handles before a fixture or
  // profile can finish, while awaiting only local persistence (never a bridge
  // handoff that might itself be blocked on process shutdown).
  ctx.effect(() => async () => {
    disposed = true
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
    await persistChain.catch(() => {})
    await bridge.close().catch(() => {})
  }, 'weftmate-memory: bridge lifecycle')
}
