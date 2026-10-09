import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createPersonalAccessService } from '../src/personal-access/index.mjs'
import { buildConversationContext, MAX_CONVERSATION_CONTEXT_BYTES } from '../src/personal-conversations/context.mjs'
import { canonicalSyncEvent } from '../src/personal-sync/index.mjs'

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const conversationId = `conversation-${uuid(100)}`
const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const event = (n: number, clientSeq: number, kind: string, payload: object) => ({
  eventId: `event-${uuid(n)}`, conversationId, clientSeq, kind,
  occurredAt: '2026-10-03T12:00:00.000Z', payload,
})
const created = event(1, 1, 'conversation.created', { title: 'Synthetic handoff' })
const user = event(2, 2, 'message.created', { messageId: `message-${uuid(2)}`, role: 'user', text: 'Phone question' })
const assistant = event(3, 3, 'message.created', { messageId: `message-${uuid(3)}`, role: 'assistant', text: 'Phone answer' })
const terminal = event(4, 4, 'turn.finished', { turnId: `turn-${uuid(4)}`, status: 'completed' })
const modelIdentity = { modelId: 'actual-model-v1', displayName: 'Original model',
  routeFingerprint: null, hostProfileId: 'host-original' }

function backendFixture() {
  const sessions = new Set<string>()
  let sends = 0
  let holdSend: (() => void) | null = null
  const backend = {
    getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }),
    listModels: async () => [{ id: 'local', name: 'Local', model: 'synthetic', configured: true }],
    preflight: async () => ({ ok: true }),
    createSession: async ({ sessionId }: { sessionId: string }) => { sessions.add(sessionId); return { sessionId } },
    sendMessage: async () => {
      sends++
      if (holdSend) await new Promise<void>((resolve) => { holdSend = resolve })
      return { accepted: true, receiptId: `rpc-${sends}` }
    },
    cancelSession: async () => ({ accepted: true }),
    readEvents: async ({ afterSeq }: { afterSeq: number }) => ({ events: [], nextSeq: afterSeq, hasMore: false }),
    describeSession: async (sessionId: string) => sessions.has(sessionId)
      ? { sessionId, agentPreset: 'personal-remote', modelProfileId: 'local', running: false } : null,
  }
  return { backend, sessions, get sends() { return sends }, hold() { holdSend = () => {} },
    release() { holdSend?.() } }
}

async function api(origin: string, auth: Record<string, string>, method: string, route: string, body?: object) {
  const response = await fetch(`${origin}${route}`, { method,
    headers: { ...auth, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined })
  return { status: response.status, body: await response.json() }
}
async function waitCommand(origin: string, auth: Record<string, string>, commandId: string) {
  for (let n = 0; n < 100; n++) {
    const result = await api(origin, auth, 'GET', `/personal/v1/commands/${commandId}`)
    if (!['pending', 'dispatching'].includes(result.body.command.state)) return result.body.command
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('command did not settle')
}
async function setup(root: string, backend: object, clock?: () => number,
  registerCapability = true) {
  const service = await createPersonalAccessService({ root, port: 0, backend, clock })
  const { origin, hostId } = await service.start()
  const grant = await service.issueSetupGrant()
  const setup = await fetch(`${origin}/personal/v1/auth/setup`, { method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ grant: grant.grant, username: 'Owner', password: 'correct horse battery staple',
      deviceName: 'Phone' }) })
  assert.equal(setup.status, 201)
  const account = await setup.json()
  const auth = { origin, cookie: setup.headers.get('set-cookie')!.split(';')[0],
    'x-weftmate-csrf': account.csrfToken }
  if (registerCapability) {
    const capability = await api(origin, auth, 'POST', '/personal/v1/sync/capabilities',
      { sharedConversations: 1, nativeVersionCode: 11 })
    assert.equal(capability.status, 200, JSON.stringify(capability.body))
    assert.equal(capability.body.nativeVersionCode, 11)
  }
  return { service, origin, hostId, auth }
}

