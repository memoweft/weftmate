/** Official DSH host tool seam for the AI-Game phone execution service. */

import { createHash, randomUUID } from 'node:crypto'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  AI_GAME_GENERAL_RUNNER_KIND,
  AI_GAME_GENERAL_RUNNER_VERSION,
  AI_GAME_V2_TERMINAL,
  AiGameTransport,
  AiGameTransportError,
} from '../runtime/ai-game/transport.mjs'
import { AiGamePanelError, projectAiGameSessionPanel, collectDurableExecutionPointers } from '../runtime/ai-game/panel.mjs'

export const name = 'weftmate-aigame-host'
export const inject = ['tools', 'approval', 'credentials']
export const AI_GAME_TOOL_NAME = 'phone_execution'
export { AI_GAME_GENERAL_RUNNER_KIND, AI_GAME_GENERAL_RUNNER_VERSION }
export const AI_GAME_CREDENTIAL_REF = 'WEFTMATE_AI_GAME_CAPABILITY_TOKEN'
// Non-secret installation identities. They remain host-only so a renderer
// cannot select another capability owner by forging a request.
export const AI_GAME_PRINCIPAL_REF = 'WEFTMATE_AI_GAME_PRINCIPAL_ID'
export const AI_GAME_CONTROLLER_REF = 'WEFTMATE_AI_GAME_CONTROLLER_ID'
export const AI_GAME_MANAGED_STATE_REF = 'WEFTMATE_AI_GAME_MANAGED_STATE'
export const AI_GAME_MANAGED_ORIGIN_REF = 'WEFTMATE_AI_GAME_MANAGED_ORIGIN'

const EFFECTS = new Set(['submit', 'cancel', 'resume', 'answer', 'revise', 'control'])
const V1_TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'needs_user_input'])
const V2_NONTERMINAL = new Set([
  'scheduled', 'running', 'waiting_time', 'waiting_event', 'recovering', 'replanning',
  'paused', 'user_takeover', 'needs_user_input',
])
const HANDOFF_POLL_MS = 1_000

function toolError(code, message) {
  const error = new Error(`${code}: ${message}`)
  error.code = code
  return error
}

export function callIdentity(exec) {
  const agent = exec.agent
  if (agent === undefined || agent.session === undefined) {
    throw toolError('AI_GAME_CALLER_UNAVAILABLE', 'The phone tool requires an owning DSH session.')
  }
  const session = agent.session
  const matchingCall = session.events.findLast?.((event) => (
    event.type === 'tool/call' && event.data?.callId === exec.callId
  ))
  const openTurn = session.events.findLast?.((event) => event.type === 'turn/start')
  const turn = matchingCall?.data?.turn ?? openTurn?.data?.turn
  const sessionId = session.id ?? agent.id
  if (typeof sessionId !== 'string' || sessionId.trim() === ''
    || typeof exec.callId !== 'string' || exec.callId.trim() === ''
    || typeof exec.rootCallId !== 'string' || exec.rootCallId.trim() === '') {
    throw toolError('AI_GAME_CALL_ID_UNAVAILABLE', 'The phone tool requires durable DSH call identities.')
  }
  if (!Number.isSafeInteger(turn) || turn < 0) {
    throw toolError('AI_GAME_TURN_ID_UNAVAILABLE', 'The phone tool requires a durable DSH turn identity.')
  }
  return {
    dsh_session_id: sessionId,
    dsh_turn_id: turn,
    tool_call_id: exec.callId,
    root_call_id: exec.rootCallId,
  }
}

function operationKey(identity, action) {
  return `dsh-${action}-${identity.dsh_turn_id}-${identity.tool_call_id}`
}

export function stableSubmissionKey(identity, principalId, controllerId) {
  if (typeof principalId !== 'string' || principalId === ''
    || typeof controllerId !== 'string' || controllerId === '') {
    throw toolError('AI_GAME_OWNER_UNAVAILABLE', 'AI-Game installation identity is unavailable.')
  }
  const digest = createHash('sha256').update(JSON.stringify([
    principalId,
    controllerId,
    identity.dsh_session_id,
    identity.dsh_turn_id,
    'phone_execution',
    'submit',
  ])).digest('hex')
  return `dsh-submit-v2-${digest}`
}

export function effectivePermissionPreset(session) {
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index]
    if (event.type === 'permission/preset') return event.data?.preset
  }
  return undefined
}

