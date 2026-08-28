/**
 * WeftMate API v1 · model 面（P1-01）。
 *
 * 模型路由与调用：`model.list`（可用模型/当前激活）+ 调用生命周期事件
 * `model.call.started / completed / failed`。G1 验收探针（最小 HTML/CLI）
 * 就消费这一面完成一次模型调用。token/duration 缺失时为 null，不省略。
 */
import {
  type Validation,
  isInt,
  isNonEmptyString,
  isNullable,
  isRecord,
} from './envelope.ts'

export interface ModelInfo {
  id: string
  label: string | null
  /** 上下文窗口 token 数；未知为 null。 */
  contextWindow: number | null
}

export interface ModelListData {
  models: ModelInfo[]
  /** 当前激活模型 id；未激活为 null。 */
  active: string | null
}

export interface ModelCallBase {
  callId: string
  sessionId: string
  model: string
}

export interface ModelTokens {
  input: number | null
  output: number | null
}

export interface ModelCallStartedData extends ModelCallBase {}
export interface ModelCallCompletedData extends ModelCallBase {
  tokens: ModelTokens | null
  durationMs: number | null
}
export interface GatewayErrorRef {
  code: string
  message: string
}
export interface ModelCallFailedData extends ModelCallBase {
  error: GatewayErrorRef
}

export const MODEL_EVENT_TYPES = [
  'model.list',
  'model.call.started',
  'model.call.completed',
  'model.call.failed',
] as const
export type ModelEventType = (typeof MODEL_EVENT_TYPES)[number]

function checkModelInfo(input: unknown, label: string): string[] {
  if (!isRecord(input)) return [`${label}: expected object`]
  const errors: string[] = []
  if (!isNonEmptyString(input.id, 256)) errors.push(`${label}.id: required non-empty string`)
  if (!isNullable(input.label, (v): v is string => isNonEmptyString(v, 256))) {
    errors.push(`${label}.label: string or null`)
  }
  if (!isNullable(input.contextWindow, isInt)) errors.push(`${label}.contextWindow: int or null`)
  return errors
}

export function checkModelList(input: unknown): Validation<ModelListData> {
  if (!isRecord(input)) return { ok: false, errors: ['model.list: expected object'] }
  const errors: string[] = []
  if (!Array.isArray(input.models)) {
    errors.push('model.list.models: required array')
  } else {
    input.models.forEach((m, i) => {
      for (const e of checkModelInfo(m, `model.list.models[${i}]`)) errors.push(e)
    })
  }
  if (!isNullable(input.active, (v): v is string => isNonEmptyString(v, 256))) {
    errors.push('model.list.active: string or null')
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: input as unknown as ModelListData }
}

function checkCallBase(input: Record<string, unknown>, label: string): string[] {
  const errors: string[] = []
  if (!isNonEmptyString(input.callId, 128)) errors.push(`${label}.callId: required non-empty string`)
  if (!isNonEmptyString(input.sessionId, 128)) errors.push(`${label}.sessionId: required non-empty string`)
  if (!isNonEmptyString(input.model, 256)) errors.push(`${label}.model: required non-empty string`)
  return errors
}

export function checkModelCallStarted(input: unknown): Validation<ModelCallStartedData> {
  if (!isRecord(input)) return { ok: false, errors: ['model.call.started: expected object'] }
  const errors = checkCallBase(input, 'model.call.started')
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: input as unknown as ModelCallStartedData }
}

export function checkModelCallCompleted(input: unknown): Validation<ModelCallCompletedData> {
  if (!isRecord(input)) return { ok: false, errors: ['model.call.completed: expected object'] }
  const errors = checkCallBase(input, 'model.call.completed')
  if (input.tokens !== null && !isRecord(input.tokens)) {
    errors.push('model.call.completed.tokens: object or null')
  } else if (input.tokens !== null) {
    const t = input.tokens as Record<string, unknown>
    if (!isNullable(t.input, isInt)) errors.push('model.call.completed.tokens.input: int or null')
    if (!isNullable(t.output, isInt)) errors.push('model.call.completed.tokens.output: int or null')
  }
  if (!isNullable(input.durationMs, (v): v is number => isInt(v) && (v as number) >= 0)) {
    errors.push('model.call.completed.durationMs: non-negative int or null')
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: input as unknown as ModelCallCompletedData }
}

export function checkModelCallFailed(input: unknown): Validation<ModelCallFailedData> {
  if (!isRecord(input)) return { ok: false, errors: ['model.call.failed: expected object'] }
  const errors = checkCallBase(input, 'model.call.failed')
  if (!isRecord(input.error)) {
    errors.push('model.call.failed.error: required object')
  } else {
    const e = input.error as Record<string, unknown>
    if (!isNonEmptyString(e.code, 64)) errors.push('model.call.failed.error.code: required non-empty string')
    if (!isNonEmptyString(e.message, 4096)) errors.push('model.call.failed.error.message: required non-empty string')
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: input as unknown as ModelCallFailedData }
}

export function isModelEvent(type: string): type is ModelEventType {
  return (MODEL_EVENT_TYPES as readonly string[]).includes(type)
}
