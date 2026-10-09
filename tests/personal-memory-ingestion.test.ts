import assert from 'node:assert/strict'
import test from 'node:test'
import { createMemoryIngestion } from '../src/personal-access/memory-ingestion.mjs'
import { boundaryForCompletedTurn } from '../src/plugins/weftmate-personal-memory.mjs'
import { assertOwnerBoundBoundary } from '../src/personal-memory/boundary.mjs'
import { createDshSessionAdapter } from '../src/runtime/dsh-adapter/sessions.mjs'

test('native recovery pages completed boundaries and retains an unfinished turn across the cursor', async () => {
  const events: any[] = []
  const append = (type, data) => events.push({ seq: events.length, time: Date.parse('2026-10-09T00:00:00Z'), type, data })
  for (let turn = 1; turn <= 61; turn++) {
    append('turn/start', { turn }); append('user/message', { id: `u-${turn}`, source: { kind: 'user' }, content: [{ type: 'text', text: `合成回合${turn}` }] })
    if (turn <= 60) append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  const adapter = createDshSessionAdapter({ events: {}, sessions: { list: async () => ({ result: { ok: true, value: {
    items: [{ sessionId: 'session-paged', agentPreset: 'personal-remote' }],
  } } }) } }, { readLog: async () => events })
  const first = await adapter.memoryBoundaries('session-paged')
  assert.equal(first.items.length, 50); assert.equal(first.hasMore, true)
  const second = await adapter.memoryBoundaries('session-paged', first.nextSeq)
  assert.equal(second.items.length, 10); assert.equal(second.hasMore, false)
  append('turn/end', { turn: 61, reason: { kind: 'completed' } })
  const last = await adapter.memoryBoundaries('session-paged', second.nextSeq)
  assert.equal(last.items.length, 1); assert.equal(last.items[0].turn, 61)
  assert.equal(last.items[0].boundary.source_messages[0].content, '合成回合61')
  assert.equal((await adapter.memoryBoundaries('session-paged', last.nextSeq)).items.length, 0)
})

function fixture() {
  const accepted: string[] = [], history: Record<string, any[]> = {}
  let accounts: any = { owner: { sessions: {}, memoryCaptureSince: '2026-10-01T00:00:00.000Z' } }
  const context: any = { closing: false, timestamp: () => Date.parse('2026-10-10T00:00:00Z'),
    get rootState() { return { accounts } }, accountState: id => accounts[id],
    serial: task => task(), mutate: async (id, change) => { const next = structuredClone(accounts[id]); await change(next); accounts[id] = next },
    memoryManager: { enabled: true, acceptedBoundaryIds: async () => [], pendingStatus: async () => ({ pendingBoundaryCount: 0 }),
      ingest: async (_owner, boundary) => { accepted.push(boundary.event_id); return { state: 'queued' } } },
    backend: { readMemoryBoundaries: async ({ sessionId }) => ({ items: history[sessionId] ?? [] }) },
  }
  function add(id, day, options = {}) {
    accounts.owner.sessions[id] = { origin: 'personal-remote', ...options }
    history[id] = [{ turn: 1, sourceSeqs: [2, 3], at: `2026-09-${day}T00:00:00.000Z`,
      boundary: { event_id: `event-${id}`, source_messages: [{ content: '合成原话', role: 'user' }] } }]
  }
  return { context, accepted, history, add, create: () => createMemoryIngestion(context) }
}

test('history is opt-in, ordered, pausable, cancellable and idempotent; privacy exclusions survive restart', async () => {
  const f = fixture()
  f.add('third', 29); f.add('first', 27); f.add('second', 28)
  f.add('temporary', 26, { temporary: true, memoryMode: 'off' })
  f.add('off', 26, { memoryMode: 'off' })
  f.add('forgotten', 26, { forgottenSeqs: [2] })
  f.add('formerly-private', 26, { hasTemporaryContent: true, memoryTurns: { 1: { ingest: false } } })
  let manager = f.create()
  await manager.sweep(); assert.deepEqual(f.accepted, [], 'old history never runs automatically')
  const preview = await manager.preview('owner')
  assert.equal(preview.sessionCount, 3); assert.equal(preview.turnCount, 3)
  assert.ok(preview.estimatedUsage.inputTokens > 0)
  await assert.rejects(manager.action('owner', { action: 'start', previewId: preview.previewId }), { code: 'MEMORY_PREVIEW_REQUIRED' })
  const { job } = await manager.action('owner', { action: 'start', previewId: preview.previewId, confirm: true })
  await manager.sweep()
  await manager.action('owner', { action: 'pause', jobId: job.id }); await manager.sweep()
  const paused = f.accepted.length; assert.ok(paused <= 1)
  await manager.close(); manager = f.create(); await manager.sweep()
  assert.equal(f.accepted.length, paused, 'persisted pause survives process recreation')
  await manager.action('owner', { action: 'resume', jobId: job.id }); await manager.sweep(); await manager.sweep(); await manager.sweep()
  assert.deepEqual(f.accepted, ['event-first', 'event-second', 'event-third'])
  assert.equal(manager.status('owner').backfill.state, 'completed')
  assert.equal((await manager.preview('owner')).turnCount, 0)
  f.add('cancelled', 30)
  const next = await manager.preview('owner')
  // Hold the worker while cancellation is persisted.
  f.context.memoryManager.pendingStatus = async () => ({ pendingBoundaryCount: 1 })
  const started = await manager.action('owner', { action: 'start', previewId: next.previewId, confirm: true })
  await manager.action('owner', { action: 'cancel', jobId: started.job.id }); await manager.sweep()
  assert.equal(f.accepted.length, 3)
  await manager.close()
})

test('durable new DSH turns recover a missed IPC with frozen per-turn exclusions', async () => {
  const f = fixture(); f.add('ordinary', 30); f.add('private', 30, { memoryTurns: { 1: { ingest: false } } })
  for (const list of Object.values(f.history)) list[0].at = '2026-10-09T00:00:00Z'
  const manager = f.create(); await manager.sweep(); await manager.sweep()
  assert.deepEqual(f.accepted, ['event-ordinary'])
  await manager.close(); const restarted = f.create(); await restarted.sweep()
  assert.deepEqual(f.accepted, ['event-ordinary']); await restarted.close()
})

test('long visible messages remain complete boundary sources instead of silently disappearing', () => {
  const text = '合成完整原话'.repeat(4000)
  const events = [{ seq: 1, type: 'turn/start', data: { turn: 1 } },
    { seq: 2, type: 'user/message', data: { id: 'u', source: { kind: 'user' }, content: [{ type: 'text', text }] } },
    { seq: 3, type: 'assistant/message', data: { message: { id: 'a', content: [{ type: 'text', text }] } } },
    { seq: 4, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }]
  const boundary = boundaryForCompletedTurn({ id: 'session-long', header: { agentPreset: 'personal-remote' }, events }, events[3])
  assert.equal(assertOwnerBoundBoundary('session-long', boundary).source_messages[0].content, text)
  assert.equal(boundary.source_messages[1].content, text)
})
