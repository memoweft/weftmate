import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import test from 'node:test'
import { createNativeQuestionSnapshots, questionSourceAsOf } from '../src/runtime/dsh-adapter/agents.mjs'
import { createDshSessionAdapter } from '../src/runtime/dsh-adapter/sessions.mjs'
import { createGatewayV1 } from '../src/runtime/gateway/routes/v1.mjs'

const sid = 'session-question-native'
const qs = [{ id: 'mode', question: 'Which output?', header: 'Output', options: [
  { label: 'Summary', description: 'A short report' }, { label: 'Details' }], multiSelect: false }]
const messageHash = (text: string) => createHash('sha256').update(text).digest('hex')
const event = (seq: number, type: string, data: object) => ({ seq, type, data, time: 1790000000000 + seq })
const raw = (value: any) => ({ payload: { type: 'session/event', sessionId: sid, event: value } })
const sourceA = [event(0, 'turn/start', { turn: 1 }), event(1, 'user/message', {
  id: 'message-a', source: { kind: 'user', rpcId: 'receipt-a' }, content: [{ type: 'text', text: 'same goal' }] }),
  event(2, 'tool/call', { turn: 1, callId: 'call-a', name: 'ask_user_question' })]
const sourceB = [event(3, 'turn/end', { turn: 1 }), event(4, 'turn/start', { turn: 2 }),
  event(5, 'user/message', { id: 'message-b', source: { kind: 'user', rpcId: 'receipt-b' },
    content: [{ type: 'text', text: 'same goal' }] })]
const asked = (questionRpcId: string) => ({ rpcId: questionRpcId, payload: { type: 'question/requested', sessionId: sid, questions: qs } })
const resolved = (questionRpcId: string, outcome = 'answered') => ({ payload: { type: 'question/resolved', sessionId: sid, questionRpcId, outcome } })
const deferred = () => {
  let resolve!: (value: any) => void
  const promise = new Promise<any>(done => { resolve = done })
  return { promise, resolve }
}
async function tick() { await new Promise(done => setImmediate(done)) }

test('question source is the unique actual user as-of its watermark, never the later turn or a latest tool call', () => {
  assert.deepEqual(questionSourceAsOf([...sourceA, ...sourceB], 2), {
    turn: 1, sourceReceiptId: 'receipt-a', sourceSeq: 1, observedSeq: 2, messageHash: messageHash('same goal') })
  assert.equal(questionSourceAsOf([sourceA[0], sourceA[1], event(2, 'user/message', {
    source: { kind: 'user', rpcId: 'receipt-b' }, content: [{ type: 'text', text: 'same goal' }] })], 2), null)
  assert.equal(questionSourceAsOf(sourceA.slice(1), 2), null)
  assert.equal(questionSourceAsOf([...sourceA, event(2, 'tool/call', { turn: 9 })], 2), null)
})

test('live question snapshots keep batch identity and source while reconnecting and reject native terminal resurrection', async () => {
  const qid = randomUUID(), reads: any[] = []
  const tracker = createNativeQuestionSnapshots({ readSourceAsOf: async (sessionId: string, seq: number) => {
    reads.push({ sessionId, seq }); return questionSourceAsOf(sourceA, seq) } })
  let connection = tracker.beginConnection()
  tracker.observe({ payload: { type: 'session/subscribed', sessionId: sid, lastSeq: -1 } }, connection)
  for (const value of sourceA) tracker.observe(raw(value), connection)
  tracker.observe(asked(qid), connection)
  const first = (await tracker.list(sid))[0]
  assert.equal(first.sourceReady, true); assert.equal(first.sourceReceiptId, 'receipt-a')
  assert.equal(first.questionRpcId, qid); assert.deepEqual(first.questions, qs); assert.equal(reads.length, 0)
  tracker.connectionLost(connection); assert.deepEqual(await tracker.list(sid), [])
  connection = tracker.beginConnection()
  tracker.observe({ payload: { type: 'session/subscribed', sessionId: sid, lastSeq: 2 } }, connection)
  tracker.observe(asked(qid), connection)
  assert.deepEqual((await tracker.list(sid))[0], first)
  assert.equal(reads[0].seq, 2)
  tracker.observe(resolved(qid), connection)
  tracker.observe(asked(qid), connection)
  assert.equal((await tracker.list(sid))[0].nativeState, 'answered')
  assert.equal(tracker.pending(sid, qid), null)
  tracker.close()
})

