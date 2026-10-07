import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createPersonalAccessService } from '../src/personal-access/index.mjs'
import { createPersonalAccessBackend } from '../src/personal-access-backend.mjs'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const sourceText = '请继续完成这个合成任务，缺少信息时向我提问'
const code = (expected: string) => (error: any) => error.code === expected
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
const defaultQuestions = [{ id: 'purpose', question: '要使用哪种格式？', header: '格式',
  options: [{ label: '简单格式', description: '只包含关键内容' }, { label: '完整格式' }] }]

async function fixture(questions: any[] = defaultQuestions) {
  const root = mkdtempSync(join(tmpdir(), 'personal-user-questions-'))
  const sessions = new Set<string>(), frames = new Map<string, any>(), deliveries: any[] = []
  let runtimeId = randomUUID(), describeHook: () => Promise<void> = async () => {}
  let respondHook: ((input: any) => Promise<any>) | null = null, receipt = 'receipt-user-info-source'
  const modelStages: any[] = []
  const modelManager = { stageSecret: async (value: any) => { modelStages.push(value.stageRef) },
    apply: async () => ({ applied: true }), inspect: async () => ({ applied: true }), hasCredential: () => false,
    test: async () => ({ configured: false, reachable: false, modelListed: false }), disable: async () => ({ applied: true }),
    readSecret: async () => { throw new Error('unexpected synthetic credential read') } }
  const backend: any = {
    getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }), listModels: async () => [],
    preflight: async () => ({ ok: true }), createSession: async ({ sessionId }: any) => { sessions.add(sessionId); return { sessionId } },
    sendMessage: async () => ({ accepted: true, receiptId: receipt }),
    cancelSession: async () => ({ accepted: true }),
    stopTask: async ({ receiptIds }: any) => ({ status: 'cancel_requested', outcomes: receiptIds.map((receiptId: string) => ({ receiptId, status: 'cancel_requested' })) }),
    readEvents: async ({ afterSeq }: any) => ({ events: [], nextSeq: afterSeq, hasMore: false }),
    getTaskReplyEvidence: async () => ({ status: 'waiting', turn: 1 }),
    describeSession: async (sessionId: string) => {
      await describeHook()
      return sessions.has(sessionId) ? { sessionId, title: 'Synthetic question session', running: true, agentPreset: 'personal-remote', modelProfileId: 'local' } : null
    },
    listUserQuestions: async ({ sessionId }: any) => ({ runtimeId, questions: [...frames.values()]
      .filter(row => row.sessionId === sessionId).map(row => structuredClone(row)) }),
    respondUserQuestion: async (input: any) => {
      deliveries.push(structuredClone(input))
      if (respondHook) return respondHook(input)
      const frame = frames.get(input.questionRpcId)
      if (input.runtimeId !== runtimeId) throw Object.assign(new Error('runtime replaced'), { code: 'RUNTIME_UNAVAILABLE' })
      if (!frame || frame.nativeState !== 'pending') return { accepted: false, reason: 'not-pending' }
      frame.nativeState = 'answered'
      return { accepted: true }
    },
  }
  let service = await createPersonalAccessService({ root, port: 0, backend, accountModelManager: modelManager })
  let { origin, hostId } = await service.start()
  const grant = await service.issueSetupGrant()
  const setup = await fetch(`${origin}/personal/v1/auth/setup`, { method: 'POST',
    headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ grant: grant.grant,
      username: 'SyntheticQuestionOwner', password: 'synthetic question fixture password', deviceName: 'Synthetic question phone' }) })
  assert.equal(setup.status, 201)
  const auth = await setup.json(), cookie = setup.headers.get('set-cookie')!.split(';')[0]
  const request = async (path: string, body?: object, headers: Record<string, string> = {}) => {
    const response = await fetch(`${origin}/personal/v1/${path}`, { method: body ? 'POST' : 'GET',
      headers: { origin, cookie, 'x-weftmate-csrf': auth.csrfToken, 'content-type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined })
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] }
  }
  const command = async (body: any) => {
    const accepted = await request('commands', body)
    assert.equal(accepted.status, 202, JSON.stringify(accepted.body))
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await request(`commands/${accepted.body.command.commandId}`)
      if (result.body.command.state === 'accepted_by_dsh') return result.body.command
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    throw new Error('synthetic source not accepted')
  }
  const created = await command({ requestId: 'question-session', kind: 'session.create', targetDeviceId: hostId, modelProfileId: 'local' })
  const source = await command({ requestId: 'question-source', kind: 'session.message', targetDeviceId: hostId, sessionId: created.sessionId, text: sourceText })
  const frame = { sessionId: created.sessionId, questionRpcId: randomUUID(), sourceReady: true,
    sourceReceiptId: source.receiptId, messageHash: hash(sourceText), turn: 1, sourceSeq: 1, observedSeq: 2,
    questions: structuredClone(questions), nativeState: 'pending' }
  frames.set(frame.questionRpcId, frame)
  const path = `sessions/${created.sessionId}/questions`
  const track = (overrides: any = {}) => {
    const { nativeState: _state, ...snapshot } = frame
    return service.trackUserQuestion({ ...snapshot, runtimeId, action: 'register_question', ...overrides })
  }
  const settle = async (expected = 'resolved', questionRpcId = frame.questionRpcId) => {
    for (let attempt = 0; attempt < 120; attempt++) {
      const row = JSON.parse(readFileSync(join(root, 'store.json'), 'utf8')).accounts[auth.account.ownerId].commands[source.commandId].userQuestions
        ?.find((row: any) => row.questionRpcId === questionRpcId)
      if (row?.status === expected) return row
      await new Promise(resolve => setTimeout(resolve, 15))
    }
    throw new Error(`question did not reach ${expected}`)
  }
  return { root, backend, source, auth, request, hostId, frame, frames, deliveries, modelStages, path, track, settle,
    get service() { return service }, get runtimeId() { return runtimeId },
    describeHook: (hook: () => Promise<void>) => { describeHook = hook },
    respondHook: (hook: (input: any) => Promise<any>) => { respondHook = hook },
    rotate: (id: string) => { runtimeId = id }, raw: () => readFileSync(join(root, 'store.json'), 'utf8'),
    restart: async (snapshot?: string) => { await service.close(); if (snapshot) writeFileSync(join(root, 'store.json'), snapshot)
      service = await createPersonalAccessService({ root, port: 0, backend, accountModelManager: modelManager }); ({ origin } = await service.start()) },
    close: async () => { await service.close(); rmSync(root, { recursive: true, force: true }) },
  }
}

