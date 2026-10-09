import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createPersonalMemoryManager } from '../src/personal-memory/index.mjs'
import { boundaryForCompletedTurn } from '../src/plugins/weftmate-personal-memory.mjs'

const python = process.env.WEFTMATE_TEST_MEMOWEFT_PYTHON
const pythonPath = process.env.WEFTMATE_TEST_MEMOWEFT_SOURCE
const owner = 'owner-00000000-0000-4000-8000-000000000015'
const claim = '以后用户想组队时，我提醒用户找王小明。'
const skip = !python || !pythonPath ? 'Observed bridge runs with pinned Core' : false

for (const [confirmation, delayed] of [['行，就这么办', false], ['刚才你说的组队提醒，行，就这么办。', true]] as const) {
  test(`confirmed decision across durable turns: ${delayed ? 'delayed' : 'alternate wording'}`, { skip }, async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'fx15-confirmed-')))
    const errors: unknown[] = []
    const server = createServer(async (req, res) => {
      try {
        let body = ''; for await (const chunk of req) body += chunk
        const payload = JSON.parse(body).messages.map((message: any) => {
          try { return JSON.parse(message.content) } catch { return null }
        }).find((value: any) => Array.isArray(value?.evidence))
        const evidence = payload.evidence[0]
        const confirming = evidence.text === confirmation
        if (confirming) assert.ok(evidence.context.includes(claim))
        const result = confirming ? { schema_version: 2, result: 'cognitions', cognitions: [{
          action: 'form', target: 'owner_self', statement_kind: 'preference', formed_by: 'confirmed',
          proposition: claim, assistant_claim: claim,
          supports: [{ evidence_id: evidence.id, start: 0, end: confirmation.length }],
        }] } : { schema_version: 2, result: 'no_change' }
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }], model: 'synthetic', usage: { total_tokens: 0 } }))
      } catch (error) { errors.push(error); res.statusCode = 500; res.end('{}') }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    const route = () => ({ profileId: 'synthetic', baseUrl: `http://127.0.0.1:${address.port}/v1`,
      model: 'synthetic', credential: 'synthetic', routeFingerprint: null, modelTier: 'cloud' })
    const create = () => createPersonalMemoryManager({ root, enabled: true, python, pythonPath,
      baseUrl: `http://127.0.0.1:${address.port}/v1`, model: '@current', credential: () => 'synthetic',
      processingRoute: route, defaultProcessingRoute: route })
    let manager = create()
    let seq = 0, turn = 0
    const events: any[] = []
    async function send(text: string, assistant = '收到') {
      turn++
      events.push({ seq: ++seq, type: 'turn/start', data: { turn } },
        { seq: ++seq, type: 'user/message', data: { id: `user-${turn}`, source: { kind: 'user' }, content: [{ type: 'text', text }] } },
        { seq: ++seq, type: 'assistant/message', data: { message: { id: `assistant-${turn}`, content: [{ type: 'text', text: assistant }] } } },
        { seq: ++seq, type: 'turn/end', data: { turn, reason: { kind: 'stop' } } })
      const boundary = boundaryForCompletedTurn({ id: 'synthetic-source', header: { agentPreset: 'personal-shared-chat' }, events }, events.at(-1))
      assert.deepEqual(boundary.source_messages.map((message: any) => message.message_id), [`user-${turn}`, `assistant-${turn}`])
      await manager.ingest(owner, boundary)
      const deadline = Date.now() + 15000
      while (true) {
        const jobs = await manager.query(owner, 'query_jobs', { operation: 'list' })
        if (!jobs.jobs.some((job: any) => ['pending','processing','retry'].includes(job.worker?.state))) break
        assert.ok(Date.now() < deadline, 'formation timed out')
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    }
    try {
      await send('王小明打游戏挺厉害，是我好兄弟。', claim)
      if (delayed) { await send('一周有几天？', '七天。'); await send('17加23是多少？', '40。') }
      await send(confirmation)
      const world = await manager.query(owner, 'query_world', { operation: 'list', object_kind: 'cognition', include_history: false })
      assert.equal(world.items.length, 1)
      const id = world.items[0].item_id
      const source = await manager.query(owner, 'query_provenance', { object_kind: 'cognition', item_id: id })
      assert.ok(source.provenance.some((row: any) => row.evidence.raw_content === confirmation))
      assert.ok(source.provenance.some((row: any) => row.assistant_sources?.some((proposal: any) => proposal.message_id === 'assistant-1' && proposal.content === claim)))
      await manager.close(); manager = create()
      const recalled = await manager.recall(owner, { query: '我们之前说组队可以找谁？', sessionId: 'new-session' })
      assert.ok(recalled.memories.some((item: any) => item.id === id))
      assert.match(recalled.contextText, /王小明/)
      assert.deepEqual(errors, [])
    } finally {
      await manager.close()
      await new Promise<void>(resolve => server.close(() => resolve()))
      await rm(root, { recursive: true, force: true })
    }
  })
}
