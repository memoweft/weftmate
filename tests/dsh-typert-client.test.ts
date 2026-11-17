import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { createTypertAdapterClient } from '../src/runtime/dsh-adapter/typert-client.mjs'
import { unwrap } from '../src/runtime/dsh-adapter/sessions.mjs'

const catalog = { groups: [{ id: 'p', models: [{ id: 'm' }] }], failures: [],
  default: { provider: 'p', model: 'm' }, routableProviders: ['p'] }

function fixture(overrides: any = {}) {
  const calls: any[] = [], listeners = new Map<string, Function[]>(), cleanup: Function[] = []
  const session = { id: 's', events: [] as any[] }
  const ctx: any = {
    sessions: new Map([['s', session]]),
    on(name: string, listener: Function) {
      const entries = listeners.get(name) ?? []
      entries.push(listener); listeners.set(name, entries)
      return () => entries.splice(entries.indexOf(listener), 1)
    },
    effect(factory: Function) { cleanup.push(factory()) },
    typertGateway: { async invoke(request: any) {
      calls.push(request)
      switch (`${request.namespace}/${request.method}`) {
        case 'session/list': return { items: [{ sessionId: 's', projections: { values: { title: 'Title' } } }, { sessionId: 'empty' }] }
        case 'session/events': return { records: [], hasMore: false, cursor: -1 }
        case 'session/modelCatalog': return catalog
        case 'settings/describe': return { namespaces: [] }
        default: return { accepted: true }
      }
    } },
    ...overrides,
  }
  return { ctx, calls, session, listeners, client: createTypertAdapterClient(ctx),
    emit(name: string, ...args: any[]) { return (listeners.get(name) ?? []).map(listener => listener(...args)) },
    async close() { for (const fn of cleanup.reverse()) await fn() },
  }
}

test('Typert session calls use an owner peer, exact named arguments and legacy envelopes', async () => {
  let options: any
  const peer = { principal: { kind: 'owner' }, signal: new AbortController().signal }
  const f = fixture({ connection: { createPeer(value: any) { options = value; return peer } } })
  assert.deepEqual(options, { principal: { kind: 'owner' }, interactions: 'answer' })
  assert.deepEqual((await unwrap(await f.client.sessions.list({}), 'list')).items.map((item: any) => item.title), ['Title', '新对话'])
  assert.deepEqual(f.calls.at(-1).args, { _request: {} })
  for (const method of ['create', 'rename', 'cancel', 'selectModel']) {
    const request = { sessionId: 's', title: 'T', provider: 'p', model: 'm' }
    assert.equal((await f.client.sessions[method](request)).result.ok, true)
    assert.deepEqual(f.calls.at(-1), { namespace: 'session', method, args: { request }, peer, signal: undefined })
  }
  const prompt = await f.client.sessions.prompt({ sessionId: 's', content: [], mode: 'queue' })
  assert.match(prompt.rpcId, /^[a-f0-9-]{36}$/)
  assert.equal(f.calls.at(-1).args.request.requestId, prompt.rpcId)
  assert.equal((await f.client.sessions.prompt({ sessionId: 's', requestId: 'existing' })).rpcId, 'existing')
  assert.deepEqual(await unwrap(await f.client.sessions.history({ sessionId: 's', beforeSeq: 20, maxMessages: 3 }), 'history'),
    { events: [], hasMore: false, cursor: -1 })
  assert.deepEqual(f.calls.at(-1).args, { request: { address: { kind: 'session', sessionId: 's' }, beforeSeq: 20, maxMessages: 3 } })
  await f.client.skills.list({ sessionId: 's' })
  assert.deepEqual(f.calls.at(-1).args, { request: { sessionId: 's' } })
  assert.equal(f.calls.at(-1).namespace, 'skills')
  await f.close()
})

test('model catalog and session selection use resolved Agent, live Agent, then catalog default', async () => {
  const f = fixture()
  assert.deepEqual(await unwrap(await f.client.llm.models({}), 'models'), catalog)
  assert.equal(f.calls.at(-1).peer.ctx, f.ctx)
  assert.deepEqual(f.calls.at(-1).peer.principal, { kind: 'owner' })
  assert.deepEqual(f.calls.at(-1).args, {})
  assert.deepEqual(await unwrap(await f.client.sessions.models({ sessionId: 's' }), 'models'),
    { current: catalog.default, routable: true, groups: catalog.groups, failures: [] })
  f.ctx.agents = new Map([['s', { model: { current: () => ({ provider: 'p', model: 'other' }) } }]])
  assert.equal((await unwrap(await f.client.sessions.models({ sessionId: 's' }), 'models')).routable, false)
  f.ctx.sessionController = { resolveAgent: async () => ({ agent: { model: { current: () => catalog.default } } }) }
  assert.equal((await unwrap(await f.client.sessions.models({ sessionId: 's' }), 'models')).routable, true)
  f.ctx.sessionController.resolveAgent = async () => ({ error: { code: 'session/not-found' } })
  assert.equal((await f.client.sessions.models({ sessionId: 's' })).result.error.code, 'session-not-found')
  await f.close()
})

