/**
 * WeftMate API v1 · 公共事件信封与校验基元（P1-01）。
 *
 * Gateway 对外所有事件共用一个信封：`v` 固定为 1、`id` 网关进程内唯一、
 * `at` ISO 8601、`data` 按 `type` 定型（各面模块自带守卫）。
 * 消费者（新 UI / CLI 探针 / 未来设备）只依赖信封 + 各事件 `data` 类型，
 * 不接触 DSH 内部事件（红线 6）。本层零依赖：编译期由 tsc 守，运行期由
 * 手写结构守卫守（node --test 原生 type-stripping 直跑，不用 enum/namespace）。
 */

/** 协议版本：v1。升级协议 = 新 major，不是改 v1 语义。 */
export const PROTOCOL_VERSION = 1 as const
export type ProtocolVersion = typeof PROTOCOL_VERSION

/** 统一事件信封。`type` 的合法值见 index.ts 的 EVENT_TYPES。 */
export interface EventEnvelope<T = unknown> {
  v: ProtocolVersion
  id: string
  type: string
  at: string
  data: T
}

/** 校验结果：ok 携带定型值；fail 携带可读错误列表（前缀带字段路径）。 */
export type Validation<T> = { ok: true; value: T } | { ok: false; errors: string[] }

// —— 结构守卫基元（各面模块复用）——

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isNonEmptyString(value: unknown, max = Infinity): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

export function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

export function isNonNegInt(value: unknown): value is number {
  return isInt(value) && (value as number) >= 0
}

/** 可空字段：null 或满足谓词的值。 */
export function isNullable<T>(value: unknown, check: (v: unknown) => v is T): value is T | null {
  return value === null || check(value)
}

/** 枚举成员判定。 */
export function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value as string)
}

/** ISO 8601 时间戳（含毫秒/时区可选；Date.parse 复核）。 */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
export function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && ISO_RE.test(value) && !Number.isNaN(Date.parse(value))
}

/** 事件 id：非空短字符串。 */
export function isEventId(value: unknown): value is string {
  return isNonEmptyString(value, 128)
}

/** 信封校验：只守信封五字段；`data` 由各面守卫负责。 */
export function checkEnvelope<T>(input: unknown): Validation<EventEnvelope<T>> {
  if (!isRecord(input)) return { ok: false, errors: ['envelope: expected object'] }
  const errors: string[] = []
  if (input.v !== PROTOCOL_VERSION) errors.push('envelope.v: must be 1')
  if (!isEventId(input.id)) errors.push('envelope.id: required non-empty string (<=128)')
  if (!isNonEmptyString(input.type, 64)) errors.push('envelope.type: required non-empty string')
  if (!isIsoTimestamp(input.at)) errors.push('envelope.at: required ISO 8601 timestamp')
  if (!('data' in input)) errors.push('envelope.data: required')
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: input as unknown as EventEnvelope<T> }
}