async function requireApproval(ctx, exec, action) {
  if (!EFFECTS.has(action)) return
  if (exec.agent === undefined) throw toolError('AI_GAME_CALLER_UNAVAILABLE', 'Approval requires an owning DSH agent.')
  if (effectivePermissionPreset(exec.agent.session) === 'danger-full-access') return 'full-access'
  const outcome = await ctx.approval.request({
    agent: exec.agent,
    toolName: AI_GAME_TOOL_NAME,
    callId: exec.callId,
    reason: action === 'submit'
      ? 'Create a phone execution with device-side effects in AI-Game.'
      : `${action} an existing AI-Game phone execution.`,
    signal: exec.signal,
  })
  if (outcome !== 'allowed-once') {
    throw toolError(
      outcome === 'cancelled' ? 'AI_GAME_APPROVAL_CANCELLED' : 'AI_GAME_APPROVAL_DENIED',
      'The official DSH approval pipeline did not grant this phone action.',
    )
  }
  return 'allowed-once'
}

function canonical(snapshot, action) {
  return {
    action,
    execution_id: snapshot.execution_id,
    status: snapshot.status,
    goal_summary: snapshot.goal_summary,
    current_stage: snapshot.current_stage ?? null,
    progress_kind: snapshot.progress.kind,
    current_action: snapshot.current_action ?? null,
    pending_question: snapshot.pending_question ?? null,
    result_summary: snapshot.result_summary ?? null,
    evidence_refs: snapshot.evidence_refs,
    event_cursor: snapshot.event_cursor,
    error_code: snapshot.error?.code ?? null,
  }
}

function projectPendingQuestion(value) {
  if (value === null || value === undefined) return null
  return {
    question_id: value.question_id,
    question: value.question,
    why_needed: value.why_needed,
  }
}

function projectDevice(value) {
  if (value === null || value === undefined) return null
  return {
    profile_id: value.profile_id,
    display_name: value.display_name,
    state: value.state,
  }
}

export function canonicalV2(task, action) {
  return {
    action,
    task_id: task.task_id,
    status: task.status,
    goal_summary: task.goal?.summary ?? '',
    current_stage: task.current?.stage ?? null,
    progress_kind: 'unknown',
    current_action: task.current?.action ?? null,
    pending_question: projectPendingQuestion(task.pending_question),
    result_summary: task.result?.summary ?? null,
    evidence_refs: [],
    event_cursor: task.event_cursor,
    error_code: task.error?.code ?? null,
    current_revision: task.current_revision,
    reason_code: task.reason?.code ?? null,
    allowed_controls: task.allowed_controls,
    device: projectDevice(task.device),
  }
}

export function requireAllowedControl(task, action) {
  if (!Array.isArray(task?.allowed_controls) || !task.allowed_controls.includes(action)) {
    throw toolError(
      'AI_GAME_CONTROL_UNAVAILABLE',
      `The authoritative Task state does not currently allow ${action}. Inspect the Task before choosing another action.`,
    )
  }
}

function requireCurrentTask(task, taskId, action) {
  if (task?.task_id !== taskId) {
    throw toolError(
      'AI_GAME_TASK_STATE_UNAVAILABLE',
      `The authoritative Task state could not be confirmed before ${action}.`,
    )
  }
  if (task.archived === true || AI_GAME_V2_TERMINAL.has(task.status)) {
    throw toolError(
      'AI_GAME_TASK_MUTATION_UNAVAILABLE',
      `The authoritative Task state no longer allows ${action}.`,
    )
  }
}

function requireCurrentRevision(task, baseRevision) {
  if (task.current_revision !== baseRevision) {
    throw toolError(
      'AI_GAME_REVISION_CONFLICT',
      `The requested revision is stale. Current revision: ${task.current_revision}. Inspect the Task before retrying the requested control.`,
    )
  }
}

function requirePendingQuestion(task, questionId) {
  if (task.pending_question?.question_id !== questionId) {
    throw toolError(
      'AI_GAME_QUESTION_UNAVAILABLE',
      'The requested question is no longer the authoritative pending Task question.',
    )
  }
}

function handoffMarker(executionId, status, cursor) {
  return `[weftmate-aigame-handoff:${executionId}:${status}:${cursor}]`
}

