import assert from 'node:assert/strict'
import test from 'node:test'
import { createTaskOperations } from '../src/personal-access/tasks.mjs'
import { createDshSessionAdapter } from '../src/runtime/dsh-adapter/sessions.mjs'
import { stopExactTask } from '../src/plugins/weftmate-personal-task-control.mjs'
import { sourceRange } from '../src/runtime/dsh-adapter/source-range.mjs'

const message = (receipt: string) => ({ id: receipt, source: { kind: 'user', rpcId: receipt }, content: [] })

for (const reader of ['native', 'timeline']) test(`early stop before user persistence becomes resumable via ${reader} evidence`, async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-08T00:00:00Z') })
  const entries: any[] = [
    { seq: 0, type: 'agent/inbox/spliced', data: { target: 'next-step', start: 0, inserted: [message('receipt')] } },
    { seq: 1, type: 'turn/start', data: { turn: 1 } },
    { seq: 2, type: 'agent/inbox/spliced', data: { target: 'next-step', start: 0, removedCount: 1, inserted: [] } },
    { seq: 3, type: 'step/start', data: { turn: 1, step: 1 } },
  ]
  const session = { id: 'session', header: { agentPreset: 'personal-remote' }, events: entries }
  const agent = { session, phase: { kind: 'running', turn: 1, abort: new AbortController() },
    inbox: { nextStep: [], nextTurn: [], hasPending: false }, cancel: () => agent.phase.abort.abort() }
  const outcome = stopExactTask({ get: () => agent }, new Map([['session', new Map([[1, new Map([['receipt', message('receipt')]])]])]]),
    { sessionId: 'session', receiptIds: ['receipt'] }).outcomes[0]
  assert.equal(outcome.status, 'cancel_requested')
  const adapter = createDshSessionAdapter({ sessions: { list: async () => ({ result: { ok: true, value: {
    items: [{ sessionId: 'session', agentPreset: 'personal-remote' }] } } }) }, events: {} }, { readLog: async () => entries })
  const source: any = { commandId: 'task', kind: 'session.message', sessionId: 'session', receiptId: 'receipt',
    state: 'accepted_by_dsh', payload: { text: 'goal' }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    taskControl: { state: 'stop_requested', stopRequests: [{ at: new Date().toISOString(), requestId: 'stop',
      targets: [{ commandId: 'task', receiptId: 'receipt', ack: outcome.status }] }] } }
  const account = { ownerId: 'owner', commands: { task: source }, sessions: { session: { origin: 'personal-remote' } } }
  const timeline = () => entries.filter(e => ['turn/start', 'step/start', 'turn/end'].includes(e.type)).map(e => ({
    seq: e.seq, at: e.time === undefined ? undefined : new Date(e.time).toISOString(),
    type: e.type === 'turn/start' ? 'turn.started' : e.type === 'step/start' ? 'task.started' : 'turn.ended',
    data: e.type === 'step/start' ? { turn: 1, receiptId: 'receipt' } : { turn: e.data.turn, reason: e.data.reason?.kind } }))
  const backend: any = { describeSession: async () => ({ sessionId: 'session', agentPreset: 'personal-remote' }),
    ...(reader === 'native' ? { readSourceEvents: ({ sessionId, receiptId }: any) => adapter.sourceEvents(sessionId, { receiptId }) }
      : { readEvents: async () => ({ events: timeline(), nextSeq: entries.at(-1).seq, hasMore: false }) }) }
  const tasks = createTaskOperations({ timestamp: () => Date.now(), requireOpen() {}, backend } as any)
  assert.equal((await tasks.taskDetail(account, 'task')).control.canResume, false)
  t.mock.timers.tick(1000)
  entries.push({ seq: 4, type: 'step/end', data: { turn: 1, step: 1 } },
    { seq: 5, type: 'turn/end', time: Date.now(), data: { turn: 1, reason: { kind: 'aborted' } } })
  assert.ok(!entries.some(e => e.type === 'user/message'))
  const stopped = (await tasks.taskDetail(account, 'task')).control
  assert.equal(stopped.stopStatus, 'stopped')
  assert.equal(stopped.pendingReceipts, 0)
  assert.equal(stopped.canResume, true)
  // A later unrelated turn cannot supply or steal this receipt's terminal evidence.
  entries.push({ seq: 6, type: 'turn/start', data: { turn: 2 } },
    { seq: 7, type: 'user/message', data: message('other') })
  assert.equal((await tasks.taskDetail(account, 'task')).control.canResume, true)
  if (reader === 'native') {
    entries.splice(4, 0, { type: 'user/message', data: message('receipt') })
    entries.forEach((entry, seq) => { entry.seq = seq })
    assert.equal((await tasks.taskDetail(account, 'task')).control.pendingReceipts, 0,
      'claim and persisted user message for one receipt are the same input')
    // Claimed but unpersisted steer inputs must belong to the frozen target set too.
    entries.splice(5, 0,
      { type: 'agent/inbox/spliced', data: { target: 'next-step', start: 0, inserted: [message('steer')] } },
      { type: 'agent/inbox/spliced', data: { target: 'next-step', start: 0, removedCount: 1, inserted: [] } })
    entries.forEach((entry, seq) => { entry.seq = seq })
    assert.equal((await tasks.taskDetail(account, 'task')).control.canResume, false,
      'unrelated claimed input prevents false whole-turn stop confirmation')
    source.taskControl.stopRequests[0].targets.push({ commandId: 'steer', receiptId: 'steer', ack: 'cancel_requested' })
    account.commands['steer'] = { ...source, commandId: 'steer', receiptId: 'steer', rootTaskId: 'task' }
    assert.equal((await tasks.taskDetail(account, 'task')).control.canResume, true)
    assert.equal((await tasks.taskDetail(account, 'task')).control.pendingReceipts, 0)
    entries[5].data.inserted[0].source.rpcId = 'invalid receipt'
    assert.equal((await tasks.taskDetail(account, 'task')).control.canResume, false,
      'missing or invalid claimed identity cannot prove a stopped target')
  }
})

