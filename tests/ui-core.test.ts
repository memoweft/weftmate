import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { desktopScript, desktopScriptPaths } from './helpers/desktop-ui-source.mjs'
const paths = desktopScriptPaths().filter(path => path.startsWith('ui-core/'))
const source = paths.map(desktopScript).join('\n;\n')
const response = (body: object, status = 200) => ({ ok: status < 400, status, json: async () => body })
function fixture(read: (path: string, options: any) => any = () => response({})) {
  const values = new Map<string, string>(), requests: Array<{ path: string; options: any }> = [], paints: Array<{ name: string; args: any[] }> = []
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
  const effects = new Proxy({}, { get: (_target, name: string) => (...args: any[]) => { paints.push({ name, args }); return name === 'readMessageDraft' ? '' : undefined } })
  let counter = 0
  const environment = { fetch: async (path: string, options: any = {}) => { requests.push({ path, options }); return read(path, options) }, storage,
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}` } }
  const context = { AbortSignal, URL, URLSearchParams, TextEncoder, Blob, DOMException, Intl, setTimeout, clearTimeout, setInterval, clearInterval }
  runInNewContext(source, context)
  const api = (context as any).WeftUiCore, core = api.create({ effects, ...environment })
  Object.assign(core.state, { csrfToken: 'synthetic-csrf', account: { ownerId: 'owner-test', username: 'Synthetic' }, ownerId: 'owner-test', device: { id: 'device-test' }, hostId: 'host-test', online: true,
    currentView: 'assistant', selectedSessionId: 'session-test', models: [{ id: 'local', name: '合成模型', configured: true }], modelProfileId: 'local', sessions: [{ sessionId: 'session-test', running: false, sendAvailable: true }], capabilities: { chat: { available: true } } })
  return { core, api, effects, environment, requests, paints, values }
}
const plain = (value: any) => JSON.parse(JSON.stringify(value))
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

test('core registers distinct actions, constructs independent stores and has no DOM dependency', () => {
  assert.doesNotMatch(source, /\b(?:document|window)\.|\bbyId\(|\.textContent\b|\.hidden\b|\.querySelector\b/)
  const f = fixture(), seen = new Set<string>()
  for (const factory of Object.values(f.api.factories) as any[]) for (const key of Object.keys(factory(f.core, f.effects, f.environment))) {
    assert.ok(!seen.has(key), `duplicate action ${key}`); seen.add(key)
  }
  const other = f.api.create({ effects: f.effects, ...f.environment })
  f.core.state.sessions.push({ sessionId: 'independent' })
  assert.equal(other.state.sessions.length, 0)
  assert.notEqual(f.core.memory.drafts, other.memory.drafts)
})

test('history accepts gaps, sorts by event sequence, rejects duplicates/foreign sessions and keeps the latest terminal', () => {
  const f = fixture()
  f.core.appendHistory([
    { seq: 15, sessionId: 'session-test', type: 'turn.ended', data: { reason: 'error', endReasonKind: 'max-tokens' } },
    { seq: 7, sessionId: 'session-test', type: 'turn.started', data: { turn: 1 } },
    { seq: 7, type: 'assistant.message', data: { text: 'duplicate' } },
    { seq: 22, sessionId: 'other', type: 'turn.started', data: {} },
  ])
  assert.equal(f.core.state.historyEvents.size, 2)
  assert.equal(f.core.state.turnStatus, 'error')
  assert.equal(f.core.state.turnEndReasonKind, 'max-tokens')
  assert.deepEqual(plain(f.paints.find(p => p.name === 'paintHistoryMessages')?.args[0]).map((e: any) => e.seq), [15, 7])
  f.core.appendHistory([{ seq: 3, type: 'turn.started', data: {} }])
  assert.equal(f.core.state.turnStatus, 'error', 'loading an older page must not revive a completed turn')
})

test('timeline merges a completed step/artifact into its existing step and never mutates event input', () => {
  const f = fixture(), events = [
    { seq: 7, at: '2026-10-08T08:00:02Z', type: 'artifact.created', data: { completedStep: { taskId: 'task-1', stepId: 'write-1', state: 'completed', summary: '写入报告' }, artifacts: [{ artifactId: 'file-1', fileName: '报告.md' }] } },
    { seq: 3, at: '2026-10-08T08:00:01Z', type: 'step.started', data: { taskId: 'task-1', stepId: 'write-1', state: 'running', summary: '写入报告' } },
  ]
  const saved = JSON.stringify(events), result = f.core.projectTimeline(events)
  assert.equal(result.groups.length, 1)
  assert.equal(result.groups[0].seq, 3)
  assert.equal(result.groups[0].steps.length, 1)
  assert.equal(result.groups[0].steps[0].state, 'completed')
  assert.equal(result.groups[0].steps[0].endAt, events[0].at)
  assert.equal(result.cards.at(-1).data.artifactId, 'file-1')
  assert.equal(JSON.stringify(events), saved)
})

test('history pages use host watermarks/cursors and keep stale reads out after a session switch', async () => {
  const pending = deferred(), f = fixture((path) => path.includes('beforeSeq=') ? response({ events: [{ seq: 20, type: 'assistant.message', data: { text: 'older' } }], nextBeforeSeq: null, hasOlder: false }) : pending.promise)
  const read = f.core.refreshHistory(true)
  pending.resolve(response({ events: [{ seq: 95, type: 'assistant.message', data: { text: 'recent' } }], nextSeq: 120, hasMore: false, nextBeforeSeq: 95, hasOlder: true }))
  f.core.refreshConversationTasks = async () => {}
  await read; assert.equal(f.core.state.afterSeq, 120)
  await f.core.loadOlderHistory(); assert.match(f.requests.at(-1)!.path, /beforeSeq=95&limit=100$/)
  assert.equal(f.core.state.afterSeq, 120, 'an older page must not change the forward watermark')
  const late = deferred()
  // Each instance uses its injected environment, so create a new in-flight fixture for the stale response.
  const g = fixture(() => late.promise), inFlight = g.core.refreshHistory(true)
  g.core.state.historyGeneration++; g.core.state.selectedSessionId = 'another-session'
  late.resolve(response({ events: [{ seq: 1, type: 'assistant.message', data: { text: 'wrong conversation' } }], nextSeq: 1, hasMore: false }))
  await inFlight; assert.equal(g.core.state.historyEvents.size, 0)
})

test('shared send/stop actions choose steer or queue and block unresolved submissions', async () => {
  const f = fixture(), commands: any[] = []
  f.core.submitCommand = async (...args: any[]) => { commands.push(args); return { state: 'accepted_by_dsh' } }
  await f.core.sendDraft('普通消息'); assert.equal(commands.at(-1)[1].mode, 'queue')
  f.core.state.sessions[0].running = true
  await f.core.sendDraft('调整目标'); assert.equal(commands.at(-1)[1].mode, 'steer')
  f.core.setMessageMode('queue'); await f.core.sendDraft('下一件事'); assert.equal(commands.at(-1)[1].mode, 'queue')
  f.core.state.unresolvedSubmission = true; await f.core.sendDraft('送达未确认时'); assert.equal(commands.length, 3)
  await f.core.stopCurrentTurn(); assert.equal(commands.at(-1)[0], 'session.cancel')
  const view = f.core.composerState('未发送的草稿')
  assert.equal(view.running, true); assert.equal(view.sendDisabled, false)
  f.core.state.online = false; assert.equal(f.core.composerState('草稿').sendDisabled, true)
})

test('question drafts keep native option order, exact labels and one single-choice answer', () => {
  const f = fixture(), context = f.core.approvalContext(), row = { questionRpcId: '00000000-0000-4000-8000-000000000021', questions: [{ id: 'q1', question: '采用哪种格式？', multiSelect: true, options: [{ label: '简要' }, { label: '完整' }] }] }
  f.core.chooseQuestionOption(context, row, 0, '完整', true)
  assert.deepEqual(plain(f.core.chooseQuestionOption(context, row, 0, '简要', true).selected), ['简要', '完整'])
  row.questions[0].multiSelect = false
  f.core.chooseQuestionOption(context, row, 0, '完整', true)
  const custom = f.core.setQuestionCustom(context, row, 0, '自己的回答')
  assert.deepEqual(plain(custom.selected), []); assert.equal(custom.custom, '自己的回答')
  assert.equal(f.core.validQuestionAnswer({ answers: [{ id: 'q1', selected: ['未知'] }] }, row.questions), false)
  assert.equal(f.core.sameQuestion({ ...row, createdAt: 'first' }, { ...row, createdAt: 'changed' }), false)
})

test('approval identity and terminal merges prevent a stale pending row from reopening a decision', () => {
  const f = fixture(), row = { approvalId: 'approval-test', sessionId: 'session-test', taskId: 'task-test', sourceCommandId: 'source-test', sourceReceiptId: 'rpc:test', callId: 'write', rootCallId: 'write', toolName: 'write', argumentsHash: 'a', createdAt: '2026-10-08T08:00:00Z', turn: 1, status: 'resolved' }
  assert.equal(f.core.sameApproval(row, { ...row, sourceReceiptId: 'rpc:other' }), false)
  assert.equal(f.core.mergeApproval({ row }, { ...row, status: 'pending' }).row.status, 'resolved')
  assert.equal(f.core.mergeApproval({ row }, { ...row, sourceReceiptId: 'rpc:different' }).authoritative, false)
})

test('resource pagination deduplicates calls, prefers captured snapshots and replaces old output versions', async () => {
  let reads = 0
  const f = fixture(() => response(++reads === 1 ? { outputs: [{ artifactId: 'old', fileName: '报告.md' }], sources: [{ key: 'file:README.md', kind: 'file', name: 'README.md', uses: [{ callId: 'read-1', path: '/tasks/task-1/sources/read-1' }] }], hasMore: true, nextSeq: 5 }
    : { outputs: [{ artifactId: 'new', fileName: '报告.md' }], sources: [{ key: 'file:README.md', kind: 'file', name: 'README.md', uses: [{ callId: 'read-1', path: '/sessions/session-test/events/5/detail' }, { callId: 'read-2', path: '/sessions/session-test/events/6/detail' }] }], hasMore: false, nextSeq: 7 }))
  const resources = await f.core.loadConversationResources()
  assert.equal(resources.outputs.length, 1); assert.equal(resources.outputs[0].artifact.artifactId, 'new')
  assert.equal(resources.sources[0].uses.length, 2)
  assert.equal(resources.sources[0].uses[0].path, '/tasks/task-1/sources/read-1')
  assert.match(f.requests[1].path, /afterSeq=5$/)
})

test('memory reads discard a response for another account and reset authenticated state', async () => {
  const f = fixture(() => response({ ownerId: 'owner-other', sources: [] }))
  await assert.rejects(f.core.readMemorySources('cognition', 'memory-test'), (error: any) => error.code === 'MEMORY_OWNER_MISMATCH')
  assert.equal(f.core.state.csrfToken, null); assert.equal(f.core.state.currentView, 'login')
  assert.equal(f.core.state.historyEvents.size, 0)
})

test('appearance persistence and session sorting work without a window or DOM', () => {
  const f = fixture(), prefs = f.core.appearance
  assert.equal(prefs.value.theme, 'system')
  prefs.set({ theme: 'dark', accent: 'purple', fontSize: '19' })
  assert.deepEqual(plain(f.api.createAppearance(f.environment.storage).value), { theme: 'dark', accent: 'purple', fontSize: '19' })
  const sessions = [{ sessionId: 'old', updatedAt: '2026-10-07T08:00:00Z' }, { sessionId: 'new', updatedAt: '2026-10-08T08:00:00Z' }]
  assert.deepEqual(plain(f.core.sortSessions(sessions)).map((s: any) => s.sessionId), ['new', 'old'])
  assert.equal(sessions[0].sessionId, 'old')
})

test('system settings are read once as data and sent through the existing protected routes', async () => {
  const f = fixture(path => response(path.endsWith('/system') ? { model: { state: 'ready' }, queue: { backgroundPending: 0 } } : path.endsWith('/models') ? { models: [] } : { mode: 'ask', backgroundModelProfileId: null }))
  f.core.state.currentView = 'account'; await f.core.refreshSystem()
  assert.equal(f.core.state.system.model.state, 'ready')
  assert.ok(f.paints.some(p => p.name === 'paintSystem'))
  await f.core.saveBackgroundModel('local')
  assert.equal(f.requests.at(-1)!.options.headers['X-WeftMate-CSRF'], 'synthetic-csrf')
  assert.deepEqual(JSON.parse(f.requests.at(-1)!.options.body), { backgroundModelProfileId: 'local' })
})

test('source references parse nested native arguments, deduplicate values and tolerate unavailable details', () => {
  const f = fixture()
  const refs = f.core.resourceReferences(JSON.stringify({ arguments: JSON.stringify({ paths: ['README.md', 'README.md'], url: 'https://example.test/', urls: ['https://example.test/'] }) }))
  assert.deepEqual(plain(refs), [{ kind: 'file', value: 'README.md', key: 'file:README.md' }, { kind: 'webpage', value: 'https://example.test/', key: 'webpage:https://example.test/' }])
  assert.deepEqual(plain(f.core.resourceReferences('unavailable')), [])
})

test('login input validation and protected transport do not need form elements', async () => {
  const f = fixture()
  await f.core.loginAccount({ username: '', password: 'synthetic-password', deviceName: 'Synthetic' })
  assert.equal(f.requests.length, 0)
  assert.ok(f.paints.some(p => p.name === 'loginError' && p.args[0].includes('请填写')))
  await f.core.requestJson('/personal/v1/commands', { method: 'POST', protectedWrite: true, body: { requestId: 'synthetic-id' } })
  assert.equal(f.requests[0].options.headers['X-WeftMate-CSRF'], 'synthetic-csrf')
  f.core.state.csrfToken = null
  await assert.rejects(f.core.requestJson('/personal/v1/commands', { method: 'POST', protectedWrite: true, body: {} }), (error: any) => error.code === 'UNAUTHORIZED')
})

test('model form validation and durable request recovery stay in core and never persist a credential', async () => {
  const f = fixture(); f.core.state.currentView = 'account'; f.core.state.accountModelsCanManage = true
  const input = { name: 'Synthetic', baseUrl: 'invalid-provider', modelId: 'synthetic', modelTier: 'auto', apiKey: 'synthetic-not-a-real-key' }
  await f.core.saveAccountModelDraft(input)
  assert.equal(f.requests.length, 0)
  assert.ok(f.paints.some(p => p.name === 'accountModelFormNotice' && p.args[0].includes('完整的模型服务地址')))
  f.core.accountModelReceipt = async () => ({ operation: { status: 'succeeded' } })
  await f.core.saveAccountModelDraft({ ...input, baseUrl: 'https://example.test/v1' })
  assert.ok(f.values.size > 0)
  assert.ok([...f.values.values()].every(value => !value.includes(input.apiKey)))
})

test('appearance keeps unknown saved fields while the control defaults stay stable', () => {
  const f = fixture()
  f.core.appearance.set({ theme: 'dark', accent: 'blue', fontSize: '17', legacyField: true })
  assert.equal(f.api.createAppearance(f.environment.storage).value.legacyField, true)
  assert.deepEqual(Object.keys(f.api.appearanceDefaults), ['theme', 'accent', 'fontSize'])
})
