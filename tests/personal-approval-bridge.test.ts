import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { DshWebRuntime } from '../src/dsh-web-runtime.ts'

const vendor = (name: string) => pathToFileURL(join(process.cwd(), 'vendor/dsh-runtime/node_modules/@deepseek-ai', name, 'lib/index.js')).href
const deferred = () => {
  let resolve!: (value?: any) => void
  const promise = new Promise<any>(done => { resolve = done })
  return { promise, resolve }
}
async function until(check: () => unknown) {
  for (let i = 0; i < 300; i++) {
    if (check()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('isolated approval fixture did not settle')
}

async function nativeFixture({ toolName = 'fixture_action', askedName = toolName, stage = 'gate',
  initialStatus = 'answered', decision = 'allowed-once', holdResolution = false, failResolution = false,
  failUncertainObservation = false, failFinish = false, cancelledStatus = 'resolved', policy = 'ask', allowAll = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'personal-native-approval-'))
  const staged = join(root, 'desktop.mjs')
  writeFileSync(staged, readFileSync(join(process.cwd(), 'src/plugins/weftmate-personal-desktop.mjs'), 'utf8')
    .replace("from '@deepseek-ai/dsh-tools'", `from '${vendor('dsh-tools')}'`)
    .replace("from '@deepseek-ai/dsh-agent'", `from '${pathToFileURL(join(process.cwd(), "vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-agent/lib/index.js")).href}'`)
    .replace("from '@deepseek-ai/dsh-plan-mode'", `from '${pathToFileURL(join(process.cwd(), 'vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-plan-mode/lib/index.js')).href}'`)
    .replace("from './personal-approval-policy.mjs'", `from '${pathToFileURL(join(process.cwd(), 'src/plugins/personal-approval-policy.mjs')).href}'`)
    .replace("from '@deepseek-ai/dsh-sandbox-policy'", `from '${pathToFileURL(join(process.cwd(), "vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-sandbox-policy/lib/index.js")).href}'`)
    .replace("from './personal-web-fetch.mjs'", `from '${pathToFileURL(join(process.cwd(), "src/plugins/personal-web-fetch.mjs")).href}'`)
    .replace("from './personal-native-files.mjs'", `from '${pathToFileURL(join(process.cwd(), "src/plugins/personal-native-files.mjs")).href}'`)
    .replace("from '../runtime/dsh-adapter/source-range.mjs'", `from '${pathToFileURL(join(process.cwd(), "src/runtime/dsh-adapter/source-range.mjs")).href}'`))
  const [plugin, { Context, Service }, { default: SystemPrompt }, { default: Sessions }, tools,
    { default: ApprovalService }, { createScope }] = await Promise.all([
    import(pathToFileURL(staged).href), import(vendor('cordis')), import(vendor('dsh-system-prompt')),
    import(vendor('dsh-session')), import(vendor('dsh-tools')), import(vendor('dsh-user-approval')), import(vendor('dsh-scope')),
  ])
  const ctx = new Context(), frames: any[] = [], states = new Map<string, any>(), agents = new Map<string, any>()
  class FixtureAgents extends Service {
    constructor(serviceCtx: any) { super(serviceCtx, 'agents') }
    get(id: string) { return agents.get(id) }
  }
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false, persona: '' })
  await ctx.plugin(Sessions)
  await ctx.plugin(tools.default, { mode: 'native', maxParallelSubCalls: 4 })
  await ctx.plugin(ApprovalService, { policy })
  await ctx.plugin(FixtureAgents)
  const session = ctx.sessions.create('approval-' + randomUUID().slice(0, 8), { meta: { agentPreset: 'personal-remote' } })
  const agent: any = { id: session.id, session, ctx: null, options: {}, status: 'running', inbox: {},
    cancel() {}, whenIdle: async () => {}, runMaintenance: async (work: any) => work(new AbortController().signal),
    send() {}, followup() {}, steer() {}, inject() {} }
  agents.set(session.id, agent); agent.ctx = createScope(ctx, agent).ctx
  const controller = new AbortController(), resolution = deferred()
  let effects = 0, uncertainObserved = false, committedCompletion = false
  const transport = new EventEmitter()
  const bridge = { transport, request: async (frame: any) => {
    frames.push(frame)
    if (frame.action === 'register_approval') {
      const state = { approvalId: frame.approvalId, status: initialStatus,
        ...(initialStatus === 'answered' ? { decisionOutcome: decision } : {}),
        ...(initialStatus === 'resolved' ? { outcome: 'allowed-once' } : {}) }
      states.set(frame.approvalId, state); return { ...state }
    }
    if (frame.action === 'read_approval') return { ...states.get(frame.approvalId) }
    if (frame.action === 'resolve_approval') {
      assert.ok(session.events.some((event: any) => event.type === 'approval/decided' &&
        event.data.id === frame.approvalId && event.data.outcome === frame.outcome))
      if (holdResolution) await resolution.promise
      const state = { approvalId: frame.approvalId, status: frame.outcome === 'cancelled' ? cancelledStatus : 'resolved', outcome: frame.outcome }
      states.set(frame.approvalId, state)
      if (failResolution) throw new Error('synthetic committed approval response lost')
      return state
    }
    if (frame.action === 'finish_execution' && frame.state === 'uncertain') {
      if (committedCompletion) throw Object.assign(new Error('confirmed completion cannot be downgraded'), { code: 'REQUEST_CONFLICT' })
      if (failUncertainObservation) throw new Error('synthetic uncertain observation unavailable')
      uncertainObserved = true
    }
    if (frame.action === 'finish_execution' && frame.state === 'completed' && failFinish) {
      committedCompletion = true
      throw Object.assign(new Error('synthetic committed execution response lost'), { code: 'PERSONAL_TOOL_TIMEOUT' })
    }
    if (frame.action === 'authorize_execution' && uncertainObserved) throw Object.assign(new Error('unknown effect'), { code: 'TASK_NOT_READY' })
    return { executionId: 'exec-' + 'a'.repeat(48), state: frame.state ?? 'running' }
  } }
  const approvals = plugin.installPersonalApprovalBridge(ctx, bridge, { pollDelayMs: 2,
    ...(allowAll ? { policyFor: async () => ({ mode: 'allow-all' }) } : {}) })
  ctx.on('tools/execute', (exec: any, next: any) => plugin.trackPersonalExecution(bridge, exec, next, null, approvals))
  ctx.on('tools/pre-execute', (exec: any, next: any) => stage === 'gate' && exec.name === toolName
    ? { kind: 'ask', reason: 'Allow exactly this fixture action' } : next())
  ctx.get('tools').register(tools.defineTool({ name: toolName, description: 'Isolated approval fixture', parameters: {},
    output: { schema: { type: 'json' }, render: (_args: any, value: any) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (_args: any, exec: any) => {
      if (stage === 'body') {
        const outcome = await ctx.get('approval').request({ agent: exec.agent, toolName: askedName,
          callId: exec.callId, reason: 'Permit this exact tool body action', signal: exec.signal })
        if (outcome !== 'allowed-once') throw new Error('Fixture action was not allowed')
      }
      effects++; return { fixtureEffect: true }
    } }))
  session.append('turn/start', { turn: 1 })
  session.append('user/message', { id: 'source-message-1', source: { kind: 'user', rpcId: 'source-receipt-1' },
    content: [{ type: 'text', text: 'same fixture goal' }] }, { surfaceOp: 'append' })
  session.append('tool/call', { turn: 1, step: 1, callId: 'fixture-call', name: toolName, arguments: '{}' })
  const execute = (callId = 'fixture-call') => ctx.get('tools').execute({ name: toolName, arguments: {}, agent, callId, signal: controller.signal })
  return { ctx, plugin, agent, agents, session, frames, states, controller, transport, approvals, execute, resolution,
    get effects() { return effects }, get committedCompletion() { return committedCompletion },
    close: async () => { approvals.close(); assert.equal(transport.listenerCount('disconnect'), 0);
      await ctx.fiber.dispose(); rmSync(root, { recursive: true, force: true }) } }
}

