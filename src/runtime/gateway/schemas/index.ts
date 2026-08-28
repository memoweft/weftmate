/**
 * WeftMate API v1 · schemas 入口（P1-01）。
 *
 * 对外三个校验函数：
 *  - validateEvent：统一信封 + 按 type 分派的 data 守卫（事件流入口）；
 *  - validateBootstrap：握手请求/响应；
 *  - validateHealth：健康快照。
 * 编译期护栏 = 各面的 TS 接口（tsc）；运行期护栏 = 这里的结构守卫。
 * 新 UI / 探针 / 设备只 import 本目录，不散连 DSH 内部（红线 6）。
 */
import { EVENT_TYPES, isKnownEventType, type EventType } from './catalog.ts'
import { checkCodingCommand, checkCodingCommit, checkCodingFileChange, checkCodingTestRun, checkCodingToolCall } from './coding.ts'
import { type EventEnvelope, checkEnvelope, type Validation } from './envelope.ts'
import { checkBootstrapRequest, checkBootstrapResponse } from './bootstrap.ts'
import { checkHealth } from './health.ts'
import { checkModelCallCompleted, checkModelCallFailed, checkModelCallStarted, checkModelList } from './model.ts'
import { checkPermissionDecided, checkPermissionRequested } from './permission.ts'
import { checkSessionActivated, checkSessionClosed, checkSessionCompacted, checkSessionCreated } from './session.ts'
import { checkWorkspaceActivated } from './workspace.ts'
import { checkStreamEvent, STREAM_EVENT_TYPES, type StreamEventType } from './stream.ts'

export {
  CODING_EVENT_TYPES,
  CODING_FILE_CHANGES,
  CODING_TOOL_STATUSES,
  checkCodingCommand,
  checkCodingCommit,
  checkCodingFileChange,
  checkCodingTestRun,
  checkCodingToolCall,
  type CodingCommandData,
  type CodingCommitData,
  type CodingEventType,
  type CodingFileChange,
  type CodingFileChangeData,
  type CodingTestRunData,
  type CodingToolCallData,
  type CodingToolStatus,
} from './coding.ts'
export {
  checkBootstrapRequest,
  checkBootstrapResponse,
  type BootstrapRequest,
  type BootstrapResponse,
} from './bootstrap.ts'
export {
  PROTOCOL_VERSION,
  type ProtocolVersion,
  checkEnvelope,
  type EventEnvelope,
  type Validation,
  isEventId,
  isIsoTimestamp,
} from './envelope.ts'
export {
  checkHealth,
  RUNTIME_STATES,
  UPDATE_STATUSES,
  type HealthPayload,
  type RuntimeState,
  type UpdateStatus,
} from './health.ts'
export {
  checkModelCallCompleted,
  checkModelCallFailed,
  checkModelCallStarted,
  checkModelList,
  MODEL_EVENT_TYPES,
  type GatewayErrorRef,
  type ModelCallCompletedData,
  type ModelCallFailedData,
  type ModelCallStartedData,
  type ModelEventType,
  type ModelInfo,
  type ModelListData,
  type ModelTokens,
} from './model.ts'
export {
  checkPermissionDecided,
  checkPermissionRequested,
  PERMISSION_DECIDED_BY,
  PERMISSION_DECISIONS,
  PERMISSION_EVENT_TYPES,
  type PermissionDecidedBy,
  type PermissionDecision,
  type PermissionEventType,
  type PermissionDecidedData,
  type PermissionRequestedData,
} from './permission.ts'
export {
  checkSessionActivated,
  checkSessionClosed,
  checkSessionCompacted,
  checkSessionCreated,
  SESSION_EVENT_TYPES,
  type SessionActivatedData,
  type SessionClosedData,
  type SessionCompactedData,
  type SessionCreatedData,
  type SessionEventType,
  type SessionRef,
} from './session.ts'
export {
  checkWorkspaceActivated,
  WORKSPACE_EVENT_TYPES,
  type WorkspaceActivatedData,
  type WorkspaceEventType,
  type WorkspaceRef,
} from './workspace.ts'
export { EVENT_TYPES, isKnownEventType, type EventType } from './catalog.ts'
export { STREAM_EVENT_TYPES, checkStreamEvent, type StreamEventType } from './stream.ts'

/** type → data 守卫分派表（与 EVENT_TYPES 一一对应，测试断言完备性）。 */
const DATA_CHECKS: Record<EventType, (input: unknown) => Validation<unknown>> = {
  'workspace.activated': checkWorkspaceActivated,
  'session.created': checkSessionCreated,
  'session.activated': checkSessionActivated,
  'session.compacted': checkSessionCompacted,
  'session.closed': checkSessionClosed,
  'model.list': checkModelList,
  'model.call.started': checkModelCallStarted,
  'model.call.completed': checkModelCallCompleted,
  'model.call.failed': checkModelCallFailed,
  'permission.requested': checkPermissionRequested,
  'permission.decided': checkPermissionDecided,
  'coding.toolCall': checkCodingToolCall,
  'coding.fileChange': checkCodingFileChange,
  'coding.command': checkCodingCommand,
  'coding.testRun': checkCodingTestRun,
  'coding.commit': checkCodingCommit,
  'user.message': (input) => checkStreamEvent('user.message', input),
  'assistant.delta': (input) => checkStreamEvent('assistant.delta', input),
  'assistant.completed': (input) => checkStreamEvent('assistant.completed', input),
  'agent.status': (input) => checkStreamEvent('agent.status', input),
  'tool.started': (input) => checkStreamEvent('tool.started', input),
  'tool.completed': (input) => checkStreamEvent('tool.completed', input),
  'tool.failed': (input) => checkStreamEvent('tool.failed', input),
  'turn.stopped': (input) => checkStreamEvent('turn.stopped', input),
  'error': (input) => checkStreamEvent('error', input),
}

/** 事件流统一入口：信封 + 类型 + data 三层校验。 */
export function validateEvent(input: unknown): Validation<EventEnvelope<unknown>> {
  const env = checkEnvelope(input)
  if (!env.ok) return env
  const type = env.value.type
  if (!isKnownEventType(type)) {
    return { ok: false, errors: [`event.type: unknown "${type}" (expected one of ${EVENT_TYPES.join(', ')})`] }
  }
  const data = DATA_CHECKS[type](env.value.data)
  return data.ok ? env : data
}
