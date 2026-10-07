import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createPersonalAccessService } from '../src/personal-access/index.mjs'

const password = 'synthetic multi account password 123'
const marker = (id = 'formal-local', model = 'synthetic-local') => ({ id, model,
  baseUrl: 'http://127.0.0.1:8081/v1', provider: 'openai-compatible', source: 'formal-host-catalog',
  credentialHash: createHash('sha256').update('synthetic-formal-key').digest('hex') })
const uuid = '00000000-0000-4000-8000-000000000001'
const syncEvent = { eventId: `event-${uuid}`, conversationId: `conversation-${uuid}`,
  clientSeq: 1, kind: 'message.created', occurredAt: '2026-09-27T10:00:00.000Z',
  payload: { messageId: `message-${uuid}`, role: 'user', text: 'synthetic owner record' } }

function syntheticBackend() {
  const sessions = new Set<string>()
  const modelsBySession = new Map<string, string>()
  const sessionPresets = new Map<string, string>()
  const calls: Array<{ ownerId: string, sessionId: string }> = []
  const effects = { preflight: 0, message: 0, cancel: 0, verify: 0, completion: 0 }
  return { calls, sessions, sessionPresets, effects,
    getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready', capabilities: {
      chat: { available: true }, desktopOpenApp: { available: true },
      naturalLanguageDesktop: { available: true },
    } }),
    listModels: async () => [
      { id: 'formal-local', name: 'Formal local', model: 'synthetic-local', configured: true,
        source: 'host', sourceKind: 'local' },
      { id: 'legacy-cloud', name: 'Legacy private cloud', model: 'synthetic-cloud', configured: true,
        source: 'host', sourceKind: 'cloud' },
    ],
    preflight: async () => { effects.preflight++; return { ok: true } },
    createSession: async ({ ownerId, sessionId, modelProfileId }: {
      ownerId: string, sessionId: string, modelProfileId: string }) => {
      calls.push({ ownerId, sessionId }); sessions.add(sessionId)
      modelsBySession.set(sessionId, modelProfileId)
      sessionPresets.set(sessionId, 'personal-shared-chat')
      return { sessionId }
    },
    sendMessage: async () => { effects.message++; return { accepted: true } },
    cancelSession: async () => { effects.cancel++; return { accepted: true } },
    verifyModelProfile: async () => { effects.verify++; return {
      configured: true, reachable: true, modelListed: true, inferenceVerified: false,
    } },
    modelCompletion: async () => { effects.completion++; return new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'synthetic' } }],
    }), { headers: { 'content-type': 'application/json' } }) },
    readEvents: async ({ afterSeq = -1 }: { afterSeq: number }) => ({ events: [], nextSeq: afterSeq, hasMore: false }),
    describeSession: async (sessionId: string) => sessions.has(sessionId)
      ? { sessionId, title: 'Synthetic', running: false,
        agentPreset: sessionPresets.get(sessionId) ?? 'personal-shared-chat',
        modelProfileId: modelsBySession.get(sessionId) ?? null } : null,
    openDesktopApp: async () => ({ accepted: true }),
  }
}

async function api(origin: string, method: string, path: string, body?: object,
  session?: { cookie: string, csrf: string }) {
  const response = await fetch(`${origin}${path}`, { method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}),
      ...(method !== 'GET' ? { origin } : {}),
      ...(session ? { cookie: session.cookie, 'x-weftmate-csrf': session.csrf } : {}) },
    body: body ? JSON.stringify(body) : undefined })
  return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie') }
}

async function registered(origin: string, username: string) {
  const response = await api(origin, 'POST', '/personal/v1/auth/register',
    { username, password, deviceName: `${username} phone` })
  assert.equal(response.status, 201)
  return { ownerId: response.body.account.ownerId as string,
    cookie: response.cookie!.split(';')[0], csrf: response.body.csrfToken as string }
}

