/**
 * WeftMate 记忆宿主插件（R7）：DSH compaction 边界 → MemoWeft 2.0 本地桥。
 *
 * 职责（docs/MEMOWEFT-2-INTEGRATION.md，owner 拍板版）：
 *  - 边界源：官方 `session/event` 事件流里的 `compaction/summary` + `compaction/end`
 *    （A+B：自动压缩与 /compact 同一事件源）——committed boundary 才产生正式记忆；
 *  - 组装精确 user Evidence（被压缩段 shadowedSeqs → 逐字 user/message 文本；
 *    assistant 文本只进 preceding_ai_context，桥侧处理）→ 本地桥入队 Job；
 *  - 预算不变式（AUTHORITY §6.6）：普通回合 0 次记忆调用；每边界 0/1 次（桥侧 worker）；
 *    Recall 0 生成调用、0 写入；
 *  - Recall 注入：`agent/pre-step` 用当轮用户消息确定性查询本地桥，命中才注入
 *    snapshot 节（source 可核验，支撑「已记住」诚实性）；
 *  - 管理面：GET /weftmate/memory/{world,search,export}.json 只读路由（管理页数据面）。
 *
 * 传输：stdio JSON-Lines 长驻子进程 `python -m memoweft.integrations.dsh_bridge`
 * （python/PYTHONPATH 经 env 注入：WEFTMATE_MEMOWEFT_PYTHON / _PYTHONPATH，缺省本机开发值）。
 * 跨进程只传 JSON 叶子；Evidence/World 权威全在 MemoWeft 侧。
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'

export const name = 'weftmate-memory'
export const inject = ['webServer']

const DSH_HOME = () => process.env.DSH_HOME ?? ''
const BOUNDARY_PREFIX = 'weftmate-compression-boundary-v1'
const PYTHON = () => process.env.WEFTMATE_MEMOWEFT_PYTHON || 'python'
const PYTHONPATH = () => process.env.WEFTMATE_MEMOWEFT_PYTHONPATH || 'D:/AIProjects/MemoWeft/Core/py/src'
const RECALL_QUERY_MAX_CHARS = 500
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
    if (block && typeof block === 'object' && typeof block.text === 'string') parts.push(block.text)
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
    })
    child.on('close', () => {
      this.failAll(new Error('[memoweft-bridge] 子进程已退出'))
      this.child = null
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

function adaptWorldForLegacyPanel(result, capabilities) {
  const world = {
    cognitions: [],
    entities: [],
    relationships: [],
    events: [],
    world_revision: result?.world_revision ?? null,
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

/** 从被压缩段（shadowedSeqs）组装边界 source_messages（user 逐字 / assistant 仅上下文）。 */
function buildBoundaryMessages(session, shadowedSeqs) {
  const bySeq = new Map()
  for (const event of session.events ?? []) bySeq.set(event.seq, event)
  const messages = []
  for (const seq of shadowedSeqs ?? []) {
    const event = bySeq.get(seq)
    if (!event) continue
    if (event.type !== 'user/message' && event.type !== 'assistant/message') continue
    const text = contentText(event.data?.content)
    if (!text) continue
    messages.push({
      role: event.type === 'user/message' ? 'user' : 'assistant',
      content: text,
      timestamp: Math.floor((Number(event.time) || Date.now()) / 1000),
    })
  }
  return messages.map((message, index) => ({ ...message, source_ref: `source:${index}` }))
}

