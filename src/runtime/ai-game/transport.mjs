/** Narrow loopback transport for AI-Game execution contracts v1 and v2. */

import { createHash } from 'node:crypto'

const CLIENT_ID = 'weftmate-harness-v1'
const MAX_JSON_BYTES = 1024 * 1024
const MAX_FRAME_BYTES = 8 * 1024 * 1024
const V1_TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'needs_user_input'])
const STATUSES = new Set([
  'running', 'waiting_event', 'needs_user_input', 'succeeded', 'failed', 'cancelled',
])
export const AI_GAME_V2_STATUSES = new Set([
  'scheduled', 'running', 'waiting_time', 'waiting_event', 'recovering', 'replanning',
  'paused', 'user_takeover', 'needs_user_input', 'succeeded', 'failed', 'cancelled',
])
export const AI_GAME_V2_TERMINAL = new Set(['succeeded', 'failed', 'cancelled'])
export const AI_GAME_GENERAL_RUNNER_KIND = 'android_ui_agent'
export const AI_GAME_GENERAL_RUNNER_VERSION = '1'
const V2_CONTROLS = new Set(['pause', 'resume', 'cancel', 'takeover', 'release_takeover'])
const MAX_PAGE_SIZE = 100
const MAX_TEXT = 8_192

export class AiGameTransportError extends Error {
  constructor(code, message, { retryable = false } = {}) {
    super(`${code}: ${message}`)
    this.name = 'AiGameTransportError'
    this.code = code
    this.retryable = retryable
  }
}

export function parseAiGameOrigin(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AiGameTransportError('AI_GAME_NOT_CONFIGURED', 'AI-Game local origin is not configured.')
  }
  let url
  try { url = new URL(value.trim()) } catch {
    throw new AiGameTransportError('AI_GAME_ORIGIN_REJECTED', 'AI-Game origin is invalid.')
  }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1'
    || url.username !== '' || url.password !== '' || url.pathname !== '/'
    || url.search !== '' || url.hash !== '' || url.port === '') {
    throw new AiGameTransportError(
      'AI_GAME_ORIGIN_REJECTED',
      'AI-Game origin must be an explicit 127.0.0.1 HTTP origin.',
    )
  }
  const port = Number(url.port)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new AiGameTransportError('AI_GAME_ORIGIN_REJECTED', 'AI-Game origin port is outside the allowed range.')
  }
  return url.origin
}

export class AiGameTransport {
  constructor({
    origin, resolveToken, resolvePrincipalId, resolveControllerId, resolveManagedState, resolveManagedOrigin,
    fetchImpl = globalThis.fetch, timeoutMs = 30_000,
  } = {}) {
    if (origin !== undefined && (resolveManagedState !== undefined || resolveManagedOrigin !== undefined)) {
      throw new TypeError('origin and managed origin resolvers are mutually exclusive')
    }
    this.origin = origin === undefined ? null : parseAiGameOrigin(origin)
    if (typeof resolveToken !== 'function') throw new TypeError('resolveToken must be a function')
    if (resolvePrincipalId !== undefined && typeof resolvePrincipalId !== 'function') throw new TypeError('resolvePrincipalId must be a function')
    if (resolveControllerId !== undefined && typeof resolveControllerId !== 'function') throw new TypeError('resolveControllerId must be a function')
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function')
    if (resolveManagedState !== undefined && typeof resolveManagedState !== 'function') throw new TypeError('resolveManagedState must be a function')
    if (resolveManagedOrigin !== undefined && typeof resolveManagedOrigin !== 'function') throw new TypeError('resolveManagedOrigin must be a function')
    this.resolveToken = resolveToken
    this.resolvePrincipalId = resolvePrincipalId
    this.resolveControllerId = resolveControllerId
    this.resolveManagedState = resolveManagedState
    this.resolveManagedOrigin = resolveManagedOrigin
    this.fetchImpl = fetchImpl
    this.timeoutMs = timeoutMs
  }

