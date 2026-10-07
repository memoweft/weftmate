const RECEIPT = /^[A-Za-z0-9._:-]{1,160}$/
const statuses = new Set(['completed', 'aborted', 'blocked', 'failed'])
const empty = () => ({ status: 'unconfirmed', turn: null, assistantChunks: 0,
  textChunks: 0, reasoningChunks: 0, assistantMessages: 0, toolSaveObserved: false })
const timeOf = (value) => Number.isFinite(value) && value > 0 &&
  value < 10_000_000_000_000 ? new Date(value).toISOString() : null

function observedSave(event, calls) {
  const source = event.data?.message?.source
  if (event.type !== 'tool/result' || source?.kind !== 'tool' ||
      typeof source.callId !== 'string' || !calls.has(source.callId) ||
      event.data?.error !== undefined) return false
  const block = event.data?.message?.content?.[0]
  if (block?.type !== 'tool-result' || block.toolCallId !== source.callId || block.isError === true) return false
  return (block.content ?? []).some(part => {
    if (part.type !== 'text' || typeof part.text !== 'string' || part.text.length > 4096) return false
    try {
      const parsed = JSON.parse(part.text), receipt = parsed.artifact ?? parsed
      return receipt?.state === 'observed' &&
        typeof receipt.artifactId === 'string' && /^artifact-[A-Za-z0-9-]{1,120}$/.test(receipt.artifactId) &&
        typeof receipt.taskId === 'string' && /^cmd-[0-9a-f-]{36}$/.test(receipt.taskId) &&
        Number.isSafeInteger(receipt.size) && receipt.size >= 1 && receipt.size <= 128 * 1024 &&
        typeof receipt.sha256 === 'string' && /^[a-f0-9]{64}$/.test(receipt.sha256)
    } catch { return false }
  })
}

/** Project only committed native metadata. `live` is current-child agent evidence. */
export function projectReplyEvidence(content, { receiptId, live = false } = {}) {
  const result = empty()
  if (!(typeof content === 'string' || Array.isArray(content)) ||
      typeof receiptId !== 'string' || !RECEIPT.test(receiptId)) return result
  const rows = []
  let priorSeq = -1
  for (const line of Array.isArray(content) ? content : content.split('\n')) {
    if (typeof line === 'string' && !line.trim()) continue
    let event
    try { event = typeof line === 'string' ? JSON.parse(line) : line.event ?? line } catch { return result }
    if (event.type === 'session' || ['text-chunks', 'reasoning-chunks',
      'tool-call-chunks'].includes(event.type)) continue
    if (!Number.isSafeInteger(event.seq) || event.seq <= priorSeq) return result
    priorSeq = event.seq
    rows.push(event)
  }
  const matching = rows.filter((event) => event.type === 'user/message' &&
    event.data?.source?.kind === 'user' && event.data.source.rpcId === receiptId)
  if (matching.length !== 1) return result
  const target = matching[0]
  const start = [...rows].reverse().find((event) => event.seq < target.seq &&
    event.type === 'turn/start' && Number.isSafeInteger(event.data?.turn))
  if (!start || start.data.turn < 1) return result
  // A late user receipt cannot inherit an already completed native turn.
  if (rows.some((event) => event.seq > start.seq && event.seq < target.seq &&
      event.type === 'turn/end')) return result
  const turn = start.data.turn
  const after = rows.filter((event) => event.seq > start.seq)
  const nextStart = after.find((event) => event.type === 'turn/start')
  const turnRows = nextStart ? after.filter((event) => event.seq < nextStart.seq) : after
  const users = turnRows.filter((event) => event.type === 'user/message' &&
    event.data?.source?.kind === 'user')
  if (users.length !== 1 || users[0].seq !== target.seq) return result
  const terminals = turnRows.filter((event) => event.type === 'turn/end')
  if (terminals.length > 1 || (terminals.length === 1 &&
      (terminals[0].seq <= target.seq || terminals[0].data?.turn !== turn))) return result
  const end = terminals[0] ?? null
  const scopedRows = end ? turnRows.filter((event) => event.seq <= end.seq) : turnRows
  const calls = new Set()
  let step = 0, assistantChunks = 0, textChunks = 0, reasoningChunks = 0
  let assistantMessages = 0, toolSaveObserved = false
  let firstChunkAt = null, lastChunkAt = null, observedAt = timeOf(start.time)
  for (const event of scopedRows) {
    if (event.type === 'step/start' && event.data?.turn === turn &&
        Number.isSafeInteger(event.data.step)) step = Math.max(step, event.data.step)
    if (event.type === 'tool/call' && event.data?.turn === turn &&
        typeof event.data.name === 'string' && typeof event.data.callId === 'string') {
      calls.add(event.data.callId)
    }
    if (observedSave(event, calls)) toolSaveObserved = true
    if (event.type === 'assistant/chunk' && event.data?.turn === turn) {
      assistantChunks++
      if (event.data.chunk?.type === 'text-delta') textChunks++
      if (event.data.chunk?.type === 'reasoning-delta') reasoningChunks++
      firstChunkAt ??= timeOf(event.time)
      lastChunkAt = timeOf(event.time) ?? lastChunkAt
    }
    if (event.type === 'assistant/message' && event.data?.turn === turn) assistantMessages++
    observedAt = timeOf(event.time) ?? observedAt
  }
  let status = 'unconfirmed'
  const reason = end?.data?.reason?.kind
  if (end && reason === 'max-tokens') status = 'failed'
  else if (end && statuses.has(reason)) status = reason
  else if (!end && !nextStart && live === true) status = assistantChunks > 0 ? 'streaming' : 'waiting'
  return { status, turn, step, assistantChunks, textChunks, reasoningChunks,
    assistantMessages, toolSaveObserved,
    ...(end && reason === 'max-tokens' ? { endReasonKind: 'max-tokens' } : {}),
    ...(observedAt ? { observedAt } : {}),
    ...(firstChunkAt ? { firstChunkAt } : {}),
    ...(lastChunkAt ? { lastChunkAt } : {}),
    ...(end && timeOf(end.time) ? { terminalAt: timeOf(end.time) } : {}) }
}