test('a native batch uses its real RPC ID, saves a stable answer, and sends the answer exactly once', async () => {
  const f = await fixture()
  try {
    const listed = await f.request(f.path)
    assert.equal(listed.status, 200, JSON.stringify(listed.body))
    assert.deepEqual([listed.body.questions.length, listed.body.nextBefore, listed.body.hasMore], [1, null, false])
    const pending = listed.body.questions[0]
    assert.equal(pending.questionRpcId, f.frame.questionRpcId)
    assert.equal(pending.sourceReceiptId, f.source.receiptId)
    assert.notEqual(pending.questionRpcId, pending.questions[0].id)
    assert.equal(Object.hasOwn(pending, 'runtimeId'), false)
    assert.equal(Object.hasOwn(pending, 'messageHash'), false)
    const reply = { requestId: 'question-answer-once', answer: { answers: [{ id: 'purpose', selected: ['简单格式'] }] } }
    const first = await f.request(`${f.path}/${f.frame.questionRpcId}`, reply)
    assert.equal(first.status, 200, JSON.stringify(first.body))
    assert.equal(first.body.question.status, 'answered')
    assert.equal(Object.hasOwn(first.body.question, 'outcome'), false)
    assert.equal(Object.hasOwn(first.body.question, 'answerAcceptedAt'), false)
    const settled = await f.settle()
    assert.deepEqual([settled.status, settled.outcome], ['resolved', 'answered'])
    assert.equal(typeof settled.answerAcceptedAt, 'string')
    assert.deepEqual((await f.request(`${f.path}/${f.frame.questionRpcId}`, reply)).body, first.body)
    assert.equal(f.deliveries.length, 1)
    assert.deepEqual(f.deliveries[0].answer, reply.answer)
    assert.equal(f.deliveries[0].questionRpcId, f.frame.questionRpcId)
    assert.equal(Object.hasOwn(f.deliveries[0], 'requestId'), false)
    const changed = await f.request(`${f.path}/${f.frame.questionRpcId}`, { ...reply, answer: { answers: [{ id: 'purpose', selected: ['完整格式'] }] } })
    assert.deepEqual([changed.status, changed.body.error.code], [409, 'REQUEST_CONFLICT'])
    assert.equal(f.deliveries.length, 1)
    assert.equal((await f.request(`tasks/${f.source.commandId}`)).body.executionSteps.length, 0)
  } finally { await f.close() }
})

