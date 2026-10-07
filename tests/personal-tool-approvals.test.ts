import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createPersonalAccessService } from '../src/personal-access/index.mjs'
import { createDshSessionAdapter } from '../src/runtime/dsh-adapter/sessions.mjs'
import { questionSourceAsOf } from '../src/runtime/dsh-adapter/agents.mjs'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const sourceText = '完成当前合成账户的一项通用工作，并在需要时请求批准'
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
const code = (expected: string) => (error: any) => error.code === expected

async function fixture({ useReplyEvidence = true, clockFn = Date.now } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'personal-tool-approvals-'))
  const sessions = new Set<string>(), events: any[] = []
  let receiptNo = 0, running = true, describeHook: () => Promise<void> = async () => {}
  const backend: any = {
    getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }), listModels: async () => [],
    preflight: async () => ({ ok: true }),
    createSession: async ({ sessionId }: any) => { sessions.add(sessionId); return { sessionId } },
    sendMessage: async ({ text }: any) => {
      const receiptId = `receipt-approval-${++receiptNo}`
      if (receiptNo > 1) events.push({ seq: events.length, type: 'turn.ended', data: { turn: receiptNo - 1, reason: 'completed' } })
      events.push({ seq: events.length, type: 'turn.started', data: { turn: receiptNo } })
      events.push({ seq: events.length, type: 'user.message', data: { receiptId, messageHash: hash(text), text } })
      return { accepted: true, receiptId }
    },
    stopTask: async ({ receiptIds }: any) => ({ status: 'cancel_requested',
      outcomes: receiptIds.map((receiptId: string) => ({ receiptId, status: 'cancel_requested' })) }),
    cancelSession: async () => ({ accepted: true }),
    readEvents: async ({ afterSeq, beforeSeq, limit }: any) => {
      const forward = afterSeq !== undefined
      const remaining = events.filter(event => forward ? event.seq > afterSeq : beforeSeq === undefined || event.seq < beforeSeq)
      const page = forward ? remaining.slice(0, limit) : remaining.slice(-limit)
      return { events: page, nextSeq: page.at(-1)?.seq ?? afterSeq ?? -1,
        nextBeforeSeq: page[0]?.seq ?? null, hasMore: forward && remaining.length > page.length,
        hasOlder: !forward && remaining.length > page.length }
    },
    describeSession: async (sessionId: string) => {
      await describeHook()
      return sessions.has(sessionId) ? { sessionId, running, title: 'Synthetic approval session',
        agentPreset: 'personal-remote', modelProfileId: 'local' } : null
    },
  }
  if (useReplyEvidence) backend.getTaskReplyEvidence = async ({ receiptId }: any) => {
    const index = events.findIndex(event => event.type === 'user.message' && event.data.receiptId === receiptId)
    const start = events.slice(0, index).findLast(event => event.type === 'turn.started')
    const ended = events.slice(index + 1).some(event => event.type === 'turn.ended' && event.data.turn === start?.data.turn)
    return { turn: start?.data.turn ?? null, status: ended ? 'completed' : running ? 'waiting' : 'unconfirmed' }
  }
  let service = await createPersonalAccessService({ root, port: 0, backend, clock: clockFn })
  let { origin, hostId } = await service.start()
  const grant = await service.issueSetupGrant()
  const setup = await fetch(`${origin}/personal/v1/auth/setup`, { method: 'POST',
    headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ grant: grant.grant,
      username: 'SyntheticApprovalOwner', password: 'synthetic approval fixture password', deviceName: 'Synthetic phone' }) })
  assert.equal(setup.status, 201)
  const auth = await setup.json(), cookie = setup.headers.get('set-cookie')!.split(';')[0]
  const request = async (path: string, body?: object, headers: Record<string, string> = {}) => {
    const response = await fetch(`${origin}/personal/v1/${path}`, { method: body ? 'POST' : 'GET',
      headers: { origin, cookie, 'x-weftmate-csrf': auth.csrfToken, 'content-type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined })
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] }
  }
  const command = async (payload: object) => {
    const accepted = await request('commands', payload)
    assert.equal(accepted.status, 202, JSON.stringify(accepted.body))
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await request(`commands/${accepted.body.command.commandId}`)
      if (result.body.command.state === 'accepted_by_dsh') return result.body.command
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    throw new Error('synthetic command did not acquire a receipt')
  }
  const created = await command({ requestId: 'approval-session', kind: 'session.create', targetDeviceId: hostId, modelProfileId: 'local' })
  const source = await command({ requestId: 'approval-source', kind: 'session.message', targetDeviceId: hostId,
    sessionId: created.sessionId, text: sourceText })
  const input = { sessionId: created.sessionId, turn: 1, callId: 'approval-call', rootCallId: 'approval-call',
    receiptId: source.receiptId, messageHash: hash(sourceText), toolName: 'pwsh', argumentsHash: hash('private tool arguments'),
    runtimeId: randomUUID(), approvalId: randomUUID() }
  const approvalsPath = `sessions/${input.sessionId}/approvals`
  return { root, backend, events, auth, input, source, request, command, hostId, approvalsPath,
    get service() { return service },
    describeHook: (hook: () => Promise<void>) => { describeHook = hook },
    running: (value: boolean) => { running = value },
    register: (overrides: object = {}) => service.trackToolApproval({ ...input, action: 'register_approval', reason: '需要本次批准', ...overrides }),
    read: (overrides: object = {}) => service.trackToolApproval({ ...input, action: 'read_approval', ...overrides }),
    resolve: (outcome: string, overrides: object = {}) => service.trackToolApproval({ ...input, action: 'resolve_approval', outcome, ...overrides }),
    authorize: (overrides: object = {}) => {
      const { approvalId: _approvalId, ...identity } = input
      return service.trackToolExecution({ ...identity, action: 'authorize_execution', ...overrides })
    },
    restart: async (snapshot?: string) => {
      await service.close()
      if (snapshot) writeFileSync(join(root, 'store.json'), snapshot)
      service = await createPersonalAccessService({ root, port: 0, backend, clock: clockFn })
      ;({ origin } = await service.start())
    },
    raw: () => readFileSync(join(root, 'store.json'), 'utf8'),
    close: async () => { await service.close(); rmSync(root, { recursive: true, force: true }) },
  }
}

