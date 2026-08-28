/**
 * WeftMate API v1 · 事件目录（P1-01）。
 *
 * 全部 v1 事件类型的唯一汇总点：bootstrap 响应、validateEvent 的
 * 分派、测试的完备性断言都从这里取，不散落复制。
 */
import { CODING_EVENT_TYPES } from './coding.ts'
import { MODEL_EVENT_TYPES } from './model.ts'
import { PERMISSION_EVENT_TYPES } from './permission.ts'
import { SESSION_EVENT_TYPES } from './session.ts'
import { WORKSPACE_EVENT_TYPES } from './workspace.ts'
import { STREAM_EVENT_TYPES } from './stream.ts'

export const EVENT_TYPES = [
  ...WORKSPACE_EVENT_TYPES,
  ...SESSION_EVENT_TYPES,
  ...MODEL_EVENT_TYPES,
  ...PERMISSION_EVENT_TYPES,
  ...CODING_EVENT_TYPES,
  ...STREAM_EVENT_TYPES,
] as const

export type EventType = (typeof EVENT_TYPES)[number]

export function isKnownEventType(type: unknown): type is EventType {
  return typeof type === 'string' && (EVENT_TYPES as readonly string[]).includes(type)
}
