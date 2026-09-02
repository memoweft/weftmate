import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { describe, test } from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  AiGameTransport,
  AiGameTransportError,
  validateV2Task,
  validateV2TaskList,
} from '../src/runtime/ai-game/transport.mjs'
import {
  collectDurableExecutionPointers,
  projectAiGameSessionPanel,
  sanitizeAiGameTask,
} from '../src/runtime/ai-game/panel.mjs'

async function loadHostPlugin() {
  const temp = await mkdtemp(join(tmpdir(), 'weftmate-aigame-v2-host-'))
  const pluginDir = join(temp, 'plugins')
  const runtimeDir = join(temp, 'runtime', 'ai-game')
  await mkdir(pluginDir, { recursive: true })
  await mkdir(runtimeDir, { recursive: true })
  const vendor = join(process.cwd(), 'vendor', 'dsh-runtime', 'node_modules', '@deepseek-ai')
  const packageUrl = (name: string) => pathToFileURL(join(vendor, name, 'lib', 'index.js')).href
  const source = await readFile(new URL('../src/plugins/weftmate-aigame-host.mjs', import.meta.url), 'utf8')
  await writeFile(join(pluginDir, 'weftmate-aigame-host.mjs'), source
    .replace("'@deepseek-ai/dsh-credentials'", JSON.stringify(packageUrl('dsh-credentials')))
    .replace("'@deepseek-ai/dsh-tools'", JSON.stringify(packageUrl('dsh-tools')))
    .replace("'@deepseek-ai/dsh-llm'", JSON.stringify(packageUrl('dsh-llm'))), 'utf8')
  for (const file of ['transport.mjs', 'panel.mjs']) {
    await writeFile(join(runtimeDir, file), await readFile(new URL(`../src/runtime/ai-game/${file}`, import.meta.url), 'utf8'), 'utf8')
  }
  return { plugin: await import(pathToFileURL(join(pluginDir, 'weftmate-aigame-host.mjs')).href), temp }
}

function task(status = 'running') {
  return {
    schema_version: 2,
    task_id: 'task_123',
    origin: { dsh_session_id: 'session_123', created_execution_id: 'exec_123', created_tool_call_id: 'call_123', root_call_id: 'call_123' },
    goal: { summary: 'Open the selected emulator Settings' },
    current_revision: 2,
    status,
    reason: { code: 'WAITING_FOR_DEVICE', summary: 'Waiting for the selected emulator.' },
    current: { stage: 'observe', action: null },
    next_wake_at: null,
    event_cursor: 7,
    pending_question: status === 'needs_user_input'
      ? { question_id: 'question_123', question: 'Select an account.', why_needed: 'The task cannot infer this.' }
      : null,
    result: null,
    error: null,
    integrity: { state: 'clear' },
    allowed_controls: status === 'paused' ? ['resume', 'cancel'] : ['pause', 'cancel', 'takeover'],
    device: { profile_id: 'profile_123', display_name: 'Daily emulator', state: 'ready' },
    timestamps: { created_at: '2026-08-30T00:00:00Z', updated_at: '2026-08-30T00:01:00Z', terminal_at: null },
  }
}

const identity = {
  dsh_session_id: 'session_123', dsh_turn_id: 3, tool_call_id: 'call_123', root_call_id: 'call_123',
}