test('HTTP answers have stable receipts; only the native final decision permits the exact tool call', async () => {
  const f = await fixture()
  try {
    assert.equal((await f.register()).status, 'pending')
    assert.equal((await f.register()).approvalId, f.input.approvalId)
    const listed = await f.request(f.approvalsPath)
    assert.equal(listed.status, 200)
    assert.deepEqual([listed.body.approvals.length, listed.body.nextBefore, listed.body.hasMore], [1, null, false])
    assert.equal(Object.hasOwn(listed.body.approvals[0], 'runtimeId'), false)
    assert.equal(Object.hasOwn(listed.body.approvals[0], 'argumentsHash'), false)
    assert.equal(Object.hasOwn(listed.body.approvals[0], 'messageHash'), false)
    await assert.rejects(f.authorize(), code('TASK_NOT_READY'))
    const decision = { requestId: 'approval-answer', outcome: 'allowed-once' }
    const first = await f.request(`${f.approvalsPath}/${f.input.approvalId}`, decision)
    assert.equal(first.status, 200, JSON.stringify(first.body))
    assert.equal(first.body.approval.status, 'answered')
    assert.equal(Object.hasOwn(first.body.approval, 'outcome'), false)
    assert.deepEqual((await f.request(`${f.approvalsPath}/${f.input.approvalId}`, decision)).body, first.body)
    const beforeReuse = f.raw()
    const commandReuse = await f.request('commands', { requestId: decision.requestId, kind: 'session.message',
      targetDeviceId: f.hostId, sessionId: f.input.sessionId, text: 'Reuse an approval response ID' })
    assert.deepEqual([commandReuse.status, commandReuse.body.error.code], [409, 'REQUEST_CONFLICT'])
    assert.equal(f.raw(), beforeReuse)
    const stopReuse = await f.request(`tasks/${f.source.commandId}/stop`, { requestId: decision.requestId })
    assert.deepEqual([stopReuse.status, stopReuse.body.error.code], [409, 'REQUEST_CONFLICT'])
    assert.equal(f.raw(), beforeReuse)
    await assert.rejects(f.authorize(), code('TASK_NOT_READY'))
    const native = await f.resolve('allowed-once')
    assert.deepEqual([native.status, native.outcome], ['resolved', 'allowed-once'])
    assert.deepEqual(await f.resolve('allowed-once'), native)
    assert.deepEqual((await f.request(`${f.approvalsPath}/${f.input.approvalId}`, decision)).body, first.body)
    const wrong = await f.request(`${f.approvalsPath}/${f.input.approvalId}`, { ...decision, outcome: 'rejected' })
    assert.deepEqual([wrong.status, wrong.body.error.code], [409, 'REQUEST_CONFLICT'])
    await assert.rejects(f.authorize({ argumentsHash: hash('different private arguments') }), code('REQUEST_CONFLICT'))
    assert.equal((await f.authorize()).state, 'running')
    await assert.rejects(f.authorize(), code('REQUEST_CONFLICT'))
    assert.equal(f.raw().includes('private tool arguments'), false)
  } finally { await f.close() }
})

