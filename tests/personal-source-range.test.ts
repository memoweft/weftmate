import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import test from 'node:test'
import { createDshSessionAdapter } from '../src/runtime/dsh-adapter/sessions.mjs'
import { createNativeQuestionSnapshots, questionSourceAsOf } from '../src/runtime/dsh-adapter/agents.mjs'
import { durableSourceRange, sourceRange } from '../src/runtime/dsh-adapter/source-range.mjs'
import { projectReplyEvidence } from '../src/personal-reply-evidence/index.mjs'
import { createPersonalAccessBackend } from '../src/personal-access-backend.mjs'
import { createGatewayV1 } from '../src/runtime/gateway/routes/v1.mjs'

const sid = 'session-long-source', text = 'current goal'
const hash = createHash('sha256').update(text).digest('hex')
function history(oldTurns: number) {
  const entries: any[] = []
  const push = (type: string, data: any) => entries.push({ seq: entries.length, type, data })
  for (let turn = 1; turn <= oldTurns; turn++) {
    push('turn/start', { turn })
    push('user/message', { source: { kind: 'user', rpcId: `old-${turn}` }, content: [{ type: 'text', text: 'old' }] })
    for (let step = 1; step <= 10; step++) { push('step/start', { turn, step }); push('step/end', { turn, step }) }
    push('turn/end', { turn, reason: { kind: 'completed' } })
  }
  const start = entries.length, turn = oldTurns + 1
  push('turn/start', { turn })
  push('user/message', { source: { kind: 'user', rpcId: 'current-receipt' }, content: [{ type: 'text', text }] })
  for (let step = 1; step <= 400; step++) { push('step/start', { turn, step }); push('step/end', { turn, step }) }
  return { entries, start, turn }
}

test('23000+ and 230000+ event histories bind native approvals and reconnect questions within the same source range', async () => {
  const costs: number[] = []
  for (const oldTurns of [1000, 10000]) {
    const { entries, start, turn } = history(oldTurns), reads: number[] = []
    const log = new Proxy(entries, { get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads.push(Number(key))
      return Reflect.get(target, key, receiver)
    } })
    const adapter = createDshSessionAdapter({ sessions: {}, events: {} }, { readLog: async () => log })
    const qid = randomUUID(), watermark = entries.length - 1
    const tracker = createNativeQuestionSnapshots({ readSourceAsOf: async (sessionId: string, seq: number) => {
      assert.equal(sessionId, sid)
      return questionSourceAsOf(await adapter.questionHistoryAsOf(sessionId, seq), seq)
    } })
    const connection = tracker.beginConnection()
    tracker.observe({ payload: { type: 'session/subscribed', sessionId: sid, lastSeq: watermark } }, connection)
    tracker.observe({ rpcId: qid, payload: { type: 'question/requested', sessionId: sid,
      questions: [{ id: 'format', header: 'Format', question: 'Which format?', options: [{ label: 'Text' }] }] } }, connection)
    const question = (await tracker.list(sid))[0]
    assert.equal(question.sourceReady, true); assert.equal(question.turn, turn)
    assert.equal(question.sourceSeq, start + 1); assert.equal(question.messageHash, hash)
    assert.equal(tracker.pending(sid, qid)?.sourceReceiptId, 'current-receipt')
    assert.ok(reads.length < 2000); assert.ok(reads.filter(index => index < start).length < 30,
      'old entries are used only for binary seq positioning, never replayed')
    costs.push(reads.length)
    tracker.close()
    reads.length = 0
    const range = sourceRange(log, { turn, receiptId: 'current-receipt' })!
    assert.equal(range.start, start); assert.equal(range.events.length, 802)
    assert.equal(projectReplyEvidence(range.events, { receiptId: 'current-receipt', live: true }).status, 'waiting')
    assert.ok(reads.length < 900, 'approval lookup folds only the 802 current-turn events')
    assert.equal(projectReplyEvidence(range.events, { receiptId: 'old-1', live: true }).turn, null)
  }
  assert.ok(Math.abs(costs[1] - costs[0]) < 20, '10x more old history adds only binary positioning reads')
})