async function eventually(read: () => Promise<any>, predicate: (value: any) => boolean) {
  for (let index = 0; index < 100; index++) {
    const value = await read()
    if (predicate(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('fixture command did not settle')
}

test('two accounts have independent devices, command IDs, sync events and shared-model access', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-multi-account-'))
  const backend = syntheticBackend()
  let service = await createPersonalAccessService({ root, port: 0, backend,
    sharedProfileIsFormal: (value: { id: string }) => value.id === 'formal-local' })
  try {
    let { origin, hostId } = await service.start()
    assert.deepEqual((await api(origin, 'GET', '/personal/v1/auth/state')).body,
      { configured: false, registrationAvailable: true })
    const a = await registered(origin, 'PersonA')
    const b = await registered(origin, 'PersonB')
    assert.notEqual(a.ownerId, b.ownerId)
    assert.equal((await api(origin, 'GET', '/personal/v1/auth/state')).body.registrationAvailable, true)
    assert.equal((await api(origin, 'POST', '/personal/v1/auth/register',
      { username: 'persona', password, deviceName: 'duplicate' })).body.error.code, 'ACCOUNT_ALREADY_EXISTS')
    assert.equal((await api(origin, 'GET', '/personal/v1/status', undefined, a)).body.ownerId, a.ownerId)
    assert.equal((await api(origin, 'GET', '/personal/v1/status', undefined, b)).body.ownerId, b.ownerId)
    assert.equal((await api(origin, 'GET', '/personal/v1/auth/me', undefined, a)).body.account.ownerId, a.ownerId)
    assert.equal((await api(origin, 'GET', '/personal/v1/auth/devices', undefined, a)).body.devices.length, 1)
    assert.equal((await api(origin, 'GET', '/personal/v1/auth/devices', undefined, b)).body.devices.length, 1)
    assert.deepEqual((await api(origin, 'GET', '/personal/v1/models', undefined, b)).body.models.map((item: any) => item.id), [])
    await service.setSharedModelProfiles([marker()])
    assert.deepEqual((await api(origin, 'GET', '/personal/v1/models', undefined, b)).body.models.map((item: any) => item.id), ['formal-local'])
    const statusB = (await api(origin, 'GET', '/personal/v1/status', undefined, b)).body
    assert.equal(statusB.backend.capabilities.desktopOpenApp.available, false)
    assert.equal(statusB.backend.capabilities.chat.available, true)
    assert.equal((await api(origin, 'POST', '/personal/v1/commands',
      { requestId: 'private-action', kind: 'desktop.open_app', targetDeviceId: hostId, appId: 'notepad' }, b)).status, 403)
    assert.equal((await api(origin, 'POST', '/personal/v1/commands',
      { requestId: 'missing-model', kind: 'session.create', targetDeviceId: hostId }, b)).status, 400)
    backend.sessions.add('unbound-friend-session')
    await assert.rejects(service.attachSession('unbound-friend-session'),
      (error: { code: string }) => error.code === 'SESSION_UNAVAILABLE')
    const command = { requestId: 'same-request', kind: 'session.create', targetDeviceId: hostId,
      modelProfileId: 'formal-local' }
    const createdA = await api(origin, 'POST', '/personal/v1/commands', command, a)
    const createdB = await api(origin, 'POST', '/personal/v1/commands', command, b)
    assert.equal(createdA.status, 202)
    assert.equal(createdB.status, 202)
    assert.notEqual(createdA.body.command.commandId, createdB.body.command.commandId)
    assert.notEqual(createdA.body.command.sessionId, createdB.body.command.sessionId)
    await eventually(() => api(origin, 'GET', `/personal/v1/commands/${createdA.body.command.commandId}`, undefined, a),
      (value) => value.body.command.state === 'accepted_by_dsh')
    await eventually(() => api(origin, 'GET', `/personal/v1/commands/${createdB.body.command.commandId}`, undefined, b),
      (value) => value.body.command.state === 'accepted_by_dsh')
    await assert.rejects(service.attachSession(createdB.body.command.sessionId),
      (error: { code: string }) => error.code === 'SESSION_UNAVAILABLE')
    assert.equal((await api(origin, 'GET', `/personal/v1/commands/${createdA.body.command.commandId}`, undefined, b)).status, 404)
    assert.equal((await api(origin, 'GET', `/personal/v1/sessions/${createdA.body.command.sessionId}/events`, undefined, b)).status, 404)
    assert.equal((await api(origin, 'GET', '/personal/v1/commands/by-request/same-request', undefined, b)).body.command.commandId,
      createdB.body.command.commandId)
    assert.deepEqual(new Set(backend.calls.map((item) => item.ownerId)), new Set([a.ownerId, b.ownerId]))
    const postedA = await api(origin, 'POST', '/personal/v1/sync/events', { events: [syncEvent] }, a)
    const postedB = await api(origin, 'POST', '/personal/v1/sync/events', { events: [syncEvent] }, b)
    assert.equal(postedA.status, 200)
    assert.equal(postedB.status, 200)
    assert.equal((await api(origin, 'GET', '/personal/v1/sync/events?afterSeq=0', undefined, a)).body.events[0].seq, 1)
    assert.equal((await api(origin, 'GET', '/personal/v1/sync/events?afterSeq=0', undefined, b)).body.events[0].seq, 1)
    await service.close()
    service = await createPersonalAccessService({ root, port: 0, backend,
      sharedProfileIsFormal: (value: { id: string }) => value.id === 'formal-local' })
    ;({ origin } = await service.start())
    assert.equal((await api(origin, 'GET', '/personal/v1/status', undefined, a)).body.ownerId, a.ownerId)
    assert.equal((await api(origin, 'GET', '/personal/v1/status', undefined, b)).body.ownerId, b.ownerId)
    assert.equal((await api(origin, 'GET', '/personal/v1/commands/by-request/same-request', undefined, a)).body.command.commandId,
      createdA.body.command.commandId)
    assert.equal((await api(origin, 'GET', '/personal/v1/commands/by-request/same-request', undefined, b)).body.command.commandId,
      createdB.body.command.commandId)
    const changedA = await api(origin, 'POST', '/personal/v1/auth/change-password', {
      currentPassword: password, newPassword: 'synthetic replacement password 456',
    }, a)
    assert.equal(changedA.status, 200)
    assert.equal((await api(origin, 'GET', '/personal/v1/status', undefined, a)).status, 401)
    assert.equal((await api(origin, 'GET', '/personal/v1/status', undefined, b)).status, 200)
    assert.equal((await api(origin, 'GET', '/personal/v1/auth/devices', undefined, b)).body.devices.length, 1)
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }) }
})