test('task reply projection forwards a known limit cause while retaining an existing observed artifact', async () => {
  const f = await fixture()
  try {
    const saved = await f.service.submitToolArtifact({ sessionId: f.input.sessionId,
      turn: f.input.turn, callId: 'call-existing-text-save', messageHash: hash(sourceText),
      receiptId: f.source.receiptId, fileName: 'existing.txt', content: 'already-saved text' })
    assert.equal(saved.state, 'observed')
    f.backend.getTaskReplyEvidence = async () => ({ status: 'failed', turn: 1, step: 6,
      assistantChunks: 6, textChunks: 1, reasoningChunks: 0, assistantMessages: 2,
      toolSaveObserved: true, terminalAt: '2026-10-07T00:35:29.769Z', endReasonKind: 'max-tokens' })
    const detail = await f.request('tasks/' + f.source.commandId)
    assert.equal(detail.status, 200)
    assert.equal(detail.body.replyEvidence.status, 'failed')
    assert.equal(detail.body.replyEvidence.endReasonKind, 'max-tokens')
    assert.equal(detail.body.replyEvidence.toolSaveObserved, true)
    assert.equal(detail.body.artifacts.length, 1)
    assert.equal(detail.body.artifacts[0].artifactId, saved.artifactId)
    assert.equal(detail.body.artifacts[0].state, 'observed')
    f.backend.getTaskReplyEvidence = async () => ({ status: 'failed', turn: 1,
      assistantChunks: 0, textChunks: 0, reasoningChunks: 0, assistantMessages: 0, toolSaveObserved: true })
    assert.equal((await f.request('tasks/' + f.source.commandId)).body.replyEvidence.endReasonKind, undefined)
  } finally { await f.close() }
})

test('approval identity, exact HTTP bodies, original request IDs, CSRF and other-account isolation reject forgery', async () => {
  const f = await fixture()
  try {
    for (const overrides of [{ ownerId: 'forged-owner' }, { messageHash: undefined }, { messageHash: hash('wrong text') },
      { receiptId: 'foreign-receipt' }, { runtimeId: undefined }, { turn: 2 }, { approvalId: 'invented-approval' }]) {
      const before = f.raw()
      await assert.rejects(f.register(overrides))
      assert.equal(f.raw(), before)
    }
    await f.register()
    for (const action of ['read_approval', 'resolve_approval']) {
      const before = f.raw()
      await assert.rejects(f.service.trackToolApproval({ ...f.input, action, ...(action === 'resolve_approval' ? { outcome: 'cancelled' } : {}),
        messageHash: hash('different source') }), code('TOOL_SOURCE_UNAVAILABLE'))
      assert.equal(f.raw(), before)
    }
    await assert.rejects(f.resolve('allowed-once'), code('REQUEST_CONFLICT'))
    const path = `${f.approvalsPath}/${f.input.approvalId}`
    const decision = { requestId: 'approval-safe-answer', outcome: 'rejected' }
    assert.equal((await f.request(path, decision, { cookie: '' })).status, 401)
    assert.equal((await f.request(path, decision, { 'x-weftmate-csrf': '' })).status, 403)
    for (const outcome of ['allowed', 'allowed-always', 'cancelled', 'unavailable']) {
      assert.equal((await f.request(path, { ...decision, outcome })).status, 400)
    }
    assert.equal((await f.request(path, { ...decision, ownerId: f.auth.account.ownerId })).status, 400)
    assert.equal((await f.request(path, { ...decision, requestId: 123 })).status, 400)
    assert.equal((await f.request(path, { ...decision, requestId: ['looks-like-an-id'] })).status, 400)
    const reused = await f.request(path, { ...decision, requestId: f.source.requestId })
    assert.deepEqual([reused.status, reused.body.error.code], [409, 'REQUEST_CONFLICT'])
    const other = await f.request('auth/register', { username: 'SyntheticApprovalOther', password: 'other synthetic approval password', deviceName: 'Other synthetic phone' })
    assert.equal(other.status, 201)
    const foreignHeaders = { cookie: other.cookie!, 'x-weftmate-csrf': other.body.csrfToken }
    assert.equal((await f.request(f.approvalsPath, undefined, foreignHeaders)).status, 404)
    assert.equal((await f.request(path, decision, foreignHeaders)).status, 404)
    assert.equal((await f.request(`${f.approvalsPath}?limit=101`)).status, 400)
    assert.equal((await f.request(`${f.approvalsPath}?limit=1&limit=1`)).status, 400)
    assert.equal((await f.read()).status, 'pending')
  } finally { await f.close() }
})

