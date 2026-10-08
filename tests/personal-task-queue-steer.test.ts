import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPersonalAccessService } from '../src/personal-access/index.mjs'
import { canonicalCommand } from '../src/personal-access/command-policy.mjs'
import { stopExactTask, createTaskStopHandler } from '../src/plugins/weftmate-personal-task-control.mjs'
import { indexInboxTimeline, turnReceiptAt } from '../src/runtime/dsh-adapter/inbox-timeline.mjs'
import { projectHistoryEvent } from '../src/runtime/dsh-adapter/sessions.mjs'

test('send intent defaults to steer, accepts legacy mode, and rejects ambiguous intent', () => {
  const body = { requestId: 'send', kind: 'session.message', targetDeviceId: 'host-a', sessionId: 'session-a', text: 'goal' }
  assert.equal(canonicalCommand(body, 'host-a').mode, 'steer')
  assert.equal(canonicalCommand({ ...body, intent: 'queue' }, 'host-a').mode, 'queue')
  assert.equal(canonicalCommand({ ...body, mode: 'queue' }, 'host-a').mode, 'queue')
  assert.throws(() => canonicalCommand({ ...body, mode: 'queue', intent: 'steer' }, 'host-a'))
})

test('native queue metadata preserves splice seq, FIFO receipt identity, cancellation and turn binding', () => {
  const msg = (rpcId: string) => ({ id: rpcId, source: { kind: 'user', rpcId }, content: [{ type: 'text', text: rpcId }] })
  const entries: any[] = [
    { seq: 0, type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, inserted: [msg('a')] } },
    { seq: 1, type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 1, inserted: [msg('b')] } },
    { seq: 2, type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 1, removedCount: 1, inserted: [], outcome: 'canceled' } },
    { seq: 3, type: 'turn/start', data: { turn: 1 } },
    { seq: 4, type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, removedCount: 1, inserted: [] } },
    { seq: 5, type: 'step/start', data: { turn: 1, step: 1 } },
  ]
  const cache = {}, metadata = indexInboxTimeline(entries, cache)
  assert.equal(projectHistoryEvent(entries[0], null, null, null, metadata.get(0)).data.receiptId, 'a')
  assert.deepEqual(projectHistoryEvent(entries[2], null, null, null, metadata.get(2)),
    { seq: 2, type: 'task.ended', data: { taskId: 'b', receiptId: 'b', reason: 'canceled' } })
  assert.equal(projectHistoryEvent(entries[5], null, null, null, metadata.get(5)).data.receiptId, 'a')
  entries.push({ seq: 6, type: 'step/end', data: { turn: 1, step: 1 } },
    { seq: 7, type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted' } } })
  assert.equal(indexInboxTimeline(entries, cache), metadata)
  assert.equal(projectHistoryEvent(entries[6], null, null, entries[7], metadata.get(6)).data.receiptId, 'a')
})

test('steer root uses claimed native input before user message persistence and stops at turn end', () => {
  const entries = [
    { seq: 0, type: 'agent/inbox/spliced', data: { target: 'next-step', start: 0,
      inserted: [{ id: 'first', source: { kind: 'user', rpcId: 'first' }, content: [] }] } },
    { seq: 1, type: 'turn/start', data: { turn: 1 } },
    { seq: 2, type: 'agent/inbox/spliced', data: { target: 'next-step', start: 0, removedCount: 1, inserted: [] } },
    { seq: 3, type: 'agent/inbox/spliced', data: { target: 'next-step', start: 0, inserted: [] } },
    { seq: 4, type: 'turn/end', data: { turn: 1 } },
  ]
  assert.equal(turnReceiptAt(entries, 3), 'first')
  const beforeUser = indexInboxTimeline([...entries.slice(0, 3), { seq: 3, type: 'step/start', data: { turn: 1, step: 1 } }], {}, 3)
  assert.equal(beforeUser.receiptId, 'first')
  assert.equal(turnReceiptAt(entries, 5), null)
})