test('answer validation preserves native single, multi and free-text semantics and exact batch order', async () => {
  const questions = [
    ...defaultQuestions,
    { id: 'multiple', question: '需要哪些内容？', options: [{ label: 'A' }, { label: 'B' }], multiSelect: true },
    { id: 'free', question: '补充说明' },
    { id: 'plan', question: '这个计划如何？', detail: '仅处理合成资料', options: [{ label: '继续' }, { label: '修改' }], intent: { kind: 'plan-review', approve: '继续' } },
  ]
  const f = await fixture(questions)
  try {
    assert.equal((await f.request(f.path)).status, 200)
    const valid = { answers: [{ id: 'purpose', selected: [] }, { id: 'multiple', selected: ['A', 'B'], custom: '额外信息' },
      { id: 'free', selected: [], custom: '自定义信息' }, { id: 'plan', selected: ['继续'] }] }
    const malformed = [
      { answers: valid.answers.slice(1) },
      { answers: [valid.answers[1], valid.answers[0], ...valid.answers.slice(2)] },
      { answers: [{ id: 'purpose', selected: ['简单格式', '完整格式'] }, ...valid.answers.slice(1)] },
      { answers: [{ id: 'purpose', selected: ['简单格式'], custom: '同时选择' }, ...valid.answers.slice(1)] },
      { answers: [valid.answers[0], { id: 'multiple', selected: ['A', 'A'] }, ...valid.answers.slice(2)] },
      { answers: [valid.answers[0], { id: 'multiple', selected: ['invented-label'] }, ...valid.answers.slice(2)] },
      { answers: [valid.answers[0], valid.answers[1], { id: 'free', selected: [], custom: '  ' }, valid.answers[3]] },
      { answers: [valid.answers[0], valid.answers[1], { id: 'free', selected: ['not an option'] }, valid.answers[3]] },
      { answers: valid.answers, extra: true },
    ]
    for (const answer of malformed) {
      const before = f.raw()
      const rejected = await f.request(`${f.path}/${f.frame.questionRpcId}`, { requestId: 'validity-answer', answer })
      assert.equal(rejected.status, 400, JSON.stringify(rejected.body))
      assert.equal(f.raw(), before)
    }
    const good = await f.request(`${f.path}/${f.frame.questionRpcId}`, { requestId: 'validity-answer', answer: valid })
    assert.equal(good.status, 200, JSON.stringify(good.body))
    await f.settle()
    assert.deepEqual(f.deliveries[0].answer, valid)
    assert.equal(good.body.question.questions[3].intent.kind, 'plan-review')
  } finally { await f.close() }
})

test('questions fail closed for missing or forged source, body fields, CSRF and another account', async () => {
  const f = await fixture()
  try {
    for (const overrides of [{ ownerId: 'foreign' }, { sourceReady: false }, { sourceReceiptId: 'wrong-receipt' },
      { messageHash: hash('other message') }, { turn: 2 }, { sourceSeq: -1 }, { observedSeq: 0 }, { runtimeId: undefined }]) {
      const before = f.raw()
      await assert.rejects(f.track(overrides))
      assert.equal(f.raw(), before)
    }
    f.frame.sourceReady = false
    assert.equal((await f.request(f.path)).status, 403)
    f.frame.sourceReady = true
    assert.equal((await f.request(f.path)).status, 200)
    const reply = { requestId: 'source-answer', answer: { answers: [{ id: 'purpose', selected: [] }] } }
    assert.equal((await f.request(`${f.path}/${f.frame.questionRpcId}`, reply, { cookie: '' })).status, 401)
    assert.equal((await f.request(`${f.path}/${f.frame.questionRpcId}`, reply, { 'x-weftmate-csrf': '' })).status, 403)
    assert.equal((await f.request(`${f.path}/${f.frame.questionRpcId}`, { ...reply, outcome: 'allowed-once' })).status, 400)
    assert.equal((await f.request(`${f.path}/${f.frame.questionRpcId}`, { ...reply, requestId: ['not-a-string'] })).status, 400)
    const other = await f.request('auth/register', { username: 'SyntheticQuestionOther', password: 'other synthetic question password', deviceName: 'Other synthetic phone' })
    const headers = { cookie: other.cookie!, 'x-weftmate-csrf': other.body.csrfToken }
    assert.equal((await f.request(f.path, undefined, headers)).status, 404)
    assert.equal((await f.request(`${f.path}/${f.frame.questionRpcId}`, reply, headers)).status, 404)
    assert.equal(f.deliveries.length, 0)
  } finally { await f.close() }
})

