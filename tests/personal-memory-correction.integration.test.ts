import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createPersonalMemoryManager } from '../src/personal-memory/index.mjs'
import { boundaryForCompletedTurn } from '../src/plugins/weftmate-personal-memory.mjs'
import { assertOwnerBoundBoundary } from '../src/personal-memory/boundary.mjs'

const python = process.env.WEFTMATE_TEST_MEMOWEFT_PYTHON
const pythonPath = process.env.WEFTMATE_TEST_MEMOWEFT_SOURCE
const owner = 'owner-00000000-0000-4000-8000-000000000001'
const skip = !python || !pythonPath ? 'CI runs this test with the pinned MemoWeft Core' : false

function boundary(text: string, sessionId: string) {
  const events = [
    { seq: 1, type: 'turn/start', data: { turn: 1 } },
    { seq: 2, type: 'user/message', data: { id: `${sessionId}-user`, source: { kind: 'user' },
      content: [{ type: 'text', text }] } },
    { seq: 3, type: 'assistant/message', data: { message: { id: `${sessionId}-assistant`,
      content: [{ type: 'text', text: '收到' }] } } },
    { seq: 4, type: 'turn/end', data: { turn: 1, reason: { kind: 'stop' } } },
  ]
  return assertOwnerBoundBoundary(sessionId, boundaryForCompletedTurn({ id: sessionId,
    header: { agentPreset: 'personal-shared-chat' }, events }, events.at(-1)))
}

// Script only the model interpretation. Real Core owns Evidence, compilation,
// atomic transitions, currentness, provenance and recall; no database seeding.
for (const scenario of [
  { name: 'explicit correction', old: '我最近只能周三晚上锻炼，安排运动时帮我记着。',
    correction: '不对，是周五晚上。', query: '下周给我安排一次锻炼，放在哪天比较合适？',
    action: 'correct', field: 'corrects_cognition_id', replacement: '周五', obsolete: '周三' },
  { name: 'changed preference', old: '我每天喝咖啡。',
    correction: '我其实不喝咖啡了，现在只喝茶。', query: '现在喝咖啡还是喝茶？',
    action: 'form', field: 'supersedes_cognition_id', replacement: '只喝茶', obsolete: '每天喝咖啡' },
  { name: 'negated coffee correction', old: '我喜欢喝咖啡。',
    correction: '刚才说错了，我其实不喝咖啡。', query: '我喝咖啡吗？',
    action: 'correct', field: 'corrects_cognition_id', replacement: '不喝咖啡', obsolete: '喜欢喝咖啡' },
]) {
  test(`natural memory ${scenario.name}: source retention, new-session recall and restart`, { skip }, async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'm2d-correction-')))
    const requests: any[] = []
    const errors: unknown[] = []
    const server = createServer(async (req, res) => {
      try {
        let body = ''
        for await (const chunk of req) body += chunk
        const request = JSON.parse(body)
        const payload = JSON.parse(request.messages.at(-1).content)
        requests.push(payload)
        const evidence = payload.evidence[0]
        const correcting = evidence.text === scenario.correction
        assert.equal(evidence.text, correcting ? scenario.correction : scenario.old)
        if (correcting) {
          assert.equal(payload.current_cognitions.length, 1)
          assert.match(payload.current_cognitions[0].content, new RegExp(scenario.obsolete))
        }
        const item = { action: correcting ? scenario.action : 'form', target: 'owner_self',
          statement_kind: 'preference', formed_by: 'stated', proposition: evidence.text,
          supports: evidence.segments.map((segment: any) => ({ evidence_id: evidence.id, segment_id: segment.id })),
          ...(correcting ? { [scenario.field]: payload.current_cognitions[0].id } : {}) }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ schema_version: 8,
          result: 'cognitions', cognitions: [item] }) }, finish_reason: 'stop' }],
          model: 'synthetic-interpretation', usage: { total_tokens: 0 } }))
      } catch (error) { errors.push(error); res.writeHead(500); res.end('{}') }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    const create = () => createPersonalMemoryManager({ root, enabled: true, python, pythonPath,
      baseUrl: 'http://127.0.0.1:8081/v1', model: '@current', credential: () => 'synthetic-key',
      processingRoute: () => ({ profileId: 'synthetic-interpretation',
        baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'synthetic-interpretation',
        credential: 'synthetic-key', routeFingerprint: null, modelTier: 'cloud' }) })
    let manager = create()
    const world = () => manager.query(owner, 'query_world', {
      operation: 'list', object_kind: 'cognition', include_history: true })
    const sources = (id: string) => manager.query(owner, 'query_provenance', {
      object_kind: 'cognition', item_id: id, projection: 'history' })
    try {
      assert.equal((await manager.ingest(owner, boundary(scenario.old, 'session-old'))).state, 'accepted')
      const before = await manager.recall(owner, { query: scenario.query, sessionId: 'session-before' })
      assert.deepEqual(errors, [])
      assert.match(before.contextText, new RegExp(scenario.obsolete))
      const prior = (await world()).items[0]
      assert.equal((await manager.ingest(owner, boundary(scenario.correction, 'session-correction'))).state, 'accepted')
      const after = await manager.recall(owner, { query: scenario.query, sessionId: 'session-after' })
      assert.deepEqual(errors, [])
      assert.equal(requests.length, 2, 'recall makes no generation calls')
      assert.match(after.contextText, new RegExp(scenario.replacement))
      assert.doesNotMatch(after.contextText, new RegExp(scenario.obsolete))
      const items = (await world()).items
      const old = items.find((item: any) => item.item_id === prior.item_id)
      const replacement = items.find((item: any) => item.item_id !== prior.item_id)
      assert.ok(old, 'old understanding remains available with its source')
      assert.ok(replacement)
      if (scenario.action === 'correct') {
        assert.equal(old.current_state, 'not_current')
        assert.ok(old.lifecycle.invalid_at)
      }
      assert.equal(replacement.current_state, 'current')
      assert.deepEqual(after.memories.map((item: any) => item.id), [replacement.item_id])
      assert.ok((await sources(prior.item_id)).provenance.some((source: any) => source.evidence.raw_content === scenario.old))
      assert.ok((await sources(replacement.item_id)).provenance.some((source: any) => source.evidence.raw_content === scenario.correction))
      await manager.close(); manager = create()
      const restored = await manager.recall(owner, { query: scenario.query, sessionId: 'session-restarted' })
      assert.match(restored.contextText, new RegExp(scenario.replacement))
      assert.doesNotMatch(restored.contextText, new RegExp(scenario.obsolete))
      assert.deepEqual(restored.memories, after.memories)
      assert.equal(requests.length, 2)
    } finally {
      await manager.close()
      await new Promise<void>(resolve => server.close(() => resolve()))
      await rm(root, { recursive: true, force: true })
    }
  })
}
