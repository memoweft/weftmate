import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { apply, userForTurn } from '../src/plugins/weftmate-personal-memory.mjs'
import { modelIdleSnapshot } from '../src/plugins/weftmate-personal-model-idle.mjs'
import { scopedForgetPlan } from '../src/personal-memory/forget-model.mjs'
import { DshWebRuntime } from '../src/dsh-web-runtime.ts'
import { createMemoryActions } from '../src/personal-memory/actions.mjs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

for (const check of ['complete batch', 'inference lease']) test(`FIX-50 R1/R3: ${check}`, async () => {
  const hooks = registerHooks({ resolve(specifier, context, next) {
    return specifier === '@deepseek-ai/dsh-llm/message' ? { shortCircuit: true,
      url: 'data:text/javascript,export const createUserMessage = input => ({id:crypto.randomUUID(),role:"user",...input})' } : next(specifier, context)
  } })
  const originalSend = process.send, connected = Object.getOwnPropertyDescriptor(process, 'connected')
  const oldEnabled = process.env.WEFTMATE_PERSONAL_MEMORY_ENABLED
  const handlers = new Map(), disposals: (() => void)[] = [], seen: any[] = []
  const agent: any = { status: 'running', inbox: { hasPending: false }, session: {
    id: 'review-batch', header: { agentPreset: 'personal-shared-chat' }, events: [],
  } }
  process.env.WEFTMATE_PERSONAL_MEMORY_ENABLED = '1'
  Object.defineProperty(process, 'connected', { configurable: true, value: true })
  ;(process as any).send = (frame: any, callback: any) => {
    if (frame.action === 'tool') seen.push({ source: frame.tool.source.text, idle: modelIdleSnapshot([agent], true).idle })
    queueMicrotask(() => process.emit('message', { protocol: frame.protocol, id: frame.id, ok: true,
      result: frame.action === 'tool' ? { state: 'no_action' } : { state: 'ready', contextText: '' } }))
    callback?.()
  }
  try {
    apply({ on: (name: string, fn: any) => handlers.set(name, fn), effect: (fn: any) => disposals.push(fn()) })
    const messages = ['忘掉我的生日。', '等等，先不要执行，先告诉我会删除什么。'].map((text, i) => ({
      id: `batch-${i}`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }],
    }))
    await handlers.get('agent/pre-step')({ agent, turn: 1, messages }, async () => ({ kind: 'enter', messages }))
    assert.equal(seen.length, 1)
    if (check === 'complete batch') assert.equal(seen[0].source, messages.map(m => m.content[0].text).join('\n'))
    else assert.equal(seen[0].idle, true, 'automatic intent classification must not wait for its own agent')
    assert.equal(agent[Symbol.for('weftmate.memoryRecallPending')], undefined)
  } finally {
    disposals.forEach(fn => fn()); hooks.deregister(); (process as any).send = originalSend
    if (connected) Object.defineProperty(process, 'connected', connected); else delete (process as any).connected
    if (oldEnabled === undefined) delete process.env.WEFTMATE_PERSONAL_MEMORY_ENABLED; else process.env.WEFTMATE_PERSONAL_MEMORY_ENABLED = oldEnabled
  }
})

test('FIX-50 R4: cancelling the current IPC request stops selection before any deletion', async () => {
  let request: any, finish!: () => void, deletions = 0
  const gate = new Promise<void>(resolve => { finish = resolve }), replies: any[] = []
  const child = { connected: true, send: (message: any) => replies.push(message) }
  const runtime: any = new DshWebRuntime({ homeDir: process.cwd(), workspaceDir: process.cwd(), personalMemoryRequestHandler: async value => {
    request = value; await gate
    if (!request.signal.aborted) deletions++
    return { state: request.signal.aborted ? 'cancelled' : 'applied' }
  } })
  runtime.child = child
  const frame = { protocol: 'weftmate.personal-memory.v1', id: `memory-${randomUUID()}`,
    action: 'tool', sessionId: 'synthetic-session', turn: 1, tool: { name: 'memory_forget_request' } }
  runtime.handlePersonalMemoryMessage(child, frame)
  await Promise.resolve()
  runtime.handlePersonalMemoryMessage({}, { protocol: frame.protocol, id: frame.id, action: 'cancel' })
  assert.equal(request.signal.aborted, false, 'another child cannot cancel this operation')
  runtime.handlePersonalMemoryMessage(child, { protocol: frame.protocol, id: frame.id, action: 'cancel' })
  finish(); await gate; await Promise.resolve(); await Promise.resolve()
  assert.equal(deletions, 0)
  assert.equal(replies[0].result.state, 'cancelled')
})