test('durable proof starts at the bound turn and cannot inherit synthetic inspection closers or a later turn', async () => {
  const { entries, start, turn } = history(1000), requests: number[] = []
  const durable = entries.slice()
  const next = entries.length
  // DSH inspection can synthesize a closer for recovery. readFrom returns
  // only physical events, so that closer must never prove completion.
  const inspected = [...entries, { seq: next, type: 'turn/end', data: { turn, reason: { kind: 'aborted' } } }]
  const persistence = {
    inspect: async () => ({ meta: { id: sid }, events: inspected }),
    readFrom: async (_sessionId: string, seq: number) => {
      requests.push(seq); return { meta: { id: sid }, events: durable.slice(seq) }
    },
  }
  const range = await durableSourceRange(persistence, sid, { turn })
  assert.deepEqual(requests, [start]); assert.equal(range.events.length, 802)
  assert.equal(projectReplyEvidence(range.events, { receiptId: 'current-receipt' }).status, 'unconfirmed')
  durable.push({ seq: next, type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
  inspected.push({ seq: next + 1, type: 'turn/start', data: { turn: turn + 1 } })
  const complete = await durableSourceRange(persistence, sid, { turn })
  assert.equal(complete.current, false)
  assert.equal(projectReplyEvidence(complete.events, { receiptId: 'current-receipt' }).status, 'completed')
})

test('legacy question RPC starts at its as-of watermark and never materializes earlier history', async () => {
  const { entries, start } = history(1000), requests: any[] = []
  const watermark = entries.length - 1
  const adapter = createDshSessionAdapter({ sessions: { history: async (args: any) => {
    requests.push(args)
    const before = args.beforeSeq ?? entries.length
    return { result: { ok: true, value: { events: entries.slice(Math.max(0, before - 200), before), hasMore: before > 200 } } }
  } }, events: {} })
  const source = await adapter.questionHistoryAsOf(sid, watermark)
  assert.equal(source[0].seq, start); assert.equal(source.at(-1).seq, watermark)
  assert.equal(questionSourceAsOf(source, watermark)?.messageHash, hash)
  assert.equal(requests.length, 5)
  assert.equal(requests[0].beforeSeq, watermark + 1)
  assert.ok(requests.every(args => args.beforeSeq > start - 200))
})

test('host source reads keep exact owner and turn binding while historical model resolution is unavailable', async () => {
  const paths: string[] = []
  const backend = createPersonalAccessBackend({ currentOrigin: () => 'http://127.0.0.1:12345',
    hostOwnerId: () => 'owner-a', ownerForSession: () => 'owner-a',
    listSessions: async () => ({ items: [{ sessionId: sid, agentPreset: 'personal-remote' }] }),
    resolveSession: async () => { throw new Error('old model was removed') },
    gateway: async (path: string) => { paths.push(path); return { current: true, events: [] } },
  })
  assert.deepEqual(await backend.readSourceEvents({ sessionId: sid, receiptId: 'receipt-a', turn: 1001, ownerId: 'owner-a' }),
    { current: true, events: [] })
  assert.deepEqual(paths, [`/sessions/${sid}/source?receiptId=receipt-a&turn=1001`])
  await assert.rejects(backend.readSourceEvents({ sessionId: sid, receiptId: 'receipt-a', turn: 1001, ownerId: 'other-owner' }))
  assert.equal(paths.length, 1)
})

test('native gateway source route returns only the bound turn metadata from a step-heavy long session', async () => {
  const { entries, turn } = history(1000)
  const client = { sessions: { list: async () => ({ result: { ok: true, value: { items: [
    { sessionId: sid, agentPreset: 'personal-remote' }, { sessionId: 'child', origin: 'subagent' }] } } }) },
    events: {}, workspace: {}, llm: {}, settings: {} }
  const gateway = createGatewayV1({ client, readLog: async () => entries })
  const server = createServer((req, res) => void gateway.handle(req, res))
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const base = `http://127.0.0.1:${(server.address() as any).port}/weftmate/api/v1/sessions`
  try {
    const response = await fetch(`${base}/${sid}/source?receiptId=current-receipt&turn=${turn}`)
    assert.equal(response.status, 200)
    const source = await response.json()
    assert.equal(source.current, true)
    assert.deepEqual(source.events.map((event: any) => event.type), ['turn.started', 'user.message'])
    assert.equal(source.events[1].data.receiptId, 'current-receipt')
    assert.equal(source.events[1].data.messageHash, hash)
    assert.equal((await fetch(`${base}/child/source?receiptId=current-receipt&turn=${turn}`)).status, 400)
    assert.equal((await fetch(`${base}/${sid}/source?receiptId=current-receipt&turn=-1`)).status, 400)
  } finally { gateway.close(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
