import { appendFileSync, existsSync, statSync } from 'node:fs'

const MAX_LOG_BYTES = 1024 * 1024
const EVENT = /^[a-z][a-z0-9-]{1,48}$/
const ID = /^[A-Za-z0-9._:-]{1,160}$/
const numeric = (value) => Number.isSafeInteger(value) && value >= 0 ? value : undefined

/** Metadata-only, bounded append. Log exhaustion never changes the model stream. */
export function createObservationRecorder(file, { maxBytes = MAX_LOG_BYTES } = {}) {
  let closed = false
  let bytes = existsSync(file) ? statSync(file).size : 0
  function record(row) {
    if (closed || !row || !EVENT.test(row.event ?? '')) return false
    const clean = { event: row.event, at: new Date().toISOString(),
      ...(ID.test(row.runId ?? '') ? { runId: row.runId } : {}),
      ...(ID.test(row.requestId ?? '') ? { requestId: row.requestId } : {}),
      ...(ID.test(row.sessionId ?? '') ? { sessionId: row.sessionId } : {}),
      ...(numeric(row.turn) !== undefined ? { turn: row.turn } : {}),
      ...(numeric(row.step) !== undefined ? { step: row.step } : {}),
      ...(numeric(row.attempt) !== undefined ? { attempt: row.attempt } : {}),
      ...(numeric(row.status) !== undefined ? { status: row.status } : {}),
      ...(numeric(row.bytes) !== undefined ? { bytes: row.bytes } : {}),
      ...(numeric(row.inputTokens) !== undefined ? { inputTokens: row.inputTokens } : {}),
      ...(numeric(row.outputTokens) !== undefined ? { outputTokens: row.outputTokens } : {}),
      ...(numeric(row.reasoningTokens) !== undefined ? { reasoningTokens: row.reasoningTokens } : {}),
      ...(numeric(row.cacheReadTokens) !== undefined ? { cacheReadTokens: row.cacheReadTokens } : {}),
      ...(numeric(row.cacheWriteTokens) !== undefined ? { cacheWriteTokens: row.cacheWriteTokens } : {}),
      ...(typeof row.kind === 'string' && /^(chat|models|text|reasoning|tool|stop|tool-calls|max-tokens|aborted|error|unknown)$/.test(row.kind)
        ? { kind: row.kind } : {}),
    }
    const line = `${JSON.stringify(clean)}\n`
    const size = Buffer.byteLength(line)
    if (bytes + size > maxBytes) return false
    try { appendFileSync(file, line, { encoding: 'utf8', flag: 'a', mode: 0o600 }); bytes += size; return true }
    catch { return false }
  }
  return { record, close() { closed = true }, status() { return { bytes, full: bytes >= maxBytes, closed } } }
}