test('attachment resolves full refs across history pages and caches only within the owning session', async () => {
  const attachment = { attachmentId: `sha256:${'a'.repeat(64)}`, mediaType: 'image/png', bytes: 9, width: 2, height: 3, name: 'a.png' }
  const calls: any[] = []
  const f = fixture({ typertGateway: { async invoke(call: any) {
    calls.push(call)
    if (call.method === 'attachment') return { attachment: call.args.request.attachment, data: 'base64' }
    const { beforeSeq, address } = call.args.request
    if (address.sessionId !== 's') return { records: [], hasMore: false, cursor: -1 }
    return beforeSeq === undefined
      ? { records: [{ event: { seq: 10, type: 'turn/end' } }], hasMore: true, cursor: 10 }
      : { records: [{ event: { seq: 2, type: 'assistant/message', data: { message: { content: [{ type: 'image', attachment }] } } } }], hasMore: false, cursor: 10 }
  } } })
  assert.deepEqual(await unwrap(await f.client.sessions.attachment({ sessionId: 's', attachmentId: attachment.attachmentId }), 'attachment'), { attachment, data: 'base64' })
  assert.deepEqual(calls.at(-1).args, { request: { sessionId: 's', attachment } })
  assert.equal(calls[1].args.request.beforeSeq, 10)
  const count = calls.length
  await f.client.sessions.attachment({ sessionId: 's', attachmentId: attachment.attachmentId })
  assert.equal(calls.length, count + 1)
  assert.equal((await f.client.sessions.attachment({ sessionId: 'other', attachmentId: attachment.attachmentId })).result.error.code, 'attachment-error')
  f.session.events.push({ type: 'user/message', data: { content: [{ type: 'image', attachment: { ...attachment, attachmentId: 'live' } }] } })
  assert.equal((await f.client.sessions.attachment({ sessionId: 's', attachmentId: 'live' })).result.ok, true)
  await f.close()
})

test('workspace registry and follow baseline map identically; mutations retain request wrapper', async () => {
  const ws = { id: 'w', title: 'Work', path: '/work', sessionIds: ['s'], createdAt: 1, updatedAt: 2 }
  const f = fixture({ workspaceRegistry: { list: () => [ws], archivedSessionIds: ['a'], pinnedSessionIds: ['s'] } })
  const expected = { items: [{ workspaceId: 'w', title: 'Work', path: '/work', sessionIds: ['s'], createdAt: 1, updatedAt: 2 }], archivedSessionIds: ['a'], pinnedSessionIds: ['s'] }
  assert.deepEqual(await unwrap(await f.client.workspace.list({}), 'workspace'), expected)
  delete f.ctx.workspaceRegistry
  let closed = false, streamCall: any
  f.ctx.typertGateway.stream = async (call: any) => {
    streamCall = call
    return (async function* () { try { yield { type: 'baseline', value: expected } } finally { closed = true } })()
  }
  assert.deepEqual(await unwrap(await f.client.workspace.list({}), 'workspace'), expected)
  assert.equal(streamCall.namespace, 'workspace'); assert.equal(streamCall.method, 'follow')
  assert.deepEqual(streamCall.args, {}); assert.equal(streamCall.signal.aborted, true); assert.equal(closed, true)
  for (const method of ['create', 'rename', 'delete']) {
    const request = { workspaceId: 'w', path: '/work', title: 'T' }
    await f.client.workspace[method](request)
    assert.deepEqual(f.calls.at(-1).args, { request })
    assert.equal(f.calls.at(-1).namespace, 'workspace'); assert.equal(f.calls.at(-1).method, method)
  }
  await f.close()
})

