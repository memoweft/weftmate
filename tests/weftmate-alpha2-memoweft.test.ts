import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repository = fileURLToPath(new URL('../', import.meta.url))
const vendor = join('D:', 'AIProjects', 'WeftMate', 'Runtime', 'HarnessStores', 'dsh-v0.1.7-alpha.2', 'vendor', 'node_modules', '@deepseek-ai')

const waitFor = async (predicate, detail) => {
  const deadline = Date.now() + 5_000
  while (!(await predicate()) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
  assert.ok(await predicate(), detail)
}

const readLines = path => existsSync(path)
  ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  : []

function modelSettings(routes) {
  return Object.freeze({
    async routeFor(provider) { return routes[provider] },
  })
}

async function loadPlugin() {
  // The WeftMate source imports legacy helper functions from a module whose
  // tool dependency is normally resolved by the DSH runtime.  Stage only the
  // two source modules so this test executes them against the isolated Alpha.2
  // vendor, never the active rc.5 runtime.
  const stage = mkdtempSync(join(tmpdir(), 'weftmate-alpha2-memory-module-'))
  const tools = pathToFileURL(join(vendor, 'dsh-tools', 'lib', 'index.js')).href
  const memory = join(stage, 'weftmate-memory.mjs')
  writeFileSync(memory, readFileSync(join(repository, 'src', 'plugins', 'weftmate-memory.mjs'), 'utf8')
    .replace("from '@deepseek-ai/dsh-tools'", `from ${JSON.stringify(tools)}`), 'utf8')
  const alpha = join(stage, 'weftmate-alpha2-memoweft.mjs')
  writeFileSync(alpha, readFileSync(join(repository, 'src', 'plugins', 'weftmate-alpha2-memoweft.mjs'), 'utf8')
    .replace("from '@deepseek-ai/dsh-tools'", `from ${JSON.stringify(tools)}`)
    .replace("from './weftmate-memory.mjs'", `from ${JSON.stringify(pathToFileURL(memory).href)}`), 'utf8')
  return { stage, plugin: await import(`${pathToFileURL(alpha).href}?${Date.now()}`) }
}

async function officialCarrier() {
  const [cordis, session, llm, systemPrompt, tools, projections, agentRegistry, agentLoop] = await Promise.all([
    import(pathToFileURL(join(vendor, 'cordis', 'lib', 'index.js')).href),
    import(pathToFileURL(join(vendor, 'dsh-session', 'lib', 'index.js')).href),
    import(pathToFileURL(join(vendor, 'dsh-llm', 'lib', 'index.js')).href),
    import(pathToFileURL(join(vendor, 'dsh-system-prompt', 'lib', 'index.js')).href),
    import(pathToFileURL(join(vendor, 'dsh-tools', 'lib', 'index.js')).href),
    import(pathToFileURL(join(vendor, 'dsh-session-projection', 'lib', 'index.js')).href),
    import(pathToFileURL(join(vendor, 'dsh-agent', 'lib', 'index.js')).href),
    import(pathToFileURL(join(vendor, 'dsh-agent-loop', 'lib', 'index.js')).href),
  ])
  return {
    Context: cordis.Context, SessionStore: session.default, Session: session.Session,
    SystemPrompt: systemPrompt.default, ToolRuntime: tools.default,
    SessionProjectionRegistry: projections.default, AgentRegistry: agentRegistry.default,
    AgentLoop: agentLoop.default, LlmRuntime: llm.default, LlmAdapter: llm.LlmAdapter,
    createUserMessage: llm.createUserMessage, createAssistantMessage: llm.createAssistantMessage,
  }
}

function writeStub(root) {
  const packageRoot = join(root, 'memoweft', 'integrations')
  const capture = join(root, 'ingested.jsonl')
  mkdirSync(packageRoot, { recursive: true })
  const source = [
    'import json, os, sys',
    "METHODS = ['capabilities', 'initialize', 'ingest_boundary', 'preview_recall', 'shutdown']",
    'for line in sys.stdin:',
    '    request = json.loads(line)',
    "    method = request.get('method')",
    "    if method == 'capabilities': result = {'protocol': 'memoweft.dsh_rpc', 'protocol_version': 2, 'schema_version': 1, 'methods': METHODS}; ok = True",
    "    elif method == 'initialize': result = {'capabilities': {'protocol': 'memoweft.dsh_rpc', 'protocol_version': 2, 'schema_version': 1, 'methods': METHODS}}; ok = True",
    "    elif method == 'ingest_boundary' and os.environ.get('WEFTMATE_ALPHA2_TEST_MODE') == 'fail': result = None; ok = False",
    "    elif method == 'ingest_boundary':",
    "        with open(os.environ['WEFTMATE_ALPHA2_CAPTURE'], 'a', encoding='utf-8') as output: output.write(json.dumps(request['params']['boundary'], ensure_ascii=False) + '\\n')",
    "        result = {'job_state': 'synthetic_accepted', 'eligible': True}; ok = True",
    "    elif method == 'preview_recall' and os.environ.get('WEFTMATE_ALPHA2_TEST_MODE') == 'preview_fail': result = None; ok = False",
    "    elif method == 'preview_recall': result = {'world_revision': 3, 'preview': {'selected_item_ids': [['cognition', 'tea']], 'rendered_recall': '用户喜欢茉莉花茶。', 'recall_snapshot_token': 'snapshot-tea', 'model_call_count': 0, 'world_write_count': 0}}; ok = True",
    "    elif method == 'shutdown': result = {'closed': True}; ok = True",
    "    else: result = None; ok = False",
    "    response = {'protocol': 'memoweft.dsh_rpc', 'protocol_version': 2, 'schema_version': 1, 'request_id': request.get('request_id'), 'ok': ok}",
    "    if ok: response['result'] = result",
    "    else: response['error'] = {'code': 'synthetic_failure'}",
    '    print(json.dumps(response), flush=True)',
    "    if method == 'shutdown': break",
  ].join('\n')
  writeFileSync(join(root, 'memoweft', '__init__.py'), '')
  writeFileSync(join(packageRoot, '__init__.py'), '')
  writeFileSync(join(packageRoot, 'dsh_bridge.py'), source)
  return capture
}

async function contextWithOfficialSession(Context, SessionStore, SystemPrompt, ToolRuntime) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  ctx.provide('connection', { fetch: { register: () => () => {} } })
  return ctx
}

