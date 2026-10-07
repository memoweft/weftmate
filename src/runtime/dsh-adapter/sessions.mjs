/**
 * P1-03 DSH session adapter.
 *
 * This module deliberately receives the already-composed in-process client
 * (`new InProcessApiClient(toFetchHandler(ctx.apiProxy))`).  It does not boot a
 * second DSH runtime and it does not create a fictitious `session.resume` RPC.
 */

import { createHash } from 'node:crypto'

const SAFE_ERROR_CODES = new Set([
  'session-not-found',
  'session-conflict',
  'agent-busy',
  'cancelled',
  'internal',
  'workspace-not-found',
  'workspace-invalid-path',
  'workspace-name-conflict',
  'settings-rejected',
  'approval-not-pending',
  'attachment-error',
])
const SAFE_IMAGE_REASONS = new Set([
  'MODEL_DOES_NOT_SUPPORT_IMAGES', 'INVALID_IMAGE_BASE64', 'TOO_MANY_IMAGES',
  'IMAGES_TOO_LARGE', 'INVALID_IMAGE', 'IMAGE_TYPE_MISMATCH', 'IMAGE_TOO_LARGE',
  'IMAGE_TOO_MANY_PIXELS',
])

export class DshAdapterError extends Error {
  constructor(code, operation, digest = null, reasonCode = null) {
    super(`DSH ${operation} failed`)
    this.name = 'DshAdapterError'
    this.code = SAFE_ERROR_CODES.has(code) ? code : 'dsh-rejected'
    this.operation = operation
    this.details = digest === null ? {} : { digest }
    if (SAFE_IMAGE_REASONS.has(reasonCode)) this.reasonCode = reasonCode
  }
}

function stableJson(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (seen.has(value)) return '"[circular]"'
  seen.add(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item, seen)).join(',')}]`
  const entries = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key], seen)}`)
  return `{${entries.join(',')}}`
}

