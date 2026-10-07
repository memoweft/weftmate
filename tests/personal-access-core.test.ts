import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createPersonalAccessService } from '../src/personal-access/index.mjs'

const ownerStore = (store: any) => store.accounts[store.legacyOwnerId]

function fixture() {
  const calls = { create: 0, message: 0, cancel: 0 }
const events = new Map<string, Array<{ seq: number, type: string, data: object }>>()
  const sessions = new Set<string>()
  const backend = {
    getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready', secret: 'do-not-expose' }),
    listModels: async () => [{ id: 'local', name: 'Local', model: 'local-model', configured: true, secret: 'hidden' }],
    preflight: async (command: { kind: string, modelProfileId?: string, sessionId?: string }) => {
      if (command.kind === 'session.create' && command.modelProfileId !== 'local') {
        throw Object.assign(new Error('secret model error'), { code: 'MODEL_UNAVAILABLE' })
      }
      if (command.kind !== 'session.create' && !sessions.has(command.sessionId!)) {
        throw Object.assign(new Error('secret session error'), { code: 'SESSION_UNAVAILABLE' })
      }
      return { ok: true }
    },
    createSession: async ({ sessionId }: { sessionId: string }) => {
      calls.create++
      sessions.add(sessionId)
      return { sessionId }
    },
    sendMessage: async () => { calls.message++; return { accepted: true, receiptId: 'rpc-1' } },
    cancelSession: async () => { calls.cancel++; return { accepted: true } },
    readEvents: async ({ sessionId, afterSeq, limit }: { sessionId: string, afterSeq: number, limit: number }) => {
      const remaining = (events.get(sessionId) ?? []).filter((event) => event.seq > afterSeq)
      const page = remaining.slice(0, limit)
      return { events: page, nextSeq: page.at(-1)?.seq ?? afterSeq, hasMore: remaining.length > limit }
    },
    describeSession: async (sessionId: string) => sessions.has(sessionId)
      ? { sessionId, title: 'Test', running: false } : null,
  }
  return { backend, calls, events, sessions }
}

async function request(origin: string, token: string | null, method: string, pathname: string, body?: object,
  headers: Record<string, string> = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: response.status, body: await response.json() }
}