  health(signal) { return this.#json('GET', '/api/execution/v1/health', undefined, signal, validateHealth) }
  submit(payload, signal) { return this.#json('POST', '/api/execution/v1/executions:submit', payload, signal, validateSnapshot) }
  lookup(identity, signal) {
    return this.#json('POST', '/api/execution/v1/executions:lookup', { identity }, signal, validateLookup)
  }
  inspect(executionId, signal) {
    return this.#json('GET', `/api/execution/v1/executions/${segment(executionId)}`, undefined, signal, validateSnapshot)
  }
  events(executionId, after, signal) {
    return this.#json(
      'GET', `/api/execution/v1/executions/${segment(executionId)}/events?after=${cursor(after)}&limit=100`,
      undefined, signal, validateEvents,
    )
  }
  cancel(executionId, idempotencyKey, signal) {
    return this.#json(
      'POST', `/api/execution/v1/executions/${segment(executionId)}:cancel`,
      { idempotency_key: inert(idempotencyKey, 'idempotency key') }, signal, validateSnapshot,
    )
  }
  resume(executionId, idempotencyKey, signal) {
    return this.#json(
      'POST', `/api/execution/v1/executions/${segment(executionId)}:resume`,
      { idempotency_key: inert(idempotencyKey, 'idempotency key') }, signal, validateSnapshot,
    )
  }
  answer(executionId, questionId, value, idempotencyKey, signal) {
    return this.#json(
      'POST', `/api/execution/v1/executions/${segment(executionId)}:answer`,
      {
        question_id: inert(questionId, 'question id'),
        value,
        idempotency_key: inert(idempotencyKey, 'idempotency key'),
      }, signal, validateSnapshot,
    )
  }

  // v2 is intentionally separate from the frozen v1 execution routes.  These
  // methods are the only AI-GAME product surface the host is allowed to use.
  createTask(payload, signal) {
    return this.#json('POST', '/api/execution/v2/tasks', validateV2CreateTaskRequest(payload), signal, validateV2Task, true)
  }
  listTasks({ status = null, cursor: pageCursor = null, limit = 50 } = {}, signal) {
    const query = new URLSearchParams({ limit: String(pageLimit(limit)) })
    if (status !== null) {
      if (!AI_GAME_V2_STATUSES.has(status)) throw new TypeError('task status is invalid')
      query.set('status', status)
    }
    if (pageCursor !== null) query.set('cursor', inert(pageCursor, 'page cursor'))
    return this.#json('GET', `/api/execution/v2/tasks?${query}`, undefined, signal, validateV2TaskList, true)
  }
  taskDetail(taskId, signal) {
    return this.#json('GET', `/api/execution/v2/tasks/${segment(taskId)}`, undefined, signal, validateV2Task, true)
  }
  taskEvents(taskId, { after = 0, limit = 50 } = {}, signal) {
    return this.#json(
      'GET', `/api/execution/v2/tasks/${segment(taskId)}/events?after=${cursor(after)}&limit=${pageLimit(limit)}`,
      undefined, signal, validateV2TaskEvents, true,
    )
  }
  reviseTask(taskId, payload, signal) {
    return this.#json(
      'POST', `/api/execution/v2/tasks/${segment(taskId)}/revisions`, validateV2RevisionRequest(payload), signal, validateV2Task, true,
    )
  }
  controlTask(taskId, payload, signal) {
    return this.#json(
      'POST', `/api/execution/v2/tasks/${segment(taskId)}/controls`, validateV2ControlRequest(payload), signal, validateV2Task, true,
    )
  }
  answerTask(taskId, payload, signal) {
    return this.#json(
      'POST', `/api/execution/v2/tasks/${segment(taskId)}/answers`, validateV2AnswerRequest(payload), signal, validateV2Task, true,
    )
  }
  deviceProfiles(signal) {
    return this.#json('GET', '/api/execution/v2/device-profiles', undefined, signal, validateV2DeviceProfiles, true)
  }
  createDeviceProfile(payload, signal) {
    return this.#json('POST', '/api/execution/v2/device-profiles', validateV2DeviceProfileWrite(payload), signal, validateV2DeviceProfile, true)
  }
  updateDeviceProfile(profileId, payload, signal) {
    return this.#json('PATCH', `/api/execution/v2/device-profiles/${segment(profileId)}`, validateV2DeviceProfileWrite(payload), signal, validateV2DeviceProfile, true)
  }
  verifyDeviceProfile(profileId, payload, signal) {
    return this.#json('POST', `/api/execution/v2/device-profiles/${segment(profileId)}/verify`, validateV2OperationRequest(payload), signal, validateV2DeviceProfile, true)
  }
  discoverEmulators(signal) {
    return this.#json('GET', '/api/execution/v2/device-profiles/discovery', undefined, signal, validateV2Discovery, true)
  }
  async frameMetadata(taskId, signal) {
    const expectedTaskId = inert(taskId, 'task id')
    const metadata = await this.#json('GET', `/api/execution/v2/tasks/${segment(expectedTaskId)}/frame`, undefined, signal, validateV2FrameMetadata, true)
    if (metadata.task_id !== expectedTaskId) rejected()
    return metadata
  }
  frameContent(taskId, metadata, signal) {
    const expectedTaskId = inert(taskId, 'task id')
    const verified = validateV2FrameMetadata(metadata)
    if (verified.task_id !== expectedTaskId) rejected()
    return this.#binary(
      `/api/execution/v2/tasks/${segment(expectedTaskId)}/frames/${segment(verified.frame_id)}`,
      verified, signal,
    )
  }

  async poll(executionId, initial, waitMs, signal) {
    let snapshot = validateSnapshot(initial)
    if (V1_TERMINAL.has(snapshot.status) || waitMs <= 0) return snapshot
    const deadline = Date.now() + Math.min(Math.max(waitMs, 0), 30_000)
    let eventCursor = snapshot.event_cursor
    while (!V1_TERMINAL.has(snapshot.status) && Date.now() < deadline) {
      const remaining = deadline - Date.now()
      await abortableDelay(Math.min(500, remaining), signal)
      const replay = await this.events(executionId, eventCursor, signal)
      eventCursor = Math.max(eventCursor, replay.next_cursor)
      snapshot = await this.inspect(executionId, signal)
    }
    return snapshot
  }

  async #json(method, path, body, callerSignal, validate, requiresOwner = false) {
    const origin = await this.#currentOrigin()
    const token = await this.resolveToken()
    if (typeof token !== 'string' || token.length < 16) {
      throw new AiGameTransportError('AI_GAME_CREDENTIAL_UNAVAILABLE', 'AI-Game capability credential is unavailable.')
    }
    const owner = requiresOwner ? await this.#ownerIdentity() : null
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('timeout')), this.timeoutMs)
    timer.unref?.()
    const onAbort = () => controller.abort(callerSignal?.reason)
    callerSignal?.addEventListener('abort', onAbort, { once: true })
    try {
      const response = await this.fetchImpl(`${origin}${path}`, {
        method,
        signal: controller.signal,
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-AI-Game-Client': CLIENT_ID,
          Authorization: `Bearer ${token}`,
          ...(owner === null ? {} : {
            'X-AI-Game-Principal-Id': owner.principalId,
            'X-AI-Game-Controller-Id': owner.controllerId,
          }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      const text = await response.text()
      if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) {
        throw new AiGameTransportError('AI_GAME_RESPONSE_REJECTED', 'AI-Game response exceeded the safe size limit.')
      }
      let decoded
      try { decoded = text === '' ? null : JSON.parse(text) } catch {
        throw new AiGameTransportError('AI_GAME_RESPONSE_REJECTED', 'AI-Game returned invalid JSON.')
      }
      if (!response.ok) {
        const code = safeErrorCode(decoded) ?? 'AI_GAME_REQUEST_FAILED'
        throw new AiGameTransportError(code, publicErrorMessage(code), { retryable: response.status >= 500 })
      }
      return validate(decoded)
    } catch (error) {
      if (error instanceof AiGameTransportError) throw error
      if (callerSignal?.aborted) {
        throw new AiGameTransportError('AI_GAME_CALL_ABORTED', 'The DSH turn stopped the AI-Game request.')
      }
      if (controller.signal.aborted) {
        throw new AiGameTransportError('AI_GAME_TIMEOUT', 'AI-Game did not respond within the bounded timeout.', { retryable: true })
      }
      throw new AiGameTransportError('AI_GAME_UNAVAILABLE', 'AI-Game is unavailable on the configured local origin.', { retryable: true })
    } finally {
      clearTimeout(timer)
      callerSignal?.removeEventListener('abort', onAbort)
    }
  }

  async #binary(path, metadata, callerSignal) {
    const origin = await this.#currentOrigin()
    const token = await this.resolveToken()
    if (typeof token !== 'string' || token.length < 16) {
      throw new AiGameTransportError('AI_GAME_CREDENTIAL_UNAVAILABLE', 'AI-Game capability credential is unavailable.')
    }
    const owner = await this.#ownerIdentity()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('timeout')), this.timeoutMs)
    timer.unref?.()
    const onAbort = () => controller.abort(callerSignal?.reason)
    callerSignal?.addEventListener('abort', onAbort, { once: true })
    try {
      const response = await this.fetchImpl(`${origin}${path}`, {
        method: 'GET', signal: controller.signal, redirect: 'error', headers: {
          Accept: 'image/png', 'X-AI-Game-Client': CLIENT_ID,
          Authorization: `Bearer ${token}`,
          'X-AI-Game-Principal-Id': owner.principalId,
          'X-AI-Game-Controller-Id': owner.controllerId,
        },
      })
      if (!response.ok) {
        throw new AiGameTransportError('FRAME_UNAVAILABLE', 'The verified task frame is unavailable.', { retryable: response.status >= 500 })
      }
      if ((response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase() !== 'image/png') {
        throw new AiGameTransportError('AI_GAME_RESPONSE_REJECTED', 'AI-Game returned an invalid frame content type.')
      }
      const content = Buffer.from(await response.arrayBuffer())
      if (content.length < 8 || content.length > MAX_FRAME_BYTES
        || content.length !== metadata.size_bytes
        || createHash('sha256').update(content).digest('hex') !== metadata.sha256
        || !content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        throw new AiGameTransportError('AI_GAME_RESPONSE_REJECTED', 'AI-Game returned an invalid verified frame.')
      }
      return content
    } catch (error) {
      if (error instanceof AiGameTransportError) throw error
      if (callerSignal?.aborted) throw new AiGameTransportError('AI_GAME_CALL_ABORTED', 'The DSH turn stopped the AI-Game request.')
      if (controller.signal.aborted) throw new AiGameTransportError('AI_GAME_TIMEOUT', 'AI-Game did not respond within the bounded timeout.', { retryable: true })
      throw new AiGameTransportError('AI_GAME_UNAVAILABLE', 'AI-Game is unavailable on the configured local origin.', { retryable: true })
    } finally {
      clearTimeout(timer)
      callerSignal?.removeEventListener('abort', onAbort)
    }
  }

  async #ownerIdentity() {
    const principalId = await this.resolvePrincipalId?.()
    const controllerId = await this.resolveControllerId?.()
    if (!inertOrFalse(principalId) || !inertOrFalse(controllerId)) {
      throw new AiGameTransportError('AI_GAME_OWNER_UNAVAILABLE', 'AI-Game installation identity is unavailable.')
    }
    return { principalId, controllerId }
  }

  async #currentOrigin() {
    if (typeof this.resolveManagedState !== 'function' || typeof this.resolveManagedOrigin !== 'function') {
      if (this.origin === null) throw new AiGameTransportError('AI_GAME_NOT_CONFIGURED', 'AI-Game local origin is not configured.')
      return this.origin
    }
    const state = await this.resolveManagedState()
    if (state !== 'ready') {
      throw new AiGameTransportError('AI_GAME_UNAVAILABLE', 'AI-Game managed runtime is not ready.', { retryable: state === 'starting' || state === 'recovering' || state === 'needs_setup' })
    }
    const origin = await this.resolveManagedOrigin()
    try { return parseAiGameOrigin(origin) } catch (error) {
      if (error instanceof AiGameTransportError) throw new AiGameTransportError('AI_GAME_UNAVAILABLE', 'AI-Game managed runtime is unavailable.', { retryable: true })
      throw error
    }
  }
}