test('a native rejection closes its root chain while tools with no asked approval retain native automatic permission', async () => {
  const f = await fixture()
  try {
    await f.register()
    const reply = await f.request(`${f.approvalsPath}/${f.input.approvalId}`, { requestId: 'denied-answer', outcome: 'rejected' })
    assert.equal(reply.status, 200)
    assert.equal((await f.resolve('rejected')).status, 'resolved')
    await assert.rejects(f.authorize(), code('TASK_NOT_READY'))
    await assert.rejects(f.authorize({ callId: 'nested-denied', toolName: 'read_file', argumentsHash: hash('other args') }), code('TASK_NOT_READY'))
    assert.equal((await f.authorize({ callId: 'automatic-read', rootCallId: 'automatic-read', toolName: 'read_file' })).state, 'running')
  } finally { await f.close() }
})

test('native execution-body and script-nested approvals may register beside the exact running execution', async () => {
  const f = await fixture()
  try {
    await f.authorize({ toolName: 'weftmod_script' })
    assert.equal((await f.register({ toolName: 'weftmod_script' })).status, 'pending')
    await assert.rejects(f.register({ toolName: 'weftmod', approvalId: randomUUID() }), code('REQUEST_CONFLICT'))
    await assert.rejects(f.register({ argumentsHash: hash('changed'), approvalId: randomUUID() }), code('REQUEST_CONFLICT'))
    const nested = { callId: 'script-nested', toolName: 'pwsh', argumentsHash: hash('nested arguments'), approvalId: randomUUID() }
    assert.equal((await f.register(nested)).status, 'pending')
    assert.equal((await f.register({ callId: 'different-root', rootCallId: 'different-root', approvalId: randomUUID() })).status, 'pending')
    const detail = await f.request(`tasks/${f.source.commandId}`)
    assert.equal(detail.body.executionSteps[0].toolName, 'weftmod_script')
  } finally { await f.close() }
})

