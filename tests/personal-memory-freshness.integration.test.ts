import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createPersonalMemoryManager } from '../src/personal-memory/index.mjs'
import { boundaryForCompletedTurn } from '../src/plugins/weftmate-personal-memory.mjs'

const python = process.env.WEFTMATE_TEST_MEMOWEFT_PYTHON
const pythonPath = process.env.WEFTMATE_TEST_MEMOWEFT_SOURCE
const owner = 'owner-00000000-0000-4000-8000-000000000001'
const other = 'owner-00000000-0000-4000-8000-000000000002'
const skip = !python || !pythonPath ? 'The pinned Core integration job supplies Python and source' : false

test('default immediate new-session recall bridges only accepted permitted quotes, then formal memory replaces them', { skip }, async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'mf1-default-')))
  let finish!: () => void
  const gate = new Promise<void>(resolve => { finish = resolve })
  const text = '以后请叫我小禾。'
  const server = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk
    const e = JSON.parse(JSON.parse(body).messages.at(-1).content).evidence[0]
    await gate
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ schema_version: 8,
      result: 'cognitions', cognitions: [{ action: 'form', target: 'owner_self', statement_kind: 'naming',
        formed_by: 'stated', proposition: e.text, entity: { canonical_name: '小禾', kind: 'person' },
        supports: [{ evidence_id: e.id, sentence_id: 't0' }] }] }) }, finish_reason: 'stop' }] }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${(server.address() as any).port}/v1`
  const manager = createPersonalMemoryManager({ root, enabled: true, python, pythonPath, baseUrl,
    model: '@current', credential: () => 'synthetic', processingRoute: () => ({ profileId: 'fake', baseUrl,
      model: 'fake', credential: 'synthetic', routeFingerprint: null, modelTier: 'cloud' }) })
  const recall = (account = owner, query = '怎么称呼我？', modelTier = 'cloud') => manager.recall(account,
    { query, sessionId: 'brand-new-session', modelTier })
  try {
    const events = [{ seq: 1, type: 'turn/start', data: { turn: 1 } },
      { seq: 2, type: 'user/message', data: { id: 'mf1-user', source: { kind: 'user' }, content: [{ type: 'text', text }] } },
      { seq: 3, type: 'assistant/message', data: { message: { id: 'mf1-assistant', content: [{ type: 'text', text: '收到' }] } } },
      { seq: 4, type: 'turn/end', data: { turn: 1, reason: { kind: 'stop' } } }]
    await manager.ingest(owner, boundaryForCompletedTurn({ id: 'source-session', header: { agentPreset: 'personal-shared-chat' }, events }, events.at(-1)))
    const began = performance.now(), immediate = await recall()
    assert.ok(performance.now() - began < 1500, 'formation is deliberately held; default recall must not wait for it')
    assert.match(immediate.contextText, /近期原话，尚未整理/)
    assert.match(immediate.contextText, /以后请叫我小禾/)
    assert.equal(immediate.memories.length, 0, 'raw evidence must not masquerade as a formal cognition')
    assert.equal(immediate.recentEvidence.length, 1)
    assert.doesNotMatch((await recall(other)).contextText, /小禾/)
    const evidenceId = immediate.recentEvidence[0].id
    const command = async (operation: string, payload = {}) => manager.submit(owner, { schema_version: 1,
      command_id: `mf1-${operation}`, subject_id: owner, actor: 'owner', expected_world_revision: (await recall()).worldRevision,
      operation, target_kind: 'evidence', target_id: evidenceId, payload, submitted_at: new Date().toISOString() })
    const denied = await command('update_evidence_permissions', { allow_cloud_read: false })
    assert.equal(denied.receipt?.result_state ?? denied.result_state, 'applied')
    assert.doesNotMatch((await recall()).contextText, /小禾/)
    assert.match((await recall(owner, '怎么称呼我？', 'local')).contextText, /小禾/)
    // Restore through another durable command; no fixture writes to Core storage.
    await manager.submit(owner, { schema_version: 1, command_id: 'mf1-restore', subject_id: owner, actor: 'owner',
      expected_world_revision: (await recall()).worldRevision, operation: 'update_evidence_permissions', target_kind: 'evidence',
      target_id: evidenceId, payload: { allow_cloud_read: true }, submitted_at: new Date().toISOString() })
    finish()
    const deadline = Date.now() + 10000
    let formed: any
    do { formed = await recall(); if (formed.memories.length) break; await new Promise(resolve => setTimeout(resolve, 50)) } while (Date.now() < deadline)
    assert.ok(formed.memories.length)
    assert.match(formed.contextText, /小禾/)
    assert.doesNotMatch(formed.contextText, /近期原话/)
    assert.equal(formed.recentEvidence, undefined)
    const deleted = await command('delete_evidence')
    assert.equal(deleted.receipt?.result_state ?? deleted.result_state, 'applied')
    assert.doesNotMatch((await recall()).contextText, /小禾/)
    assert.doesNotMatch(JSON.stringify(await manager.query(owner, 'portable_export', {})), /小禾/)
  } finally { finish(); await manager.close(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }) }
})

test('elliptical numeric corrections are paired immediately; ambiguous topics and forgetting keep their boundaries', { skip }, async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'mf2-correction-')))
  let finish!: () => void
  const gate = new Promise<void>(resolve => { finish = resolve })
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* Drain a held formation request. */ }
    await gate
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: '{"schema_version":8,"result":"no_change"}' } }] }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${(server.address() as any).port}/v1`
  const manager = createPersonalMemoryManager({ root, enabled: true, python, pythonPath, baseUrl,
    model: '@current', credential: () => 'synthetic', processingRoute: () => ({ profileId: 'fake', baseUrl,
      model: 'fake', credential: 'synthetic', routeFingerprint: null, modelTier: 'cloud' }) })
  const accept = async (account: string, session: string, text: string) => {
    const events = [{ seq: 1, type: 'turn/start', data: { turn: 1 } },
      { seq: 2, type: 'user/message', data: { id: `${session}-user`, source: { kind: 'user' }, content: [{ type: 'text', text }] } },
      { seq: 3, type: 'assistant/message', data: { message: { id: `${session}-assistant`, content: [{ type: 'text', text: '收到' }] } } },
      { seq: 4, type: 'turn/end', data: { turn: 1, reason: { kind: 'stop' } } }]
    await manager.ingest(account, boundaryForCompletedTurn({ id: session, header: { agentPreset: 'personal-shared-chat' }, events }, events.at(-1)))
  }
  const recall = (account = owner) => manager.recall(account, { query: '今天给阳台盆栽浇水，该量多少？', sessionId: 'third', modelTier: 'cloud' })
  try {
    await accept(owner, 'water', '我养的阳台盆栽每次浇水用300毫升，这是我现在固定的用量。')
    await accept(owner, 'correction', '前面那个数报大了，应当是150毫升，300毫升作废，后面都以小的这个数为准。')
    const paired = await recall()
    assert.match(paired.contextText, /较早（已被随后原话纠正/)
    assert.match(paired.contextText, /随后纠正（优先于较早原话与正式记忆）：前面那个数报大了/)
    assert.equal(paired.recentEvidence.length, 1)
    assert.ok(paired.recentEvidence[0].precedingEvidenceId)
    assert.equal(paired.memories.length, 0)
    assert.ok(paired.contextText.length <= 1200)
    assert.doesNotMatch((await recall(other)).contextText, /150|300/)
    await accept(other, 'other-water', '阳台盆栽每次浇水300毫升。')
    await accept(other, 'other-cake', '我做蛋糕每次用牛奶300毫升。')
    await accept(other, 'other-correction', '前面那个数报大了，150毫升才对，300毫升作废。')
    const ambiguous = await recall(other)
    assert.match(ambiguous.contextText, /可能的纠正，待确认/)
    assert.match(ambiguous.contextText, /牛奶300毫升/)
    assert.match(ambiguous.contextText, /阳台盆栽每次浇水300毫升/)
    assert.doesNotMatch(ambiguous.contextText, /已被随后原话纠正/)
    for (const [i, id] of [paired.recentEvidence[0].id, paired.recentEvidence[0].precedingEvidenceId].entries()) {
      const revision = (await recall()).worldRevision
      const receipt = await manager.submit(owner, { schema_version: 1, command_id: `mf2-forget-${i}`, subject_id: owner,
        actor: 'owner', expected_world_revision: revision, operation: 'delete_evidence', target_kind: 'evidence',
        target_id: id, payload: {}, submitted_at: new Date().toISOString() })
      assert.equal(receipt.receipt?.result_state ?? receipt.result_state, 'applied')
    }
    assert.doesNotMatch((await recall()).contextText, /阳台盆栽|150|300/)
    assert.doesNotMatch(JSON.stringify(await manager.query(owner, 'portable_export', {})), /阳台盆栽|150毫升|300毫升/)
  } finally { finish(); await manager.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }) }
})