describe('AI-Game v2 transport fence', () => {
  test('rejects missing or unknown runner kind before HTTP', async () => {
    let fetches = 0
    const transport = new AiGameTransport({
      origin: 'http://127.0.0.1:4310',
      resolveToken: async () => 'test-capability-token-123',
      resolvePrincipalId: async () => 'principal_install_123',
      resolveControllerId: async () => 'controller_install_123',
      fetchImpl: async () => { fetches += 1; throw new Error('must not fetch') },
    })
    const base = {
      identity, goal: { summary: 'Open Settings' }, authorization_mode: 'full-access',
      idempotency_key: 'operation_123', device_profile_id: 'profile_default',
    }
    assert.throws(() => transport.createTask(base), TypeError)
    assert.throws(() => transport.createTask({ ...base, runner_kind: 'soul_chat_v1' }), TypeError)
    assert.throws(() => transport.createTask({ ...base, runner_kind: 'emulator_settings_v1' }), TypeError)
    assert.equal(fetches, 0)
  })

  test('uses only execution v2 paths and keeps the capability out of body and URL', async () => {
    const calls: Array<{ url: string, init: RequestInit }> = []
    const transport = new AiGameTransport({
      origin: 'http://127.0.0.1:4310',
      resolveToken: async () => 'test-capability-token-123',
      resolvePrincipalId: async () => 'principal_install_123',
      resolveControllerId: async () => 'controller_install_123',
      fetchImpl: async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        const payload = url.includes('?limit=50')
          ? { items: [task('scheduled')], next_cursor: null }
          : task('scheduled')
        return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
      },
    })
    const result = await transport.createTask({
      identity, goal: { summary: 'Open Settings' }, authorization_mode: 'full-access',
      idempotency_key: 'operation_123', runner_kind: 'android_ui_agent',
      device_profile_id: 'profile_default',
    })
    assert.equal(result.task_id, 'task_123')
    const listed = await transport.listTasks({ limit: 50 })
    assert.deepEqual(listed.items.map((item: any) => item.task_id), ['task_123'])
    assert.equal(calls[0].url, 'http://127.0.0.1:4310/api/execution/v2/tasks')
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer test-capability-token-123')
    assert.equal((calls[0].init.headers as Record<string, string>)['X-AI-Game-Principal-Id'], 'principal_install_123')
    assert.equal((calls[0].init.headers as Record<string, string>)['X-AI-Game-Controller-Id'], 'controller_install_123')
    assert.doesNotMatch(calls[0].url, /token|capability/i)
    assert.doesNotMatch(calls[0].url, /principal_install_123|controller_install_123/)
    assert.doesNotMatch(String(calls[0].init.body), /test-capability-token-123/)
    assert.doesNotMatch(String(calls[0].init.body), /principal_install_123/)
    assert.doesNotMatch(String(calls[0].init.body), /controller_install_123/)
    assert.equal(calls[1].url, 'http://127.0.0.1:4310/api/execution/v2/tasks?limit=50')
    assert.equal((calls[1].init.headers as Record<string, string>)['X-AI-Game-Principal-Id'], 'principal_install_123')
    assert.equal((calls[1].init.headers as Record<string, string>)['X-AI-Game-Controller-Id'], 'controller_install_123')
  })

  test('fails closed before HTTP when an effect mutation lacks explicit host authorization', () => {
    let fetches = 0
    const transport = new AiGameTransport({
      origin: 'http://127.0.0.1:4310',
      resolveToken: async () => 'test-capability-token-123',
      resolvePrincipalId: async () => 'principal_install_123',
      resolveControllerId: async () => 'controller_install_123',
      fetchImpl: async () => { fetches += 1; throw new Error('must not fetch') },
    })
    const request = { identity, idempotency_key: 'operation_123' }
    for (const authorization_mode of [undefined, null, 'ask', 'danger-full-access']) {
      assert.throws(() => transport.reviseTask('task_123', {
        ...request, base_revision: 2, kind: 'revise', instruction: 'Use the safer path', authorization_mode,
      } as any), TypeError)
      assert.throws(() => transport.controlTask('task_123', {
        ...request, expected_revision: 2, action: 'pause', authorization_mode,
      } as any), TypeError)
      assert.throws(() => transport.answerTask('task_123', {
        ...request, question_id: 'question_123', answer: 'Personal', authorization_mode,
      } as any), TypeError)
    }
    assert.equal(fetches, 0)
  })

  test('keeps the owner pair stable across token rotation and DSH sessions without exposing upstream detail', async () => {
    let token = 'test-capability-token-a'
    const seenPrincipals: string[] = []
    const seenControllers: string[] = []
    const seenAuthorizations: string[] = []
    const transport = new AiGameTransport({
      origin: 'http://127.0.0.1:4310', resolveToken: async () => token,
      resolvePrincipalId: async () => 'principal_install_123',
      resolveControllerId: async () => 'controller_install_123',
      fetchImpl: async (_url: string, init: RequestInit) => {
        seenPrincipals.push((init.headers as Record<string, string>)['X-AI-Game-Principal-Id'])
        seenControllers.push((init.headers as Record<string, string>)['X-AI-Game-Controller-Id'])
        seenAuthorizations.push((init.headers as Record<string, string>).Authorization)
        return new Response(JSON.stringify(task('paused')), { status: 200, headers: { 'content-type': 'application/json' } })
      },
    })
    // No dsh_session_id participates in a read URL: the authenticated
    // installation principal authorizes a different official DSH conversation.
    await transport.taskDetail('task_123')
    token = 'test-capability-token-b'
    await transport.taskDetail('task_123')
    assert.deepEqual(seenPrincipals, ['principal_install_123', 'principal_install_123'])
    assert.deepEqual(seenControllers, ['controller_install_123', 'controller_install_123'])
    assert.notEqual(seenAuthorizations[0], seenAuthorizations[1])

    const foreign = new AiGameTransport({
      origin: 'http://127.0.0.1:4310', resolveToken: async () => 'test-capability-token-b',
      resolvePrincipalId: async () => 'principal_other_456',
      resolveControllerId: async () => 'controller_other_456',
      fetchImpl: async () => new Response(JSON.stringify({ error: { code: 'EXECUTION_PRINCIPAL_FORBIDDEN', detail: 'controller_install_123 must never reach the UI' } }), { status: 403, headers: { 'content-type': 'application/json' } }),
    })
    await assert.rejects(() => foreign.taskDetail('task_123'), (error: unknown) => error instanceof AiGameTransportError
      && error.code === 'EXECUTION_PRINCIPAL_FORBIDDEN' && !error.message.includes('controller_install_123'))
  })

  test('accepts honest null and safe real errors while failing closed on incomplete errors', () => {
    assert.equal(validateV2Task(task('scheduled')).error, null)
    const failed = validateV2Task({
      ...task('failed'),
      error: { code: 'DEVICE_DOWN', summary: 'The Task runtime reported an error.' },
    })
    assert.equal(failed.error.summary, 'The Task runtime reported an error.')
    assert.throws(
      () => validateV2Task({ ...task('failed'), error: { code: 'TASK_ERROR' } }),
      AiGameTransportError,
    )
  })

  test('projects pending questions through an exact model-visible allowlist', () => {
    const unsafeTask = {
      ...task('needs_user_input'),
      pending_question: {
        question_id: 'question_123',
        question: 'Select an account.',
        why_needed: 'The task cannot infer this.',
        controller_id: 'controller_secret',
        token: 'capability_secret',
        transport: { serial: 'emulator-5554' },
      },
    }
    const projected = validateV2Task(unsafeTask)
    assert.deepEqual(projected.pending_question, {
      question_id: 'question_123',
      question: 'Select an account.',
      why_needed: 'The task cannot infer this.',
    })
    assert.doesNotMatch(JSON.stringify(projected.pending_question), /controller_secret|capability_secret|emulator-5554/)
    const listed = validateV2TaskList({ items: [unsafeTask], next_cursor: null })
    assert.deepEqual(listed.items[0].pending_question, projected.pending_question)
    assert.doesNotMatch(JSON.stringify(listed.items[0].pending_question), /controller_secret|capability_secret|emulator-5554/)
  })

  test('fails closed on a device or task response that contains internal transport facts', () => {
    assert.throws(() => validateV2Task({ ...task(), device: { ...task().device, serial: 'emulator-5554' } }), AiGameTransportError)
    assert.deepEqual(
      validateV2Task({
        ...task(),
        device: { ...task().device, harmless_upstream_extension: 'must-not-ride-through' },
      }).device,
      { profile_id: 'profile_123', display_name: 'Daily emulator', state: 'ready' },
    )
    assert.throws(() => validateV2Task({ ...task(), status: 'almost_done' }), AiGameTransportError)
    assert.throws(() => validateV2Task({ ...task(), runner_kind: 'android_ui_agent' }), AiGameTransportError)
    assert.throws(() => validateV2Task({ ...task(), origin: { runner_version: '1' } }), AiGameTransportError)
  })
})