async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean, attempts = 100) {
  for (let index = 0; index < attempts; index++) {
    const value = await read()
    if (done(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('timed out waiting for test command')
}

test('two devices share an owner, concurrent duplicate request runs once, conflict and authentication stay bounded', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-access-core-'))
  const f = fixture()
  const service = await createPersonalAccessService({ root, port: 0, backend: f.backend })
  try {
    const { origin, hostId } = await service.start()
    const one = await service.enrollDevice({ name: 'phone' })
    const two = await service.enrollDevice({ name: 'tablet' })
    const command = { requestId: 'r1', kind: 'session.create', targetDeviceId: hostId, modelProfileId: 'local' }
    const [a, b] = await Promise.all([
      request(origin, one.token, 'POST', '/personal/v1/commands', command),
      request(origin, two.token, 'POST', '/personal/v1/commands', command),
    ])
    assert.equal(a.status, 202)
    assert.equal(b.status, 202)
    assert.equal(a.body.command.commandId, b.body.command.commandId)
    const commandId = a.body.command.commandId
    const finished = await eventually(() => request(origin, two.token, 'GET', `/personal/v1/commands/${commandId}`),
      (value) => value.body.command.state === 'accepted_by_dsh')
    assert.equal(finished.body.command.sessionId, a.body.command.sessionId)
    assert.equal(f.calls.create, 1)
    assert.equal((await request(origin, two.token, 'GET', '/personal/v1/sessions')).body.sessions.length, 1)
    assert.equal((await request(origin, one.token, 'POST', '/personal/v1/commands',
      { ...command, modelProfileId: 'other' })).status, 409)
    assert.equal((await request(origin, null, 'GET', '/personal/v1/status')).status, 401)
    assert.equal((await request(origin, 'wrong', 'GET', '/personal/v1/status')).status, 401)
    assert.equal((await request(origin, one.token, 'GET', '/personal/v1/status', undefined,
      { origin: 'https://unconfigured.example' })).status, 403)
    assert.equal((await request(origin, one.token, 'GET', '/personal/v1/status')).body.backend.secret, undefined)
    assert.equal((await request(origin, one.token, 'GET', '/personal/v1/models')).body.models[0].secret, undefined)
    await service.revokeDevice(one.deviceId)
    assert.equal((await request(origin, one.token, 'GET', '/personal/v1/status')).status, 401)
    assert.equal((await request(origin, two.token, 'GET', '/personal/v1/status')).status, 200)
    const stored = readFileSync(join(root, 'store.json'), 'utf8')
    assert.equal(stored.includes(one.token), false)
    assert.equal(stored.includes(two.token), false)
  } finally {
    await service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('session ownership, target, strict fields and event cursor', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-access-events-'))
  const f = fixture()
  const originalPreflight = f.backend.preflight
  let preflightCalls = 0
  f.backend.preflight = async (command) => { preflightCalls++; return originalPreflight(command) }
  const service = await createPersonalAccessService({ root, port: 0, backend: f.backend })
  try {
    const { origin, hostId } = await service.start()
    const { token } = await service.enrollDevice({ name: 'phone' })
    f.sessions.add('old-session')
    const message = { requestId: 'r1', kind: 'session.message', targetDeviceId: hostId,
      sessionId: 'old-session', text: 'synthetic text' }
    assert.equal((await request(origin, token, 'POST', '/personal/v1/commands', message)).status, 404)
    assert.equal(preflightCalls, 0)
    assert.equal(f.calls.message, 0)
    assert.equal(f.calls.cancel, 0)
    assert.equal((await request(origin, token, 'GET', '/personal/v1/sessions/old-session/events')).status, 404)
    await service.attachSession('old-session')
    assert.equal((await request(origin, token, 'POST', '/personal/v1/commands',
      { ...message, targetDeviceId: 'device-some-client' })).status, 409)
    assert.equal((await request(origin, token, 'POST', '/personal/v1/commands',
      { ...message, unexpected: 1 })).status, 400)
    const readonly = await request(origin, token, 'POST', '/personal/v1/commands', message)
    assert.equal(readonly.status, 409)
    assert.equal(readonly.body.error.code, 'SESSION_READ_ONLY')
    assert.equal((await request(origin, token, 'GET', '/personal/v1/sessions')).body.sessions[0].sendAvailable, false)
    assert.equal(preflightCalls, 0)
    assert.equal(f.calls.message, 0)
    f.events.set('old-session', [0, 1, 2, 3, 4].map((seq) => ({ seq, type: 'message', data: { seq } })))
    const seen: number[] = []
    let afterSeq = -1
    for (let pageNo = 0; pageNo < 3; pageNo++) {
      const page = await request(origin, token, 'GET', `/personal/v1/sessions/old-session/events?afterSeq=${afterSeq}&limit=2`)
      assert.equal(page.status, 200)
      seen.push(...page.body.events.map((event: { seq: number }) => event.seq))
      afterSeq = page.body.nextSeq
      if (!page.body.hasMore) break
    }
    assert.deepEqual(seen, [0, 1, 2, 3, 4])
    assert.equal((await request(origin, token, 'GET', '/personal/v1/sessions/old-session/events?afterSeq=4&limit=2'))
      .body.nextSeq, 4)
  } finally {
    await service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('restart marks dispatching uncertain without replay; pending resumes; corrupt store refuses startup', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-access-recovery-'))
  const f = fixture()
  const initial = await createPersonalAccessService({ root, port: 0, backend: f.backend })
  const identity = await initial.start()
  const device = await initial.enrollDevice({ name: 'phone' })
  await initial.close()
  const storePath = join(root, 'store.json')
  const store = JSON.parse(readFileSync(storePath, 'utf8'))
  const now = new Date().toISOString()
  const base = (commandId: string, requestId: string, state: string) => ({
    commandId, ownerId: identity.ownerId, requestId,
    payloadHash: createHash('sha256').update(JSON.stringify({ requestId, kind: 'session.create',
      targetDeviceId: identity.hostId, modelProfileId: 'local' })).digest('hex'),
    payload: { requestId, kind: 'session.create', targetDeviceId: identity.hostId, modelProfileId: 'local' },
    sourceDeviceId: device.deviceId, targetDeviceId: identity.hostId, kind: 'session.create',
    sessionId: `session-${randomUUID()}`, state, createdAt: now, updatedAt: now,
  })
  ownerStore(store).commands['cmd-pending'] = base('cmd-pending', 'pending', 'pending')
  ownerStore(store).commands['cmd-inflight'] = base('cmd-inflight', 'inflight', 'dispatching')
  writeFileSync(storePath, JSON.stringify(store))
  const resumed = await createPersonalAccessService({ root, port: 0, backend: f.backend })
  try {
    const { origin } = await resumed.start()
    await eventually(() => request(origin, device.token, 'GET', '/personal/v1/commands/cmd-pending'),
      (value) => value.body.command.state === 'accepted_by_dsh')
    assert.equal((await request(origin, device.token, 'GET', '/personal/v1/commands/cmd-inflight'))
      .body.command.state, 'uncertain')
    assert.equal(f.calls.create, 1)
  } finally {
    await resumed.close()
  }
  writeFileSync(storePath, '{bad')
  await assert.rejects(createPersonalAccessService({ root, port: 0, backend: f.backend }),
    (error: { code: string }) => error.code === 'STORE_CORRUPT')
  rmSync(root, { recursive: true, force: true })
})

test('occupied port fails and leaves existing listener usable', async () => {
  const oneRoot = mkdtempSync(join(tmpdir(), 'personal-access-port-one-'))
  const twoRoot = mkdtempSync(join(tmpdir(), 'personal-access-port-two-'))
  const one = await createPersonalAccessService({ root: oneRoot, port: 0, backend: fixture().backend })
  const origin = (await one.start()).origin
  const port = Number(new URL(origin).port)
  const two = await createPersonalAccessService({ root: twoRoot, port, backend: fixture().backend })
  try {
    await assert.rejects(two.start(), (error: { code: string }) => error.code === 'EADDRINUSE')
    const token = (await one.enrollDevice({ name: 'phone' })).token
    assert.equal((await request(origin, token, 'GET', '/personal/v1/status')).status, 200)
  } finally {
    await two.close()
    await one.close()
    rmSync(oneRoot, { recursive: true, force: true })
    rmSync(twoRoot, { recursive: true, force: true })
  }
})

test('store write failure refuses acceptance before backend side effects', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-access-write-fail-'))
  const f = fixture()
  const service = await createPersonalAccessService({ root, port: 0, backend: f.backend })
  const { origin, hostId } = await service.start()
  const { token } = await service.enrollDevice({ name: 'phone' })
  const storePath = join(root, 'store.json')
  const backup = join(root, 'store-backup.json')
  renameSync(storePath, backup)
  mkdirSync(storePath)
  try {
    const response = await request(origin, token, 'POST', '/personal/v1/commands',
      { requestId: 'write-fail', kind: 'session.create', targetDeviceId: hostId, modelProfileId: 'local' })
    assert.equal(response.status, 503)
    assert.equal(f.calls.create, 0)
    const status = await request(origin, token, 'GET', '/personal/v1/status')
    assert.equal(status.body.state, 'storage_fault')
    assert.equal(status.body.errorCode, 'STORAGE_UNAVAILABLE')
    const later = await request(origin, token, 'POST', '/personal/v1/commands',
      { requestId: 'write-fail-again', kind: 'session.create', targetDeviceId: hostId, modelProfileId: 'local' })
    assert.deepEqual(later, { status: 503, body: { error: { code: 'STORAGE_UNAVAILABLE' } } })
  } finally {
    rmSync(storePath, { recursive: true, force: true })
    renameSync(backup, storePath)
    await service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('revocation while preflight waits rejects an unissued command', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-access-revoke-'))
  const f = fixture()
  const original = f.backend.preflight
  let count = 0
  let release: (() => void) | undefined
  let entered: (() => void) | undefined
  const enteredPromise = new Promise<void>((resolve) => { entered = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  f.backend.preflight = async (command) => {
    count++
    if (count === 2) { entered?.(); await gate }
    return original(command)
  }
  const service = await createPersonalAccessService({ root, port: 0, backend: f.backend })
  try {
    const { origin, hostId } = await service.start()
    const device = await service.enrollDevice({ name: 'phone' })
    const observer = await service.enrollDevice({ name: 'observer' })
    const accepted = await request(origin, device.token, 'POST', '/personal/v1/commands',
      { requestId: 'revoke-pending', kind: 'session.create', targetDeviceId: hostId, modelProfileId: 'local' })
    assert.equal(accepted.status, 202)
    await enteredPromise
    await service.revokeDevice(device.deviceId)
    release?.()
    await eventually(() => request(origin, observer.token, 'GET',
      `/personal/v1/commands/${accepted.body.command.commandId}`),
    (value) => value.body.command.state === 'rejected')
    assert.equal(f.calls.create, 0)
  } finally {
    release?.()
    await service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('lost message receipt remains uncertain and is never replayed on restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-access-lost-receipt-'))
  const f = fixture()
  f.sessions.add('existing-session')
  f.backend.sendMessage = async () => {
    f.calls.message++
    throw new Error('secret transport failure')
  }
  const initial = await createPersonalAccessService({ root, port: 0, backend: f.backend })
  const { hostId } = await initial.start()
  const device = await initial.enrollDevice({ name: 'phone' })
  await initial.attachSession('existing-session')
  await initial.close()
  const file = join(root, 'store.json')
  const seeded = JSON.parse(readFileSync(file, 'utf8'))
  ownerStore(seeded).sessions['existing-session'].origin = 'personal-remote' // A synthetic already restricted DSH session.
  writeFileSync(file, JSON.stringify(seeded))
  const service = await createPersonalAccessService({ root, port: 0, backend: f.backend })
  try {
    const { origin } = await service.start()
    const accepted = await request(origin, device.token, 'POST', '/personal/v1/commands',
      { requestId: 'lost-receipt', kind: 'session.message', targetDeviceId: hostId,
        sessionId: 'existing-session', text: 'synthetic pending body' })
    assert.equal(accepted.status, 202)
    const uncertain = await eventually(() => request(origin, device.token, 'GET',
      `/personal/v1/commands/${accepted.body.command.commandId}`),
    (value) => value.body.command.state === 'uncertain')
    assert.equal(JSON.stringify(uncertain.body).includes('secret transport failure'), false)
    assert.equal(readFileSync(file, 'utf8').includes('synthetic pending body'), true)
    await service.close()
    const restarted = await createPersonalAccessService({ root, port: 0, backend: f.backend })
    try {
      const next = await restarted.start()
      assert.equal((await request(next.origin, device.token, 'GET',
        `/personal/v1/commands/${accepted.body.command.commandId}`)).body.command.state, 'uncertain')
      assert.equal(f.calls.message, 1)
    } finally { await restarted.close() }
  } finally {
    await service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('close prevents a blocked dispatch from writing or invoking the old backend after same-root restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-access-close-race-'))
  const old = fixture()
  const oldPreflight = old.backend.preflight
  let calls = 0
  let release: (() => void) | undefined
  let entered: (() => void) | undefined
  const enteredPromise = new Promise<void>((resolve) => { entered = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  old.backend.preflight = async (command) => {
    calls++
    if (calls === 2) { entered?.(); await gate }
    return oldPreflight(command)
  }
  const first = await createPersonalAccessService({ root, port: 0, backend: old.backend })
  const identity = await first.start()
  const device = await first.enrollDevice({ name: 'phone' })
  const accepted = await request(identity.origin, device.token, 'POST', '/personal/v1/commands',
    { requestId: 'close-race', kind: 'session.create', targetDeviceId: identity.hostId, modelProfileId: 'local' })
  assert.equal(accepted.status, 202)
  await enteredPromise
  const firstClose = first.close()
  const secondClose = first.close()
  assert.strictEqual(secondClose, firstClose)
  let secondCompleted = false
  secondClose.then(() => { secondCompleted = true })
  await Promise.resolve()
  assert.equal(secondCompleted, false)
  await Promise.all([firstClose, secondClose])
  const fresh = fixture()
  const second = await createPersonalAccessService({ root, port: 0, backend: fresh.backend })
  try {
    const restarted = await second.start()
    await eventually(() => request(restarted.origin, device.token, 'GET',
      `/personal/v1/commands/${accepted.body.command.commandId}`),
    (value) => value.body.command.state === 'accepted_by_dsh')
    const before = readFileSync(join(root, 'store.json'), 'utf8')
    release?.()
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(old.calls.create, 0)
    assert.equal(fresh.calls.create, 1)
    assert.equal(readFileSync(join(root, 'store.json'), 'utf8'), before)
  } finally {
    release?.()
    await second.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('close during a blocked acceptance preflight cannot persist the request', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-access-close-post-'))
  const f = fixture()
  let release: (() => void) | undefined
  let entered: (() => void) | undefined
  const enteredPromise = new Promise<void>((resolve) => { entered = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  f.backend.preflight = async () => { entered?.(); await gate; return { ok: true } }
  const service = await createPersonalAccessService({ root, port: 0, backend: f.backend })
  const { origin, hostId } = await service.start()
  const { token } = await service.enrollDevice({ name: 'phone' })
  const posting = request(origin, token, 'POST', '/personal/v1/commands',
    { requestId: 'blocked-post', kind: 'session.create', targetDeviceId: hostId, modelProfileId: 'local' })
    .catch(() => null)
  await enteredPromise
  await service.close()
  release?.()
  await posting
  assert.deepEqual(Object.keys(ownerStore(JSON.parse(readFileSync(join(root, 'store.json'), 'utf8'))).commands), [])
  assert.equal(f.calls.create, 0)
  rmSync(root, { recursive: true, force: true })
})

test('valid JSON with tampered payload, missing source device or duplicate request ID fails closed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-access-store-invariants-'))
  const f = fixture()
  const service = await createPersonalAccessService({ root, port: 0, backend: f.backend })
  const { origin, hostId } = await service.start()
  const device = await service.enrollDevice({ name: 'phone' })
  const accepted = await request(origin, device.token, 'POST', '/personal/v1/commands',
    { requestId: 'invariants', kind: 'session.create', targetDeviceId: hostId, modelProfileId: 'local' })
  await eventually(() => request(origin, device.token, 'GET',
    `/personal/v1/commands/${accepted.body.command.commandId}`),
  (value) => value.body.command.state === 'accepted_by_dsh')
  await service.close()
  const storePath = join(root, 'store.json')
  const original = JSON.parse(readFileSync(storePath, 'utf8'))
  const commandId = accepted.body.command.commandId
  const tamper = [
    (store: any) => { ownerStore(store).commands[commandId].payload.modelProfileId = 'other' },
    (store: any) => { delete ownerStore(store).devices[device.deviceId] },
    (store: any) => { ownerStore(store).commands['cmd-second'] = {
      ...ownerStore(store).commands[commandId], commandId: 'cmd-second',
    } },
    (store: any) => { ownerStore(store).ownerId = 'owner-other' },
  ]
  try {
    for (const change of tamper) {
      const store = structuredClone(original)
      change(store)
      writeFileSync(storePath, JSON.stringify(store))
      await assert.rejects(createPersonalAccessService({ root, port: 0, backend: f.backend }),
        (error: { code: string }) => error.code === 'STORE_CORRUPT')
    }
  } finally {
    writeFileSync(storePath, JSON.stringify(original))
    rmSync(root, { recursive: true, force: true })
  }
})

test('event cursor advances across fully filtered and trailing hidden history', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-access-cursor-'))
  const f = fixture()
  f.sessions.add('history-session')
  f.backend.readEvents = async ({ afterSeq }) => afterSeq < 2
    ? { events: [], nextSeq: 2, hasMore: true }
    : { events: [{ seq: 4, type: 'message', data: { text: 'synthetic' } }], nextSeq: 6, hasMore: false }
  const service = await createPersonalAccessService({ root, port: 0, backend: f.backend })
  try {
    const { origin } = await service.start()
    const { token } = await service.enrollDevice({ name: 'phone' })
    await service.attachSession('history-session')
    const first = await request(origin, token, 'GET', '/personal/v1/sessions/history-session/events?afterSeq=-1&limit=2')
    assert.equal(first.status, 200)
    assert.deepEqual(first.body.events, [])
    assert.equal(first.body.nextSeq, 2)
    const second = await request(origin, token, 'GET', '/personal/v1/sessions/history-session/events?afterSeq=2&limit=2')
    assert.equal(second.status, 200)
    assert.deepEqual(second.body.events.map((event: { seq: number }) => event.seq), [4])
    assert.equal(second.body.nextSeq, 6)
    const invalid = await request(origin, token, 'GET', '/personal/v1/sessions/constructor/events')
    assert.equal(invalid.status, 400)
  } finally {
    await service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('history retains the existing 1MiB public response boundary', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-access-history-bytes-'))
  const f = fixture()
  f.sessions.add('history-session')
  f.backend.readEvents = async ({ afterSeq }: any) => {
    const events = Array.from({ length: 200 }, (_, seq) => ({ seq, type: 'assistant.message',
      data: { text: 'x'.repeat(6000) } })).filter((event) => event.seq > afterSeq)
    return { events, nextSeq: events.at(-1)?.seq ?? afterSeq, hasMore: false }
  }
  const service = await createPersonalAccessService({ root, port: 0, backend: f.backend })
  try {
    const { origin } = await service.start()
    const { token } = await service.enrollDevice({ name: 'phone' })
    await service.attachSession('history-session')
    const path = '/personal/v1/sessions/history-session/events'
    assert.deepEqual(await request(origin, token, 'GET', path + '?afterSeq=-1&limit=200'),
      { status: 503, body: { error: { code: 'BACKEND_UNAVAILABLE' } } })
    assert.equal((await request(origin, token, 'GET', path + '?afterSeq=99&limit=200')).status, 200)
  } finally {
    await service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('backend errors and malformed event data never expose arbitrary codes or content', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-access-output-'))
  const f = fixture()
  f.sessions.add('known-session')
  f.backend.getStatus = async () => { throw Object.assign(new Error('private failure'), { code: 'PRIVATE_SECRET', status: 409 }) }
  f.backend.readEvents = async () => ({ events: [{ seq: 0, type: 'message', data: 'wrong shape' as any }],
    nextSeq: 0, hasMore: false })
  const service = await createPersonalAccessService({ root, port: 0, backend: f.backend })
  try {
    const { origin } = await service.start()
    const { token } = await service.enrollDevice({ name: 'phone' })
    await service.attachSession('known-session')
    const status = await request(origin, token, 'GET', '/personal/v1/status')
    assert.equal(status.status, 503)
    assert.deepEqual(status.body, { error: { code: 'SERVICE_UNAVAILABLE' } })
    assert.equal(JSON.stringify(status.body).includes('private failure'), false)
    assert.equal((await request(origin, token, 'GET', '/personal/v1/sessions/known-session/events')).status, 503)
    f.backend.readEvents = async () => { throw Object.assign(new Error('private history text'),
      { code: 'HISTORY_WINDOW_LIMIT', status: 409 }) }
    const limited = await request(origin, token, 'GET', '/personal/v1/sessions/known-session/events')
    assert.deepEqual(limited, { status: 422, body: { error: { code: 'HISTORY_WINDOW_LIMIT' } } })
  } finally {
    await service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('full command ledger or unreconciled text budget rejects new work before persistence or dispatch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-access-capacity-'))
  const f = fixture()
  f.sessions.add('capacity-session')
  const initial = await createPersonalAccessService({ root, port: 0, backend: f.backend })
  const identity = await initial.start()
  const device = await initial.enrollDevice({ name: 'phone' })
  await initial.attachSession('capacity-session')
  await initial.close()
  const storePath = join(root, 'store.json')
  const base = JSON.parse(readFileSync(storePath, 'utf8'))
  const command = (requestId: string, kind: 'session.cancel' | 'session.message', text?: string) => {
    const payload = { requestId, kind, targetDeviceId: identity.hostId, sessionId: 'capacity-session',
      ...(text === undefined ? {} : { text, mode: 'queue' }) }
    return { commandId: `cmd-${requestId}`, ownerId: identity.ownerId, requestId,
      payloadHash: createHash('sha256').update(JSON.stringify(payload)).digest('hex'), payload,
      sourceDeviceId: device.deviceId, targetDeviceId: identity.hostId, kind,
      sessionId: 'capacity-session', state: 'uncertain',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  }
  try {
    const full = structuredClone(base)
    for (let index = 0; index < 5000; index++) ownerStore(full).commands[`cmd-c${index}`] = command(`c${index}`, 'session.cancel')
    writeFileSync(storePath, JSON.stringify(full))
    const countService = await createPersonalAccessService({ root, port: 0, backend: f.backend })
    try {
      const { origin } = await countService.start()
      const refused = await request(origin, device.token, 'POST', '/personal/v1/commands',
        { requestId: 'too-many', kind: 'session.cancel', targetDeviceId: identity.hostId, sessionId: 'capacity-session' })
      assert.deepEqual(refused, { status: 429, body: { error: { code: 'CAPACITY_LIMIT' } } })
      assert.equal(f.calls.cancel, 0)
      assert.equal((await request(origin, device.token, 'GET', '/personal/v1/commands/cmd-c0')).status, 200)
      await countService.revokeDevice(device.deviceId)
      assert.equal((await request(origin, device.token, 'GET', '/personal/v1/status')).status, 401)
    } finally { await countService.close() }

    const textFull = structuredClone(base)
    ownerStore(textFull).sessions['capacity-session'].origin = 'personal-remote'
    for (let index = 0; index < 1024; index++) {
      ownerStore(textFull).commands[`cmd-t${index}`] = command(`t${index}`, 'session.message', 'x'.repeat(8192))
    }
    writeFileSync(storePath, JSON.stringify(textFull))
    const textService = await createPersonalAccessService({ root, port: 0, backend: f.backend })
    try {
      const { origin } = await textService.start()
      const refused = await request(origin, device.token, 'POST', '/personal/v1/commands',
        { requestId: 'text-over', kind: 'session.message', targetDeviceId: identity.hostId,
          sessionId: 'capacity-session', text: 'one more byte' })
      assert.deepEqual(refused, { status: 429, body: { error: { code: 'CAPACITY_LIMIT' } } })
      assert.equal(f.calls.message, 0)
    } finally { await textService.close() }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
