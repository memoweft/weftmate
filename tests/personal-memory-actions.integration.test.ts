import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, readFile, readdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { channel } from 'node:diagnostics_channel'
import { execFileSync, fork } from 'node:child_process'
import { createPersonalMemoryManager } from '../src/personal-memory/index.mjs'
import { MemoWeftRpc } from '../src/personal-memory/rpc.mjs'
import { handlePersonalMemoryTool } from '../src/personal-access/memory-runtime.mjs'
import { handlePersonalMemoryHttp } from '../src/personal-memory/http.mjs'
import { boundaryForCompletedTurn } from '../src/plugins/weftmate-personal-memory.mjs'
import { assertOwnerBoundBoundary } from '../src/personal-memory/boundary.mjs'
import { birthdayForgetDecisions } from './helpers/birthday-forget-decisions.mjs'

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
async function fixture(t: any, { interpret = null, misattribute = false, birthdayContract = false, malformedDecision = false, wrongQuestionOnly = false, seedText = '记住：我喜欢喝乌龙茶。', cleanupDeletedMemory = null }: { interpret?: ((payload: any) => any) | null, misattribute?: boolean, birthdayContract?: boolean, malformedDecision?: boolean, wrongQuestionOnly?: boolean, seedText?: string, cleanupDeletedMemory?: ((owner: string, input: any) => Promise<void>) | null } = {}) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'weftmate-fix47-')))
  let offline = false, reject = false, calls = 0, loseReceipt = false, correctionsUnavailable = false, unavailableText = ''
  let recoveryGate: { entered: () => void, pending: Promise<void> } | null = null
  const errors: unknown[] = []
  const coreTrace: any[] = []
  const actionDiagnostics = channel('weftmate.memory.actions')
  const actionObserver = (value: unknown) => coreTrace.push({ actionTrace: value })
  actionDiagnostics.subscribe(actionObserver)
  const server = createServer(async (req, res) => {
    try {
      let body = ''; for await (const part of req) body += part
      const request = JSON.parse(body)
      const decisionTool = request.tools?.[0]?.function?.name
      if (decisionTool) {
        if (malformedDecision) {
          res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '已忘掉。' }, finish_reason: 'stop' }] }))
          return
        }
        const input = JSON.parse(request.messages.at(-1).content)
        const value = decisionTool === 'classify_forget_request' ? {
          isForgetRequest: !/如果|哪些|翻译/.test(input.message), conditionsOrQuestions: /如果|哪些/.test(input.message),
          subject: input.message.includes('妈妈') ? 'other:妈妈' : input.message.includes('林舟') ? 'other:林舟' : 'self',
          topic: input.message.includes('生日') ? (input.message.includes('妈妈') ? '妈妈的生日' : '我的生日') : input.message.includes('林舟') ? '林舟' : input.message.includes('蓝色') ? '我喜欢蓝色的偏好' : '我喝茶的偏好',
        } : { items: birthdayContract ? birthdayForgetDecisions(input, { misattribute }) : input.candidates.map((candidate: any) => ({ key: candidate.key,
          matchesTopic: wrongQuestionOnly ? /根据我的记忆/.test(candidate.text) : input.request.topic.includes('收藏编号') ? candidate.text.includes('收藏编号') : input.request.topic.includes('生日') ? candidate.text.includes('生日') : input.request.topic.includes('林舟') ? candidate.text.includes('林舟') : input.request.topic.includes('蓝色') ? candidate.text.includes('蓝色') : /茶|纠正/.test(candidate.text),
          ...(request.tools[0].function.parameters.properties.items.items.properties.hasTargetFact ? {
            hasTargetFact: !/根据我的记忆|什么茶|什么时候/.test(candidate.text),
            targetSubjects: /根据我的记忆|什么茶|什么时候/.test(candidate.text) ? [] : [misattribute ? 'self' : candidate.text.includes('妈妈') ? 'other:妈妈' : candidate.text.includes('同事小王') ? 'other:同事小王' : candidate.text.includes('林舟') ? 'other:林舟' : 'self'],
            sourceFullyAuthorized: !candidate.sourceTexts.some((text: string) => /生日/.test(text) && /茶/.test(text) ||
              /散步/.test(text) && /红茶|绿茶/.test(text) && !input.request.topic.includes('散步')),
          } : {}),
          subjects: [misattribute ? 'self' : candidate.text.includes('妈妈') ? 'other:妈妈' : candidate.text.includes('同事小王') ? 'other:同事小王' : candidate.text.includes('林舟') ? 'other:林舟' : 'self'],
        })) }
        coreTrace.push({ modelDecision: decisionTool, input, result: value })
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: null,
          tool_calls: [{ id: 'decision', type: 'function', function: { name: decisionTool, arguments: JSON.stringify(value) } }] }, finish_reason: 'tool_calls' }] }))
        return
      }
      const payload = request.messages.map((m: any) => { try { return JSON.parse(m.content) } catch { return null } }).find((m: any) => m?.evidence)
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
    processingRoute: route, defaultProcessingRoute: route, cleanupDeletedMemory, rpcFactory: options => {
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
        let result
        try { result = await request(...args) }
        catch (error: any) { coreTrace.push({ method: args[0], params: args[1], error: { code: error.code, message: error.message } }); throw error }
        if (['ingest_boundary', 'submit_command', 'query_command_receipt', 'retry_formation', 'query_jobs', 'preview_recall', 'query_world'].includes(args[0]))
          coreTrace.push({ method: args[0], params: args[1], result })
        if (loseReceipt && args[0] === 'submit_command') { loseReceipt = false; throw Object.assign(Error('receipt lost after commit'), { code: 'MEMORY_PROCESS_UNAVAILABLE' }) }
        return result
      }
      return rpc
    } })
  let manager = create()
  t.after(async () => {
    await manager.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r()))
    actionDiagnostics.unsubscribe(actionObserver)
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
    { name, arguments: name === 'memory_correct' ? { ...args, sourceQuote: args.sourceQuote ?? sourceText.match(/^.*?[\n，。！？；,!?;]/su)?.[0] ?? sourceText } : args,
      requestId: 'memory-tool:' + createHash('sha256').update(id).digest('hex'), source: { id: id + '-user', text: sourceText,
        message: { message_id: id + '-user', content: sourceText, preceding_ai_context: null } } },
    { sessionId: id, modelTier: 'cloud', memoryPolicy: { recall: true } })
  await manager.ingest(owner, boundary(seedText, 'remember'))
  await ready()
  return { root, world, ready, tool, fork: () => create(path.join(root, 'imported')), get manager() { return manager }, errors,
    pauseRecovery: () => {
      let entered!: () => void, release!: () => void
      const started = new Promise<void>(resolve => { entered = resolve })
      const pending = new Promise<void>(resolve => { release = resolve })
      recoveryGate = { entered, pending }
      return { started, release }
    },
    offline: (value: boolean) => { offline = value }, reject: (value: boolean) => { reject = value }, loseReceipt: () => { loseReceipt = true },
    holdCorrections: (value: boolean) => { correctionsUnavailable = value },
    holdCorrectionText: (value: string) => { unavailableText = value },
    restart: async () => { await manager.close(); manager = create() }, get calls() { return calls },
    get trace() { return coreTrace },
    get decisions() { return coreTrace.filter(row => row.modelDecision).length },
    get decisionInputs() { return coreTrace.filter(row => row.modelDecision === 'classify_forget_candidates').map(row => row.input) } }
}

