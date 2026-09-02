import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { describe, test } from 'node:test'

import {
  AiGameTransport,
  AiGameTransportError,
  parseAiGameOrigin,
  validateSnapshot,
} from '../src/runtime/ai-game/transport.mjs'
import { PROFILE_PATCH_TEMPLATE, writeWebProfile } from '../src/dsh-web-runtime.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'


const snapshot = {
  execution_id: 'exec_123',
  status: 'running',
  goal_summary: 'Open Settings',
  current_stage: 'observe',
  progress: {
    kind: 'unknown', completed: null, total: null,
    explanation: 'No authoritative percentage.',
  },
  current_action: null,
  pending_question: null,
  result_summary: null,
  evidence_refs: [],
  event_cursor: 3,
  timestamps: {
    created_at: '2026-08-29T01:00:00Z',
    updated_at: '2026-08-29T01:00:00Z',
    terminal_at: null,
  },
  error: null,
  internal_pointer: { session_id: 'session-1', goal_id: 'goal-1', task_id: null },
}

const v2Task = {
  schema_version: 2,
  task_id: 'task_123',
  origin: {
    dsh_session_id: 'official-dsh-session-1', created_execution_id: 'exec_v2_123',
    created_tool_call_id: 'official-call-1', root_call_id: 'official-call-1',
  },
  goal: { summary: 'Open Settings' },
  current_revision: 1,
  status: 'scheduled',
  reason: { code: 'WAITING_FOR_SCHEDULER', summary: 'Waiting for the resident scheduler.' },
  current: { stage: null, action: null },
  next_wake_at: null,
  event_cursor: 1,
  pending_question: null,
  result: null,
  error: null,
  integrity: { state: 'clear' },
  allowed_controls: ['pause', 'cancel'],
  device: { profile_id: 'profile_default', display_name: 'MuMu', state: 'ready' },
  timestamps: {
    created_at: '2026-08-31T00:00:00Z', updated_at: '2026-08-31T00:00:00Z', terminal_at: null,
  },
}


describe('AI-Game loopback transport', () => {
  test('accepts only an explicit 127.0.0.1 HTTP origin', () => {
    assert.equal(parseAiGameOrigin('http://127.0.0.1:4310'), 'http://127.0.0.1:4310')
    for (const value of [
      'https://127.0.0.1:4310', 'http://localhost:4310',
      'http://127.0.0.1:4310/path', 'http://user@127.0.0.1:4310',
      'http://192.168.1.2:4310', 'http://127.0.0.1',
    ]) assert.throws(() => parseAiGameOrigin(value), AiGameTransportError)
  })

  test('adds dedicated identity/capability headers and validates responses', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const transport = new AiGameTransport({
      origin: 'http://127.0.0.1:4310',
      resolveToken: async () => 'test-capability-token-123',
      fetchImpl: async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        return new Response(JSON.stringify(snapshot), {
          status: 202, headers: { 'content-type': 'application/json' },
        })
      },
    })
    const returned = await transport.submit({ request: 'opaque-to-transport' })
    assert.equal(returned.execution_id, 'exec_123')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'http://127.0.0.1:4310/api/execution/v1/executions:submit')
    assert.equal((calls[0].init.headers as Record<string, string>)['X-AI-Game-Client'], 'weftmate-harness-v1')
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer test-capability-token-123')
  })

  test('rejects schema drift without exposing response content', () => {
    assert.throws(
      () => validateSnapshot({ ...snapshot, status: '75-percent-done' }),
      (error: unknown) => error instanceof AiGameTransportError
        && error.code === 'AI_GAME_RESPONSE_REJECTED'
        && !error.message.includes('75-percent-done'),
    )
  })

  test('accepts only one complete Companion evidence epoch', () => {
    const provenance = {
      canonical_device_id: 'adb:device-1', companion_install_id: 'install-1',
      boot_id: 'boot-1', connection_epoch: 2, kernel_action_id: 'action-1',
      command_id: 'command-1', caused_by_command_id: 'command-1',
      adapter_id: 'android-companion-v1', physical_execution_count: 1,
    }
    const evidence = {
      evidence_id: 'ev_1', content_type: 'image/png', size_bytes: 12,
      sha256: 'a'.repeat(64),
      read_path: '/api/execution/v1/executions/exec_123/evidence/ev_1',
      provenance,
    }
    assert.equal(validateSnapshot({ ...snapshot, evidence_refs: [evidence] }).evidence_refs.length, 1)
    assert.throws(() => validateSnapshot({
      ...snapshot,
      evidence_refs: [{ ...evidence, provenance: { ...provenance, physical_execution_count: 0 } }],
    }), AiGameTransportError)
    assert.throws(() => validateSnapshot({
      ...snapshot,
      evidence_refs: [{ ...evidence, provenance: { ...provenance, caused_by_command_id: 'old-command' } }],
    }), AiGameTransportError)
  })
})