test('all allowed still uses native approval outcomes but bypasses human cards, and unavailable never executes', async () => {
  const all = await nativeFixture({ initialStatus: 'pending', allowAll: true })
  try {
    const result = await all.execute()
    assert.equal(result.isError, false)
    assert.equal(all.effects, 1)
    assert.equal(all.frames.some(frame => frame.action === 'register_approval'), false)
    assert.ok(all.session.events.some(event => event.type === 'approval/decided' && event.data.outcome === 'allowed-once'))
  } finally { await all.close() }
  const expired = await nativeFixture({ initialStatus: 'unavailable' })
  try {
    const result = await expired.execute()
    assert.equal(result.isError, true)
    assert.equal(expired.effects, 0)
    assert.ok(expired.session.events.some(event => event.type === 'approval/decided' && event.data.outcome === 'unavailable'))
  } finally { await expired.close() }
})

test('fixed ApprovalService and ToolRuntime deliver approved/rejected native decisions without forcing automatic tools to ask', async () => {
  for (const stage of ['gate', 'body']) for (const decision of ['allowed-once', 'rejected']) {
    const f = await nativeFixture({ stage, decision })
    try {
      const result = await f.execute()
      assert.equal(f.effects, decision === 'allowed-once' ? 1 : 0)
      assert.equal(result.isError, decision === 'rejected')
      assert.equal(f.frames.find(frame => frame.action === 'register_approval').receiptId, 'source-receipt-1')
      assert.equal(f.session.events.find((event: any) => event.type === 'approval/decided').data.outcome, decision)
      await until(() => f.frames.some(frame => frame.action === 'resolve_approval'))
      if (stage === 'body') {
        assert.ok(f.frames.findIndex(frame => frame.action === 'authorize_execution') < f.frames.findIndex(frame => frame.action === 'register_approval'))
        assert.equal(f.frames.find(frame => frame.action === 'finish_execution').state, decision === 'allowed-once' ? 'completed' : 'failed')
      }
    } finally { await f.close() }
  }
  const automatic = await nativeFixture({ stage: 'automatic' })
  try {
    assert.equal((await automatic.execute()).isError, false); assert.equal(automatic.effects, 1)
    assert.equal(automatic.frames.some(frame => frame.action.includes('approval')), false)
  } finally { await automatic.close() }
  const never = await nativeFixture({ policy: 'never' })
  try {
    assert.equal((await never.execute()).isError, true); assert.equal(never.effects, 0)
    assert.equal(never.frames.some(frame => frame.action.includes('approval')), false)
    assert.equal(never.session.events.find((event: any) => event.type === 'approval/decided').data.outcome, 'rejected')
  } finally { await never.close() }
})