function validateHealth(value) {
  record(value, 'health')
  if (value.status !== 'ready' || typeof value.version !== 'string') rejected()
  record(value.capabilities, 'capabilities')
  return value
}

function validateLookup(value) {
  record(value, 'lookup')
  if (typeof value.found !== 'boolean') rejected()
  if (value.found) return { found: true, execution: validateSnapshot(value.execution) }
  if (value.execution !== null) rejected()
  return { found: false, execution: null }
}

export function validateSnapshot(value) {
  record(value, 'snapshot')
  if (!inertOrFalse(value.execution_id) || !STATUSES.has(value.status)
    || typeof value.goal_summary !== 'string' || !Number.isSafeInteger(value.event_cursor)
    || value.event_cursor < 0 || !Array.isArray(value.evidence_refs)
    || (value.current_stage !== null && typeof value.current_stage !== 'string')
    || (value.current_action !== null && typeof value.current_action !== 'string')
    || (value.result_summary !== null && typeof value.result_summary !== 'string')) rejected()
  record(value.progress, 'progress')
  if (value.progress.kind !== 'unknown' || value.progress.completed !== null
    || value.progress.total !== null || typeof value.progress.explanation !== 'string') rejected()
  record(value.timestamps, 'timestamps')
  if (typeof value.timestamps.created_at !== 'string'
    || typeof value.timestamps.updated_at !== 'string'
    || (value.timestamps.terminal_at !== null && typeof value.timestamps.terminal_at !== 'string')) rejected()
  record(value.internal_pointer, 'internal pointer')
  for (const key of ['session_id', 'goal_id', 'task_id']) {
    if (value.internal_pointer[key] !== null && !inertOrFalse(value.internal_pointer[key])) rejected()
  }
  for (const evidence of value.evidence_refs) validateEvidence(evidence)
  if (value.pending_question !== null && value.pending_question !== undefined) {
    record(value.pending_question, 'pending question')
    if (!inertOrFalse(value.pending_question.question_id)
      || typeof value.pending_question.question !== 'string'
      || typeof value.pending_question.why_needed !== 'string') rejected()
  }
  if (value.error !== null && value.error !== undefined) {
    record(value.error, 'error')
    if (!inertOrFalse(value.error.code)) rejected()
  }
  return value
}