test('a lost execute-body approval receipt preserves an uncertain execution and blocks new calls in the same root', async () => {
  const f = await fixture()
  try {
    const nested = { callId: 'nested-side-effect', rootCallId: 'script-root', toolName: 'pwsh' }
    const started = await f.authorize(nested)
    await f.register(nested)
    const { approvalId: _approvalId, ...identity } = f.input
    const finish = { ...identity, ...nested, action: 'finish_execution', executionId: started.executionId }
    await assert.rejects(f.service.trackToolExecution({ ...finish, state: 'failed', resultHash: hash('IPC failed after tool execution') }), code('TASK_NOT_READY'))
    await assert.rejects(f.service.trackToolExecution({ ...finish, state: 'uncertain', resultHash: hash('must not claim a result') }), code('INVALID_COMMAND'))
    assert.equal((await f.request(`${f.approvalsPath}/${f.input.approvalId}`, { requestId: 'side-effect-answer', outcome: 'allowed-once' })).status, 200)
    assert.equal((await f.resolve('allowed-once', nested)).status, 'resolved')
    // The native decision was durable, but the executing plugin did not receive its success receipt.
    const observed = await f.service.trackToolExecution({ ...finish, state: 'uncertain' })
    assert.deepEqual(await f.service.trackToolExecution({ ...finish, state: 'uncertain' }), observed)
    const detail = (await f.request(`tasks/${f.source.commandId}`)).body
    assert.equal(detail.executionSteps[0].state, 'uncertain')
    assert.equal(Object.hasOwn(detail.executionSteps[0], 'resultHash'), false)
    assert.equal(Object.hasOwn(detail.executionSteps[0], 'finishedAt'), false)
    assert.equal(detail.control.state, 'uncertain')
    await assert.rejects(f.authorize({ ...nested, callId: 'nested-next' }), code('TASK_NOT_READY'))
    await assert.rejects(f.service.trackToolExecution({ ...finish, state: 'completed', resultHash: hash('invented success') }), code('REQUEST_CONFLICT'))
  } finally { await f.close() }
})

test('runtime closure seals a registration already awaiting describe without invalidating a later child', async () => {
  const f = await fixture()
  const entered = deferred(), release = deferred()
  try {
    let first = true
    f.describeHook(async () => { if (first) { first = false; entered.resolve(); await release.promise } })
    const late = f.register()
    const rejected = assert.rejects(late, code('TOOL_SOURCE_UNAVAILABLE'))
    await entered.promise
    const sealed = f.service.invalidateToolApprovals({ runtimeId: f.input.runtimeId, outcome: 'unavailable', reasonCode: 'RUNTIME_UNAVAILABLE' })
    const newRuntimeId = randomUUID(), newApprovalId = randomUUID()
    assert.equal((await f.register({ runtimeId: newRuntimeId, approvalId: newApprovalId, callId: 'new-child-call', rootCallId: 'new-child-call' })).status, 'pending')
    release.resolve()
    await rejected
    assert.equal((await sealed).invalidatedCount, 0)
    await f.service.invalidateToolApprovals({ runtimeId: f.input.runtimeId })
    const listed = await f.request(f.approvalsPath)
    assert.deepEqual(listed.body.approvals.map((row: any) => [row.approvalId, row.status]), [[newApprovalId, 'pending']])
    await assert.rejects(f.register(), code('TOOL_SOURCE_UNAVAILABLE'))
    await assert.rejects(f.authorize(), code('TOOL_SOURCE_UNAVAILABLE'))
  } finally { release.resolve(); await f.close() }
})

test('stopping an answered approval records cancellation and retains the original answer receipt without execution', async () => {
  const f = await fixture()
  try {
    await f.register()
    const decision = { requestId: 'stopped-answer', outcome: 'allowed-once' }
    const answer = await f.request(`${f.approvalsPath}/${f.input.approvalId}`, decision)
    const stopped = await f.request(`tasks/${f.source.commandId}/stop`, { requestId: 'approval-stop' })
    assert.equal(stopped.status, 202)
    const row = await f.read()
    assert.deepEqual([row.status, row.outcome, row.decisionOutcome], ['unavailable', 'cancelled', 'allowed-once'])
    assert.equal((await f.resolve('allowed-once')).status, 'unavailable')
    assert.deepEqual((await f.request(`${f.approvalsPath}/${f.input.approvalId}`, decision)).body, answer.body)
    assert.equal((await f.request(`${f.approvalsPath}/${f.input.approvalId}`, { requestId: 'late-stop-answer', outcome: 'rejected' })).status, 409)
    await assert.rejects(f.authorize(), code('TASK_NOT_READY'))
  } finally { await f.close() }
})