// Exercise the actual plugin and host tool entry against Core. Only DSH message
// construction/tool registration and the transport failure are synthetic seams.
for (const scenario of ['long conditional', 'long unconditional', 'history fallback', 'without pre-step', 'failed authorization', '15999', '16000', '16001'] as const)
test(`FIX-50 full review real Core: ${scenario} never reauthorizes incomplete forgetting`, { skip }, async t => {
  const f = await fixture(t)
  const before = await f.world()
  assert.equal(before.items.length, 1)
  const { apply } = await import('../src/plugins/weftmate-personal-memory.mjs')
  const { registerHooks } = await import('node:module')
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@deepseek-ai/dsh-tools') return { shortCircuit: true, url: 'data:text/javascript,export const defineTool = input => input' }
    if (specifier === '@deepseek-ai/dsh-llm/message') return { shortCircuit: true,
      url: 'data:text/javascript,export const createUserMessage = input => ({id:crypto.randomUUID(),role:"user",...input}); export const createAssistantMessage = input => ({role:"assistant",...input})' }
    return next(specifier, context)
  } })
  const originalSend = process.send, connected = Object.getOwnPropertyDescriptor(process, 'connected')
  const enabled = process.env.WEFTMATE_PERSONAL_MEMORY_ENABLED
  const handlers = new Map(), disposals: (() => void)[] = [], tools = new Map(), seen: any[] = []
  process.env.WEFTMATE_PERSONAL_MEMORY_ENABLED = '1'
  Object.defineProperty(process, 'connected', { configurable: true, value: true })
  ;(process as any).send = (frame: any, callback: any) => {
    void (async () => {
      try {
        if (frame.action === 'tool' && scenario === 'failed authorization' && frame.tool.name === 'memory_forget_request')
          throw Object.assign(Error('synthetic transport failure before authorization'), { code: 'MEMORY_UNAVAILABLE' })
        const result = frame.action === 'tool' ? await handlePersonalMemoryTool(f.manager, owner, frame.tool,
          { sessionId: frame.sessionId, modelTier: 'cloud', memoryPolicy: { recall: true } }) : { state: 'ready', contextText: '' }
        if (frame.action === 'tool') seen.push({ name: frame.tool.name, length: frame.tool.source.text.length, state: result.state })
        process.emit('message', { protocol: frame.protocol, id: frame.id, ok: true, result })
      } catch (error: any) {
        seen.push({ name: frame.tool?.name, length: frame.tool?.source?.text.length, error: error.code })
        process.emit('message', { protocol: frame.protocol, id: frame.id, ok: false, error: error.code })
      }
    })()
    callback?.(); return true
  }
  try {
    apply({ on: (name: string, fn: any) => handlers.set(name, fn), effect: (fn: any) => disposals.push(fn()) })
    const boundaryLength = Number(scenario), leading = '忘掉我喝茶的偏好。', ending = '如果会删除来源原文就先别执行。'
    const text = Number.isFinite(boundaryLength) ? leading + '附'.repeat(boundaryLength - leading.length - ending.length) + ending
      : '忘掉我喝茶的偏好。' + (scenario === 'failed authorization' ? '' : '附加说明。'.repeat(3300))
      + (scenario === 'long unconditional' || scenario === 'failed authorization' ? '' : '如果会删除来源原文就先别执行。')
    if (Number.isFinite(boundaryLength)) assert.equal(text.length, boundaryLength)
    else if (scenario !== 'failed authorization') assert.ok(text.length > 16000)
    const user = { id: 'full-review-user', source: { kind: 'user' }, content: [{ type: 'text', text }] }
    const events: any[] = [{ seq: 1, type: 'turn/start', data: { turn: 1 } }, { seq: 2, type: 'user/message', data: user }]
    const agent: any = { id: 'full-review', status: 'running', ctx: { tools: { register: (tool: any) => tools.set(tool.name, tool) } },
      session: { id: 'full-review', header: { agentPreset: 'personal-shared-chat' }, events,
        append: (type: string, data: any) => events.push({ seq: events.length + 1, type, data }) } }
    await handlers.get('agent/created')({ agent })
    if (scenario !== 'without pre-step') await handlers.get('agent/pre-step')({ agent, turn: 1,
      messages: scenario === 'history fallback' ? [] : [user] }, async () => ({ kind: 'enter', messages: [user] }))
    const result = await tools.get('memory_forget').execute({ query: '我喝茶的偏好' }, { callId: 'full-review-call' })
    await handlers.get('agent/turn-stopping')({ agent, turn: 1 })
    const after = await f.world(), commands = f.trace.filter(row => row.method === 'submit_command')
    console.log('full-review authorization', JSON.stringify({ scenario, seen, state: result.state,
      before: before.items.length, after: after.items.length, commands: commands.length }))
    assert.deepEqual(after.items, before.items, 'Incomplete authorization must preserve the actual Core memory')
    assert.equal(after.world_revision, before.world_revision)
    assert.equal(commands.length, 0)
    assert.ok(['unavailable', 'withheld', 'no_action'].includes(result.state))
    if (Number.isFinite(boundaryLength)) assert.equal(result.state, boundaryLength <= 16000 ? 'no_action' : 'unavailable')
    assert.match(result.message, /没有.*(?:删|执行)|还没忘掉/)
    const reply = events.filter(event => event.type === 'assistant/message').flatMap(event => event.data.message.content).map(part => part.text).join('')
    assert.match(reply, /没有.*(?:删|执行)|还没忘掉/)
    assert.doesNotMatch(reply, /已忘掉|已删除|已经忘/)
    assert.equal(seen.length, 1, 'A failed whole-message check must not start a second authorization')
    if (scenario !== 'failed authorization') assert.equal(seen[0].length, text.length, 'Deletion authorization never receives a truncated message')
  } finally {
    disposals.forEach(fn => fn()); hooks.deregister(); (process as any).send = originalSend
    if (connected) Object.defineProperty(process, 'connected', connected); else delete (process as any).connected
    if (enabled === undefined) delete process.env.WEFTMATE_PERSONAL_MEMORY_ENABLED; else process.env.WEFTMATE_PERSONAL_MEMORY_ENABLED = enabled
  }
})

const confirmedScope = async (f: any, kind: string, id: string) => (await f.manager.query(owner, 'preview_forget', { target_kind: kind, target_id: id })).forget_scope

test('FIX-50 full review real Core: the memory page deletes a standalone failed source and completes cleanup', { skip }, async t => {
  const f = await fixture(t), before = await f.world()
  f.reject(true)
  await f.manager.ingest(owner, boundary('记住：我的收藏编号是Q42。', 'standalone-failed'))
  await wait(async () => (await f.manager.query(owner, 'query_jobs', { operation: 'list' }))
    .formation_requests.some(row => ['dead', 'no_change'].includes(row.state)))
  const sources = (await f.manager.query(owner, 'query_evidence', { operation: 'list' })).evidence
  const source = sources.find(row => row.raw_content.includes('Q42'))
  assert.ok(source)
  const revision = (await f.world()).world_revision
  const preview = await f.manager.query(owner, 'preview_forget', { target_kind: 'evidence', target_id: source.evidence_id })
  assert.ok(preview.items.every((item: any) => ['interaction_context', 'evidence_context'].includes(item.object_kind))); assert.equal(preview.evidence_count, 1)
  const url = new URL('/personal/v1/memory/evidence/' + source.evidence_id, 'http://synthetic')
  const response = await handlePersonalMemoryHttp({ manager: f.manager, ownerId: owner, pathname: url.pathname, url,
    request: { method: 'DELETE' }, readJson: async () => ({ requestId: 'full-review-standalone-delete', expectedWorldRevision: revision, forgetScope: preview.forget_scope }) })
  console.log('full-review standalone', JSON.stringify({ status: response.status, receipt: response.body.receipt }))
  assert.equal(response.status, 200)
  assert.equal(response.body.receipt.state, 'applied')
  assert.equal(response.body.receipt.storageCleanup.state, 'complete')
  await assert.rejects(handlePersonalMemoryHttp({ manager: f.manager, ownerId: owner, pathname: url.pathname, url,
    request: { method: 'GET' }, readJson: async () => ({}) }), { code: 'NOT_FOUND', status: 404 })
  const after = await f.world()
  assert.equal(after.world_revision, revision + 1)
  assert.deepEqual(after.items, before.items.map(row => ({ ...row, world_revision: revision + 1,
    provenance: row.provenance.map(source => ({ ...source, evidence: { ...source.evidence, world_revision: revision + 1 } })) })),
    'The independent memory and its source must survive unchanged at the new global revision')
  assert.equal(f.trace.filter(row => row.method === 'submit_command').length, 1)
})

test('FIX-50 recovery real Core: an old queued truncated authorization cannot survive host restart', { skip }, async t => {
  const f = await fixture(t), before = await f.world()
  const full = '忘掉我喝茶的偏好。' + '附加说明。'.repeat(3300) + '如果会删除来源原文就先别执行。'
  const requestId = 'memory-tool:' + createHash('sha256').update('old-queued-prefix').digest('hex')
  // Exact persisted record shape produced by 9e869a97's host tool + actions
  // after classification succeeds and planning throws MEMORY_BUSY. No plan or
  // command was persisted; the original message survived beside its prefix.
  const record = { requestId, name: 'memory_forget', arguments: { query: '我喝茶的偏好' }, sessionId: 'old-queued-prefix', modelTier: 'cloud',
    source: { id: 'old-prefix-user', text: full.slice(0, 16000),
      message: { message_id: 'old-prefix-user', content: full, preceding_ai_context: null } },
    scope: { isForgetRequest: true, subject: 'self', topic: '我喝茶的偏好', conditionsOrQuestions: false, authorized: true } }
  await f.manager.close()
  const file = path.join(f.root, 'accounts', owner, 'memory-home', 'pending-actions.json')
  await writeFile(file, JSON.stringify({ records: { [requestId]: record } }))
  await f.restart(); await f.ready()
  const result = await wait(async () => JSON.parse(await readFile(file, 'utf8')).records[requestId].result)
  const after = await f.world(), commands = f.trace.filter(row => row.method === 'submit_command')
  console.log('recovery authorization', JSON.stringify({ before: before.items.length, after: after.items.length,
    commands: commands.length, state: result.state }))
  assert.deepEqual(after.items, before.items)
  assert.equal(after.world_revision, before.world_revision)
  assert.equal(commands.length, 0)
  assert.equal(result.state, 'withheld'); assert.match(result.message, /重新确认/)
  assert.doesNotMatch(result.message, /已忘掉|已删除/)
  assert.equal(JSON.parse(await readFile(file, 'utf8')).records[requestId].source, undefined)
  await f.restart(); await f.ready()
  assert.equal(f.trace.filter(row => row.method === 'submit_command').length, 0)
  assert.deepEqual((await f.world()).items, before.items)
})