function hasDurableHandoff(session, marker) {
  return session.events.some((event) => {
    if (event.type !== 'message' && event.type !== 'turn/message' && event.type !== 'user/message') return false
    try { return JSON.stringify(event.data).includes(marker) } catch { return false }
  })
}

function latestDurableExecutions(session) {
  const byExecution = new Map()
  for (const event of session.events) {
    if (event.type !== 'tool/result') continue
    const meta = event.data?.meta
    if (meta?.schemaVersion !== 1 || meta.kind !== 'ai-game-execution'
      || meta.toolName !== AI_GAME_TOOL_NAME || typeof meta.executionId !== 'string') continue
    byExecution.set(meta.executionId, {
      executionId: meta.executionId,
      status: meta.status,
      eventCursor: meta.eventCursor,
    })
  }
  return [...byExecution.values()]
}

export function createAiGameHandoffWatcher({ transport, agent, session, executionId, delay = HANDOFF_POLL_MS }) {
  const controller = new AbortController()
  const run = (async () => {
    while (!controller.signal.aborted) {
      let snapshot
      try {
        snapshot = await transport.inspect(executionId, controller.signal)
      } catch (error) {
        if (controller.signal.aborted) return
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, delay)
          timer.unref?.()
        })
        continue
      }
      if (V1_TERMINAL.has(snapshot.status)) {
        const marker = handoffMarker(snapshot.execution_id, snapshot.status, snapshot.event_cursor)
        if (!hasDurableHandoff(session, marker)) {
          agent.followup(createUserMessage({
            content: [{
              type: 'text',
              text: `${marker}\nAI-Game execution state changed. Call phone_execution with action=inspect and execution_id=${snapshot.execution_id}; use that new durable tool result to continue the original user conversation. Do not treat this plugin notice or the right panel as the execution result.`,
            }],
            source: {
              kind: 'plugin', plugin: name, form: 'notice',
              summary: `AI-Game ${snapshot.status}: inspect ${snapshot.execution_id}`,
            },
          }))
        }
        return
      }
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, delay)
        timer.unref?.()
      })
    }
  })()
  return { abort: () => controller.abort(), run }
}

function latestDurableTasks(session) {
  const byTask = new Map()
  for (const event of session.events) {
    if (event.type !== 'tool/result') continue
    const meta = event.data?.meta
    if (meta?.schemaVersion !== 2 || meta.kind !== 'ai-game-task'
      || meta.toolName !== AI_GAME_TOOL_NAME || typeof meta.taskId !== 'string') continue
    byTask.set(meta.taskId, { taskId: meta.taskId, status: meta.status, eventCursor: meta.eventCursor })
  }
  return [...byTask.values()]
}

function taskNoticeMarker(taskId, status, cursor) {
  return `[weftmate-ai-game-task:${taskId}:${status}:${cursor}]`
}

function taskNoticeKind(task) {
  if (task.integrity?.state === 'blocked') return 'integrity'
  if (task.status === 'needs_user_input') return 'needs input'
  if (AI_GAME_V2_TERMINAL.has(task.status)) return 'terminal'
  return null
}

export function createAiGameTaskWatcher({ transport, agent, session, taskId, delay = HANDOFF_POLL_MS }) {
  const controller = new AbortController()
  const run = (async () => {
    while (!controller.signal.aborted) {
      let task
      try {
        task = await transport.taskDetail(taskId, controller.signal)
      } catch {
        if (controller.signal.aborted) return
        await delayUntilNextPoll(delay, controller.signal)
        continue
      }
      const noticeKind = taskNoticeKind(task)
      if (noticeKind !== null) {
        const marker = taskNoticeMarker(task.task_id, task.status, task.event_cursor)
        if (!hasDurableHandoff(session, marker)) {
          agent.followup(createUserMessage({
            content: [{
              type: 'text',
              text: `${marker}\nAI-Game task requires attention (${noticeKind}). Call phone_execution with action=inspect and task_id=${task.task_id}; use the new durable tool result in the original user conversation.`,
            }],
            source: { kind: 'plugin', plugin: name, form: 'notice', summary: `AI-Game task ${noticeKind}: inspect ${task.task_id}` },
          }))
        }
        // The watcher is intentionally allowed to end for an attention notice.
        // A durable v2 result reconstructs it after an inspect/answer/control.
        return
      }
      if (!V2_NONTERMINAL.has(task.status)) return
      await delayUntilNextPoll(delay, controller.signal)
    }
  })()
  return { abort: () => controller.abort(), run }
}

