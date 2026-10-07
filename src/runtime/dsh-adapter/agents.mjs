/** P1-03 deterministic, redacted DSH event normalization. */

import { createHash } from 'node:crypto'
import { payloadDigest } from './sessions.mjs'

const QUESTION_BATCH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const USER_RECEIPT_ID = /^[A-Za-z0-9._:-]{1,160}$/

function emptyQuestionSource() {
  return { lastSeq: -1, turn: null, users: 0, source: null, complete: false, boundaryKnown: false,
    seeded: false, baselineSeq: -1, postBaseline: [], contextRead: null }
}

/** Fold only ordered durable events; no tool-call guess can supply a question's owner. */
export function advanceQuestionSource(state, event) {
  if (!Number.isSafeInteger(event?.seq) || event.seq < 0 || event.seq <= state.lastSeq) return state
  const next = { ...state, lastSeq: event.seq }
  if (event.seq !== state.lastSeq + 1) next.complete = false
  if (event.type === 'turn/start') {
    next.turn = Number.isSafeInteger(event.data?.turn) && event.data.turn > 0 ? event.data.turn : null
    next.users = 0; next.source = null; next.complete = next.turn !== null; next.boundaryKnown = true
    next.seeded = true; next.postBaseline = []
  } else if (event.type === 'turn/end') {
    next.turn = null; next.users = 0; next.source = null; next.complete = false; next.boundaryKnown = true
  } else if (event.type === 'user/message' && event.data?.source?.kind === 'user') {
    next.users++
    const parts = event.data?.content, receiptId = event.data?.source?.rpcId
    if (next.turn === null || next.users !== 1 || !USER_RECEIPT_ID.test(receiptId ?? '') ||
        !Array.isArray(parts) || parts.some(part => part?.type === 'text' && typeof part.text !== 'string')) {
      next.source = null; return next
    }
    const text = parts.filter(part => part?.type === 'text').map(part => part.text).join('')
    if (!text.trim() || text.length > 32_000) { next.source = null; return next }
    next.source = { turn: next.turn, sourceReceiptId: receiptId, sourceSeq: event.seq,
      messageHash: createHash('sha256').update(text, 'utf8').digest('hex') }
  }
  return next
}

/** A backwards history window is cut at the mux watermark, never at the later read time. */
export function questionSourceAsOf(entries, observedSeq) {
  if (!Number.isSafeInteger(observedSeq) || observedSeq < 0 || !Array.isArray(entries)) return null
  const bySeq = new Map()
  for (const entry of entries) {
    const event = entry?.event ?? entry
    if (!Number.isSafeInteger(event?.seq) || event.seq < 0 || event.seq > observedSeq) continue
    const prior = bySeq.get(event.seq)
    if (prior && JSON.stringify(prior) !== JSON.stringify(event)) return null
    bySeq.set(event.seq, event)
  }
  let source = emptyQuestionSource()
  for (const event of [...bySeq.values()].sort((a, b) => a.seq - b.seq)) source = advanceQuestionSource(source, event)
  return source.complete && source.turn !== null && source.users === 1 && source.source
    ? { ...source.source, observedSeq } : null
}