for (const scenario of ['missing original', 'conditional original', 'judge unavailable', 'current frozen prefix', 'legacy frozen prefix', 'valid original'] as const)
test(`FIX-50 recovery real Core: ${scenario} is checked again before any saved deletion`, { skip }, async t => {
  const f = await fixture(t, { malformedDecision: scenario === 'judge unavailable' }), before = await f.world()
  const safe = '忘掉我喝茶的偏好。', full = scenario.includes('prefix') ? safe + '附加说明。'.repeat(3300) + '如果会删除来源原文就先别执行。'
    : scenario === 'conditional original' ? safe + '如果会删除来源原文就先别执行。' : safe
  const requestId = 'memory-tool:' + createHash('sha256').update(scenario).digest('hex')
  const record: any = { requestId, name: 'memory_forget', arguments: { query: '我喝茶的偏好' }, sessionId: 'old-saved', modelTier: 'cloud',
    source: { text: full.slice(0, 16000), ...(scenario === 'missing original' ? {} : { message: { content: full } }) },
    scope: { isForgetRequest: true, subject: 'self', topic: '我喝茶的偏好', conditionsOrQuestions: false, authorized: true } }
  if (scenario.includes('frozen')) {
    record.plan = await f.manager.planForget(owner, { ...record, source: { text: safe, message: { content: safe } } })
    assert.equal(record.plan.completionState, 'complete')
    if (scenario === 'legacy frozen prefix') delete record.plan.completionVersion
  }
  await f.manager.close()
  const file = path.join(f.root, 'accounts', owner, 'memory-home', 'pending-actions.json')
  await writeFile(file, JSON.stringify({ records: { [requestId]: record } }))
  const decisionsBefore = f.trace.filter(row => row.modelDecision === 'classify_forget_request').length
  await f.restart(); await f.ready()
  const result = await wait(async () => JSON.parse(await readFile(file, 'utf8')).records[requestId].result)
  const after = await f.world(), valid = scenario === 'valid original'
  assert.equal(result.state, valid ? 'applied' : 'withheld')
  assert.equal(f.trace.filter(row => row.method === 'submit_command').length, valid ? 1 : 0)
  if (valid) {
    assert.equal(after.items.length, 0)
    assert.equal(f.trace.filter(row => row.modelDecision === 'classify_forget_request').length, decisionsBefore + 1)
  } else {
    assert.deepEqual(after.items, before.items); assert.equal(after.world_revision, before.world_revision)
    assert.match(result.message, /重新确认/); assert.doesNotMatch(result.message, /已忘掉|已删除/)
  }
  const saved = JSON.parse(await readFile(file, 'utf8')).records[requestId]
  assert.equal(saved.source, undefined); assert.equal(saved.scope, undefined)
  if (!valid) {
    const repeated = await f.manager.mutateFromTool(owner, { ...record, source: { text: safe, message: { content: safe } } })
    assert.equal(repeated.state, 'withheld', 'A new body under an old identity cannot replace the saved rejection')
    assert.equal(f.trace.filter(row => row.method === 'submit_command').length, 0)
  }
})

for (const committed of [true, false]) test(`FIX-50 recovery real Core: a ${committed ? 'committed' : 'unconfirmed'} frozen command is checked by receipt without replay`, { skip }, async t => {
  const f = await fixture(t), safe = '忘掉我喝茶的偏好。'
  const record: any = { requestId: 'memory-tool:' + createHash('sha256').update('committed-old').digest('hex'), name: 'memory_forget',
    arguments: { query: '我喝茶的偏好' }, source: { text: safe, message: { content: safe } }, sessionId: 'old-committed', modelTier: 'cloud',
    scope: { authorized: true, subject: 'self', topic: '我喝茶的偏好' } }
  record.plan = await f.manager.planForget(owner, record)
  const target = record.plan.worldTargets[0], key = `${target.kind}:${target.id}`
  const command = { requestId: 'old-committed-command', operation: 'delete_world_item', targetKind: target.kind, targetId: target.id,
    expectedWorldRevision: record.plan.worldRevision, payload: { forget_scope: record.plan.forgetScopes[key] } }
  if (committed) {
    const receipt = await f.manager.submitCommand(owner, command)
    assert.equal(receipt.receipt.result_state, 'applied')
  }
  record.commands = { [key]: command }
  await f.manager.close()
  const file = path.join(f.root, 'accounts', owner, 'memory-home', 'pending-actions.json')
  await writeFile(file, JSON.stringify({ records: { [record.requestId]: record } }))
  const decisions = f.decisions
  await f.restart(); await f.ready()
  if (!committed) {
    const pending = await f.manager.mutateFromTool(owner, record)
    assert.equal(pending.state, 'queued'); assert.match(pending.message, /未能确认/)
    assert.doesNotMatch(pending.message, /没有执行遗忘|没有删除记忆/)
    assert.equal(f.trace.filter(row => row.method === 'submit_command').length, 0)
    const saved = JSON.parse(await readFile(file, 'utf8')).records[record.requestId]
    assert.deepEqual(saved.commands, record.commands); assert.equal(saved.result, undefined)
    // Simulate the original in-flight command's late commit. Recovery itself
    // must only query this identity, not dispatch it to discover its outcome.
    await f.manager.submitCommand(owner, command)
    assert.equal((await f.manager.mutateFromTool(owner, record)).state, 'partial')
  }
  const result = await wait(async () => JSON.parse(await readFile(file, 'utf8')).records[record.requestId].result)
  assert.equal(result.state, 'partial'); assert.match(result.message, /原请求已执行.*没有继续删除/)
  assert.equal(f.trace.filter(row => row.method === 'submit_command').length, 1)
  assert.equal(f.decisions, decisions, 'An existing command is settled from its receipt, not a new authorization')
  assert.equal((await f.world()).items.length, 0)
})

test('FIX-50 G7 M7 real Core: forgetting blue preserves the independent walking source in the same recall candidates', { skip }, async t => {
  const walkingText = '我喜欢喝红茶。另记一件独立的事：我周末喜欢散步。'
  const blueText = '记住我喜欢蓝色'
  const f = await fixture(t, { seedText: walkingText, interpret: payload => {
    const evidence = payload.evidence[0]
    return { schema_version: 8, result: 'cognitions', cognitions: [{ action: 'form', target: 'owner_self',
      statement_kind: 'preference', formed_by: 'stated', proposition: evidence.text.includes('散步') ? '用户周末喜欢散步。' : '用户记住我喜欢蓝色',
      supports: evidence.segments.map((segment: any) => ({ evidence_id: evidence.id, segment_id: segment.id })) }] }
  } })
  await f.manager.ingest(owner, boundary(blueText, 'g7-blue'))
  await f.ready()
  const before = (await f.world()).items
  const walking = before.find((item: any) => item.value.content.includes('散步'))
  const blue = before.find((item: any) => item.value.content.includes('蓝色'))
  assert.ok(walking); assert.ok(blue)
  const sources = await f.manager.query(owner, 'query_evidence', { operation: 'list' })
  const walkingSource = sources.evidence.find((item: any) => item.raw_content === walkingText)
  const blueSource = sources.evidence.find((item: any) => item.raw_content === blueText)
  assert.ok(walkingSource); assert.ok(blueSource)
  // Fix the observed G7 recall projection, keeping actual World, provenance,
  // commands, receipts and persistence in the real Core. Recall may nominate
  // both topics; that nomination is never deletion authorization.
  const query = f.manager.query.bind(f.manager)
  f.manager.query = async (ownerId: string, method: string, params: any) => {
    const value = await query(ownerId, method, params)
    if (method === 'preview_recall') {
      value.preview.selected_item_ids = [['cognition', walking.item_id], ['cognition', blue.item_id]]
      value.preview.recent_evidence = [walkingSource, blueSource].map((source: any) => ({ id: source.evidence_id, text: source.raw_content }))
      value.preview.pending_corrections = []
    }
    return value
  }
  const result = await f.tool('memory_forget', { query: '我喜欢蓝色' }, 'g7-blue-forget', '请忘掉我喜欢蓝色这件事')
  assert.equal(result.state, 'applied')
  const deletions = f.trace.filter((row: any) => row.method === 'submit_command' && row.params.command.operation.startsWith('delete_'))
  assert.equal(deletions.length, 1)
  assert.equal(deletions[0].params.command.operation, 'delete_world_item')
  assert.equal(deletions[0].params.command.target_id, blue.item_id)
  assert.equal(deletions[0].result.receipt.result_state, 'applied')
  const after = (await f.world()).items
  assert.ok(after.some((item: any) => item.item_id === walking.item_id), 'forgetting blue must preserve the independent walking item')
  assert.equal(after.some((item: any) => item.item_id === blue.item_id), false)
  const retained = await f.manager.query(owner, 'query_evidence', { operation: 'get', evidence_id: walkingSource.evidence_id })
  assert.equal(retained.evidence.raw_content, walkingText, 'the independent walking source stays intact')
  const removed = await f.manager.query(owner, 'query_evidence', { operation: 'get', evidence_id: blueSource.evidence_id })
  assert.equal(removed.evidence.currentness_state, 'evidence_deleted')
  assert.equal(removed.evidence.content_available, false)
  assert.equal(removed.evidence.raw_content, null)
  assert.equal(removed.evidence.summary, null)
  const deletedPath = `/personal/v1/memory/items/cognition/${blue.item_id}/sources`
  await assert.rejects(handlePersonalMemoryHttp({ manager: f.manager, ownerId: owner, pathname: deletedPath,
    url: new URL(deletedPath, 'http://memory'), request: { method: 'GET' }, readJson: async () => ({}) }), { code: 'NOT_FOUND' })
  const exported = JSON.stringify(await f.manager.portableExport(owner))
  assert.match(exported, /散步/); assert.doesNotMatch(exported, /蓝色/)
  await f.restart()
  assert.ok((await f.world()).items.some((item: any) => item.item_id === walking.item_id))
  assert.equal((await f.world()).items.some((item: any) => item.item_id === blue.item_id), false)
  assert.deepEqual(f.errors, [])
})