test('queued-only cancellation never aborts a task that won the start race', () => {
  let cancels = 0
  const session = { id: 'session-a', header: { agentPreset: 'personal-remote' }, events: [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'user/message', data: { id: 'a', source: { kind: 'user', rpcId: 'a' } } },
  ] }
  const agent = { session, phase: { kind: 'running', turn: 1, abort: new AbortController() },
    inbox: { nextTurn: [], nextStep: [] }, cancel: () => { cancels++ } }
  const result = stopExactTask({ get: () => agent }, new Map(), { sessionId: 'session-a', receiptIds: ['a'], queuedOnly: true })
  assert.equal(result.status, 'unconfirmed'); assert.equal(cancels, 0)
  let jobStops = 0, stoppedClaims = 0
  const handler = createTaskStopHandler({ get: () => agent }, new Map(), () => {},
    () => { jobStops++ }, () => { stoppedClaims++ })
  handler({ protocol: 'weftmate.personal-task-control.v1', id: 'stop-12345678-1234-1234-1234-123456789abc',
    sessionId: 'session-a', requestId: 'race', receiptIds: ['a'], queuedOnly: true })
  assert.equal(jobStops, 0); assert.equal(stoppedClaims, 0, 'failed queue cancellation cannot latch future job stops')
})

test('two authenticated clients serialize sends, steer belongs to active root, cancel is idempotent across restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-queue-api-'))
  let running = false, sessionId = '', receipt = 0, activeReceipt = ''
  let enteredLate: () => void, releaseLate: () => void
  const lateEntered = new Promise<void>(resolve => { enteredLate = resolve })
  const lateGate = new Promise<void>(resolve => { releaseLate = resolve })
  const events: any[] = [], sends: any[] = [], removed: string[] = []
  const backend = {
    getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }),
    listModels: async () => [{ id: 'local', name: 'Local', model: 'synthetic', configured: true }],
    preflight: async () => ({ ok: true }),
    createSession: async (input: any) => { sessionId = input.sessionId; return { sessionId } },
    describeSession: async (id: string) => id === sessionId ? { sessionId, running, agentPreset: 'personal-remote' } : null,
    sendMessage: async (input: any) => {
      const receiptId = `receipt-${++receipt}`; sends.push({ ...input, receiptId })
      if (!running) {
        running = true; activeReceipt = receiptId
        events.push({ seq: events.length, type: 'turn.started', data: { turn: 1 } },
          { seq: events.length + 1, type: 'user.message', data: { receiptId } })
      } else if (input.mode === 'steer') events.push({ seq: events.length, type: 'user.message', data: { receiptId } })
      if (input.text === 'late') { enteredLate(); await lateGate }
      return { accepted: true, receiptId, ...(input.mode === 'steer' && receiptId !== activeReceipt ? { steeredReceiptId: activeReceipt } : {}) }
    },
    readSourceEvents: async ({ receiptId }: any) => ({ current: events.some(event => event.data?.receiptId === receiptId), events }),
    readEvents: async ({ afterSeq = -1 }: any) => ({ events: events.filter(event => event.seq > afterSeq), nextSeq: events.at(-1)?.seq ?? -1, hasMore: false }),
    cancelSession: async () => { throw Error('no session-wide cancel') },
    stopTask: async ({ receiptIds, queuedOnly }: any) => ({ outcomes: receiptIds.map((receiptId: string) => {
      if (queuedOnly && receiptId === activeReceipt) return { receiptId, status: 'unconfirmed' }
      removed.push(receiptId); return { receiptId, status: queuedOnly ? 'queue_removed' : 'cancel_requested' }
    }) }),
  }
  let service = await createPersonalAccessService({ root, port: 0, backend })
  let origin: string
  async function api(auth: any, route: string, body?: any) {
    const response = await fetch(origin + '/personal/v1' + route, { method: body ? 'POST' : 'GET',
      headers: { origin, 'content-type': 'application/json', ...auth }, body: body ? JSON.stringify(body) : undefined })
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] }
  }
  async function settle(auth: any, id: string) {
    for (let i = 0; i < 100; i++) {
      const result = (await api(auth, `/commands/${id}`)).body.command
      if (!['pending', 'dispatching'].includes(result.state)) return result
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    throw Error('send timeout')
  }
  try {
    const started = await service.start(); origin = started.origin
    const grant = await service.issueSetupGrant()
    const setup = await api({}, '/auth/setup', { grant: grant.grant, username: 'QueueOwner', password: 'queue synthetic password 123', deviceName: 'One' })
    assert.equal(setup.status, 201)
    const one = { cookie: setup.cookie, 'x-weftmate-csrf': setup.body.csrfToken }
    const login = await api({}, '/auth/login', { username: 'QueueOwner', password: 'queue synthetic password 123', deviceName: 'Two' })
    const two = { cookie: login.cookie, 'x-weftmate-csrf': login.body.csrfToken }
    const create = await api(one, '/commands', { requestId: 'create', kind: 'session.create', targetDeviceId: started.hostId, modelProfileId: 'local' })
    await settle(one, create.body.command.commandId)
    const send = async (auth: any, requestId: string, intent?: string) => {
      const response = await api(auth, '/commands', { requestId, kind: 'session.message', targetDeviceId: started.hostId, sessionId, text: requestId, ...(intent ? { intent } : {}) })
      assert.equal(response.status, 202, JSON.stringify(response.body)); return response.body.command
    }
    const active = await send(one, 'active'); await settle(one, active.commandId)
    const [adjust, queued] = await Promise.all([send(one, 'adjust'), send(two, 'queued', 'queue')])
    const amendment = await settle(one, adjust.commandId), next = await settle(two, queued.commandId)
    assert.equal(amendment.intent, 'steer'); assert.equal(amendment.rootTaskId, active.commandId)
    assert.equal(next.rootTaskId, undefined); assert.equal(next.intent, 'queue')
    assert.equal(sends[0].text, 'active')
    assert.deepEqual(new Set(sends.slice(1).map(send => send.text)), new Set(['adjust', 'queued']))
    const retry = await send(one, 'adjust'); assert.equal(retry.commandId, adjust.commandId)
    const canceled = await api(two, `/tasks/${next.commandId}/cancel`, { requestId: 'cancel-next' })
    assert.equal(canceled.status, 202, JSON.stringify(canceled.body)); assert.equal(canceled.body.task.control.stopStatus, 'stopped')
    assert.equal((await api(one, `/tasks/${active.commandId}/cancel`, { requestId: 'race' })).status, 409)
    assert.equal((await api(one, `/tasks/${next.commandId}/stop`, { requestId: 'cancel-next' })).status, 409)
    await service.close(); service = await createPersonalAccessService({ root, port: 0, backend }); origin = (await service.start()).origin
    assert.equal((await api(two, `/tasks/${next.commandId}/cancel`, { requestId: 'cancel-next' })).status, 202)
    assert.deepEqual(removed, [next.receiptId])
    const late = await send(two, 'late'); await lateEntered
    const stop = await api(one, `/tasks/${active.commandId}/stop`, { requestId: 'stop-active' })
    releaseLate()
    const lateCommand = await settle(two, late.commandId)
    assert.equal(lateCommand.rootTaskId, active.commandId)
    for (let i = 0; i < 100 && !removed.includes(lateCommand.receiptId); i++) await new Promise(resolve => setTimeout(resolve, 20))
    assert.ok(removed.includes(lateCommand.receiptId), 'pre-stop native steer is included after its receipt binds')
    assert.equal(stop.status, 202); assert.ok(removed.includes(amendment.receiptId))
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }) }
})