test('settings aliases normalize layered defaults and map all three write forms without mutating input', async () => {
  const calls: any[] = []
  const registry = { ns: 'agent-preset-registry', value: { selectedDefault: 'one' }, user: { selectedDefault: null }, revision: 2 }
  const f = fixture({ typertGateway: { async invoke(call: any) {
    calls.push(call)
    return call.method === 'describe' ? { writable: true, namespaces: [registry] } : registry
  } } })
  const description = await unwrap(await f.client.settings.describe({ ignored: true }), 'settings')
  assert.deepEqual(calls[0].args, {})
  for (const view of description.namespaces) {
    assert.equal(view.value.default, 'one'); assert.equal(view.value.selectedDefault, 'one')
    assert.equal(view.user.default, null)
  }
  assert.deepEqual(description.namespaces.map((view: any) => view.ns), ['agent-preset-registry', 'agent-presets'])
  for (const [method, field] of [['update', 'patch'], ['replace', 'section']]) {
    const input = { ns: 'agent-presets', [field]: { default: 'two', presets: [] }, expectedRevision: 2 }
    await f.client.settings[method](input)
    assert.deepEqual(calls.at(-1).args, { ns: 'agent-preset-registry', [field]: { selectedDefault: 'two', presets: [] }, expectedRevision: 2 })
    assert.equal(input[field].default, 'two')
  }
  await f.client.settings.mutate({ ns: 'agent-presets', ops: [{ op: 'set', path: ['default'], value: 'two' }] })
  assert.deepEqual(calls.at(-1).args, { ns: 'agent-preset-registry', ops: [{ op: 'set', path: ['selectedDefault'], value: 'two' }] })
  await f.client.settings.update({ ns: 'permission', patch: { default: 'unchanged' } })
  assert.deepEqual(calls.at(-1).args, { ns: 'permission', patch: { default: 'unchanged' } })
  await f.close()
  const fresh = fixture({ typertGateway: f.ctx.typertGateway })
  await fresh.client.settings.update({ ns: 'agent-preset-registry', patch: { default: 'first-write' } })
  assert.deepEqual(calls.at(-1).args, { ns: 'agent-preset-registry', patch: { selectedDefault: 'first-write' } })
  await fresh.close()
})

test('RemoteError mapping preserves image reason and settings conflict through adapter unwrap', async () => {
  const pairs = [
    ['session/not-found', 'session-not-found'], ['session/conflict', 'session-conflict'],
    ['session/agent-busy', 'agent-busy'], ['session/writer-held', 'session-conflict'],
    ['session/attachment-invalid', 'attachment-error'], ['workspace/not-found', 'workspace-not-found'],
    ['workspace/invalid-path', 'workspace-invalid-path'], ['workspace/name-conflict', 'workspace-name-conflict'],
    ['settings/rejected', 'settings-rejected'], ['settings/conflict', 'settings-conflict'], ['gateway/cancelled', 'cancelled'],
  ]
  for (const [code, mapped] of pairs) {
    const details = { reason: 'MODEL_DOES_NOT_SUPPORT_IMAGES' }
    const f = fixture({ typertGateway: { async invoke() { throw Object.assign(new Error('Remote failure'), { code, details }) } } })
    const result = await f.client.sessions.cancel({ sessionId: 's' })
    assert.equal(result.result.error.code, mapped); assert.deepEqual(result.result.error.details, details)
    await assert.rejects(unwrap(result, 'cancel'), (error: any) => error.code === mapped && error.reasonCode === details.reason)
    await f.close()
  }
})