for (const scenario of ['with current fact', 'orphan only', 'saved v3 plan', 'saved v4 plan']) test(`M7 real Core: terminal unformed source is forgotten (${scenario})`, { skip }, async t => {
  let redId: string;
  const f = await fixture(t, { seedText: '我喜欢喝红茶。', interpret: payload => {
    const evidence = payload.evidence[0], green = evidence.text.includes('绿茶');
    return { schema_version: 8, result: 'cognitions', cognitions: [{ action: 'form',
      statement_kind: 'preference', formed_by: 'stated', proposition: evidence.text,
      supports: evidence.segments.map((segment: any) => ({ evidence_id: evidence.id, segment_id: segment.id })),
      ...(green ? { supersedes_cognition_id: redId, entity: { canonical_name: '绿茶', kind: 'topic', aliases: [] } }
        : { target: 'owner_self' }) }] }
  } })
  redId = (await f.world()).items[0].item_id
  await f.manager.ingest(owner, boundary('我其实更喜欢绿茶。', 'unformed-green')); await f.ready()
  const jobs = await f.manager.query(owner, 'query_jobs', { operation: 'list' })
  assert.ok(jobs.jobs.some(row => row.core_terminal?.world_result?.reason === 'supersession_target_entity_mismatch'))
  const sources = await f.manager.query(owner, 'query_evidence', { operation: 'list' })
  const greenSource = sources.evidence.find(row => row.raw_content === '我其实更喜欢绿茶。')
  assert.ok(greenSource?.content_available)
  assert.equal((await f.world()).items.some(row => row.value.content.includes('绿茶')), false)
  if (scenario === 'orphan only') {
    const before = await f.world()
    const path = `/personal/v1/memory/items/cognition/${redId}`
    await handlePersonalMemoryHttp({ manager: f.manager, ownerId: owner, pathname: path,
      url: new URL(path, 'http://memory'), request: { method: 'DELETE' },
      readJson: async () => ({ requestId: 'remove-prior-red', expectedWorldRevision: before.world_revision }) })
    assert.equal((await f.world()).items.length, 0)
  }
  await f.manager.ingest(owner, boundary('我周末喜欢散步。', 'independent-walk')); await f.ready()
  if (scenario.startsWith('saved v')) {
    const snapshot = await f.world(), red = snapshot.items.find(row => row.item_id === redId)
    const authorization = { authorized: true, isForgetRequest: true, subject: 'self', topic: '我喝茶的偏好', conditionsOrQuestions: false }
    const requestId = 'memory-tool:' + createHash('sha256').update('saved-v3-unformed').digest('hex')
    const text = '请忘掉我喝茶的偏好。'
    await f.manager.close()
    await writeFile(path.join(f.root, 'accounts', owner, 'memory-home/pending-actions.json'), JSON.stringify({ records: {
      [requestId]: { requestId, name: 'memory_forget', arguments: { query: authorization.topic }, sessionId: 'saved-v3', modelTier: 'cloud',
        source: { text, message: { content: text, message_id: 'saved-v3-user' } }, scope: authorization,
        plan: { version: 2, completionVersion: scenario === 'saved v4 plan' ? 4 : 3, completionState: 'complete', worldRevision: snapshot.world_revision,
          authorization, authorizedEvidenceIds: red.provenance.map(source => source.evidence_id), evidenceIds: [],
          worldTargets: [{ kind: 'cognition', id: redId }], affectedIds: [redId], sourceTexts: ['我喜欢喝红茶。'] } },
    } }))
    await f.restart(); await f.ready()
    const saved = await wait(async () => {
      const row = JSON.parse(await readFile(path.join(f.root, 'accounts', owner, 'memory-home/pending-actions.json'), 'utf8')).records[requestId]
      return row.result ? row : null
    })
    assert.equal(saved.result.state, 'withheld', 'upgrading proof must not add the newly discovered source to an old deletion plan')
    assert.equal(f.trace.filter(row => row.method === 'submit_command').length, 0)
    assert.equal((await f.manager.query(owner, 'query_evidence', { operation: 'get', evidence_id: greenSource.evidence_id })).evidence.content_available, true)
    assert.ok((await f.world()).items.some(row => row.item_id === redId))
    return
  }
  const result = await f.tool('memory_forget_request', {}, 'forget-unformed', '请忘掉我喝茶的偏好。')
  assert.equal(result.state, 'applied')
  const retained = await f.manager.query(owner, 'query_evidence', { operation: 'get', evidence_id: greenSource.evidence_id })
  assert.equal(retained.evidence.content_available, false, 'a completion receipt must cover the terminal no_change source')
  assert.equal(retained.evidence.raw_content, null)
  assert.ok((await f.world()).items.some(row => row.value.content.includes('散步')))
  const exported = JSON.stringify(await f.manager.portableExport(owner))
  assert.doesNotMatch(exported, /红茶|绿茶/); assert.match(exported, /散步/)
  await f.restart()
  assert.equal((await f.manager.query(owner, 'query_evidence', { operation: 'get', evidence_id: greenSource.evidence_id })).evidence.content_available, false)
  assert.deepEqual(f.errors, [])
})

async function mixedCompletionFixture(t: any, walkingOnly = false) {
  const mixed = '我喜欢喝红茶。另记一件独立的事：我周末喜欢散步。'
  const f = await fixture(t, { seedText: '记住我喜欢喝红茶', interpret: payload => {
    const evidence = payload.evidence[0], statements = evidence.text.includes('散步')
      ? [...walkingOnly ? [] : ['用户喜欢喝红茶。'], '用户周末喜欢散步。'] : ['用户' + evidence.text]
    return { schema_version: 8, result: 'cognitions', cognitions: statements.map(proposition => ({ action: 'form', target: 'owner_self',
      statement_kind: 'preference', formed_by: 'stated', proposition,
      supports: evidence.segments.map((segment: any) => ({ evidence_id: evidence.id, segment_id: segment.id })) })) }
  } })
  await f.manager.ingest(owner, boundary(mixed, 'm3-mixed-source')); await f.ready()
  const before = await f.world(), old = before.items.find((row: any) => row.value.content.includes('记住'))
  assert.ok(old)
  const correction = await f.tool('memory_correct', { kind: 'cognition', id: old.item_id,
    expectedWorldRevision: before.world_revision, text: '我其实更喜欢绿茶。', sourceQuote: '我其实更喜欢绿茶。' },
  'm3-correct', '我其实更喜欢绿茶。')
  assert.equal(correction.state, 'applied'); await f.ready()
  const snapshot = await f.world(), current = snapshot.items.find((row: any) => row.current_state === 'current' && row.value.content.includes('绿茶'))
  const walking = snapshot.items.find((row: any) => row.value.content.includes('散步'))
  const evidence = await f.manager.query(owner, 'query_evidence', { operation: 'list' })
  const source = evidence.evidence.find((row: any) => row.raw_content === mixed)
  assert.ok(current); assert.ok(walking); assert.ok(source)
  return { f, mixed, source, current, walking, snapshot }
}

test('FIX-50 M3 safe real Core: known mixed sources withhold page and topic deletion before any command', { skip }, async t => {
  const { f, mixed, source, current, walking, snapshot } = await mixedCompletionFixture(t)
  const path = `/personal/v1/memory/items/cognition/${current.item_id}`
  const decisions = f.decisions
  const preview = await handlePersonalMemoryHttp({ manager: f.manager, ownerId: owner, pathname: path + '/forget-preview',
    url: new URL(path + '/forget-preview', 'http://memory'), request: { method: 'GET' } })
  assert.equal(preview.status, 200); assert.equal(f.decisions, decisions, 'GET preview must not ask a model')
  const topic = await f.tool('memory_forget', { query: '我喝茶的偏好' }, 'm3-safe-topic', '请忘掉我喝茶的偏好。')
  assert.equal(topic.state, 'withheld'); assert.doesNotMatch(topic.message, /已忘掉|已删除关于/)
  const response = await handlePersonalMemoryHttp({ manager: f.manager, ownerId: owner, pathname: path,
    url: new URL(path, 'http://memory'), request: { method: 'DELETE' },
    readJson: async () => ({ requestId: 'm3-safe-page', expectedWorldRevision: snapshot.world_revision }) })
  assert.equal(response.status, 409); assert.equal(response.body.state, 'withheld'); assert.equal(response.body.receipt, undefined)
  assert.equal(f.trace.filter((row: any) => row.method === 'submit_command' && row.params.command.operation.startsWith('delete_')).length, 0)
  const after = await f.world(); assert.equal(after.world_revision, snapshot.world_revision)
  assert.ok(after.items.some((row: any) => row.item_id === current.item_id)); assert.ok(after.items.some((row: any) => row.item_id === walking.item_id))
  const retained = await f.manager.query(owner, 'query_evidence', { operation: 'get', evidence_id: source.evidence_id })
  assert.equal(retained.evidence.raw_content, mixed); assert.equal(retained.evidence.summary, mixed)
  const exported = JSON.stringify(await f.manager.portableExport(owner)); assert.match(exported, /红茶/); assert.match(exported, /散步/)
  assert.deepEqual(f.errors, [])
})

test('FIX-50 M3 safe real Core: a legacy applied receipt stays partial and is never replayed', { skip }, async t => {
  const { f, mixed, source, walking } = await mixedCompletionFixture(t)
  const id = 'm3-legacy-partial', requestId = 'memory-tool:' + createHash('sha256').update(id).digest('hex')
  const scope = { authorized: true, subject: 'self', topic: '我喝茶的偏好' }
  const action: any = { requestId, name: 'memory_forget', arguments: { query: scope.topic }, scope,
    sessionId: id, modelTier: 'cloud', source: { text: '请忘掉我喝茶的偏好。' } }
  const plan = await f.manager.planForget(owner, action)
  assert.ok(plan.retainedUncertainCount > 0); assert.equal(plan.worldTargets.length, 1)
  const target = plan.worldTargets[0], key = `${target.kind}:${target.id}`
  const command = { requestId: 'm3-already-applied', operation: 'delete_world_item', targetKind: target.kind,
    targetId: target.id, expectedWorldRevision: plan.worldRevision, payload: { forget_scope: plan.forgetScopes[`${target.kind}:${target.id}`] } }
  const committed = await f.manager.submitCommand(owner, command), receipt = committed.receipt ?? committed
  assert.equal(receipt.result_state, 'applied')
  const originalReceipt = { commandId: receipt.command_id, state: receipt.result_state, revision: receipt.after_revision }
  await f.manager.close()
  const file = path.join(f.root, 'accounts', owner, 'memory-home', 'pending-actions.json')
  const stored = JSON.parse(await readFile(file, 'utf8'))
  stored.records[requestId] = { ...action, plan: { ...plan, nextRevision: receipt.after_revision },
    finished: [key], commands: { [key]: command } }
  await writeFile(file, JSON.stringify(stored)); await f.restart()
  const result = await f.tool('memory_forget', { query: scope.topic }, id, '请忘掉我喝茶的偏好。')
  assert.equal(result.state, 'partial'); assert.match(result.message, /部分|还没完全|尚未完全|不能确认已完全/)
  assert.doesNotMatch(result.message, /^已忘掉|已删除关于/)
  await f.restart(); await f.ready()
  const replayed = await f.tool('memory_forget', { query: scope.topic }, id, '请忘掉我喝茶的偏好。')
  assert.equal(replayed.state, 'partial')
  const deletions = f.trace.filter((row: any) => row.method === 'submit_command' && row.params.command.operation.startsWith('delete_'))
  assert.equal(deletions.length, 1)
  const actual = await f.manager.receiptByRequest(owner, command.requestId), actualReceipt = actual.receipt ?? actual
  assert.deepEqual({ commandId: actualReceipt.command_id, state: actualReceipt.result_state, revision: actualReceipt.after_revision }, originalReceipt)
  const after = await f.world(); assert.equal(after.world_revision, receipt.after_revision)
  assert.ok(after.items.some((row: any) => row.item_id === walking.item_id))
  assert.equal((await f.manager.query(owner, 'query_evidence', { operation: 'get', evidence_id: source.evidence_id })).evidence.raw_content, mixed)
  assert.match(JSON.stringify(await f.manager.portableExport(owner)), /红茶/)
  assert.deepEqual(f.errors, [])
})

