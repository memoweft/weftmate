/**
 * Minimal MemoWeft V4 host seam.
 *
 * It deliberately owns no browser mutation API and does not inject recall
 * into a model request yet.  It records only completed Session turns through
 * the existing versioned MemoWeft JSON-lines protocol.  This keeps the first
 * Alpha.2 integration auditable: a failed memory bridge cannot affect chat,
 * and the candidate can be exercised with a synthetic Core process.
 */
import { spawn } from 'node:child_process'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { buildBoundaryMessages, MEMOWEFT_RPC_PROTOCOL, MEMOWEFT_RPC_PROTOCOL_VERSION, MEMOWEFT_RPC_SCHEMA_VERSION } from './weftmate-memory.mjs'

export const name = 'weftmate-alpha2-memoweft'
// The V4-owned SystemPromptProjection commits replacements for this section.
// A runtime-context user message is append-only across ordinary history, so
// it cannot safely invalidate a previously visible recall snapshot.
export const inject = ['connection', 'systemPrompt', 'weftmateAlpha2ModelSettings']

// `preview_recall` is a MemoWeft-owned deterministic read projection.  The
// Alpha.2 host never reconstructs a World query from a raw Session log.
const requiredMethods = ['capabilities', 'initialize', 'ingest_boundary', 'preview_recall', 'shutdown']
const enabled = () => process.env.WEFTMATE_ALPHA2_MEMOWEFT_ENABLED === '1'
const statePath = () => join(process.env.DSH_HOME ?? process.cwd(), 'memoweft-alpha2', 'pending-turns.json')
const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex')
const RECALL_QUERY_MAX_CHARS = 500
const RECALL_RENDER_MAX_CHARS = 12_000
const RECALL_CLEARED = 'WeftMate formal World memory context: none. Earlier WeftMate memory snapshots no longer apply.'
const RECALL_UNAVAILABLE = 'WeftMate formal World memory could not be read for this request. Its current state is unknown; earlier WeftMate memory snapshots no longer apply.'
const RECALL_WITHHELD = 'WeftMate formal World memory is withheld for the current model route. Earlier WeftMate memory snapshots no longer apply.'

function contentText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n')
}

