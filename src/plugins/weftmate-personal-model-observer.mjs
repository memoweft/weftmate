import { isAbsolute } from 'node:path'
import { isAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { createObservationRecorder } from '../personal-model-observation/record.mjs'
import { createSemanticObserver } from '../personal-model-observation/semantic.mjs'

export const name = 'weftmate-personal-model-observer'
export const inject = ['agents', 'llm']

export function apply(ctx) {
  const file = process.env.WEFTMATE_STAGE14_R2_SEMANTIC_LOG
  const runId = process.env.WEFTMATE_STAGE14_R2_RUN_ID
  if (typeof file !== 'string' || !isAbsolute(file) ||
      typeof runId !== 'string' || !/^[0-9a-f-]{36}$/.test(runId)) return
  const recorder = createObservationRecorder(file)
  recorder.record({ event: 'observer-ready', runId })
  const observer = createSemanticObserver({
    record: (row) => recorder.record({ ...row, runId }), isAgentLoopRequest,
  })
  ctx.on('agent/request', observer.request, { global: true })
  ctx.on('llm/stream', observer.stream, { global: true })
  ctx.effect(() => () => recorder.close(), 'weftmate-personal-model-observer: close metadata log')
}

export default { name, inject, apply }