/** Temporary native mux snapshots only; this is neither a provider nor a durable question registry. */
export function createNativeQuestionSnapshots({ readSourceAsOf } = {}) {
  if (typeof readSourceAsOf !== 'function') throw new TypeError('bounded native source reader is required')
  const lanes = new Map(), batches = new Map(), closed = new Set()
  const sourceReads = new Map()
  let connection = 0
  const key = (sessionId, questionRpcId) => sessionId + '\0' + questionRpcId
  const lane = sessionId => {
    let state = lanes.get(sessionId)
    if (!state) { state = emptyQuestionSource(); lanes.set(sessionId, state) }
    return state
  }
  const sourceCurrent = row => {
    const current = lanes.get(row.sessionId)
    return row.nativeState !== 'pending' || current?.seeded && current.complete && current.boundaryKnown && current.turn === row.source?.turn &&
      current.users === 1 && current.source?.sourceReceiptId === row.source?.sourceReceiptId &&
      current.source?.messageHash === row.source?.messageHash
  }
  const snapshot = row => ({ sessionId: row.sessionId, questionRpcId: row.questionRpcId,
    sourceReady: row.source !== null && sourceCurrent(row), ...(row.source ?? {}),
    questions: structuredClone(row.questions), nativeState: row.nativeState })
  const readSource = (sessionId, observedSeq) => {
    const readKey = connection + '\0' + sessionId + '\0' + observedSeq
    let read = sourceReads.get(readKey)
    if (!read) {
      read = Promise.resolve().then(() => readSourceAsOf(sessionId, observedSeq))
      sourceReads.set(readKey, read)
      void read.finally(() => { if (sourceReads.get(readKey) === read) sourceReads.delete(readKey) }).catch(() => {})
    }
    return read
  }
  const seedLane = sessionId => {
    const current = lane(sessionId)
    if (current.seeded || current.contextRead || current.lastSeq < 0) return current.contextRead
    const observedSeq = current.lastSeq, capturedConnection = connection
    const work = readSource(sessionId, observedSeq).then(proof => {
      const latest = lanes.get(sessionId)
      if (!proof || proof.observedSeq !== observedSeq || capturedConnection !== connection || !latest || latest.seeded) return
      let seeded = { ...emptyQuestionSource(), lastSeq: observedSeq, turn: proof.turn, users: 1, source: proof,
        complete: true, boundaryKnown: true, seeded: true, baselineSeq: latest.baselineSeq }
      for (const event of latest.postBaseline.filter(event => event.seq > observedSeq)) seeded = advanceQuestionSource(seeded, event)
      lanes.set(sessionId, seeded)
    }).catch(() => {}).finally(() => {
      const latest = lanes.get(sessionId)
      if (latest?.contextRead === work) latest.contextRead = null
    })
    current.contextRead = work
    return work
  }
  const seedSource = row => {
    if (row.ready || row.source || row.conflicted || row.observedSeq < 0) return
    row.ready = readSource(row.sessionId, row.observedSeq).then(proof => {
      if (!row.conflicted && proof && proof.observedSeq === row.observedSeq) row.source = Object.freeze({ ...proof })
    }).catch(() => { row.source = null }).finally(() => { row.ready = null })
  }
  return {
    beginConnection() { connection++; lanes.clear(); return connection },
    observe(raw, observedConnection = connection) {
      if (observedConnection !== connection) return
      const payload = raw?.payload
      if (!payload || typeof payload.sessionId !== 'string') return
      if (payload.type === 'session/subscribed') {
        if (!Number.isSafeInteger(payload.lastSeq) || payload.lastSeq < -1) return
        lanes.set(payload.sessionId, { ...emptyQuestionSource(), lastSeq: payload.lastSeq, baselineSeq: payload.lastSeq })
        return
      }
      if (payload.type === 'session/event') {
        const current = lane(payload.sessionId)
        const updated = advanceQuestionSource(current, payload.event)
        if (!updated.seeded && Number.isSafeInteger(payload.event?.seq) && payload.event.seq > current.lastSeq) {
          updated.postBaseline = [...current.postBaseline, payload.event]
        }
        lanes.set(payload.sessionId, updated)
        return
      }
      if (payload.type === 'question/resolved') {
        if (!QUESTION_BATCH_ID.test(payload.questionRpcId ?? '') || !['answered', 'cancelled'].includes(payload.outcome)) return
        const batchKey = key(payload.sessionId, payload.questionRpcId)
        closed.add(batchKey)
        const row = batches.get(batchKey)
        if (row) row.nativeState = payload.outcome
        return
      }
      if (payload.type !== 'question/requested' || !QUESTION_BATCH_ID.test(raw.rpcId ?? '') ||
          !Array.isArray(payload.questions) || payload.questions.length === 0) return
      const batchKey = key(payload.sessionId, raw.rpcId)
      if (closed.has(batchKey)) return
      const prior = batches.get(batchKey)
      if (prior) {
        if (JSON.stringify(prior.questions) !== JSON.stringify(payload.questions)) { prior.source = null; prior.conflicted = true }
        prior.seenConnection = connection
        void seedLane(payload.sessionId)
        return
      }
      const current = lane(payload.sessionId), observedSeq = current.lastSeq
      const source = current.complete && current.turn !== null && current.users === 1 && current.source
        ? { ...current.source, observedSeq } : null
      const row = { sessionId: payload.sessionId, questionRpcId: raw.rpcId, questions: structuredClone(payload.questions),
        source, observedSeq, nativeState: 'pending', seenConnection: connection, conflicted: false, ready: null }
      batches.set(batchKey, row)
      void seedLane(payload.sessionId)
      if (!source && observedSeq >= 0) {
        // Do not block mux ingestion: a native terminal frame must seal this id while history is awaited.
        seedSource(row)
      }
    },
    async list(sessionId) {
      const selected = [...batches.values()].filter(row => row.sessionId === sessionId)
      for (const row of selected) if (row.nativeState === 'pending' && row.seenConnection === connection) seedSource(row)
      await Promise.all([...selected.map(row => row.ready), seedLane(sessionId)])
      return selected.filter(row => row.nativeState !== 'pending' || row.seenConnection === connection).map(snapshot)
    },
    pending(sessionId, questionRpcId) {
      const row = batches.get(key(sessionId, questionRpcId))
      return row && row.source && sourceCurrent(row) && !row.conflicted && row.nativeState === 'pending' &&
        row.seenConnection === connection && !closed.has(key(sessionId, questionRpcId)) ? snapshot(row) : null
    },
    connectionLost(observedConnection) {
      if (observedConnection !== connection) return
      connection++; lanes.clear()
    },
    close() { connection++; lanes.clear(); batches.clear(); closed.clear(); sourceReads.clear() },
  }
}

