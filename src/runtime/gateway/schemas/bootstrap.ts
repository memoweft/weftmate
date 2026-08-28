/**
 * WeftMate API v1 · bootstrap 面（P1-01）。
 *
 * 客户端握手（请求 → 响应）：客户端报身份与能力位，Gateway 回
 * 协议版本 + 完整健康快照 + 支持的事件目录。G1 的最小 HTML/CLI 探针
 * 第一步就是 bootstrap——拿到 events 目录后只订阅它认识的事件。
 */
import { EVENT_TYPES } from './catalog.ts'
import {
  PROTOCOL_VERSION,
  type Validation,
  isNonEmptyString,
  isRecord,
} from './envelope.ts'
import { checkHealth, type HealthPayload } from './health.ts'

export interface BootstrapRequest {
  client: { name: string; version: string }
  /** 能力位（如 { streaming: true }）；未知键忽略。 */
  capabilities?: Record<string, unknown>
}

export interface BootstrapResponse {
  protocolVersion: typeof PROTOCOL_VERSION
  health: HealthPayload
  /** 本 Gateway 支持的事件类型全集（= catalog.EVENT_TYPES）。 */
  events: readonly string[]
}

export function checkBootstrapRequest(input: unknown): Validation<BootstrapRequest> {
  if (!isRecord(input)) return { ok: false, errors: ['bootstrap.request: expected object'] }
  const errors: string[] = []
  if (!isRecord(input.client)) {
    errors.push('bootstrap.request.client: required object')
  } else {
    const c = input.client as Record<string, unknown>
    if (!isNonEmptyString(c.name, 128)) errors.push('bootstrap.request.client.name: required non-empty string')
    if (!isNonEmptyString(c.version, 64)) errors.push('bootstrap.request.client.version: required non-empty string')
  }
  if (
    input.capabilities !== undefined &&
    !isRecord(input.capabilities)
  ) {
    errors.push('bootstrap.request.capabilities: object or absent')
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: input as unknown as BootstrapRequest }
}

export function checkBootstrapResponse(input: unknown): Validation<BootstrapResponse> {
  if (!isRecord(input)) return { ok: false, errors: ['bootstrap.response: expected object'] }
  const errors: string[] = []
  if (input.protocolVersion !== PROTOCOL_VERSION) errors.push('bootstrap.response.protocolVersion: must be 1')
  const health = checkHealth(input.health)
  if (!health.ok) errors.push(...health.errors)
  if (!Array.isArray(input.events)) {
    errors.push('bootstrap.response.events: required array')
  } else {
    for (const e of input.events) {
      if (!isNonEmptyString(e, 64) || !(EVENT_TYPES as readonly string[]).includes(e)) {
        errors.push(`bootstrap.response.events: unknown event type "${String(e)}"`)
      }
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: input as unknown as BootstrapResponse }
}