test('bounded phone context records terminal status and omits old messages', () => {
  const complete = buildConversationContext({ latestSeq: 4,
    events: [{ ...user, seq: 2 }, { ...assistant, seq: 3 }, { ...terminal, seq: 4 }] })
  assert.equal(complete.historyMessageCount, 2, 'a turn status is not a message')
  assert.equal(complete.truncated, false)
  assert.match(complete.contextText, /回合已完成/)
  const formattedText = '```js\n  const x = 1;\n\treturn x;\n```\n- first\n  - nested'
  const formatted = buildConversationContext({ latestSeq: 2,
    events: [{ ...user, seq: 2, payload: { ...user.payload, text: formattedText } }] })
  assert.ok(formatted.contextText.includes(formattedText), 'phone code indentation and list lines survive')
  assert.equal(sha(formatted.contextText), formatted.contextHash)
  assert.ok(Buffer.byteLength(formatted.contextText, 'utf8') <= MAX_CONVERSATION_CONTEXT_BYTES)
  const context = buildConversationContext({ latestSeq: 99,
    events: [user, assistant, terminal, { ...assistant, seq: 90, payload: { ...assistant.payload,
      text: '世界'.repeat(20_000) } }] })
  assert.ok(Buffer.byteLength(context.contextText, 'utf8') <= MAX_CONVERSATION_CONTEXT_BYTES)
  assert.equal(sha(context.contextText), context.contextHash)
  assert.equal(context.truncated, true)
  assert.match(context.contextText, /手机记录/)
  const failed = buildConversationContext({ latestSeq: 6, events: [user,
    event(7, 5, 'turn.finished', { turnId: `turn-${uuid(7)}`, status: 'failed', errorCode: 'MODEL_ERROR' }),
    event(8, 6, 'turn.finished', { turnId: `turn-${uuid(8)}`, status: 'interrupted' })] })
  assert.match(failed.contextText, /回合失败/)
  assert.match(failed.contextText, /回合中断/)
})

test('phone terminal model identity is bounded and excludes endpoint or credential fields', () => {
  assert.deepEqual(canonicalSyncEvent({ ...terminal,
    payload: { ...terminal.payload, originalModel: modelIdentity } }).payload.originalModel,
  modelIdentity)
  assert.equal(canonicalSyncEvent(terminal).payload.originalModel, undefined,
    'legacy terminal payload remains byte-for-byte compatible')
  for (const invalid of [
    { ...modelIdentity, endpoint: 'https://example.invalid/v1' },
    { ...modelIdentity, apiKey: 'secret' },
    { ...modelIdentity, routeFingerprint: 'A'.repeat(64) },
    { ...modelIdentity, hostProfileId: '../other' },
    { ...modelIdentity, modelId: 'bad model name' },
  ]) assert.throws(() => canonicalSyncEvent({ ...terminal,
    payload: { ...terminal.payload, originalModel: invalid } }))
})

test('model identity follows phone client order and stays unknown across conflicting devices', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-conversation-model-order-'))
  const fixture = backendFixture()
  const host = await setup(root, fixture.backend)
  try {
    const currentTurn = event(20, 20, 'turn.finished', { turnId: `turn-${uuid(20)}`,
      status: 'completed', originalModel: modelIdentity })
    const oldTurn = event(19, 19, 'turn.finished', { turnId: `turn-${uuid(19)}`,
      status: 'failed', originalModel: { modelId: 'older-model', displayName: 'Older',
        routeFingerprint: 'b'.repeat(64) } })
    const oldUser = event(18, 3, 'message.created', { messageId: `message-${uuid(18)}`,
      role: 'user', text: 'Older offline phone question' })
    assert.equal((await api(host.origin, host.auth, 'POST', '/personal/v1/sync/events',
      { events: [created, user, currentTurn, oldTurn, oldUser] })).status, 200)
    const route = `/personal/v1/sync/conversations/${conversationId}/shared`
    const view = (await api(host.origin, host.auth, 'GET', route)).body
    assert.equal(view.canAdopt, true, 'late upload of an older user event is already covered by terminal client order')
    assert.deepEqual(view.originalModel,
      modelIdentity, 'late upload of an older client turn must not override the latest actual model')
    const other = await fetch(`${host.origin}/personal/v1/auth/login`, { method: 'POST',
      headers: { origin: host.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Owner', password: 'correct horse battery staple',
        deviceName: 'Other phone' }) })
    assert.equal(other.status, 200)
    const otherBody = await other.json()
    const otherAuth = { origin: host.origin, cookie: other.headers.get('set-cookie')!.split(';')[0],
      'x-weftmate-csrf': otherBody.csrfToken }
    const otherTurn = event(30, 1, 'turn.finished', { turnId: `turn-${uuid(30)}`,
      status: 'completed', originalModel: { modelId: 'other-device-model',
        displayName: 'Other device', routeFingerprint: 'c'.repeat(64) } })
    assert.equal((await api(host.origin, otherAuth, 'POST', '/personal/v1/sync/events',
      { events: [otherTurn] })).status, 200)
    assert.equal((await api(host.origin, host.auth, 'GET', route)).body.originalModel, null,
      'cross-device clocks cannot establish which conflicting model ran last')
  } finally { await host.service.close(); rmSync(root, { recursive: true, force: true }) }
})

