/** Safe, read-only projection from one DSH session log to the Stage 4B panel. */

const TOOL_NAME = 'phone_execution'
const MAX_EXECUTIONS = 8
const MAX_EVENTS = 12
const V1_STATUS = new Set(['running', 'waiting_event', 'needs_user_input', 'succeeded', 'failed', 'cancelled'])
const V2_STATUS = new Set([
  'scheduled', 'running', 'waiting_time', 'waiting_event', 'recovering', 'replanning',
  'paused', 'user_takeover', 'needs_user_input', 'succeeded', 'failed', 'cancelled',
])
const ACTIVE = new Set(['scheduled', 'running', 'waiting_time', 'waiting_event', 'recovering', 'replanning', 'paused', 'user_takeover'])

export class AiGamePanelError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AiGamePanelError'
    this.code = code
  }
}

function inert(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,256}$/.test(value)
}

function text(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : null
}

function durablePointer(event) {
  if (event?.type !== 'tool/result' || event.data === null || typeof event.data !== 'object') return null
  const meta = event.data.meta
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)
    || meta.toolName !== TOOL_NAME || !Number.isSafeInteger(meta.eventCursor) || meta.eventCursor < 0
    || !Array.isArray(meta.evidenceRefs)) return null
  const isV1 = meta.schemaVersion === 1 && meta.kind === 'ai-game-execution' && inert(meta.executionId) && V1_STATUS.has(meta.status)
  const isV2 = meta.schemaVersion === 2 && meta.kind === 'ai-game-task' && inert(meta.taskId) && V2_STATUS.has(meta.status)
  if (!isV1 && !isV2) return null
  const callId = event.data.message?.source?.callId
  if (!inert(callId)) return null
  return Object.freeze({
    executionId: isV1 ? meta.executionId : null,
    taskId: isV2 ? meta.taskId : null,
    version: isV2 ? 2 : 1,
    status: meta.status,
    eventCursor: meta.eventCursor,
    evidenceCount: Math.min(meta.evidenceRefs.length, 10_000),
    callId,
    seq: Number.isSafeInteger(event.seq) ? event.seq : -1,
    time: Number.isSafeInteger(event.time) ? event.time : 0,
  })
}

export function collectDurableExecutionPointers(events) {
  const phoneCalls = new Set()
  const latestByExecution = new Map()
  for (const event of Array.isArray(events) ? events : []) {
    if (event?.type === 'tool/call' && inert(event.data?.callId) && event.data?.name === TOOL_NAME) {
      phoneCalls.add(event.data.callId)
      continue
    }
    const pointer = durablePointer(event)
    if (pointer === null || !phoneCalls.has(pointer.callId)) continue
    const key = pointer.version === 2 ? `task:${pointer.taskId}` : `execution:${pointer.executionId}`
    const prior = latestByExecution.get(key)
    if (prior === undefined || prior.seq <= pointer.seq) latestByExecution.set(key, pointer)
  }
  return [...latestByExecution.values()]
    .sort((a, b) => b.seq - a.seq || b.time - a.time || String(b.taskId ?? b.executionId).localeCompare(String(a.taskId ?? a.executionId)))
    .slice(0, MAX_EXECUTIONS)
}

function rank(status) {
  if (status === 'needs_user_input') return 0
  if (ACTIVE.has(status)) return 1
  return 2
}

export function selectExecutionCandidate(candidates) {
  return [...candidates].sort((a, b) => {
    const byRank = rank(a.snapshot?.status ?? a.pointer.status) - rank(b.snapshot?.status ?? b.pointer.status)
    if (byRank !== 0) return byRank
    return b.pointer.seq - a.pointer.seq || b.pointer.time - a.pointer.time
  })[0] ?? null
}

function safeEvidence(items) {
  return items.slice(0, 10).map(item => ({
    evidenceId: item.evidence_id,
    contentType: text(item.content_type, 96) ?? 'application/octet-stream',
    sizeBytes: item.size_bytes,
    availability: 'protected',
  }))
}

function allowedIntents(status) {
  return {
    cancel: status === 'running' || status === 'waiting_event' || status === 'needs_user_input',
    resume: status === 'cancelled',
    answer: status === 'needs_user_input',
  }
}

function safeV2Controls(value) {
  const allowed = new Set(['pause', 'resume', 'cancel', 'takeover', 'release_takeover'])
  return Array.isArray(value) ? value.filter(control => allowed.has(control)).slice(0, 8) : []
}