test('close and crash recovery invalidate unanswered or answered rows; historical native grants never replay', async () => {
  const f = await fixture()
  try {
    await f.register()
    const crashSnapshot = f.raw()
    await f.restart()
    assert.equal((await f.request(f.approvalsPath)).body.approvals[0].status, 'unavailable')
    assert.equal(JSON.parse(f.raw()).accounts[f.auth.account.ownerId].commands[f.source.commandId].toolApprovals[0].invalidationReason, 'service_closing')
    await f.restart(crashSnapshot)
    assert.equal((await f.request(f.approvalsPath)).body.approvals[0].status, 'unavailable')
    assert.equal(JSON.parse(f.raw()).accounts[f.auth.account.ownerId].commands[f.source.commandId].toolApprovals[0].invalidationReason, 'service_recovered')
    await assert.rejects(f.register(), code('TOOL_SOURCE_UNAVAILABLE'))
    const newInput = { runtimeId: randomUUID(), approvalId: randomUUID(), callId: 'native-grant', rootCallId: 'native-grant' }
    await f.register(newInput)
    assert.equal((await f.request(`${f.approvalsPath}/${newInput.approvalId}`, { requestId: 'native-grant-answer', outcome: 'allowed-once' })).status, 200)
    await f.resolve('allowed-once', newInput)
    await f.restart()
    const { approvalId: _id, ...executionInput } = newInput
    await assert.rejects(f.authorize({ ...executionInput, runtimeId: undefined }), code('TASK_NOT_READY'))
  } finally { await f.close() }
})

test('current-turn evidence is bounded, caches polling only, and user answering rechecks native terminal state', async () => {
  const now = Date.now(), f = await fixture({ clockFn: () => now })
  try {
    let proofReads = 0, historyReads = 0
    const read = f.backend.getTaskReplyEvidence
    f.backend.getTaskReplyEvidence = (input: any) => { proofReads++; return read(input) }
    f.backend.readEvents = async () => { historyReads++; throw new Error('full history must not be polled') }
    await f.register()
    await f.read(); await f.read()
    assert.equal(proofReads, 1)
    assert.equal(historyReads, 0)
    f.events.push({ seq: f.events.length, type: 'turn.ended', data: { turn: 1, reason: 'completed' } })
    const reply = await f.request(`${f.approvalsPath}/${f.input.approvalId}`, { requestId: 'terminal-answer', outcome: 'allowed-once' })
    assert.deepEqual([reply.status, reply.body.error.code], [409, 'APPROVAL_NOT_PENDING'])
    assert.equal((await f.read()).status, 'unavailable')
    assert.equal(proofReads, 2)
  } finally { await f.close() }
})

test('legacy history without receipt metadata does not claim or invalidate the current precise source', async () => {
  const f = await fixture({ useReplyEvidence: false })
  try {
    const current = f.events.splice(0)
    f.events.push({ seq: 0, type: 'user.message', data: { text: 'Old imported history without receipt' } },
      { seq: 1, type: 'turn.started', data: { turn: 0 } },
      { seq: 2, type: 'user.message', data: { text: 'Old ordinary turn' } },
      { seq: 3, type: 'turn.ended', data: { turn: 0, reason: 'completed' } },
      ...current.map((event, index) => ({ ...event, seq: index + 4 })))
    assert.equal((await f.register()).status, 'pending')
    assert.equal((await f.request(f.approvalsPath)).body.approvals[0].status, 'pending')
  } finally { await f.close() }
})

test('historical approvals are paged without duplication and the per-command ledger refuses capacity overflow', async () => {
  const f = await fixture()
  try {
    await f.register()
    const snapshot = JSON.parse(f.raw()), source = snapshot.accounts[f.auth.account.ownerId].commands[f.source.commandId]
    const template = source.toolApprovals[0]
    source.toolApprovals = Array.from({ length: 256 }, (_, index) => ({ ...template, approvalId: randomUUID(),
      callId: `historical-${index}`, rootCallId: `historical-${index}`, status: 'resolved', outcome: 'cancelled', resolvedAt: template.createdAt }))
    await f.restart(JSON.stringify(snapshot))
    const ids = new Set<string>()
    let before: string | null = null
    const lengths: number[] = []
    do {
      const page = await f.request(`${f.approvalsPath}?limit=100${before ? `&before=${before}` : ''}`)
      assert.equal(page.status, 200)
      lengths.push(page.body.approvals.length)
      for (const row of page.body.approvals) { assert.equal(ids.has(row.approvalId), false); ids.add(row.approvalId) }
      before = page.body.nextBefore
    } while (before)
    assert.deepEqual(lengths, [100, 100, 56])
    const stored = f.raw()
    await assert.rejects(f.register({ approvalId: randomUUID(), runtimeId: randomUUID(), callId: 'overflow', rootCallId: 'overflow' }), code('CAPACITY_LIMIT'))
    assert.equal(f.raw(), stored)
    assert.equal((await f.request(`${f.approvalsPath}?before=${randomUUID()}`)).status, 404)
  } finally { await f.close() }
})

