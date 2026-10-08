/**
 * P1-03 DSH session adapter.
 *
 * This module deliberately receives the already-composed in-process client
 * (`new InProcessApiClient(toFetchHandler(ctx.apiProxy))`).  It does not boot a
 * second DSH runtime and it does not create a fictitious `session.resume` RPC.
 */

import { createHash } from 'node:crypto'
import { describeTool, toolArguments } from './timeline.mjs'
import { sourceRange } from './source-range.mjs'
import { indexInboxTimeline, turnReceiptAt } from './inbox-timeline.mjs'

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

/** Stable public timeline; private reasoning and injected messages stay private. */
export function projectHistoryEvent(raw, call = null, contextTurn = null, closingTurn = null, inbox = null) {
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
      ...(images.length ? { images } : {}),
      ...(Array.isArray(event.data?.memoryUsed) ? { memoryUsed: event.data.memoryUsed
        .filter(item => ['cognition', 'entity', 'relationship', 'event'].includes(item?.kind) &&
          typeof item.id === 'string' && /^[A-Za-z0-9._:-]{1,512}$/.test(item.id) && typeof item.summary === 'string')
        .map(item => ({ id: item.id, kind: item.kind, summary: safeHistoryText(item.summary.slice(0, 240)).text })) } : {}) } }
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
  const data = event.data ?? {}
  const taskId = typeof data.taskId === 'string' ? data.taskId : `turn-${data.turn ?? call?.data?.turn ?? contextTurn ?? 'unknown'}`
  if (type === 'tool/call' || type === 'tool/result') {
    const part = data.message?.content?.find(part => part.type === 'tool-result')
    const stepId = data.callId ?? data.message?.source?.callId ?? part?.toolCallId
    const toolName = data.name ?? call?.data?.name ?? 'tool'
    if (typeof stepId === 'string') {
      const asked = toolName === 'ask_user_question'
      projected = { seq, type: asked ? type === 'tool/call' ? 'question.asked' : 'question.answered'
        : type === 'tool/call' ? 'step.started' : 'step.completed', data: {
        taskId, stepId, callId: stepId, toolName,
        summary: safeHistoryText(describeTool(toolName, data.arguments ?? call?.data?.arguments)).text,
        groupHint: toolName, detailRef: { seq },
        ...(Number.isSafeInteger(data.turn) ? { turn: data.turn } : {}),
        ...(type === 'tool/result' ? { state: data.error || part?.isError ? 'failed' : 'completed' } : { state: 'running' }),
        ...(asked && type === 'tool/call' ? { questions: boundedTimelineValue(toolArguments(data.arguments).questions ?? []) } : {}),
      } }
    }

    if (type === 'tool/result' && projected?.type === 'step.completed') {
      const artifacts = (part?.content?.filter(p => p.type === 'text').map(p => toolArguments(p.text)) ?? [])
        .map(value => value.artifact ?? value).filter(value => typeof value?.artifactId === 'string')
        .map(value => ({ taskId: value.taskId ?? taskId, artifactId: value.artifactId,
          fileName: safeHistoryText(value.fileName ?? '成果文件').text,
          contentType: value.contentType ?? 'text/plain', size: value.size ?? 0 }))
      if (artifacts.length) projected = { seq, type: 'artifact.created', data: {
        ...artifacts[0], ...(artifacts.length > 1 ? { artifacts } : {}),
        detailSeq: seq, completedStep: projected.data,
      } }

    }
  } else if (type === 'approval/asked' || type === 'approval/decided') {
    projected = { seq, type: type === 'approval/asked' ? 'approval.requested' : 'approval.resolved', data: {
      taskId, approvalId: data.id, ...(data.callId ? { stepId: data.callId } : {}),
      ...(data.toolName ? { toolName: data.toolName } : {}),
      ...(Number.isSafeInteger(contextTurn) ? { turn: contextTurn } : {}),
      summary: safeHistoryText(data.reason ?? (data.toolName ? describeTool(data.toolName) : '执行审批')).text,
      ...(data.outcome ? { outcome: data.outcome } : {}), detailRef: { seq },
    } }
  } else if (type === 'step/start' && data.step === 1) {
    projected = { seq, type: 'task.started', data: { taskId, turn: data.turn } }
  } else if (type === 'step/end' && closingTurn) {
    const kind = closingTurn.data?.reason?.kind
    projected = { seq, type: 'task.ended', data: { taskId, turn: data.turn,
      reason: kind === 'max-tokens' ? 'error' : kind ?? 'unknown', nativeTurnEndSeq: closingTurn.seq,
      ...(kind === 'max-tokens' ? { endReasonKind: kind } : {}) } }
  } else if (type === 'agent/inbox/spliced' && inbox?.tasks) {
    const tasks = inbox.tasks.filter(task => typeof task.receiptId === 'string').map(task => ({
      taskId: task.receiptId, receiptId: task.receiptId,
      ...(inbox.type === 'task.queued' ? { text: safeHistoryText(task.text).text } : { reason: inbox.reason }),
    }));
    if (tasks.length) projected = { seq, type: inbox.type, data: { ...tasks[0],
      ...(tasks.length > 1 ? { tasks } : {}) } };
  } else if (type === 'task.queued') {
    // Reserved read projection for a future native queue producer; never write
    // unknown event types into this fixed DSH runtime's durable log.
    projected = { seq, type, data: boundedTimelineValue({ ...data, taskId }) }
  }
  if (projected && ['task.started', 'task.ended'].includes(projected.type) && inbox?.receiptId) {
    projected.data.receiptId = inbox.receiptId;
  }
  if (projected && Buffer.byteLength(JSON.stringify(projected), 'utf8') > 32_000) {
    const { taskId, stepId, callId, toolName, summary, state, artifactId, fileName, size, contentType } = projected.data
    projected.data = { taskId, stepId, callId, toolName, summary, state, artifactId, fileName, size, contentType,
      detailRef: { seq }, truncated: true }
  }
  if (projected && Number.isFinite(event.time) && Math.abs(event.time) <= 8.64e15) projected.at = new Date(event.time).toISOString()
  return projected
}