test('durable receipt lookup ignores canceled and replaced input, and resolves an insertion across history pages', async () => {
  const entries: any[] = [
    { seq: 0, type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, inserted: [message('canceled'), message('replaced')] } },
    { seq: 1, type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, removedCount: 1, inserted: [], outcome: 'canceled' } },
    { seq: 2, type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, removedCount: 1, inserted: [message('receipt')] } },
    { seq: 3, type: 'turn/start', data: { turn: 1 } },
    { seq: 4, type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, removedCount: 1, inserted: [] } },
    { seq: 5, type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted' } } },
  ]
  assert.equal(sourceRange(entries, { receiptId: 'canceled' }), null)
  assert.equal(sourceRange(entries, { receiptId: 'replaced' }), null)
  assert.equal(sourceRange(entries, { receiptId: 'receipt' })?.start, 3)
  let reads = 0
  const adapter = createDshSessionAdapter({ sessions: {
    list: async () => ({ result: { ok: true, value: { items: [{ sessionId: 'session', agentPreset: 'personal-remote' }] } } }),
    history: async ({ beforeSeq }: any) => {
      reads++
      return { result: { ok: true, value: { events: beforeSeq === undefined ? entries.slice(3) : entries.slice(0, 3),
        hasMore: beforeSeq === undefined } } }
    },
  }, events: {} })
  for (const turn of [undefined, 1]) {
    reads = 0
    const proof = await adapter.sourceEvents('session', { receiptId: 'receipt', turn })
    assert.equal(reads, 2)
    assert.deepEqual(proof.events.find(e => e.type === 'input.claimed')?.data, { receipts: ['receipt'] })
    assert.equal(JSON.stringify(proof).includes('source'), false)
    assert.equal(JSON.stringify(proof).includes('content'), false)
  }
})