export function sanitizeAiGameTask(task) {
  return {
    taskId: task.task_id,
    status: task.status,
    goalSummary: text(task.goal?.summary, 500) ?? '',
    currentRevision: task.current_revision,
    reason: { code: text(task.reason?.code, 128) ?? 'TASK_STATUS_UNKNOWN', summary: text(task.reason?.summary, 1_500) ?? '' },
    currentStage: text(task.current?.stage, 240),
    currentAction: text(task.current?.action, 320),
    nextWakeAt: text(task.next_wake_at, 64),
    pendingQuestion: task.pending_question === null || task.pending_question === undefined ? null : {
      questionId: task.pending_question.question_id,
      question: text(task.pending_question.question, 1_200) ?? '',
      whyNeeded: text(task.pending_question.why_needed, 600) ?? '',
    },
    resultSummary: text(task.result?.summary, 1_500),
    error: task.error === null || task.error === undefined ? null : { code: text(task.error.code, 128) ?? 'TASK_FAILED' },
    eventCursor: task.event_cursor,
    updatedAt: text(task.timestamps?.updated_at, 64),
    terminalAt: text(task.timestamps?.terminal_at, 64),
    allowedControls: safeV2Controls(task.allowed_controls),
  }
}

export function sanitizeAiGameSnapshot(snapshot) {
  return {
    executionId: snapshot.execution_id,
    status: snapshot.status,
    goalSummary: text(snapshot.goal_summary, 500) ?? '',
    currentStage: text(snapshot.current_stage, 240),
    progress: {
      kind: 'unknown',
      explanation: text(snapshot.progress?.explanation, 320) ?? 'No authoritative numeric progress is available.',
    },
    currentAction: text(snapshot.current_action, 320),
    pendingQuestion: snapshot.pending_question === null || snapshot.pending_question === undefined
      ? null
      : {
          questionId: snapshot.pending_question.question_id,
          question: text(snapshot.pending_question.question, 1_200) ?? '',
          whyNeeded: text(snapshot.pending_question.why_needed, 600) ?? '',
        },
    resultSummary: text(snapshot.result_summary, 1_500),
    error: snapshot.error === null || snapshot.error === undefined
      ? null
      : { code: text(snapshot.error.code, 128) ?? 'EXECUTION_FAILED' },
    evidence: safeEvidence(snapshot.evidence_refs),
    eventCursor: snapshot.event_cursor,
    updatedAt: text(snapshot.timestamps?.updated_at, 64),
    terminalAt: text(snapshot.timestamps?.terminal_at, 64),
    allowedIntents: allowedIntents(snapshot.status),
  }
}

const EVENT_LABELS = {
  'execution.accepted': '执行请求已由 AI-Game 接收',
  'execution.cancel_requested': '已请求取消执行',
  'execution.resume_requested': '已请求恢复执行',
  'execution.question_answered': '待处理问题已获得回答',
  'runtime.event': '设备执行阶段已更新',
}

export function sanitizeAiGameEvents(replay) {
  const seen = new Set()
  return replay.items
    .filter(item => EVENT_LABELS[item.type] !== undefined && !seen.has(item.cursor) && seen.add(item.cursor))
    .slice(-MAX_EVENTS)
    .map(item => ({ cursor: item.cursor, label: EVENT_LABELS[item.type], createdAt: text(item.created_at, 64) }))
}

function sanitizeV2Events(replay) {
  const seen = new Set()
  return replay.items
    .filter(item => /^task\.(accepted|revised|control|waiting|wake|recovery|replan|needs_input|terminal|integrity)/.test(item.type)
      && !seen.has(item.cursor) && seen.add(item.cursor))
    .slice(-MAX_EVENTS)
    .map(item => ({ cursor: item.cursor, label: text(item.summary, 1_500) ?? '任务状态已更新', createdAt: text(item.occurred_at, 64) }))
}

function failureOf(error) {
  const code = inert(error?.code) ? error.code : 'AI_GAME_UNAVAILABLE'
  const unavailable = new Set([
    'AI_GAME_NOT_CONFIGURED', 'AI_GAME_CREDENTIAL_UNAVAILABLE', 'AI_GAME_UNAVAILABLE',
    'AI_GAME_TIMEOUT', 'AI_GAME_RESPONSE_REJECTED', 'EXECUTION_API_NOT_CONFIGURED',
  ])
  return {
    code,
    retryable: error?.retryable === true || unavailable.has(code),
    message: code === 'AI_GAME_NOT_CONFIGURED'
      ? 'AI-Game 尚未配置；官方 DSH 对话不受影响。'
      : code === 'AI_GAME_RESPONSE_REJECTED'
        ? 'AI-Game 返回了不兼容的数据；面板已安全停止更新。'
        : 'AI-Game 当前不可用；历史 DSH 对话仍可读取。',
  }
}