test('native approvals still work after 256 tool calls in the same personal turn', async () => {
  const f = await nativeFixture({ stage: 'body' })
  try {
    for (let index = 0; index < 258; index++) {
      const callId = `long-turn-call-${index}`
      f.session.append('tool/call', { turn: 1, step: index + 1, callId, name: 'fixture_action', arguments: '{}' })
      const result = await f.execute(callId)
      assert.equal(result.isError, false, `native approval must still work for call ${index + 1}`)
    }
    assert.equal(f.effects, 258)
    assert.equal(f.frames.filter(frame => frame.action === 'register_approval').length, 258)
  } finally { await f.close() }
})

test('a tool-body ask waits for the native committed decision receipt before finishing its execution receipt', async () => {
  const f = await nativeFixture({ stage: 'body', holdResolution: true })
  try {
    const execution = f.execute()
    await until(() => f.frames.some(frame => frame.action === 'resolve_approval'))
    assert.equal(f.states.values().next().value.status, 'answered')
    assert.equal(f.session.events.find((event: any) => event.type === 'approval/decided').data.outcome, 'allowed-once')
    assert.equal(f.frames.some(frame => frame.action === 'finish_execution'), false)
    f.resolution.resolve()
    assert.equal((await execution).isError, false)
    assert.equal(f.states.values().next().value.status, 'resolved')
    assert.equal(f.frames.find(frame => frame.action === 'finish_execution').state, 'completed')
  } finally { f.resolution.resolve(); await f.close() }
})

test('the verified WeftMod script approval alias preserves actual execution identity and rejects unrelated names', async () => {
  const alias = await nativeFixture({ toolName: 'weftmod_script', askedName: 'weftmod', stage: 'body' })
  try {
    assert.equal((await alias.execute()).isError, false); assert.equal(alias.effects, 1)
    const registration = alias.frames.find(frame => frame.action === 'register_approval')
    assert.equal(registration.toolName, 'weftmod_script')
    assert.equal(alias.session.events.find((event: any) => event.type === 'approval/asked').data.toolName, 'weftmod')
    assert.equal(registration.argumentsHash, alias.frames.find(frame => frame.action === 'authorize_execution').argumentsHash)
  } finally { await alias.close() }
  for (const [toolName, askedName] of [['fixture_action', 'weftmod'], ['weftmod_script', 'pwsh']]) {
    const forged = await nativeFixture({ toolName, askedName, stage: 'body' })
    try {
      assert.equal((await forged.execute()).isError, true); assert.equal(forged.effects, 0)
      assert.equal(forged.frames.some(frame => frame.action === 'register_approval'), false)
      assert.equal(forged.session.events.find((event: any) => event.type === 'approval/decided').data.outcome, 'unavailable')
    } finally { await forged.close() }
  }
})