function delayUntilNextPoll(delay, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, delay)
    timer.unref?.()
    if (signal?.aborted) clearTimeout(timer)
  })
}

export async function abortAiGameExecutionForTurnStop(transport, identity, executionId, { v2 = false } = {}) {
  // A stopped v2 turn owns only its fetch/poll/watcher.  Looking up and
  // cancelling here used to be safe for finite v1 work but is destructive for
  // durable Tasks, so v2 cancellation is exclusively an explicit control.
  if (v2) return { cancelled: false }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2_500)
  timer.unref?.()
  try {
    let target = executionId
    if (target === null) {
      const lookup = await transport.lookup(identity, controller.signal)
      target = lookup.execution?.execution_id ?? null
    }
    if (target !== null) {
      await transport.cancel(target, operationKey(identity, 'turn-stop'), controller.signal)
      return { cancelled: true }
    }
  } catch { /* v1 finite cancellation remains best-effort and replayable. */ }
  finally { clearTimeout(timer) }
  return { cancelled: false }
}

function sendJson(res, status, value) {
  const body = `${JSON.stringify(value)}\n`
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

export function createAiGamePanelHandler({ sessions, transport }) {
  return async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://weftmate.invalid')
    if (req.method === 'POST' && url.pathname === '/weftmate/ai-game/controls.json') {
      try {
        const origin = new URL(`http://${req.headers.host}`)
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) || req.headers.origin !== origin.origin) return sendJson(res, 403, { error: { code: 'AI_GAME_CONTROL_ORIGIN_REJECTED' } })
        let body = ''
        for await (const chunk of req) { body += chunk.toString('utf8'); if (Buffer.byteLength(body) > 8192) throw new TypeError('request too large') }
        const input = JSON.parse(body)
        const session = sessions.get(input.session_id)
        if (!session || !collectDurableExecutionPointers(session.events).some(p => p.taskId === input.task_id)) return sendJson(res, 403, { error: { code: 'AI_GAME_CONTROL_TASK_FORBIDDEN' } })
        if (!['pause', 'cancel', 'resume'].includes(input.action)) throw new TypeError('invalid control')
        const current = await transport.taskDetail(input.task_id)
        requireAllowedControl(current, input.action)
        requireCurrentRevision(current, input.expected_revision)
        const callId = `ui-${randomUUID()}`
        const identity = callIdentity({ agent: { session }, callId, rootCallId: callId })
        const result = await transport.controlTask(input.task_id, { identity, action: input.action, expected_revision: current.current_revision, idempotency_key: callId, authorization_mode: 'allowed-once' })
        return sendJson(res, 200, canonicalV2(result, 'control'))
      } catch (error) { return sendJson(res, 400, { error: { code: error.code ?? 'AI_GAME_CONTROL_FAILED', message: error.message } }) }
    }
    if (url.pathname.startsWith('/weftmate/ai-game/devices')) {
      return handleDeviceSetup(req, res, url, transport)
    }
    if (req.method !== 'GET' || url.pathname !== '/weftmate/ai-game/panel.json') {
      sendJson(res, req.method === 'GET' ? 404 : 405, { error: { code: 'AI_GAME_PANEL_ROUTE_NOT_FOUND' } })
      return
    }
    const sessionId = url.searchParams.get('session_id')
    const executionId = url.searchParams.get('execution_id')
    const afterText = url.searchParams.get('after') ?? '0'
    const after = /^\d{1,15}$/.test(afterText) ? Number(afterText) : Number.NaN
    const session = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined
    if (session === undefined) {
      sendJson(res, 404, { error: { code: 'AI_GAME_PANEL_SESSION_NOT_FOUND' } })
      return
    }
    const controller = new AbortController()
    const abort = () => controller.abort()
    req.once?.('aborted', abort)
    res.once?.('close', abort)
    try {
      const payload = await projectAiGameSessionPanel({
        sessionId,
        events: session.events,
        transport,
        requestedExecutionId: executionId,
        after,
        signal: controller.signal,
      })
      if (!res.writableEnded) sendJson(res, 200, payload)
    } catch (error) {
      if (res.writableEnded || controller.signal.aborted) return
      const status = error instanceof AiGamePanelError
        ? (error.code === 'AI_GAME_PANEL_FORBIDDEN' ? 403 : 400)
        : 503
      sendJson(res, status, {
        error: {
          code: error instanceof AiGamePanelError ? error.code : 'AI_GAME_PANEL_UNAVAILABLE',
          message: 'The AI-Game panel could not load safely.',
        },
      })
    } finally {
      req.removeListener?.('aborted', abort)
      res.removeListener?.('close', abort)
    }
  }
}