function boundedTimelineValue(value, depth = 0) {
  if (typeof value === 'string') return safeHistoryText(value).text
  if (value === null || typeof value !== 'object') return value
  if (depth > 6) return '[truncated]'
  if (Array.isArray(value)) return value.slice(0, 20).map(item => boundedTimelineValue(item, depth + 1))
  return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [key, boundedTimelineValue(item, depth + 1)]))
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

// Native logs are ordered by seq; a binary lookup avoids rescanning skipped history.
function lowerBound(entries, seq) {
  let lo = 0, hi = entries.length
  while (lo < hi) { const mid = (lo + hi) >>> 1
    if ((entries[mid]?.event ?? entries[mid]).seq < seq) lo = mid + 1; else hi = mid }
  return lo
}
function relatedCall(entries, index, cache) {
  const event = entries[index]?.event ?? entries[index]
  if (event.type !== 'tool/result') return null
  const id = event.data?.message?.source?.callId ?? event.data?.message?.content?.find(p => p.type === 'tool-result')?.toolCallId
  const key = `${event.data?.turn}:${id}`
  if (cache.calls.has(key)) return cache.calls.get(key)
  const end = index; let start = index
  for (let i = index - 1; i >= 0; i--) {
    const covered = cache.ranges.find(range => i >= range[0] && i < range[1])
    if (covered) {
      const boundary = cache.turns.get(event.data?.turn)
      if (boundary !== undefined && boundary >= covered[0] && boundary <= i) { start = boundary; break }
      start = covered[0]; i = covered[0]; continue
    }
    start = i
    const candidate = entries[i]?.event ?? entries[i]
    if (candidate.type === 'tool/call') cache.calls.set(`${candidate.data?.turn}:${candidate.data?.callId}`, candidate)
    if (candidate.type === 'turn/start') { cache.turns.set(candidate.data?.turn, i); break }
    if (cache.calls.has(key)) break
  }
  const ranges = [...cache.ranges, [start, end]].sort((a,b) => a[0]-b[0]); cache.ranges = []
  for (const range of ranges) {
    const last = cache.ranges.at(-1)
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]); else cache.ranges.push(range)
  }
  return cache.calls.get(key) ?? null
}