test('a tool-body effect whose committed approval response is lost becomes uncertain and blocks new root and nested calls', async () => {
  const f = await nativeFixture({ stage: 'body', failResolution: true })
  try {
    const result = await f.execute()
    assert.equal(result.isError, true); assert.equal(f.effects, 1)
    assert.equal(f.session.events.find((event: any) => event.type === 'approval/decided').data.outcome, 'allowed-once')
    assert.ok(f.frames.some(frame => frame.action === 'authorize_execution'))
    assert.ok(f.frames.some(frame => frame.action === 'resolve_approval'))
    const observation = f.frames.find(frame => frame.action === 'finish_execution')
    assert.equal(observation.state, 'uncertain'); assert.equal('resultHash' in observation, false)
    assert.equal(f.states.values().next().value.status, 'resolved')
    const authorized = f.frames.filter(frame => frame.action === 'authorize_execution').length
    assert.equal((await f.ctx.get('tools').execute({ name: 'fixture_action', arguments: {}, agent: f.agent,
      callId: 'new-nested', rootCallId: 'fixture-call', signal: f.controller.signal })).isError, true)
    assert.equal(f.frames.filter(frame => frame.action === 'authorize_execution').length, authorized)
    f.session.append('tool/call', { turn: 1, step: 1, callId: 'new-root', name: 'fixture_action', arguments: '{}' })
    assert.equal((await f.ctx.get('tools').execute({ name: 'fixture_action', arguments: {}, agent: f.agent,
      callId: 'new-root', signal: f.controller.signal })).isError, true)
    assert.equal(f.effects, 1)
  } finally { await f.close() }
  const unavailable = await nativeFixture({ stage: 'body', failResolution: true, failUncertainObservation: true })
  try {
    assert.equal((await unavailable.execute()).isError, true)
    const authorized = unavailable.frames.filter(frame => frame.action === 'authorize_execution').length
    assert.equal((await unavailable.ctx.get('tools').execute({ name: 'fixture_action', arguments: {}, agent: unavailable.agent,
      callId: 'new-nested', rootCallId: 'fixture-call', signal: unavailable.controller.signal })).isError, true)
    assert.equal(unavailable.frames.filter(frame => frame.action === 'authorize_execution').length, authorized)
    assert.equal(unavailable.effects, 1)
  } finally { await unavailable.close() }
})

test('a native cancelled body approval keeps its known cancellation receipt separate from unknown effects', async () => {
  for (const cancelledStatus of ['resolved', 'unavailable']) {
    const f = await nativeFixture({ stage: 'body', initialStatus: 'pending', cancelledStatus })
    try {
      const execution = f.execute(); await until(() => f.frames.some(frame => frame.action === 'register_approval'))
      f.controller.abort(); assert.equal((await execution).isError, true); assert.equal(f.effects, 0)
      assert.equal(f.frames.find(frame => frame.action === 'finish_execution').state, 'cancelled')
      assert.equal(f.session.events.find((event: any) => event.type === 'approval/decided').data.outcome, 'cancelled')
    } finally { await f.close() }
  }
})

test('a lost completed execution receipt closes the local root without downgrading the confirmed completion', async () => {
  const f = await nativeFixture({ stage: 'automatic', failFinish: true })
  try {
    assert.equal((await f.execute()).isError, true); assert.equal(f.effects, 1); assert.equal(f.committedCompletion, true)
    assert.deepEqual(f.frames.filter(frame => frame.action === 'finish_execution').map(frame => frame.state), ['completed', 'uncertain'])
    const authorized = f.frames.filter(frame => frame.action === 'authorize_execution').length
    assert.equal((await f.ctx.get('tools').execute({ name: 'fixture_action', arguments: {}, agent: f.agent,
      callId: 'new-nested', rootCallId: 'fixture-call', signal: f.controller.signal })).isError, true)
    assert.equal(f.frames.filter(frame => frame.action === 'authorize_execution').length, authorized)
    assert.equal(f.effects, 1); assert.equal(f.committedCompletion, true)
  } finally { await f.close() }
})