async function inspectCandidate(transport, pointer, signal) {
  try {
    return pointer.version === 2
      ? { pointer, snapshot: await transport.taskDetail(pointer.taskId, signal), failure: null }
      : { pointer, snapshot: await transport.inspect(pointer.executionId, signal), failure: null }
  } catch (error) {
    return { pointer, snapshot: null, failure: failureOf(error) }
  }
}

export async function projectAiGameSessionPanel({
  sessionId, events, transport, requestedExecutionId = null, after = 0, signal,
}) {
  if (!inert(sessionId)) throw new AiGamePanelError('AI_GAME_PANEL_BAD_REQUEST', 'Invalid DSH session identity.')
  if (!Number.isSafeInteger(after) || after < 0) {
    throw new AiGamePanelError('AI_GAME_PANEL_BAD_REQUEST', 'Invalid event cursor.')
  }
  const pointers = collectDurableExecutionPointers(events)
  if (pointers.length === 0) {
    return { schemaVersion: 1, kind: 'ai-game-panel', sessionId, hasExecution: false }
  }
  if (requestedExecutionId !== null && !inert(requestedExecutionId)) {
    throw new AiGamePanelError('AI_GAME_PANEL_BAD_REQUEST', 'Invalid execution identity.')
  }
  const requested = requestedExecutionId === null
    ? null
    : pointers.find(pointer => pointer.executionId === requestedExecutionId || pointer.taskId === requestedExecutionId) ?? null
  if (requestedExecutionId !== null && requested === null) {
    throw new AiGamePanelError('AI_GAME_PANEL_FORBIDDEN', 'Execution does not belong to this DSH session.')
  }
  const candidates = requested === null
    ? await Promise.all(pointers.map(pointer => inspectCandidate(transport, pointer, signal)))
    : [await inspectCandidate(transport, requested, signal)]
  const selected = requested === null ? selectExecutionCandidate(candidates) : candidates[0]
  if (selected === null) throw new AiGamePanelError('AI_GAME_PANEL_UNAVAILABLE', 'No execution can be selected.')

  let replay = { items: [], next_cursor: after }
  let eventsFailure = null
  if (selected.snapshot !== null) {
    try {
      replay = selected.pointer.version === 2
        ? await transport.taskEvents(selected.pointer.taskId, { after, limit: MAX_EVENTS }, signal)
        : await transport.events(selected.pointer.executionId, after, signal)
    } catch (error) {
      eventsFailure = failureOf(error)
    }
  }
  const snapshot = selected.snapshot === null ? null : selected.pointer.version === 2
    ? sanitizeAiGameTask(selected.snapshot)
    : sanitizeAiGameSnapshot(selected.snapshot)
  return {
    schemaVersion: 1,
    kind: 'ai-game-panel',
    sessionId,
    hasExecution: true,
    selectedExecutionId: selected.pointer.executionId,
    selectedTaskId: selected.pointer.taskId,
    availability: snapshot === null ? 'unavailable' : 'ready',
    snapshot,
    durablePointer: {
      executionId: selected.pointer.executionId,
      taskId: selected.pointer.taskId,
      version: selected.pointer.version,
      status: selected.pointer.status,
      eventCursor: selected.pointer.eventCursor,
    },
    history: candidates
      .map(candidate => ({
        executionId: candidate.pointer.executionId,
        taskId: candidate.pointer.taskId,
        status: candidate.snapshot?.status ?? candidate.pointer.status,
        selected: candidate.pointer.version === selected.pointer.version
          && (candidate.pointer.taskId ?? candidate.pointer.executionId) === (selected.pointer.taskId ?? selected.pointer.executionId),
      })),
    events: selected.pointer.version === 2 ? sanitizeV2Events(replay) : sanitizeAiGameEvents(replay),
    nextCursor: replay.next_cursor,
    failure: selected.failure,
    eventsFailure,
  }
}

export const AI_GAME_PANEL_TOOL_NAME = TOOL_NAME