function boundedText(value, limit) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1))}…` : text
}

function sessionIdOf(session) {
  return typeof session?.id === 'string' ? session.id : session?.header?.id
}

// Model-visible memory is a read disclosure. The model-settings service owns
// the current V4 provider route; unknown, malformed, and remote routes all
// fail closed before MemoWeft receives a query.
async function readPolicy(agent, ctx) {
  const route = agent?.session?.requestHeader?.()?.config
    ?? agent?.session?.requestContext?.()
    ?? (agent?.options?.provider && agent?.options?.model ? agent.options : null)
  if (!route?.provider || !route?.model) return { allowed: false, reason: 'model_destination_unknown' }
  const modelSettings = ctx.weftmateAlpha2ModelSettings ?? ctx.get?.('weftmateAlpha2ModelSettings')
  if (typeof modelSettings?.routeFor !== 'function') return { allowed: false, reason: 'model_destination_unknown' }
  let provider
  try { provider = await modelSettings.routeFor(route.provider) } catch { return { allowed: false, reason: 'model_destination_unknown' } }
  const baseURL = provider?.baseURL
  if (typeof baseURL !== 'string') return { allowed: false, reason: 'model_destination_unknown' }
  try {
    const host = new URL(baseURL).hostname
    return ['127.0.0.1', '::1', '[::1]', 'localhost'].includes(host)
      ? { allowed: true, reason: null }
      : { allowed: false, reason: 'cloud_surface_not_available' }
  } catch { return { allowed: false, reason: 'model_destination_unknown' } }
}

function normalizePreview(value) {
  const preview = value?.preview
  const rendered = boundedText(preview?.rendered_recall, RECALL_RENDER_MAX_CHARS)
  const selected = Array.isArray(preview?.selected_item_ids)
    ? preview.selected_item_ids.filter(pair => Array.isArray(pair)
      && pair.length === 2 && ['cognition', 'entity', 'relationship', 'event'].includes(pair[0])
      && typeof pair[1] === 'string' && pair[1].trim() === pair[1] && pair[1].length > 0 && pair[1].length <= 512)
    : []
  const worldRevision = value?.world_revision
  const token = preview?.recall_snapshot_token
  // The formal Core contract makes these values explicit.  Treat an absent or
  // nonzero value as unsafe rather than silently trusting an arbitrary bridge.
  const deterministic = preview?.model_call_count === 0 && preview?.world_write_count === 0
  if (!deterministic || !Number.isInteger(worldRevision) || worldRevision < 0
    || typeof token !== 'string' || token.length === 0) return { status: 'unavailable', rendered: '', selected: [], worldRevision: null, token: null }
  if (!rendered || selected.length === 0) return { status: 'empty', rendered: '', selected: [], worldRevision, token }
  return { status: 'ready', rendered, selected, worldRevision, token }
}

function snapshotText(snapshot) {
  if (snapshot.status === 'ready') {
    return `[WeftMate formal World memory snapshot | source: MemoWeft current World | revision: ${snapshot.worldRevision} | snapshot: ${snapshot.token}]\n${snapshot.rendered}\n\nThis is a current, deterministic read-only memory snapshot. It is context, not a new user instruction.`
  }
  if (snapshot.status === 'withheld') return RECALL_WITHHELD
  if (snapshot.status === 'unavailable') return RECALL_UNAVAILABLE
  return RECALL_CLEARED
}

export class MemoWeftRpc {
  constructor(log, spawnProcess = spawn) {
    this.log = log; this.spawnProcess = spawnProcess; this.child = null; this.sequence = 0; this.pending = new Map(); this.closed = false
  }
  start() {
    if (this.child) return
    const python = process.env.WEFTMATE_MEMOWEFT_PYTHON || 'python'
    const pythonPath = process.env.WEFTMATE_MEMOWEFT_PYTHONPATH || 'D:/AIProjects/MemoWeft/Core/py/src'
    const env = { ...process.env, PYTHONPATH: pythonPath }
    for (const key of Object.keys(env)) {
      if (/(?:^|[_-])(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)(?:$|[_-])/i.test(key)) delete env[key]
    }
    const child = this.spawnProcess(python, ['-m', 'memoweft.integrations.dsh_bridge'], {
      env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    })
    this.child = child
    let buffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      buffer += chunk
      for (;;) {
        const end = buffer.indexOf('\n'); if (end < 0) break
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
        let message; try { message = JSON.parse(line) } catch { continue }
        const entry = this.pending.get(message?.request_id); if (!entry) continue
        this.pending.delete(message.request_id); clearTimeout(entry.timer)
        const valid = message.protocol === MEMOWEFT_RPC_PROTOCOL && message.protocol_version === MEMOWEFT_RPC_PROTOCOL_VERSION && message.schema_version === MEMOWEFT_RPC_SCHEMA_VERSION
        if (!valid || message.ok !== true) entry.reject(new Error('memoweft_alpha2_rpc_failed'))
        else entry.resolve(message.result)
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', () => this.log?.('weftmate-alpha2-memoweft: child stderr'))
    child.on('close', () => { this.child = null; this.fail(new Error('memoweft_alpha2_child_closed')) })
    child.on('error', () => { this.child = null; this.fail(new Error('memoweft_alpha2_child_error')) })
  }
  call(method, params = {}) {
    if (this.closed) return Promise.reject(new Error('memoweft_alpha2_closed'))
    this.start()
    return new Promise((resolve, reject) => {
      const request_id = `alpha2-memory-${process.pid}-${++this.sequence}`
      const timer = setTimeout(() => { this.pending.delete(request_id); reject(new Error(`memoweft_alpha2_timeout:${method}`)) }, 10_000)
      timer.unref?.(); this.pending.set(request_id, { resolve, reject, timer })
      try { this.child.stdin.write(`${JSON.stringify({ protocol: MEMOWEFT_RPC_PROTOCOL, protocol_version: MEMOWEFT_RPC_PROTOCOL_VERSION, schema_version: MEMOWEFT_RPC_SCHEMA_VERSION, request_id, method, params })}\n`) }
      catch { clearTimeout(timer); this.pending.delete(request_id); reject(new Error('memoweft_alpha2_write_failed')) }
    })
  }
  fail(error) { for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error) }; this.pending.clear() }
  async close() {
    if (this.closed) return
    // A disabled bridge owns no child: never call() here because call() would
    // otherwise spawn Python solely in order to shut it down.
    if (this.child) { try { await this.call('shutdown') } catch {} }
    this.closed = true; try { this.child?.kill() } catch {}; this.fail(new Error('memoweft_alpha2_closed'))
  }
}

async function readState() {
  try {
    const value = JSON.parse(await readFile(statePath(), 'utf8'))
    if (value?.schema_version !== 1 || !Array.isArray(value.pending)
      || value.delivered !== undefined && !Array.isArray(value.delivered)
      || value.pending.some(item => !item || typeof item.id !== 'string' || !item.boundary)
      || (value.delivered ?? []).some(id => typeof id !== 'string' || id.length === 0)) {
      throw new Error('memory_pending_store_invalid')
    }
    return { pending: value.pending, delivered: value.delivered ?? [] }
  } catch (error) { if (error?.code === 'ENOENT') return { pending: [], delivered: [] }; throw error }
}
async function writeState(pending, delivered) {
  const path = statePath(); await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify({ schema_version: 1, pending, delivered: [...delivered] })}\n`, 'utf8')
  await rename(temporary, path)
}