function deviceProjection(profile) {
  const connectionState = profile.state === 'ready'
    ? 'connected'
    : profile.state === 'offline'
      ? 'disconnected'
      : 'unknown'
  return {
    device_profile_id: profile.device_profile_id,
    display_name: profile.display_name,
    state: profile.state,
    connection_state: connectionState,
    is_default: profile.is_default,
  }
}

async function handleDeviceSetup(req, res, url, transport) {
  try {
    if (req.method === 'GET' && url.pathname === '/weftmate/ai-game/devices.json') {
      const profiles = await transport.deviceProfiles()
      return sendJson(res, 200, { items: profiles.items.map(deviceProjection) })
    }
    if (req.method === 'GET' && url.pathname === '/weftmate/ai-game/devices/discovery.json') {
      const found = await transport.discoverEmulators()
      return sendJson(res, 200, {
        items: found.items.map(item => ({
          candidate_id: item.candidate_id,
          display_name: item.display_name,
          state: item.state,
          connection_state: item.state === 'ready' ? 'connected' : 'unknown',
        })),
      })
    }
    if (req.method !== 'POST' || url.pathname !== '/weftmate/ai-game/devices/select.json') {
      return sendJson(res, 405, { error: { code: 'PHONE_DEVICE_OPERATION_UNSUPPORTED' } })
    }
    const origin = new URL(`http://${req.headers.host}`)
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) || req.headers.origin !== origin.origin) {
      return sendJson(res, 403, { error: { code: 'PHONE_DEVICE_ORIGIN_REJECTED' } })
    }
    let body = ''
    for await (const chunk of req) {
      body += chunk.toString('utf8')
      if (Buffer.byteLength(body, 'utf8') > 8192) throw new TypeError('invalid device request')
    }
    let input
    try { input = JSON.parse(body) } catch { throw new TypeError('invalid device request') }
    const allowed = ['candidate_id', 'profile_id', 'display_name', 'idempotency_key']
    const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,256}$/.test(value)
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => !allowed.includes(key))
      || !identifier(input.idempotency_key)
      || (Object.hasOwn(input, 'candidate_id') === Object.hasOwn(input, 'profile_id'))
      || !identifier(input.candidate_id ?? input.profile_id)) throw new TypeError('invalid device request')
    const profile = input.profile_id
      ? await transport.updateDeviceProfile(input.profile_id, { action: 'set_default', idempotency_key: input.idempotency_key })
      : await transport.createDeviceProfile({
          candidate_id: input.candidate_id, idempotency_key: input.idempotency_key,
          display_name: typeof input.display_name === 'string' ? input.display_name : 'Android emulator', is_default: true,
        })
    return sendJson(res, 200, { profile: deviceProjection(profile) })
  } catch (error) {
    return sendJson(res, error instanceof TypeError ? 400 : 503, {
      error: { code: error instanceof TypeError ? 'PHONE_DEVICE_REQUEST_INVALID' : 'PHONE_DEVICE_SERVICE_UNAVAILABLE' },
    })
  }
}

