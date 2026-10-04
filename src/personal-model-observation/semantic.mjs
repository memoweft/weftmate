/** Observe only exact LOOP requests from an owner-bound personal turn. */
export function createSemanticObserver({ record, isAgentLoopRequest }) {
  const bySignal = new WeakMap()
  const attempts = new Map()
  function request(payload, next) {
    return Promise.resolve(next()).then((config) => {
      const session = payload?.agent?.session
      if (session?.header?.agentPreset === 'personal-remote' &&
          typeof session.id === 'string' && payload.signal instanceof AbortSignal &&
          Number.isSafeInteger(payload.turn) && Number.isSafeInteger(payload.step)) {
        bySignal.set(payload.signal, { sessionId: session.id, turn: payload.turn, step: payload.step })
      }
      return config
    })
  }
  function stream(options, next) {
    const scope = options?.signal && bySignal.get(options.signal)
    if (!scope || options.sessionId !== scope.sessionId || options.purpose !== undefined ||
        !isAgentLoopRequest(options)) return next()
    const key = `${scope.sessionId}:${scope.turn}:${scope.step}`
    const attempt = (attempts.get(key) ?? 0) + 1
    if (attempts.size > 1_000) attempts.clear()
    attempts.set(key, attempt)
    const id = { ...scope, attempt }
    return (async function* () {
      let firstChunk = false, firstText = false, firstReasoning = false, firstTool = false
      let finished = false, cancelled = false
      const abort = () => { if (!cancelled) { cancelled = true; record({ event: 'semantic-cancel', ...id }) } }
      options.signal.addEventListener('abort', abort, { once: true })
      record({ event: 'semantic-start', ...id })
      try {
        for await (const chunk of next()) {
          if (!firstChunk) { firstChunk = true; record({ event: 'semantic-first-chunk', ...id }) }
          if (chunk?.type === 'reasoning-delta' && !firstReasoning) {
            firstReasoning = true; record({ event: 'semantic-first-reasoning', ...id })
          }
          if (chunk?.type === 'text-delta' && !firstText) {
            firstText = true; record({ event: 'semantic-first-text', ...id })
          }
          if (chunk?.type === 'tool-call-delta' && !firstTool) {
            firstTool = true; record({ event: 'semantic-first-tool', ...id })
          }
          if (chunk?.type === 'usage') {
            const usage = chunk.usage ?? {}
            record({ event: 'semantic-usage', ...id, inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens,
              cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens })
          }
          if (chunk?.type === 'finish') {
            finished = true
            record({ event: 'semantic-finish', ...id, kind: chunk.reason?.kind ?? 'unknown' })
          }
          yield chunk
        }
      } catch (error) {
        record({ event: 'semantic-error', ...id })
        throw error
      } finally {
        options.signal.removeEventListener('abort', abort)
        if (!finished && !cancelled) record({ event: 'semantic-incomplete', ...id })
      }
    })()
  }
  return { request, stream }
}
