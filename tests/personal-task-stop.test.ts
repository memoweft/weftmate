import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createPersonalAccessService } from '../src/personal-access/index.mjs'
import { createTaskOperations } from '../src/personal-access/tasks.mjs'

const password = 'correct horse battery staple'
const pause = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))

test('stop recovery wakes at persisted backoff and retries a lost acknowledgement without reads', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 })
  const source: any = { payload: { text: 'synthetic' }, commandId: 'task', kind: 'session.message', state: 'accepted_by_dsh', sessionId: 'session',
    taskControl: { state: 'stop_requested', stopRequests: [{ requestId: 'stop', lastAttemptAt: new Date().toISOString(),
      targets: [{ commandId: 'task', receiptId: 'receipt' }] }] } }
  const account = { commands: { task: source }, sessions: { session: { origin: 'personal-remote' } } }
  const stopping = new Map()
  const calls: string[][] = []
  const context: any = { closing: false, storageFault: false, stopping, timestamp: () => Date.now(),
    requireOpen: () => {}, accountState: () => account, serial: (work: any) => work(), mutate: (_owner: any, change: any) => change(account),
    backend: { describeSession: async () => ({ sessionId: 'session', agentPreset: 'personal-remote' }),
      stopTask: async ({ receiptIds }: any) => {
        calls.push(receiptIds)
        if (calls.length === 1) throw new Error('lost acknowledgement')
        return { outcomes: [{ receiptId: 'receipt', status: 'queue_removed' }] }
      } } }
  const tasks = createTaskOperations(context)
  await tasks.driveTaskStop('owner', 'task')
  t.mock.timers.tick(999)
  assert.equal(calls.length, 0)
  t.mock.timers.tick(1)
  await Promise.all(stopping.values())
  assert.deepEqual(calls, [['receipt']])
  t.mock.timers.tick(999)
  assert.equal(calls.length, 1)
  t.mock.timers.tick(1)
  await Promise.all(stopping.values())
  assert.deepEqual(calls, [['receipt'], ['receipt']])
  assert.equal(source.taskControl.stopRequests[0].targets[0].ack, 'queue_removed')
  t.mock.timers.tick(10_000)
  assert.equal(calls.length, 2, 'a confirmed removal ends retries')
  tasks.cancelTaskStopRetries()
})

