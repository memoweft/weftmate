/** P1-03 streamed session and agent event contract (additive to P1-01). */
import { type Validation, isNonEmptyString, isNullable, isOneOf, isRecord } from './envelope.ts'

export const STREAM_EVENT_TYPES = [
  'user.message', 'assistant.delta', 'assistant.completed', 'agent.status',
  'tool.started', 'tool.completed', 'tool.failed', 'turn.stopped', 'error',
] as const
export type StreamEventType = (typeof STREAM_EVENT_TYPES)[number]

function sessionTurn(input: Record<string, unknown>, name: string): string[] {
  const errors: string[] = []
  if (!isNonEmptyString(input.sessionId, 128)) errors.push(`${name}.sessionId: required non-empty string`)
  if (!isNullable(input.turn, (value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0)) errors.push(`${name}.turn: non-negative integer or null`)
  return errors
}

function text(input: unknown, name: string): Validation<Record<string, unknown>> {
  if (!isRecord(input)) return { ok: false, errors: [`${name}: expected object`] }
  const errors = sessionTurn(input, name)
  if (!isNonEmptyString(input.text, 32_768)) errors.push(`${name}.text: required non-empty string`)
  return errors.length ? { ok: false, errors } : { ok: true, value: input }
}

function tool(input: unknown, name: string): Validation<Record<string, unknown>> {
  if (!isRecord(input)) return { ok: false, errors: [`${name}: expected object`] }
  const errors = sessionTurn(input, name)
  if (!isNullable(input.callId, (value): value is string => isNonEmptyString(value, 128))) errors.push(`${name}.callId: string or null`)
  if (!isNonEmptyString(input.tool, 256)) errors.push(`${name}.tool: required non-empty string`)
  return errors.length ? { ok: false, errors } : { ok: true, value: input }
}

export function checkStreamEvent(type: StreamEventType, input: unknown): Validation<Record<string, unknown>> {
  if (type === 'user.message' || type === 'assistant.delta' || type === 'assistant.completed') return text(input, type)
  if (type === 'tool.started' || type === 'tool.completed' || type === 'tool.failed') return tool(input, type)
  if (!isRecord(input)) return { ok: false, errors: [`${type}: expected object`] }
  const errors = sessionTurn(input, type)
  if (type === 'agent.status' && !isOneOf(input.status, ['running', 'idle'] as const)) errors.push('agent.status.status: running or idle')
  if (type === 'turn.stopped' && input.reason !== 'cancelled') errors.push('turn.stopped.reason: cancelled')
  if (type === 'error') {
    if (!isNonEmptyString(input.code, 128)) errors.push('error.code: required non-empty string')
    if (!isNonEmptyString(input.message, 512)) errors.push('error.message: required non-empty string')
    if (!isRecord(input.details) || !isNonEmptyString(input.details.digest, 64)) errors.push('error.details.digest: required non-empty string')
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: input }
}