test('unknown usernames and another account password failures cannot lock the original owner', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-multi-login-limit-'))
  const service = await createPersonalAccessService({ root, port: 0, backend: syntheticBackend() })
  try {
    const { origin } = await service.start()
    await registered(origin, 'OwnerA')
    await registered(origin, 'OwnerB')
    const login = (username: string, candidate: string) => api(origin, 'POST', '/personal/v1/auth/login',
      { username, password: candidate, deviceName: 'Fixture login' })
    for (let index = 0; index < 5; index++) {
      assert.equal((await login(`Missing${index}`, 'synthetic wrong password 123')).status, 401)
    }
    assert.equal((await login('AnotherMissing', 'synthetic wrong password 123')).status, 429)
    for (let index = 0; index < 5; index++) assert.equal((await login('OwnerB', 'synthetic wrong password 123')).status, 401)
    assert.equal((await login('OwnerB', password)).status, 429)
    assert.equal((await login('OwnerA', password)).status, 200)
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }) }
})

test('v2 owner, live cookie, nine commands and sync directory survive one v3 migration', async () => {
  const source = mkdtempSync(join(tmpdir(), 'personal-v2-source-'))
  const migratedRoot = mkdtempSync(join(tmpdir(), 'personal-v2-upgrade-'))
  const backend = syntheticBackend()
  let builder = await createPersonalAccessService({ root: source, port: 0, backend,
    sharedProfileIsFormal: (value: { id: string }) => value.id === 'formal-local' })
  let migrated: Awaited<ReturnType<typeof createPersonalAccessService>> | null = null
  try {
    const { origin, hostId } = await builder.start()
    const a = await registered(origin, 'ExistingOwner')
    await builder.setSharedModelProfiles([marker()])
    const created: Array<{ commandId: string, sessionId: string }> = []
    for (let index = 0; index < 9; index++) {
      const response = await api(origin, 'POST', '/personal/v1/commands', {
        requestId: `original-${index}`, kind: 'session.create', targetDeviceId: hostId,
        modelProfileId: 'formal-local',
      }, a)
      assert.equal(response.status, 202)
      created.push(response.body.command)
    }
    for (const command of created) await eventually(
      () => api(origin, 'GET', `/personal/v1/commands/${command.commandId}`, undefined, a),
      (value) => value.body.command.state === 'accepted_by_dsh')
    assert.equal((await api(origin, 'POST', '/personal/v1/sync/events', { events: [syncEvent] }, a)).status, 200)
    await builder.close()
    const sourceStore = JSON.parse(readFileSync(join(source, 'store.json'), 'utf8'))
    const original = sourceStore.accounts[a.ownerId]
    const oldV2 = { version: 2, hostId: sourceStore.hostId, ownerId: a.ownerId, ...original }
    writeFileSync(join(migratedRoot, 'store.json'), JSON.stringify(oldV2))
    cpSync(join(source, 'accounts', a.ownerId, 'sync'), join(migratedRoot, 'sync'), { recursive: true })
    migrated = await createPersonalAccessService({ root: migratedRoot, port: 0, backend,
      sharedProfileIsFormal: (value: { id: string }) => value.id === 'formal-local' })
    const started = await migrated.start()
    assert.equal(started.ownerId, a.ownerId)
    const restored = JSON.parse(readFileSync(join(migratedRoot, 'store.json'), 'utf8'))
    assert.equal(restored.version, 3)
    assert.equal(restored.legacyOwnerId, a.ownerId)
    assert.equal(restored.accounts[a.ownerId].account.password.hash === original.account.password.hash, true)
    assert.equal(JSON.stringify(restored.accounts[a.ownerId].devices) === JSON.stringify(original.devices), true)
    assert.equal(JSON.stringify(restored.accounts[a.ownerId].sessions) === JSON.stringify(original.sessions), true)
    assert.equal(JSON.stringify(restored.accounts[a.ownerId].commands) === JSON.stringify(original.commands), true)
    assert.equal(Object.keys(restored.accounts[a.ownerId].commands).length, 9)
    assert.equal((await api(started.origin, 'GET', '/personal/v1/auth/me', undefined, a)).body.account.ownerId, a.ownerId)
    assert.equal((await api(started.origin, 'GET', '/personal/v1/sync/events?afterSeq=0', undefined, a)).body.events[0].eventId,
      syncEvent.eventId)
    assert.equal((await api(started.origin, 'GET', `/personal/v1/sessions/${created[0].sessionId}/events`, undefined, a)).status, 200)
    const secondDevice = await api(started.origin, 'POST', '/personal/v1/auth/login',
      { username: 'ExistingOwner', password, deviceName: 'another device' })
    assert.equal(secondDevice.status, 200)
    assert.equal(secondDevice.body.account.ownerId, a.ownerId)
    const b = await registered(started.origin, 'FriendAccount')
    assert.notEqual(b.ownerId, a.ownerId)
    assert.equal((await api(started.origin, 'GET', `/personal/v1/commands/${created[0].commandId}`, undefined, b)).status, 404)
    assert.equal((await api(started.origin, 'GET', `/personal/v1/sessions/${created[0].sessionId}/events`, undefined, b)).status, 404)
    assert.equal((await api(started.origin, 'GET', '/personal/v1/sync/events?afterSeq=0', undefined, b)).body.events.length, 0)
    const aDevice = Object.keys(original.devices)[0]
    assert.equal((await api(started.origin, 'PATCH', `/personal/v1/auth/devices/${aDevice}`,
      { name: 'cross-account rename' }, b)).status, 404)
    assert.equal((await api(started.origin, 'DELETE', `/personal/v1/auth/devices/${aDevice}`, undefined, b)).status, 404)
    assert.equal((await api(started.origin, 'GET', '/personal/v1/auth/devices', undefined, a)).body.devices[0].revoked, false)
    const before = { ...backend.effects }
    assert.equal((await api(started.origin, 'POST', '/personal/v1/models/legacy-cloud/verify', {}, b)).status, 422)
    assert.equal((await api(started.origin, 'POST', '/personal/v1/models/legacy-cloud/chat/completions', {
      model: 'synthetic-cloud', messages: [{ role: 'user', content: 'private cloud probe' }], stream: false,
    }, b)).status, 422)
    assert.equal((await api(started.origin, 'POST', '/personal/v1/commands', {
      requestId: 'cross-message', kind: 'session.message', targetDeviceId: hostId,
      sessionId: created[0].sessionId, text: 'cross-account probe',
    }, b)).status, 404)
    assert.equal((await api(started.origin, 'POST', '/personal/v1/commands', {
      requestId: 'cross-cancel', kind: 'session.cancel', targetDeviceId: hostId,
      sessionId: created[0].sessionId,
    }, b)).status, 404)
    assert.deepEqual(backend.effects, before, 'cross-account IDs never reach model or DSH callbacks')
    assert.equal((await api(started.origin, 'POST', '/personal/v1/commands', {
      requestId: 'friend-desktop', kind: 'desktop.open_app', targetDeviceId: hostId, appId: 'notepad',
    }, b)).status, 403)
  } finally {
    await migrated?.close()
    await builder.close()
    rmSync(source, { recursive: true, force: true })
    rmSync(migratedRoot, { recursive: true, force: true })
  }
})