export function validateV2Task(value) {
  record(value, 'v2 task')
  for (const forbidden of ['runner_kind', 'runner_version']) {
    if (Object.hasOwn(value, forbidden)) rejected()
  }
  if (value.schema_version !== 2 || !inertOrFalse(value.task_id) || !AI_GAME_V2_STATUSES.has(value.status)
    || !Number.isSafeInteger(value.current_revision) || value.current_revision < 0
    || !isSafeText(value.goal?.summary, 1, 1_500) || !isRecord(value.reason)
    || !inertOrFalse(value.reason.code) || !isSafeText(value.reason.summary, 0, 1_500)
    || (value.next_wake_at !== null && !isSafeText(value.next_wake_at, 1, 64))
    || !Number.isSafeInteger(value.event_cursor) || value.event_cursor < 0
    || !isRecord(value.timestamps) || !isSafeText(value.timestamps.created_at, 1, 64)
    || !isSafeText(value.timestamps.updated_at, 1, 64)
    || (value.timestamps.terminal_at !== null && !isSafeText(value.timestamps.terminal_at, 1, 64))
    || (value.archived !== undefined && typeof value.archived !== 'boolean')) rejected()
  if (value.error !== null && value.error !== undefined) validateV2SafeError(value.error)
  if (value.result !== null && value.result !== undefined) validateV2Result(value.result)
  const pendingQuestion = value.pending_question === null || value.pending_question === undefined
    ? null
    : validateV2Question(value.pending_question)
  if (!Array.isArray(value.allowed_controls) || value.allowed_controls.length > 8
    || value.allowed_controls.some(control => !V2_CONTROLS.has(control))) rejected()
  if (value.origin !== undefined) validateV2Origin(value.origin)
  const device = value.device === undefined || value.device === null
    ? null
    : validateV2DeviceProjection(value.device)
  // The question is model-visible tool output.  Rebuild it from the exact
  // protocol allowlist so an upstream field can never ride through validation.
  // The device projection follows the same rule and retains no transport or
  // emulator-control facts.
  return { ...value, pending_question: pendingQuestion, device }
}