/** Hash only; callers must never place the source payload in an ordinary event or receipt. */
export async function payloadDigest(value) {
  const bytes = new TextEncoder().encode(stableJson(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Unwrap an RpcResponse envelope into its ok value, or throw a redacted DshAdapterError. */
export async function unwrap(response, operation) {
  const result = response?.result
  if (result?.ok === true) return result.value
  if (result?.ok === false) {
    throw new DshAdapterError(result.error?.code, operation, await payloadDigest(result.error ?? null),
      result.error?.details?.reason)
  }
  // The narrow client contract returns an RpcResponse.  Keeping this failure
  // structured prevents accidental rendering/logging of an unexpected body.
  throw new DshAdapterError('dsh-rejected', operation, await payloadDigest(response ?? null))
}

function sessionIdOf(value) {
  return typeof value?.sessionId === 'string' && value.sessionId.length > 0 ? value.sessionId : null
}

function isSubagentSummary(item) {
  // `parentSessionId` is lineage, not an ownership fence: an ordinary fork
  // retains it too.  The pinned API exposes `origin: 'subagent'` precisely for
  // the session-backed subagent boundary.
  return item?.origin === 'subagent'
}

function requireOrdinarySummary(item, sessionId) {
  if (item === undefined) throw new DshAdapterError('session-not-found', 'resume')
  if (isSubagentSummary(item)) throw new DshAdapterError('agent-busy', 'resume')
  if (sessionIdOf(item) !== sessionId) throw new DshAdapterError('session-not-found', 'resume')
}

const HISTORY_TEXT_LIMIT = 4_000
const HISTORY_PAGE_LIMIT = 200
const HISTORY_NATIVE_PAGE_LIMIT = 24
const HISTORY_RAW_EVENT_LIMIT = 12_000
const HISTORY_PROJECTED_EVENT_LIMIT = 12_000
const HISTORY_RESPONSE_BYTES_LIMIT = 900_000
function safeHistoryText(value) {
  const raw = String(value ?? '')
  const text = raw.slice(0, HISTORY_TEXT_LIMIT)
    .replace(/(?:[A-Za-z]:\\|\\\\)[^\s"'<>]+/g, '[local path]')
    .replace(/(^|[\s(])\/(?:[^\s"'<>/]+\/)*[^\s"'<>/]+/g, '$1[local path]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/(?:sk-[A-Za-z0-9_-]{8,}|(?:api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+)/gi, '[redacted]')
  return { text, ...(raw.length > HISTORY_TEXT_LIMIT ? { truncated: true } : {}) }
}
function messageText(message, includeHash = false) {
  if (!Array.isArray(message?.content)) return null
  const text = message.content.filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('')
  return text ? { ...safeHistoryText(text), ...(includeHash
    ? { messageHash: createHash('sha256').update(text, 'utf8').digest('hex') } : {}) } : null
}
function messageImages(message) {
  if (!Array.isArray(message?.content)) return []
  return message.content.filter((part) => part?.type === 'image' && part.attachment &&
    typeof part.attachment.attachmentId === 'string' &&
    /^sha256:[a-f0-9]{64}$/.test(part.attachment.attachmentId) &&
    ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(part.attachment.mediaType) &&
    Number.isSafeInteger(part.attachment.bytes) && part.attachment.bytes > 0 &&
    Number.isSafeInteger(part.attachment.width) && part.attachment.width > 0 &&
    Number.isSafeInteger(part.attachment.height) && part.attachment.height > 0)
    .slice(0, 4).map((part) => ({ attachmentId: part.attachment.attachmentId,
      contentType: part.attachment.mediaType, size: part.attachment.bytes,
      width: part.attachment.width, height: part.attachment.height,
      ...(typeof part.attachment.name === 'string' ? { name: safeHistoryText(part.attachment.name.slice(0, 120)).text } : {}) }))
}

/** The remote timeline contains only user-visible text and closed turn states. */
export function projectHistoryEvent(raw) {
  const event = raw?.event ?? raw
  const seq = event?.seq
  if (!Number.isSafeInteger(seq) || seq < 0) return null
  const type = event?.type
  let projected = null
  if (type === 'user/message' && event.data?.source?.kind === 'user') {
    const message = event.data?.message ?? event.data
    const data = messageText(message, true)
    const images = messageImages(message)
    const receiptId = typeof event.data?.source?.rpcId === 'string' &&
      /^[A-Za-z0-9._:-]{1,160}$/.test(event.data.source.rpcId) ? event.data.source.rpcId : null
    if (data || images.length) projected = { seq, type: 'user.message', data: { ...(data ?? { text: '' }),
      ...(images.length ? { images } : {}), ...(receiptId ? { receiptId } : {}) } }
  } else if (type === 'assistant/message') {
    const message = event.data?.message ?? event.data
    const data = messageText(message)
    const images = messageImages(message)
    if (data || images.length) projected = { seq, type: 'assistant.message', data: { ...(data ?? { text: '' }),
      ...(images.length ? { images } : {}) } }
  } else if (type === 'turn/start') {
    projected = { seq, type: 'turn.started', data: {
      ...(Number.isSafeInteger(event.data?.turn) && event.data.turn > 0 ? { turn: event.data.turn } : {}) } }
  } else if (type === 'turn/end') {
    const kind = event.data?.reason?.kind
    projected = { seq, type: 'turn.ended', data: {
      reason: kind === 'max-tokens' ? 'error'
        : ['completed', 'aborted', 'error', 'blocked'].includes(kind) ? kind : 'unknown',
      ...(kind === 'max-tokens' ? { endReasonKind: 'max-tokens' } : {}),
      ...(Number.isSafeInteger(event.data?.turn) && event.data.turn > 0 ? { turn: event.data.turn } : {}) } }
  }
  if (projected && Number.isFinite(event.time) && Math.abs(event.time) <= 8.64e15) projected.at = new Date(event.time).toISOString()
  return projected
}

export function pageHistoryEvents(entries, afterSeq = -1, limit = 50) {
  if (!Number.isSafeInteger(afterSeq) || afterSeq < -1 || !Number.isInteger(limit) || limit < 1 || limit > HISTORY_PAGE_LIMIT) {
    throw new TypeError('invalid history cursor or limit')
  }
  const ordered = (Array.isArray(entries) ? entries : []).map((entry) => ({ entry, seq: (entry?.event ?? entry)?.seq }))
    .filter((row) => Number.isSafeInteger(row.seq) && row.seq >= 0 && row.seq > afterSeq)
    .sort((a, b) => a.seq - b.seq)
  const events = []
  let nextSeq = afterSeq
  let previousSeq = null
  let hasMore = false
  let projectedBytes = 0
  for (const row of ordered) {
    if (row.seq === previousSeq) continue
    previousSeq = row.seq
    const event = projectHistoryEvent(row.entry)
    if (event && events.length >= limit) { hasMore = true; break }
    if (event && events.length > 0 && projectedBytes + Buffer.byteLength(JSON.stringify(event), 'utf8') > HISTORY_RESPONSE_BYTES_LIMIT) {
      hasMore = true; break
    }
    nextSeq = row.seq
    if (event) { events.push(event); projectedBytes += Buffer.byteLength(JSON.stringify(event), 'utf8') }
  }
  return { events, nextSeq, hasMore }
}

function historyWindow(entries, beforeSeq, tailWatermark = Infinity) {
  const rows = entries.map((entry) => ({ entry, seq: (entry?.event ?? entry)?.seq }))
    .filter((row) => Number.isSafeInteger(row.seq) && row.seq >= 0 && row.seq <= tailWatermark &&
      (beforeSeq === undefined || row.seq < beforeSeq))
    .sort((a, b) => a.seq - b.seq)
  const projected = []
  let previousSeq = null
  for (const row of rows) {
    if (row.seq === previousSeq) continue
    const event = projectHistoryEvent(row.entry)
    if (event) projected.push({ event, scannedBeforeSeq: previousSeq })
    previousSeq = row.seq
  }
  return { projected, oldest: rows[0]?.seq ?? null, newest: rows.at(-1)?.seq ?? -1 }
}

function pageProjectedHistory(rows, afterSeq, limit, tailWatermark, windowEnds) {
  const events = []
  let nextSeq = afterSeq, bytes = 0, hasMore = false
  for (const row of [...rows.values()].sort((a, b) => a.event.seq - b.event.seq)) {
    const event = row.event
    const eventBytes = Buffer.byteLength(JSON.stringify(event), 'utf8')
    if (eventBytes > HISTORY_RESPONSE_BYTES_LIMIT) {
      throw Object.assign(new Error('history event exceeds response bound'), { code: 'history-window-limited' })
    }
    if (events.length >= limit || bytes + eventBytes > HISTORY_RESPONSE_BYTES_LIMIT) {
      nextSeq = Math.max(nextSeq, row.scannedBeforeSeq ?? afterSeq,
        ...windowEnds.filter((seq) => seq < event.seq))
      hasMore = true
      break
    }
    events.push(event); bytes += eventBytes; nextSeq = event.seq
  }
  if (!hasMore) nextSeq = Math.max(nextSeq, tailWatermark)
  return { events, nextSeq, hasMore }
}

/**
 * Build the session-side adapter around the supported client methods only.
 * Ownership is gateway-local and is intentionally not inferred from a stream
 * disconnect; a resume explicitly re-establishes it after list + history.
 */
export function createDshSessionAdapter(client) {
  if (!client?.sessions || !client?.events) throw new TypeError('supported DSH client is required')
  const owned = new Map()

  function assertOwned(sessionId, operation) {
    if (!owned.has(sessionId)) throw new DshAdapterError('session-not-found', operation)
  }

  return {
    /** Product-safe ordinary-session summaries for the WeftMate sidebar. */
    async list() {
      const value = await unwrap(await client.sessions.list({}), 'list')
      const items = Array.isArray(value?.items) ? value.items : []
      return items
        .filter((item) => item?.origin !== 'subagent' && sessionIdOf(item) !== null)
        .map((item) => ({
          sessionId: sessionIdOf(item),
          title: typeof item.title === 'string' ? item.title : '新对话',
          running: item.running === true,
          ...(typeof item.agentPreset === 'string' ? { agentPreset: item.agentPreset } : {}),
        }))
    },
    async create(options = {}) {
      const value = await unwrap(await client.sessions.create(options), 'create')
      const sessionId = sessionIdOf(value)
      if (sessionId === null) throw new DshAdapterError('dsh-rejected', 'create', await payloadDigest(value))
      owned.set(sessionId, { lastSeq: -1, cancelRequested: false })
      return { sessionId }
    },

    /** Identity recovery plus replay reconciliation input; no native resume RPC exists. */
    async resume(sessionId) {
      const listed = await unwrap(await client.sessions.list({}), 'list')
      const item = (Array.isArray(listed?.items) ? listed.items : []).find((candidate) => sessionIdOf(candidate) === sessionId)
      requireOrdinarySummary(item, sessionId)
      const history = await unwrap(await client.sessions.history({ sessionId }), 'history')
      const historyEntries = Array.isArray(history?.events) ? history.events : []
      // DSH returns HistoryEntry `{ event, view? }`; attach only the known
      // session identity for the replay consumer, retaining the raw entry.
      const events = historyEntries.map((entry) => ({ ...entry, sessionId }))
      const lastSeq = historyEntries.reduce((max, entry) => Math.max(max, Number.isInteger(entry?.event?.seq) ? entry.event.seq : -1), -1)
      owned.set(sessionId, { lastSeq, cancelRequested: false })
      return { sessionId, events, lastSeq }
    },

    async historyPage(sessionId, { afterSeq = -1, limit = 50 } = {}) {
      if (typeof sessionId !== 'string' || sessionId.length === 0) throw new TypeError('sessionId is required')
      pageHistoryEvents([], afterSeq, limit)
      const listed = await unwrap(await client.sessions.list({}), 'list')
      const item = (Array.isArray(listed?.items) ? listed.items : []).find((candidate) => sessionIdOf(candidate) === sessionId)
      requireOrdinarySummary(item, sessionId)
      const projected = new Map()
      const windowEnds = []
      let beforeSeq
      let tailWatermark = null
      let complete = false
      for (let page = 0; page < HISTORY_NATIVE_PAGE_LIMIT; page += 1) {
        const history = await unwrap(await client.sessions.history({ sessionId, maxMessages: 50,
          ...(beforeSeq === undefined ? {} : { beforeSeq }) }), 'history')
        if (!Array.isArray(history?.events) || typeof history.hasMore !== 'boolean') throw new DshAdapterError('internal', 'history')
        const window = historyWindow(history.events, beforeSeq, tailWatermark ?? Infinity)
        const oldest = window.oldest
        if (history.hasMore && oldest === null) throw Object.assign(new Error('history window cannot advance'), { code: 'history-window-limited' })
        if (tailWatermark === null) tailWatermark = window.newest
        windowEnds.push(window.newest)
        for (const row of window.projected) {
          if (row.event.seq <= afterSeq) continue
          const previous = projected.get(row.event.seq)
          if (!previous || (row.scannedBeforeSeq ?? -1) > (previous.scannedBeforeSeq ?? -1)) projected.set(row.event.seq, row)
        }
        // Public history capacity counts public projection, not chunk/tool
        // records that will never be returned to the conversation timeline.
        if (projected.size > HISTORY_PROJECTED_EVENT_LIMIT) throw Object.assign(new Error('history window exceeds bounded scan'), { code: 'history-window-limited' })
        if (!history.hasMore || tailWatermark <= afterSeq || (oldest !== null && oldest <= afterSeq)) { complete = true; break }
        if (oldest === null || (beforeSeq !== undefined && oldest >= beforeSeq)) {
          throw Object.assign(new Error('history window did not advance'), { code: 'history-window-limited' })
        }
        beforeSeq = oldest
      }
      if (!complete) throw Object.assign(new Error('history window exceeds page bound'), { code: 'history-window-limited' })
      return pageProjectedHistory(projected, afterSeq, limit, tailWatermark, windowEnds)
    },

    /** Internal source evidence cut at the original subscribed/question watermark. */
    async questionHistoryAsOf(sessionId, observedSeq) {
      if (typeof sessionId !== 'string' || !sessionId || !Number.isSafeInteger(observedSeq) || observedSeq < 0) {
        throw new TypeError('invalid question source watermark')
      }
      const entries = []
      let beforeSeq = observedSeq + 1, complete = false, bytes = 0
      for (let page = 0; page < HISTORY_NATIVE_PAGE_LIMIT; page++) {
        const history = await unwrap(await client.sessions.history({ sessionId, beforeSeq, maxMessages: 50 }), 'question.history')
        if (!Array.isArray(history?.events) || typeof history.hasMore !== 'boolean') throw new DshAdapterError('internal', 'question.history')
        const selected = history.events.filter(entry => {
          const seq = (entry?.event ?? entry)?.seq
          return Number.isSafeInteger(seq) && seq >= 0 && seq <= observedSeq && seq < beforeSeq
        })
        bytes += Buffer.byteLength(JSON.stringify(selected), 'utf8'); entries.push(...selected)
        if (entries.length > HISTORY_RAW_EVENT_LIMIT || bytes > HISTORY_RESPONSE_BYTES_LIMIT) {
          throw Object.assign(new Error('question source evidence exceeds bounded scan'), { code: 'history-window-limited' })
        }
        if (selected.some(entry => (entry?.event ?? entry)?.type === 'turn/start') || !history.hasMore) { complete = true; break }
        const sequences = selected.map(entry => (entry?.event ?? entry)?.seq)
        const oldest = sequences.length ? Math.min(...sequences) : null
        if (oldest === null || oldest >= beforeSeq) throw new DshAdapterError('internal', 'question.history')
        beforeSeq = oldest
      }
      if (!complete) throw Object.assign(new Error('question source evidence exceeds page bound'), { code: 'history-window-limited' })
      return entries
    },

    async send(sessionId, content, mode = 'queue') {
      assertOwned(sessionId, 'send')
      if (mode !== 'queue' && mode !== 'steer') throw new TypeError('mode must be queue or steer')
      const parts = typeof content === 'string' ? [{ type: 'text', text: content }] : content
      if (!Array.isArray(parts) || parts.length < 1 || parts.length > 5 ||
          parts.some((part) => part?.type === 'text' ? typeof part.text !== 'string'
            : part?.type === 'image' ? !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(part.mediaType) ||
              typeof part.data !== 'string' || part.data.length > 7_000_000 ||
              (part.name !== undefined && (typeof part.name !== 'string' || part.name.length > 120))
              : true) || !parts.some((part) => part.type === 'image' || part.text.trim())) {
        throw new TypeError('content must contain bounded text or image parts')
      }
      // The supported DSH wire is an array of prompt content parts, not the
      // convenient renderer string.  Passing the string through is rejected
      // before the Agent can begin a turn, which also makes a healthy model
      // look like a credential failure.
      const response = await client.sessions.prompt({
        sessionId,
        mode,
        content: parts,
      })
      const value = await unwrap(response, 'prompt')
      const receiptId = typeof response?.rpcId === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(response.rpcId)
        ? response.rpcId : undefined
      return { accepted: value?.accepted === true, command: value?.command, ...(receiptId ? { receiptId } : {}) }
    },

    async attachment(sessionId, attachmentId) {
      assertOwned(sessionId, 'attachment')
      if (typeof attachmentId !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(attachmentId))
        throw new TypeError('invalid attachment id')
      const result = await unwrap(await client.sessions.attachment({ sessionId, attachmentId }), 'attachment')
      if (result?.attachment?.attachmentId !== attachmentId || typeof result?.data !== 'string' ||
          result.data.length > 7_000_000) throw new DshAdapterError('dsh-rejected', 'attachment')
      return result
    },

    /** Acknowledged cancellation is a receipt, not proof that the turn stopped. */
    async cancel(sessionId) {
      assertOwned(sessionId, 'cancel')
      const value = await unwrap(await client.sessions.cancel({ sessionId }), 'cancel')
      const record = owned.get(sessionId)
      if (record !== undefined) record.cancelRequested = value?.accepted === true
      return { accepted: value?.accepted === true, observedStopped: false }
    },

    /** `since` is intentionally omitted: this DSH pin ignores it. */
    openMux(signal) {
      return client.events.mux({}, signal)
    },

    openHost(signal) {
      return client.events.host({}, signal)
    },

    /** Resolve one live tool-approval request.  The opaque rpcId is supplied
     * only by a current mux frame; no approval state is recreated by WeftMate. */
    async respondApproval({ rpcId, sessionId, approvalId, outcome }) {
      if (typeof rpcId !== 'string' || typeof sessionId !== 'string' || typeof approvalId !== 'string') {
        throw new TypeError('approval response identifiers are required')
      }
      if (outcome !== 'allowed-once' && outcome !== 'rejected') throw new TypeError('invalid approval outcome')
      // `respond()` is the client-response carrier, not an ordinary RPC
      // method: the pinned client returns its receipt directly instead of an
      // `{ result: { ok, value } }` envelope.  Applying `unwrap()` here turns
      // every valid allow/reject into a fabricated gateway failure.
      const value = await client.respond({
        // DSH routes this carrier by its discriminant before it can resolve
        // the pending approval.  This is not an optional metadata field.
        type: 'client-response',
        rpcId,
        result: { ok: true, value: { sessionId, approvalId, outcome } },
      })
      if (value?.accepted !== true) {
        // `reason` is a closed transport enum (for example `not-pending` or
        // `bad-response`), never a model/tool payload.  Preserve only its
        // digest on the product boundary while retaining a diagnostic code.
        throw new DshAdapterError('approval-not-pending', 'approval.respond', await payloadDigest(value?.reason ?? null))
      }
      return { accepted: true }
    },

    /** User information uses the native question carrier; it does not answer a tool approval. */
    async respondUserQuestion({ questionRpcId, sessionId, answer }) {
      if (typeof sessionId !== 'string' || !sessionId || typeof questionRpcId !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(questionRpcId) ||
          !answer || typeof answer !== 'object' || Array.isArray(answer) ||
          Object.keys(answer).join(',') !== 'answers' || !Array.isArray(answer.answers)) {
        throw new TypeError('invalid question response')
      }
      const value = await client.respond({ type: 'client-response', rpcId: questionRpcId,
        result: { ok: true, value: { sessionId, answer } } })
      if (value?.accepted === true && Object.keys(value).length === 1) return { accepted: true }
      if (value?.accepted === false && ['not-pending', 'bad-response'].includes(value.reason) &&
          Object.keys(value).every(key => ['accepted', 'reason'].includes(key))) {
        return { accepted: false, reason: value.reason }
      }
      throw new DshAdapterError('internal', 'question.respond', await payloadDigest(value ?? null))
    },

    getReplayCursor(sessionId) {
      assertOwned(sessionId, 'events')
      return owned.get(sessionId).lastSeq
    },

    noteReplayCursor(sessionId, lastSeq) {
      assertOwned(sessionId, 'events')
      if (Number.isInteger(lastSeq)) owned.get(sessionId).lastSeq = Math.max(owned.get(sessionId).lastSeq, lastSeq)
    },
  }
}