test('Cordis mux carries subscription, session events, approvals, questions and validated response receipts', { timeout: 5000 }, async () => {
  const f = fixture()
  const stream = f.client.events.mux({})
  assert.deepEqual((await stream.next()).value, { payload: { type: 'session/subscribed', sessionId: 's', lastSeq: -1 } })
  assert.equal((await stream.next()).value.payload.sessionId, 'empty')
  const agent = { session: f.session }
  const audit = { type: 'approval/asked', seq: 0, data: { id: 'a', toolName: 'shell', callId: 'c' } }
  f.emit('session/event', f.session, audit)
  assert.deepEqual((await stream.next()).value.payload.event, audit)
  const [approval] = f.emit('approval/request', { agent, toolName: 'shell', callId: 'c' }, () => { throw new Error('unexpected next') })
  const frame = (await stream.next()).value
  assert.equal(frame.payload.type, 'approval/requested'); assert.equal(frame.payload.approvalId, 'a')
  assert.deepEqual(await f.client.respond({ rpcId: frame.rpcId }), { accepted: false, reason: 'bad-response' })
  assert.deepEqual(await f.client.respond({ type: 'client-response', rpcId: frame.rpcId, result: { ok: true, value: { sessionId: 's', approvalId: 'a', outcome: 'allowed-once' } } }), { accepted: true })
  assert.equal(await approval, 'allowed-once')
  assert.equal((await stream.next()).value.payload.type, 'approval/resolved')
  assert.deepEqual(await f.client.respond({ rpcId: frame.rpcId }), { accepted: false, reason: 'not-pending' })
  f.emit('session/event', f.session, { type: 'approval/decided', seq: 1, data: { id: 'a', outcome: 'allowed-once' } })
  assert.equal((await stream.next()).value.payload.type, 'session/event')
  const [question] = f.emit('user-questions/request', { agent, questions: [{ id: 'q', question: 'Which?' }] }, () => undefined)
  const asked = (await stream.next()).value
  assert.equal(asked.payload.type, 'question/requested'); assert.match(asked.rpcId, /^[a-f0-9-]{36}$/)
  const answer = { answers: [{ id: 'q', selected: [], custom: 'This' }] }
  const carrier = (value: any) => ({ type: 'client-response', rpcId: asked.rpcId, result: { ok: true, value } })
  assert.deepEqual(await f.client.respond(carrier({ sessionId: 'other', answer })), { accepted: false, reason: 'bad-response' })
  assert.deepEqual(await f.client.respond(carrier({ sessionId: 's', answer: { answers: [{}] } })), { accepted: false, reason: 'bad-response' })
  assert.deepEqual(await f.client.respond(carrier({ sessionId: 's', answer })), { accepted: true })
  assert.deepEqual(await question, answer)
  assert.deepEqual((await stream.next()).value.payload, { type: 'question/resolved', sessionId: 's', questionRpcId: asked.rpcId, outcome: 'answered' })
  const event = { type: 'turn/start', seq: 4, data: { turn: 1 } }
  f.emit('session/event', { id: 'new' }, event)
  assert.deepEqual((await stream.next()).value.payload, { type: 'session/subscribed', sessionId: 'new', lastSeq: 3 })
  assert.deepEqual((await stream.next()).value.payload, { type: 'session/event', sessionId: 'new', event })
  const host = f.client.events.host({})
  f.emit('api-session/status', 's', true)
  assert.deepEqual((await host.next()).value, { payload: { type: 'host/session-status', sessionId: 's', running: true } })
  await stream.return(); await host.return(); await f.close()
  assert.equal([...f.listeners.values()].flat().length, 0)
})

test('aborts resolve pending interactions and wake blocked readers; no viewer delegates to next', { timeout: 5000 }, async () => {
  const f = fixture(), agent = { session: f.session }
  assert.deepEqual(f.emit('approval/request', { agent }, () => 'next'), ['next'])
  const control = new AbortController(), stream = f.client.events.mux({}, control.signal)
  await stream.next(); await stream.next()
  const questionAbort = new AbortController()
  const [question] = f.emit('user-questions/request', { agent, questions: [], signal: questionAbort.signal }, () => undefined)
  const asked = (await stream.next()).value
  questionAbort.abort()
  assert.equal(await question, undefined)
  assert.equal((await stream.next()).value.payload.outcome, 'cancelled')
  assert.deepEqual(await f.client.respond({ rpcId: asked.rpcId }), { accepted: false, reason: 'not-pending' })
  const [approval] = f.emit('approval/request', { agent, toolName: 'shell' }, () => undefined)
  await stream.next()
  const waiting = stream.next()
  control.abort()
  assert.equal((await waiting).done, true)
  assert.equal(await approval, 'unavailable')
  await f.close()
})

async function proxyModule(legacy = false) {
  let source = await readFile(new URL('../src/plugins/weftmate-personal-api-proxy.mjs', import.meta.url), 'utf8')
  source = source.replace("import { Service } from '@deepseek-ai/cordis'", 'class Service { constructor(ctx, name) { ctx.serviceName = name } }')
  source = source.replace("import('@deepseek-ai/dsh-host-apiproxy')", legacy
    ? 'Promise.resolve({ ApiProxyService: { inject: ["legacy"], Config: {} }, createApiProxy: (ctx, options) => { ctx.options = options; return { sessions: ctx.legacySessions, respond: value => value } } })'
    : `Promise.reject(Object.assign(new Error("Cannot find package '@deepseek-ai/dsh-host-apiproxy'"), { code: 'ERR_MODULE_NOT_FOUND' }))`)
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
}