test('a live reconnect retains one exact batch, while a native outside answer supplies no invented portal answer', async () => {
  const f = await fixture()
  try {
    const first = await f.request(f.path)
    assert.equal(first.status, 200)
    assert.deepEqual((await f.request(f.path)).body, first.body)
    const original = f.frame.questions
    f.frame.questions = [{ ...original[0], question: 'Changed replay body' }]
    const before = f.raw()
    const changed = await f.request(f.path)
    assert.deepEqual([changed.status, changed.body.error.code], [409, 'REQUEST_CONFLICT'])
    assert.equal(f.raw(), before)
    f.frame.questions = original
    f.frame.nativeState = 'answered'
    const answered = await f.request(f.path)
    assert.deepEqual([answered.body.questions.length, answered.body.questions[0].status, answered.body.questions[0].outcome], [1, 'resolved', 'answered'])
    assert.equal(Object.hasOwn(answered.body.questions[0], 'answer'), false)
    assert.equal(Object.hasOwn(answered.body.questions[0], 'answerAcceptedAt'), false)
    const late = await f.request(`${f.path}/${f.frame.questionRpcId}`, { requestId: 'outside-late-answer', answer: { answers: [{ id: 'purpose', selected: [] }] } })
    assert.deepEqual([late.status, late.body.error.code], [409, 'QUESTION_NOT_PENDING'])
    assert.equal(f.deliveries.length, 0)
  } finally { await f.close() }
})

test('native not-pending and uncertain response receipts stay truthful and never resend saved answers', async () => {
  for (const mode of ['not-pending', 'unknown']) {
    const f = await fixture()
    try {
      await f.request(f.path)
      f.respondHook(async () => {
        if (mode === 'not-pending') return { accepted: false, reason: 'not-pending' }
        throw new Error('native receipt transport lost')
      })
      const reply = { requestId: `delivery-${mode}`, answer: { answers: [{ id: 'purpose', selected: ['简单格式'] }] } }
      const first = await f.request(`${f.path}/${f.frame.questionRpcId}`, reply)
      assert.equal(first.status, 200)
      const settled = await f.settle('unavailable')
      assert.equal(settled.reasonCode, mode === 'not-pending' ? 'QUESTION_NOT_PENDING' : 'QUESTION_OUTCOME_UNCONFIRMED')
      assert.equal(Object.hasOwn(settled, 'outcome'), false)
      assert.deepEqual((await f.request(`${f.path}/${f.frame.questionRpcId}`, reply)).body, first.body)
      assert.equal((await f.request(f.path)).body.questions[0].status, 'unavailable')
      assert.equal(f.deliveries.length, 1)
      const late = await f.request(`${f.path}/${f.frame.questionRpcId}`, { ...reply, requestId: 'different-delivery-request' })
      assert.equal(late.status, 409)
      assert.equal(f.deliveries.length, 1)
    } finally { await f.close() }
  }
})

