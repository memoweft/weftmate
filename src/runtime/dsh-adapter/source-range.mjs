import { claimedInputsAt } from './inbox-timeline.mjs'

const raw = entry => entry?.event ?? entry
const bindings = new WeakMap()

export function seqOffset(entries, seq) {
  let lo = 0, hi = entries.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (raw(entries[mid]).seq < seq) lo = mid + 1
    else hi = mid
  }
  return lo
}

// Native turn-bearing records are ordered by turn. Messages and approval
// carriers may omit it; their nearest preceding turn-bearing record supplies
// only a search position. The actual turn/start remains the required proof.
function turnOffset(entries, turn) {
  let lo = 0, hi = entries.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    let index = mid, value
    while (index >= lo) {
      value = raw(entries[index]).data?.turn
      if (Number.isSafeInteger(value)) break
      index--
    }
    if (index < lo || value < turn) lo = mid + 1
    else hi = index
  }
  return lo
}

/** A source range ends at the next native turn, or the original mux watermark. */
export function sourceRange(entries, { turn, observedSeq, receiptId } = {}) {
  if (turn === undefined && observedSeq === undefined && receiptId) turn = bindings.get(entries)?.get(receiptId)
  const end = observedSeq === undefined ? entries.length : seqOffset(entries, observedSeq + 1)
  let start, stop = end
  if (turn !== undefined) {
    start = turnOffset(entries, turn)
    if (start >= end || raw(entries[start]).type !== 'turn/start' || raw(entries[start]).data?.turn !== turn) return null
    stop = Math.min(end, turnOffset(entries, turn + 1))
  } else {
    // A question has an exact watermark. Older receipt-only callers discover
    // their binding backwards by turn, never by replaying projected history.
    start = stop
    while (start > 0) {
      start--
      if (raw(entries[start]).type !== 'turn/start') continue
      if (!receiptId || entries.slice(start, stop).some((entry, offset) =>
          raw(entry).type === 'user/message' && raw(entry).data?.source?.rpcId === receiptId ||
          raw(entry).type === 'agent/inbox/spliced' &&
            claimedInputsAt(entries, start + offset).some(input => input.receiptId === receiptId))) break
      stop = start
    }
    if (start === stop || raw(entries[start])?.type !== 'turn/start') return null
  }
  const events = entries.slice(start, stop)
  if (receiptId) {
    let index = bindings.get(entries)
    if (!index) { index = new Map(); bindings.set(entries, index) }
    for (let offset = 0; offset < events.length; offset++) {
      const entry = raw(events[offset])
      if (entry.type === 'user/message' && entry.data?.source?.kind === 'user') {
        index.set(entry.data.source.rpcId, raw(entries[start]).data?.turn)
      }
      for (const input of entry.type === 'agent/inbox/spliced' ? claimedInputsAt(entries, start + offset) : []) if (input.receiptId) {
        index.set(input.receiptId, raw(entries[start]).data?.turn)
      }
    }
  }
  return { start, end: stop, current: stop === entries.length, events }
}

/** Use DSH's prepared cache for location, then its durable suffix primitive.
 * readFrom has no upper cursor; only the requested turn is returned/refolded.
 * JSONL may still parse the physical file; that backend work is owned by DSH.
 */
export async function durableSourceRange(persistence, sessionId, options, signal) {
  const inspected = await persistence.inspect(sessionId, signal)
  const range = sourceRange(inspected.events, options)
  if (!range) return { meta: inspected.meta, events: [], current: false }
  const stored = await persistence.readFrom(sessionId, raw(range.events[0]).seq, signal)
  const nextSeq = raw(inspected.events[range.end])?.seq
  const events = []
  for (const entry of stored.events) {
    if (nextSeq !== undefined && raw(entry).seq >= nextSeq) break
    if (events.length && raw(entry).type === 'turn/start') break
    events.push(entry)
  }
  return { meta: stored.meta, events, current: range.current }
}
