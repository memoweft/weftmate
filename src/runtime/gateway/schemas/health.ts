/**
 * WeftMate API v1 · health 面（P1-01）。
 *
 * Gateway 健康快照（请求为空对象，响应 = HealthPayload）。
 * 探针/UI 轮询它判断：运行时状态、DSH pin 是否钉住、会话数、
 * MemoWeft 记忆层可用性、更新态。字段缺失即降级显示，不做重试风暴。
 */
import {
  PROTOCOL_VERSION,
  type Validation,
  isIsoTimestamp,
  isNonEmptyString,
  isNonNegInt,
  isNullable,
  isOneOf,
  isRecord,
} from './envelope.ts'

export const RUNTIME_STATES = ['running', 'degraded', 'stopped'] as const
export type RuntimeState = (typeof RUNTIME_STATES)[number]

export const UPDATE_STATUSES = ['up-to-date', 'update-available', 'checking', 'unknown'] as const
export type UpdateStatus = (typeof UPDATE_STATUSES)[number]

export interface HealthPayload {
  app: { name: string; version: string }
  gateway: { protocolVersion: typeof PROTOCOL_VERSION; startedAt: string }
  runtime: { state: RuntimeState }
  dsh: {
    /** 钉住的 commit（= tests/contract/dsh-pin.json）。 */
    pin: string
    /** checkout HEAD 与 pin 是否一致。 */
    pinned: boolean
  }
  sessions: { active: number }
  memory: {
    /** MemoWeft 桥是否可用（长期个人记忆唯一权威）。 */
    available: boolean
    version: string | null
  }
  update: { status: UpdateStatus; version: string | null }
}

export function checkHealth(input: unknown): Validation<HealthPayload> {
  if (!isRecord(input)) return { ok: false, errors: ['health: expected object'] }
  const errors: string[] = []

  if (!isRecord(input.app)) {
    errors.push('health.app: required object')
  } else {
    const app = input.app as Record<string, unknown>
    if (!isNonEmptyString(app.name, 128)) errors.push('health.app.name: required non-empty string')
    if (!isNonEmptyString(app.version, 64)) errors.push('health.app.version: required non-empty string')
  }

  if (!isRecord(input.gateway)) {
    errors.push('health.gateway: required object')
  } else {
    const gw = input.gateway as Record<string, unknown>
    if (gw.protocolVersion !== PROTOCOL_VERSION) errors.push('health.gateway.protocolVersion: must be 1')
    if (!isIsoTimestamp(gw.startedAt)) errors.push('health.gateway.startedAt: required ISO 8601')
  }

  if (!isRecord(input.runtime) || !isOneOf((input.runtime as Record<string, unknown>).state, RUNTIME_STATES)) {
    errors.push(`health.runtime.state: one of ${RUNTIME_STATES.join(' | ')}`)
  }

  if (!isRecord(input.dsh)) {
    errors.push('health.dsh: required object')
  } else {
    const dsh = input.dsh as Record<string, unknown>
    if (!isNonEmptyString(dsh.pin, 128)) errors.push('health.dsh.pin: required non-empty string')
    if (typeof dsh.pinned !== 'boolean') errors.push('health.dsh.pinned: required boolean')
  }

  if (!isRecord(input.sessions) || !isNonNegInt((input.sessions as Record<string, unknown>).active)) {
    errors.push('health.sessions.active: required non-negative int')
  }

  if (!isRecord(input.memory)) {
    errors.push('health.memory: required object')
  } else {
    const mem = input.memory as Record<string, unknown>
    if (typeof mem.available !== 'boolean') errors.push('health.memory.available: required boolean')
    if (!isNullable(mem.version, (v): v is string => isNonEmptyString(v, 64))) {
      errors.push('health.memory.version: string or null')
    }
  }

  if (!isRecord(input.update)) {
    errors.push('health.update: required object')
  } else {
    const upd = input.update as Record<string, unknown>
    if (!isOneOf(upd.status, UPDATE_STATUSES)) {
      errors.push(`health.update.status: one of ${UPDATE_STATUSES.join(' | ')}`)
    }
    if (!isNullable(upd.version, (v): v is string => isNonEmptyString(v, 64))) {
      errors.push('health.update.version: string or null')
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: input as unknown as HealthPayload }
}