function resolveStepEnd(entries, index, cache) {
  if (cache.ends.has(index)) return cache.ends.get(index)
  for (let i = index + 1; i < entries.length; i++) {
    const next = entries[i]?.event ?? entries[i]
    if (next.type === 'step/start') { cache.ends.set(index, null); return null }
    if (next.type === 'turn/end') { cache.ends.set(index, next); return next }
  }
  return null
}
function stableHistoryEnd(entries, cache) {
  if (cache.length === undefined) {
    cache.marker = null
    const tail = entries.at(-1)?.event ?? entries.at(-1)
    // Surface/tool records are written inside an open native step. Bootstrap
    // logs may contain only messages, and need no lifecycle scan at all.
    if (!['user/message','assistant/message','assistant/chunk','tool/call','tool/result'].includes(tail?.type)) {
      for (let i = entries.length - 1; i >= 0; i--) {
        const event = entries[i]?.event ?? entries[i]
        if (['step/start','step/end','turn/end'].includes(event.type)) { cache.marker = { type: event.type, index: i }; break }
      }
    }
    cache.length = entries.length
  } else {
    for (let i = cache.length; i < entries.length; i++) {
      const event = entries[i]?.event ?? entries[i]
      if (['step/start','step/end','turn/end'].includes(event.type)) cache.marker = { type: event.type, index: i }
    }
    cache.length = entries.length
  }
  return cache.marker?.type === 'step/end' ? cache.marker.index : entries.length
}

/**
 * Build the adapter around the supported client and native immutable-log seam.
 * Ownership is gateway-local and is intentionally not inferred from a stream
 * disconnect; a resume explicitly re-establishes it after list + history.
 */
