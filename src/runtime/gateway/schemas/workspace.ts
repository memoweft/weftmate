/**
 * WeftMate API v1 · workspace 面（P1-01）。
 *
 * workspace = 一次会话/任务挂载的工作目录引用。事件：`workspace.activated`
 * （会话激活了某工作区，UI 据此显示工作区上下文）。
 */
import { type Validation, isNonEmptyString, isNullable, isRecord } from './envelope.ts'

/** 工作区引用：id 网关内唯一；root = 运行时主机上的绝对路径。 */
export interface WorkspaceRef {
  id: string
  name: string | null
  root: string
}

export interface WorkspaceActivatedData extends WorkspaceRef {}

export const WORKSPACE_EVENT_TYPES = ['workspace.activated'] as const
export type WorkspaceEventType = (typeof WORKSPACE_EVENT_TYPES)[number]

export function checkWorkspaceRef(input: unknown): Validation<WorkspaceRef> {
  if (!isRecord(input)) return { ok: false, errors: ['workspace: expected object'] }
  const errors: string[] = []
  if (!isNonEmptyString(input.id, 128)) errors.push('workspace.id: required non-empty string')
  if (!isNullable(input.name, (v): v is string => isNonEmptyString(v, 256))) {
    errors.push('workspace.name: string or null')
  }
  if (!isNonEmptyString(input.root, 2048)) errors.push('workspace.root: required non-empty string (absolute path)')
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: input as unknown as WorkspaceRef }
}

export function checkWorkspaceActivated(input: unknown): Validation<WorkspaceActivatedData> {
  return checkWorkspaceRef(input)
}

/** 供探针/测试构造合法时间戳用（生产由 Gateway 侧填）。 */
export function isWorkspaceEvent(type: string): type is WorkspaceEventType {
  return (WORKSPACE_EVENT_TYPES as readonly string[]).includes(type)
}