test('runtime replacement seals registrations already awaiting describe and leaves the new child batch untouched', async () => {
  const f = await fixture(), entered = deferred(), release = deferred()
  try {
    const oldRuntime = f.runtimeId
    let first = true
    f.describeHook(async () => { if (first) { first = false; entered.resolve(); await release.promise } })
    const late = f.track(), rejected = assert.rejects(late, code('TOOL_SOURCE_UNAVAILABLE'))
    await entered.promise
    const closed = f.service.invalidateToolApprovals({ runtimeId: oldRuntime, reasonCode: 'SESSION_REPLACED' })
    f.rotate(randomUUID())
    const replacement = { ...f.frame, questionRpcId: randomUUID() }
    f.frames.clear(); f.frames.set(replacement.questionRpcId, replacement)
    const newFrame = await f.request(f.path)
    assert.equal(newFrame.status, 200, JSON.stringify(newFrame.body))
    assert.equal(newFrame.body.questions[0].questionRpcId, replacement.questionRpcId)
    release.resolve(); await rejected; await closed
    await f.service.invalidateToolApprovals({ runtimeId: oldRuntime })
    assert.equal((await f.request(f.path)).body.questions[0].status, 'pending')
  } finally { release.resolve(); await f.close() }
})

test('a native outside answer or lost own ACK never attributes the portal answer to native consumption', async () => {
  for (const mode of ['not-pending', 'lost-ack', 'accepted']) {
    const f = await fixture(), entered = deferred(), release = deferred()
    try {
      await f.request(f.path)
      f.respondHook(async () => {
        // A resolved mux frame may be seen before the portal's own receipt returns.
        f.frame.nativeState = 'answered'; entered.resolve(); await release.promise
        if (mode === 'lost-ack') throw new Error('ACK lost after a native terminal frame')
        return mode === 'accepted' ? { accepted: true } : { accepted: false, reason: 'not-pending' }
      })
      const reply = { requestId: `concurrent-${mode}`, answer: { answers: [{ id: 'purpose', selected: ['简单格式'] }] } }
      const saved = await f.request(`${f.path}/${f.frame.questionRpcId}`, reply)
      assert.equal(saved.status, 200)
      await entered.promise
      const native = (await f.request(f.path)).body.questions[0]
      assert.deepEqual([native.status, native.outcome], ['resolved', 'answered'])
      assert.equal(native.reasonCode, 'QUESTION_OUTCOME_UNCONFIRMED')
      assert.equal(Object.hasOwn(native, 'answerAcceptedAt'), false)
      release.resolve()
      let settled: any
      for (let attempt = 0; attempt < 180; attempt++) {
        settled = JSON.parse(f.raw()).accounts[f.auth.account.ownerId].commands[f.source.commandId].userQuestions[0]
        if (settled.deliveryState !== 'dispatching') break
        await new Promise(resolve => setTimeout(resolve, 15))
      }
      assert.equal(settled.status, 'resolved')
      assert.equal(settled.outcome, 'answered')
      if (mode === 'accepted') {
        assert.equal(settled.deliveryState, 'accepted')
        assert.equal(typeof settled.answerAcceptedAt, 'string')
        assert.equal(Object.hasOwn(settled, 'reasonCode'), false)
      } else {
        assert.equal(settled.deliveryState, mode === 'not-pending' ? 'not-pending' : 'unconfirmed')
        assert.equal(settled.reasonCode, mode === 'not-pending' ? 'QUESTION_NOT_PENDING' : 'QUESTION_OUTCOME_UNCONFIRMED')
        assert.equal(Object.hasOwn(settled, 'answerAcceptedAt'), false)
      }
      assert.deepEqual((await f.request(`${f.path}/${f.frame.questionRpcId}`, reply)).body, saved.body)
      assert.equal(f.deliveries.length, 1)
    } finally { release.resolve(); await f.close() }
  }
})

test('native terminal evidence arriving during registration cannot recreate a historical pending batch', async () => {
  const f = await fixture(), entered = deferred(), release = deferred()
  try {
    let first = true
    f.describeHook(async () => { if (first) { first = false; entered.resolve(); await release.promise } })
    const late = f.track(), rejected = assert.rejects(late, code('QUESTION_NOT_PENDING'))
    await entered.promise
    f.frame.nativeState = 'cancelled'
    release.resolve(); await rejected
    const listed = await f.request(f.path)
    assert.equal(listed.status, 200)
    assert.equal(listed.body.questions.length, 0)
    assert.equal(f.raw().includes('questionRpcId'), false)
  } finally { release.resolve(); await f.close() }
})