test('FIX-50 R2/M7: a topic match cannot erase a mixed source or a question without the requested fact', async () => {
  let text = '我的生日是五月一日，住址是合成路十八号。'
  let sourceFullyAuthorized = false, hasTargetFact = true
  let worlds: any[] = []
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part
    const body = JSON.parse(raw), name = body.tools[0].function.name
    const input = JSON.parse(body.messages.at(-1).content)
    const enhanced = body.tools[0].function.parameters.properties.items.items.properties.sourceFullyAuthorized
    const items = input.candidates.map((row: any) => ({ key: row.key, matchesTopic: true, subjects: ['self'],
      ...(enhanced ? { sourceFullyAuthorized: row.key === 'cognition:old' ? false : sourceFullyAuthorized, hasTargetFact,
        targetSubjects: hasTargetFact ? ['self'] : [] } : {}) }))
    res.end(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name, arguments: JSON.stringify({ items }) } }] } }] }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const route = { baseUrl: `http://127.0.0.1:${(server.address() as any).port}`, model: 'synthetic', credential: 'synthetic', modelTier: 'cloud' }
  const manager = { async query(_owner: string, method: string, params: any) {
    if (method === 'query_world') return { world_revision: 7, items: params.object_kind === 'cognition' ? worlds : [] }
    if (method === 'preview_forget') return { world_revision: 7, items: worlds, evidence_ids: ['old-source', 'current-source'] }
    if (method === 'preview_recall') return { preview: { recent_evidence: worlds.length ? [] : [{ id: 'source', text }] } }
    if (method === 'query_jobs') return { formation_requests: [] }
    if (method === 'query_evidence') return { evidence: { raw_content: text, content_available: true,
      permissions: { allow_inference: true, allow_cloud_read: true } } }
    throw Error(method)
  } }
  try {
    const action = { scope: { authorized: true, subject: 'self', topic: '我的生日' } }
    const mixed = await scopedForgetPlan(manager, 'synthetic-owner', action, route)
    assert.deepEqual(mixed.evidenceIds, [], 'one authorized topic does not authorize the other fact in its source')
    sourceFullyAuthorized = true; hasTargetFact = false; text = '根据我的记忆，我的生日是什么时候？'
    const question = await scopedForgetPlan(manager, 'synthetic-owner', action, route)
    assert.deepEqual(question.evidenceIds, [], 'a question mentioning the topic does not support the requested memory')
    hasTargetFact = true
    const source = (id: string, raw_content: string) => ({ evidence_id: id, evidence: { raw_content, content_available: true },
      permissions: { allow_inference: true, allow_cloud_read: true } })
    worlds = [
      { object_kind: 'cognition', item_id: 'old', value: { content: '我的生日是五月一日' }, provenance: [source('old-source', '生日和地址两个话题')],
        transition_history: [{ prior_item_id: 'old', replacement_item_id: 'current', transition_kind: 'corrects' }] },
      { object_kind: 'cognition', item_id: 'current', value: { content: '我的生日是五月二日' }, provenance: [source('current-source', '我的生日是五月二日')] },
    ]
    const mixedHistory = await scopedForgetPlan(manager, 'synthetic-owner', action, route)
    assert.deepEqual(mixedHistory.evidenceIds, [], 'an unauthorized historical source prevents a partial success claim for the whole chain')
    assert.deepEqual(mixedHistory.worldTargets, [])
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})