export function createEventState() {
  return {
    seen: new Set(),
    stoppedTurns: new Set(),
    toolNames: new Map(),
    lastSeqBySession: new Map(),
  }
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function textFromMessage(value) {
  const message = object(value?.message ?? value)
  const content = Array.isArray(message.content) ? message.content : []
  return content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
}

function eventFromFrame(raw) {
  const payload = raw?.payload ?? raw
  if (payload?.type === 'session/event') return { sessionId: payload.sessionId, event: payload.event, rpcId: raw?.rpcId ?? null, payload }
  // sessions.history returns HistoryEntry `{ event, view? }`, not a mux frame.
  if (payload?.event?.type && typeof payload.event.type === 'string') {
  return { sessionId: payload.sessionId ?? null, event: payload.event, rpcId: raw?.rpcId ?? null, payload }
  }
  return { sessionId: payload?.sessionId, event: payload, rpcId: raw?.rpcId ?? null, payload }
}

function turnOf(event) {
  return Number.isInteger(event?.data?.turn) ? event.data.turn : null
}

function base(type, sessionId, event, data) {
  const result = { type, sessionId, data, rawType: event.type }
  if (Number.isInteger(event.seq)) result.rawSeq = event.seq
  if (typeof event.time === 'number' || typeof event.time === 'string') result.rawTime = event.time
  const turn = turnOf(event)
  if (turn !== null) result.turn = turn
  return result
}

function safeError(event, sessionId, code = 'dsh-event-error', message = 'DSH reported an error') {
  return payloadDigest(event?.data ?? event).then((digest) => base('error', sessionId, event, {
    code,
    message,
    details: { digest },
  }))
}

function unknown(event, sessionId) {
  const data = event?.data
  const metadata = {
    dataKind: Array.isArray(data) ? 'array' : data === null ? 'null' : typeof data,
    fieldCount: data !== null && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data).length : 0,
  }
  return payloadDigest(event).then((digest) => base('dsh.unknown', sessionId, event, { metadata, digest }))
}