describe('AI-Game v2 durable task projection', () => {
  test('freezes the general runner in the trusted host and enforces authoritative controls', async () => {
    const { plugin, temp } = await loadHostPlugin()
    try {
      assert.equal(plugin.AI_GAME_GENERAL_RUNNER_KIND, 'android_ui_agent')
      assert.equal(plugin.AI_GAME_GENERAL_RUNNER_VERSION, '1')
      assert.doesNotThrow(() => plugin.requireAllowedControl(task('running'), 'pause'))
      assert.throws(
        () => plugin.requireAllowedControl(task('paused'), 'pause'),
        (error: any) => error?.code === 'AI_GAME_CONTROL_UNAVAILABLE',
      )
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  })

  test('rebuilds the canonical pending question even when a transport stub carries extra fields', async () => {
    const { plugin, temp } = await loadHostPlugin()
    try {
      const projected = plugin.canonicalV2({
        ...task('needs_user_input'),
        device: { ...task().device, token: 'device-secret' },
        pending_question: {
          question_id: 'question_123', question: 'Select an account.',
          why_needed: 'The task cannot infer this.', controller_id: 'controller_secret',
          token: 'capability_secret',
        },
      }, 'inspect')
      assert.deepEqual(projected.pending_question, {
        question_id: 'question_123',
        question: 'Select an account.',
        why_needed: 'The task cannot infer this.',
      })
      assert.deepEqual(projected.device, {
        profile_id: 'profile_123',
        display_name: 'Daily emulator',
        state: 'ready',
      })
      assert.doesNotMatch(JSON.stringify(projected), /controller_secret|capability_secret|device-secret/)
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  })

  test('derives one opaque submit key from owner and DSH user turn, not the tool attempt', async () => {
    const { plugin, temp } = await loadHostPlugin()
    try {
      const first = plugin.stableSubmissionKey(
        { ...identity, tool_call_id: 'call-first', root_call_id: 'root-first' },
        'principal-install-a',
        'controller-install-a',
      )
      const retry = plugin.stableSubmissionKey(
        { ...identity, tool_call_id: 'call-retry', root_call_id: 'root-retry' },
        'principal-install-a',
        'controller-install-a',
      )
      assert.equal(retry, first)
      assert.match(first, /^dsh-submit-v2-[a-f0-9]{64}$/)
      assert.doesNotMatch(first, /principal|controller|session|call/i)
      assert.notEqual(plugin.stableSubmissionKey(
        { ...identity, dsh_turn_id: identity.dsh_turn_id + 1 },
        'principal-install-a', 'controller-install-a',
      ), first)
      assert.notEqual(plugin.stableSubmissionKey(
        { ...identity, dsh_session_id: 'session-other' },
        'principal-install-a', 'controller-install-a',
      ), first)
      assert.notEqual(plugin.stableSubmissionKey(
        identity, 'principal-install-b', 'controller-install-a',
      ), first)
      assert.notEqual(plugin.stableSubmissionKey(
        identity, 'principal-install-a', 'controller-install-b',
      ), first)
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  })

  test('retains all v2 non-terminal states and projects only safe fields', async () => {
    const events = [
      { type: 'tool/call', seq: 1, time: 1, data: { callId: 'call_123', name: 'phone_execution' } },
      { type: 'tool/result', seq: 2, time: 2, data: { message: { source: { callId: 'call_123' } }, meta: {
        schemaVersion: 2, kind: 'ai-game-task', toolName: 'phone_execution', taskId: 'task_123',
        status: 'recovering', eventCursor: 7, evidenceRefs: [],
      } } },
    ]
    const pointers = collectDurableExecutionPointers(events)
    assert.equal(pointers[0].taskId, 'task_123')
    assert.equal(pointers[0].version, 2)
    const panel = await projectAiGameSessionPanel({
      sessionId: 'session_123', events,
      transport: {
        taskDetail: async () => task('recovering'),
        taskEvents: async () => ({ items: [{ schema_version: 2, event_id: 'evt_123', task_id: 'task_123', cursor: 8, type: 'task.recovery_started', occurred_at: '2026-08-30T00:01:00Z', summary: 'Recovering after a normal failure.', reason_code: 'NETWORK_RETRY' }], next_cursor: 8 }),
      },
    })
    assert.equal(panel.selectedTaskId, 'task_123')
    assert.equal(panel.snapshot?.status, 'recovering')
    assert.equal(panel.snapshot?.allowedControls.includes('pause'), true)
    assert.doesNotMatch(JSON.stringify(panel), /serial|adb_path|token|canonical_device_id/i)
    assert.deepEqual(sanitizeAiGameTask(task('user_takeover')).allowedControls, ['pause', 'cancel', 'takeover'])
  })

  test('turn abort does not look up or cancel a v2 task, while a watcher emits only durable attention notices', async () => {
    const { plugin, temp } = await loadHostPlugin()
    try {
      const calls: string[] = []
      await plugin.abortAiGameExecutionForTurnStop({
        lookup: async () => { calls.push('lookup') }, cancel: async () => { calls.push('cancel') },
      }, identity, null, { v2: true })
      assert.deepEqual(calls, [])

      const session = { events: [] as any[] }
      const notices: any[] = []
      const watcher = plugin.createAiGameTaskWatcher({
        transport: { taskDetail: async () => task('needs_user_input') },
        agent: { followup: (notice: any) => { notices.push(notice); session.events.push({ type: 'user/message', data: { notice } }) } },
        session, taskId: 'task_123', delay: 1,
      })
      await watcher.run
      assert.equal(notices.length, 1)
      assert.match(JSON.stringify(notices[0]), /needs input/)
      assert.doesNotMatch(JSON.stringify(notices[0]), /token|adb_path|artifact_path/i)
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  })
})