test('official host plugin is additive and profile assets are installed', async () => {
  const plugin = await readFile(new URL('../src/plugins/weftmate-aigame-host.mjs', import.meta.url), 'utf8')
  const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8')
  assert.match(plugin, /ctx\.tools\.register\(defineTool\(/)
  assert.match(plugin, /ctx\.approval\.request\(/)
  assert.match(plugin, /ctx\.credentials/)
  assert.match(plugin, /AI_GAME_PRINCIPAL_REF/)
  assert.match(plugin, /AI_GAME_CONTROLLER_REF/)
  assert.match(plugin, /resolvePrincipalId/)
  assert.match(plugin, /resolveControllerId/)
  assert.match(plugin, /dsh_session_id/)
  assert.match(plugin, /tool_call_id/)
  assert.match(plugin, /root_call_id/)
  assert.match(plugin, /Legacy v1 executions are historical read-only records and are not reachable from this tool/)
  assert.match(plugin, /Do not fall back to shell, PowerShell, ADB, emulator CLI, legacy settings, or another execution path/)
  const publicTool = plugin.slice(plugin.indexOf('ctx.tools.register(defineTool({'), plugin.indexOf('async execute(args, exec)'))
  assert.doesNotMatch(publicTool, /\bversion:\s*\{/)
  assert.doesNotMatch(publicTool, /\bexecution_id:\s*\{/)
  assert.match(publicTool, /task_id:\s*\{ type: 'string'/)
  assert.match(plugin, /abortAiGameExecutionForTurnStop/)
  assert.match(plugin, /transport\.lookup\(identity/)
  assert.match(plugin, /transport\.cancel\(/)
  assert.match(plugin, /Pending question id: \$\{value\.pending_question\.question_id\}/)
  assert.match(publicTool, /device: \{ type: 'json', required: true \}/)
  assert.match(plugin, /Device: \$\{value\.device\.display_name\} \(\$\{value\.device\.state\}\)/)
  assert.match(plugin, /answer: \{ type: 'string',[\s\S]*pending AI-Game Task question/)
  assert.doesNotMatch(plugin, /answer: \{ type: 'json'/)
  assert.doesNotMatch(publicTool, /\bconstraints:\s*\{/)
  assert.match(plugin, /transport\.deviceProfiles\(exec\.signal\)/)
  assert.match(plugin, /AI_GAME_SIMULATOR_PROFILE_REQUIRED/)
  assert.match(plugin, /device_profile_id: defaults\[0\]\.device_profile_id/)
  assert.doesNotMatch(plugin, /tool\.call\.toolview|details\s*:/)
  assert.match(PROFILE_PATCH_TEMPLATE, /id: weftmate-aigame-host/)
  assert.match(main, /app\.isPackaged\s*\?\s*undefined\s*:\s*process\.env\.WEFTMATE_AI_GAME_DEV_TOKEN/)
  assert.match(main, /delete process\.env\.WEFTMATE_AI_GAME_DEV_TOKEN/)
  assert.match(main, /saveCredential\?\.\(AI_GAME_CREDENTIAL_REF, aiGameDevelopmentToken\)/)
  assert.match(main, /if \(!app\.isPackaged\) \{[\s\S]*WEFTMATE_AI_GAME_ORIGIN/)

  const home = await mkdtemp(join(tmpdir(), 'weftmate-ai-game-profile-'))
  try {
    await writeWebProfile(home)
    const profile = join(home, 'profiles', 'weftmate')
    assert.ok(existsSync(join(profile, 'plugins', 'weftmate-aigame-host.mjs')))
    assert.ok(existsSync(join(profile, 'runtime', 'ai-game', 'transport.mjs')))
    assert.ok(existsSync(join(profile, 'runtime', 'ai-game', 'panel.mjs')))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})


test('DSH turn stop looks up an ambiguous submit and requests one idempotent cancel', async () => {
  const pluginPath = new URL('../src/plugins/weftmate-aigame-host.mjs', import.meta.url)
  const source = await readFile(pluginPath, 'utf8')
  const temp = await mkdtemp(join(tmpdir(), 'weftmate-aigame-abort-contract-'))
  const pluginDir = join(temp, 'plugins')
  const runtimeDir = join(temp, 'runtime', 'ai-game')
  await mkdir(pluginDir, { recursive: true })
  await mkdir(runtimeDir, { recursive: true })
  const vendor = join(process.cwd(), 'vendor', 'dsh-runtime', 'node_modules', '@deepseek-ai')
  const packageUrl = (name: string) => pathToFileURL(join(vendor, name, 'lib', 'index.js')).href
  await writeFile(
    join(pluginDir, 'weftmate-aigame-host.mjs'),
    source
      .replace("'@deepseek-ai/dsh-credentials'", JSON.stringify(packageUrl('dsh-credentials')))
      .replace("'@deepseek-ai/dsh-tools'", JSON.stringify(packageUrl('dsh-tools')))
      .replace("'@deepseek-ai/dsh-llm'", JSON.stringify(packageUrl('dsh-llm'))),
    'utf8',
  )
  await writeFile(
    join(runtimeDir, 'transport.mjs'),
    await readFile(new URL('../src/runtime/ai-game/transport.mjs', import.meta.url), 'utf8'),
    'utf8',
  )
  await writeFile(
    join(runtimeDir, 'panel.mjs'),
    await readFile(new URL('../src/runtime/ai-game/panel.mjs', import.meta.url), 'utf8'),
    'utf8',
  )
  try {
    const plugin = await import(pathToFileURL(join(pluginDir, 'weftmate-aigame-host.mjs')).href)
    const calls: any[] = []
    const transport = {
      async lookup(identity: any) {
        calls.push({ kind: 'lookup', identity })
        return { found: true, execution: { execution_id: 'exec_recovered' } }
      },
      async cancel(executionId: string, key: string) {
        calls.push({ kind: 'cancel', executionId, key })
      },
    }
    const identity = {
      dsh_session_id: 'session-1', dsh_turn_id: 2,
      tool_call_id: 'call-2', root_call_id: 'call-2',
    }
    await plugin.abortAiGameExecutionForTurnStop(transport, identity, null)
    assert.deepEqual(calls, [
      { kind: 'lookup', identity },
      { kind: 'cancel', executionId: 'exec_recovered', key: 'dsh-turn-stop-2-call-2' },
    ])
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('terminal handoff wakes the owning DSH agent once and deduplicates from durable history', async () => {
  const pluginPath = new URL('../src/plugins/weftmate-aigame-host.mjs', import.meta.url)
  const source = await readFile(pluginPath, 'utf8')
  const temp = await mkdtemp(join(tmpdir(), 'weftmate-ai-game-handoff-contract-'))
  const pluginDir = join(temp, 'plugins')
  const runtimeDir = join(temp, 'runtime', 'ai-game')
  await mkdir(pluginDir, { recursive: true })
  await mkdir(runtimeDir, { recursive: true })
  const vendor = join(process.cwd(), 'vendor', 'dsh-runtime', 'node_modules', '@deepseek-ai')
  const packageUrl = (name: string) => pathToFileURL(join(vendor, name, 'lib', 'index.js')).href
  await writeFile(
    join(pluginDir, 'weftmate-aigame-host.mjs'),
    source
      .replace("'@deepseek-ai/dsh-credentials'", JSON.stringify(packageUrl('dsh-credentials')))
      .replace("'@deepseek-ai/dsh-tools'", JSON.stringify(packageUrl('dsh-tools')))
      .replace("'@deepseek-ai/dsh-llm'", JSON.stringify(packageUrl('dsh-llm'))),
    'utf8',
  )
  for (const file of ['transport.mjs', 'panel.mjs']) {
    await writeFile(
      join(runtimeDir, file),
      await readFile(new URL(`../src/runtime/ai-game/${file}`, import.meta.url), 'utf8'),
      'utf8',
    )
  }
  try {
    const plugin = await import(pathToFileURL(join(pluginDir, 'weftmate-aigame-host.mjs')).href)
    const session = { events: [] as any[] }
    const followups: any[] = []
    const agent = {
      followup(message: any) {
        followups.push(message)
        session.events.push({ type: 'user/message', data: { message } })
      },
    }
    const terminal = {
      ...snapshot,
      execution_id: 'exec_handoff_1',
      status: 'succeeded',
      event_cursor: 11,
      result_summary: 'Settings opened.',
    }
    const transport = { inspect: async () => terminal }

    await plugin.createAiGameHandoffWatcher({
      transport, agent, session, executionId: terminal.execution_id, delay: 1,
    }).run
    assert.equal(followups.length, 1)
    assert.match(JSON.stringify(followups[0]), /weftmate-aigame-handoff:exec_handoff_1:succeeded:11/)
    assert.match(JSON.stringify(followups[0]), /action=inspect/)

    await plugin.createAiGameHandoffWatcher({
      transport, agent, session, executionId: terminal.execution_id, delay: 1,
    }).run
    assert.equal(followups.length, 1, 'restart recovery must not enqueue a duplicate durable handoff')
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})


test('fixed vendor ToolRuntime executes the official tool with approval and durable meta', async () => {
  const vendor = join(process.cwd(), 'vendor', 'dsh-runtime')
  const packageUrl = (name: string) => pathToFileURL(
    join(vendor, 'node_modules', '@deepseek-ai', name, 'lib', 'index.js'),
  ).href
  const [{ Context }, { default: SystemPrompt }, sessionModule,
    { default: ToolRuntime, validateJsonSchemaValue }, { default: ApprovalService }, credentialModule,
    llmModule] = await Promise.all([
    import(packageUrl('cordis')),
    import(packageUrl('dsh-system-prompt')),
    import(packageUrl('dsh-session')),
    import(packageUrl('dsh-tools')),
    import(packageUrl('dsh-user-approval')),
    import(packageUrl('dsh-credentials')),
    import(packageUrl('dsh-llm')),
  ])
  const { default: SessionStore, Session } = sessionModule

  const requestBodies: any[] = []
  const requestPaths: string[] = []
  let defaultProfileAvailable = true
  let authoritativeTask: any = v2Task
  const server = createServer(async (req, res) => {
    requestPaths.push(`${req.method} ${req.url}`)
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks).toString('utf8')
    if (body !== '') requestBodies.push(JSON.parse(body))
    assert.equal(req.headers['x-ai-game-client'], 'weftmate-harness-v1')
    assert.equal(req.headers.authorization, 'Bearer vendor-tool-test-token')
    if (req.method === 'GET' && req.url === '/api/execution/v2/device-profiles') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ items: defaultProfileAvailable ? [{
        schema_version: 2, device_profile_id: 'profile_default', revision: 1,
        display_name: 'MuMu', kind: 'android_emulator', state: 'ready', is_default: true,
      }] : [] }))
      return
    }
    if (req.method === 'GET' && req.url === '/api/execution/v2/tasks/task_123') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(authoritativeTask))
      return
    }
    if (req.method === 'POST' && req.url === '/api/execution/v2/tasks/task_123/revisions') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ...v2Task, current_revision: 2, status: 'replanning' }))
      return
    }
    if (req.method === 'POST' && req.url === '/api/execution/v2/tasks/task_123/answers') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ...v2Task, status: 'running' }))
      return
    }
    assert.equal(req.method, 'POST')
    assert.equal(req.url, '/api/execution/v2/tasks')
    res.writeHead(202, { 'content-type': 'application/json' })
    res.end(JSON.stringify(v2Task))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address !== null && typeof address === 'object')

  const temp = await mkdtemp(join(tmpdir(), 'weftmate-aigame-official-tool-'))
  const pluginDir = join(temp, 'plugins')
  const runtimeDir = join(temp, 'runtime', 'ai-game')
  await mkdir(pluginDir, { recursive: true })
  await mkdir(runtimeDir, { recursive: true })
  const originalPlugin = await readFile(join(process.cwd(), 'src', 'plugins', 'weftmate-aigame-host.mjs'), 'utf8')
  const runnablePlugin = originalPlugin
    .replace("'@deepseek-ai/dsh-credentials'", JSON.stringify(packageUrl('dsh-credentials')))
    .replace("'@deepseek-ai/dsh-tools'", JSON.stringify(packageUrl('dsh-tools')))
    .replace("'@deepseek-ai/dsh-llm'", JSON.stringify(packageUrl('dsh-llm')))
  await writeFile(join(pluginDir, 'weftmate-aigame-host.mjs'), runnablePlugin, 'utf8')
  await writeFile(
    join(runtimeDir, 'transport.mjs'),
    await readFile(join(process.cwd(), 'src', 'runtime', 'ai-game', 'transport.mjs'), 'utf8'),
    'utf8',
  )
  await writeFile(
    join(runtimeDir, 'panel.mjs'),
    await readFile(join(process.cwd(), 'src', 'runtime', 'ai-game', 'panel.mjs'), 'utf8'),
    'utf8',
  )
  const previousOrigin = process.env.WEFTMATE_AI_GAME_ORIGIN
  process.env.WEFTMATE_AI_GAME_ORIGIN = `http://127.0.0.1:${address.port}`
  const ctx = new Context()
  try {
    class TestCredentials extends credentialModule.CredentialProvider {
      constructor(serviceCtx: any) { super(serviceCtx) }
      async resolve() { return { value: 'vendor-tool-test-token', source: 'test-memory' } }
      async describe() { return { configured: true, writable: false, source: 'test-memory' } }
      async set() { throw new Error('read only') }
      async unset() { throw new Error('read only') }
    }
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false, persona: '' })
    await ctx.plugin(SessionStore)
    await ctx.plugin(ToolRuntime, { mode: 'native', maxParallelSubCalls: 1 })
    await ctx.plugin(ApprovalService, { policy: 'ask' })
    await ctx.plugin(TestCredentials)
    let approvalOutcome = 'allowed-once'
    let approvalRequests = 0
    ctx.on('approval/request', async () => {
      approvalRequests += 1
      return approvalOutcome
    })
    const plugin = await import(pathToFileURL(join(pluginDir, 'weftmate-aigame-host.mjs')).href)
    await ctx.plugin(plugin)

    const session = ctx.sessions.create('official-dsh-session-1', { meta: { cwd: process.cwd() } })
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    const args = { action: 'submit', goal: 'Open Settings' }
    const call = session.append('tool/call', {
      turn: 1, step: 1, callId: 'official-call-1', name: 'phone_execution', arguments: JSON.stringify(args),
    })
    const agent = {
      id: session.id, session, ctx, options: {}, inbox: {}, status: 'running',
      cancel() {}, whenIdle: async () => {}, runMaintenance: async (work: any) => work(new AbortController().signal),
      send() {}, followup() {}, steer() {}, inject() {},
    }
    const definition = ctx.tools.get('phone_execution')
    assert.ok(definition)
    const compiled = definition.parameters
    assert.equal(compiled.properties.version, undefined)
    assert.equal(compiled.properties.execution_id, undefined)
    assert.equal(compiled.properties.constraints, undefined)
    assert.ok(compiled.properties.task_id)
    assert.equal(compiled.properties.capability, undefined)
    assert.deepEqual(validateJsonSchemaValue(compiled, {
      action: 'submit', goal: 'Open Settings',
    }, 'arguments'), [])
    for (const [callId, injected] of [
      ['official-v1-injected', { action: 'submit', goal: 'Open Settings', version: 'v1' }],
      ['official-execution-id-only', { action: 'inspect', execution_id: 'exec_legacy' }],
    ] as const) {
      const invalid = await ctx.tools.execute({
        callId, name: 'phone_execution',
        arguments: injected,
        agent, signal: new AbortController().signal,
      })
      assert.equal(invalid.isError, true)
      assert.match(JSON.stringify(invalid), /AI_GAME_V1_TOOL_PATH_DISABLED/)
      assert.equal(requestPaths.length, 0, 'legacy-only args must fail before any AI-Game request')
      assert.equal(
        session.events.filter((event: any) => event.type.startsWith('approval/')).length,
        0,
        'schema-invalid args must fail before approval or a retryable device effect',
      )
    }
    const result = await ctx.tools.execute({
      callId: 'official-call-1', name: 'phone_execution', arguments: args,
      agent, signal: new AbortController().signal,
    })
    assert.equal(result.isError, false, JSON.stringify(result))
    if (result.isError) throw new Error(result.error.message)
    assert.equal(result.value.task_id, 'task_123')
    assert.equal(result.value.execution_id, undefined)
    assert.deepEqual(result.value.allowed_controls, ['pause', 'cancel'])
    assert.deepEqual(result.meta, {
      schemaVersion: 2, kind: 'ai-game-task', toolName: 'phone_execution',
      taskId: 'task_123', status: 'scheduled', eventCursor: 1, evidenceRefs: [],
    })
    session.append('tool/result', {
      turn: 1, step: 1,
      message: llmModule.createToolResultMessage({
        callId: 'official-call-1', content: result.content, isError: false,
      }),
      meta: result.meta,
    }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
    const audit = session.events.filter((event: any) => event.type.startsWith('approval/'))
    assert.deepEqual(audit.map((event: any) => event.type), ['approval/asked', 'approval/decided'])
    const durable = session.events.findLast((event: any) => event.type === 'tool/result')
    assert.equal(durable.data.meta.taskId, 'task_123')
    const restored = Session.fromRestore(
      session.id,
      JSON.parse(JSON.stringify(session.events)),
      JSON.parse(JSON.stringify(session.header)),
    )
    const restoredDurable = restored.events.findLast((event: any) => event.type === 'tool/result')
    assert.equal(restoredDurable.data.meta.taskId, 'task_123')
    assert.equal(restoredDurable.data.meta.eventCursor, 1)
    assert.equal(requestBodies.length, 1)
    const requestBody = requestBodies[0]
    assert.equal(requestBody.origin.dsh_session_id, 'official-dsh-session-1')
    assert.equal(requestBody.origin.dsh_turn_id, 1)
    assert.equal(requestBody.origin.tool_call_id, 'official-call-1')
    assert.equal(requestBody.origin.root_call_id, 'official-call-1')
    assert.match(requestBody.client_request_id, /^dsh-submit-v2-[a-f0-9]{64}$/)
    assert.equal(requestBody.idempotency_key, requestBody.client_request_id)
    assert.doesNotMatch(requestBody.client_request_id, /official|vendor|session|call/i)
    assert.equal(requestBody.device_profile_id, 'profile_default')
    assert.equal(requestBody.runner_kind, 'android_ui_agent')
    assert.equal(requestBody.runner_version, undefined)
    assert.equal(requestBody.authorization_mode, 'allowed-once')
    assert.deepEqual(requestPaths.slice(0, 2), [
      'GET /api/execution/v2/device-profiles',
      'POST /api/execution/v2/tasks',
    ])

    const retry = await ctx.tools.execute({
      callId: 'official-call-retry', name: 'phone_execution', arguments: args,
      agent, signal: new AbortController().signal,
    })
    assert.equal(retry.isError, false, JSON.stringify(retry))
    assert.equal(requestBodies.length, 2)
    assert.equal(requestBodies[1].device_profile_id, 'profile_default')
    assert.equal(requestBodies[1].idempotency_key, requestBodies[0].idempotency_key)
    assert.equal(requestBodies[1].client_request_id, requestBodies[0].client_request_id)
    assert.notEqual(requestBodies[1].origin.tool_call_id, requestBodies[0].origin.tool_call_id)
    assert.deepEqual(
      session.events.filter((event: any) => event.type.startsWith('approval/')).map((event: any) => event.type),
      ['approval/asked', 'approval/decided', 'approval/asked', 'approval/decided'],
    )

    defaultProfileAvailable = false
    session.append('step/start', { turn: 1, step: 3 })
    session.append('tool/call', {
      turn: 1, step: 3, callId: 'official-no-profile', name: 'phone_execution',
      arguments: JSON.stringify(args),
    })
    const approvalsBeforeNoProfile = approvalRequests
    const noProfile = await ctx.tools.execute({
      callId: 'official-no-profile', name: 'phone_execution',
      arguments: args,
      agent, signal: new AbortController().signal,
    })
    assert.equal(noProfile.isError, true)
    assert.match(JSON.stringify(noProfile), /AI_GAME_SIMULATOR_PROFILE_REQUIRED/)
    assert.match(JSON.stringify(noProfile), /Save one default Android emulator/)
    assert.equal(requestBodies.length, 2, 'missing default profile must not create a Task or a v1 execution')
    assert.equal(approvalRequests, approvalsBeforeNoProfile, 'profile preflight must fail before asking for effect approval')
    defaultProfileAvailable = true

    const fullAccessSession = ctx.sessions.create('official-dsh-full-access-session', { meta: { cwd: process.cwd() } })
    fullAccessSession.append('permission/preset', { preset: 'workspace-write' })
    fullAccessSession.append('permission/preset', { preset: 'danger-full-access' })
    fullAccessSession.append('turn/start', { turn: 1 })
    fullAccessSession.append('step/start', { turn: 1, step: 1 })
    fullAccessSession.append('tool/call', {
      turn: 1, step: 1, callId: 'official-full-access-call', name: 'phone_execution',
      arguments: JSON.stringify(args),
    })
    const fullAccessAgent = { ...agent, id: fullAccessSession.id, session: fullAccessSession }
    const approvalsBeforeFullAccess = approvalRequests
    const fullAccessResult = await ctx.tools.execute({
      callId: 'official-full-access-call', name: 'phone_execution', arguments: args,
      agent: fullAccessAgent, signal: new AbortController().signal,
    })
    assert.equal(fullAccessResult.isError, false, JSON.stringify(fullAccessResult))
    assert.equal(approvalRequests, approvalsBeforeFullAccess, 'Full Access must not dispatch an approval request')
    assert.deepEqual(
      fullAccessSession.events.filter((event: any) => event.type.startsWith('approval/')),
      [],
      'Full Access must not write approval audit events',
    )
    assert.equal(requestBodies.length, 3)
    assert.equal(requestBodies[2].authorization_mode, 'full-access')

    authoritativeTask = { ...v2Task, current_revision: 2 }
    const approvalsBeforeStaleRevision = approvalRequests
    const bodiesBeforeStaleRevision = requestBodies.length
    const staleRevision = await ctx.tools.execute({
      callId: 'official-stale-revision', name: 'phone_execution',
      arguments: {
        action: 'revise', task_id: 'task_123', base_revision: 1,
        revision_kind: 'revise', instruction: 'Use the safer path.',
      },
      agent, signal: new AbortController().signal,
    })
    assert.equal(staleRevision.isError, true)
    assert.match(JSON.stringify(staleRevision), /AI_GAME_REVISION_CONFLICT/)
    assert.equal(approvalRequests, approvalsBeforeStaleRevision, 'stale revision must fail before DSH approval')
    assert.equal(requestBodies.length, bodiesBeforeStaleRevision, 'stale revision must not submit a mutation')
    assert.equal(requestPaths.at(-1), 'GET /api/execution/v2/tasks/task_123')

    authoritativeTask = { ...v2Task, task_id: 'task_other' }
    const approvalsBeforeMismatchedTask = approvalRequests
    const bodiesBeforeMismatchedTask = requestBodies.length
    const mismatchedTaskRevision = await ctx.tools.execute({
      callId: 'official-mismatched-task-revision', name: 'phone_execution',
      arguments: {
        action: 'revise', task_id: 'task_123', base_revision: 1,
        revision_kind: 'revise', instruction: 'Use the safer path.',
      },
      agent, signal: new AbortController().signal,
    })
    assert.equal(mismatchedTaskRevision.isError, true)
    assert.match(JSON.stringify(mismatchedTaskRevision), /AI_GAME_TASK_STATE_UNAVAILABLE/)
    assert.equal(approvalRequests, approvalsBeforeMismatchedTask, 'mismatched Task state must fail before DSH approval')
    assert.equal(requestBodies.length, bodiesBeforeMismatchedTask, 'mismatched Task state must not submit a mutation')

    authoritativeTask = {
      ...v2Task, status: 'succeeded', allowed_controls: [],
      timestamps: { ...v2Task.timestamps, terminal_at: '2026-08-31T00:01:00Z' },
    }
    const approvalsBeforeTerminalRevision = approvalRequests
    const bodiesBeforeTerminalRevision = requestBodies.length
    const terminalRevision = await ctx.tools.execute({
      callId: 'official-terminal-revision', name: 'phone_execution',
      arguments: {
        action: 'revise', task_id: 'task_123', base_revision: 1,
        revision_kind: 'revise', instruction: 'Use the safer path.',
      },
      agent, signal: new AbortController().signal,
    })
    assert.equal(terminalRevision.isError, true)
    assert.match(JSON.stringify(terminalRevision), /AI_GAME_TASK_MUTATION_UNAVAILABLE/)
    assert.equal(approvalRequests, approvalsBeforeTerminalRevision, 'terminal revision must fail before DSH approval')
    assert.equal(requestBodies.length, bodiesBeforeTerminalRevision, 'terminal revision must not submit a mutation')

    authoritativeTask = { ...v2Task, archived: true }
    const approvalsBeforeArchivedRevision = approvalRequests
    const bodiesBeforeArchivedRevision = requestBodies.length
    const archivedRevision = await ctx.tools.execute({
      callId: 'official-archived-revision', name: 'phone_execution',
      arguments: {
        action: 'revise', task_id: 'task_123', base_revision: 1,
        revision_kind: 'revise', instruction: 'Use the safer path.',
      },
      agent, signal: new AbortController().signal,
    })
    assert.equal(archivedRevision.isError, true)
    assert.match(JSON.stringify(archivedRevision), /AI_GAME_TASK_MUTATION_UNAVAILABLE/)
    assert.equal(approvalRequests, approvalsBeforeArchivedRevision, 'archived revision must fail before DSH approval')
    assert.equal(requestBodies.length, bodiesBeforeArchivedRevision, 'archived revision must not submit a mutation')

    authoritativeTask = v2Task
    const pathsBeforeApprovedRevision = requestPaths.length
    const approvedRevision = await ctx.tools.execute({
      callId: 'official-approved-revision', name: 'phone_execution',
      arguments: {
        action: 'revise', task_id: 'task_123', base_revision: 1,
        revision_kind: 'revise', instruction: 'Use the safer path.',
      },
      agent, signal: new AbortController().signal,
    })
    assert.equal(approvedRevision.isError, false, JSON.stringify(approvedRevision))
    const approvedRevisionPaths = requestPaths.slice(pathsBeforeApprovedRevision)
    assert.ok(approvedRevisionPaths.indexOf('GET /api/execution/v2/tasks/task_123') >= 0)
    assert.ok(approvedRevisionPaths.indexOf('POST /api/execution/v2/tasks/task_123/revisions')
      > approvedRevisionPaths.indexOf('GET /api/execution/v2/tasks/task_123'))
    assert.equal(requestBodies.at(-1).base_revision, 1)
    assert.equal(requestBodies.at(-1).authorization_mode, 'allowed-once')

    authoritativeTask = {
      ...v2Task,
      status: 'needs_user_input',
      pending_question: {
        question_id: 'question_current', question: 'Select an account.',
        why_needed: 'The Task cannot infer the account.',
      },
    }
    const approvalsBeforeStaleAnswer = approvalRequests
    const bodiesBeforeStaleAnswer = requestBodies.length
    const staleAnswer = await ctx.tools.execute({
      callId: 'official-stale-answer', name: 'phone_execution',
      arguments: {
        action: 'answer', task_id: 'task_123', question_id: 'question_stale', answer: 'Personal',
      },
      agent, signal: new AbortController().signal,
    })
    assert.equal(staleAnswer.isError, true)
    assert.match(JSON.stringify(staleAnswer), /AI_GAME_QUESTION_UNAVAILABLE/)
    assert.equal(approvalRequests, approvalsBeforeStaleAnswer, 'stale answer must fail before DSH approval')
    assert.equal(requestBodies.length, bodiesBeforeStaleAnswer, 'stale answer must not submit a mutation')

    authoritativeTask = { ...authoritativeTask, archived: true }
    const approvalsBeforeArchivedAnswer = approvalRequests
    const bodiesBeforeArchivedAnswer = requestBodies.length
    const archivedAnswer = await ctx.tools.execute({
      callId: 'official-archived-answer', name: 'phone_execution',
      arguments: {
        action: 'answer', task_id: 'task_123', question_id: 'question_current', answer: 'Personal',
      },
      agent, signal: new AbortController().signal,
    })
    assert.equal(archivedAnswer.isError, true)
    assert.match(JSON.stringify(archivedAnswer), /AI_GAME_TASK_MUTATION_UNAVAILABLE/)
    assert.equal(approvalRequests, approvalsBeforeArchivedAnswer, 'archived answer must fail before DSH approval')
    assert.equal(requestBodies.length, bodiesBeforeArchivedAnswer, 'archived answer must not submit a mutation')

    authoritativeTask = { ...authoritativeTask, archived: false }
    const pathsBeforeApprovedAnswer = requestPaths.length
    const approvedAnswer = await ctx.tools.execute({
      callId: 'official-approved-answer', name: 'phone_execution',
      arguments: {
        action: 'answer', task_id: 'task_123', question_id: 'question_current', answer: 'Personal',
      },
      agent, signal: new AbortController().signal,
    })
    assert.equal(approvedAnswer.isError, false, JSON.stringify(approvedAnswer))
    const approvedAnswerPaths = requestPaths.slice(pathsBeforeApprovedAnswer)
    assert.ok(approvedAnswerPaths.indexOf('GET /api/execution/v2/tasks/task_123') >= 0)
    assert.ok(approvedAnswerPaths.indexOf('POST /api/execution/v2/tasks/task_123/answers')
      > approvedAnswerPaths.indexOf('GET /api/execution/v2/tasks/task_123'))
    assert.equal(requestBodies.at(-1).question_id, 'question_current')
    assert.equal(requestBodies.at(-1).authorization_mode, 'allowed-once')

    const rejectedSession = ctx.sessions.create('official-dsh-rejected-session', { meta: { cwd: process.cwd() } })
    rejectedSession.append('turn/start', { turn: 1 })
    rejectedSession.append('step/start', { turn: 1, step: 1 })
    rejectedSession.append('tool/call', {
      turn: 1, step: 1, callId: 'official-rejected-call', name: 'phone_execution',
      arguments: JSON.stringify(args),
    })
    const rejectedAgent = { ...agent, id: rejectedSession.id, session: rejectedSession }
    approvalOutcome = 'rejected'
    const bodiesBeforeRejectedSubmit = requestBodies.length
    const rejected = await ctx.tools.execute({
      callId: 'official-rejected-call', name: 'phone_execution', arguments: args,
      agent: rejectedAgent, signal: new AbortController().signal,
    })
    assert.equal(rejected.isError, true)
    assert.equal(requestBodies.length, bodiesBeforeRejectedSubmit, 'A rejected official approval must not submit to AI-Game')
    assert.deepEqual(
      rejectedSession.events.filter((event: any) => event.type.startsWith('approval/')).map((event: any) => event.type),
      ['approval/asked', 'approval/decided'],
    )
  } finally {
    await ctx.fiber.dispose().catch(() => undefined)
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(temp, { recursive: true, force: true })
    if (previousOrigin === undefined) delete process.env.WEFTMATE_AI_GAME_ORIGIN
    else process.env.WEFTMATE_AI_GAME_ORIGIN = previousOrigin
  }
})