test('task stop and service restart leave old batches unavailable and reject late answers', async () => {
  const f = await fixture()
  try {
    await f.request(f.path)
    assert.equal((await f.request(`tasks/${f.source.commandId}/stop`, { requestId: 'question-stop' })).status, 202)
    const stopped = await f.request(f.path)
    assert.equal(stopped.body.questions[0].status, 'unavailable')
    assert.equal(stopped.body.questions[0].reasonCode, 'TASK_NOT_READY')
    const late = await f.request(`${f.path}/${f.frame.questionRpcId}`, { requestId: 'question-stop-answer', answer: { answers: [{ id: 'purpose', selected: [] }] } })
    assert.equal(late.status, 409)
    await f.restart()
    f.rotate(randomUUID()); f.frames.clear()
    const recovered = await f.request(f.path)
    assert.equal(recovered.body.questions[0].status, 'unavailable')
    assert.equal(f.deliveries.length, 0)
  } finally { await f.close() }
})

test('answer IDs collide in both directions with commands, task stops and approval decisions', async () => {
  const f = await fixture()
  try {
    await f.request(f.path)
    const reply = { requestId: 'question-dedup-answer', answer: { answers: [{ id: 'purpose', selected: [] }] } }
    const forward = await f.request(`${f.path}/${f.frame.questionRpcId}`, { ...reply, requestId: f.source.requestId })
    assert.deepEqual([forward.status, forward.body.error.code], [409, 'REQUEST_CONFLICT'])
    const saved = await f.request(`${f.path}/${f.frame.questionRpcId}`, reply)
    assert.equal(saved.status, 200)
    await f.settle()
    const before = f.raw()
    const command = await f.request('commands', { requestId: reply.requestId, kind: 'session.message', targetDeviceId: f.hostId, sessionId: f.frame.sessionId, text: 'Reusing information-answer ID' })
    assert.deepEqual([command.status, command.body.error.code], [409, 'REQUEST_CONFLICT'])
    assert.equal(f.raw(), before)
    const stop = await f.request(`tasks/${f.source.commandId}/stop`, { requestId: reply.requestId })
    assert.deepEqual([stop.status, stop.body.error.code], [409, 'REQUEST_CONFLICT'])
    assert.equal(f.raw(), before)
    const model = await f.request('account/models', { requestId: reply.requestId, name: 'Synthetic namespace only',
      baseUrl: 'https://model.example.test/v1', modelId: 'namespace-fixture', apiKey: 'synthetic-not-a-credential' })
    assert.deepEqual([model.status, model.body.error.code], [409, 'REQUEST_CONFLICT'])
    assert.equal(f.raw(), before)
    assert.equal(f.modelStages.length, 0)
    const project = await f.request('projects', { requestId: reply.requestId, name: 'Synthetic namespace only', rootPath: 'Z:\\never-inspected-synthetic-project' })
    assert.deepEqual([project.status, project.body.error.code], [409, 'REQUEST_CONFLICT'])
    assert.equal(f.raw(), before)
    const approvalId = randomUUID()
    await f.service.trackToolApproval({ action: 'register_approval', runtimeId: f.runtimeId, sessionId: f.frame.sessionId,
      turn: 1, callId: 'question-permission-call', rootCallId: 'question-permission-call', receiptId: f.source.receiptId,
      messageHash: hash(sourceText), toolName: 'pwsh', argumentsHash: hash('private synthetic command'), approvalId, reason: 'Separate native execution approval' })
    const approvalCollision = await f.request(`sessions/${f.frame.sessionId}/approvals/${approvalId}`, { requestId: reply.requestId, outcome: 'allowed-once' })
    assert.deepEqual([approvalCollision.status, approvalCollision.body.error.code], [409, 'REQUEST_CONFLICT'])
    await assert.rejects(f.service.trackToolExecution({ action: 'authorize_execution', runtimeId: f.runtimeId,
      sessionId: f.frame.sessionId, turn: 1, callId: 'question-permission-call', rootCallId: 'question-permission-call',
      receiptId: f.source.receiptId, messageHash: hash(sourceText), toolName: 'pwsh', argumentsHash: hash('private synthetic command') }), code('TASK_NOT_READY'))
    assert.equal((await f.request(`sessions/${f.frame.sessionId}/approvals/${approvalId}`, { requestId: 'approval-forward-answer', outcome: 'rejected' })).status, 200)
    const next = { ...f.frame, questionRpcId: randomUUID(), nativeState: 'pending' }
    f.frames.set(next.questionRpcId, next)
    assert.equal((await f.request(f.path)).status, 200)
    const secondReply = { requestId: 'approval-forward-answer', answer: reply.answer }
    const approvalForward = await f.request(`${f.path}/${next.questionRpcId}`, secondReply)
    assert.deepEqual([approvalForward.status, approvalForward.body.error.code], [409, 'REQUEST_CONFLICT'])
    assert.equal((await f.request(`tasks/${f.source.commandId}/stop`, { requestId: 'stop-forward-answer' })).status, 202)
    const stopForward = await f.request(`${f.path}/${next.questionRpcId}`, { ...secondReply, requestId: 'stop-forward-answer' })
    assert.deepEqual([stopForward.status, stopForward.body.error.code], [409, 'REQUEST_CONFLICT'])
  } finally { await f.close() }
})