test('FIX-50 M3 safe real Core: summary-only source projection still prevents a complete forgetting claim', { skip }, async t => {
  const { f, mixed, source, snapshot } = await mixedCompletionFixture(t, true)
  const query = f.manager.query.bind(f.manager)
  // Restrict only the read projection to isolate summary handling. The actual
  // Core record is not edited; raw/summary/export are verified intact below.
  f.manager.query = async (ownerId: string, method: string, params: any) => {
    const result = await query(ownerId, method, params), projected = structuredClone(result)
    if (method === 'query_world') for (const row of projected.items ?? []) for (const item of row.provenance ?? [])
      if (item.evidence_id === source.evidence_id) item.evidence.raw_content = null
    if (method === 'query_evidence' && params.evidence_id === source.evidence_id) projected.evidence.raw_content = null
    if (method === 'preview_recall') { projected.preview.recent_evidence = []; projected.preview.pending_corrections = [] }
    return projected
  }
  const result = await f.tool('memory_forget', { query: '我喝茶的偏好' }, 'm3-summary-only', '请忘掉我喝茶的偏好。')
  assert.equal(result.state, 'withheld')
  assert.ok(f.decisionInputs.some(input => input.candidates.some((row: any) => row.key === `evidence:${source.evidence_id}` && row.sourceTexts.includes(mixed))))
  assert.equal(f.trace.filter((row: any) => row.method === 'submit_command' && row.params.command.operation.startsWith('delete_')).length, 0)
  const retained = await query(owner, 'query_evidence', { operation: 'get', evidence_id: source.evidence_id })
  assert.equal(retained.evidence.raw_content, mixed); assert.equal(retained.evidence.summary, mixed)
  assert.equal((await f.world()).world_revision, snapshot.world_revision)
  assert.match(JSON.stringify(await f.manager.portableExport(owner)), /红茶/)
  assert.deepEqual(f.errors, [])
})

test('FIX-50 M7 real Core: a wrong question-only nomination cannot delete that question or report the preference forgotten', { skip }, async t => {
  const f = await fixture(t, { wrongQuestionOnly: true })
  f.reject(true)
  await f.manager.ingest(owner, boundary('根据我的记忆，我喝茶的偏好是什么？', 'm7-prior-question'))
  const question = await wait(async () => (await f.manager.query(owner, 'query_evidence', { operation: 'list' })).evidence
    .find((row: any) => /根据我的记忆/.test(row.raw_content)))
  // Freeze the observed wrong recall candidate while retaining the actual Core
  // Evidence, deletion commands and receipts. The synthetic judge nominates only
  // this question, so deleting it must never count as forgetting the preference.
  const query = f.manager.query.bind(f.manager)
  f.manager.query = async (ownerId: string, method: string, params: any) => {
    const value = await query(ownerId, method, params)
    if (method === 'preview_recall') value.preview.recent_evidence = [{ id: question.evidence_id, text: question.raw_content }]
    return value
  }
  const result = await f.tool('memory_forget', { query: '喝茶的偏好' }, 'm7-wrong-candidate', '请忘掉我喝茶的偏好。')
  assert.notEqual(result.state, 'applied')
  assert.ok(f.decisionInputs.some(input => input.candidates.some((candidate: any) => /根据我的记忆/.test(candidate.text))), 'the fixed wrong candidate path must actually be exercised')
  assert.ok((await f.world()).items.some((row: any) => /乌龙茶/.test(row.value.content)))
  const kept = await f.manager.query(owner, 'query_evidence', { operation: 'get', evidence_id: question.evidence_id })
  assert.match(kept.evidence.raw_content, /根据我的记忆/)
})

test('Core capability: source correction applies only with advertised support', { skip }, async t => {
  const f = await fixture(t)
  const supported = await f.manager.correctionSourceSupported(owner)
  const before = (await f.world()).items[0]
  const result = await f.tool('memory_correct', { kind: 'cognition', id: before.item_id,
    expectedWorldRevision: 1, text: '模型改写的红茶偏好', sourceQuote: '我现在喜欢红茶。' }, 'source-capability', '我现在喜欢红茶。')
  assert.equal(result.state, supported ? 'applied' : 'unsupported')
  const after = (await f.world()).items
  if (supported) assert.ok(after.some((row: any) => row.current_state === 'current' && row.value.content === '用户现在喜欢红茶。'))
  else assert.equal(after.find((row: any) => row.item_id === before.item_id).current_state, 'current')
  assert.equal((await f.manager.query(owner, 'query_evidence', { operation: 'list' })).evidence.some((row: any) => row.raw_content === '模型改写的红茶偏好'), false)
})

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

test('FIX-50 M3 page: preview and one atomic command forget every revision and source while another topic survives', { skip }, async t => {
  const f = await fixture(t)
  const old = (await f.world()).items[0]
  await f.tool('memory_correct', { kind: 'cognition', id: old.item_id, expectedWorldRevision: 1, text: '我现在喜欢红茶。' }, 'm3-correct', '纠正我的喝茶偏好为红茶。')
  await f.ready()
  await f.manager.ingest(owner, boundary('我每周五去游泳。', 'm3-independent')); await f.ready()
  const before = (await f.world()).items
  const chain = before.filter((row: any) => /茶/.test(row.value.content))
  const current = chain.find((row: any) => row.current_state === 'current')
  assert.ok(chain.length >= 2)
  const http = (pathname: string, method = 'GET', body: any = {}) => handlePersonalMemoryHttp({ manager: f.manager, ownerId: owner,
    pathname: new URL(pathname, 'http://memory').pathname, url: new URL(pathname, 'http://memory'), request: { method }, readJson: async () => body })
  const path = `/personal/v1/memory/items/cognition/${current.item_id}`
  const preview = (await http(path + '/forget-preview')).body
  assert.ok(chain.every((row: any) => preview.items.some((item: any) => item.id === row.item_id)))
  const forgotten = await http(path, 'DELETE', { requestId: 'm3-page-chain', expectedWorldRevision: preview.worldRevision, forgetScope: preview.forgetScope })
  assert.equal(forgotten.body.receipt.state, 'applied')
  for (const row of chain) {
    await assert.rejects(http(`/personal/v1/memory/items/cognition/${row.item_id}`), { status: 404 })
    await assert.rejects(http(`/personal/v1/memory/items/cognition/${row.item_id}/sources`), { status: 404 })
  }
  assert.ok((await f.world()).items.some((row: any) => /游泳/.test(row.value.content)))
  assert.doesNotMatch(JSON.stringify((await http('/personal/v1/memory/export?format=json')).body), /乌龙茶|红茶/)
})

test('FIX-50 real Core: a correction after authorization keeps the new revision and requires fresh confirmation', { skip }, async t => {
  const f = await fixture(t)
  const old = (await f.world()).items[0]
  const planForget = f.manager.planForget.bind(f.manager)
  f.manager.planForget = async (ownerId: string, action: any) => {
    const plan = await planForget(ownerId, action)
    const changed = await f.manager.submitCommand(ownerId, { requestId: 'after-forget-preview', expectedWorldRevision: plan.worldRevision,
      operation: 'correct_world_item', targetKind: 'cognition', targetId: old.item_id, payload: { correction_text: '我现在喜欢红茶。' } })
    assert.equal(changed.receipt.result_state, 'applied')
    return plan
  }
  const result = await f.tool('memory_forget', { query: '我的喝茶偏好' }, 'stale-forget-preview', '忘掉我的喝茶偏好。')
  assert.equal(result.state, 'withheld')
  await f.ready()
  const after = (await f.world()).items
  assert.ok(after.some((row: any) => /红茶/.test(row.value.content) && row.current_state === 'current'))
  assert.ok(after.some((row: any) => row.item_id === old.item_id), 'the old chain also remains intact after a stale authorization')
})