test('adopt freezes one DSH session, exact phone event maps to one receipt, and restart preserves context', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-conversation-adopt-'))
  const fixture = backendFixture()
  let service: Awaited<ReturnType<typeof createPersonalAccessService>> | null = null
  try {
    let host = await setup(root, fixture.backend)
    service = host.service
    fixture.backend.listModels = async () => [{ id: 'local', name: 'Local', model: 'synthetic',
      configured: true, routeFingerprint: 'a'.repeat(64), baseUrl: 'https://test.invalid/v1',
      credential: 'synthetic-never-public' }]
    const publicModel = (await api(host.origin, host.auth, 'GET', '/personal/v1/models')).body.models[0]
    assert.equal(publicModel.routeFingerprint, 'a'.repeat(64))
    assert.equal(publicModel.baseUrl, undefined)
    assert.equal(publicModel.credential, undefined)
    fixture.backend.listModels = async () => [{ id: 'local', name: 'Local', model: 'synthetic',
      configured: true, routeFingerprint: 'A'.repeat(64) }]
    assert.equal((await api(host.origin, host.auth, 'GET', '/personal/v1/models'))
      .body.models[0].routeFingerprint, null)
    const pushed = await api(host.origin, host.auth, 'POST', '/personal/v1/sync/events',
      { events: [created, user, assistant, { ...terminal,
        payload: { ...terminal.payload, originalModel: modelIdentity } }] })
    assert.equal(pushed.status, 200, JSON.stringify(pushed.body))
    const route = `/personal/v1/sync/conversations/${conversationId}/shared`
    const before = await api(host.origin, host.auth, 'GET', route)
    assert.equal(before.body.syncThroughSeq, 4)
    assert.equal(before.body.canAdopt, true)
    assert.deepEqual(before.body.originalModel, modelIdentity)
    const other = await fetch(`${host.origin}/personal/v1/auth/register`, { method: 'POST',
      headers: { origin: host.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Other', password: 'correct horse battery staple',
        deviceName: 'Other phone' }) })
    assert.equal(other.status, 201)
    const otherBody = await other.json()
    const otherAuth = { origin: host.origin, cookie: other.headers.get('set-cookie')!.split(';')[0],
      'x-weftmate-csrf': otherBody.csrfToken }
    assert.equal((await api(host.origin, otherAuth, 'GET', route)).status, 404)
    assert.equal((await api(host.origin, otherAuth, 'POST', route,
      { requestId: 'other-adopt', modelProfileId: 'local', expectedSyncSeq: 4 })).status, 404)
    const adoption = { requestId: 'adopt-1', modelProfileId: 'local', expectedSyncSeq: 4 }
    const accepted = await api(host.origin, host.auth, 'POST', route, adoption)
    assert.equal(accepted.status, 202, JSON.stringify(accepted.body))
    const command = await waitCommand(host.origin, host.auth, accepted.body.command.commandId)
    assert.equal(command.state, 'accepted_by_dsh')
    assert.equal(command.conversationId, conversationId)
    const sessionId = command.sessionId
    const active = await api(host.origin, host.auth, 'GET', route)
    assert.equal(active.body.binding.sessionId, sessionId)
    assert.equal(active.body.binding.contextHash.length, 64)
    assert.deepEqual(active.body.originalModel, modelIdentity)
    const duplicate = await api(host.origin, host.auth, 'POST', route, adoption)
    assert.equal(duplicate.body.command.commandId, command.commandId)
    assert.equal((await api(host.origin, host.auth, 'POST', route,
      { ...adoption, modelProfileId: 'other' })).status, 409)
    const another = event(5, 5, 'message.created', { messageId: `message-${uuid(5)}`,
      role: 'user', text: 'Continue on computer' })
    assert.equal((await api(host.origin, host.auth, 'POST', '/personal/v1/sync/events',
      { events: [another] })).status, 200)
    const sent = await api(host.origin, host.auth, 'POST', '/personal/v1/commands', {
      requestId: 'continued-1', kind: 'session.message', targetDeviceId: host.hostId,
      sessionId, text: 'Continue on computer', sourceSyncEventId: another.eventId,
    })
    assert.equal(sent.status, 202, JSON.stringify(sent.body))
    const message = await waitCommand(host.origin, host.auth, sent.body.command.commandId)
    assert.equal(message.sourceSyncEventId, another.eventId)
    assert.equal((await api(host.origin, host.auth, 'POST', '/personal/v1/commands', {
      requestId: 'continued-1', kind: 'session.message', targetDeviceId: host.hostId,
      sessionId, text: 'Changed body', sourceSyncEventId: another.eventId,
    })).status, 409)
    const context = await service.getConversationContext({ sessionId, turn: 1, step: 1,
      receiptId: message.receiptId, messageHash: sha('Continue on computer') })
    assert.equal(context.state, 'ready')
    assert.match(context.contextText, /Phone answer/)
    assert.equal(context.throughSeq, 4)
    await assert.rejects(service.getConversationContext({ sessionId, turn: 1, step: 1,
      receiptId: 'rpc-wrong', messageHash: sha('Continue on computer') }),
    (error: { code: string }) => error.code === 'CONVERSATION_CONTEXT_UNAVAILABLE')
    assert.equal((await api(host.origin, host.auth, 'POST', '/personal/v1/commands', {
      requestId: 'continued-2', kind: 'session.message', targetDeviceId: host.hostId,
      sessionId, text: 'Continue on computer', sourceSyncEventId: another.eventId,
    })).status, 409)
    const sameText = await api(host.origin, host.auth, 'POST', '/personal/v1/commands', {
      requestId: 'same-text-different-turn', kind: 'session.message', targetDeviceId: host.hostId,
      sessionId, text: 'Continue on computer',
    })
    assert.equal(sameText.status, 202)
    const nextMessage = await waitCommand(host.origin, host.auth, sameText.body.command.commandId)
    assert.notEqual(nextMessage.receiptId, message.receiptId)
    assert.equal((await service.getConversationContext({ sessionId, turn: 2, step: 1,
      receiptId: nextMessage.receiptId, messageHash: sha('Continue on computer') })).state, 'ready')
    const detail = await api(host.origin, host.auth, 'GET', `/personal/v1/tasks/${message.commandId}`)
    assert.equal(detail.body.conversationId, conversationId)
    const projection = await api(host.origin, host.auth, 'GET', route)
    assert.equal(projection.body.adoptedMessages[0].receiptId, message.receiptId)
    assert.equal(projection.body.lateSegment.count, 0)
    const unadopted = event(6, 6, 'message.created', { messageId: `message-${uuid(6)}`,
      role: 'assistant', text: 'Late phone result' })
    assert.equal((await api(host.origin, host.auth, 'POST', '/personal/v1/sync/events',
      { events: [unadopted] })).status, 200)
    assert.equal((await api(host.origin, host.auth, 'GET', route)).body.lateSegment.events[0].eventId,
      unadopted.eventId)
    const lateTurn = event(9, 9, 'turn.finished', { turnId: `turn-${uuid(9)}`,
      status: 'interrupted', originalModel: { modelId: 'later-model', displayName: 'Later',
        routeFingerprint: 'b'.repeat(64) } })
    assert.equal((await api(host.origin, host.auth, 'POST', '/personal/v1/sync/events',
      { events: [lateTurn] })).status, 200)
    assert.deepEqual((await api(host.origin, host.auth, 'GET', route)).body.originalModel,
      modelIdentity, 'late phone turns cannot change the frozen adoption model identity')
    await service.close(); service = null
    const reopened = await createPersonalAccessService({ root, port: 0, backend: fixture.backend })
    service = reopened
    const restarted = await reopened.start()
    const auth = { ...host.auth, origin: restarted.origin }
    assert.equal((await api(restarted.origin, auth, 'GET', route)).body.binding.sessionId, sessionId)
    assert.equal((await reopened.getConversationContext({ sessionId, turn: 1, step: 1,
      receiptId: message.receiptId, messageHash: sha('Continue on computer') })).contextHash,
    context.contextHash)
  } finally { await service?.close(); rmSync(root, { recursive: true, force: true }) }
})