export function apply(ctx) {
  const log = (line) => {
    try { ctx.logger?.info?.(line) } catch { /* 日志尽力 */ }
  }
  const bridge = new MemoWeftBridge({ log })
  const summaries = new WeakMap() // session → Map<compactionId, { shadowedSeqs }>
  let initialized = false
  let initializePromise = null

  const ensureInitialized = async () => {
    if (initialized) return
    if (!initializePromise) {
      initializePromise = (async () => {
        bridge.acceptCapabilities(await bridge.request('capabilities'))
        const result = await bridge.request('initialize', {
          session_id: 'weftmate-host',
          dsh_home: DSH_HOME(),
          platform: 'dsh',
        })
        bridge.acceptCapabilities(result?.capabilities)
        initialized = true
        log(`weftmate-memory: bridge ready (${MEMOWEFT_RPC_PROTOCOL} v${MEMOWEFT_RPC_PROTOCOL_VERSION})`)
      })().catch((error) => {
        initializePromise = null
        throw error
      })
    }
    await initializePromise
  }

  // ── 边界源（A+B：自动压缩与 /compact 同一事件面）──
  ctx.on('session/event', (session, event) => {
    try {
      if (event.type === 'compaction/summary') {
        let perSession = summaries.get(session)
        if (!perSession) { perSession = new Map(); summaries.set(session, perSession) }
        perSession.set(event.data.compactionId, { shadowedSeqs: event.data.shadowedSeqs ?? [] })
        return
      }
      if (event.type !== 'compaction/end') return
      if (event.data?.error) return // 失败压缩不是 committed boundary
      const perSession = summaries.get(session)
      const summary = perSession?.get(event.data.compactionId)
      if (!summary) return
      perSession.delete(event.data.compactionId)
      const messages = buildBoundaryMessages(session, summary.shadowedSeqs)
      if (!messages.some((message) => message.role === 'user')) return // 无 user Evidence 不入队
      const sessionId = typeof session.header?.id === 'string' ? session.header.id : 'unknown'
      const occurrence = sha256Hex(`${sessionId}|${event.data.compactionId}`).slice(0, 32)
      const payload = {
        schema_version: 1,
        provider_name: 'memoweft',
        parent_session_id: sessionId,
        result_session_id: sessionId,
        mode: 'in_place',
        source_messages: messages,
      }
      const payloadHash = sha256Hex(canonicalJson(payload))
      const boundary = {
        ...payload,
        event_id: `${BOUNDARY_PREFIX}:${occurrence}:${payloadHash}`,
        payload_hash: payloadHash,
      }
      // 异步入队（不阻塞会话事件流）；预算 0/1 由桥侧 worker 保证。
      void ensureInitialized()
        .then(() => bridge.request('ingest_boundary', { boundary }))
        .then((receipt) => log(`weftmate-memory: boundary ${receipt?.job_state ?? '?'}（eligible=${receipt?.eligible ?? '?'}）`))
        .catch((error) => log(`weftmate-memory: boundary 入队失败: ${error?.message ?? String(error)}`))
    } catch (error) {
      log(`weftmate-memory: 边界处理异常: ${error?.message ?? String(error)}`)
    }
  })

  // ── Recall 注入：当轮用户消息确定性查询；命中才注入（0 生成调用、0 写入）──
  let lastRecallQuery = ''
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    try {
      if (decision.kind === 'reject' || payload?.signal?.aborted) return decision
      const query = (decision.messages ?? [])
        .map((message) => contentText(message?.content))
        .join('\n')
        .trim()
        .slice(0, RECALL_QUERY_MAX_CHARS)
      if (!query || query === lastRecallQuery) return decision
      lastRecallQuery = query
      await ensureInitialized()
      const recall = await bridge.request('prefetch', { query, session_id: payload?.agent?.session?.header?.id ?? '' })
      if (!recall || typeof recall.text !== 'string' || !recall.text.trim() || !recall.count) return decision
      const { createUserMessage } = await import('@deepseek-ai/dsh-llm')
      if (typeof createUserMessage !== 'function') return decision
      return {
        kind: 'enter',
        messages: [
          ...decision.messages,
          createUserMessage({
            content: [{ type: 'text', text: recall.text.trim() }],
            source: { kind: 'plugin', plugin: 'weftmate-memory', form: 'snapshot', sections: [{ name: 'weftmate-memory', text: recall.text.trim() }] },
          }),
        ],
      }
    } catch { return decision } // 记忆面任何异常都不挡主链路
  }, { prepend: true })

  // ── 管理面（只读）：浏览/搜索/导出 ──
  const webServer = ctx.get('webServer')
  if (webServer) {
    const serveMemory = async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://x')
      try {
        if (url.pathname === '/weftmate/memory/world.json') {
          await ensureInitialized()
          const result = await bridge.request('query_world', { operation: 'list' })
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
  void ensureInitialized().catch((error) => log(`weftmate-memory: 桥初始化失败: ${error?.message ?? String(error)}`))

  ctx.on('dispose', () => {
    void bridge.close().catch(() => {})
  })
}
