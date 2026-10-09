import assert from 'node:assert/strict'
import test from 'node:test'
import { readNativeTaskStopState } from '../src/runtime/dsh-adapter/task-stop-state.mjs'

const meta = { id: 'session', agentPreset: 'personal-remote' }
const input = { sessionId: 'session', receiptId: 'receipt', turn: 1, stopRequestedAt: '2026-10-09T00:00:00.000Z' }
const started = Date.parse(input.stopRequestedAt) + 1000
const events = () => [
  { seq: 0, time: started - 2000, type: 'turn/start', data: { turn: 1 } },
  { seq: 1, time: started - 1900, type: 'user/message', data: { source: { kind: 'user', rpcId: 'receipt' } } },
]
function native(rows = events(), agent: any = null) {
  const artifact = { meta, events: rows }
  const persistence: any = { readFrom: async () => artifact, list: async () => [meta] }
  const ctx: any = { sessions: { get: () => null }, agents: { get: () => agent }, get: () => persistence }
  return { ctx, persistence, read: () => readNativeTaskStopState(ctx, started, input) }
}

for (const reason of ['completed', 'aborted', 'error', 'blocked', 'max-tokens', 'unknown']) {
  test(`native stop state accepts actual terminal: ${reason}`, async () => {
    const rows: any[] = events()
    rows.push({ seq: 2, time: started, type: 'turn/end', data: { turn: 1, reason: { kind: reason } } })
    const f = native(rows)
    assert.equal((await f.read()).status, reason === 'aborted' ? 'cancelled' : 'ended')
    rows[1].data.source.rpcId = 'other-receipt'
    assert.equal((await readNativeTaskStopState(f.ctx, started - 2000, input)).status, 'unconfirmed',
      'a terminal for a different receipt cannot confirm this target')
  })
}

test('restart resolves absent/open historical turns, but never a possibly live or queued input', async () => {
  assert.equal((await native().read()).status, 'not_running')
  assert.equal((await native([]).read()).status, 'not_running')
  const f = native()
  assert.equal((await readNativeTaskStopState(f.ctx, started - 2000, input)).status, 'unconfirmed')
  for (const [status, hasPending] of [['running', false], ['idle', true], ['unknown', false], ['idle', undefined]]) {
    const agent = { status, session: { id: meta.id, header: meta, events: events() }, inbox: { hasPending } }
    assert.equal((await native(events(), agent).read()).status, 'unconfirmed')
  }
  const idle = { status: 'idle', session: { id: meta.id, header: meta, events: [] }, inbox: { hasPending: false } }
  assert.equal((await native([], idle).read()).status, 'not_running')
  const queued: any[] = [{ seq: 0, type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0,
    removedCount: 0, inserted: [{ source: { kind: 'user', rpcId: 'receipt' } }] } }]
  assert.equal((await native(queued).read()).status, 'unconfirmed')
  queued.push({ seq: 1, type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, removedCount: 1 } })
  assert.equal((await native(queued).read()).status, 'not_running')
})

test('missing session requires authoritative native absence after restart; read failures stay unknown', async () => {
  const f = native()
  f.persistence.readFrom = async () => { throw new Error('session "session" not found') }
  assert.equal((await f.read()).status, 'unconfirmed', 'listed corrupt/unreadable session is not absent')
  f.persistence.list = async () => []
  assert.equal((await f.read()).status, 'not_running')
  assert.equal((await readNativeTaskStopState(f.ctx, started - 2000, input)).status, 'unconfirmed')
  f.persistence.list = async () => { throw new Error('storage unavailable') }
  assert.equal((await f.read()).status, 'unconfirmed')
})

test('agent appearing during async persistence read prevents orphan completion', async () => {
  const f = native()
  f.persistence.readFrom = async () => {
    f.ctx.agents.get = () => ({ status: 'running', session: { id: meta.id, header: meta, events: events() }, inbox: { hasPending: false } })
    return { meta, events: events() }
  }
  assert.equal((await f.read()).status, 'unconfirmed')
})

test('native claimed-input identity binds an actual cancellation without a user/message', async () => {
  const rows: any[] = [
    { seq: 0, type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, removedCount: 0,
      inserted: [{ source: { kind: 'user', rpcId: 'receipt' } }] } },
    { seq: 1, type: 'turn/start', data: { turn: 1 } },
    { seq: 2, type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, removedCount: 1 } },
    { seq: 3, time: started, type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted' } } },
  ]
  assert.equal((await native(rows).read()).status, 'cancelled')
})
