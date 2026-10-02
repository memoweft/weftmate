import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DshWebRuntime } from '../src/dsh-web-runtime.ts'
import { projectHistoryEvent } from '../src/runtime/dsh-adapter/sessions.mjs'
import { createTaskStopHandler, stopExactTask } from '../src/plugins/weftmate-personal-task-control.mjs'

const message = (id: string, rpcId: string | null, text = 'same text') => ({ id,
  source: rpcId === null ? { kind: 'user' } : { kind: 'user', rpcId },
  content: [{ type: 'text', text }] })
function fixture() {
  const queue = { nextTurn: [] as any[], nextStep: [] as any[], remove(id: string) {
    for (const list of [this.nextTurn, this.nextStep]) {
      const at = list.findIndex((item) => item.id === id)
      if (at >= 0) { list.splice(at, 1); return true }
    }
    return false
  }, get hasPending() { return this.nextTurn.length > 0 || this.nextStep.length > 0 } }
  let cancels = 0, wakes = 0
  const session = { id: 'session-a', header: { agentPreset: 'personal-remote' },
    events: [] as any[] }
  const agent = { session, inbox: queue, phase: { kind: 'idle', turn: 0,
    abort: new AbortController() }, cancel: (_cause: unknown, opts: any) => {
      assert.equal(opts.keepInbox, true); cancels++
      agent.phase.abort.abort()
    }, wakeDriver: (afterAbort: boolean) => { assert.equal(afterAbort, true); wakes++ } }
  const agents = { get: (id: string) => id === session.id ? agent : undefined }
  const claimed = new Map<string, Map<number, Map<string, any>>>()
  const run = (receiptIds: string[]) => stopExactTask(agents, claimed,
    { sessionId: session.id, receiptIds })
  return { session, agent, queue, claimed, run, get cancels() { return cancels }, get wakes() { return wakes } }
}

test('exact queued removal preserves unrelated messages, including duplicate text', () => {
  const f = fixture()
  f.queue.nextTurn.push(message('target', 'receipt-a'), message('other', 'receipt-b'))
  f.queue.nextStep.push(message('steer', 'receipt-c'))
  assert.deepEqual(f.run(['receipt-a']).outcomes, [{ receiptId: 'receipt-a', status: 'queue_removed' }])
  assert.deepEqual(f.queue.nextTurn.map((item) => item.id), ['other'])
  assert.deepEqual(f.queue.nextStep.map((item) => item.id), ['steer'])
  assert.equal(f.cancels, 0)
})

test('pinned rc.5 inbox removal survives durable replay with unrelated queue intact', async () => {
  const { Inbox } = await import(pathToFileURL(join(process.cwd(), 'vendor', 'dsh-runtime',
    'node_modules', '@deepseek-ai', 'dsh-agent', 'lib', 'types', 'inbox.js')).href)
  const session = { header: { seedLength: 0 }, events: [] as any[], append(type: string, data: any) {
    const event = { seq: this.events.length + 1, type, data: structuredClone(data) }
    this.events.push(event)
    return event
  } }
  const notifications = { inserted: () => {}, discarded: () => {}, claimed: () => {} }
  const inbox = new Inbox(session, notifications)
  inbox.append('next-turn', message('target', 'receipt-a'))
  inbox.append('next-turn', message('other', 'receipt-b'))
  assert.equal(inbox.remove('target'), true)
  assert.equal(session.events.at(-1).data.outcome, 'canceled')
  const replayed = new Inbox(session, notifications)
  assert.deepEqual(replayed.nextTurn.map((item: any) => item.id), ['other'])
})

test('claimed before user persistence and streaming turn cancel only exact active source', () => {
  const f = fixture()
  f.session.events.push({ type: 'turn/start', data: { turn: 1 } })
  f.agent.phase = { kind: 'running', turn: 1, abort: new AbortController() }
  f.claimed.set(f.session.id, new Map([[1, new Map([['target', message('target', 'receipt-a')]])]]))
  const result = f.run(['receipt-a'])
  assert.deepEqual(result.outcomes, [{ receiptId: 'receipt-a', status: 'cancel_requested', turn: 1 }])
  assert.equal(f.cancels, 1)
  f.session.events.push({ type: 'user/message', data: message('target', 'receipt-a') })
  assert.equal(f.run(['receipt-a']).status, 'unconfirmed', 'aborted turn is not cancelled a second time')
})

test('active stop latches a preserved unrelated queued turn after abort', () => {
  const f = fixture()
  f.session.events.push({ type: 'turn/start', data: { turn: 1 } },
    { type: 'user/message', data: message('target', 'receipt-a') })
  f.agent.phase = { kind: 'running', turn: 1, abort: new AbortController() }
  f.queue.nextTurn.push(message('other', 'receipt-b'))
  assert.equal(f.run(['receipt-a']).status, 'cancel_requested')
  assert.equal(f.wakes, 1)
  assert.deepEqual(f.queue.nextTurn.map((item) => item.id), ['other'])
})

test('ended turn and next unrelated turn cannot inherit a prior receipt', () => {
  const f = fixture()
  f.session.events.push({ type: 'turn/start', data: { turn: 1 } },
    { type: 'user/message', data: message('target', 'receipt-a') },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    { type: 'turn/start', data: { turn: 2 } },
    { type: 'user/message', data: message('other', 'receipt-b') })
  f.agent.phase = { kind: 'running', turn: 2, abort: new AbortController() }
  assert.equal(f.run(['receipt-a']).status, 'unconfirmed')
  assert.equal(f.cancels, 0)
})