/**
 * Convert a raw `session/event` or host frame into one product-safe event.
 * Unknown bodies are never returned, logged, or embedded; only a SHA-256
 * digest and non-content metadata escape this boundary.
 */
export async function normalizeDshEvent(raw, state = createEventState()) {
  const { sessionId, event, rpcId, payload } = eventFromFrame(raw)
  if (payload?.type === 'approval/requested') {
    return base('tool.approval-requested', payload.sessionId ?? null, payload, {
      rpcId: typeof rpcId === 'string' ? rpcId : null,
      approvalId: typeof payload.approvalId === 'string' ? payload.approvalId : null,
      tool: typeof payload.toolName === 'string' ? payload.toolName : 'unknown',
      reason: typeof payload.reason === 'string' ? payload.reason.slice(0, 500) : null,
    })
  }
  if (payload?.type === 'approval/resolved') {
    return base('tool.approval-resolved', payload.sessionId ?? null, payload, {
      approvalId: typeof payload.approvalId === 'string' ? payload.approvalId : null,
      outcome: typeof payload.outcome === 'string' ? payload.outcome : 'unknown',
    })
  }
  if (!event || typeof event.type !== 'string') return unknown({ type: 'invalid', data: raw }, sessionId ?? null)

  if (event.type === 'stream/error' || event.type === 'host/agent-error' || event.type === 'error') {
    return safeError(event, sessionId ?? null)
  }
  if (event.type === 'host/session-status' || event.type === 'agent/status') {
    const running = event.type === 'host/session-status' ? event.running === true : event.data?.status === 'running'
    return base('agent.status', sessionId, event, { status: running ? 'running' : 'idle' })
  }

  const turn = turnOf(event)
  if (event.type === 'turn/end') {
    // Exactly one terminal fact per turn: aborted -> turn.stopped(cancelled),
    // error/max-tokens -> non-success error; preserve the legacy completed/blocked mapping.
    const key = `${sessionId}:${turn ?? 'unknown'}`
    if (state.stoppedTurns.has(key)) return null
    state.stoppedTurns.add(key)
    if (event.data?.reason?.kind === 'aborted') {
      return base('turn.stopped', sessionId, event, { reason: 'cancelled' })
    }
    if (event.data?.reason?.kind === 'error') {
      return safeError(event, sessionId, 'dsh-turn-error', 'DSH turn failed')
    }
    if (event.data?.reason?.kind === 'max-tokens') {
      const limited = await safeError(event, sessionId, 'dsh-turn-max-tokens',
        'DSH turn ended at its output-token limit')
      return { ...limited, data: { ...limited.data,
        details: { ...limited.data.details, endReasonKind: 'max-tokens' } } }
    }
    if (!['completed', 'blocked'].includes(event.data?.reason?.kind)) {
      return unknown(event, sessionId)
    }
    return base('turn.stopped', sessionId, event, { reason: 'completed' })
  }

  if (event.type === 'user/message') {
    // DSH persists several injected context messages as `user/message`.
    // Their source is explicit; only an actual user's message belongs in the
    // WeftMate transcript.  This keeps runtime policy, workspace paths and
    // system-prompt snapshots behind the adapter boundary.
    if (event.data?.source?.kind !== 'user') return null
    return base('user.message', sessionId, event, { text: textFromMessage(event.data) })
  }

  if (event.type === 'assistant/chunk') {
    const chunk = event.data?.chunk
    // reasoning-delta and every other chunk shape are intentionally dropped.
    if (chunk?.type !== 'text-delta' || typeof chunk.text !== 'string') return null
    if (state.stoppedTurns.has(`${sessionId}:${turn ?? 'unknown'}`)) return null
    return base('assistant.delta', sessionId, event, { text: chunk.text })
  }

  if (event.type === 'assistant/message') {
    if (state.stoppedTurns.has(`${sessionId}:${turn ?? 'unknown'}`)) return null
    return base('assistant.completed', sessionId, event, { text: textFromMessage(event.data) })
  }

  if (event.type === 'tool/call') {
    const callId = typeof event.data?.callId === 'string' ? event.data.callId : null
    const tool = typeof event.data?.name === 'string' ? event.data.name : 'unknown'
    if (callId !== null) state.toolNames.set(`${sessionId}:${callId}`, tool)
    return base('tool.started', sessionId, event, { callId, tool })
  }

  if (event.type === 'tool/result') {
    const message = object(event.data?.message)
    const resultBlock = Array.isArray(message.content)
      ? message.content.find((part) => typeof part?.toolCallId === 'string')
      : undefined
    const callId = typeof message.source?.callId === 'string' ? message.source.callId
      : typeof resultBlock?.toolCallId === 'string' ? resultBlock.toolCallId : null
    const tool = callId === null ? 'unknown' : (state.toolNames.get(`${sessionId}:${callId}`) ?? 'unknown')
    const failed = event.data?.error !== undefined || resultBlock?.isError === true
    return base(failed ? 'tool.failed' : 'tool.completed', sessionId, event, { callId, tool })
  }

  // Control frames are deliberately treated as unknown/redacted until a later
  // adapter packet explicitly owns their public projection.
  return unknown(event, sessionId ?? null)
}

