import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { createPersonalMemoryManager } from '../src/personal-memory/index.mjs'
import { MemoWeftRpc } from '../src/personal-memory/rpc.mjs'
import { handlePersonalMemoryTool } from '../src/personal-access/memory-runtime.mjs'
import { boundaryForCompletedTurn } from '../src/plugins/weftmate-personal-memory.mjs'
import { assertOwnerBoundBoundary } from '../src/personal-memory/boundary.mjs'

const python = process.env.WEFTMATE_TEST_MEMOWEFT_PYTHON
const pythonPath = process.env.WEFTMATE_TEST_MEMOWEFT_SOURCE
const skip = !python || !pythonPath ? 'CI runs this test with the pinned MemoWeft Core' : false
const owner = 'owner-00000000-0000-4000-8000-000000000001'
const wait = async (read: () => Promise<any>, ms = 20000) => {
  const end = Date.now() + ms
  while (Date.now() < end) { const value = await read(); if (value) return value; await new Promise(r => setTimeout(r, 100)) }
  throw Error('Real memory action did not settle')
}
function boundary(text: string, sessionId: string) {
  const events = [
    { seq: 1, type: 'turn/start', data: { turn: 1 } },
    { seq: 2, type: 'user/message', data: { id: sessionId + '-user', source: { kind: 'user' }, content: [{ type: 'text', text }] } },
    { seq: 3, type: 'assistant/message', data: { message: { id: sessionId + '-assistant', content: [{ type: 'text', text: '收到' }] } } },
    { seq: 4, type: 'turn/end', data: { turn: 1, reason: { kind: 'stop' } } },
  ]
  return assertOwnerBoundBoundary(sessionId, boundaryForCompletedTurn({ id: sessionId, header: { agentPreset: 'personal-shared-chat' }, events }, events.at(-1)))
}
async function fixture(t: any) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'weftmate-fix47-')))
  let offline = false, reject = false, calls = 0, loseReceipt = false
  const errors: unknown[] = []
  const coreTrace: any[] = []
  const server = createServer(async (req, res) => {
    try {
      let body = ''; for await (const part of req) body += part
      const payload = JSON.parse(body).messages.map((m: any) => { try { return JSON.parse(m.content) } catch { return null } }).find((m: any) => m?.evidence)
      calls++
      const e = payload.evidence[0], correcting = /红茶/.test(e.text)
      const content = reject ? { schema_version: 8, result: 'cognitions', cognitions: [{ invalid: true }] }
        : { schema_version: 8, result: 'cognitions', cognitions: [{ action: correcting ? 'correct' : 'form', target: 'owner_self',
          statement_kind: 'preference', formed_by: 'stated', proposition: e.text,
          supports: e.segments.map((s: any) => ({ evidence_id: e.id, segment_id: s.id })),
          ...(correcting ? { corrects_cognition_id: payload.current_cognitions[0].id } : {}) }] }
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] }))
    } catch (e) { errors.push(e); res.writeHead(500).end('{}') }
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const baseUrl = `http://127.0.0.1:${(server.address() as any).port}/v1`
  const route = () => ({ profileId: 'synthetic', baseUrl, model: 'synthetic', credential: 'synthetic', routeFingerprint: null, modelTier: 'cloud' })
  const create = () => createPersonalMemoryManager({ root, enabled: true, python, pythonPath, baseUrl, model: '@current', credential: () => 'synthetic',
    processingRoute: route, defaultProcessingRoute: route, rpcFactory: options => {
      const rpc = new MemoWeftRpc(options), request = rpc.request.bind(rpc)
      rpc.request = async (...args: Parameters<MemoWeftRpc['request']>) => {
        if (offline && args[0] !== 'shutdown') throw Object.assign(Error('transport offline'), { code: 'MEMORY_PROCESS_UNAVAILABLE' })
        const result = await request(...args)
        if (['ingest_boundary', 'submit_command', 'query_command_receipt', 'retry_formation', 'query_jobs', 'preview_recall'].includes(args[0]))
          coreTrace.push({ method: args[0], params: args[1], result })
        if (loseReceipt && args[0] === 'submit_command') { loseReceipt = false; throw Object.assign(Error('receipt lost after commit'), { code: 'MEMORY_PROCESS_UNAVAILABLE' }) }
        return result
      }
      return rpc
    } })
  let manager = create()
  t.after(async () => {
    await manager.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r()))
    if (process.env.WEFTMATE_FIX47_CORE_EVIDENCE) await writeFile(path.join(process.env.WEFTMATE_FIX47_CORE_EVIDENCE,
      'core-' + createHash('sha256').update(t.name).digest('hex').slice(0, 12) + '.json'), JSON.stringify({ test: t.name, coreTrace }, null, 2))
    await rm(root, { recursive: true, force: true })
  })
  const world = () => manager.query(owner, 'query_world', { operation: 'list', object_kind: 'cognition', include_history: true })
  const ready = () => wait(async () => (await manager.status(owner)).state === 'ready')
  const tool = (name: string, args: any, id: string, sourceText: string) => handlePersonalMemoryTool(manager, owner,
    { name, arguments: args, requestId: 'memory-tool:' + createHash('sha256').update(id).digest('hex'), source: { id: id + '-user', text: sourceText } },
    { sessionId: id, modelTier: 'cloud', memoryPolicy: { recall: true } })
  await manager.ingest(owner, boundary('记住：我喜欢喝乌龙茶。', 'remember'))
  await ready()
  return { root, world, ready, tool, get manager() { return manager }, errors,
    offline: (value: boolean) => { offline = value }, reject: (value: boolean) => { reject = value }, loseReceipt: () => { loseReceipt = true },
    restart: async () => { await manager.close(); manager = create() }, get calls() { return calls } }
}