test('native terminal frames seal synchronously while original as-of source is still being read', async () => {
  const pending = deferred(), qid = randomUUID()
  const tracker = createNativeQuestionSnapshots({ readSourceAsOf: (_session: string, seq: number) => {
    assert.equal(seq, 2); return pending.promise } })
  const connection = tracker.beginConnection()
  tracker.observe({ payload: { type: 'session/subscribed', sessionId: sid, lastSeq: 2 } }, connection)
  tracker.observe(asked(qid), connection); tracker.observe(resolved(qid, 'cancelled'), connection)
  tracker.observe(asked(qid), connection)
  for (const value of sourceB) tracker.observe(raw(value), connection)
  pending.resolve(questionSourceAsOf([...sourceA, ...sourceB], 2))
  const snapshot = (await tracker.list(sid))[0]
  assert.equal(snapshot.nativeState, 'cancelled'); assert.equal(snapshot.sourceReceiptId, 'receipt-a')
  assert.equal(snapshot.turn, 1); assert.equal(snapshot.sourceReady, true)
  assert.equal(tracker.pending(sid, qid), null); tracker.close()
})

test('subscribed context seeding folds following source deltas and gaps; an unknown boundary cannot excuse them', async () => {
  for (const kind of ['source-delta-during-seed', 'source-delta-after-seed', 'gap-after-seed', 'new-turn-during-seed']) {
    const pending = deferred(), qid = randomUUID()
    const tracker = createNativeQuestionSnapshots({ readSourceAsOf: () => pending.promise })
    const connection = tracker.beginConnection()
    tracker.observe({ payload: { type: 'session/subscribed', sessionId: sid, lastSeq: 2 } }, connection)
    tracker.observe(asked(qid), connection)
    if (kind.includes('after-seed')) {
      pending.resolve(questionSourceAsOf(sourceA, 2)); assert.equal((await tracker.list(sid))[0].sourceReady, true)
    }
    if (kind.includes('source-delta')) tracker.observe(raw(event(3, 'user/message', {
      source: { kind: 'user', rpcId: 'receipt-b' }, content: [{ type: 'text', text: 'same goal' }] })), connection)
    if (kind === 'gap-after-seed') tracker.observe(raw(event(4, 'tool/call', { turn: 1, callId: 'new-call', name: 'read' })), connection)
    if (kind === 'new-turn-during-seed') for (const value of sourceB) tracker.observe(raw(value), connection)
    pending.resolve(questionSourceAsOf([...sourceA, ...sourceB], 2))
    const snapshot = (await tracker.list(sid))[0]
    assert.equal(snapshot.sourceReceiptId, 'receipt-a'); assert.equal(snapshot.turn, 1)
    assert.equal(snapshot.sourceReady, false, kind); assert.equal(tracker.pending(sid, qid), null, kind)
    tracker.close()
  }
})

test('native pending before any real source baseline stays unconfirmed without being marked terminal', async () => {
  const tracker = createNativeQuestionSnapshots({ readSourceAsOf: async () => { throw new Error('must not guess') } })
  const qid = randomUUID(); const connection = tracker.beginConnection()
  tracker.observe(asked(qid), connection)
  const snapshot = (await tracker.list(sid))[0]
  assert.equal(snapshot.sourceReady, false); assert.equal(snapshot.nativeState, 'pending')
  tracker.observe(resolved(qid), connection); assert.equal((await tracker.list(sid))[0].nativeState, 'answered')
  tracker.close()
})

test('cold reconnect with source B already in the subscribed watermark cannot consume cached question source A', async () => {
  const tracker = createNativeQuestionSnapshots({ readSourceAsOf: async (_sid: string, seq: number) =>
    questionSourceAsOf([...sourceA, ...sourceB], seq) })
  const qid = randomUUID(); let connection = tracker.beginConnection()
  for (const value of sourceA) tracker.observe(raw(value), connection)
  tracker.observe(asked(qid), connection); assert.equal((await tracker.list(sid))[0].sourceReady, true)
  tracker.connectionLost(connection); connection = tracker.beginConnection()
  tracker.observe({ payload: { type: 'session/subscribed', sessionId: sid, lastSeq: 5 } }, connection)
  tracker.observe(asked(qid), connection)
  const replay = (await tracker.list(sid))[0]
  assert.equal(replay.sourceReceiptId, 'receipt-a'); assert.equal(replay.observedSeq, 2)
  assert.equal(replay.sourceReady, false); assert.equal(tracker.pending(sid, qid), null)
  tracker.close()
})

