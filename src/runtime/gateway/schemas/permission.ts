/**
 * WeftMate API v1 · permission 面（P1-01）。
 *
 * 工具/动作权限流：`permission.requested`（某工具要某作用域）→
 * `permission.decided`（用户或策略裁决）。新 UI 的授权卡片消费这一组；
 * 决策回传给 DSH 由 dsh-adapter 负责，schema 只定型对外形状。
 */
import {
  type Validation,
  isNonEmptyString,
  isNullable,
  isOneOf,
  isRecord,
} from './envelope.ts'

export const PERMISSION_DECISIONS = ['allow', 'deny', 'always-allow'] as const
export type PermissionDecision = (typeof PERMISSION_DECISIONS)[number]

export const PERMISSION_DECIDED_BY = ['user', 'policy'] as const
export type PermissionDecidedBy = (typeof PERMISSION_DECIDED_BY)[number]

export interface PermissionRequestedData {
  requestId: string
  sessionId: string
  tool: string
  /** 作用域描述（如路径前缀/命令白名单项）；无则为 null。 */
  scope: string | null
  description: string | null
}

export interface PermissionDecidedData {
  requestId: string
  sessionId: string
  tool: string
  decision: PermissionDecision
  decidedBy: PermissionDecidedBy
}

export const PERMISSION_EVENT_TYPES = [
  'permission.requested',
  'permission.decided',
] as const
export type PermissionEventType = (typeof PERMISSION_EVENT_TYPES)[number]

function checkRequestBase(input: Record<string, unknown>, label: string): string[] {
  const errors: string[] = []
  if (!isNonEmptyString(input.requestId, 128)) errors.push(`${label}.requestId: required non-empty string`)
  if (!isNonEmptyString(input.sessionId, 128)) errors.push(`${label}.sessionId: required non-empty string`)
  if (!isNonEmptyString(input.tool, 128)) errors.push(`${label}.tool: required non-empty string`)
  return errors
}

export function checkPermissionRequested(input: unknown): Validation<PermissionRequestedData> {
  if (!isRecord(input)) return { ok: false, errors: ['permission.requested: expected object'] }
  const errors = checkRequestBase(input, 'permission.requested')
  if (!isNullable(input.scope, (v): v is string => isNonEmptyString(v, 512))) {
    errors.push('permission.requested.scope: string or null')
  }
  if (!isNullable(input.description, (v): v is string => isNonEmptyString(v, 1024))) {
    errors.push('permission.requested.description: string or null')
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: input as unknown as PermissionRequestedData }
}

export function checkPermissionDecided(input: unknown): Validation<PermissionDecidedData> {
  if (!isRecord(input)) return { ok: false, errors: ['permission.decided: expected object'] }
  const errors = checkRequestBase(input, 'permission.decided')
  if (!isOneOf(input.decision, PERMISSION_DECISIONS)) {
    errors.push(`permission.decided.decision: one of ${PERMISSION_DECISIONS.join(' | ')}`)
  }
  if (!isOneOf(input.decidedBy, PERMISSION_DECIDED_BY)) {
    errors.push(`permission.decided.decidedBy: one of ${PERMISSION_DECIDED_BY.join(' | ')}`)
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: input as unknown as PermissionDecidedData }
}

export function isPermissionEvent(type: string): type is PermissionEventType {
  return (PERMISSION_EVENT_TYPES as readonly string[]).includes(type)
}