test('public registration never claims unconfigured v2 owner data; trusted setup can claim it later', async () => {
  const source = mkdtempSync(join(tmpdir(), 'personal-unclaimed-source-'))
  const root = mkdtempSync(join(tmpdir(), 'personal-unclaimed-upgrade-'))
  const backend = syntheticBackend()
  let builder = await createPersonalAccessService({ root: source, port: 0, backend })
  let service: Awaited<ReturnType<typeof createPersonalAccessService>> | null = null
  try {
    const { origin } = await builder.start()
    const originalOwner = builder.legacyOwnerId()
    const legacy = await builder.enrollDevice({ name: 'Original local device' })
    const sessionId = 'session-00000000-0000-4000-8000-000000000002'
    backend.sessions.add(sessionId)
    backend.sessionPresets.set(sessionId, 'standard')
    await builder.attachSession(sessionId)
    const sync = await fetch(`${origin}/personal/v1/sync/events`, { method: 'POST',
      headers: { authorization: `Bearer ${legacy.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ events: [syncEvent] }) })
    assert.equal(sync.status, 200)
    await builder.close()
    const sourceStore = JSON.parse(readFileSync(join(source, 'store.json'), 'utf8'))
    writeFileSync(join(root, 'store.json'), JSON.stringify({ version: 2, hostId: sourceStore.hostId,
      ownerId: originalOwner, ...sourceStore.accounts[originalOwner] }))
    cpSync(join(source, 'sync'), join(root, 'sync'), { recursive: true })
    service = await createPersonalAccessService({ root, port: 0, backend })
    const started = await service.start()
    const friend = await registered(started.origin, 'FirstPublicFriend')
    assert.notEqual(friend.ownerId, originalOwner)
    assert.equal((await api(started.origin, 'GET', `/personal/v1/sessions/${sessionId}/events`, undefined, friend)).status, 404)
    assert.equal((await api(started.origin, 'GET', '/personal/v1/sync/events?afterSeq=0', undefined, friend)).body.events.length, 0)
    const grant = await service.issueSetupGrant()
    const claimed = await api(started.origin, 'POST', '/personal/v1/auth/setup', {
      grant: grant.grant, username: 'OriginalOwner', password, deviceName: 'Original PC',
    })
    assert.equal(claimed.status, 201)
    assert.equal(claimed.body.account.ownerId, originalOwner)
    const original = { cookie: claimed.cookie!.split(';')[0], csrf: claimed.body.csrfToken }
    assert.equal((await api(started.origin, 'GET', `/personal/v1/sessions/${sessionId}/events`, undefined, original)).status, 200)
    assert.equal((await api(started.origin, 'GET', '/personal/v1/sync/events?afterSeq=0', undefined, original)).body.events[0].eventId,
      syncEvent.eventId)
    assert.equal((await api(started.origin, 'GET', '/personal/v1/sync/events?afterSeq=0', undefined, friend)).body.events.length, 0)
    assert.equal((await fetch(`${started.origin}/personal/v1/status`, {
      headers: { authorization: `Bearer ${legacy.token}` },
    })).status, 401)
  } finally {
    await service?.close()
    await builder.close()
    rmSync(source, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})

test('concurrent accounts keep owner, text and duplicate request namespace through delayed dispatch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-concurrent-owners-'))
  const backend: any = syntheticBackend()
  const entered: Array<{ ownerId: string, text: string }> = []
  const sent: Array<{ ownerId: string, text: string }> = []
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  backend.preflight = async (command: { kind: string, requestId: string, ownerId: string, text?: string }) => {
    if (command.kind === 'session.message' && command.requestId === 'shared-retry-id') {
      entered.push({ ownerId: command.ownerId, text: command.text! })
      await gate
    }
    return { ok: true }
  }
  backend.sendMessage = async (input: { ownerId: string, text: string }) => {
    sent.push(input)
    return { accepted: true }
  }
  const service = await createPersonalAccessService({ root, port: 0, backend,
    sharedProfileIsFormal: (value: { id: string }) => value.id === 'formal-local' })
  try {
    const { origin, hostId } = await service.start()
    const a = await registered(origin, 'ConcurrentA')
    const b = await registered(origin, 'ConcurrentB')
    await service.setSharedModelProfiles([marker()])
    const create = (owner: { cookie: string, csrf: string }, suffix: string) => api(origin, 'POST',
      '/personal/v1/commands', { requestId: `create-${suffix}`, kind: 'session.create',
        targetDeviceId: hostId, modelProfileId: 'formal-local' }, owner)
    const [createdA, createdB] = await Promise.all([create(a, 'a'), create(b, 'b')])
    for (const [created, owner] of [[createdA, a], [createdB, b]] as const) {
      assert.equal(created.status, 202)
      await eventually(() => api(origin, 'GET', `/personal/v1/commands/${created.body.command.commandId}`,
        undefined, owner), (value) => value.body.command.state === 'accepted_by_dsh')
    }
    const command = (owner: { cookie: string, csrf: string }, sessionId: string, text: string) =>
      api(origin, 'POST', '/personal/v1/commands', { requestId: 'shared-retry-id',
        kind: 'session.message', targetDeviceId: hostId, sessionId, text }, owner)
    const pendingA = command(a, createdA.body.command.sessionId, 'A private synthetic content')
    const pendingB = command(b, createdB.body.command.sessionId, 'B different synthetic content')
    await Promise.race([
      (async () => { while (entered.length < 2) await new Promise((resolve) => setTimeout(resolve, 10)) })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('both preflights did not enter')), 5000)),
    ])
    assert.deepEqual(new Set(entered.map((item) => item.ownerId)), new Set([a.ownerId, b.ownerId]))
    release()
    const [postedA, postedB] = await Promise.all([pendingA, pendingB])
    assert.equal(postedA.status, 202)
    assert.equal(postedB.status, 202)
    await eventually(() => api(origin, 'GET', `/personal/v1/commands/${postedA.body.command.commandId}`,
      undefined, a), (value) => value.body.command.state === 'accepted_by_dsh')
    await eventually(() => api(origin, 'GET', `/personal/v1/commands/${postedB.body.command.commandId}`,
      undefined, b), (value) => value.body.command.state === 'accepted_by_dsh')
    assert.deepEqual(new Set(sent.map((item) => `${item.ownerId}|${item.text}`)), new Set([
      `${a.ownerId}|A private synthetic content`, `${b.ownerId}|B different synthetic content`,
    ]))
    const [syncA, syncB] = await Promise.all([
      api(origin, 'POST', '/personal/v1/sync/events', { events: [syncEvent] }, a),
      api(origin, 'POST', '/personal/v1/sync/events', { events: [{ ...syncEvent,
        payload: { ...syncEvent.payload, text: 'B distinct local record' } }] }, b),
    ])
    assert.equal(syncA.status, 200)
    assert.equal(syncB.status, 200)
    assert.equal((await api(origin, 'GET', '/personal/v1/sync/events?afterSeq=0', undefined, a)).body.events[0].payload.text,
      'synthetic owner record')
    assert.equal((await api(origin, 'GET', '/personal/v1/sync/events?afterSeq=0', undefined, b)).body.events[0].payload.text,
      'B distinct local record')
  } finally { release(); await service.close(); rmSync(root, { recursive: true, force: true }) }
})

test('a persisted shared ID stops being shared when its current host profile drifts to private cloud', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-shared-model-drift-'))
  const backend: any = syntheticBackend()
  const profile = { id: 'formal-local', name: 'Formal model', model: 'synthetic-local',
    baseUrl: 'http://127.0.0.1:8081/v1', provider: 'openai-compatible',
    configured: true, source: 'host', sourceKind: 'local' }
  let credentialMatchesHost = true
  backend.listModels = async () => [profile]
  const service = await createPersonalAccessService({ root, port: 0, backend,
    sharedProfileIsFormal: (value: { id: string }) => value.id === profile.id && profile.model === 'synthetic-local' &&
      profile.baseUrl === 'http://127.0.0.1:8081/v1' && profile.provider === 'openai-compatible' &&
      credentialMatchesHost })
  try {
    const { origin, hostId } = await service.start()
    const grant = await service.issueSetupGrant()
    const setup = await api(origin, 'POST', '/personal/v1/auth/setup', {
      grant: grant.grant, username: 'HostOwner', password, deviceName: 'Owner browser',
    })
    assert.equal(setup.status, 201)
    const owner = { cookie: setup.cookie!.split(';')[0], csrf: setup.body.csrfToken }
    const friend = await registered(origin, 'Friend')
    await service.setSharedModelProfiles([marker(profile.id, profile.model)])
    assert.deepEqual((await api(origin, 'GET', '/personal/v1/models', undefined, friend)).body.models.map((item: any) => item.id),
      [profile.id])
    const created = await api(origin, 'POST', '/personal/v1/commands', {
      requestId: 'shared-before-drift', kind: 'session.create', targetDeviceId: hostId,
      modelProfileId: profile.id,
    }, friend)
    assert.equal(created.status, 202)
    await eventually(() => api(origin, 'GET', `/personal/v1/commands/${created.body.command.commandId}`,
      undefined, friend), (value) => value.body.command.state === 'accepted_by_dsh')
    profile.model = 'private-cloud-model'
    profile.baseUrl = 'https://private.example/v1'
    profile.sourceKind = 'cloud'
    assert.deepEqual((await api(origin, 'GET', '/personal/v1/models', undefined, friend)).body.models, [])
    assert.equal((await api(origin, 'GET', '/personal/v1/models', undefined, owner)).body.models[0].model,
      'private-cloud-model')
    const before = { ...backend.effects }
    assert.equal((await api(origin, 'POST', '/personal/v1/models/formal-local/verify', {}, friend)).status, 422)
    assert.equal((await api(origin, 'POST', '/personal/v1/models/formal-local/chat/completions', {
      model: 'private-cloud-model', messages: [{ role: 'user', content: 'not mine' }], stream: false,
    }, friend)).status, 422)
    assert.equal((await api(origin, 'POST', '/personal/v1/commands', {
      requestId: 'drifted-profile', kind: 'session.create', targetDeviceId: hostId, modelProfileId: profile.id,
    }, friend)).status, 422)
    assert.equal((await api(origin, 'GET', '/personal/v1/sessions', undefined, friend)).body.sessions[0].sendAvailable, false)
    assert.equal((await api(origin, 'POST', '/personal/v1/commands', {
      requestId: 'drifted-existing-session', kind: 'session.message', targetDeviceId: hostId,
      sessionId: created.body.command.sessionId, text: 'must not use owner cloud',
    }, friend)).status, 422)
    assert.deepEqual(backend.effects, before)
    profile.model = 'synthetic-local'
    profile.baseUrl = 'http://127.0.0.1:8081/v1'
    profile.sourceKind = 'local'
    credentialMatchesHost = false
    assert.deepEqual((await api(origin, 'GET', '/personal/v1/models', undefined, friend)).body.models, [])
    assert.equal((await api(origin, 'POST', '/personal/v1/models/formal-local/verify', {}, friend)).status, 422)
    assert.deepEqual(backend.effects, before)
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }) }
})