test('real Core: explicit correction survives another session and forgetting erases revision sources', { skip }, async t => {
  const f = await fixture(t)
  const old = (await f.world()).items[0]
  const sourceText = '纠正：我现在喜欢红茶，不是乌龙茶。'
  const corrected = await f.tool('memory_correct', { kind: 'cognition', id: old.item_id, expectedWorldRevision: 1, text: '我现在喜欢红茶。' }, 'correct', sourceText)
  assert.equal(corrected.state ?? corrected.receipt?.state, 'applied')
  assert.equal((await f.manager.ingest(owner, boundary(sourceText, 'correct'))).jobState, 'handled_by_tool', 'do not reinterpret an already applied correction')
  const recall = await f.manager.recall(owner, { query: '我喜欢喝什么茶？', sessionId: 'another-device', modelTier: 'cloud' })
  assert.match(recall.contextText, /红茶/); assert.doesNotMatch(recall.contextText, /喜欢喝乌龙茶/)
  const current = (await f.world()).items.find((row: any) => row.current_state === 'current')
  const forgotten = await f.tool('memory_forget', { kind: 'cognition', id: current.item_id, expectedWorldRevision: 2 }, 'forget', '忘掉我的喝茶偏好。')
  assert.equal(forgotten.state, 'applied')
  assert.equal((await f.world()).items.length, 0, 'old sources and their revision chain must also be deleted')
  await f.restart()
  const after = await f.manager.recall(owner, { query: '我喜欢喝什么茶？', sessionId: 'new-device', modelTier: 'cloud' })
  assert.doesNotMatch(after.contextText, /乌龙茶|红茶/)
  assert.doesNotMatch(await readFile(path.join(f.root, 'accounts', owner, 'memory-home', 'pending-actions.json'), 'utf8'), /我现在喜欢红茶/)
  assert.deepEqual(f.errors, [])
})

for (const name of ['memory_correct', 'memory_forget']) test(`real Core: ${name} is queued during an outage and completed after host restart`, { skip }, async t => {
  const f = await fixture(t), old = (await f.world()).items[0]
  f.offline(true)
  const result = await f.tool(name, { kind: 'cognition', id: old.item_id, expectedWorldRevision: 1,
    ...(name === 'memory_correct' ? { text: '我现在喜欢红茶。' } : {}) }, 'outage', name === 'memory_correct' ? '纠正成红茶' : '忘掉喝茶偏好')
  assert.equal(result.state, 'queued'); assert.match(result.message, /这次还没.*稍后会再试/)
  await f.restart(); f.offline(false)
  await wait(async () => {
    const items = (await f.world()).items
    return name === 'memory_forget' ? items.length === 0 : items.some((row: any) => row.current_state === 'current' && /红茶/.test(row.value.content))
  })
  const recall = await f.manager.recall(owner, { query: '我喜欢喝什么茶？', sessionId: 'recovered-device', modelTier: 'cloud' })
  if (name === 'memory_correct') { assert.match(recall.contextText, /红茶/); assert.doesNotMatch(recall.contextText, /喜欢喝乌龙茶/) }
  else assert.doesNotMatch(recall.contextText, /乌龙茶/)
  assert.deepEqual(f.errors, [])
})

test('real Core: rejected formation automatically reprocesses and leaves degraded after recovery', { skip }, async t => {
  const f = await fixture(t)
  f.reject(true)
  await f.manager.ingest(owner, boundary('不对，纠正成我喜欢喝红茶。', 'natural-correction'))
  await wait(async () => (await f.manager.status(owner)).failedCorrectionCount === 1)
  f.reject(false)
  await f.ready()
  const recall = await f.manager.recall(owner, { query: '我喜欢喝什么茶？', sessionId: 'recovered', modelTier: 'cloud' })
  assert.match(recall.contextText, /红茶/); assert.doesNotMatch(recall.contextText, /喜欢喝乌龙茶/)
  assert.ok(f.calls >= 3); assert.deepEqual(f.errors, [])
})