test('local turn reservation blocks adoption until terminal sync and remains device-scoped', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-conversation-turn-'))
  const fixture = backendFixture()
  const host = await setup(root, fixture.backend)
  try {
    const route = `/personal/v1/sync/conversations/${conversationId}`
    assert.equal((await api(host.origin, host.auth, 'POST', '/personal/v1/sync/events',
      { events: [created, user] })).status, 200)
    const reservation = { requestId: 'local-turn-1', turnId: `turn-${uuid(4)}`,
      sourceSyncEventId: user.eventId }
    const reserved = await api(host.origin, host.auth, 'POST', `${route}/local-turns`, reservation)
    assert.equal(reserved.status, 200, JSON.stringify(reserved.body))
    assert.equal((await api(host.origin, host.auth, 'POST', `${route}/shared`, {
      requestId: 'adopt-during-phone', modelProfileId: 'local', expectedSyncSeq: 2,
    })).body.error.code, 'LOCAL_TURN_RUNNING')
    assert.equal((await api(host.origin, host.auth, 'GET', `${route}/shared`)).body.canAdopt, false)
    assert.equal((await api(host.origin, host.auth, 'POST', '/personal/v1/sync/events',
      { events: [assistant, terminal] })).status, 200)
    const finished = await api(host.origin, host.auth, 'POST', `${route}/local-turns/${reservation.turnId}/finish`,
      { requestId: reservation.requestId })
    assert.equal(finished.body.state, 'finished')
    const adopted = await api(host.origin, host.auth, 'POST', `${route}/shared`, {
      requestId: 'adopt-after-phone', modelProfileId: 'local', expectedSyncSeq: 4,
    })
    assert.equal(adopted.status, 202, JSON.stringify(adopted.body))
    assert.equal((await api(host.origin, host.auth, 'POST', `${route}/local-turns`, {
      requestId: 'second-turn', turnId: `turn-${uuid(6)}`, sourceSyncEventId: user.eventId,
    })).status, 409)
  } finally { await host.service.close(); rmSync(root, { recursive: true, force: true }) }
})