export function apply(ctx) {
  const credentials = ctx.credentials
  let transport
  try {
    transport = new AiGameTransport({
      resolveToken: async () => (await credentials.resolve(credentialRef(AI_GAME_CREDENTIAL_REF)))?.value,
      resolvePrincipalId: async () => (await credentials.resolve(credentialRef(AI_GAME_PRINCIPAL_REF)))?.value,
      resolveControllerId: async () => (await credentials.resolve(credentialRef(AI_GAME_CONTROLLER_REF)))?.value,
      resolveManagedState: async () => (await credentials.resolve(credentialRef(AI_GAME_MANAGED_STATE_REF)))?.value,
      resolveManagedOrigin: async () => (await credentials.resolve(credentialRef(AI_GAME_MANAGED_ORIGIN_REF)))?.value,
    })
  } catch (error) {
    // Registration must not block DSH boot. The tool reports its local failure only when called.
    transport = { configurationError: error }
  }
  const watchers = new Map()
  const watch = (agent, session, executionId) => {
    if (transport.configurationError !== undefined || watchers.has(executionId)) return
    const watcher = createAiGameHandoffWatcher({ transport, agent, session, executionId })
    watchers.set(executionId, watcher)
    watcher.run.finally(() => {
      if (watchers.get(executionId) === watcher) watchers.delete(executionId)
    })
  }
  const watchTask = (agent, session, taskId) => {
    const key = `task:${taskId}`
    if (transport.configurationError !== undefined || watchers.has(key)) return
    const watcher = createAiGameTaskWatcher({ transport, agent, session, taskId })
    watchers.set(key, watcher)
    watcher.run.finally(() => {
      if (watchers.get(key) === watcher) watchers.delete(key)
    })
  }

  ctx.inject(['sessions'], (sessionCtx) => {
    sessionCtx.effect(function* () {
      const recover = (agent, session) => {
        for (const pointer of latestDurableExecutions(session)) {
          if (!V1_TERMINAL.has(pointer.status)) watch(agent, session, pointer.executionId)
        }
        for (const pointer of latestDurableTasks(session)) {
          if (!AI_GAME_V2_TERMINAL.has(pointer.status)) watchTask(agent, session, pointer.taskId)
        }
      }
      for (const session of sessionCtx.sessions.list()) {
        const agent = sessionCtx.agents?.get(session.id)
        if (agent === undefined) continue
        recover(agent, session)
      }
      sessionCtx.on('agent/created', ({ agent }) => recover(agent, agent.session))
      sessionCtx.on('session/event', (session, event) => {
        if (event.type !== 'tool/result') return
        const agent = sessionCtx.agents?.get(session.id)
        if (agent !== undefined) recover(agent, session)
      })
      yield () => {
        for (const watcher of watchers.values()) watcher.abort()
        watchers.clear()
      }
    }, 'weftmate-aigame-host: durable terminal handoff recovery')
  })

  ctx.inject(['sessions', 'webServer'], (panelCtx) => {
    const panelTransport = transport.configurationError === undefined
      ? transport
      : {
          inspect: async () => { throw transport.configurationError },
          events: async () => { throw transport.configurationError },
        }
    panelCtx.effect(
      () => panelCtx.webServer.register({
        kind: 'prefix',
        path: '/weftmate/ai-game',
        handler: createAiGamePanelHandler({ sessions: panelCtx.sessions, transport: panelTransport }),
      }),
      'weftmate-aigame-host: safe same-origin execution panel projection',
    )
  })

  ctx.tools.register(defineTool({
    name: AI_GAME_TOOL_NAME,
    description: `Manage existing durable AI-Game phone Tasks and their controls. For new complete desktop/phone goals, use weftmod and weftmod_script to observe, operate, write code and reuse scripts as the conversation agent. submit remains a compatibility entry for the ${AI_GAME_GENERAL_RUNNER_KIND}/${AI_GAME_GENERAL_RUNNER_VERSION} runner. Legacy v1 records are historical read-only.`,
    parameters: {
      action: {
        type: 'string', required: true,
        enum: ['submit', 'inspect', 'cancel', 'resume', 'answer', 'revise', 'control'],
        description: 'Operation to perform on a canonical phone Task. Mutations remain in the official DSH tool and permission chain.',
      },
      goal: { type: 'string', description: 'Required only for submit: concise phone execution goal.' },
      task_id: { type: 'string', description: 'Required for inspect, cancel, resume, answer, revise, and control.' },
      base_revision: { type: 'integer', description: 'Required compare-and-set revision for revise.' },
      expected_revision: { type: 'integer', description: 'Required compare-and-set revision for cancel, resume, and control.' },
      revision_kind: { type: 'string', enum: ['add', 'revise', 'reprioritize', 'reschedule', 'change_stop_condition'] },
      instruction: { type: 'string', description: 'Required safe task instruction for revise.' },
      control_action: { type: 'string', enum: ['pause', 'resume', 'cancel', 'takeover', 'release_takeover'] },
      question_id: { type: 'string', description: 'Required for answer and must match the pending question.' },
      answer: { type: 'string', description: 'Exact user answer for the pending AI-Game Task question.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          action: { type: 'string', required: true },
          task_id: { type: 'string', required: true },
          status: { type: 'string', required: true, enum: ['scheduled', 'running', 'waiting_time', 'waiting_event', 'recovering', 'replanning', 'paused', 'user_takeover', 'needs_user_input', 'succeeded', 'failed', 'cancelled'] },
          goal_summary: { type: 'string', required: true },
          current_stage: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
          progress_kind: { type: 'string', required: true, enum: ['unknown'] },
          current_action: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
          pending_question: { type: 'json', required: true },
          result_summary: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
          evidence_refs: { type: 'array', required: true, items: { type: 'json' } },
          event_cursor: { type: 'integer', required: true },
          error_code: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
          current_revision: { type: 'integer', required: true },
          reason_code: { type: 'string' },
          allowed_controls: { type: 'array', required: true, items: { type: 'string', enum: ['pause', 'resume', 'cancel', 'takeover', 'release_takeover'] } },
          device: { type: 'json', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          `AI-Game task ${value.task_id}: ${value.status}`,
          `Current revision: ${value.current_revision}`,
          `Goal: ${value.goal_summary}`,
          value.current_stage === null ? 'Current stage: unknown' : `Current stage: ${value.current_stage}`,
          value.current_action === null ? null : `Current action: ${value.current_action}`,
          value.result_summary === null ? null : `Result: ${value.result_summary}`,
          value.pending_question === null ? null : `Pending question id: ${value.pending_question.question_id}`,
          value.pending_question === null ? null : `Pending question: ${value.pending_question.question}`,
          value.device === null ? 'Device: not bound' : `Device: ${value.device.display_name} (${value.device.state})`,
          `Allowed controls: ${value.allowed_controls.length === 0 ? 'none' : value.allowed_controls.join(', ')}`,
          `Evidence references: ${value.evidence_refs.length}`,
          AI_GAME_V2_TERMINAL.has(value.status) ? null : 'This task runs in the background. Report its current state once and wait for the existing task notice; do not repeatedly inspect it or use a shell command to wait.',
        ].filter(Boolean).join('\n'),
      }],
      presentationMeta: (_args, value) => ({
        schemaVersion: 2,
        kind: 'ai-game-task',
        toolName: AI_GAME_TOOL_NAME,
        taskId: value.task_id,
        status: value.status,
        eventCursor: value.event_cursor,
        evidenceRefs: value.evidence_refs ?? [],
      }),
    },
    timeoutMs: 45_000,
    isConcurrencySafe: (args) => args.action === 'inspect',
    async execute(args, exec) {
      if (Object.hasOwn(args, 'capability')) {
        throw toolError(
          'AI_GAME_CAPABILITY_ARGUMENT_DISABLED',
          'The phone runner is selected by the trusted host and cannot be chosen by tool arguments.',
        )
      }
      if (Object.hasOwn(args, 'version') || Object.hasOwn(args, 'execution_id')) {
        throw toolError(
          'AI_GAME_V1_TOOL_PATH_DISABLED',
          'Legacy version and execution_id arguments are no longer accepted; use the canonical task_id path.',
        )
      }
      if (transport.configurationError !== undefined) {
        const error = transport.configurationError
        throw toolError(error.code ?? 'AI_GAME_NOT_CONFIGURED', 'AI-Game phone execution is not configured for this WeftMate runtime.')
      }
      const identity = callIdentity(exec)
      let taskId = typeof args.task_id === 'string' ? args.task_id : null
      try {
        let snapshot
        if (args.action === 'submit') {
          if (typeof args.goal !== 'string' || args.goal.trim() === '') {
            throw toolError('AI_GAME_INVALID_ARGUMENTS', 'submit requires a non-empty goal.')
          }
          const profiles = await transport.deviceProfiles(exec.signal)
          const defaults = profiles.items.filter((profile) => profile.is_default && profile.state !== 'disabled')
          if (defaults.length !== 1) {
            throw toolError(
              'AI_GAME_SIMULATOR_PROFILE_REQUIRED',
              '尚未选择默认模拟器。请打开 WeftMate 左下角“设置” → “WeftMate” → “手机测试设备”，点击“发现设备”，再点击目标设备的“使用这台设备”或“设为默认”。保存后重新提交原手机任务即可。',
            )
          }
          const authorizationMode = await requireApproval(ctx, exec, args.action)
          const [principal, controller] = await Promise.all([
            credentials.resolve(credentialRef(AI_GAME_PRINCIPAL_REF)),
            credentials.resolve(credentialRef(AI_GAME_CONTROLLER_REF)),
          ])
          const submissionKey = stableSubmissionKey(identity, principal?.value, controller?.value)
          snapshot = await transport.createTask({
            identity,
            goal: { summary: args.goal.trim() },
            client_request_id: submissionKey,
            idempotency_key: submissionKey,
            runner_kind: AI_GAME_GENERAL_RUNNER_KIND,
            device_profile_id: defaults[0].device_profile_id,
            authorization_mode: authorizationMode,
          }, exec.signal)
        } else {
          if (taskId === null) throw toolError('AI_GAME_INVALID_ARGUMENTS', `${args.action} requires task_id.`)
          if (args.action === 'inspect') snapshot = await transport.taskDetail(taskId, exec.signal)
          else if (args.action === 'revise') {
            if (!Number.isSafeInteger(args.base_revision) || typeof args.revision_kind !== 'string' || typeof args.instruction !== 'string') {
              throw toolError('AI_GAME_INVALID_ARGUMENTS', 'revise requires base_revision, revision_kind, and instruction.')
            }
            const current = await transport.taskDetail(taskId, exec.signal)
            requireCurrentTask(current, taskId, args.action)
            requireCurrentRevision(current, args.base_revision)
            const authorizationMode = await requireApproval(ctx, exec, args.action)
            snapshot = await transport.reviseTask(taskId, {
              identity, base_revision: args.base_revision, kind: args.revision_kind,
              instruction: args.instruction, idempotency_key: operationKey(identity, 'revise'),
              authorization_mode: authorizationMode,
            }, exec.signal)
          } else if (args.action === 'control' || args.action === 'cancel' || args.action === 'resume') {
            const action = args.action === 'control' ? args.control_action : args.action
            if (!Number.isSafeInteger(args.expected_revision) || typeof action !== 'string') {
              throw toolError('AI_GAME_INVALID_ARGUMENTS', 'control requires expected_revision and a supported control action.')
            }
            const current = await transport.taskDetail(taskId, exec.signal)
            requireCurrentTask(current, taskId, action)
            requireAllowedControl(current, action)
            requireCurrentRevision(current, args.expected_revision)
            const authorizationMode = await requireApproval(ctx, exec, args.action)
            snapshot = await transport.controlTask(taskId, {
              identity, action, expected_revision: args.expected_revision,
              idempotency_key: operationKey(identity, `control-${action}`),
              authorization_mode: authorizationMode,
            }, exec.signal)
          } else if (args.action === 'answer') {
            if (typeof args.question_id !== 'string' || typeof args.answer !== 'string') {
              throw toolError('AI_GAME_INVALID_ARGUMENTS', 'answer requires question_id and answer.')
            }
            const current = await transport.taskDetail(taskId, exec.signal)
            requireCurrentTask(current, taskId, args.action)
            requirePendingQuestion(current, args.question_id)
            const authorizationMode = await requireApproval(ctx, exec, args.action)
            snapshot = await transport.answerTask(taskId, {
              identity, question_id: args.question_id, answer: args.answer,
              idempotency_key: operationKey(identity, 'answer'),
              authorization_mode: authorizationMode,
            }, exec.signal)
          } else {
            throw toolError('AI_GAME_INVALID_ARGUMENTS', `${args.action} is not a canonical Task action.`)
          }
        }
        taskId = snapshot.task_id
        if (!AI_GAME_V2_TERMINAL.has(snapshot.status) && exec.agent !== undefined) {
          watchTask(exec.agent, exec.agent.session, snapshot.task_id)
        }
        return canonicalV2(snapshot, args.action)
      } catch (error) {
        if (exec.signal.aborted) {
          if (taskId !== null) {
            const watcher = watchers.get(`task:${taskId}`)
            watcher?.abort()
            watchers.delete(`task:${taskId}`)
          }
          await abortAiGameExecutionForTurnStop(transport, identity, null, { v2: true })
          throw toolError('AI_GAME_TURN_STOPPED', 'The DSH turn stopped; the current AI-Game wait was aborted without cancelling the task.')
        }
        if (error instanceof AiGameTransportError) throw toolError(error.code, error.message.split(': ').slice(1).join(': '))
        throw error
      }
    },
    presentCall: (args) => ({ card: 'generic', title: `AI-Game phone execution: ${args.action}`, kind: args.action === 'inspect' ? 'read' : 'execute' }),
  }))
}

export default { name, inject, apply }