async function request(origin: string, method: string, route: string, auth: Record<string, string>, body?: object) {
  const response = await fetch(`${origin}${route}`, { method,
    headers: { ...auth, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined })
  return { status: response.status, body: await response.json() }
}

async function settled(origin: string, auth: Record<string, string>, commandId: string) {
  for (let i = 0; i < 100; i++) {
    const result = await request(origin, 'GET', `/personal/v1/commands/${commandId}`, auth)
    if (!['pending', 'dispatching'].includes(result.body.command.state)) return result.body.command
    await pause()
  }
  throw new Error('command did not settle')
}

test('stop freezes exact receipts, ignores same-text unrelated turns, and withdraws pending work', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-stop-exact-'))
  const sessions = new Set<string>()
  const stopCalls: string[][] = []
  let events: any[] = []
  let waitEntered: (() => void) | undefined
  let releaseWait: (() => void) | undefined
  const waiting = new Promise<void>((resolve) => { waitEntered = resolve })
  const waitGate = new Promise<void>((resolve) => { releaseWait = resolve })
  let waitingPreflights = 0
  let slowEntered: (() => void) | undefined
  let releaseSlow: (() => void) | undefined
  const slowSending = new Promise<void>((resolve) => { slowEntered = resolve })
  const slowGate = new Promise<void>((resolve) => { releaseSlow = resolve })
  let nextReceipt = 0
  const backend = {
    getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }),
    listModels: async () => [{ id: 'local', name: 'Local', model: 'synthetic', configured: true }],
    preflight: async ({ text }: { text?: string }) => {
      if (text === 'waiting' && ++waitingPreflights === 2) { waitEntered?.(); await waitGate }
      return { ok: true }
    },
    createSession: async ({ sessionId }: { sessionId: string }) => { sessions.add(sessionId); return { sessionId } },
    sendMessage: async ({ text }: { text: string }) => {
      if (text === 'slow') { slowEntered?.(); await slowGate }
      return { accepted: true, receiptId: `receipt-${++nextReceipt}` }
    },
    cancelSession: async () => { throw new Error('session-wide cancel is forbidden') },
    stopTask: async ({ receiptIds }: { receiptIds: string[] }) => {
      stopCalls.push(receiptIds)
      return { status: 'cancel_requested', outcomes: receiptIds.map((receiptId) =>
        ({ receiptId, status: 'cancel_requested' })) }
    },
    readEvents: async ({ afterSeq }: { afterSeq: number }) => ({
      events: events.filter((event) => afterSeq === undefined || event.seq > afterSeq),
      nextSeq: events.length ? events.at(-1).seq : afterSeq, hasMore: false }),
    describeSession: async (sessionId: string) => sessions.has(sessionId)
      ? { sessionId, agentPreset: 'personal-remote', running: false } : null,
  }
  let service = await createPersonalAccessService({ root, port: 0, backend })
  try {
    let { origin, hostId } = await service.start()
    const grant = await service.issueSetupGrant()
    assert.equal((await request(origin, 'POST', '/personal/v1/auth/setup', { origin },
      { grant: grant.grant, username: 'Owner', password, deviceName: 'Desktop' })).status, 201)
    const login = await fetch(`${origin}/personal/v1/auth/login`, { method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Owner', password, deviceName: 'Phone' }) })
    const auth = { origin, cookie: login.headers.get('set-cookie')!.split(';')[0],
      'x-weftmate-csrf': (await login.json()).csrfToken }
    const create = await request(origin, 'POST', '/personal/v1/commands', auth,
      { requestId: 'create', kind: 'session.create', targetDeviceId: hostId, modelProfileId: 'local' })
    const sessionId = create.body.command.sessionId
    await settled(origin, auth, create.body.command.commandId)
    const send = async (requestId: string, text: string) => {
      const result = await request(origin, 'POST', '/personal/v1/commands', auth,
        { requestId, kind: 'session.message', targetDeviceId: hostId, sessionId, text })
      assert.equal(result.status, 202)
      return result.body.command.commandId as string
    }
    const taskId = await send('same-a', 'identical text')
    const first = await settled(origin, auth, taskId)
    assert.equal(first.receiptId, 'receipt-1')
    assert.equal(first.taskLabel, 'identical text')
    const otherId = await send('same-b', 'identical text')
    assert.equal((await settled(origin, auth, otherId)).receiptId, 'receipt-2')
    const route = `/personal/v1/tasks/${taskId}`
    const stopped = await request(origin, 'POST', `${route}/stop`, auth, { requestId: 'stop-a' })
    assert.equal(stopped.status, 202, JSON.stringify(stopped.body))
    assert.deepEqual(stopCalls[0], ['receipt-1'])
    assert.equal(stopped.body.task.control.stopStatus, 'cancel_requested')
    const unchangedStore = statSync(join(root, 'store.json'))
    assert.equal((await request(origin, 'POST', `${route}/stop`, auth, { requestId: 'stop-a' })).status, 202)
    assert.equal(statSync(join(root, 'store.json')).mtimeMs, unchangedStore.mtimeMs, 'idempotent stop does not rewrite the store')
    assert.equal((await request(origin, 'POST', `${route}/stop`, auth, { requestId: 'stop-b' })).status, 409)
    const now = new Date(Date.now() + 1000).toISOString()
    events = [
      { seq: 1, type: 'turn.started', data: { turn: 1 } },
      { seq: 2, type: 'user.message', data: { text: 'identical text', receiptId: 'receipt-1' } },
      { seq: 3, type: 'user.message', data: { text: 'identical text', receiptId: 'receipt-2' } },
      { seq: 4, type: 'turn.ended', data: { turn: 1, reason: 'aborted' }, at: now },
    ]
    assert.equal((await request(origin, 'GET', route, auth)).body.control.canResume, false,
      'mixed unrelated receipt prevents a false stopped result')
    events = [
      { seq: 1, type: 'turn.started', data: { turn: 1 } },
      { seq: 2, type: 'user.message', data: { text: 'identical text', receiptId: 'receipt-1' } },
      { seq: 3, type: 'turn.ended', data: { turn: 1, reason: 'aborted' }, at: now },
      { seq: 4, type: 'turn.started', data: { turn: 2 } },
      { seq: 5, type: 'user.message', data: { text: 'identical text', receiptId: 'receipt-2' } },
      { seq: 6, type: 'turn.ended', data: { turn: 2, reason: 'completed' } },
    ]
    const observed = await request(origin, 'GET', route, auth)
    assert.equal(observed.body.control.stopStatus, 'stopped')
    assert.equal(observed.body.control.canResume, true)

    const waitingId = await send('pending-root', 'waiting')
    await waiting
    const pendingStop = await request(origin, 'POST', `/personal/v1/tasks/${waitingId}/stop`, auth,
      { requestId: 'stop-pending' })
    assert.equal(pendingStop.body.task.control.stopStatus, 'stopped')
    releaseWait?.()
    assert.equal((await settled(origin, auth, waitingId)).state, 'rejected')
    assert.equal(stopCalls.some((call) => call.includes('receipt-2')), false)

    const slowId = await send('late-root', 'slow')
    await slowSending
    const slowStop = await request(origin, 'POST', `/personal/v1/tasks/${slowId}/stop`, auth,
      { requestId: 'stop-late' })
    assert.equal(slowStop.body.task.control.canResume, false)
    releaseSlow?.()
    assert.equal((await settled(origin, auth, slowId)).receiptId, 'receipt-3')
    for (let i = 0; i < 100 && !stopCalls.some((call) => call.includes('receipt-3')); i++) await pause()
    assert.equal(stopCalls.some((call) => call.includes('receipt-3')), true,
      'late acceptance is cancelled using its frozen command identity')
    const restartId = await send('restart-root', 'restart target')
    assert.equal((await settled(origin, auth, restartId)).receiptId, 'receipt-4')
    const normalStop = backend.stopTask
    backend.stopTask = async () => { throw new Error('lost IPC acknowledgement') }
    const lost = await request(origin, 'POST', `/personal/v1/tasks/${restartId}/stop`, auth,
      { requestId: 'stop-restart' })
    assert.equal(lost.status, 202)
    assert.equal(lost.body.task.control.canResume, false)
    await service.close()
    backend.stopTask = normalStop
    service = await createPersonalAccessService({ root, port: 0, backend })
    origin = (await service.start()).origin
    auth.origin = origin
    for (let i = 0; i < 100 && !stopCalls.some((call) => call.includes('receipt-4')); i++) await pause()
    assert.equal(stopCalls.some((call) => call.includes('receipt-4')), true,
      'restart retries only the frozen receipt after lost acknowledgement')
    assert.equal((await request(origin, 'GET', `/personal/v1/tasks/${restartId}`, auth)).body.control.canResume, false)
    const longId = await send('bounded-label', `  ${'中文目标 '.repeat(30)}\n请继续  `)
    const label = (await settled(origin, auth, longId)).taskLabel
    assert.equal(typeof label, 'string')
    assert.ok(Array.from(label).length <= 73)
    assert.equal(label.includes('\n'), false)
    await service.close()
    const storeFile = join(root, 'store.json')
    const stored = JSON.parse(readFileSync(storeFile, 'utf8'))
    const account = Object.values(stored.accounts)[0] as any
    const target = account.commands[taskId].taskControl.stopRequests[0].targets[0]
    target.receiptId = 'receipt-2' // A valid receipt belonging to another root.
    writeFileSync(storeFile, JSON.stringify(stored))
    await assert.rejects(createPersonalAccessService({ root, port: 0, backend }),
      (error: Error & { code?: string }) => error.code === 'STORE_CORRUPT')
  } finally {
    releaseWait?.(); releaseSlow?.()
    await service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('stop retries back off in memory, ignore repeated reads, and stop at terminal evidence', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 })
  const source: any = { payload: { text: 'synthetic' }, commandId: 'task', kind: 'session.message', state: 'accepted_by_dsh', sessionId: 'session',
    taskControl: { state: 'stop_requested', stopRequests: [{ requestId: 'stop', at: new Date().toISOString(),
      targets: [{ commandId: 'task', receiptId: 'receipt' }] }] } }
  const account = { ownerId: 'owner', commands: { task: source }, sessions: { session: { origin: 'personal-remote' } } }
  const stopping = new Map()
  const calls: number[] = []
  let changedWrites = 0, terminal = false
  const context: any = { closing: false, storageFault: false, stopping, timestamp: () => Date.now(),
    requireOpen: () => {}, accountState: () => account, serial: (work: any) => work(), mutate: (_owner: any, change: any) => {
      const before = JSON.stringify(account); change(account)
      if (JSON.stringify(account) !== before) changedWrites++
    }, backend: {
      describeSession: async () => ({ sessionId: 'session', agentPreset: 'personal-remote' }),
      readSourceEvents: async () => ({ events: [
        { seq: 0, type: 'turn.started', data: { turn: 1 } },
        { seq: 1, type: 'user.message', data: { receiptId: 'receipt' } },
        ...(terminal ? [{ seq: 2, type: 'turn.ended', at: new Date().toISOString(), data: { turn: 1, reason: 'aborted' } }] : []),
      ] }),
      stopTask: async () => { calls.push(Date.now()); return { outcomes: [{ receiptId: 'receipt', status: 'unconfirmed' }] } },
    } }
  const tasks = createTaskOperations(context)
  try {
    await tasks.driveTaskStop('owner', 'task', true)
    for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
      t.mock.timers.tick(delay - 1)
      await tasks.driveTaskStop('owner', 'task')
      await tasks.driveTaskStop('owner', 'task', true)
      const count = calls.length
      t.mock.timers.tick(1)
      await Promise.all(stopping.values())
      assert.equal(calls.length, count + 1)
    }
    assert.deepEqual(calls.slice(1).map((at, i) => at - calls[i]), [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000])
    assert.equal(changedWrites, 1, 'only the first changed ack is durable')
    assert.equal(source.taskControl.stopRequests[0].lastAttemptAt, undefined)
    assert.equal(source.taskControl.stopRequests[0].targets[0].attemptAt, undefined)
    terminal = true
    assert.equal((await tasks.taskDetail(account, 'task')).control.stopStatus, 'stopped')
    const count = calls.length
    t.mock.timers.tick(60_000)
    await Promise.all(stopping.values())
    await tasks.driveTaskStop('owner', 'task', true)
    assert.equal(calls.length, count, 'terminal native evidence clears pending retries immediately')
  } finally { tasks.cancelTaskStopRetries() }
})