test('question information remains available to clarify an uncertain execution without lifting its guard', async () => {
  const f = await fixture()
  try {
    const input = { runtimeId: f.runtimeId, sessionId: f.frame.sessionId, turn: 1, callId: 'unknown-call', rootCallId: 'unknown-root',
      receiptId: f.source.receiptId, messageHash: hash(sourceText), toolName: 'pwsh', argumentsHash: hash('unknown synthetic body') }
    const started = await f.service.trackToolExecution({ ...input, action: 'authorize_execution' })
    await f.service.trackToolExecution({ ...input, action: 'finish_execution', executionId: started.executionId, state: 'uncertain' })
    assert.equal((await f.request(f.path)).status, 200)
    const answered = await f.request(`${f.path}/${f.frame.questionRpcId}`, { requestId: 'clarify-unknown', answer: { answers: [{ id: 'purpose', selected: [] }] } })
    assert.equal(answered.status, 200)
    await f.settle()
    await assert.rejects(f.service.trackToolExecution({ ...input, callId: 'unknown-next', action: 'authorize_execution' }), code('TASK_NOT_READY'))
  } finally { await f.close() }
})

test('revoked source credentials and a changed model destination cannot receive late information answers', async () => {
  for (const mode of ['device', 'model']) {
    const f = await fixture()
    try {
      await f.request(f.path)
      let headers: Record<string, string> = {}
      if (mode === 'device') {
        await f.service.revokeDevice(f.auth.device.id)
        assert.equal((await f.request(f.path)).status, 401)
        const login = await f.request('auth/login', { username: 'SyntheticQuestionOwner', password: 'synthetic question fixture password', deviceName: 'Replacement synthetic device' })
        assert.equal(login.status, 200)
        headers = { cookie: login.cookie!, 'x-weftmate-csrf': login.body.csrfToken }
      } else {
        f.backend.describeSession = async (sessionId: string) => ({ sessionId, agentPreset: 'personal-remote', running: true, modelProfileId: 'changed-destination' })
      }
      const listed = await f.request(f.path, undefined, headers)
      assert.equal(listed.status, 200, JSON.stringify(listed.body))
      assert.deepEqual([listed.body.questions[0].status, listed.body.questions[0].reasonCode],
        ['unavailable', mode === 'device' ? 'TOOL_SOURCE_UNAVAILABLE' : 'MODEL_UNAVAILABLE'])
      const late = await f.request(`${f.path}/${f.frame.questionRpcId}`, { requestId: 'stale-source-answer', answer: { answers: [{ id: 'purpose', selected: [] }] } }, headers)
      assert.equal(late.status, 409)
      assert.equal(f.deliveries.length, 0)
    } finally { await f.close() }
  }
})

test('shared-chat session scope still exposes no question channel', async () => {
  const f = await fixture()
  try {
    const snapshot = JSON.parse(f.raw())
    snapshot.accounts[f.auth.account.ownerId].sessions[f.frame.sessionId].origin = 'shared-chat'
    await f.restart(JSON.stringify(snapshot))
    const shared = await f.request(f.path)
    assert.deepEqual([shared.status, shared.body.questions.length], [200, 0])
    await assert.rejects(f.track(), code('SESSION_READ_ONLY'))
    assert.equal(f.deliveries.length, 0)
  } finally { await f.close() }
})