test('context waits for its own persisted receipt and fails closed on an unmatched receipt', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-conversation-receipt-race-'))
  const fixture = backendFixture()
  const host = await setup(root, fixture.backend)
  try {
    const route = `/personal/v1/sync/conversations/${conversationId}/shared`
    assert.equal((await api(host.origin, host.auth, 'POST', '/personal/v1/sync/events',
      { events: [created, user, assistant, terminal] })).status, 200)
    const adopted = await api(host.origin, host.auth, 'POST', route,
      { requestId: 'adopt-race', modelProfileId: 'local', expectedSyncSeq: 4 })
    const sessionId = (await waitCommand(host.origin, host.auth,
      adopted.body.command.commandId)).sessionId
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    const blocked = new Promise<void>((resolve) => { release = resolve })
    fixture.backend.sendMessage = async () => { entered(); await blocked
      return { accepted: true, receiptId: 'rpc-race' } }
    const sent = await api(host.origin, host.auth, 'POST', '/personal/v1/commands', {
      requestId: 'send-race', kind: 'session.message', targetDeviceId: host.hostId,
      sessionId, text: 'Same sentence',
    })
    await started
    const pending = host.service.getConversationContext({ sessionId, turn: 1, step: 1,
      receiptId: 'rpc-race', messageHash: sha('Same sentence') })
    const falseReceipt = host.service.getConversationContext({ sessionId, turn: 1, step: 1,
      receiptId: 'rpc-forged', messageHash: sha('Same sentence') })
    const falseReceiptCheck = assert.rejects(falseReceipt,
      (error: { code: string }) => error.code === 'CONVERSATION_CONTEXT_UNAVAILABLE')
    await new Promise((resolve) => setTimeout(resolve, 200))
    release()
    assert.equal((await waitCommand(host.origin, host.auth, sent.body.command.commandId)).receiptId, 'rpc-race')
    assert.equal((await pending).state, 'ready')
    await falseReceiptCheck
  } finally { await host.service.close(); rmSync(root, { recursive: true, force: true }) }
})