async function pluginForget(manager: any, text: string, durableOnly = false) {
  const child = fork(new URL('fixtures/personal-memory-plugin-child.mjs', import.meta.url), ['--protocol-only'], {
    env: { ...process.env, WEFTMATE_PERSONAL_MEMORY_ENABLED: '1' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
  })
  const tools: any[] = []
  try {
    const result: any = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('explicit forget hook timeout')), 30000)
      child.on('message', async (message: any) => {
        if (message.type === 'ready') child.send({ type: 'run-forget', text, durableOnly })
        else if (message.type === 'result' || message.type === 'failed') {
          clearTimeout(timer); message.type === 'result' ? resolve(message) : reject(Error(message.error))
        } else if (message.protocol === 'weftmate.personal-memory.v1') {
          try {
            let value
            if (message.action === 'tool') {
              tools.push(message.tool)
              value = await handlePersonalMemoryTool(manager, owner, message.tool,
                { sessionId: message.sessionId, modelTier: 'cloud', memoryPolicy: { recall: true } })
            } else value = await manager.recall(owner, { query: message.query, sessionId: message.sessionId, modelTier: 'cloud' })
            child.send({ protocol: message.protocol, id: message.id, ok: true, result: value })
          } catch { child.send({ protocol: message.protocol, id: message.id, ok: false, error: { code: 'MEMORY_UNAVAILABLE' } }) }
        }
      })
      child.once('error', reject)
    })
    return { result, tools }
  } finally { child.kill() }
}

test('FIX-50 real Core: an explicit forget deletes correction history and source HTTP content without a model tool call', { skip }, async t => {
  const f = await fixture(t)
  const old = (await f.world()).items[0]
  assert.equal((await f.tool('memory_correct', { kind: 'cognition', id: old.item_id, expectedWorldRevision: 1,
    text: '我喝茶的偏好是红茶。' }, 'fix50-correct', '纠正我喝茶的偏好为红茶。')).state, 'applied')
  await f.ready()
  const before = (await f.world()).items
  assert.ok(before.length >= 2)
  const sources = async (id: string) => {
    const pathname = `/personal/v1/memory/items/cognition/${id}/sources`
    return handlePersonalMemoryHttp({ manager: f.manager, ownerId: owner, pathname,
      url: new URL(pathname, 'http://memory'), request: { method: 'GET' }, readJson: async () => ({}) })
  }
  for (const row of before) assert.ok((await sources(row.item_id)).body.sources.some((s: any) => s.contentAvailable))
  // The Core-only CI job has no DSH installation. Only message construction is
  // a wire-shape fixture here; personal-forget-loop runs the native DSH loop.
  const { result, tools } = await pluginForget(f.manager, '忘掉我喝茶的偏好，另外请计算12×13。')
  {
    assert.equal(tools.length, 1, 'the host must execute forgetting once before inference, even with no model tool call')
    assert.equal(tools[0].name, 'memory_forget_request')
    assert.deepEqual(tools[0].arguments, {})
    assert.equal(tools[0].source.text, '忘掉我喝茶的偏好，另外请计算12×13。\n另外请计算12×13。')
    assert.equal((await f.world()).items.length, 0)
    for (const row of before) await assert.rejects(sources(row.item_id), { code: 'NOT_FOUND', status: 404 })
    const replies = result.events.filter((e: any) => e.type === 'assistant/message').map((e: any) =>
      e.data.message.content.map((p: any) => p.text).join('')).join('\n')
    assert.match(replies, /156/)
    assert.match(replies, /已.*(?:删|忘).*喝茶/)
    assert.match(JSON.stringify(result.first.messages), /已.*(?:删|忘)/, 'the model receives the actual deletion result')
    await f.restart()
    assert.doesNotMatch((await f.manager.recall(owner, { query: '我喜欢喝什么茶', sessionId: 'fix50-fresh', modelTier: 'cloud' })).contextText, /乌龙茶|红茶/)
  }
})

test('FIX-50 real Core: forgetting by topic also finds already non-current memories', { skip }, async t => {
  const f = await fixture(t)
  const plan = f.manager.planForget.bind(f.manager)
  f.manager.planForget = async (...args: any[]) => {
    try { return await plan(...args) }
    catch (error: any) { f.trace.push({ phase: 'non-current-forget-plan', error: { code: error.code, message: error.message } }); throw error }
  }
  const old = (await f.world()).items[0]
  assert.equal((await f.tool('memory_correct', { kind: 'cognition', id: old.item_id, expectedWorldRevision: 1,
    text: '我喝茶的偏好是红茶。' }, 'fix50-old-correct', '纠正我喝茶的偏好为红茶。')).state, 'applied')
  const current = (await f.world()).items.find((row: any) => row.current_state === 'current')
  await f.manager.submitCommand(owner, { requestId: 'fix50-retract', operation: 'retract_world_item', targetKind: 'cognition',
    targetId: current.item_id, payload: {}, expectedWorldRevision: (await f.manager.status(owner)).worldRevision })
  assert.ok((await f.world()).items.every((row: any) => row.current_state !== 'current'))
  const result = await f.tool('memory_forget', { query: '我喝茶的偏好' }, 'fix50-legacy-forget', '忘掉我喝茶的偏好')
  assert.equal(result.state, 'applied')
  assert.equal((await f.world()).items.length, 0, 'non-current items must disappear from memory pages too')
})

for (const [name, input] of [
  ['condition', '忘掉我喝茶的偏好，如果会删除来源原文就先别执行。'],
  ['question', '忘掉我喝茶的偏好，会删除哪些数据？'],
  ['translation', '请把下面这句话翻译成英文：\n忘掉我喝茶的偏好。'],
  ['durable long condition', '忘掉我喝茶的偏好，' + '请留意完整上下文。'.repeat(70) + '如果会删除来源原文就先别执行。'],
]) test(`FIX-50 review real Core: ${name} does not authorize deletion`, { skip }, async t => {
  const f = await fixture(t), old = (await f.world()).items[0]
  await f.tool('memory_correct', { kind: 'cognition', id: old.item_id, expectedWorldRevision: 1,
    text: '我喝茶的偏好是红茶。' }, 'review-tea-correct', '纠正我喝茶的偏好为红茶。')
  const before = (await f.world()).items.map((row: any) => row.item_id)
  const { result } = await pluginForget(f.manager, input, name === 'durable long condition')
  assert.deepEqual((await f.world()).items.map((row: any) => row.item_id), before,
    'the whole message must authorize deletion, including its task, question and conditions')
  assert.match(JSON.stringify(result.first.messages), /没有提交或排队/)
})

for (const [subject, misattribute, legacyPlan] of [['我的', false, false], ['妈妈的', false, false], ['我的', true, false], ['我的', false, true]] as const) test(`FIX-50 review real Core: forgetting ${subject} birthday preserves everyone else${misattribute ? ' even when the selector misattributes others' : ''}${legacyPlan ? ' when resuming an old unscoped plan' : ''}`, { skip }, async t => {
  const f = await fixture(t, { misattribute, birthdayContract: true, interpret: payload => {
    const e = payload.evidence[0]
    if (!e.text.includes('生日')) return null
    const person = e.text.startsWith('妈妈') ? '妈妈' : e.text.startsWith('同事') ? '同事小王' : null
    return { schema_version: 8, result: 'cognitions', cognitions: [{ action: 'form', target: 'owner_self',
      statement_kind: 'attribute', formed_by: 'stated', proposition: e.text,
      ...(person ? { entity: { canonical_name: person, kind: 'person' } } : {}),
      supports: e.segments.map((s: any) => ({ evidence_id: e.id, segment_id: s.id })) }] }
  } })
  for (const [id, text] of [['self', '我的生日是五月一日。'], ['mother', '妈妈的生日是六月一日。'], ['coworker', '同事小王的生日是七月一日。']]) {
    await f.manager.ingest(owner, boundary(text, 'review-birthday-' + id)); await f.ready()
  }
  const birthdays = (await f.world()).items.filter((row: any) => row.value.content.includes('生日'))
  assert.equal(birthdays.length, 3)
  const beforeWorld = (await f.world()).items
  const beforeRevision = (await f.manager.query(owner, 'query_world', { operation: 'revision' })).world_revision
  const sourceIds = [...new Set(birthdays.flatMap((row: any) => row.provenance.map((source: any) => source.evidence_id)))]
  const sourceBodies = async () => Promise.all(sourceIds.map(async evidence_id => {
    const { evidence } = await f.manager.query(owner, 'query_evidence', { operation: 'get', evidence_id })
    return { evidence_id, raw: evidence.raw_content, summary: evidence.summary, available: evidence.content_available, state: evidence.currentness_state }
  }))
  const beforeSources = await sourceBodies()
  const deleteCount = () => f.trace.filter(row => row.method === 'submit_command' && row.params.command.operation.startsWith('delete_')).length
  const beforeDeletes = deleteCount()
  if (legacyPlan) f.offline(true)
  let result = await f.tool('memory_forget', { query: subject + '生日' }, 'review-subject', '忘掉' + subject + '生日')
  if (legacyPlan) {
    assert.equal(result.state, 'queued')
    const file = path.join(f.root, 'accounts', owner, 'memory-home', 'pending-actions.json')
    const state = JSON.parse(await readFile(file, 'utf8')), row: any = Object.values(state.records).find((row: any) => row.name === 'memory_forget')
    delete row.scope
    // The legacy topic matcher nominated all birthday sources, including others.
    row.plan = { evidenceIds: [...new Set(birthdays.flatMap((row: any) => row.provenance.map((source: any) => source.evidence_id)))],
      worldTargets: [], affectedIds: [], sourceTexts: [] }
    await writeFile(file, JSON.stringify(state))
    await f.restart(); f.offline(false)
    result = await wait(async () => JSON.parse(await readFile(file, 'utf8')).records[row.requestId].result)
    assert.equal(result.state, 'withheld', 'a pre-upgrade plan without frozen item identities requires a fresh confirmation')
    assert.equal((await f.world()).items.filter((row: any) => /生日/.test(row.value.content)).length, 3)
    result = await f.tool('memory_forget', { query: subject + '生日' }, 'review-subject-reconfirmed', '忘掉' + subject + '生日')
  }
  if (misattribute) {
    // Explicit safety-contract change from 84e: a valid-shaped model relation
    // contradicting Core stops the whole action, rather than deleting anyway.
    assert.equal(result.state, 'withheld')
    assert.match(result.message, /归属.*不能确认.*没有执行遗忘/)
    assert.equal(deleteCount(), beforeDeletes)
    assert.equal((await f.manager.query(owner, 'query_world', { operation: 'revision' })).world_revision, beforeRevision)
    assert.deepEqual((await f.world()).items, beforeWorld)
    assert.deepEqual(await sourceBodies(), beforeSources)
    const exchange = f.trace.find(row => row.modelDecision === 'classify_forget_candidates' && row.input.candidates.some((candidate: any) => candidate.graphSubject === 'other:妈妈'))
    assert.ok(exchange)
    const key = exchange.input.candidates.find((candidate: any) => candidate.graphSubject === 'other:妈妈').key
    const wrong = exchange.result.items.find((item: any) => item.key === key)
    assert.deepEqual(wrong.subjects, ['self']); assert.deepEqual(wrong.targetSubjects, ['self']); assert.equal(wrong.sourceFullyAuthorized, true)
    return
  }
  assert.equal(result.state, 'applied')
  assert.match(result.message, /还有 2 条关于别人的没动/)
  const remaining = (await f.world()).items.map((row: any) => row.value.content).join('\n')
  assert.doesNotMatch(remaining, subject === '我的' ? /五月一日/ : /六月一日/)
  assert.match(remaining, subject === '我的' ? /六月一日/ : /五月一日/)
  assert.match(remaining, /七月一日/)
  const target = birthdays.find((row: any) => row.value.content.includes(subject === '我的' ? '五月一日' : '六月一日'))
  const deletedSources = new Set(target.provenance.map((source: any) => source.evidence_id))
  for (const retained of await sourceBodies()) {
    if (deletedSources.has(retained.evidence_id)) {
      assert.equal(retained.state, 'evidence_deleted'); assert.equal(retained.available, false)
      assert.equal(retained.raw, null); assert.equal(retained.summary, null)
    } else assert.deepEqual(retained, beforeSources.find(source => source.evidence_id === retained.evidence_id))
  }
})