export function validateV2TaskList(value) {
  record(value, 'v2 task list')
  if (!Array.isArray(value.items) || value.items.length > MAX_PAGE_SIZE
    || (value.next_cursor !== null && !inertOrFalse(value.next_cursor))) rejected()
  const items = value.items.map(item => validateV2Task(item))
  return { ...value, items }
}

export function validateV2TaskEvents(value) {
  record(value, 'v2 task events')
  if (!Array.isArray(value.items) || value.items.length > MAX_PAGE_SIZE
    || !Number.isSafeInteger(value.next_cursor) || value.next_cursor < 0) rejected()
  let prior = -1
  for (const event of value.items) {
    record(event, 'v2 task event')
    if (event.schema_version !== 2 || !inertOrFalse(event.event_id) || !inertOrFalse(event.task_id)
      || !Number.isSafeInteger(event.cursor) || event.cursor < 1 || event.cursor <= prior
      || !isSafeText(event.type, 1, 128) || !isSafeText(event.occurred_at, 1, 64)
      || !isSafeText(event.summary, 0, 1_500)
      || (event.reason_code !== null && !inertOrFalse(event.reason_code))) rejected()
    prior = event.cursor
  }
  return value
}

export function validateV2DeviceProfile(value) {
  record(value, 'v2 device profile')
  if (value.schema_version !== 2 || !inertOrFalse(value.device_profile_id)
    || !Number.isSafeInteger(value.revision) || value.revision < 0
    || !isSafeText(value.display_name, 1, 80) || value.kind !== 'android_emulator'
    || !['ready', 'offline', 'drifted', 'disabled', 'connected', 'disconnected', 'unavailable'].includes(value.state)
    || typeof value.is_default !== 'boolean') rejected()
  if (value.capabilities !== undefined) {
    record(value.capabilities, 'v2 device capabilities')
    if (!Array.isArray(value.capabilities.features) || value.capabilities.features.length > 32
      || value.capabilities.features.some(feature => !isSafeText(feature, 1, 64))) rejected()
  }
  // These fields are host-only upstream facts.  Receiving them proves that the
  // contract drifted, so fail closed before a renderer projection is possible.
  for (const forbidden of ['canonical_device_id', 'transport', 'serial', 'adb_path', 'artifact_path']) {
    if (Object.hasOwn(value, forbidden)) rejected()
  }
  return value
}