test('a reconnect snapshot gap cannot seal an existing question or cause a duplicate native answer', async () => {
  const f = await fixture()
  try {
    assert.equal((await f.request(f.path)).status, 200)
    const snapshot = structuredClone(f.frame), stored = f.raw()
    f.frames.clear()
    const missing = await f.request(f.path)
    assert.deepEqual([missing.status, missing.body.error.code], [503, 'BACKEND_UNAVAILABLE'])
    assert.equal(f.raw(), stored)
    const reply = { requestId: 'reconnect-gap-answer', answer: { answers: [{ id: 'purpose', selected: [] }] } }
    assert.equal((await f.request(`${f.path}/${f.frame.questionRpcId}`, reply)).status, 503)
    assert.equal(f.raw(), stored)
    f.frames.set(f.frame.questionRpcId, { sessionId: f.frame.sessionId, questionRpcId: f.frame.questionRpcId, sourceReady: false, nativeState: 'pending' })
    assert.equal((await f.request(f.path)).status, 403)
    assert.equal(f.raw(), stored)
    f.frames.set(f.frame.questionRpcId, snapshot)
    const recovered = await f.request(f.path)
    assert.deepEqual([recovered.status, recovered.body.questions.length, recovered.body.questions[0].status], [200, 1, 'pending'])
    assert.equal(f.raw(), stored)
    assert.equal((await f.request(`${f.path}/${f.frame.questionRpcId}`, reply)).status, 200)
    await f.settle()
    assert.equal(f.deliveries.length, 1)
  } finally { await f.close() }
})

test('backend snapshots and responses capture the parent generation before awaits and discard replacements', async () => {
  let runtimeId = randomUUID(), origin = 'http://127.0.0.1:12345', gate = Promise.resolve()
  const gatewayCalls: any[] = [], answer = { answers: [{ id: 'x', selected: [] }] }
  const backend = createPersonalAccessBackend({ currentOrigin: () => origin, getRuntimeId: () => runtimeId,
    referenceScan: () => ({ state: 'ready' }), profiles: () => [], hasCredential: () => false,
    hostOwnerId: () => 'owner', ownerForSession: () => 'owner', modelAllowed: () => true,
    routeForProfile: () => ({}), listSessions: async () => { await gate; return { items: [{ sessionId: 'session-owned', agentPreset: 'personal-remote' }] } },
    resolveSession: async () => ({ profile: { id: 'local' } }), ensureKnownSession: async () => {},
    gateway: async (path: string, options: any) => { gatewayCalls.push({ path, options }); return options?.method === 'POST' ? { accepted: true } : { questions: [] } },
    queue: (work: () => Promise<any>) => work(), bindSession: () => {},
  })
  const first = runtimeId
  assert.equal((await backend.listUserQuestions({ sessionId: 'session-owned', ownerId: 'owner' })).runtimeId, first)
  assert.deepEqual(await backend.respondUserQuestion({ ownerId: 'owner', runtimeId, sessionId: 'session-owned', questionRpcId: randomUUID(), answer }), { accepted: true })
  await assert.rejects(backend.listUserQuestions({ sessionId: 'session-owned', ownerId: 'owner', modelProfileId: 'different' }), code('MODEL_UNAVAILABLE'))
  await assert.rejects(backend.respondUserQuestion({ ownerId: 'owner', runtimeId, sessionId: 'session-owned', questionRpcId: randomUUID(), answer, modelProfileId: 'different' }), code('MODEL_UNAVAILABLE'))
  const entered = deferred(), released = deferred()
  gate = (async () => { entered.resolve(); await released.promise })()
  const late = backend.listUserQuestions({ sessionId: 'session-owned', ownerId: 'owner' }), rejected = assert.rejects(late, code('RUNTIME_UNAVAILABLE'))
  await entered.promise; runtimeId = randomUUID(); released.resolve(); await rejected
  assert.equal(gatewayCalls.length, 2)
  await assert.rejects(backend.respondUserQuestion({ ownerId: 'owner', runtimeId: first, sessionId: 'session-owned', questionRpcId: randomUUID(), answer }), code('RUNTIME_UNAVAILABLE'))
  assert.equal(gatewayCalls.length, 2)
  origin = ''
  await assert.rejects(backend.listUserQuestions({ sessionId: 'session-owned', ownerId: 'owner' }), code('RUNTIME_UNAVAILABLE'))
})