test('FIX-50 review real Core: a source shared with another person is retained with an honest explanation', { skip }, async t => {
  const f = await fixture(t, { birthdayContract: true, interpret: payload => {
    const e = payload.evidence[0]
    if (!e.text.includes('生日')) return null
    return { schema_version: 8, result: 'cognitions', cognitions: [
      { action: 'form', target: 'owner_self', statement_kind: 'attribute', formed_by: 'stated', proposition: '我的生日是五月一日。',
        supports: e.segments.filter((s: any) => s.text.includes('五月')).map((s: any) => ({ evidence_id: e.id, segment_id: s.id })) },
      { action: 'form', target: 'owner_self', statement_kind: 'attribute', formed_by: 'stated', proposition: '妈妈的生日是六月一日。',
        entity: { canonical_name: '妈妈', kind: 'person' },
        supports: e.segments.filter((s: any) => s.text.includes('六月')).map((s: any) => ({ evidence_id: e.id, segment_id: s.id })) },
    ] }
  } })
  await f.manager.ingest(owner, boundary('我的生日是五月一日。妈妈的生日是六月一日。', 'shared-subjects')); await f.ready()
  const before = (await f.world()).items
  assert.equal(before.filter((row: any) => row.value.content.includes('生日')).length, 2)
  const revision = (await f.manager.query(owner, 'query_world', { operation: 'revision' })).world_revision
  const evidenceId = before.find((row: any) => row.value.content.includes('五月一日')).provenance[0].evidence_id
  const evidence = (await f.manager.query(owner, 'query_evidence', { operation: 'get', evidence_id: evidenceId })).evidence
  const beforeDeletes = f.trace.filter(row => row.method === 'submit_command' && row.params.command.operation.startsWith('delete_')).length
  const result = await f.tool('memory_forget', { query: '我的生日' }, 'forget-shared-self', '忘掉我的生日')
  assert.equal(result.state, 'withheld')
  assert.match(result.message, /没有执行遗忘.*独立记忆和原聊天保留/)
  assert.equal(f.trace.filter(row => row.method === 'submit_command' && row.params.command.operation.startsWith('delete_')).length, beforeDeletes)
  assert.equal((await f.manager.query(owner, 'query_world', { operation: 'revision' })).world_revision, revision)
  assert.deepEqual((await f.world()).items.map((row: any) => row.item_id), before.map((row: any) => row.item_id))
  const retained = (await f.manager.query(owner, 'query_evidence', { operation: 'get', evidence_id: evidenceId })).evidence
  assert.equal(retained.raw_content, evidence.raw_content); assert.equal(retained.summary, evidence.summary); assert.equal(retained.content_available, true)
})

test('FIX-50 review real Core: an unstructured judge reply never deletes or queues deletion', { skip }, async t => {
  const f = await fixture(t, { malformedDecision: true }), old = (await f.world()).items[0]
  await f.tool('memory_correct', { kind: 'cognition', id: old.item_id, expectedWorldRevision: 1,
    text: '我喝茶的偏好是红茶。' }, 'invalid-decision-setup', '纠正我喝茶的偏好为红茶。')
  const before = (await f.world()).items.map((row: any) => row.item_id)
  const { result } = await pluginForget(f.manager, '忘掉我喝茶的偏好。')
  assert.deepEqual((await f.world()).items.map((row: any) => row.item_id), before)
  assert.match(JSON.stringify(result.first.messages), /没有提交或排队/)
  const state = JSON.parse(await readFile(path.join(f.root, 'accounts', owner, 'memory-home', 'pending-actions.json'), 'utf8'))
  assert.equal(Object.values(state.records).some((row: any) => row.name === 'memory_forget'), false)
})

test('FIX-50 review real Core: owner topic labels do not become other people or separate deletion targets', { skip }, async t => {
  const f = await fixture(t, { interpret: payload => {
    const e = payload.evidence[0]
    return { schema_version: 8, result: 'cognitions', cognitions: [{ action: 'form', target: 'owner_self',
      statement_kind: 'preference', formed_by: 'stated', proposition: e.text,
      entity: { canonical_name: '茶', kind: 'topic', aliases: ['喝茶'] },
      supports: e.segments.map((s: any) => ({ evidence_id: e.id, segment_id: s.id })) }] }
  } })
  const labels = await f.manager.query(owner, 'query_world', { operation: 'list', object_kind: 'entity', include_history: true })
  assert.ok(labels.items.some((row: any) => row.value.kind === 'topic'))
  const result = await f.tool('memory_forget', { query: '我喝茶的偏好' }, 'forget-topic-label', '忘掉我喝茶的偏好。')
  assert.equal(result.state, 'applied')
  assert.equal((await f.world()).items.length, 0)
  const after = await f.manager.query(owner, 'query_world', { operation: 'list', object_kind: 'entity', include_history: true })
  assert.equal(after.items.some((row: any) => row.value.kind === 'topic'), false)
})

test('FIX-50 review real Core: exact ids cannot expose candidates when recall is off; owner page deletion remains available', { skip }, async t => {
  const f = await fixture(t), target = (await f.world()).items[0]
  const result = await handlePersonalMemoryTool(f.manager, owner, { name: 'memory_forget',
    arguments: { kind: 'cognition', id: target.item_id, expectedWorldRevision: 1 },
    requestId: 'memory-tool:' + createHash('sha256').update('no-recall-exact-id').digest('hex'),
    source: { id: 'no-recall-user', text: '忘掉我喝茶的偏好。' } },
    { sessionId: 'no-recall-session', modelTier: 'cloud', memoryPolicy: { recall: false } })
  assert.equal(result.state, 'withheld'); assert.match(result.message, /没有删除.*记忆页/)
  assert.equal(f.decisions, 0, 'no old fact may be sent to the judge when recall is disabled')
  assert.equal((await f.world()).items[0].item_id, target.item_id)
  const pathname = `/personal/v1/memory/items/cognition/${target.item_id}`
  const deleted = await handlePersonalMemoryHttp({ manager: f.manager, ownerId: owner, pathname, url: new URL(pathname, 'http://memory'),
    request: { method: 'DELETE' }, readJson: async () => ({ requestId: 'no-recall-page-delete', expectedWorldRevision: 1, forgetScope: await confirmedScope(f, 'cognition', target.item_id) }) })
  assert.equal(deleted.body.receipt.state, 'applied')
  assert.equal((await f.world()).items.length, 0)
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
  assert.equal((await f.manager.status(owner)).worldRevision, revision + 1, 'one authorized topic is one atomic Core commit')
  const deletions = f.trace.filter(row => row.method === 'submit_command' && row.params.command.operation.startsWith('delete_'))
  assert.equal(deletions.length, 1, 'no sequential re-preview or second deletion')
  assert.ok(deletions[0].params.command.payload.additional_targets.length)
  assert.doesNotMatch(await readFile(path.join(f.root, 'accounts', owner, 'memory-home', 'command-journal.json'), 'utf8'), /红茶|乌龙茶/)
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
  f.holdCorrections(true)
  let entered!: () => void, release!: () => void, held = false
  const started = new Promise<void>(resolve => { entered = resolve })
  const released = new Promise<void>(resolve => { release = resolve })
  const query = f.manager.query.bind(f.manager)
  const hook = t.mock.method(f.manager, 'query', async (...args: any[]) => {
    const result = await query(...args)
    if (!held && args[1] === 'query_world' && args[2]?.operation === 'revision') {
      held = true; entered(); await released
    }
    return result
  })
  try {
    f.offline(false); await f.manager.flushPending(owner); await started
    // The queued correction has read its old action but cannot checkpoint its
    // command until the real Core deletion and host redaction have completed.
    const deleted = await f.manager.submitCommand(owner, { requestId: 'delete-before-retry', operation: 'delete_world_item', targetKind: 'cognition',
      targetId: old.item_id, expectedWorldRevision: 1, payload: { forget_scope: await confirmedScope(f, 'cognition', old.item_id) } })
    assert.equal(deleted.receipt.result_state, 'applied')
  } finally { release(); hook.mock.restore() }
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
  await writeFile(path.join(f.root, 'action-diagnostics.json'), JSON.stringify(f.trace.filter(row => row.actionTrace)))
  async function noErasedCopies(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) await noErasedCopies(file)
      else {
        const bytes = await readFile(file)
        for (const text of ['我喜欢喝红茶。', '纠正为红茶。']) assert.equal(bytes.includes(Buffer.from(text)), false, `erased correction remains in ${entry.name}`)
        assert.equal(entry.name.endsWith('.tmp'), false, 'completed erasure must leave no pre-redaction temporary file')
      }
    }
  }
  const recall = await f.manager.recall(owner, { query: '我喜欢喝什么茶？', sessionId: 'after-deleted-restart', modelTier: 'cloud' })
  assert.doesNotMatch(recall.contextText, /乌龙茶|红茶/, 'the canceled correction must not restore forgotten content')
  assert.deepEqual(f.errors, [])
  // Core owns live SQLite/worker locks. Close it normally before inspecting all
  // files, including its database, logs and any leftover temporary preimages.
  await f.manager.close()
  await noErasedCopies(f.root)
})