export function validateV2DeviceProfiles(value) {
  record(value, 'v2 device profile list')
  if (!Array.isArray(value.items) || value.items.length > MAX_PAGE_SIZE) rejected()
  for (const item of value.items) validateV2DeviceProfile(item)
  return value
}

function validateV2CreateTaskRequest(value) {
  record(value, 'v2 task create request')
  if (!isSafeText(value.goal?.summary, 1, 1_500) || !isRecord(value.identity)
    || value.runner_kind !== AI_GAME_GENERAL_RUNNER_KIND
    || !isSafeText(value.idempotency_key, 1, 256) || !['full-access', 'allowed-once'].includes(value.authorization_mode)) {
    throw new TypeError('v2 task create request is invalid')
  }
  validateIdentity(value.identity)
  return {
    origin: value.identity,
    goal: {
      summary: value.goal.summary,
      task_kind: value.goal.task_kind ?? 'bounded',
      stop_condition: isRecord(value.goal.stop_condition) ? value.goal.stop_condition : {},
      schedule: isRecord(value.goal.schedule) ? value.goal.schedule : null,
    },
    client_request_id: inert(value.client_request_id ?? value.idempotency_key, 'client request id'),
    idempotency_key: inert(value.idempotency_key, 'idempotency key'),
    runner_kind: AI_GAME_GENERAL_RUNNER_KIND,
    priority: Number.isSafeInteger(value.priority) ? value.priority : 50,
    ...(value.device_profile_id === undefined || value.device_profile_id === null ? {} : { device_profile_id: inert(value.device_profile_id, 'device profile id') }),
    authorization_mode: value.authorization_mode,
  }
}
function validateV2RevisionRequest(value) {
  record(value, 'v2 revision request')
  if (!Number.isSafeInteger(value.base_revision) || value.base_revision < 0
    || !['add', 'revise', 'reprioritize', 'reschedule', 'change_stop_condition'].includes(value.kind)
    || !isSafeText(value.instruction, 1, MAX_TEXT) || !isSafeText(value.idempotency_key, 1, 256)
    || !isRecord(value.identity) || !isAuthorizationMode(value.authorization_mode)) {
    throw new TypeError('v2 revision request is invalid')
  }
  validateIdentity(value.identity)
  return {
    origin: value.identity,
    revision_id: inert(value.revision_id ?? value.idempotency_key, 'revision id'),
    idempotency_key: inert(value.idempotency_key, 'idempotency key'),
    base_revision: value.base_revision,
    kind: value.kind,
    instruction: value.instruction,
    effective_boundary: value.effective_boundary ?? 'after_current_action',
    authorization_mode: value.authorization_mode,
  }
}
function validateV2ControlRequest(value) {
  record(value, 'v2 control request')
  if (!V2_CONTROLS.has(value.action) || !Number.isSafeInteger(value.expected_revision) || value.expected_revision < 0
    || !isSafeText(value.idempotency_key, 1, 256) || !isRecord(value.identity)
    || !isAuthorizationMode(value.authorization_mode)) throw new TypeError('v2 control request is invalid')
  validateIdentity(value.identity)
  return {
    origin: value.identity,
    control_id: inert(value.control_id ?? value.idempotency_key, 'control id'),
    idempotency_key: inert(value.idempotency_key, 'idempotency key'),
    expected_revision: value.expected_revision,
    action: value.action,
    authorization_mode: value.authorization_mode,
  }
}
function validateV2AnswerRequest(value) {
  record(value, 'v2 answer request')
  if (!inertOrFalse(value.question_id) || !isSafeText(value.answer, 1, MAX_TEXT)
    || !isSafeText(value.idempotency_key, 1, 256) || !isRecord(value.identity)
    || !isAuthorizationMode(value.authorization_mode)) throw new TypeError('v2 answer request is invalid')
  validateIdentity(value.identity)
  return {
    origin: value.identity,
    question_id: value.question_id,
    idempotency_key: inert(value.idempotency_key, 'idempotency key'),
    value: value.answer,
    authorization_mode: value.authorization_mode,
  }
}
function validateV2DeviceProfileWrite(value) {
  record(value, 'v2 device profile write request')
  if (!isSafeText(value.idempotency_key, 1, 256)) throw new TypeError('v2 device profile request is invalid')
  for (const forbidden of ['canonical_device_id', 'serial', 'adb_path', 'transport', 'token']) {
    if (Object.hasOwn(value, forbidden)) throw new TypeError('v2 device profile request is invalid')
  }
  const operation = inert(value.idempotency_key, 'idempotency key')
  const profile = value.candidate_id !== undefined
    ? {
        candidate_id: inert(value.candidate_id, 'candidate id'),
        display_name: isSafeText(value.display_name, 1, 80) ? value.display_name : 'Android emulator',
        is_default: value.is_default === true,
      }
    : value.display_name !== undefined
      ? {
          action: 'rename', display_name: value.display_name,
          expected_revision: value.expected_revision,
        }
      : { action: value.action }
  if (profile.action === 'rename'
    && (!isSafeText(profile.display_name, 1, 80) || !Number.isSafeInteger(profile.expected_revision) || profile.expected_revision < 1)) {
    throw new TypeError('v2 device profile request is invalid')
  }
  if (profile.action !== undefined && !['rename', 'set_default', 'disable'].includes(profile.action)) {
    throw new TypeError('v2 device profile request is invalid')
  }
  return { idempotency_key: operation, profile }
}
function validateV2OperationRequest(value) {
  record(value, 'v2 operation request')
  if (!isSafeText(value.idempotency_key, 1, 256)) throw new TypeError('v2 operation request is invalid')
  const operation = inert(value.idempotency_key, 'idempotency key')
  return { idempotency_key: operation, profile: {} }
}