test('cancelled, replaced and historical approvals cannot consume a later allowed answer', async () => {
  for (const interruption of ['cancel', 'replace', 'disconnect']) {
    const f = await nativeFixture({ initialStatus: 'pending' })
    try {
      const execution = f.execute()
      await until(() => f.frames.some(frame => frame.action === 'register_approval'))
      if (interruption === 'cancel') f.controller.abort()
      else if (interruption === 'replace') f.agents.set(f.agent.id, { ...f.agent })
      else f.transport.emit('disconnect')
      for (const state of f.states.values()) { state.status = 'answered'; state.decisionOutcome = 'allowed-once' }
      assert.equal((await execution).isError, true); assert.equal(f.effects, 0)
      const outcome = f.session.events.find((event: any) => event.type === 'approval/decided').data.outcome
      assert.equal(outcome, interruption === 'cancel' ? 'cancelled' : 'unavailable')
      assert.equal(f.frames.some(frame => frame.action === 'authorize_execution'), false)
    } finally { await f.close() }
  }
  const historical = await nativeFixture({ initialStatus: 'resolved' })
  try {
    assert.equal((await historical.execute()).isError, true); assert.equal(historical.effects, 0)
    assert.equal(historical.session.events.find((event: any) => event.type === 'approval/decided').data.outcome, 'unavailable')
  } finally { await historical.close() }
})

test('a durable task-stop approval reports native cancellation before its abort signal arrives', async () => {
  const f = await nativeFixture({ initialStatus: 'pending' })
  try {
    const execution = f.execute(); await until(() => f.frames.some(frame => frame.action === 'register_approval'))
    for (const state of f.states.values()) { state.status = 'unavailable'; state.outcome = 'cancelled' }
    assert.equal(f.controller.signal.aborted, false)
    assert.equal((await execution).isError, true); assert.equal(f.effects, 0)
    assert.equal(f.session.events.find((event: any) => event.type === 'approval/decided').data.outcome, 'cancelled')
    assert.equal(f.frames.some(frame => frame.action === 'authorize_execution'), false)
  } finally { await f.close() }
})

test('durable stop cannot be consumed by a replaced or changed source and other unavailability stays unavailable', async () => {
  for (const interruption of ['replace', 'turn-changed', 'source-changed', 'source-unavailable']) {
    const f = await nativeFixture({ initialStatus: 'pending' })
    try {
      const execution = f.execute(); await until(() => f.frames.some(frame => frame.action === 'register_approval'))
      if (interruption === 'replace') f.agents.set(f.agent.id, { ...f.agent })
      if (interruption === 'turn-changed') {
        f.session.append('turn/end', { turn: 1, reason: 'completed' })
        f.session.append('turn/start', { turn: 2 })
      }
      if (interruption === 'source-changed') {
        f.session.append('user/message', { id: 'different-source', source: { kind: 'user', rpcId: 'different-receipt' },
          content: [{ type: 'text', text: 'same fixture goal' }] }, { surfaceOp: 'append' })
        // Reusing the old call id for this later source cannot inherit its pending approval.
        f.session.append('tool/call', { turn: 1, step: 2, callId: 'fixture-call', name: 'fixture_action', arguments: '{}' })
      }
      for (const state of f.states.values()) {
        state.status = 'unavailable'; state.outcome = interruption === 'source-unavailable' ? 'unavailable' : 'cancelled'
      }
      assert.equal((await execution).isError, true); assert.equal(f.effects, 0)
      assert.equal(f.session.events.find((event: any) => event.type === 'approval/decided').data.outcome, 'unavailable')
      assert.equal(f.frames.some(frame => frame.action === 'authorize_execution'), false)
    } finally { await f.close() }
  }
})

test('the exact user receipt is preserved for equal text in a later turn and a stale source turn is refused', async () => {
  const f = await nativeFixture({ stage: 'automatic' })
  try {
    const before = f.plugin.personalExecutionIdentity({ agent: f.agent, name: 'fixture_action', callId: 'fixture-call' })
    f.session.append('turn/end', { turn: 1, reason: 'completed' })
    f.session.append('turn/start', { turn: 2 })
    f.session.append('user/message', { id: 'source-message-2', source: { kind: 'user', rpcId: 'source-receipt-2' },
      content: [{ type: 'text', text: 'same fixture goal' }] }, { surfaceOp: 'append' })
    f.session.append('tool/call', { turn: 2, step: 1, callId: 'fixture-call-2', name: 'fixture_action', arguments: '{}' })
    const after = f.plugin.personalExecutionIdentity({ agent: f.agent, name: 'fixture_action', callId: 'fixture-call-2' })
    assert.equal(before.messageHash, after.messageHash); assert.notEqual(before.receiptId, after.receiptId)
    assert.equal(after.turn, 2); assert.equal(after.receiptId, 'source-receipt-2')
    assert.throws(() => f.plugin.personalExecutionIdentity({ agent: f.agent, name: 'fixture_action', callId: 'fixture-call' }),
      { code: 'TOOL_SOURCE_UNAVAILABLE' })
    assert.throws(() => f.plugin.personalExecutionIdentity({ agent: f.agent, name: 'fixture_action', callId: 'fixture-call-2', rootCallId: 'invented-call' }),
      { code: 'TOOL_SOURCE_UNAVAILABLE' })
  } finally { await f.close() }
})