test('personal plugin loads without legacy package and suppresses only selectModel persistence, including background work', async () => {
  const module = await proxyModule(), saved: any[] = [], cleanup: Function[] = [], background: Promise<any>[] = []
  const ctx: any = { agentDefaultModel: { async saveSelection(selection: any) { saved.push(selection) } },
    sessionController: { async selectModel(selection: any) {
      await Promise.resolve()
      background.push(new Promise(resolve => setImmediate(resolve)).then(() => ctx.agentDefaultModel.saveSelection(selection)))
      return { selected: selection }
    } }, effect(factory: Function) { cleanup.push(factory()) } }
  const originalSave = ctx.agentDefaultModel.saveSelection, originalSelect = ctx.sessionController.selectModel
  new module.PersonalApiProxyService(ctx, {})
  assert.equal(ctx.serviceName, 'weftmatePersonalApiProxy')
  assert.deepEqual(module.PersonalApiProxyService.inject, ['agentDefaultModel', 'sessionController'])
  await Promise.all([ctx.sessionController.selectModel('B'), ctx.agentDefaultModel.saveSelection('A')])
  await Promise.all(background)
  assert.deepEqual(saved, ['A'])
  cleanup[0]()
  assert.equal(ctx.agentDefaultModel.saveSelection, originalSave); assert.equal(ctx.sessionController.selectModel, originalSelect)
  const legacy = await proxyModule(true), sessions = {}
  const oldCtx: any = { legacySessions: sessions, agentDefaultModel: { currentSelection: () => 'A' } }
  const client = new legacy.PersonalApiProxyService(oldCtx, { nativeOpen: false })
  assert.equal(oldCtx.serviceName, 'apiProxy'); assert.equal(client.sessions, sessions)
  assert.equal(oldCtx.options.defaultModelSelection(), 'A'); assert.equal(oldCtx.options.canOpenPath(), false)
  assert.equal(client.respond('response'), 'response')
})

test('host retains legacy injection shape and prefers apiProxy; missing package selects Typert', async () => {
  const original = await readFile(new URL('../src/plugins/weftmate-host.mjs', import.meta.url), 'utf8')
  assert.match(original, /export const inject = \['webServer', 'apiProxy',/)
  for (const legacy of [true, false]) {
    let source = original.replace(/import \{[\s\S]*?\} from '\.\.\/runtime\/gateway\/index\.mjs'/, `
      export const captured = {};
      const STATE_FILE = () => '', REQUEST_FILE = () => '', PERCEPTION_FILE = () => '';
      const readState = () => {}, readPerception = () => {}, serveLegacyWeftmate = () => {};
      const composeWeftmateHandler = () => () => {}, createPerceptionInjector = () => () => {};
      const createGatewayV1 = options => { captured.client = options.client; return { close() {} } };
    `)
    source = source.replace(/import \{ createTypertAdapterClient \}[^\n]+/, 'const createTypertAdapterClient = ctx => { captured.typertContext = ctx; return { stack: "typert" } };')
      .replace(/import \{ nativeTimelineLog \}[^\n]+/, 'const nativeTimelineLog = () => ({ close() {} });')
      .replace(/import \{ nativeSessionLifecycle \}[^\n]+/, 'const nativeSessionLifecycle = () => ({});')
      .replace(/import \{ createNativeCommands \}[^\n]+/, 'const createNativeCommands = () => ({});')
      .replace("import('@deepseek-ai/dsh-host-apiproxy')", legacy
        ? 'Promise.resolve({ InProcessApiClient: class { constructor(handler) { this.handler = handler; this.stack = "legacy" } }, toFetchHandler: apiProxy => ({ apiProxy }) })'
        : `Promise.reject(Object.assign(new Error("Cannot find package '@deepseek-ai/dsh-host-apiproxy'"), { code: 'ERR_MODULE_NOT_FOUND' }))`)
    const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
    const apiProxy = {}, typertGateway = {}
    const ctx = { get: (key: string) => key === 'apiProxy' ? legacy ? apiProxy : undefined : key === 'typertGateway' ? typertGateway : undefined,
      provide() {}, effect() {}, on() {} }
    module.apply(ctx)
    assert.equal(module.captured.client.stack, legacy ? 'legacy' : 'typert')
    assert.equal(module.inject[1], legacy ? 'apiProxy' : 'typertGateway')
    if (legacy) assert.equal(module.captured.client.handler.apiProxy, apiProxy)
    else assert.equal(module.captured.typertContext, ctx)
  }
})