test('FIX-50 R4: a write deadline cancels undispatched work and preserves an already committed receipt', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (const committed of [false, true]) {
    let finish!: () => void, request: any, deleted = false
    const gate = new Promise<void>(resolve => { finish = resolve })
    const replies: any[] = []
    const child = { connected: true, send: (message: any) => replies.push(message) }
    const runtime: any = new DshWebRuntime({ homeDir: process.cwd(), workspaceDir: process.cwd(), personalMemoryRequestHandler: async value => {
      request = value
      if (committed) deleted = true
      await gate
      if (!committed && !request.signal?.aborted) deleted = true
      return { state: deleted ? 'applied' : 'cancelled' }
    } })
    runtime.child = child
    runtime.handlePersonalMemoryMessage(child, { protocol: 'weftmate.personal-memory.v1', id: `memory-${randomUUID()}`,
      action: 'tool', sessionId: 'synthetic-session', turn: 1, tool: { name: 'memory_forget' } })
    await Promise.resolve()
    t.mock.timers.tick(20_001)
    assert.equal(request.signal?.aborted, true)
    assert.equal(replies.length, 0, 'the deadline cannot discard the actual write receipt')
    finish(); await gate; await Promise.resolve(); await Promise.resolve()
    assert.equal(deleted, committed)
    assert.equal(replies.length, 1)
    assert.equal(replies[0].result.state, committed ? 'applied' : 'cancelled')
  }
})

test('FIX-50 R4: automatic classification retains its existing 360 second budget and cancels before dispatch at that deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let finish!: () => void, request: any
  const gate = new Promise<void>(resolve => { finish = resolve }), replies: any[] = []
  const child = { connected: true, send: (message: any) => replies.push(message) }
  const runtime: any = new DshWebRuntime({ homeDir: process.cwd(), workspaceDir: process.cwd(), personalMemoryRequestHandler: async value => {
    request = value; await gate; return { state: request.signal.aborted ? 'cancelled' : 'applied' }
  } })
  runtime.child = child
  runtime.handlePersonalMemoryMessage(child, { protocol: 'weftmate.personal-memory.v1', id: `memory-${randomUUID()}`,
    action: 'tool', sessionId: 'synthetic-session', turn: 1, tool: { name: 'memory_forget_request' } })
  await Promise.resolve(); t.mock.timers.tick(20_001)
  assert.equal(request.signal.aborted, false, 'automatic selection must not inherit the unrelated short tool deadline')
  t.mock.timers.tick(340_000); assert.equal(request.signal.aborted, true)
  assert.equal(replies.length, 0)
  finish(); await gate; await Promise.resolve(); await Promise.resolve()
  assert.equal(replies[0].result.state, 'cancelled')
})

test('FIX-50 R4: cancellation during selection leaves no command and no retryable deletion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-cancel-forget-'))
  let release!: () => void, entered!: () => void, commands = 0
  const started = new Promise<void>(resolve => { entered = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  const controller = new AbortController()
  const actions = createMemoryActions({ root, schedule() {}, manager: () => ({
    async revalidateForget(_owner: string, action: any) { return action.scope ?? action.plan?.authorization ?? { authorized: true } },
    async planForget() { entered(); await gate; return { evidenceIds: ['synthetic-source'], authorization: { authorized: true } } },
    async query() { return { world_revision: 1 } },
    async submitCommand() { commands++; return { result_state: 'applied' } },
  }) })
  try {
    const pending = actions.submit('synthetic-owner', { requestId: 'cancel-selection', name: 'memory_forget', arguments: {}, signal: controller.signal })
    await started; controller.abort(); release()
    assert.equal((await pending).state, 'cancelled')
    await actions.resume('synthetic-owner')
    assert.equal(commands, 0)
    assert.equal(await actions.pending('synthetic-owner'), false)
  } finally { release?.(); await actions.close(); await rm(root, { recursive: true, force: true }) }
})