test('source-device revocation invalidates an approval even when another current device of that account can read it', async () => {
  const f = await fixture()
  try {
    await f.register()
    await f.service.revokeDevice(f.auth.device.id)
    assert.equal((await f.request(f.approvalsPath)).status, 401)
    const login = await f.request('auth/login', { username: 'SyntheticApprovalOwner', password: 'synthetic approval fixture password', deviceName: 'Replacement synthetic phone' })
    assert.equal(login.status, 200)
    const headers = { cookie: login.cookie!, 'x-weftmate-csrf': login.body.csrfToken }
    const listed = await f.request(f.approvalsPath, undefined, headers)
    assert.deepEqual([listed.status, listed.body.approvals[0].status, listed.body.approvals[0].outcome], [200, 'unavailable', 'unavailable'])
    const late = await f.request(`${f.approvalsPath}/${f.input.approvalId}`, { requestId: 'revoked-answer', outcome: 'allowed-once' }, headers)
    assert.deepEqual([late.status, late.body.error.code], [409, 'APPROVAL_NOT_PENDING'])
    await assert.rejects(f.authorize(), code('TOOL_SOURCE_UNAVAILABLE'))
  } finally { await f.close() }
})

test('execution and approval ownership use the canonical model input digest when attachments expanded the message', async () => {
  const f = await fixture()
  try {
    const snapshot = JSON.parse(f.raw()), source = snapshot.accounts[f.auth.account.ownerId].commands[f.source.commandId]
    const canonicalHash = hash(`${sourceText}\n\nSynthetic reference material supplied to the model`)
    source.payload.modelInputHash = canonicalHash
    source.payloadHash = hash(JSON.stringify(source.payload))
    f.events[1].data.messageHash = canonicalHash
    await f.restart(JSON.stringify(snapshot))
    const nextRuntimeId = randomUUID()
    await assert.rejects(f.register({ runtimeId: nextRuntimeId }), code('TOOL_SOURCE_UNAVAILABLE'))
    assert.equal((await f.register({ runtimeId: nextRuntimeId, messageHash: canonicalHash })).status, 'pending')
    const reply = await f.request(`${f.approvalsPath}/${f.input.approvalId}`, { requestId: 'canonical-answer', outcome: 'allowed-once' })
    assert.equal(reply.status, 200)
    await f.resolve('allowed-once', { runtimeId: nextRuntimeId, messageHash: canonicalHash })
    await assert.rejects(f.authorize({ runtimeId: nextRuntimeId }), code('TOOL_SOURCE_UNAVAILABLE'))
    const started = await f.authorize({ runtimeId: nextRuntimeId, messageHash: canonicalHash })
    const { approvalId: _approvalId, ...identity } = f.input
    const finish = { ...identity, runtimeId: nextRuntimeId, action: 'finish_execution', executionId: started.executionId,
      state: 'completed', resultHash: hash('canonical result') }
    const stored = f.raw()
    await assert.rejects(f.service.trackToolExecution(finish), code('TOOL_SOURCE_UNAVAILABLE'))
    assert.equal(f.raw(), stored)
    assert.equal((await f.service.trackToolExecution({ ...finish, messageHash: canonicalHash })).state, 'completed')
  } finally { await f.close() }
})


