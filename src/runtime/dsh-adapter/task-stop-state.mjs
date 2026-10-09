import { sourceRange } from './source-range.mjs'
import { claimedInputsAt } from './inbox-timeline.mjs'

const raw = entry => entry?.event ?? entry

/** Read native persistence and the current Agent registry; never resume or cancel. */
export async function readNativeTaskStopState(ctx, runtimeStartedAt, { sessionId, receiptId, turn, stopRequestedAt }) {
  const unknown = () => ({ status: 'unconfirmed' })
  const restarted = Date.parse(stopRequestedAt) < runtimeStartedAt
  let artifact
  try {
    const live = ctx.sessions.get(sessionId)
    // inspect() may supply in-memory recovery closers for a cold log. Read the
    // physical native prefix so recovery is never misreported as cancellation.
    artifact = live ? { meta: live.header, events: live.events }
      : await ctx.get('sessionPersistence').readFrom(sessionId, 0)
  } catch (error) {
    // An unavailable/corrupt store is not absence. Only DSH's explicit absence
    // plus a newer runtime can establish that this old turn cannot be running.
    if (!restarted) return unknown()
    let headers
    try { headers = await ctx.get('sessionPersistence').list() } catch { return unknown() }
    if (!Array.isArray(headers) || headers.some(header => header.id === sessionId) ||
        ctx.sessions.get(sessionId) || ctx.agents.get(sessionId)) return unknown()
    return { status: 'not_running', observedAt: new Date().toISOString() }
  }
  if (artifact?.meta?.id !== sessionId || artifact.meta.agentPreset !== 'personal-remote' ||
      !Array.isArray(artifact.events)) return unknown()
  // Inspect after the asynchronous read. An agent created during inspection
  // must not be mistaken for a historical orphan.
  const agent = ctx.agents.get(sessionId)
  if (agent && (agent.session?.id !== sessionId || agent.session.header?.agentPreset !== 'personal-remote')) return unknown()
  const events = agent?.session?.events ?? artifact.events
  const range = sourceRange(events, { receiptId, turn })
  const bound = range?.events.some(entry => raw(entry).type === 'user/message' &&
    raw(entry).data?.source?.kind === 'user' && raw(entry).data.source.rpcId === receiptId)
    || range?.events.some((entry, index) => raw(entry).type === 'agent/inbox/spliced' &&
      claimedInputsAt(events, range.start + index).some(input => input.receiptId === receiptId))
  const ended = bound && range.events.find(entry => raw(entry).type === 'turn/end' &&
    raw(entry).data?.turn === raw(range.events[0]).data?.turn)
  if (ended) {
    const event = raw(ended)
    return { status: event.data?.reason?.kind === 'aborted' ? 'cancelled' : 'ended',
      observedAt: Number.isFinite(event.time) ? new Date(event.time).toISOString() : new Date().toISOString() }
  }
  if (agent) {
    if (agent.status !== 'idle' || agent.inbox?.hasPending !== false) return unknown()
    return { status: 'not_running', observedAt: new Date().toISOString() }
  }
  if (!restarted) return unknown()
  // A persisted inbox can be restored later. Do not discard an old queued
  // input simply because its agent has not been activated in this runtime.
  const pending = { 'next-turn': [], 'next-step': [] }
  for (const entry of events) {
    const event = raw(entry), data = event.data
    if (event.type !== 'agent/inbox/spliced' || !pending[data?.target]) continue
    if (!Number.isSafeInteger(data.start) || !Number.isSafeInteger(data.removedCount) ||
        data.inserted !== undefined && !Array.isArray(data.inserted)) return unknown()
    pending[data.target].splice(data.start, data.removedCount, ...(data.inserted ?? []))
  }
  if (Object.values(pending).flat().some(message => message.source?.rpcId === receiptId)) return unknown()
  return { status: 'not_running', observedAt: new Date().toISOString() }
}