test('review-486 real Core: late query selection with different correction text is erased across restart', { skip }, async t => {
  const f = await fixture(t), old = (await f.world()).items[0]
  const newText = '我的饮茶偏好现在是红茶。', newSource = '以后饮品换为红茶。'
  assert.notEqual(newText, old.value.content); assert.notEqual(newSource, old.value.content)
  f.holdCorrections(true)
  let entered!: () => void, release!: () => void, held = false, submitted = 0
  const started = new Promise<void>(resolve => { entered = resolve }), released = new Promise<void>(resolve => { release = resolve })
  const query = f.manager.query.bind(f.manager), submit = f.manager.submitCommand.bind(f.manager)
  t.mock.method(f.manager, 'query', async (...args: any[]) => {
    const result = await query(...args)
    if (!held && args[1] === 'preview_recall') {
      assert.ok(result.preview.selected_item_ids.some((pair: any[]) => pair[1] === old.item_id))
      held = true; entered(); await released
    }
    return result
  })
  t.mock.method(f.manager, 'submitCommand', async (...args: any[]) => {
    if (args[1].operation === 'correct_world_item') submitted++
    return submit(...args)
  })
  let pending
  try {
    pending = f.tool('memory_correct', { query: '我喜欢喝什么茶', text: newText }, 'late-query-selection', newSource)
    await started
    const deleted = await f.manager.submitCommand(owner, { requestId: 'erase-during-selection', operation: 'delete_world_item',
      targetKind: 'cognition', targetId: old.item_id, expectedWorldRevision: 1, payload: { forget_scope: await confirmedScope(f, 'cognition', old.item_id) } })
    assert.equal(deleted.receipt.result_state, 'applied')
    release(); await pending; await f.restart(); await f.manager.flushPending(owner); await f.manager.close()
    const hits: string[] = []
    async function scan(directory: string) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name)
        if (entry.isDirectory()) await scan(file)
        else {
          const bytes = await readFile(file)
          if ([newText, newSource].some(text => bytes.includes(Buffer.from(text)))) hits.push(entry.name)
          assert.equal(entry.name.endsWith('.tmp'), false)
        }
      }
    }
    await scan(f.root)
    console.log(JSON.stringify({ reproduction: 'real-core-different-source-selection', submitted, remainingFiles: hits.length }))
    assert.deepEqual(hits, []); assert.equal(submitted, 0)
    const rows = JSON.parse(await readFile(path.join(f.root, 'accounts', owner, 'memory-home/pending-actions.json'), 'utf8')).records
    const row = rows['memory-tool:' + createHash('sha256').update('late-query-selection').digest('hex')]
    assert.equal(row.result?.state, 'not_found'); assert.deepEqual(row.arguments, {}); assert.equal(row.command, undefined)
  } finally { release(); await pending }
})

test('review scope real Core: withdrawing an uncorrected source scrubs a pending deletion after restart', { skip, timeout: 30000 }, async t => {
  const text = '记住：我的合成收藏编号是Q486。'
  const f = await fixture(t, { seedText: text, cleanupDeletedMemory: async () => { throw Error('synthetic host cleanup unavailable') } })
  const world = await f.world(), old = world.items[0]
  const deleted = await f.manager.submitCommand(owner, { requestId: 'uncorrected-delete', operation: 'delete_world_item', targetKind: 'cognition', targetId: old.item_id, expectedWorldRevision: world.world_revision, payload: { forget_scope: await confirmedScope(f, 'cognition', old.item_id) } })
  assert.equal(deleted.receipt.result_state, 'applied'); assert.equal(deleted.receipt.storage_cleanup.state, 'pending')
  const file = path.join(f.root, 'accounts', owner, 'memory-home/command-journal.json')
  const initialMarker = JSON.parse(await readFile(file, 'utf8')).records['uncorrected-delete']
  assert.ok(initialMarker.cleanup.sourceTexts.includes(text))
  assert.equal(f.trace.filter(row => row.method === 'submit_command' && row.params.command.operation === 'correct_world_item').length, 0)
  await f.manager.discardPendingSources(owner, { sessionId: 'remember' })
  await assert.rejects(f.manager.eraseConversationContext(owner, 'remember'), /synthetic host cleanup unavailable/)
  await f.restart(); await f.manager.retryCleanupByRequest(owner, 'uncorrected-delete'); await f.manager.close()
  const hits: string[] = []
  async function scan(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const item = path.join(directory, entry.name)
      if (entry.isDirectory()) await scan(item)
      else {
        if ((await readFile(item)).includes(Buffer.from(text))) hits.push(entry.name)
        assert.equal(entry.name.endsWith('.tmp'), false)
      }
    }
  }
  await scan(f.root)
  console.log(JSON.stringify({ reproduction: 'uncorrected-pending-deletion', remainingFiles: hits.length }))
  assert.deepEqual(hits, [])
  assert.ok(initialMarker.cleanup.sourceRefs.some(ref => ref.evidenceId && ref.sessionIds.includes('remember') &&
    ref.textHash === createHash('sha256').update(text).digest('hex')), 'new deletion records must capture real source provenance before deletion')
  const marker = JSON.parse(await readFile(file, 'utf8')).records['uncorrected-delete']
  assert.deepEqual(marker.cleanup.sourceTexts, [])
  assert.equal(marker.command.command_id, deleted.receipt.command_id)
})

test('review-486 real Core: a later missing forget target cannot erase an already committed command identity', { skip, timeout: 30000 }, async t => {
  const f = await fixture(t), old = (await f.world()).items[0]
  const original = '请忘掉我喝茶的偏好。'
  t.mock.method(f.manager, 'planForget', async (_owner, action) => ({
    version: 2, completionVersion: 3, completionState: 'complete', worldRevision: 1, authorization: action.scope,
    worldTargets: [{ kind: 'cognition', id: old.item_id }, { kind: 'cognition', id: 'synthetic-missing-target' }],
    evidenceIds: [], sourceTexts: [original], forgetScopes: { [`cognition:${old.item_id}`]: await confirmedScope(f, 'cognition', old.item_id) },
  }))
  const result = await f.tool('memory_forget', { query: '我喝茶的偏好' }, 'partial-missing-target', original)
  assert.notEqual(result.state, 'not_found')
  const file = path.join(f.root, 'accounts', owner, 'memory-home/pending-actions.json')
  const requestId = 'memory-tool:' + createHash('sha256').update('partial-missing-target').digest('hex')
  const before = JSON.parse(await readFile(file, 'utf8')).records[requestId]
  const command = before.commands?.[`cognition:${old.item_id}`]
  assert.ok(command); assert.deepEqual(before.finished, [`cognition:${old.item_id}`])
  assert.equal((await f.manager.receiptForAction(owner, command)).receipt.result_state, 'applied')
  await f.restart(); await f.manager.flushPending(owner); await f.manager.close()
  const after = JSON.parse(await readFile(file, 'utf8')).records[requestId]
  assert.deepEqual(after.commands[`cognition:${old.item_id}`], command)
  assert.deepEqual(after.finished, before.finished); assert.notEqual(after.result?.state, 'not_found')
  assert.equal(f.trace.filter(row => row.method === 'submit_command').length, 1, 'recovery must never replay the committed deletion')
  async function scan(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const item = path.join(directory, entry.name)
      if (entry.isDirectory()) await scan(item)
      else assert.equal((await readFile(item)).includes(Buffer.from(original)), false, `forget text remains in ${entry.name}`)
    }
  }
  await scan(f.root)
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
      source: { id: 'forget-person-user', text: '忘掉林舟这个人的记忆。' },
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
    request: { method: 'DELETE' }, readJson: async () => ({ requestId: 'page-delete', expectedWorldRevision: (await f.manager.status(owner)).worldRevision, deleteConversationSnippets: true, forgetScope: await confirmedScope(f, 'cognition', current.item_id) }) })
  assert.equal(deleted.body.receipt.state, 'applied')
  const state = await readFile(path.join(f.root, 'accounts', owner, 'memory-home', 'pending-actions.json'), 'utf8')
  assert.doesNotMatch(state, /红茶/)
  await f.restart()
  assert.doesNotMatch(await readFile(path.join(f.root, 'accounts', owner, 'memory-home', 'pending-actions.json'), 'utf8'), /红茶/)
})