test('native source reader cuts the immutable log at the original observed seq and direct question receipts stay unchanged', async () => {
  const historyCalls: any[] = [], answers: any[] = []
  let receipt: any = { accepted: true }
  const adapter = createDshSessionAdapter({
    sessions: { history: async (args: any) => {
      historyCalls.push(args)
      return { result: { ok: true, value: { events: [...sourceA, ...sourceB].map(event => ({ event })), hasMore: false } } }
    } },
    events: {}, respond: async (value: any) => { answers.push(value); return receipt },
  }, { readLog: async (sessionId: string) => { assert.equal(sessionId, sid); return [...sourceA, ...sourceB] } })
  const source = questionSourceAsOf(await adapter.questionHistoryAsOf(sid, 2), 2)
  assert.equal(source?.sourceReceiptId, 'receipt-a'); assert.deepEqual(historyCalls, [])
  const qid = randomUUID(), answer = { answers: [{ id: 'mode', selected: ['Summary'] }] }
  assert.deepEqual(await adapter.respondUserQuestion({ sessionId: sid, questionRpcId: qid, answer }), { accepted: true })
  assert.deepEqual(answers[0], { type: 'client-response', rpcId: qid, result: { ok: true, value: { sessionId: sid, answer } } })
  receipt = { accepted: false, reason: 'not-pending' }
  assert.deepEqual(await adapter.respondUserQuestion({ sessionId: sid, questionRpcId: qid, answer }), receipt)
  receipt = { result: { ok: true, value: { accepted: true } } }
  await assert.rejects(adapter.respondUserQuestion({ sessionId: sid, questionRpcId: qid, answer }))
})

test('Gateway forwards only personal-remote live batch answers through the original provider', async () => {
  const queued: any[] = [], waiters: any[] = [], answered: any[] = [], qid = randomUUID()
  const push = (frame: any) => { const next = waiters.shift(); next ? next(frame) : queued.push(frame) }
  const client: any = { sessions: {
    list: async () => ({ result: { ok: true, value: { items: [
      { sessionId: sid, agentPreset: 'personal-remote', running: true },
      { sessionId: 'shared', agentPreset: 'personal-shared-chat', running: true }] } } }),
    history: async () => ({ result: { ok: true, value: { events: sourceA.map(event => ({ event })), hasMore: false } } }),
  }, events: { mux: async function* (_args: any, signal: AbortSignal) {
    push({ payload: { type: 'session/subscribed', sessionId: sid, lastSeq: 2 } }); push(asked(qid))
    while (!signal.aborted) {
      const frame = queued.length ? queued.shift() : await new Promise(resolve => {
        const next = (value: any) => { signal.removeEventListener('abort', abort); resolve(value) }
        const abort = () => { const index = waiters.indexOf(next); if (index >= 0) waiters.splice(index, 1); resolve(null) }
        waiters.push(next); signal.addEventListener('abort', abort, { once: true })
      })
      if (frame) yield frame
    }
  } }, respond: async (body: any) => { answered.push(body); push(resolved(qid)); return { accepted: true } } }
  client.workspace = {}; client.llm = {}; client.settings = {}
  const gateway = createGatewayV1({ client })
  const server = createServer((req, res) => void gateway.handle(req, res))
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const base = 'http://127.0.0.1:' + (server.address() as any).port + '/weftmate/api/v1'
  try {
    let snapshots: any[] = []
    for (let i = 0; i < 20 && !snapshots.length; i++) {
      const response = await fetch(base + '/sessions/' + sid + '/questions')
      assert.equal(response.status, 200); snapshots = (await response.json()).questions
      await tick()
    }
    assert.equal(snapshots[0].questionRpcId, qid); assert.equal(snapshots[0].sourceReady, true)
    const answer = { answers: [{ id: 'mode', selected: ['Summary'] }] }
    const response = await fetch(base + '/sessions/' + sid + '/questions/' + qid, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answer }) })
    assert.deepEqual(await response.json(), { accepted: true }); assert.equal(answered.length, 1)
    assert.equal((await fetch(base + '/sessions/shared/questions')).status, 404)
    assert.equal((await fetch(base + '/sessions/shared/questions/' + qid, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answer }) })).status, 404)
    const late = await fetch(base + '/sessions/' + sid + '/questions/' + qid, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answer }) })
    assert.deepEqual(await late.json(), { accepted: false, reason: 'not-pending' }); assert.equal(answered.length, 1)
  } finally { gateway.close(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
