import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createPersonalMemoryManager } from '../src/personal-memory/index.mjs'
import { MemoWeftRpc } from '../src/personal-memory/rpc.mjs'
import { handlePersonalMemoryTool } from '../src/personal-access/memory-runtime.mjs'
import { handlePersonalMemoryHttp } from '../src/personal-memory/http.mjs'
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
async function fixture(t: any, { interpret = null }: { interpret?: ((payload: any) => any) | null } = {}) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'weftmate-fix47-')))
  let offline = false, reject = false, calls = 0, loseReceipt = false, correctionsUnavailable = false, unavailableText = ''
  let recoveryGate: { entered: () => void, pending: Promise<void> } | null = null
  const errors: unknown[] = []
  const coreTrace: any[] = []
  const server = createServer(async (req, res) => {
    try {
      let body = ''; for await (const part of req) body += part
      const payload = JSON.parse(body).messages.map((m: any) => { try { return JSON.parse(m.content) } catch { return null } }).find((m: any) => m?.evidence)
      calls++
      const e = payload.evidence[0], correcting = /红茶/.test(e.text)
      const content = interpret?.(payload) ?? (reject ? { schema_version: 8, result: 'cognitions', cognitions: [{ invalid: true }] }
        : { schema_version: 8, result: 'cognitions', cognitions: [{ action: correcting ? 'correct' : 'form', target: 'owner_self',
          statement_kind: 'preference', formed_by: 'stated', proposition: e.text,
          supports: e.segments.map((s: any) => ({ evidence_id: e.id, segment_id: s.id })),
          ...(correcting ? { corrects_cognition_id: payload.current_cognitions[0].id } : {}) }] })
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] }))
    } catch (e) { errors.push(e); res.writeHead(500).end('{}') }
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const baseUrl = `http://127.0.0.1:${(server.address() as any).port}/v1`
  const route = () => ({ profileId: 'synthetic', baseUrl, model: 'synthetic', credential: 'synthetic', routeFingerprint: null, modelTier: 'cloud' })
  const create = (dataRoot = root) => createPersonalMemoryManager({ root: dataRoot, enabled: true, python, pythonPath, baseUrl, model: '@current', credential: () => 'synthetic',
    processingRoute: route, defaultProcessingRoute: route, rpcFactory: options => {
      const rpc = new MemoWeftRpc(options), request = rpc.request.bind(rpc)
      rpc.request = async (...args: Parameters<MemoWeftRpc['request']>) => {
        if (args[0] === 'query_jobs' && recoveryGate) {
          const gate = recoveryGate; recoveryGate = null
          gate.entered(); await gate.pending
        }
        if (offline && args[0] !== 'shutdown') throw Object.assign(Error('transport offline'), { code: 'MEMORY_PROCESS_UNAVAILABLE' })
        if ((correctionsUnavailable || unavailableText && args[1]?.command?.payload?.correction_text === unavailableText) &&
            args[0] === 'submit_command' && args[1]?.command?.operation === 'correct_world_item')
          throw Object.assign(Error('correction write unavailable'), { code: 'MEMORY_BUSY' })
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
  const ready = async () => {
    let status
    try { return await wait(async () => { status = await manager.status(owner); return status.state === 'ready' }) }
    catch (error) { error.message += JSON.stringify({ status, jobs: await manager.query(owner, 'query_jobs', { operation: 'list' }) }); throw error }
  }
  const tool = (name: string, args: any, id: string, sourceText: string) => handlePersonalMemoryTool(manager, owner,
    { name, arguments: args, requestId: 'memory-tool:' + createHash('sha256').update(id).digest('hex'), source: { id: id + '-user', text: sourceText } },
    { sessionId: id, modelTier: 'cloud', memoryPolicy: { recall: true } })
  await manager.ingest(owner, boundary('记住：我喜欢喝乌龙茶。', 'remember'))
  await ready()
  return { root, world, ready, tool, fork: () => create(path.join(root, 'imported')), get manager() { return manager }, errors,
    offline: (value: boolean) => { offline = value }, reject: (value: boolean) => { reject = value }, loseReceipt: () => { loseReceipt = true },
    holdCorrections: (value: boolean) => { correctionsUnavailable = value },
    holdCorrectionText: (value: string) => { unavailableText = value },
    pauseRecovery: () => {
      let entered!: () => void, release!: () => void
      const started = new Promise<void>(resolve => { entered = resolve })
      const pending = new Promise<void>(resolve => { release = resolve })
      recoveryGate = { entered, pending }
      return { started, release }
    },
    restart: async () => { await manager.close(); manager = create() }, get calls() { return calls } }
}

test('real Core: explicit correction survives another session and forgetting erases revision sources', { skip }, async t => {
  const f = await fixture(t)
  const old = (await f.world()).items[0]
  const sourceText = '纠正：我现在喜欢红茶，不是乌龙茶。'
  const corrected = await f.tool('memory_correct', { kind: 'cognition', id: old.item_id, expectedWorldRevision: 1, text: '我现在喜欢红茶。' }, 'correct', sourceText)
  assert.equal(corrected.state ?? corrected.receipt?.state, 'applied')
  assert.equal((await f.manager.ingest(owner, boundary(sourceText, 'correct'))).state, 'accepted')
  await f.ready()
  assert.equal((await f.world()).items.filter((row: any) => row.current_state === 'current').length, 1,
    'Core keeps one current understanding while retaining the complete original source')
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

test('real Core: erasing the account also cancels queued memory actions', { skip }, async t => {
  const f = await fixture(t), old = (await f.world()).items[0]
  f.offline(true)
  const result = await f.tool('memory_correct', { kind: 'cognition', id: old.item_id, expectedWorldRevision: 1, text: '我喜欢喝红茶。' }, 'erase-pending', '纠正成红茶。')
  assert.equal(result.state, 'queued')
  f.offline(false)
  await f.manager.eraseAccount(owner)
  await f.restart()
  assert.equal((await f.world()).items.length, 0)
  await assert.rejects(readFile(path.join(f.root, 'accounts', owner, 'memory-home', 'pending-actions.json')), { code: 'ENOENT' })
})

test('review-1 real Core: missing corrections finish and cannot block later requests across restart', { skip }, async t => {
  const f = await fixture(t), old = (await f.world()).items[0]
  const missing = await f.tool('memory_correct', { query: '不存在的第47917种木星饮料', text: '不存在的饮料改成温水。' }, 'missing', '纠正那条不存在的记忆。')
  const next = await f.tool('memory_correct', { kind: 'cognition', id: old.item_id, expectedWorldRevision: 1, text: '我喜欢喝红茶。' }, 'after-missing', '纠正我喜欢喝红茶。')
  assert.deepEqual([missing.state, next.state], ['not_found', 'applied'])
  assert.equal(missing.message, '没找到这条记忆。')
  await f.restart()
  const recall = await f.manager.recall(owner, { query: '我喜欢喝什么茶？', sessionId: 'after-restart', modelTier: 'cloud' })
  assert.match(recall.contextText, /红茶/)
})

test('review-1 real Core: deletion ends a queued correction instead of blocking the next action', { skip }, async t => {
  const f = await fixture(t), old = (await f.world()).items[0]
  f.offline(true)
  const pending = await f.tool('memory_correct', { kind: 'cognition', id: old.item_id, expectedWorldRevision: 1, text: '我喜欢喝红茶。' }, 'deleted-target', '纠正为红茶。')
  assert.equal(pending.state, 'queued')
  // Keep this correction unavailable until the real page deletion commits;
  // otherwise the recovery timer can win first on a fast CI machine.
  f.holdCorrections(true); f.offline(false)
  const deleted = await f.manager.submitCommand(owner, { requestId: 'delete-before-retry', operation: 'delete_world_item', targetKind: 'cognition',
    targetId: old.item_id, expectedWorldRevision: 1, payload: {} })
  assert.equal(deleted.receipt.result_state, 'applied')
  await f.restart(); f.holdCorrections(false)
  // Startup has already read its empty outbox when it polls Core jobs. Enqueue
  // the new turn there and let its immediate retry fire before startup finishes.
  const recovery = f.pauseRecovery()
  await recovery.started
  const ingestion = f.manager.ingest(owner, boundary('记住：我每周五晚上锻炼。', 'after-deletion'))
  try {
    await wait(async () => (await f.manager.pendingStatus(owner)).pendingBoundaryCount === 1)
    await new Promise(resolve => setTimeout(resolve, 0))
  } finally { recovery.release() }
  await ingestion; await f.ready()
  const target = (await f.world()).items.find((row: any) => row.current_state === 'current')
  const next = await f.tool('memory_correct', { kind: 'cognition', id: target.item_id, expectedWorldRevision: (await f.manager.status(owner)).worldRevision,
    text: '我每周六晚上锻炼。' }, 'after-deleted-target', '纠正锻炼时间为每周六晚上。')
  assert.equal(next.state, 'applied')
  const state = JSON.parse(await readFile(path.join(f.root, 'accounts', owner, 'memory-home', 'pending-actions.json'), 'utf8'))
  const canceled = state.records['memory-tool:' + createHash('sha256').update('deleted-target').digest('hex')]
  assert.equal(canceled.result.state, 'not_found')
  assert.deepEqual(canceled.arguments, {})
  assert.equal(canceled.command, undefined)
  const recall = await f.manager.recall(owner, { query: '我喜欢喝什么茶？', sessionId: 'after-deleted-restart', modelTier: 'cloud' })
  assert.doesNotMatch(recall.contextText, /乌龙茶|红茶/, 'the canceled correction must not restore forgotten content')
  assert.deepEqual(f.errors, [])
})

test('review-1 real Core: an older failed correction cannot undo the later successful preference', { skip }, async t => {
  const f = await fixture(t), old = (await f.world()).items[0]
  f.holdCorrectionText('我喜欢喝红茶。')
  const first = await f.tool('memory_correct', { kind: 'cognition', id: old.item_id, expectedWorldRevision: 1, text: '我喜欢喝红茶。' }, 'older-pending', '纠正为红茶。')
  assert.equal(first.state, 'queued')
  const later = await f.tool('memory_correct', { kind: 'cognition', id: old.item_id, expectedWorldRevision: 1, text: '我喜欢喝普洱茶。' }, 'newer-success', '再纠正为普洱茶。')
  assert.equal(later.state, 'applied')
  f.holdCorrectionText(''); await f.restart(); await f.manager.flushPending(owner)
  await wait(async () => {
    const state = JSON.parse(await readFile(path.join(f.root, 'accounts', owner, 'memory-home', 'pending-actions.json'), 'utf8'))
    return Object.values(state.records).every((row: any) => row.result)
  })
  const recall = await f.manager.recall(owner, { query: '我喜欢喝什么茶？', sessionId: 'latest-preference', modelTier: 'cloud' })
  assert.match(recall.contextText, /普洱茶/); assert.doesNotMatch(recall.contextText, /我喜欢喝红茶/)
})

test('review-2 real Core: a corrected clause does not discard the birthday in the same message', { skip }, async t => {
  const f = await fixture(t, { interpret: payload => {
    const e = payload.evidence[0]
    if (!e.text.includes('生日')) return null
    return { schema_version: 8, result: 'cognitions', cognitions: [{ action: 'form', target: 'owner_self',
      statement_kind: 'attribute', formed_by: 'stated', proposition: '我的生日是五月一日。',
      supports: e.segments.filter((s: any) => s.text.includes('生日')).map((s: any) => ({ evidence_id: e.id, segment_id: s.id })) }] }
  } })
  const old = (await f.world()).items[0]
  const source = '把喝茶偏好改成红茶，另外记住我的生日是五月一日。'
  const result = await f.tool('memory_correct', { kind: 'cognition', id: old.item_id, expectedWorldRevision: 1, text: '我喜欢喝红茶。' }, 'mixed-source', source)
  assert.equal(result.state, 'applied')
  await f.manager.ingest(owner, boundary(source, 'mixed-source')); await f.ready()
  const items = (await f.world()).items.filter((row: any) => row.current_state === 'current')
  assert.ok(items.some((row: any) => /生日.*五月一日/.test(row.value.content)), 'the untouched birthday must be formed')
  assert.equal(items.filter((row: any) => /喝.*红茶/.test(row.value.content)).length, 1)
  const revision = (await f.manager.status(owner)).worldRevision
  await f.manager.ingest(owner, boundary(source, 'mixed-source')); await f.ready()
  assert.equal((await f.manager.status(owner)).worldRevision, revision, 'Core deduplicates the exact original boundary')
  await f.restart()
  assert.match((await f.manager.recall(owner, { query: '我的生日', sessionId: 'birthday-new-session', modelTier: 'cloud' })).contextText, /五月一日/)
})

test('review-2 real Core: queued correction retains the other fact while its source waits for recovery', { skip }, async t => {
  const f = await fixture(t, { interpret: payload => {
    const e = payload.evidence[0]
    if (!e.text.includes('生日')) return null
    return { schema_version: 8, result: 'cognitions', cognitions: [{ action: 'form', target: 'owner_self',
      statement_kind: 'attribute', formed_by: 'stated', proposition: '我的生日是五月一日。',
      supports: e.segments.filter((s: any) => s.text.includes('生日')).map((s: any) => ({ evidence_id: e.id, segment_id: s.id })) }] }
  } })
  const old = (await f.world()).items[0], source = '把喝茶偏好改成红茶，另外记住我的生日是五月一日。'
  f.offline(true)
  assert.equal((await f.tool('memory_correct', { kind: 'cognition', id: old.item_id, expectedWorldRevision: 1, text: '我喜欢喝红茶。' }, 'mixed-queued', source)).state, 'queued')
  assert.equal((await f.manager.ingest(owner, boundary(source, 'mixed-queued'), { defer: true })).state, 'queued')
  await f.restart(); f.offline(false)
  await wait(async () => {
    const items = (await f.world()).items.filter((row: any) => row.current_state === 'current')
    return items.some((row: any) => /生日.*五月一日/.test(row.value.content)) && items.some((row: any) => /喝.*红茶/.test(row.value.content))
  })
})

test('review-3 real Core: forgetting an implicitly formed person deletes indirect relationship sources', { skip }, async t => {
  const f = await fixture(t, { interpret: payload => {
    const e = payload.evidence[0]
    if (!e.text.includes('林舟')) return null
    return { schema_version: 8, result: 'cognitions', cognitions: [{ action: 'form', target: 'owner_self',
      statement_kind: 'relationship', formed_by: 'stated', proposition: e.text, relation_type: '同事',
      target_entity: { canonical_name: '林舟', kind: 'person' },
      supports: e.segments.map((s: any) => ({ evidence_id: e.id, segment_id: s.id })) }] }
  } })
  await f.manager.ingest(owner, boundary('林舟是我的同事。', 'person-source')); await f.ready()
  // Public Core Portable permits relationships without direct entity-evidence
  // ledgers. Restore that legitimate older shape through Core's importer; do
  // not edit SQLite or substitute the actual deletion/recall implementation.
  const exported = await f.manager.portableExport(owner)
  exported.data.entityEvidence = []; exported.metadata.counts.entityEvidence = 0
  const bundle = JSON.parse(execFileSync(python!, ['-c',
    'import sys,json; from memoweft.portable import derive_bundle_id; b=json.load(sys.stdin); b["bundleId"]=derive_bundle_id(b); print(json.dumps(b))'],
    { input: JSON.stringify(exported), encoding: 'utf8', windowsHide: true, env: { ...process.env, PYTHONPATH: pythonPath! } }))
  const restored = f.fork()
  try {
    const plan = await restored.query(owner, 'portable_plan', { bundle })
    assert.equal(plan.valid, true, JSON.stringify(plan.errors))
    await restored.query(owner, 'portable_import', { operation: 'apply', bundle, plan_hash: plan.plan_hash })
    const entities = await restored.query(owner, 'query_world', { operation: 'list', object_kind: 'entity', include_history: true })
    const person = entities.items.find((row: any) => row.value.canonical_name === '林舟')
    assert.ok(person)
    const direct = await restored.query(owner, 'query_provenance', { object_kind: 'entity', item_id: person.item_id, projection: 'history' })
    assert.equal(direct.provenance.length, 0)
    const result = await handlePersonalMemoryTool(restored, owner, { name: 'memory_forget',
      requestId: 'memory-tool:' + createHash('sha256').update('forget-person').digest('hex'),
      arguments: { kind: 'entity', id: person.item_id, expectedWorldRevision: entities.world_revision } },
      { sessionId: 'forget-person', modelTier: 'cloud', memoryPolicy: { recall: true } })
    assert.equal(result.state, 'applied')
    const after = await restored.query(owner, 'query_world', { operation: 'list', object_kind: 'entity', include_history: true })
    assert.equal(after.items.some((row: any) => row.item_id === person.item_id), false)
    const recall = await restored.recall(owner, { query: '林舟是我的谁？', sessionId: 'person-new-session', modelTier: 'cloud' })
    assert.doesNotMatch(recall.contextText, /林舟/)
  } finally { await restored.close() }
})

test('review-4 real Core: deleting through the memory page also erases pending-action correction copies', { skip }, async t => {
  const f = await fixture(t), old = (await f.world()).items[0]
  await f.tool('memory_correct', { kind: 'cognition', id: old.item_id, expectedWorldRevision: 1, text: '我喜欢喝红茶。' }, 'page-copy', '纠正喝茶偏好为红茶。')
  const current = (await f.world()).items.find((row: any) => row.current_state === 'current')
  const pathname = `/personal/v1/memory/items/cognition/${current.item_id}`
  const deleted = await handlePersonalMemoryHttp({ manager: f.manager, ownerId: owner, pathname, url: new URL(pathname, 'http://memory'),
    request: { method: 'DELETE' }, readJson: async () => ({ requestId: 'page-delete', expectedWorldRevision: (await f.manager.status(owner)).worldRevision, deleteConversationSnippets: true }) })
  assert.equal(deleted.body.receipt.state, 'applied')
  const state = await readFile(path.join(f.root, 'accounts', owner, 'memory-home', 'pending-actions.json'), 'utf8')
  assert.doesNotMatch(state, /红茶/)
  await f.restart()
  assert.doesNotMatch(await readFile(path.join(f.root, 'accounts', owner, 'memory-home', 'pending-actions.json'), 'utf8'), /红茶/)
})