test('FIX-50 R4: cancellation after dispatch cannot turn a lost receipt into a claim that nothing was deleted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-cancel-receipt-'))
  const controller = new AbortController()
  const actions = createMemoryActions({ root, schedule() {}, manager: () => ({
    async revalidateForget(_owner: string, action: any) { return action.scope ?? action.plan?.authorization ?? { authorized: true } },
    async planForget() { return { version: 2, worldRevision: 1, evidenceIds: ['synthetic-source'], authorization: { authorized: true } } },
    async query() { return { world_revision: 1 } },
    async submitCommand() { controller.abort(); throw Error('transport lost after Core commit') },
  }) })
  try {
    const result = await actions.submit('synthetic-owner', { requestId: 'cancel-receipt', name: 'memory_forget', arguments: {}, signal: controller.signal })
    assert.equal(result.state, 'queued', 'only a Core receipt can establish whether an accepted write was applied')
    assert.equal(await actions.pending('synthetic-owner'), true)
  } finally { await actions.close(); await rm(root, { recursive: true, force: true }) }
})

for (const legacy of [false, true]) test(`FIX-50 authorization fence: ${legacy ? 'rebuilding a legacy plan cannot include later sources' : 'a new revision after preview cannot expand deletion'}`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-forget-fence-'))
  let deleted = false, expected: number | undefined
  const action = { requestId: 'frozen-authorization', name: 'memory_forget', arguments: {}, source: { text: '忘掉我的生日' } }
  const actions = createMemoryActions({ root, schedule() {}, manager: () => ({
    async revalidateForget(_owner: string, action: any) { return action.scope ?? action.plan?.authorization ?? { authorized: true } },
    async planForget() { return { version: 2, worldRevision: 7, authorization: { authorized: true },
      evidenceIds: [], authorizedEvidenceIds: legacy ? ['old-source', 'new-source'] : ['old-source'],
      affectedIds: legacy ? ['old-item', 'new-item'] : ['old-item'], worldTargets: [{ kind: 'cognition', id: 'old-item' }] } },
    async query() { return { world_revision: 8 } },
    async submitCommand(_owner: string, command: any) {
      expected = command.expectedWorldRevision
      if (expected === 8) { deleted = true; return { result_state: 'applied', after_revision: 9 } }
      return { result_state: 'revision_conflict', after_revision: 8 }
    },
  }) })
  try {
    if (legacy) {
      const directory = join(root, 'accounts', 'synthetic-owner', 'memory-home'); await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'pending-actions.json'), JSON.stringify({ records: { [action.requestId]: { ...action,
        plan: { version: 1, authorization: { authorized: true }, evidenceIds: ['old-source'], affectedIds: ['old-item'], worldTargets: [] } } } }))
    }
    const result = await actions.submit('synthetic-owner', action)
    assert.equal(deleted, false)
    assert.equal(result.state, 'withheld')
    assert.equal(expected, legacy ? undefined : 7)
    assert.equal(await actions.pending('synthetic-owner'), false, 'a changed scope requires a new user confirmation')
  } finally { await actions.close(); await rm(root, { recursive: true, force: true }) }
})

test('correction provenance comes from the actual DSH message without trimming or a model-selected identity', () => {
  const raw = '  我其实更喜欢绿茶。\n请纠正。  '
  const source = userForTurn({ header: { agentPreset: 'personal-shared-chat' }, events: [
    { seq: 1, type: 'turn/start', data: { turn: 3 } },
    { seq: 2, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '实际前文' }] } } },
    { seq: 3, time: 1787000000123, type: 'user/message', data: { id: 'actual-user-message', source: { kind: 'user' }, content: [{ type: 'text', text: raw }] } },
  ] }, 3, 16000, true)
  assert.deepEqual(source.message, { message_id: 'actual-user-message', content: raw, timestamp: 1787000000, preceding_ai_context: '实际前文' })
})
