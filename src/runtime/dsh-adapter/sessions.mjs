/**
 * P1-03 DSH session adapter.
 *
 * This module deliberately receives the already-composed in-process client
 * (`new InProcessApiClient(toFetchHandler(ctx.apiProxy))`).  It does not boot a
 * second DSH runtime and it does not create a fictitious `session.resume` RPC.
 */

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
])

export class DshAdapterError extends Error {
  constructor(code, operation, digest = null) {
    super(`DSH ${operation} failed`)
    this.name = 'DshAdapterError'
    this.code = SAFE_ERROR_CODES.has(code) ? code : 'dsh-rejected'
    this.operation = operation
    this.details = digest === null ? {} : { digest }
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
    throw new DshAdapterError(result.error?.code, operation, await payloadDigest(result.error ?? null))
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

    async send(sessionId, content, mode = 'queue') {
      assertOwned(sessionId, 'send')
      if (mode !== 'queue' && mode !== 'steer') throw new TypeError('mode must be queue or steer')
      const value = await unwrap(await client.sessions.prompt({ sessionId, mode, content }), 'prompt')
      return { accepted: value?.accepted === true, command: value?.command }
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