test('expired phone reservation stays unconfirmed across restart until explicit snapshot handoff', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-conversation-uncertain-'))
  const fixture = backendFixture()
  let now = Date.now()
  const clock = () => now
  let host = await setup(root, fixture.backend, clock)
  try {
    const route = `/personal/v1/sync/conversations/${conversationId}`
    assert.equal((await api(host.origin, host.auth, 'POST', '/personal/v1/sync/events',
      { events: [created, user] })).status, 200)
    const reserve = { requestId: 'local-turn-unknown', turnId: `turn-${uuid(10)}`,
      sourceSyncEventId: user.eventId }
    assert.equal((await api(host.origin, host.auth, 'POST', `${route}/local-turns`, reserve)).status, 200)
    await host.service.close()
    const reopened = await createPersonalAccessService({ root, port: 0, backend: fixture.backend, clock })
    const { origin } = await reopened.start()
    host = { ...host, service: reopened, origin, auth: { ...host.auth, origin } }
    now += 61_000
    const state = await api(origin, host.auth, 'GET', `${route}/shared`)
    assert.equal(state.body.reasonCode, 'LOCAL_TURN_UNCONFIRMED')
    assert.equal(state.body.canAdopt, false)
    assert.equal((await api(origin, host.auth, 'POST', `${route}/shared`, {
      requestId: 'adopt-unknown', modelProfileId: 'local', expectedSyncSeq: 2,
    })).body.error.code, 'LOCAL_TURN_UNCONFIRMED')
    const explicit = await api(origin, host.auth, 'POST', `${route}/shared`, {
      requestId: 'adopt-unknown', modelProfileId: 'local', expectedSyncSeq: 2,
      acknowledgeUncertainLocalTurn: true,
    })
    assert.equal(explicit.status, 202, JSON.stringify(explicit.body))
    assert.equal((await api(origin, host.auth, 'POST', `${route}/shared`, {
      requestId: 'adopt-unknown', modelProfileId: 'local', expectedSyncSeq: 2,
    })).status, 409, 'the same request ID with a changed acknowledgement conflicts')
  } finally { await host.service.close(); rmSync(root, { recursive: true, force: true }) }
})