test('22000+ step-heavy history approves the exact current source using only its bounded turn range', async () => {
  for (const native of [false, true]) {
    const f = await fixture({ useReplyEvidence: false })
    try {
      const current = f.events.splice(0), prefix: any[] = []
      for (let turn = 1; turn <= 1000; turn++) {
        prefix.push({ type: 'turn.started', data: { turn } },
          { type: 'user.message', data: { receiptId: `old-${turn}`, text: 'old goal' } })
        for (let step = 1; step <= 10; step++) prefix.push(
          { type: 'step.started', data: { turn, step } }, { type: 'step.completed', data: { turn, step } })
        prefix.push({ type: 'turn.ended', data: { turn, reason: 'completed' } })
      }
      f.input.turn = 1001; current[0].data.turn = 1001
      f.events.push(...prefix, ...current)
      for (let step = 1; step <= 400; step++) f.events.push({ type: 'step.completed', data: { turn: 1001, step } })
      f.events.forEach((event, seq) => { event.seq = seq })
      const reads: any[] = [], original = f.backend.readEvents
      f.backend.readEvents = (args: any) => { reads.push(args); return original(args) }
      let nativeReads = 0, sourceAdapter: any
      if (native) {
        const rows = f.events.map(event => ({ ...event, type: ({ 'turn.started': 'turn/start', 'turn.ended': 'turn/end',
          'user.message': 'user/message', 'step.started': 'step/start', 'step.completed': 'step/end' } as any)[event.type],
          data: event.type === 'user.message' ? { source: { kind: 'user', rpcId: event.data.receiptId },
            content: [{ type: 'text', text: event.data.text }] } : event.data }))
        const observed = new Proxy(rows, { get(target, key, receiver) {
          if (typeof key === 'string' && /^\d+$/.test(key)) nativeReads++
          return Reflect.get(target, key, receiver)
        } })
        const adapter = createDshSessionAdapter({ sessions: { list: async () => ({ result: { ok: true,
          value: { items: [{ sessionId: f.input.sessionId, origin: 'user', agentPreset: 'personal-remote' }] } } }) }, events: {} },
          { readLog: async () => observed })
        f.backend.readSourceEvents = ({ sessionId, turn, receiptId }: any) => adapter.sourceEvents(sessionId, { turn, receiptId })
        sourceAdapter = adapter
      }
      assert.equal((await f.register()).status, 'pending')
      const answer = await f.request(`${f.approvalsPath}/${f.input.approvalId}`,
        { requestId: 'long-history-answer', outcome: 'allowed-once' })
      assert.equal(answer.status, 200, JSON.stringify(answer.body))
      assert.equal((await f.resolve('allowed-once')).status, 'resolved')
      if (native) {
        assert.equal(reads.length, 0); assert.ok(nativeReads < 1000, `${nativeReads} native entry reads for two checks`)
      } else {
        assert.equal(reads.length, 6, 'three tail pages per fresh source check, independent of the 23000 old events')
        assert.ok(reads.every(args => args.afterSeq === undefined))
        assert.ok(reads.every(args => args.beforeSeq === undefined || args.beforeSeq >= prefix.length - 200))
      }
      if (native) {
        // The same long session also registers and answers a native question;
        // its binding is derived at the original question watermark.
        const watermark = f.events.length - 1
        const proof = questionSourceAsOf(await sourceAdapter.questionHistoryAsOf(f.input.sessionId, watermark), watermark)!
        const frame = { ...proof, sessionId: f.input.sessionId, questionRpcId: randomUUID(), sourceReady: true,
          questions: [{ id: 'format', header: 'Format', question: 'Which format?',
            options: [{ label: 'Markdown' }, { label: 'Text' }] }], nativeState: 'pending' }
        f.backend.listUserQuestions = async () => ({ runtimeId: f.input.runtimeId, questions: [frame] })
        f.backend.respondUserQuestion = async () => { frame.nativeState = 'answered'; return { accepted: true } }
        const { nativeState: _state, ...snapshot } = frame
        assert.equal((await f.service.trackUserQuestion({ ...snapshot,
          runtimeId: f.input.runtimeId, action: 'register_question' })).status, 'pending')
        const answered = await f.request(`sessions/${f.input.sessionId}/questions/${frame.questionRpcId}`,
          { requestId: 'long-history-question-answer', answer: { answers: [{ id: 'format', selected: ['Markdown'] }] } })
        assert.equal(answered.status, 200, JSON.stringify(answered.body))
        assert.equal(proof.sourceReceiptId, f.source.receiptId); assert.equal(proof.turn, 1001)
        assert.equal(reads.length, 0, 'neither interaction replays timeline pages')
        assert.ok(nativeReads < 2000, 'question source lookup also stays inside the current turn')
      }
      await assert.rejects(f.register({ approvalId: randomUUID(), turn: 1000 }), code('TOOL_SOURCE_UNAVAILABLE'))
    } finally { await f.close() }
  }
})
