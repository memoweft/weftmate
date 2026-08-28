/**
 * WeftMate API v1 · coding 面（P1-01）。
 *
 * Coding Agent 活动流（G6 Coding 产品的消费面，Stage 1 先定型）：
 *  toolCall（工具调用三态）/ fileChange / command / testRun / commit。
 * path 一律相对 workspace.root（不泄漏主机绝对路径给 UI）；
 * 计数/退出码缺失时为 null，不省略。
 */
import {
  type Validation,
  isInt,
  isNonEmptyString,
  isNullable,
  isOneOf,
  isRecord,
} from './envelope.ts'

export const CODING_TOOL_STATUSES = ['started', 'completed', 'failed'] as const
export type CodingToolStatus = (typeof CODING_TOOL_STATUSES)[number]

export const CODING_FILE_CHANGES = ['created', 'modified', 'deleted'] as const
export type CodingFileChange = (typeof CODING_FILE_CHANGES)[number]

export interface CodingToolCallData {
  sessionId: string
  tool: string
  status: CodingToolStatus
  durationMs: number | null
  error: string | null
}

export interface CodingFileChangeData {
  sessionId: string
  /** 相对 workspace.root 的路径。 */
  path: string
  change: CodingFileChange
}

export interface CodingCommandData {
  sessionId: string
  command: string
  exitCode: number | null
  durationMs: number | null
}

export interface CodingTestRunData {
  sessionId: string
  total: number
  passed: number
  failed: number
}

export interface CodingCommitData {
  sessionId: string
  sha: string
  message: string
}

export const CODING_EVENT_TYPES = [
  'coding.toolCall',
  'coding.fileChange',
  'coding.command',
  'coding.testRun',
  'coding.commit',
] as const
export type CodingEventType = (typeof CODING_EVENT_TYPES)[number]

function checkSession(input: Record<string, unknown>, label: string): string[] {
  return isNonEmptyString(input.sessionId, 128)
    ? []
    : [`${label}.sessionId: required non-empty string`]
}

const nonNegInt = (v: unknown): v is number => isInt(v) && (v as number) >= 0

export function checkCodingToolCall(input: unknown): Validation<CodingToolCallData> {
  if (!isRecord(input)) return { ok: false, errors: ['coding.toolCall: expected object'] }
  const errors = checkSession(input, 'coding.toolCall')
  if (!isNonEmptyString(input.tool, 128)) errors.push('coding.toolCall.tool: required non-empty string')
  if (!isOneOf(input.status, CODING_TOOL_STATUSES)) {
    errors.push(`coding.toolCall.status: one of ${CODING_TOOL_STATUSES.join(' | ')}`)
  }
  if (!isNullable(input.durationMs, nonNegInt)) errors.push('coding.toolCall.durationMs: non-negative int or null')
  if (!isNullable(input.error, (v): v is string => isNonEmptyString(v, 4096))) {
    errors.push('coding.toolCall.error: string or null')
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: input as unknown as CodingToolCallData }
}

export function checkCodingFileChange(input: unknown): Validation<CodingFileChangeData> {
  if (!isRecord(input)) return { ok: false, errors: ['coding.fileChange: expected object'] }
  const errors = checkSession(input, 'coding.fileChange')
  if (!isNonEmptyString(input.path, 2048)) errors.push('coding.fileChange.path: required non-empty string (relative)')
  if (!isOneOf(input.change, CODING_FILE_CHANGES)) {
    errors.push(`coding.fileChange.change: one of ${CODING_FILE_CHANGES.join(' | ')}`)
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: input as unknown as CodingFileChangeData }
}

export function checkCodingCommand(input: unknown): Validation<CodingCommandData> {
  if (!isRecord(input)) return { ok: false, errors: ['coding.command: expected object'] }
  const errors = checkSession(input, 'coding.command')
  if (!isNonEmptyString(input.command, 4096)) errors.push('coding.command.command: required non-empty string')
  if (!isNullable(input.exitCode, isInt)) errors.push('coding.command.exitCode: int or null')
  if (!isNullable(input.durationMs, nonNegInt)) errors.push('coding.command.durationMs: non-negative int or null')
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: input as unknown as CodingCommandData }
}

export function checkCodingTestRun(input: unknown): Validation<CodingTestRunData> {
  if (!isRecord(input)) return { ok: false, errors: ['coding.testRun: expected object'] }
  const errors = checkSession(input, 'coding.testRun')
  for (const f of ['total', 'passed', 'failed'] as const) {
    if (!isNullable(input[f], nonNegInt)) errors.push(`coding.testRun.${f}: required non-negative int`)
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: input as unknown as CodingTestRunData }
}

export function checkCodingCommit(input: unknown): Validation<CodingCommitData> {
  if (!isRecord(input)) return { ok: false, errors: ['coding.commit: expected object'] }
  const errors = checkSession(input, 'coding.commit')
  if (!isNonEmptyString(input.sha, 64)) errors.push('coding.commit.sha: required non-empty string')
  if (!isNonEmptyString(input.message, 4096)) errors.push('coding.commit.message: required non-empty string')
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: input as unknown as CodingCommitData }
}

export function isCodingEvent(type: string): type is CodingEventType {
  return (CODING_EVENT_TYPES as readonly string[]).includes(type)
}
