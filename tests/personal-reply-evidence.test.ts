import assert from 'node:assert/strict'
import test from 'node:test'
import { projectReplyEvidence } from '../src/personal-reply-evidence/index.mjs'
import { savedDocumentReplyHint } from '../src/plugins/weftmate-personal-reply-evidence.mjs'

const time = Date.parse('2026-10-04T00:00:00.000Z')
function events() {
  const saved = JSON.stringify({ taskId: `cmd-${'a'.repeat(8)}-${'a'.repeat(4)}-${'a'.repeat(4)}-${'a'.repeat(4)}-${'a'.repeat(12)}`,
    artifactId: 'artifact-123', size: 20, sha256: 'a'.repeat(64),
    state: 'observed', secret: 'synthetic-private-body' })
  return [
    { type: 'session', id: 'session-a', agentPreset: 'personal-remote' },
    { seq: 1, time, type: 'turn/start', data: { turn: 1 } },
    { seq: 2, time: time + 1, type: 'step/start', data: { turn: 1, step: 1 } },
    { seq: 3, time: time + 2, type: 'user/message', data: {
      source: { kind: 'user', rpcId: 'receipt-a' }, content: [{ type: 'text', text: 'synthetic' }] } },
    { seq: 4, time: time + 3, type: 'assistant/chunk', data: { turn: 1, step: 1,
      chunk: { type: 'reasoning-delta', text: 'private thought' } } },
    { seq: 5, time: time + 4, type: 'tool/call', data: { turn: 1, step: 1,
      callId: 'save-1', name: 'personal_save_document' } },
    { seq: 6, time: time + 5, type: 'tool/result', data: { turn: 1,
      message: { source: { kind: 'tool', callId: 'save-1' }, content: [{ type: 'tool-result',
        toolCallId: 'save-1', content: [{ type: 'text', text: saved }] }] } } },
    { seq: 7, time: time + 6, type: 'step/end', data: { turn: 1, step: 1 } },
    { seq: 8, time: time + 7, type: 'step/start', data: { turn: 1, step: 2 } },
    { seq: 9, time: time + 8, type: 'assistant/chunk', data: { turn: 1, step: 2,
      chunk: { type: 'text-delta', text: 'private final reply' } } },
    { seq: 10, time: time + 9, type: 'assistant/message', data: { turn: 1, step: 2,
      message: { content: [{ type: 'text', text: 'private final reply' }] } } },
    { seq: 11, time: time + 10, type: 'step/end', data: { turn: 1, step: 2 } },
    { seq: 12, time: time + 11, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
}
const encoded = (rows: object[]) => `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`

test('only a matching physical native turn/end proves completed after observed save', () => {
  const rows = events()
  const complete = projectReplyEvidence(encoded(rows), { receiptId: 'receipt-a' })
  assert.equal(complete.status, 'completed')
  assert.equal(complete.turn, 1)
  assert.equal(complete.step, 2)
  assert.equal(complete.toolSaveObserved, true)
  assert.equal(complete.textChunks, 1)
  assert.equal(complete.reasoningChunks, 1)
  assert.equal(complete.terminalAt, '2026-10-04T00:00:00.011Z')
  assert.equal(JSON.stringify(complete).includes('private'), false)
  assert.equal(projectReplyEvidence(encoded(rows), { receiptId: 'receipt-b' }).status, 'unconfirmed')
  const mixed = structuredClone(rows)
  mixed.splice(4, 0, { seq: 4, time: time + 3, type: 'user/message',
    data: { source: { kind: 'user', rpcId: 'receipt-b' } } })
  for (let index = 5; index < mixed.length; index++) if (mixed[index].seq) mixed[index].seq++
  assert.equal(projectReplyEvidence(encoded(mixed), { receiptId: 'receipt-a' }).status, 'unconfirmed')
})

test('open turn needs current live proof for waiting or streaming; restart stays unconfirmed', () => {
  const open = events().slice(0, -1)
  assert.equal(projectReplyEvidence(encoded(open), { receiptId: 'receipt-a', live: false }).status,
    'unconfirmed')
  assert.equal(projectReplyEvidence(encoded(open), { receiptId: 'receipt-a', live: true }).status,
    'streaming')
  const waiting = open.filter((event: any) => event.type !== 'assistant/chunk')
  assert.equal(projectReplyEvidence(encoded(waiting), { receiptId: 'receipt-a', live: true }).status,
    'waiting')
  const aborted = events()
  ;(aborted.at(-1) as any).data.reason.kind = 'aborted'
  assert.equal(projectReplyEvidence(encoded(aborted), { receiptId: 'receipt-a', live: true }).status,
    'aborted')
})

test('known output limits keep each old root terminal even after a later turn starts', () => {
  const rows = [
    { seq: 6999, time, type: 'turn/start', data: { turn: 2 } },
    { seq: 7000, time: time + 1, type: 'user/message',
      data: { source: { kind: 'user', rpcId: 'receipt-turn2' } } },
    { seq: 7009, time: time + 2, type: 'turn/end',
      data: { turn: 2, reason: { kind: 'max-tokens' } } },
    { seq: 7010, time: time + 3, type: 'turn/start', data: { turn: 3 } },
    { seq: 7011, time: time + 4, type: 'user/message',
      data: { source: { kind: 'user', rpcId: 'receipt-turn3' } } },
    { seq: 7012, time: time + 5, type: 'assistant/message',
      data: { turn: 3, message: { content: [] } } },
    { seq: 7019, time: time + 6, type: 'turn/end',
      data: { turn: 3, reason: { kind: 'max-tokens' } } },
  ]
  for (const [turn, receiptId, endedOffset] of [[2, 'receipt-turn2', 2], [3, 'receipt-turn3', 6]] as const) {
    const evidence = projectReplyEvidence(encoded(rows), { receiptId, live: true })
    assert.equal(evidence.status, 'failed')
    assert.equal(evidence.endReasonKind, 'max-tokens')
    assert.equal(evidence.turn, turn)
    assert.equal(evidence.terminalAt, new Date(time + endedOffset).toISOString())
    assert.equal(evidence.toolSaveObserved, false)
  }
})

test('limited end preserves observed saves and leaves old or genuinely unknown reasons unchanged', () => {
  const rows = events()
  ;(rows.at(-1) as any).data.reason.kind = 'max-tokens'
  const limited = projectReplyEvidence(encoded(rows), { receiptId: 'receipt-a' })
  assert.equal(limited.status, 'failed')
  assert.equal(limited.endReasonKind, 'max-tokens')
  assert.equal(limited.toolSaveObserved, true)
  for (const reason of ['completed', 'aborted', 'blocked', 'failed']) {
    ;(rows.at(-1) as any).data.reason.kind = reason
    const legacy = projectReplyEvidence(encoded(rows), { receiptId: 'receipt-a' })
    assert.equal(legacy.status, reason)
    assert.equal(legacy.endReasonKind, undefined)
  }
  for (const reason of ['vendor-limit', 'max-tokens-unknown']) {
    ;(rows.at(-1) as any).data.reason.kind = reason
    const unknown = projectReplyEvidence(encoded(rows), { receiptId: 'receipt-a', live: true })
    assert.equal(unknown.status, 'unconfirmed')
    assert.equal(unknown.endReasonKind, undefined)
    assert.ok(unknown.terminalAt)
  }
})

test('a late receipt and duplicate or conflicting native ends cannot inherit completed', () => {
  const late = events().filter((row: any) => row.seq !== 3)
  late.push({ seq: 13, time: time + 12, type: 'user/message', data: {
    source: { kind: 'user', rpcId: 'receipt-late' } } })
  assert.equal(projectReplyEvidence(encoded(late), { receiptId: 'receipt-late', live: false }).status,
    'unconfirmed', 'a persisted completed turn does not complete a later receipt after restart')
  assert.equal(projectReplyEvidence(encoded(late), { receiptId: 'receipt-late', live: true }).status,
    'unconfirmed')
  const duplicate = events()
  duplicate.push({ seq: 13, time: time + 12, type: 'turn/end',
    data: { turn: 1, reason: { kind: 'completed' } } })
  assert.equal(projectReplyEvidence(encoded(duplicate), { receiptId: 'receipt-a' }).status,
    'unconfirmed')
  const conflicting = events()
  conflicting.push({ seq: 13, time: time + 12, type: 'turn/end',
    data: { turn: 2, reason: { kind: 'blocked' } } })
  assert.equal(projectReplyEvidence(encoded(conflicting), { receiptId: 'receipt-a', live: true }).status,
    'unconfirmed')
  assert.equal(projectReplyEvidence(encoded(events()), { receiptId: 'receipt-a' }).status,
    'completed', 'one matching terminal still proves the normal case')
})

test('after a physically observed save, the next step gets one fixed plugin reminder', async () => {
  const rows = events().slice(0, 8)
  const session = { id: 'session-a', header: { agentPreset: 'personal-remote' }, events: rows.slice(1) }
  const persisted = { meta: { id: session.id, agentPreset: 'personal-remote' }, events: rows.slice(1) }
  const ctx = { sessionPersistence: { inspect: async () => persisted, readFrom: async () => persisted } }
  const payload = { agent: { session }, turn: 1, step: 2, signal: new AbortController().signal }
  const decision = { kind: 'enter', messages: [{ source: { kind: 'user' }, content: [] }] }
  const factory = (value: object) => value
  const next = await savedDocumentReplyHint(ctx, payload, decision, factory)
  assert.equal(next.messages.length, 2)
  assert.equal(next.messages[1].source.kind, 'plugin')
  assert.match(next.messages[1].content[0].text, /继续完成用户尚未完成的要求/)
  assert.equal(JSON.stringify(next).includes('synthetic-private-body'), false)
  session.events.push({ type: 'user/message', data: { source: next.messages[1].source } })
  assert.equal((await savedDocumentReplyHint(ctx, payload, decision, factory)).messages.length, 1,
    'a later step does not inject the same reminder again')
  const other = { ...payload, agent: { session: { ...session,
    header: { agentPreset: 'personal-shared-chat' } } } }
  assert.equal((await savedDocumentReplyHint(ctx, other, decision, factory)).messages.length, 1)
})

test('a pending or failed save cannot produce a completion reminder', async () => {
  const base = events().slice(0, 8)
  const session = { id: 'session-a', header: { agentPreset: 'personal-remote' }, events: base.slice(1) }
  const decision = { kind: 'enter', messages: [{ source: { kind: 'user' }, content: [] }] }
  const payload = { agent: { session }, turn: 1, step: 2, signal: new AbortController().signal }
  for (const rows of [base.filter((row: any) => row.type !== 'tool/result'),
    base.map((row: any) => row.type === 'tool/result' ? {
      ...row, data: { ...row.data, error: { code: 'SAVE_FAILED' } },
    } : row)]) {
    const persisted = { meta: { id: session.id, agentPreset: 'personal-remote' }, events: rows.slice(1) }
    const ctx = { sessionPersistence: { inspect: async () => persisted, readFrom: async () => persisted } }
    assert.equal((await savedDocumentReplyHint(ctx, payload, decision, (value: object) => value)).messages.length, 1)
    assert.equal(projectReplyEvidence(encoded(rows), { receiptId: 'receipt-a' }).toolSaveObserved, false)
  }
})