export function createDshSessionAdapter(client, { readLog } = {}) {
  if (!client?.sessions || !client?.events) throw new TypeError('supported DSH client is required')
  const owned = new Map()
  // Lazy call metadata index. Each visited source range is indexed once, including
  // parallel calls whose completion is far away from its start. No full-log fold.
  const callIndexes = new Map()
  function callIndex(sessionId, entries) {
    let cache = callIndexes.get(sessionId)
    const first = entries[0]?.event ?? entries[0]
    if (!cache || cache.first !== first) { cache = { first, calls: new Map(), turns: new Map(), ranges: [], ends: new Map() }; callIndexes.set(sessionId, cache) }
    return cache
  }

  // Compatibility for compositions that only expose the old backwards RPC:
  // materialize once, then append just the changed suffix on subsequent reads.
  const logs = new Map()
  async function logFor(sessionId) {
    if (readLog) return readLog(sessionId)
    const previous = logs.get(sessionId)
    const collected = []; let beforeSeq
    while (true) {
      const page = await unwrap(await client.sessions.history({ sessionId, maxMessages: 200,
        ...(beforeSeq === undefined ? {} : { beforeSeq }) }), 'history')
      if (!Array.isArray(page?.events) || typeof page.hasMore !== 'boolean') throw new DshAdapterError('internal', 'history')
      const rows = page.events.filter(row => Number.isSafeInteger((row.event ?? row).seq) &&
        (beforeSeq === undefined || (row.event ?? row).seq < beforeSeq))
      if (!rows.length && page.hasMore) throw new DshAdapterError('internal', 'history')
      collected.push(...rows)
      const oldest = rows.length ? Math.min(...rows.map(row => (row.event ?? row).seq)) : null
      if (!page.hasMore || previous && oldest !== null && oldest <= (previous.at(-1)?.event ?? previous.at(-1))?.seq) break
      beforeSeq = oldest
    }
    const merged = new Map((previous ?? []).map(row => [(row.event ?? row).seq, row]))
    for (const row of collected) merged.set((row.event ?? row).seq, row)
    const ordered = [...merged.values()].sort((a, b) => (a.event ?? a).seq - (b.event ?? b).seq)
    logs.set(sessionId, ordered); return ordered
  }

  // Source checks do not need the compatibility reader's materialized log.
  // The legacy RPC has only beforeSeq; stop once the binding's boundary is in
  // hand, including a cold question reconnect at its original watermark.
  async function sourceLogFor(sessionId, options) {
    if (readLog) return readLog(sessionId)
    let beforeSeq = options.observedSeq === undefined ? undefined : options.observedSeq + 1
    const suffix = []
    while (true) {
      const page = await unwrap(await client.sessions.history({ sessionId, maxMessages: 200,
        ...(beforeSeq === undefined ? {} : { beforeSeq }) }), 'history')
      if (!Array.isArray(page?.events) || typeof page.hasMore !== 'boolean') throw new DshAdapterError('internal', 'source')
      const rows = page.events.filter(entry => beforeSeq === undefined || (entry.event ?? entry).seq < beforeSeq)
        .sort((a, b) => (a.event ?? a).seq - (b.event ?? b).seq)
      if (!rows.length && page.hasMore) throw new DshAdapterError('internal', 'source')
      suffix.unshift(...rows)
      const range = sourceRange(suffix, options)
      if (range && (options.turn !== undefined || !options.receiptId || range.events.some(entry =>
          (entry.event ?? entry).data?.source?.rpcId === options.receiptId)) || !page.hasMore) return suffix
      beforeSeq = (rows[0]?.event ?? rows[0])?.seq
    }
  }


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

    async historyPage(sessionId, options = {}) {
      const { afterSeq, beforeSeq, limit = 50 } = options
      if (typeof sessionId !== 'string' || !sessionId) throw new TypeError('sessionId is required')
      if (afterSeq !== undefined && beforeSeq !== undefined ||
          afterSeq !== undefined && (!Number.isSafeInteger(afterSeq) || afterSeq < -1) ||
          beforeSeq !== undefined && (!Number.isSafeInteger(beforeSeq) || beforeSeq < 0)) throw new TypeError('invalid history cursor')
      pageHistoryEvents([], afterSeq ?? -1, limit)
      const listed = await unwrap(await client.sessions.list({}), 'list')
      requireOrdinarySummary((listed?.items ?? []).find(item => sessionIdOf(item) === sessionId), sessionId)
      const entries = await logFor(sessionId)
      const latestSeq = (entries.at(-1)?.event ?? entries.at(-1))?.seq ?? -1
      const cache = callIndex(sessionId, entries), stableEnd = stableHistoryEnd(entries, cache)
      const stableSeq = (entries[stableEnd - 1]?.event ?? entries[stableEnd - 1])?.seq ?? -1
      const forward = afterSeq !== undefined
      let index = forward ? lowerBound(entries, afterSeq + 1)
        : beforeSeq === undefined ? stableEnd - 1 : Math.min(stableEnd, lowerBound(entries, beforeSeq)) - 1
      let scanned = forward ? afterSeq : beforeSeq ?? stableSeq + 1
      const events = []; let bytes = 0, hasMore = false
      for (; index >= 0 && index < stableEnd; index += forward ? 1 : -1) {
        const raw = entries[index]?.event ?? entries[index]
        let contextTurn = null
        if (typeof raw.type === 'string' && raw.type.startsWith('approval/')) for (let i = index; i >= 0; i--) {
          const previous = entries[i]?.event ?? entries[i]
          if (Number.isSafeInteger(previous.data?.turn)) { contextTurn = previous.data.turn; break }
        }
        const event = projectHistoryEvent(entries[index], raw.type === 'tool/result' ? relatedCall(entries, index, cache) : null, contextTurn, raw.type === 'step/end' ? resolveStepEnd(entries, index, cache) : null, ['agent/inbox/spliced', 'step/start', 'step/end'].includes(raw.type) ? indexInboxTimeline(entries, cache, index) : null)
        const size = event ? Buffer.byteLength(JSON.stringify(event), 'utf8') : 0
        if (event && (events.length === limit || bytes + size > HISTORY_RESPONSE_BYTES_LIMIT)) { hasMore = true; break }
        scanned = raw.seq
        if (event) { events.push(event); bytes += size }
      }
      if (!forward) events.reverse()
      return { events, nextSeq: forward ? scanned : stableSeq, hasMore: forward && hasMore,
        nextBeforeSeq: forward ? events[0]?.seq ?? null : scanned <= latestSeq ? scanned : null,
        hasOlder: !forward && hasMore, latestSeq }
    },

    async historyDetail(sessionId, seq) {
      if (!Number.isSafeInteger(seq) || seq < 0) throw new TypeError('invalid detail seq')
      const listed = await unwrap(await client.sessions.list({}), 'list')
      requireOrdinarySummary((listed?.items ?? []).find(item => sessionIdOf(item) === sessionId), sessionId)
      const entries = await logFor(sessionId), index = lowerBound(entries, seq)
      const event = entries[index]?.event ?? entries[index]
      if (event?.seq !== seq || !['tool/call', 'tool/result', 'approval/asked', 'approval/decided'].includes(event.type))
        throw new DshAdapterError('session-not-found', 'history.detail')
      const call = event.type === 'tool/call' ? event : relatedCall(entries, index, callIndex(sessionId, entries))
      const visibleParts = parts => Array.isArray(parts) ? parts.filter(part => !['reasoning', 'reasoning-delta'].includes(part?.type))
        .map(part => Array.isArray(part.content) ? { ...part, content: visibleParts(part.content) } : part) : parts
      const output = event.type === 'tool/result' ? visibleParts(event.data?.message?.content) : undefined
      const raw = JSON.stringify({ arguments: call?.data?.arguments, output, approval: event.type.startsWith('approval/') ? event.data : undefined }, null, 2)
      const text = raw.slice(0, 64_000)
      return { seq, text, ...(raw.length > text.length ? { truncated: true } : {}) }
    },

    /** Internal source evidence cut at the original subscribed/question watermark. */
    async questionHistoryAsOf(sessionId, observedSeq) {
      if (typeof sessionId !== 'string' || !sessionId || !Number.isSafeInteger(observedSeq) || observedSeq < 0) {
        throw new TypeError('invalid question source watermark')
      }
      return sourceRange(await sourceLogFor(sessionId, { observedSeq }), { observedSeq })?.events ?? []
    },

    /** Internal binding evidence, excluding all tool/step/output payloads. */
    async sourceEvents(sessionId, { turn, receiptId } = {}) {
      const listed = await unwrap(await client.sessions.list({}), 'list')
      requireOrdinarySummary((listed?.items ?? []).find(item => sessionIdOf(item) === sessionId), sessionId)
      const range = sourceRange(await sourceLogFor(sessionId, { turn, receiptId }), { turn, receiptId })
      return { current: range?.current === true, events: (range?.events ?? [])
        .filter(entry => ['turn/start', 'user/message', 'turn/end'].includes((entry.event ?? entry).type))
        .map(entry => projectHistoryEvent(entry)).filter(Boolean) }
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
      let steeredReceiptId
      if (mode === 'steer' && receiptId && readLog) {
        const entries = await readLog(sessionId)
        const insertion = entries.findLastIndex(entry => {
          const event = entry.event ?? entry
          return event.type === 'agent/inbox/spliced' && event.data?.target === 'next-step' &&
            event.data.inserted?.some(message => message.source?.rpcId === receiptId)
        })
        if (insertion >= 0) steeredReceiptId = turnReceiptAt(entries, insertion) ?? undefined
      }
      return { accepted: value?.accepted === true, command: value?.command, ...(receiptId ? { receiptId } : {}),
        ...(steeredReceiptId ? { steeredReceiptId } : {}) }
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