export function validateV2Discovery(value) {
  record(value, 'v2 emulator discovery')
  if (!Array.isArray(value.items) || value.items.length > MAX_PAGE_SIZE
    || !Number.isSafeInteger(value.expires_in_seconds) || value.expires_in_seconds < 1) rejected()
  for (const item of value.items) {
    record(item, 'v2 emulator candidate')
    if (!inertOrFalse(item.candidate_id) || !isSafeText(item.display_name, 1, 80)
      || item.kind !== 'android_emulator' || item.state !== 'ready') rejected()
    for (const forbidden of ['serial', 'adb_path', 'transport', 'address', 'command']) {
      if (Object.hasOwn(item, forbidden)) rejected()
    }
  }
  return value
}

export function validateV2FrameMetadata(value) {
  record(value, 'v2 frame metadata')
  if (value.schema_version !== 2 || !inertOrFalse(value.frame_id)
    || !inertOrFalse(value.task_id) || !inertOrFalse(value.device_profile_id)
    || value.content_type !== 'image/png' || !Number.isSafeInteger(value.size_bytes)
    || value.size_bytes < 8 || value.size_bytes > MAX_FRAME_BYTES
    || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)
    || !Number.isSafeInteger(value.width) || value.width < 1
    || !Number.isSafeInteger(value.height) || value.height < 1
    || !isSafeText(value.captured_at, 1, 64)) rejected()
  for (const forbidden of ['reference', 'artifact_ref', 'artifact_path', 'path', 'serial']) {
    if (Object.hasOwn(value, forbidden)) rejected()
  }
  return value
}
function validateIdentity(value) {
  for (const key of ['dsh_session_id', 'tool_call_id', 'root_call_id']) if (!inertOrFalse(value[key])) throw new TypeError('v2 DSH identity is invalid')
  if (!Number.isSafeInteger(value.dsh_turn_id) || value.dsh_turn_id < 0) throw new TypeError('v2 DSH identity is invalid')
}
function validateV2Origin(value) {
  record(value, 'v2 task origin')
  for (const forbidden of ['runner_kind', 'runner_version']) {
    if (Object.hasOwn(value, forbidden)) rejected()
  }
  for (const key of ['dsh_session_id', 'created_execution_id', 'created_tool_call_id', 'root_call_id']) {
    if (value[key] !== undefined && !inertOrFalse(value[key])) rejected()
  }
}
function validateV2DeviceProjection(value) {
  record(value, 'v2 task device')
  if (!inertOrFalse(value.profile_id) || !isSafeText(value.display_name, 0, 80)
    || !isSafeText(value.state, 1, 64)) rejected()
  for (const forbidden of ['canonical_device_id', 'serial', 'adb_path', 'artifact_path', 'transport']) {
    if (Object.hasOwn(value, forbidden)) rejected()
  }
  return {
    profile_id: value.profile_id,
    display_name: value.display_name,
    state: value.state,
  }
}
function validateV2SafeError(value) {
  record(value, 'v2 task error')
  if (!inertOrFalse(value.code) || !isSafeText(value.summary, 0, 1_500)) rejected()
}
function validateV2Result(value) {
  record(value, 'v2 task result')
  if (!isSafeText(value.summary, 0, 1_500)) rejected()
}
function validateV2Question(value) {
  record(value, 'v2 task question')
  if (!inertOrFalse(value.question_id) || !isSafeText(value.question, 1, 1_500)
    || !isSafeText(value.why_needed, 1, 1_500)) rejected()
  return {
    question_id: value.question_id,
    question: value.question,
    why_needed: value.why_needed,
  }
}