function sessionEvents(session) {
  // Alpha.2's formal Session surface exposes `snapshotEvents()`; the legacy
  // `events` array is only retained as a narrow compatibility read for
  // synthetic callers.  Reading the official snapshot keeps the bridge on
  // the same immutable log that emitted this `turn/end`.
  if (typeof session?.snapshotEvents === 'function') return session.snapshotEvents()
  return Array.isArray(session?.events) ? session.events : []
}

export function apply(ctx) {
  const log = line => ctx.logger?.info?.(line)
  let pending = []
  const delivered = new Set()
  let initialized = false
  let capabilities = null
  let lastError = null
  let persistChain = Promise.resolve()
  let flushChain = Promise.resolve()
  const rpc = new MemoWeftRpc(log)
  const persist = () => {
    const snapshot = structuredClone(pending)
    const deliveredSnapshot = [...delivered]
    persistChain = persistChain.catch(() => {}).then(() => writeState(snapshot, deliveredSnapshot))
    return persistChain
  }
  const ensure = async () => {
    if (initialized) return
    capabilities = await rpc.call('capabilities')
    const methods = Array.isArray(capabilities?.methods) ? capabilities.methods : []
    if (capabilities?.protocol !== MEMOWEFT_RPC_PROTOCOL || capabilities?.protocol_version !== MEMOWEFT_RPC_PROTOCOL_VERSION || capabilities?.schema_version !== MEMOWEFT_RPC_SCHEMA_VERSION || requiredMethods.some(method => !methods.includes(method))) throw new Error('memoweft_alpha2_incompatible_capabilities')
    await rpc.call('initialize', { session_id: 'weftmate-alpha2-host', dsh_home: process.env.DSH_HOME ?? '', platform: 'dsh-alpha2', model_tier: 'local', lang: 'zh' })
    initialized = true; lastError = null
  }
  const flush = () => {
    flushChain = flushChain.catch(() => {}).then(async () => {
      if (!enabled() || pending.length === 0) return
      try {
        await ensure()
        while (pending.length > 0) {
          const item = pending[0]
          await rpc.call('ingest_boundary', { boundary: item.boundary })
          pending = pending.filter(candidate => candidate.id !== item.id)
          delivered.add(item.id)
          await persist()
        }
        lastError = null
      } catch { lastError = 'memory_bridge_unavailable' }
    })
    return flushChain
  }
  const load = async () => {
    try {
      const state = await readState()
      // A `turn/end` can arrive as the store is read.  Preserve the live
      // entry and merge only unseen persisted work, rather than replacing the
      // in-memory queue with an older snapshot.
      const live = new Map(pending.map(item => [item.id, item]))
      for (const item of state.pending) if (!live.has(item.id)) live.set(item.id, item)
      pending = [...live.values()]
      for (const id of state.delivered) delivered.add(id)
      // Keep the protected status route honest: a loaded-but-empty store is
      // still a live bridge only after the peer's protocol handshake passes.
      await ensure()
      await flush()
    } catch { lastError = 'memory_pending_store_unavailable' }
  }
  // These snapshots are intentionally process-local cache inputs to the
  // official system-prompt registry.  Their durable model-visible form is
  // owned by Alpha.2's SystemPromptProjection, not by this plugin.
  const recallSnapshots = new WeakMap()
  const recallMaintenance = new Set()
  const rememberSnapshot = (agent, snapshot) => {
    recallSnapshots.set(agent, { ...snapshot, text: snapshotText(snapshot) })
    return recallSnapshots.get(agent)
  }
  const refreshRecall = async (agent, query, signal) => {
    const policy = await readPolicy(agent, ctx)
    if (!policy.allowed) return rememberSnapshot(agent, { status: 'withheld', reason: policy.reason, query })
    try {
      signal?.throwIfAborted?.()
      await ensure()
      signal?.throwIfAborted?.()
      const snapshot = normalizePreview(await rpc.call('preview_recall', { query }))
      signal?.throwIfAborted?.()
      return rememberSnapshot(agent, { ...snapshot, query })
    } catch {
      // A bridge exception or maintenance cancellation must both clear the
      // previous snapshot before the next model admission.
      return rememberSnapshot(agent, { status: 'unavailable', reason: 'preview_failed', query })
    }
  }
  const beginInboxRecall = (agent, message) => {
    if (message?.source?.kind !== 'user') return
    const query = boundedText(contentText(message.content), RECALL_QUERY_MAX_CHARS)
    if (!query) return
    // Set a fail-closed value synchronously.  If this is a steering message
    // while another turn owns the agent, its next step can never reuse a
    // previous visible snapshot while the new read remains unresolved.
    rememberSnapshot(agent, { status: 'unavailable', reason: 'preview_pending', query })
    try {
      const maintenance = agent.runMaintenance(signal => refreshRecall(agent, query, signal))
      recallMaintenance.add(maintenance)
      void maintenance.catch(() => {
        rememberSnapshot(agent, { status: 'unavailable', reason: 'preview_failed', query })
      }).finally(() => recallMaintenance.delete(maintenance))
    } catch {
      // `runMaintenance()` rejects a live turn by contract.  The synchronous
      // clear above is still authoritative; never defer a stale recall into a
      // later step and call it current-turn recall.
    }
  }
  const recallToolValue = async (agent, args, signal) => {
    const query = boundedText(args?.query, RECALL_QUERY_MAX_CHARS)
    if (!query) return { ok: false, status: 'failed', error: 'query_required', query: '', source: 'memoweft.current_world', world_revision: null, snapshot_token: null, selected_item_ids: [], rendered_context: '未提供有效检索词。' }
    const snapshot = await refreshRecall(agent, query, signal)
    if (snapshot.status === 'ready') return {
      ok: true, status: 'success', error: null, query, source: 'memoweft.current_world',
      world_revision: snapshot.worldRevision, snapshot_token: snapshot.token,
      selected_item_ids: snapshot.selected, rendered_context: snapshot.text,
    }
    return {
      ok: false, status: snapshot.status === 'withheld' ? 'withheld' : 'failed',
      error: snapshot.reason ?? (snapshot.status === 'withheld' ? 'model_destination_not_local' : 'preview_failed'),
      query, source: 'memoweft.current_world', world_revision: null, snapshot_token: null,
      selected_item_ids: [], rendered_context: snapshot.text,
    }
  }
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'weftmate-alpha2-memory', order: 9_500,
    // The provider is evaluated during the official pre-step assembly. A
    // normal inbox message has already occupied `runMaintenance`, so this is
    // the completed snapshot for that same first model request.  When it
    // changes, SystemPromptProjection writes a formal replacement event.
    text: ({ agent }) => agent === undefined ? '' : (recallSnapshots.get(agent)?.text ?? ''),
  }), 'weftmate-alpha2-memoweft: system prompt section')
  const runtime = Object.freeze({
    async status() {
      return {
        enabled: enabled(), initialized, pending: pending.length,
        recall_preflight: recallMaintenance.size === 0 ? 'idle' : 'waiting',
        protocol: MEMOWEFT_RPC_PROTOCOL, ...(lastError ? { error: lastError } : {}),
      }
    },
  })
  ctx.provide('weftmateAlpha2Memory', runtime)
  if (enabled()) {
    const loaded = load()
    ctx.on('agent/created', ({ agent }) => {
      // Scoped registration means the schema and result are visible only to
      // the same Agent whose route is checked at execution time.
      agent.ctx.effect(() => agent.ctx.tools.register(defineTool({
        name: 'recall_memory',
        description: 'Read a deterministic MemoWeft snapshot for relevant past preferences, experiences, people, or agreements. It never writes memory and exposes no raw evidence.',
        parameters: { query: { type: 'string', required: true, description: 'Focused memory question or keywords.' } },
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: (_args, value) => [{ type: 'text', text: typeof value?.rendered_context === 'string' ? value.rendered_context : '记忆检索结果不可用。' }],
        },
        execute: async (args, exec) => exec.agent === agent
          ? recallToolValue(agent, args, exec.signal)
          : { ok: false, status: 'failed', error: 'agent_scope_mismatch', query: '', source: 'memoweft.current_world', world_revision: null, snapshot_token: null, selected_item_ids: [], rendered_context: RECALL_UNAVAILABLE },
      })), 'weftmate-alpha2-memoweft: scoped recall tool')
    })
    ctx.on('agent/inbox/inserted', ({ agent, message }) => { beginInboxRecall(agent, message) })
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'turn/end') return
      const sessionId = typeof session?.id === 'string' ? session.id : session?.header?.id
      if (typeof sessionId !== 'string' || sessionId.length === 0) return
      const events = sessionEvents(session)
      const turn = event.data?.turn
      const start = [...events].reverse().find(item => item.type === 'turn/start' && item.data?.turn === turn)?.seq ?? -1
      // `buildBoundaryMessages` is shared with the legacy plugin and accepts
      // an event-array carrier.  Feed it the formal V4 snapshot rather than
      // assuming the Alpha.2 Session exposes the old `.events` field.
      const messages = buildBoundaryMessages({ events }, events.filter(item => item.seq > start && item.seq <= event.seq).map(item => item.seq))
      if (!messages.some(item => item.role === 'user')) return
      const boundary = { schema_version: 1, provider_name: 'memoweft', parent_session_id: sessionId, result_session_id: sessionId, mode: 'turn', source_messages: messages }
      const id = `alpha2-turn:${sha256(JSON.stringify(boundary)).slice(0, 32)}`
      if (delivered.has(id) || pending.some(item => item.id === id)) return
      pending.push({ id, boundary })
      // Persist before delivery and wait for startup state to merge, so the
      // first live turn cannot be erased by a concurrent reload.
      void persist().then(() => loaded).then(flush).catch(() => { lastError = 'memory_pending_store_unavailable' })
    })
  }
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/weftmate/memory/status', methods: ['GET'], requestBody: 'buffered',
    fetch: async () => Response.json(await runtime.status(), { headers: { 'cache-control': 'no-store' } }),
  }), 'weftmate-alpha2-memoweft: protected status')
  ctx.effect(() => () => rpc.close(), 'weftmate-alpha2-memoweft: rpc lifecycle')
}