test('Alpha.2 MemoWeft records one official completed turn, persists retry work, and de-duplicates after restart', async () => {
  const old = Object.fromEntries([
    'DSH_HOME', 'WEFTMATE_ALPHA2_MEMOWEFT_ENABLED', 'WEFTMATE_MEMOWEFT_PYTHONPATH',
    'WEFTMATE_ALPHA2_CAPTURE', 'WEFTMATE_ALPHA2_TEST_MODE',
  ].map(key => [key, process.env[key]]))
  const home = mkdtempSync(join(tmpdir(), 'weftmate-alpha2-memory-home-'))
  const pythonRoot = mkdtempSync(join(tmpdir(), 'weftmate-alpha2-memory-python-'))
  let staged
  let first
  let second
  let third
  try {
    const capture = writeStub(pythonRoot)
    process.env.DSH_HOME = home
    process.env.WEFTMATE_ALPHA2_MEMOWEFT_ENABLED = '1'
    process.env.WEFTMATE_MEMOWEFT_PYTHONPATH = pythonRoot
    process.env.WEFTMATE_ALPHA2_CAPTURE = capture
    const { plugin, stage } = await loadPlugin(); staged = stage
    const { Context, SessionStore, Session, SystemPrompt, ToolRuntime, createUserMessage, createAssistantMessage } = await officialCarrier()

    // First process: the real Alpha.2 in-memory SessionStore publishes each
    // canonical event.  The synthetic Core rejects ingest, so turn work must
    // remain durable without affecting the official session itself.
    process.env.WEFTMATE_ALPHA2_TEST_MODE = 'fail'
    first = await contextWithOfficialSession(Context, SessionStore, SystemPrompt, ToolRuntime)
    plugin.apply(first)
    const session = first.sessions.create('alpha2-memoweft-official-carrier')
    session.append('turn/start', { turn: 1 })
    const user = createUserMessage({ content: [{ type: 'text', text: '请记住我喜欢茉莉花茶。' }], source: { kind: 'user' } })
    session.append('user/message', user, { surfaceOp: 'append' })
    const assistant = createAssistantMessage({ content: [{ type: 'text', text: '我会在本轮结束后交给记忆系统。' }], source: { provider: 'synthetic', model: 'synthetic' } })
    session.append('assistant/message', { stream: [], turn: 1, step: 1, message: assistant }, { surfaceOp: 'append' })
    const end = session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const stateFile = join(home, 'memoweft-alpha2', 'pending-turns.json')
    await waitFor(() => existsSync(stateFile) && JSON.parse(readFileSync(stateFile, 'utf8')).pending.length === 1, 'failed ingest must keep exactly one durable pending turn')
    assert.deepEqual(session.snapshotEvents().map(event => event.type), ['turn/start', 'user/message', 'assistant/message', 'turn/end'])
    assert.equal((await first.weftmateAlpha2Memory.status()).pending, 1)
    await first.fiber.dispose(); first = null

    // Second process drains the persisted queue through a fresh Python stub.
    process.env.WEFTMATE_ALPHA2_TEST_MODE = 'accept'
    second = await contextWithOfficialSession(Context, SessionStore, SystemPrompt, ToolRuntime)
    plugin.apply(second)
    await waitFor(() => readLines(capture).length === 1, 'restart must deliver the one pending official turn to ingest_boundary')
    await waitFor(() => JSON.parse(readFileSync(stateFile, 'utf8')).pending.length === 0, 'accepted turn must be removed from pending state')
    const [boundary] = readLines(capture)
    assert.equal(boundary.parent_session_id, session.id)
    assert.equal(boundary.mode, 'turn')
    assert.deepEqual(boundary.source_messages.map(message => [message.role, message.content]), [
      ['user', '请记住我喜欢茉莉花茶。'],
      ['assistant', '我会在本轮结束后交给记忆系统。'],
    ])
    assert.deepEqual(boundary.source_messages.map(message => message.message_id), [user.id, assistant.id])
    assert.equal(JSON.parse(readFileSync(stateFile, 'utf8')).delivered.length, 1)
    await second.fiber.dispose(); second = null

    // A V4 restart can replay the same durable turn/end to a new listener.
    // Use the official Session snapshot carrier, rather than a hand-written
    // session JSON file, and assert no duplicate Core ingest is created.
    third = await contextWithOfficialSession(Context, SessionStore, SystemPrompt, ToolRuntime)
    plugin.apply(third)
    await waitFor(async () => (await third.weftmateAlpha2Memory.status()).initialized === true, 'restarted bridge must initialize')
    const replay = Session.create(session.id, structuredClone(session.snapshotEvents()))
    third.emit('session/event', replay, end)
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(readLines(capture).length, 1, 'persisted delivered id prevents replayed turn/end from re-ingesting')
    await third.fiber.dispose(); third = null
  } finally {
    await first?.fiber.dispose()
    await second?.fiber.dispose()
    await third?.fiber.dispose()
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    if (staged) rmSync(staged, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
    rmSync(pythonRoot, { recursive: true, force: true })
  }
})

test('Alpha.2 holds an idle inbox behind official maintenance so the first V4 request sees a current MemoWeft snapshot', async () => {
  const old = Object.fromEntries([
    'DSH_HOME', 'WEFTMATE_ALPHA2_MEMOWEFT_ENABLED', 'WEFTMATE_MEMOWEFT_PYTHONPATH',
    'WEFTMATE_ALPHA2_CAPTURE', 'WEFTMATE_ALPHA2_TEST_MODE',
  ].map(key => [key, process.env[key]]))
  const home = mkdtempSync(join(tmpdir(), 'weftmate-alpha2-recall-home-'))
  const pythonRoot = mkdtempSync(join(tmpdir(), 'weftmate-alpha2-recall-python-'))
  let staged
  let ctx
  try {
    process.env.DSH_HOME = home
    process.env.WEFTMATE_ALPHA2_MEMOWEFT_ENABLED = '1'
    process.env.WEFTMATE_MEMOWEFT_PYTHONPATH = pythonRoot
    process.env.WEFTMATE_ALPHA2_CAPTURE = writeStub(pythonRoot)
    process.env.WEFTMATE_ALPHA2_TEST_MODE = 'accept'
    const { plugin, stage } = await loadPlugin(); staged = stage
    const carrier = await officialCarrier()
    const {
      Context, SessionStore, SystemPrompt, ToolRuntime, SessionProjectionRegistry,
      AgentRegistry, AgentLoop, LlmRuntime, LlmAdapter, createUserMessage,
    } = carrier
    ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    ctx.provide('connection', { fetch: { register: () => () => {} } })
    ctx.provide('weftmateAlpha2ModelSettings', modelSettings({ local: { provider: 'local', baseURL: 'http://127.0.0.1:8081/v1' } }))
    plugin.apply(ctx)
    const requests = []
    class CapturingAdapter extends LlmAdapter {
      async *stream(request) {
        requests.push(request)
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: '收到' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: '收到' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    ctx.llm.registerAdapter(['local'], new CapturingAdapter())
    await ctx.plugin(AgentLoop, { agents: [] })
    const agent = await ctx.agentLoop.create('alpha2-first-recall', { provider: 'local', model: 'synthetic' })
    assert.ok(agent.ctx.tools.get('recall_memory', agent), 'recall tool is registered in the exact Agent scope')
    agent.followup(createUserMessage({ content: [{ type: 'text', text: '我喜欢什么茶？' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    assert.equal(requests.length, 1, 'one controlled synthetic model request is made')
    const visible = requests[0].messages
      .flatMap(message => message.content)
      .filter(block => block.type === 'text').map(block => block.text).join('\n')
    assert.match(visible, /MemoWeft current World/, 'the first request receives the official runtime-context snapshot')
    assert.match(visible, /茉莉花茶/, 'the current recalled content is visible to that first request')
    assert.equal(visible.includes('could not be read for this request'), false, 'the first request is not allowed to race ahead with an unavailable marker')
    const definition = agent.ctx.tools.get('recall_memory', agent)
    const tool = await definition.execute({ query: '茶' }, { agent, signal: new AbortController().signal })
    assert.equal(tool.ok, true)
    assert.equal(tool.world_revision, 3)
    assert.deepEqual(tool.selected_item_ids, [['cognition', 'tea']])
  } finally {
    await ctx?.fiber.dispose()
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    if (staged) rmSync(staged, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
    rmSync(pythonRoot, { recursive: true, force: true })
  }
})

test('Alpha.2 clears a prior snapshot when a steering user message cannot reserve maintenance', async () => {
  const old = Object.fromEntries([
    'DSH_HOME', 'WEFTMATE_ALPHA2_MEMOWEFT_ENABLED', 'WEFTMATE_MEMOWEFT_PYTHONPATH',
    'WEFTMATE_ALPHA2_CAPTURE', 'WEFTMATE_ALPHA2_TEST_MODE',
  ].map(key => [key, process.env[key]]))
  const home = mkdtempSync(join(tmpdir(), 'weftmate-alpha2-steer-home-'))
  const pythonRoot = mkdtempSync(join(tmpdir(), 'weftmate-alpha2-steer-python-'))
  let staged
  let ctx
  try {
    process.env.DSH_HOME = home
    process.env.WEFTMATE_ALPHA2_MEMOWEFT_ENABLED = '1'
    process.env.WEFTMATE_MEMOWEFT_PYTHONPATH = pythonRoot
    process.env.WEFTMATE_ALPHA2_CAPTURE = writeStub(pythonRoot)
    process.env.WEFTMATE_ALPHA2_TEST_MODE = 'accept'
    const { plugin, stage } = await loadPlugin(); staged = stage
    const carrier = await officialCarrier()
    const {
      Context, SessionStore, SystemPrompt, ToolRuntime, SessionProjectionRegistry,
      AgentRegistry, AgentLoop, LlmRuntime, LlmAdapter, createUserMessage,
    } = carrier
    ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    ctx.provide('connection', { fetch: { register: () => () => {} } })
    ctx.provide('weftmateAlpha2ModelSettings', modelSettings({ local: { provider: 'local', baseURL: 'http://127.0.0.1:8081/v1' } }))
    plugin.apply(ctx)
    const firstStarted = Promise.withResolvers()
    const releaseFirst = Promise.withResolvers()
    const requests = []
    class SteeringAdapter extends LlmAdapter {
      async *stream(request) {
        requests.push(request)
        if (requests.length === 1) {
          firstStarted.resolve()
          await releaseFirst.promise
        }
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: '继续' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: '继续' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    ctx.llm.registerAdapter(['local'], new SteeringAdapter())
    await ctx.plugin(AgentLoop, { agents: [] })
    const agent = await ctx.agentLoop.create('alpha2-steering-recall', { provider: 'local', model: 'synthetic' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: '我喜欢什么茶？' }], source: { kind: 'user' } }))
    await firstStarted.promise
    agent.steer(createUserMessage({ content: [{ type: 'text', text: '补充一个新问题。' }], source: { kind: 'user' } }))
    releaseFirst.resolve()
    await agent.whenIdle()
    assert.equal(requests.length, 2, 'the steering input receives its own official next step')
    const firstVisible = requests[0].messages.flatMap(message => message.content).filter(block => block.type === 'text').map(block => block.text).join('\n')
    const secondVisible = requests[1].messages.flatMap(message => message.content).filter(block => block.type === 'text').map(block => block.text).join('\n')
    assert.match(firstVisible, /茉莉花茶/, 'the initial first request used the completed snapshot')
    assert.match(secondVisible, /could not be read for this request/, 'a maintenance-rejected steering input clears the old snapshot before its next step')
    assert.equal(secondVisible.includes('茉莉花茶'), false, 'the stale snapshot cannot leak into the steering step')
  } finally {
    await ctx?.fiber.dispose()
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    if (staged) rmSync(staged, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
    rmSync(pythonRoot, { recursive: true, force: true })
  }
})

test('Alpha.2 releases maintenance after a failed recall and sends an explicit unavailable marker', async () => {
  const old = Object.fromEntries([
    'DSH_HOME', 'WEFTMATE_ALPHA2_MEMOWEFT_ENABLED', 'WEFTMATE_MEMOWEFT_PYTHONPATH',
    'WEFTMATE_ALPHA2_CAPTURE', 'WEFTMATE_ALPHA2_TEST_MODE',
  ].map(key => [key, process.env[key]]))
  const home = mkdtempSync(join(tmpdir(), 'weftmate-alpha2-recall-failure-home-'))
  const pythonRoot = mkdtempSync(join(tmpdir(), 'weftmate-alpha2-recall-failure-python-'))
  let staged
  let ctx
  try {
    process.env.DSH_HOME = home
    process.env.WEFTMATE_ALPHA2_MEMOWEFT_ENABLED = '1'
    process.env.WEFTMATE_MEMOWEFT_PYTHONPATH = pythonRoot
    process.env.WEFTMATE_ALPHA2_CAPTURE = writeStub(pythonRoot)
    process.env.WEFTMATE_ALPHA2_TEST_MODE = 'preview_fail'
    const { plugin, stage } = await loadPlugin(); staged = stage
    const carrier = await officialCarrier()
    const {
      Context, SessionStore, SystemPrompt, ToolRuntime, SessionProjectionRegistry,
      AgentRegistry, AgentLoop, LlmRuntime, LlmAdapter, createUserMessage,
    } = carrier
    ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    ctx.provide('connection', { fetch: { register: () => () => {} } })
    ctx.provide('weftmateAlpha2ModelSettings', modelSettings({ local: { provider: 'local', baseURL: 'http://127.0.0.1:8081/v1' } }))
    plugin.apply(ctx)
    const requests = []
    class FailureAdapter extends LlmAdapter {
      async *stream(request) {
        requests.push(request)
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: '继续正常回复' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: '继续正常回复' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    ctx.llm.registerAdapter(['local'], new FailureAdapter())
    await ctx.plugin(AgentLoop, { agents: [] })
    const agent = await ctx.agentLoop.create('alpha2-recall-failure', { provider: 'local', model: 'synthetic' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: '记忆是否可用？' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    assert.equal(requests.length, 1, 'a failed zero-write recall never blocks the ordinary model turn')
    const visible = requests[0].messages.flatMap(message => message.content).filter(block => block.type === 'text').map(block => block.text).join('\n')
    assert.match(visible, /could not be read for this request/, 'the failed read clears any prior snapshot explicitly')
    assert.equal((await ctx.weftmateAlpha2Memory.status()).recall_preflight, 'idle', 'maintenance releases after the failed RPC')
  } finally {
    await ctx?.fiber.dispose()
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    if (staged) rmSync(staged, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
    rmSync(pythonRoot, { recursive: true, force: true })
  }
})

test('Alpha.2 withholds recall through the formal route service for remote and unknown providers', async () => {
  const old = Object.fromEntries([
    'DSH_HOME', 'WEFTMATE_ALPHA2_MEMOWEFT_ENABLED', 'WEFTMATE_MEMOWEFT_PYTHONPATH',
    'WEFTMATE_ALPHA2_CAPTURE', 'WEFTMATE_ALPHA2_TEST_MODE',
  ].map(key => [key, process.env[key]]))
  const home = mkdtempSync(join(tmpdir(), 'weftmate-alpha2-route-policy-home-'))
  const pythonRoot = mkdtempSync(join(tmpdir(), 'weftmate-alpha2-route-policy-python-'))
  let staged
  let ctx
  try {
    process.env.DSH_HOME = home
    process.env.WEFTMATE_ALPHA2_MEMOWEFT_ENABLED = '1'
    process.env.WEFTMATE_MEMOWEFT_PYTHONPATH = pythonRoot
    process.env.WEFTMATE_ALPHA2_CAPTURE = writeStub(pythonRoot)
    process.env.WEFTMATE_ALPHA2_TEST_MODE = 'accept'
    const { plugin, stage } = await loadPlugin(); staged = stage
    const carrier = await officialCarrier()
    const {
      Context, SessionStore, SystemPrompt, ToolRuntime, SessionProjectionRegistry,
      AgentRegistry, AgentLoop, LlmRuntime, LlmAdapter, createUserMessage,
    } = carrier
    for (const provider of ['remote', 'unknown']) {
      ctx = new Context()
      await ctx.plugin(LlmRuntime)
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(AgentRegistry)
      ctx.provide('connection', { fetch: { register: () => () => {} } })
      ctx.provide('weftmateAlpha2ModelSettings', modelSettings({
        remote: { provider: 'remote', baseURL: 'https://example.invalid/v1' },
      }))
      plugin.apply(ctx)
      const requests = []
      class WithheldAdapter extends LlmAdapter {
        async *stream(request) {
          requests.push(request)
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text: '普通回复' }
          yield { type: 'block-end', index: 0, block: { type: 'text', text: '普通回复' } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        }
      }
      ctx.llm.registerAdapter([provider], new WithheldAdapter())
      await ctx.plugin(AgentLoop, { agents: [] })
      const agent = await ctx.agentLoop.create(`alpha2-${provider}-withheld`, { provider, model: 'synthetic' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: '请回忆我喜欢什么茶。' }], source: { kind: 'user' } }))
      await agent.whenIdle()
      assert.equal(requests.length, 1, `${provider} still receives an ordinary AgentLoop turn`)
      const visible = requests[0].messages.flatMap(message => message.content).filter(block => block.type === 'text').map(block => block.text).join('\n')
      assert.match(visible, /memory is withheld for the current model route/, `${provider} receives an explicit fail-closed marker`)
      assert.equal(visible.includes('茉莉花茶'), false, `${provider} receives no recalled content`)
      const tool = await agent.ctx.tools.get('recall_memory', agent).execute({ query: '茶' }, { agent, signal: new AbortController().signal })
      assert.equal(tool.status, 'withheld', `${provider} recall tool is fail-closed too`)
      await ctx.fiber.dispose(); ctx = null
    }
  } finally {
    await ctx?.fiber.dispose()
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    if (staged) rmSync(staged, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
    rmSync(pythonRoot, { recursive: true, force: true })
  }
})

test('Alpha.2 smoke fixture declares a deterministic read-only preview_recall response', () => {
  const fixture = readFileSync(join(repository, 'tests', 'fixtures', 'alpha2-memoweft-stub', 'memoweft', 'integrations', 'dsh_bridge.py'), 'utf8')
  assert.match(fixture, /'preview_recall'/)
  assert.match(fixture, /'model_call_count': 0/)
  assert.match(fixture, /'world_write_count': 0/)
  assert.match(fixture, /'alpha2-smoke-empty'/)
})