function rawSequence(raw) {
  const { event } = eventFromFrame(raw)
  return Number.isInteger(event?.seq) ? event.seq : Number.MAX_SAFE_INTEGER
}

/**
 * History and reopened mux frames converge by raw seq.  `lastSeq` is a local
 * cursor only; callers must not pass it to DSH `events.mux`, because this pin
 * ignores `since`.
 */
export async function reconcileDshEvents(rawEvents, { lastSeq = -1, sessionId = null, state = createEventState() } = {}) {
  const ordered = [...rawEvents].map((raw, index) => ({ raw, index })).sort((a, b) => {
    const delta = rawSequence(a.raw) - rawSequence(b.raw)
    return delta === 0 ? a.index - b.index : delta
  })
  const events = []
  let maxCursor = lastSeq
  for (const { raw } of ordered) {
    const { event, sessionId: eventSessionId } = eventFromFrame(raw)
    const scope = eventSessionId ?? sessionId ?? 'unknown'
    const seq = Number.isInteger(event?.seq) ? event.seq : null
    const cursor = state.lastSeqBySession.has(scope)
      ? state.lastSeqBySession.get(scope)
      : scope === sessionId ? lastSeq : -1
    const key = seq === null ? `${scope}:${event?.type ?? 'invalid'}:${await payloadDigest(event ?? raw)}` : `${scope}:seq:${seq}`
    if (state.seen.has(key) || (seq !== null && seq <= cursor)) continue
    state.seen.add(key)
    const normalized = await normalizeDshEvent(raw, state)
    if (seq !== null) {
      const next = Math.max(cursor, seq)
      state.lastSeqBySession.set(scope, next)
      maxCursor = Math.max(maxCursor, next)
    }
    if (normalized !== null) events.push(normalized)
  }
  return { events, lastSeq: sessionId === null ? maxCursor : (state.lastSeqBySession.get(sessionId) ?? lastSeq), state }
}

/** Convenience facade for a Gateway composition layer; it owns no routes. */
export function createDshAgentAdapter(sessionAdapter) {
  return {
    openMux: (signal) => sessionAdapter.openMux(signal),
    openHost: (signal) => sessionAdapter.openHost(signal),
    reconcile: (rawEvents, options) => reconcileDshEvents(rawEvents, options),
  }
}