test('mixed steer and missing source refuse whole-turn cancellation', () => {
  for (const unrelated of [message('other', 'receipt-b'), message('unknown', null)]) {
    const f = fixture()
    f.session.events.push({ type: 'turn/start', data: { turn: 3 } },
      { type: 'user/message', data: message('target', 'receipt-a') })
    f.agent.phase = { kind: 'running', turn: 3, abort: new AbortController() }
    f.claimed.set(f.session.id, new Map([[3, new Map([[unrelated.id, unrelated]])]]))
    assert.equal(f.run(['receipt-a']).status, 'unconfirmed')
    assert.equal(f.cancels, 0)
  }
})

test('a stop before claim retries after identity appears; later receipt batches stay independent', () => {
  const f = fixture()
  const replies: any[] = []
  const handle = createTaskStopHandler({ get: (id: string) => id === f.session.id ? f.agent : undefined },
    f.claimed, (reply: any) => replies.push(reply))
  const frame = (id: string, receiptIds: string[]) => ({ protocol: 'weftmate.personal-task-control.v1',
    id, sessionId: f.session.id, requestId: 'same-request', receiptIds })
  handle(frame('stop-12345678-1234-1234-1234-123456789abc', ['receipt-a']))
  assert.equal(replies.at(-1).status, 'unconfirmed')
  f.session.events.push({ type: 'turn/start', data: { turn: 1 } })
  f.agent.phase = { kind: 'running', turn: 1, abort: new AbortController() }
  f.claimed.set(f.session.id, new Map([[1, new Map([['target', message('target', 'receipt-a')]])]]))
  handle(frame('stop-22345678-1234-1234-1234-123456789abc', ['receipt-a']))
  assert.equal(replies.at(-1).status, 'cancel_requested')
  assert.equal(f.cancels, 1)
  f.session.events.push({ type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted' } } },
    { type: 'turn/start', data: { turn: 2 } }, { type: 'user/message', data: message('other', 'receipt-b') })
  f.agent.phase = { kind: 'running', turn: 2, abort: new AbortController() }
  handle(frame('stop-32345678-1234-1234-1234-123456789abc', ['receipt-a', 'receipt-c']))
  assert.equal(replies.at(-1).status, 'unconfirmed')
  assert.deepEqual(replies.at(-1).outcomes.map((item: any) => item.status),
    ['cancel_requested', 'unconfirmed'])
  assert.equal(f.cancels, 1, 'same request cannot cancel a newer unrelated turn')
  f.queue.nextTurn.push(message('later-target', 'receipt-c'))
  handle(frame('stop-42345678-1234-1234-1234-123456789abc', ['receipt-c']))
  assert.equal(replies.at(-1).status, 'queue_removed')
  assert.equal(f.cancels, 1)
})

test('history exposes validated receipt and native turn without source secrets', () => {
  const start = projectHistoryEvent({ seq: 1, type: 'turn/start', data: { turn: 2 } })
  const user = projectHistoryEvent({ seq: 2, type: 'user/message', data: message('m1', 'receipt-a') })
  const end = projectHistoryEvent({ seq: 3, type: 'turn/end',
    data: { turn: 2, reason: { kind: 'aborted' } } })
  assert.deepEqual(start?.data, { turn: 2 })
  assert.equal(user?.data?.receiptId, 'receipt-a')
  assert.equal(JSON.stringify(user).includes('source'), false)
  assert.deepEqual(end?.data, { reason: 'aborted', turn: 2 })
  assert.equal(projectHistoryEvent({ seq: 4, type: 'user/message',
    data: message('m2', 'invalid receipt') })?.data?.receiptId, undefined)
})

test('parent stop IPC validates replies, times out, and rejects replaced children', async () => {
  const runtime = new DshWebRuntime({ homeDir: 'C:\\synthetic\\dsh-home',
    workspaceDir: 'C:\\synthetic\\work' }) as any
  const frames: any[] = []
  const child = { connected: true, send: (frame: any, callback: any) => {
    frames.push(frame); callback?.(null)
  } }
  runtime.child = child
  runtime.originValue = 'http://127.0.0.1:12345'
  const request = { sessionId: 'session-a', requestId: 'request-a', receiptIds: ['receipt-a'] }
  const first = runtime.stopPersonalTask(request)
  const frame = frames[0]
  runtime.handleTaskStopMessage(child, { protocol: frame.protocol, id: frame.id, status: 'cancel_requested',
    outcomes: [{ receiptId: 'receipt-a', status: 'cancel_requested', turn: 1 }] })
  assert.equal((await first).status, 'cancel_requested')
  const malformed = runtime.stopPersonalTask(request)
  const second = frames[1]
  runtime.handleTaskStopMessage(child, { protocol: second.protocol, id: second.id, status: 'queue_removed',
    outcomes: [{ receiptId: 'wrong', status: 'queue_removed' }] })
  assert.equal((await malformed).status, 'unconfirmed')
  const replacement = runtime.stopPersonalTask(request)
  runtime.child = { connected: true, send: () => {} }
  runtime.failTaskStopRequests(child)
  assert.equal((await replacement).status, 'unconfirmed')
  runtime.child = child
  const disconnect = runtime.stopPersonalTask(request)
  child.connected = false
  runtime.failTaskStopRequests(child)
  assert.equal((await disconnect).status, 'unconfirmed')
  child.connected = true
  const timeout = runtime.stopPersonalTask(request)
  assert.equal((await timeout).status, 'unconfirmed')
  assert.equal(runtime.taskStopPending.size, 0)
})