test('real Core: one forget removes a failed duplicate correction quote as well as the formal fact', { skip }, async t => {
  const f = await fixture(t), old = (await f.world()).items[0]
  f.reject(true)
  await f.manager.ingest(owner, boundary('不对，纠正一下：我现在喜欢红茶，不是乌龙茶。', 'legacy-duplicate'))
  await wait(async () => (await f.manager.status(owner)).failedCorrectionCount === 1)
  const corrected = await f.tool('memory_correct', { kind: 'cognition', id: old.item_id, expectedWorldRevision: 1, text: '我喜欢红茶。' }, 'correct-legacy', '纠正成红茶。')
  assert.equal(corrected.state ?? corrected.receipt?.state, 'applied')
  const current = (await f.world()).items.find((row: any) => row.current_state === 'current')
  const revision = (await f.manager.status(owner)).worldRevision
  const result = await f.tool('memory_forget', { kind: 'cognition', id: current.item_id, expectedWorldRevision: revision }, 'forget-legacy', '忘掉喝茶偏好。')
  assert.equal(result.state ?? result.receipt?.state, 'applied')
  const recall = await f.manager.recall(owner, { query: '我喜欢喝什么茶？', sessionId: 'another-device', modelTier: 'cloud' })
  assert.doesNotMatch(recall.contextText, /红茶|乌龙茶/, 'deleting only the formal fact leaves the failed correction quote recallable')
  assert.equal((await f.manager.status(owner)).failedCorrectionCount, 0)
})

test('real Core: a lost correction receipt is replayed once after restart', { skip }, async t => {
  const f = await fixture(t), old = (await f.world()).items[0]
  f.loseReceipt()
  const result = await f.tool('memory_correct', { kind: 'cognition', id: old.item_id, expectedWorldRevision: 1, text: '我喜欢红茶。' }, 'lost', '纠正成红茶。')
  assert.equal(result.state, 'queued')
  await f.restart()
  await wait(async () => {
    const state = JSON.parse(await readFile(path.join(f.root, 'accounts', owner, 'memory-home', 'pending-actions.json'), 'utf8'))
    return Object.values(state.records).every((row: any) => row.result?.state === 'applied')
  })
  assert.equal((await f.manager.status(owner)).worldRevision, 2, 'recovery reads the original Core receipt instead of mutating again')
  assert.equal((await f.world()).items.filter((row: any) => row.current_state === 'current').length, 1)
})

test('real Core: topic correction and forgetting preserve unrelated memories and redact action text', { skip }, async t => {
  const f = await fixture(t)
  await f.manager.ingest(owner, boundary('记住：我每周五晚上锻炼。', 'unrelated'))
  await f.ready()
  const corrected = await f.tool('memory_correct', { query: '喜欢喝什么茶', text: '我喜欢喝红茶。' }, 'query-correct', '纠正喝茶偏好，我喜欢红茶。')
  assert.equal(corrected.state, 'applied')
  const forgotten = await f.tool('memory_forget', { query: '红茶' }, 'query-forget', '忘掉我的喝茶偏好。')
  assert.equal(forgotten.state, 'applied')
  const remaining = (await f.world()).items
  assert.ok(remaining.some((row: any) => /周五/.test(row.value.content)), 'topic deletion must not include standing unrelated context')
  assert.equal(remaining.some((row: any) => /乌龙茶|红茶/.test(row.value.content)), false, JSON.stringify(remaining))
  assert.doesNotMatch(await readFile(path.join(f.root, 'accounts', owner, 'memory-home', 'pending-actions.json'), 'utf8'), /我喜欢红茶/)
})

test('real Core: a queued correction follows a target already replaced by background formation', { skip }, async t => {
  const f = await fixture(t), old = (await f.world()).items[0]
  await f.manager.ingest(owner, boundary('不对，我喜欢红茶。', 'intervening-correction'))
  await f.ready()
  const result = await f.tool('memory_correct', { kind: 'cognition', id: old.item_id, expectedWorldRevision: 1, text: '我喜欢喝普洱茶。' }, 'late-tool', '纠正我喝茶的偏好：我喜欢喝普洱茶。')
  assert.equal(result.state, 'queued')
  await wait(async () => (await f.world()).items.some((row: any) => row.current_state === 'current' && /普洱茶/.test(row.value.content)))
  const recall = await f.manager.recall(owner, { query: '我喜欢喝什么茶？', sessionId: 'later-device', modelTier: 'cloud' })
  assert.match(recall.contextText, /普洱茶/, JSON.stringify({ recall, world: (await f.world()).items })); assert.doesNotMatch(recall.contextText, /我喜欢红茶/)
})
