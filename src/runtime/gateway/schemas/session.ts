/**
 * WeftMate API v1 · session 面（P1-01）。
 *
 * 会话生命周期事件（归一化自 DSH 会话事件，经 dsh-adapter 翻译）：
 *  created / activated / compacted / closed。UI 的会话列表、压缩提示、
 *  关闭回收都消费这一组，不直接看 DSH 内部事件（红线 6）。
 */
import {
  type Validation,
  isIsoTimestamp,
  isNonEmptyString,
  isNonNegInt,
  isNullable,
  isRecord,
} from './envelope.ts'

export interface SessionRef {
  id: string
  workspaceId: string
  title: string | null
  createdAt: string
}

export interface SessionCreatedData extends SessionRef {}
export interface SessionActivatedData {
  id: string
  workspaceId: string
}
export interface SessionCompactedData {
  id: string
  /** 压缩后摘要字符数；无法统计时为 null。 */
  summaryChars: number | null
}
export interface SessionClosedData {
  id: string
  reason: string | null
}

export const SESSION_EVENT_TYPES = [
  'session.created',
  'session.activated',
  'session.compacted',
  'session.closed',
] as const
export type SessionEventType = (typeof SESSION_EVENT_TYPES)[number]

function checkIdFields(input: Record<string, unknown>, label: string): string[] {
  const errors: string[] = []
  if (!isNonEmptyString(input.id, 128)) errors.push(`${label}.id: required non-empty string`)
  if (!isNonEmptyString(input.workspaceId, 128)) errors.push(`${label}.workspaceId: required non-empty string`)
  return errors
}

export function checkSessionCreated(input: unknown): Validation<SessionCreatedData> {
  if (!isRecord(input)) return { ok: false, errors: ['session.created: expected object'] }
  const errors = checkIdFields(input, 'session.created')
  if (!isNullable(input.title, (v): v is string => isNonEmptyString(v, 512))) {
    errors.push('session.created.title: string or null')
  }
  if (!isIsoTimestamp(input.createdAt)) errors.push('session.created.createdAt: required ISO 8601')
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: input as unknown as SessionCreatedData }
}

export function checkSessionActivated(input: unknown): Validation<SessionActivatedData> {
  if (!isRecord(input)) return { ok: false, errors: ['session.activated: expected object'] }
  const errors = checkIdFields(input, 'session.activated')
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: input as unknown as SessionActivatedData }
}

export function checkSessionCompacted(input: unknown): Validation<SessionCompactedData> {
  if (!isRecord(input)) return { ok: false, errors: ['session.compacted: expected object'] }
  const errors: string[] = []
  if (!isNonEmptyString(input.id, 128)) errors.push('session.compacted.id: required non-empty string')
  if (!isNullable(input.summaryChars, isNonNegInt)) errors.push('session.compacted.summaryChars: non-negative int or null')
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: input as unknown as SessionCompactedData }
}

export function checkSessionClosed(input: unknown): Validation<SessionClosedData> {
  if (!isRecord(input)) return { ok: false, errors: ['session.closed: expected object'] }
  const errors: string[] = []
  if (!isNonEmptyString(input.id, 128)) errors.push('session.closed.id: required non-empty string')
  if (!isNullable(input.reason, (v): v is string => isNonEmptyString(v, 512))) {
    errors.push('session.closed.reason: string or null')
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: input as unknown as SessionClosedData }
}

export function isSessionEvent(type: string): type is SessionEventType {
  return (SESSION_EVENT_TYPES as readonly string[]).includes(type)
}