test('old phone source cannot be adopted until that same device declares native 11 capability', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-conversation-native-gate-'))
  const fixture = backendFixture()
  const host = await setup(root, fixture.backend, undefined, false)
  try {
    const route = `/personal/v1/sync/conversations/${conversationId}/shared`
    assert.equal((await api(host.origin, host.auth, 'POST', '/personal/v1/sync/events',
      { events: [created, user, assistant, terminal] })).status, 200)
    assert.equal((await api(host.origin, host.auth, 'GET', route)).body.reasonCode,
      'SOURCE_DEVICE_UPGRADE_REQUIRED')
    assert.equal((await api(host.origin, host.auth, 'POST', route,
      { requestId: 'old-phone-adopt', modelProfileId: 'local', expectedSyncSeq: 4 })).body.error.code,
    'SOURCE_DEVICE_UPGRADE_REQUIRED')
    assert.equal((await api(host.origin, host.auth, 'POST', '/personal/v1/sync/capabilities',
      { sharedConversations: 1, nativeVersionCode: 10 })).status, 400)
    const other = await fetch(`${host.origin}/personal/v1/auth/login`, { method: 'POST',
      headers: { origin: host.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Owner', password: 'correct horse battery staple',
        deviceName: 'Other phone' }) })
    assert.equal(other.status, 200)
    const otherBody = await other.json()
    const otherAuth = { origin: host.origin, cookie: other.headers.get('set-cookie')!.split(';')[0],
      'x-weftmate-csrf': otherBody.csrfToken }
    assert.equal((await api(host.origin, otherAuth, 'POST', '/personal/v1/sync/capabilities',
      { sharedConversations: 1, nativeVersionCode: 11 })).status, 200)
    assert.equal((await api(host.origin, otherAuth, 'GET', route)).body.reasonCode,
      'SOURCE_DEVICE_UPGRADE_REQUIRED', 'another device cannot register the original producer')
    const declared = await api(host.origin, host.auth, 'POST', '/personal/v1/sync/capabilities',
      { sharedConversations: 1, nativeVersionCode: 11 })
    assert.equal(declared.status, 200)
    assert.notEqual(declared.body.deviceId, otherBody.device.id)
    assert.deepEqual((await api(host.origin, host.auth, 'POST', '/personal/v1/sync/capabilities',
      { sharedConversations: 1, nativeVersionCode: 11 })).body, declared.body)
    assert.equal((await api(host.origin, host.auth, 'GET', route)).body.canAdopt, true)
    assert.equal((await api(host.origin, host.auth, 'POST', route,
      { requestId: 'old-phone-adopt', modelProfileId: 'local', expectedSyncSeq: 4 })).status, 202)
  } finally { await host.service.close(); rmSync(root, { recursive: true, force: true }) }
})