function validateEvidence(value) {
  record(value, 'evidence')
  if (!inertOrFalse(value.evidence_id) || typeof value.content_type !== 'string'
    || !Number.isSafeInteger(value.size_bytes) || value.size_bytes < 1
    || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)
    || typeof value.read_path !== 'string'
    || !value.read_path.startsWith('/api/execution/v1/executions/')) rejected()
  record(value.provenance, 'evidence provenance')
  for (const key of [
    'canonical_device_id', 'companion_install_id', 'boot_id',
    'kernel_action_id', 'command_id', 'caused_by_command_id', 'adapter_id',
  ]) if (!inertOrFalse(value.provenance[key])) rejected()
  if (value.provenance.adapter_id !== 'android-companion-v1'
    || !Number.isSafeInteger(value.provenance.connection_epoch)
    || value.provenance.connection_epoch < 1
    || value.provenance.physical_execution_count !== 1
    || value.provenance.command_id !== value.provenance.caused_by_command_id) rejected()
}

function validateEvents(value) {
  record(value, 'events')
  if (!Array.isArray(value.items) || !Number.isSafeInteger(value.next_cursor)
    || value.next_cursor < 0 || value.count !== value.items.length) rejected()
  for (const event of value.items) {
    record(event, 'event')
    if (!Number.isSafeInteger(event.cursor) || event.cursor < 1
      || typeof event.type !== 'string' || typeof event.created_at !== 'string') rejected()
  }
  return value
}

function record(value, label) {
  if (!isRecord(value)) {
    throw new AiGameTransportError('AI_GAME_RESPONSE_REJECTED', `AI-Game ${label} response failed schema validation.`)
  }
}
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function rejected() { throw new AiGameTransportError('AI_GAME_RESPONSE_REJECTED', 'AI-Game response failed schema validation.') }
function inertOrFalse(value) { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,256}$/.test(value) }
function inert(value, label) {
  if (!inertOrFalse(value)) throw new TypeError(`${label} is invalid`)
  return value
}
function segment(value) { return encodeURIComponent(inert(value, 'execution identity')) }
function cursor(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('event cursor is invalid')
  return String(value)
}
function pageLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGE_SIZE) throw new TypeError('page limit is invalid')
  return value
}
function isAuthorizationMode(value) { return value === 'full-access' || value === 'allowed-once' }
function isSafeText(value, min, max) { return typeof value === 'string' && value.length >= min && value.length <= max }
function safeErrorCode(value) {
  const code = value?.error?.code
  return inertOrFalse(code) ? code.toUpperCase() : null
}
function publicErrorMessage(code) {
  return {
    EXECUTION_API_NOT_CONFIGURED: 'AI-Game execution capability is not configured.',
    EXECUTION_CLIENT_UNAUTHORIZED: 'AI-Game rejected the local client capability.',
    EXECUTION_PRINCIPAL_FORBIDDEN: 'AI-Game rejected this installation identity for the task.',
    EXECUTION_IDEMPOTENCY_CONFLICT: 'The DSH tool identity conflicts with a prior request.',
    EXECUTION_NOT_FOUND: 'The AI-Game execution was not found.',
    DEVICE_NOT_AVAILABLE: 'No authorized phone is currently available.',
    CAPABILITY_UNAVAILABLE: 'The requested phone capability is unavailable.',
  }[code] ?? 'AI-Game could not complete the execution request.'
}
function abortableDelay(ms, signal) {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return }
    const finish = () => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    const abort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(signal.reason)
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export const AI_GAME_CLIENT_ID = CLIENT_ID
