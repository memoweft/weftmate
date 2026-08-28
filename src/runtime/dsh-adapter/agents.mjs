/** P1-03 deterministic, redacted DSH event normalization. */

import { payloadDigest } from './sessions.mjs'

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
  if (payload?.type === 'session/event') return { sessionId: payload.sessionId, event: payload.event }
  // sessions.history returns HistoryEntry `{ event, view? }`, not a mux frame.
  if (payload?.event?.type && typeof payload.event.type === 'string') {
    return { sessionId: payload.sessionId ?? null, event: payload.event }
  }
  return { sessionId: payload?.sessionId, event: payload }
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
  const { sessionId, event } = eventFromFrame(raw)
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
    // error -> redacted error, otherwise -> turn.stopped(completed).
    const key = `${sessionId}:${turn ?? 'unknown'}`
    if (state.stoppedTurns.has(key)) return null
    state.stoppedTurns.add(key)
    if (event.data?.reason?.kind === 'aborted') {
      return base('turn.stopped', sessionId, event, { reason: 'cancelled' })
    }
    if (event.data?.reason?.kind === 'error') {
      return safeError(event, sessionId, 'dsh-turn-error', 'DSH turn failed')
    }
    return base('turn.stopped', sessionId, event, { reason: 'completed' })
  }

  if (event.type === 'user/message') {
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