test('Apple capability declarations map to compatible stored levels and can be downgraded', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-conversation-apple-capability-'))
  const fixture = backendFixture()
  let host = await setup(root, fixture.backend, undefined, false)
  const route = '/personal/v1/sync/capabilities'
  try {
    assert.equal((await api(host.origin, host.auth, 'POST', '/personal/v1/sync/events',
      { events: [created, user, assistant, terminal] })).status, 200)
    const shared = `/personal/v1/sync/conversations/${conversationId}/shared`
    assert.equal((await api(host.origin, host.auth, 'GET', shared)).body.reasonCode,
      'SOURCE_DEVICE_UPGRADE_REQUIRED')
    for (const body of [
      { platform: 'android', sharedConversations: 1 },
      { platform: 'ios' },
      { platform: 'ios', sharedConversations: 1, accountModelTransfer: 0 },
      { platform: 'ios', sharedConversations: 1, nativeVersionCode: 12 },
    ]) assert.equal((await api(host.origin, host.auth, 'POST', route, body)).status, 400)
    const apple = { platform: 'ios', sharedConversations: 1 }
    const declared = await api(host.origin, host.auth, 'POST', route, apple)
    assert.equal(declared.status, 200)
    assert.deepEqual(declared.body, { deviceId: declared.body.deviceId, ...apple })
    assert.equal((await api(host.origin, host.auth, 'GET', shared)).body.canAdopt, true)
    const savedCapability = () => {
      const saved = JSON.parse(readFileSync(join(root, 'store.json'), 'utf8'))
      return saved.accounts[Object.keys(saved.accounts)[0]].devices[declared.body.deviceId].syncCapabilities
    }
    const first = savedCapability()
    assert.deepEqual(Object.keys(first).sort(), ['declaredAt', 'nativeVersionCode', 'sharedConversations'])
    assert.equal(first.nativeVersionCode, 11,
      'stored 11 is a server compatibility level, not the Apple build number')
    assert.deepEqual((await api(host.origin, host.auth, 'POST', route, apple)).body, declared.body)
    assert.deepEqual(savedCapability(), first, 'identical declarations do not rewrite the store')
    const transfer = { ...apple, accountModelTransfer: 1 }
    assert.deepEqual((await api(host.origin, host.auth, 'POST', route, transfer)).body,
      { deviceId: declared.body.deviceId, ...transfer })
    assert.equal(savedCapability().nativeVersionCode, 12)
    assert.deepEqual((await api(host.origin, host.auth, 'POST', route, apple)).body, declared.body)
    assert.equal(savedCapability().nativeVersionCode, 11,
      'omitting transfer clears a capability the current client no longer declares')
    await host.service.close()
    const reopened = await createPersonalAccessService({ root, port: 0, backend: fixture.backend })
    const { origin } = await reopened.start()
    host = { ...host, service: reopened, origin, auth: { ...host.auth, origin } }
    assert.equal((await api(origin, host.auth, 'GET', shared)).body.canAdopt, true)
    assert.deepEqual((await api(origin, host.auth, 'POST', route, apple)).body, declared.body)
    assert.equal(savedCapability().nativeVersionCode, 11)
    assert.equal((await api(origin, host.auth, 'POST', route,
      { sharedConversations: 1, nativeVersionCode: 12 })).body.nativeVersionCode, 12)
    assert.equal((await api(origin, host.auth, 'POST', route,
      { sharedConversations: 1, nativeVersionCode: 11 })).body.nativeVersionCode, 12,
    'legacy Android declarations retain their existing highest-build behavior')
  } finally { await host.service.close(); rmSync(root, { recursive: true, force: true }) }
})


test('D37 moving an adopted owner conversation into a project preserves its phone binding and sends with both contexts', {skip:process.platform!=='win32'}, async()=>{
  const root=mkdtempSync(join(tmpdir(),'personal-adopt-project-')),folder=join(root,'project');mkdirSync(folder);
  const fixture=backendFixture(),host=await setup(root,fixture.backend);
  try{
    assert.equal((await api(host.origin,host.auth,'POST','/personal/v1/sync/events',{events:[created,user,assistant,terminal]})).status,200);
    const adopted=await api(host.origin,host.auth,'POST',`/personal/v1/sync/conversations/${conversationId}/shared`,{requestId:'adopt-for-project',modelProfileId:'local',expectedSyncSeq:4});
    assert.equal(adopted.status,202,JSON.stringify(adopted.body));const command=await waitCommand(host.origin,host.auth,adopted.body.command.commandId);assert.equal(command.state,'accepted_by_dsh');
    const registered=await api(host.origin,host.auth,'POST','/personal/v1/projects',{requestId:'folder-for-adopted',name:'合成手机项目',rootPath:folder,permission:'write'});assert.equal(registered.status,201);
    const project=registered.body.project;
    const moved=await api(host.origin,host.auth,'PATCH',`/personal/v1/sessions/${command.sessionId}/metadata`,{projectId:project.projectId});assert.equal(moved.status,200,JSON.stringify(moved.body));
    const sent=await api(host.origin,host.auth,'POST','/personal/v1/commands',{requestId:'continue-in-project',kind:'session.message',targetDeviceId:host.hostId,sessionId:command.sessionId,text:'Continue in this project'});assert.equal(sent.status,202,JSON.stringify(sent.body));
    const source=await waitCommand(host.origin,host.auth,sent.body.command.commandId);assert.equal(source.state,'accepted_by_dsh');assert.equal(source.projectId,project.projectId);assert.equal(source.conversationId,conversationId);
    assert.equal((await api(host.origin,host.auth,'GET',`/personal/v1/sync/conversations/${conversationId}/shared`)).body.binding.sessionId,command.sessionId);
  }finally{await host.service.close();rmSync(root,{recursive:true,force:true});}
});