function managedChild(sent: any[]) {
  return Object.assign(new EventEmitter(), { connected: true, send: (value: any) => sent.push(value) })
}
const approvalFrame = () => ({ protocol: 'weftmate.personal-desktop.v1', id: 'personal-' + randomUUID(),
  action: 'register_approval', sessionId: 'session-runtime', turn: 1, callId: 'call-runtime', rootCallId: 'call-runtime',
  receiptId: 'receipt-runtime', messageHash: 'a'.repeat(64), toolName: 'pwsh', argumentsHash: 'b'.repeat(64),
  approvalId: randomUUID(), reason: 'Allow the owned fixture command' })

test('a child lifetime fence runs before an in-flight registration resumes and an old close cannot invalidate a new child', async () => {
  const tombstones = new Set<string>(), calls: any[] = [], sealed: string[] = [], sent: any[] = [], continuation = deferred()
  const runtime: any = new DshWebRuntime({ homeDir: 'C:\\synthetic\\dsh-home', workspaceDir: 'C:\\synthetic\\work',
    personalApprovalRuntimeClosedHandler: ({ runtimeId }) => { tombstones.add(runtimeId); sealed.push(runtimeId) },
    personalDesktopRequestHandler: async request => {
      calls.push(request)
      if (calls.length === 1) await continuation.promise
      if (tombstones.has((request as any).runtimeId)) throw new Error('sealed runtime')
      return { ...request, status: 'pending', taskId: 'cmd-' + '1'.repeat(8) + '-1234-4234-8234-123456789abc',
        sourceCommandId: 'cmd-11111111-1234-4234-8234-123456789abc', sourceReceiptId: (request as any).receiptId,
        createdAt: '2026-10-06T00:00:00.000Z' }
    } })
  const old = managedChild(sent); runtime.registerChild(old); runtime.child = old
  runtime.handlePersonalDesktopMessage(old, approvalFrame())
  await until(() => calls.length === 1)
  old.connected = false; old.emit('disconnect')
  assert.deepEqual(sealed, [calls[0].runtimeId])
  const replacement = managedChild(sent); runtime.registerChild(replacement); runtime.child = replacement
  runtime.handlePersonalDesktopMessage(replacement, approvalFrame())
  await until(() => calls.length === 2)
  assert.notEqual(calls[0].runtimeId, calls[1].runtimeId)
  old.emit('close', 0); continuation.resolve()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(tombstones.has(calls[1].runtimeId), false); assert.equal(sent.length, 1)
  assert.equal(sent[0].ok, true); assert.deepEqual(sealed, [calls[0].runtimeId])
  replacement.emit('close', 0); await runtime.close()
  assert.deepEqual(sealed, [calls[0].runtimeId, calls[1].runtimeId])
})

test('closing the runtime seals synchronously, suppresses pre-dispatch requests and awaits durable invalidation', async () => {
  const sealed: string[] = [], calls: any[] = [], sent: any[] = [], persist = deferred()
  const runtime: any = new DshWebRuntime({ homeDir: 'C:\\synthetic\\dsh-home', workspaceDir: 'C:\\synthetic\\work',
    personalApprovalRuntimeClosedHandler: ({ runtimeId }) => { sealed.push(runtimeId); return persist.promise },
    personalDesktopRequestHandler: async request => { calls.push(request); return null } })
  const child = managedChild(sent); runtime.registerChild(child); runtime.child = child
  runtime.terminateChild = async (owned: any) => { owned.emit('close', 0) }
  runtime.handlePersonalDesktopMessage(child, approvalFrame())
  const closing = runtime.close(); let closed = false; void closing.then(() => { closed = true })
  assert.equal(sealed.length, 1)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.length, 0); assert.equal(sent.length, 0); assert.equal(closed, false)
  persist.resolve(); await closing
  assert.equal(closed, true); assert.equal(sealed.length, 1)
})
