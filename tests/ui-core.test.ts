import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { contextUsage, createDshSessionAdapter } from '../src/runtime/dsh-adapter/sessions.mjs'
import { desktopScript, desktopScriptPaths } from './helpers/desktop-ui-source.mjs'
const paths = desktopScriptPaths().filter(path => path.startsWith('ui-core/'))
const source = paths.map(desktopScript).join('\n;\n')
const response = (body: object, status = 200) => ({ ok: status < 400, status, json: async () => body })
function fixture(read: (path: string, options: any) => any = () => response({})) {
  const values = new Map<string, string>(), requests: Array<{ path: string; options: any }> = [], paints: Array<{ name: string; args: any[] }> = []
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
  const effects = new Proxy({}, { get: (_target, name: string) => (...args: any[]) => { paints.push({ name, args }); return name === 'readMessageDraft' ? '' : name === 'acceptApprovalRisk' ? true : undefined } })
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

test('D35 progress uses real kinds/objects and prioritizes failure and stopped states', () => {
  const { api } = fixture();
  const steps = [
    {toolName:'pwsh',state:'completed',summary:'运行命令 npm test'},
    {toolName:'read',state:'completed',summary:'读取 2 个文件',arguments:{paths:['a.md','b.md']}},
    {toolName:'grep',state:'running',summary:'搜索 approval'},
  ];
  assert.equal(api.progressText(steps).text, '正在搜索 approval…');
  assert.equal(api.progressText(steps, true).text, '已运行 1 个命令、读取了 2 个文件、搜索了 1 次');
  assert.equal(api.progressText([...steps, {state:'failed',ordinal:4}]).text, '第 4 步失败');
  assert.equal(api.progressText([{state:'cancelled'}]).text, '已停止');
  assert.equal(api.progressText([{state:'completed',jobState:'running',summary:'运行命令 npm test'}]).text,'正在运行命令 npm test…');
  assert.equal(api.progressText([{state:'completed',jobState:'killed'}]).text,'已停止');
  assert.equal(api.progressText([{state:'completed',jobState:'failed',ordinal:2}]).text,'第 2 步失败');
  assert.equal(api.progressText([]).text, '');
  const raw = JSON.stringify({arguments: JSON.stringify({command:'npm test'}),output:[{type:'tool-result',content:[{type:'text',text:'42 passed'}]}]});
  assert.match(api.executionDetailText(raw), /参数\n.*\n.*npm test[\s\S]*输出\n42 passed/);
  assert.equal(api.executionDetailText('plain output'), 'plain output');
});

test('D35 chronology splits only at visible conversation boundaries and approvals stay on their own step', () => {
  const { api } = fixture();
  const events = [
    {seq:1,type:'step.started',data:{taskId:'turn-1',stepId:'command',toolName:'pwsh',state:'running'}},
    {seq:2,type:'approval.requested',data:{taskId:'turn-1',callId:'command',approvalId:'approval-a'}},
    {seq:3,type:'step.completed',data:{taskId:'turn-1',stepId:'command',state:'completed'}},
    {seq:4,type:'step.completed',data:{taskId:'turn-1',stepId:'read',toolName:'read',state:'completed'}},
    {seq:5,type:'assistant.message',data:{text:'已读完，接着检查。'}},
    {seq:6,type:'step.completed',data:{taskId:'turn-1',stepId:'failure',state:'failed'}},
    {seq:7,type:'approval.requested',data:{approvalId:'missing-call-id'}},
  ];
  const copy = JSON.stringify(events), result = api.projectTimeline(events,[{callId:'command',turn:1,status:'answered',decisionOutcome:'allowed-once'}]);
  assert.equal(result.groups.length,2);
  assert.equal(result.groups[0].steps[0].approvalText,'已批准');
  assert.equal(result.groups[0].steps[1].approvalText,'');
  assert.equal(api.progressText(result.groups[1].steps).text,'第 3 步失败');
  assert.equal(JSON.stringify(events),copy);
});

test('running composer reports observed phases and hides them on an idle session without changing stop availability', () => {
  const f = fixture(), session: any = f.core.state.sessions[0]
  session.running = true
  for (const [processing, label] of [
    [{ phase: 'memory' }, '正在读取记忆…'],
    [{ phase: 'loading', modelName: 'Synthetic Muse' }, '正在加载模型 Synthetic Muse…'],
    [{ phase: 'queued', ahead: 2 }, '模型排队中，前面还有 2 个请求'],
    [{ phase: 'reasoning' }, '正在思考…'],
    [{ phase: 'answering' }, '正在回复…'],
    [null, '等待模型回复…'],
  ]) {
    session.processing = processing
    const view = f.core.composerState('')
    assert.equal(view.hint, label)
    assert.equal(view.cancelHidden, false)
    assert.equal(view.cancelDisabled, false)
  }
  session.running = false
  assert.equal(f.core.composerState('').hint, '')
})

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
  await f.core.sendDraft('普通消息'); assert.equal(commands.at(-1)[1].intent, 'queue')
  f.core.state.sessions[0].running = true
  await f.core.sendDraft('调整目标'); assert.equal(commands.at(-1)[1].intent, 'queue')
  f.core.setMessageMode('steer'); await f.core.sendDraft('引导调整'); assert.equal(commands.at(-1)[1].intent, 'steer')
  f.core.setMessageMode('queue'); await f.core.sendDraft('下一件事'); assert.equal(commands.at(-1)[1].intent, 'queue')
  f.core.state.unresolvedSubmission = true; await f.core.sendDraft('送达未确认时'); assert.equal(commands.length, 4)
  await f.core.stopCurrentTurn(); assert.equal(commands.at(-1)[0], 'session.cancel')
  const view = f.core.composerState('未发送的草稿')
  assert.equal(view.running, true); assert.equal(view.sendDisabled, true)
  f.core.state.unresolvedSubmission = false; assert.equal(f.core.composerState('草稿').sendDisabled, false)
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


test('UI-3 intent overrides do not change the composer selection and empty running drafts cannot send', async () => {
  const f = fixture(), sent: any[] = []
  f.core.state.sessions[0].running = true
  f.core.submitCommand = async (...args: any[]) => { sent.push(args); return {} }
  assert.equal(f.core.composerInputMode('session-test'), 'queue')
  await f.core.sendDraft('快捷键排队', 'queue')
  assert.equal(sent[0][1].intent, 'queue'); assert.equal(f.core.composerInputMode('session-test'), 'queue')
  f.core.setMessageMode('invalid'); assert.equal(f.core.composerInputMode('session-test'), 'queue')
  assert.equal(f.core.composerState('').sendDisabled, true)
  assert.equal(f.core.composerState('补充').sendText, '发送')
})

test('UI-3 queue projection follows sequence, batches, receipt reconciliation and terminal reasons', () => {
  const f = fixture()
  const queued = { seq: 2, type: 'task.queued', data: { tasks: [{ taskId: 'receipt-one', receiptId: 'receipt-one', text: '一' }, { taskId: 'task-two', text: '二' }] } }
  const started = { seq: 3, type: 'task.started', data: { taskId: 'task-one', receiptId: 'receipt-one' } }
  const commands = [{ kind: 'session.message', sessionId: 'session-test', commandId: 'task-one', receiptId: 'receipt-one' }]
  let rows = f.core.taskQueue([started, queued], commands)
  assert.deepEqual(plain(rows).map((r: any) => [r.taskId, r.state, r.text]), [['task-one', 'running', '一'], ['task-two', 'queued', '二']])
  rows = f.core.taskQueue([queued, started, { seq: 4, type: 'task.ended', data: { taskId: 'task-one', reason: 'completed' } },
    { seq: 5, type: 'task.ended', data: { taskId: 'task-two', reason: 'canceled' } }], commands)
  assert.deepEqual(plain(rows).map((r: any) => r.state), ['ended', 'cancelled'])
})

test('UI-3 cancel/edit retains request identity, handles 409 and never stops a running task', async () => {
  let status = 409
  const f = fixture(() => response(status === 409 ? { error: { code: 'TASK_NOT_READY' } } : { task: {} }, status))
  f.core.state.historyEvents.set(1, { seq: 1, type: 'task.queued', data: { taskId: 'task-one', text: '原目标' } })
  assert.equal(await f.core.cancelQueuedTask('task-one'), false)
  assert.equal(f.core.taskQueue()[0].notice, '已经开始，可以用停止')
  const original = JSON.parse(f.requests[0].options.body).requestId
  status = 202
  assert.equal(await f.core.editQueuedTask('task-one'), '原目标')
  assert.equal(JSON.parse(f.requests[1].options.body).requestId, original)
  assert.equal(f.core.taskQueue()[0].state, 'cancelled')
  assert.ok(f.requests.every(r => r.path.endsWith('/tasks/task-one/cancel')))
  f.core.state.historyEvents.set(2, { seq: 2, type: 'task.started', data: { taskId: 'task-one' } })
  assert.equal(await f.core.cancelQueuedTask('task-one'), false)
})

test('UI-3 stale cancellation cannot populate another account or conversation', async () => {
  const wait = deferred(), f = fixture(() => wait.promise)
  f.core.state.historyEvents.set(1, { seq: 1, type: 'task.queued', data: { taskId: 'task-one', text: '原目标' } })
  const pending = f.core.cancelQueuedTask('task-one')
  f.core.state.identityGeneration++; f.core.state.ownerId = 'other-owner'
  wait.resolve(response({ task: {} }, 202))
  assert.equal(await pending, false); assert.equal(f.core.taskQueue()[0].state, 'queued')
})

test('UI-3 stop targets the current root and leaves the later queue untouched', async () => {
  const f = fixture(() => response({ task: {} }, 202))
  f.core.state.sessions[0].running = true
  f.core.state.historyEvents.set(1, { seq: 1, type: 'task.started', data: { taskId: 'current-root' } })
  f.core.state.historyEvents.set(2, { seq: 2, type: 'task.queued', data: { taskId: 'next-root', text: '下一件事' } })
  await f.core.stopCurrentTurn()
  assert.ok(f.requests[0].path.endsWith('/tasks/current-root/stop'))
  assert.equal(f.core.taskQueue()[1].state, 'queued')
})

test('UI-3 approvals and sources share summaries for shell/files/web/subtask and unknown tools', () => {
  const f = fixture()
  for (const [tool, args, summary] of [
    ['shell', { command: 'npm test', cwd: 'D:/project' }, '运行命令：npm test（在 D:/project）'],
    ['delete_files', { paths: ['a.txt', 'b.txt', 'c.txt', 'd.txt'] }, '删除 4 个文件：a.txt、b.txt、c.txt…'],
    ['write', { file_path: 'out/report.md' }, '写入 1 个文件：report.md'],
    ['edit', { path: 'out/report.md' }, '修改 1 个文件：report.md'],
    ['web_fetch', { url: 'https://example.com/a' }, '访问网页 example.com'],
    ['subagent', { prompt: '核对结果' }, '交给子任务：核对结果'],
    ['custom_tool', { a: 1, b: 'two', c: true, d: 'omitted' }, 'custom_tool：a=1，b=two，c=true'],
  ] as any[]) {
    const text = JSON.stringify({ arguments: JSON.stringify(args) })
    assert.equal(f.core.toolSummary(tool, args), summary)
    assert.equal(f.core.sourcePresentation(tool, text).summary, summary)
    assert.equal(f.core.approvalPresentation({ toolName: tool, reason: JSON.stringify(args) }).summary, summary)
  }
  assert.equal(f.core.toolSummary('unknown', 'invalid json'), 'unknown')
  assert.equal(f.core.approvalPresentation({ toolName: 'write', reason: '[weftmate:overwrite] 覆盖报告，可从 Git 恢复。' }).summary, '覆盖报告，可从 Git 恢复。')
})

test('UI-3 outputs group by path, keep creation order and expose older versions', () => {
  const f = fixture()
  const rows = f.core.deduplicateOutputs([
    { artifactId: 'old', fileName: 'report.md', path: 'out/report.md', createdAt: '2026-10-01' },
    { artifactId: 'other', fileName: 'report.md', path: 'other/report.md', createdAt: '2026-10-03' },
    { artifactId: 'new', fileName: 'report.md', path: 'out/report.md', createdAt: '2026-10-02', updatedAt: '2026-10-02' },
  ])
  assert.equal(rows.length, 2); assert.equal(rows[0].artifact.artifactId, 'new'); assert.equal(rows[0].versions[0].artifactId, 'old')
})


test('UI-3 native approval reasons keep the risk prose and fold embedded raw parameters', () => {
  const f = fixture(), row = { toolName: 'pwsh', reason: '[weftmate:delete] 删除用户文件。操作：pwsh\n{"command":"Remove-Item a.txt"}' }
  const presentation = f.core.approvalPresentation(row)
  assert.equal(presentation.summary, '运行命令：Remove-Item a.txt')
  assert.equal(presentation.reason, '删除用户文件。操作：pwsh')
  assert.ok(presentation.raw.includes('{"command"'))
})


test('UI-3 attachment shortcuts respect unresolved submissions and restore the selected intent', async () => {
  const f = fixture(), intents: string[] = []
  f.core.state.sessions[0].running = true
  f.core.currentAttachmentDrafts = () => [{ attachmentId: 'fixture', file: {name:'fixture.txt',size:1,lastModified:1}, contentType:'text/plain' }]
  f.core.sendDesktopMessageWithAttachments = async () => { intents.push(f.core.composerInputMode('session-test')); return {} }
  f.core.state.unresolvedSubmission = true; await f.core.sendDraft('带附件排队', 'queue'); assert.equal(intents.length, 0)
  f.core.state.unresolvedSubmission = false; await f.core.sendDraft('带附件排队', 'queue')
  assert.deepEqual(intents, ['queue']); assert.equal(f.core.composerInputMode('session-test'), 'queue')
})

test('D36 switching conversations preserves the account running-input preference', async () => {
  const f = fixture()
  f.core.state.sessions.push({ sessionId: 'next-session', sendAvailable: true, running: true })
  f.core.refreshHistory = async () => {}; f.core.refreshApprovalMode = async () => {}; f.core.refreshConversationTasks = async () => {}
  f.core.setMessageMode('steer'); await f.core.selectSession('next-session')
  assert.equal(f.core.composerInputMode('next-session'), 'steer')
})

test('D36 account preferences survive recreation, isolate accounts and preserve temporary send overrides', async () => {
  const f = fixture(); f.core.state.sessions[0].running = true;
  assert.equal(f.core.composerInputMode('session-test'), 'queue');
  f.core.setMessageMode('steer');
  const reloaded = f.api.create({ effects: f.effects, ...f.environment });
  Object.assign(reloaded.state, { ownerId: 'owner-test', sessions: f.core.state.sessions });
  assert.equal(reloaded.composerInputMode('session-test'), 'steer');
  reloaded.state.ownerId = 'another-account';
  assert.equal(reloaded.composerInputMode('session-test'), 'queue');
  reloaded.setMessageMode('queue'); reloaded.state.ownerId = 'owner-test';
  assert.equal(reloaded.composerInputMode('session-test'), 'steer');
  f.core.submitCommand = async () => ({});
  await f.core.sendDraft('临时排队', 'queue');
  assert.equal(f.values.get('weftmate:message-mode:owner-test'), 'steer');
  f.core.state.sessions[0].running = false;
  assert.equal(f.core.composerInputMode('session-test'), 'queue');
})

test('D36 stage timer uses the latest persisted turn and omits unknown or future timestamps', () => {
  const f = fixture(), now = Date.parse('2026-10-09T00:01:16Z');
  const events = [{seq:1,type:'turn.started',at:'2026-10-09T00:00:00Z'}, {seq:4,type:'turn.started',at:'2026-10-09T00:01:00Z'}];
  assert.equal(f.core.processingStageLabel({phase:'loading',modelName:'Muse Q5'}, events, now),'正在加载模型 Muse Q5… 16 秒');
  assert.equal(f.core.processingStageLabel({phase:'reasoning'}, [], now),'正在思考…');
  assert.equal(f.core.processingStageLabel({phase:'reasoning'}, events, now-20000),'正在思考…');
})

test('D36 native account storage survives an origin change and rejects a late previous account read', async () => {
  const f = fixture(), nativeValues = new Map<string,string>();
  const messageModeStorage = async (key: string, value?: string) => {
    if (value !== undefined) nativeValues.set(key, value);
    return nativeValues.get(key);
  };
  const first = f.api.create({ effects:f.effects, ...f.environment, messageModeStorage });
  first.state.account = {ownerId:'owner-test'}; first.setMessageMode('steer'); await Promise.resolve();
  const second = f.api.create({ effects:f.effects, ...f.environment, storage:{getItem:()=>null,setItem(){}}, messageModeStorage });
  second.state.account = {ownerId:'owner-test'};
  await second.loadMessageModePreference(); assert.equal(second.messageModePreference(),'steer');
  const delayed = deferred();
  const switching = f.api.create({ effects:f.effects, ...f.environment, messageModeStorage:()=>delayed.promise });
  switching.state.account = {ownerId:'owner-test'}; const loading=switching.loadMessageModePreference();
  switching.state.identityGeneration++; switching.state.account={ownerId:'another-account'};switching.messageModePreference();
  delayed.resolve('steer');await loading;assert.equal(switching.messageModePreference(),'queue');
})
test('session lifecycle actions use protected writes and never enable an archived/read-only session by inference',async()=>{
  const f=fixture((url:string)=>({ok:true,json:async()=>url.endsWith('archived=all')?{sessions:[{sessionId:'session-test',archived:true,sendAvailable:false}]}:{archived:true}}));
  await f.core.archiveSession('session-test');assert.equal(f.core.composerState('hello').messageDisabled,true);assert.equal(f.core.sessionList().length,0);assert.equal(f.core.sessionList(true).length,1);
  const write=f.requests.find(r=>r.options.method==='POST')!;assert.equal(write.options.headers['X-WeftMate-CSRF'],'synthetic-csrf');assert.match(write.path,/\/archive$/);
});

test('UI-P4 native occupancy uses the projected current surface, never cumulative billing tokens', async()=>{
  assert.deepEqual(contextUsage({projectedTokens:713000,pressureTokens:800000,contextWindow:828000}),{usedTokens:713000,contextWindow:828000});
  assert.deepEqual(contextUsage({pressureTokens:12000}),{usedTokens:12000,contextWindow:null});
  assert.equal(contextUsage({projectedTokens:-1,contextWindow:828000}),null);
  const adapter=createDshSessionAdapter({events:{},sessions:{list:async()=>({result:{ok:true,value:{items:[
    {sessionId:'session-test',projections:{values:{contextPressure:{projectedTokens:7000,contextWindow:10000}}}},
    {sessionId:'subagent',origin:'subagent',projections:{values:{contextPressure:{projectedTokens:9}}}},
  ]}}})}});
  assert.deepEqual(await adapter.list(),[{sessionId:'session-test',title:'新对话',running:false,contextUsage:{usedTokens:7000,contextWindow:10000}}]);
  const {api}=fixture();
  assert.equal(api.contextUsageView({usedTokens:713000,contextWindow:828000}).label,'背景信息窗口：86% 已用');
  assert.equal(api.contextUsageView({usedTokens:12000}).detail,'已用 12k 标记，上限未知');
  assert.equal(api.contextUsageView({usedTokens:1200000,contextWindow:1500000}).detail,'已用 1.2M 标记，共 1.5M');
  assert.equal(api.contextUsageView(null).ratio,null);
});

test('UI-P4 shows an optimistic message before the host answers and blocks a duplicate click',async()=>{
  const pending=deferred(),f=fixture(()=>pending.promise);f.core.refreshTasks=async()=>{};f.core.refreshHistory=async()=>{};
  const send=f.core.sendDraft('立即出现');
  assert.equal(f.core.optimisticMessages()[0].text,'立即出现');assert.equal(f.core.optimisticMessages()[0].status,'sending');
  await f.core.sendDraft('立即出现');assert.equal(f.requests.filter(row=>row.options.method==='POST').length,1);
  const requestId=JSON.parse(f.requests[0].options.body).requestId;
  pending.resolve(response({command:{requestId,kind:'session.message',sessionId:'session-test',state:'accepted_by_dsh',receiptId:'native-rpc'}}));await send;
  assert.equal(f.core.optimisticMessages()[0].status,'accepted');
  f.core.observeOptimistic([{type:'user.message',data:{text:'立即出现',receiptId:'other-rpc'}}]);assert.equal(f.core.optimisticMessages().length,1);
  f.core.observeOptimistic([{type:'user.message',data:{text:'立即出现',receiptId:'native-rpc'}}]);assert.equal(f.core.optimisticMessages().length,0);
});

test('UI-P4 unconfirmed delivery retries the original request ID after checking the receipt',async()=>{
  let writes=0;const f=fixture((url,options)=>{
    if(options.method==='POST'){writes++;if(writes===1)throw Error('connection lost');const body=JSON.parse(options.body);return response({command:{requestId:body.requestId,sessionId:'session-test',state:'accepted_by_dsh',receiptId:'retry-rpc'}});}
    return response({error:{code:'NOT_FOUND'}},404);
  });f.core.refreshTasks=async()=>{};f.core.refreshHistory=async()=>{};
  await f.core.sendDraft('保留并重试');const row=f.core.optimisticMessages()[0];assert.equal(row.status,'failed');
  await f.core.retryOptimistic(row.requestId);
  const posted=f.requests.filter(row=>row.options.method==='POST').map(row=>JSON.parse(row.options.body));
  assert.equal(posted.length,2);assert.equal(posted[0].requestId,posted[1].requestId);assert.equal(row.status,'accepted');
});

test('UI-P4 a later confirmed task supersedes the original pending POST snapshot',async()=>{
  const f=fixture((_url,options)=>response({command:{requestId:JSON.parse(options.body).requestId,sessionId:'session-test',kind:'session.message',state:'pending'}}));
  f.core.refreshTasks=async()=>{const body=JSON.parse(f.requests[0].options.body);f.core.state.tasks=[{requestId:body.requestId,kind:'session.message',sessionId:'session-test',state:'accepted_by_dsh',receiptId:'confirmed-rpc'}];f.core.updateFromCommand(f.core.state.tasks[0]);};
  f.core.refreshHistory=async()=>{};await f.core.sendDraft('正式消息');assert.equal(f.core.optimisticMessages()[0].status,'accepted');
  f.core.observeOptimistic([{type:'user.message',data:{receiptId:'confirmed-rpc'}}]);assert.equal(f.core.optimisticMessages().length,0);
});

test('UI-P4 first message appears before session creation and survives an account boundary safely',async()=>{
  const pending=deferred(),f=fixture(()=>pending.promise);f.core.refreshTasks=async()=>{};
  f.core.startNewConversation();assert.equal(f.core.state.selectedSessionId,null);assert.equal(f.core.composerState('首条消息').sendDisabled,false);
  const send=f.core.sendDraft('首条消息');assert.equal(f.core.optimisticMessages()[0].sessionId,null);
  assert.equal(JSON.parse(f.requests.find(row=>row.options.method==='POST')!.options.body).kind,'session.create');
  f.core.state.identityGeneration++;f.core.state.ownerId='other-owner';
  pending.resolve(response({command:{requestId:'old-create',kind:'session.create',sessionId:'old-session',state:'accepted_by_dsh'}}));await send;
  assert.equal(f.core.optimisticMessages().length,0);assert.equal(f.core.state.selectedSessionId,null);
});

test('UI-P4 switching accounts during receipt lookup never retries the old account text',async()=>{
  const lookup=deferred(),f=fixture();f.core.accessApi=()=>lookup.promise;
  const row=f.core.beginOptimistic({sessionId:'session-test',requestId:'old-id',text:'原账户草稿',status:'failed'});
  const retry=f.core.retryOptimistic(row.requestId);f.core.state.identityGeneration++;f.core.state.ownerId='other-owner';
  lookup.resolve({command:null});await retry;
  assert.equal(f.requests.length,0);assert.equal(f.core.optimisticMessages().length,0);
});

test('UI-P4 a new draft reads the account approval mode and applies its chosen mode before sending',async()=>{
  const f=fixture(url=>response(url.endsWith('/settings/approvals')?{mode:'ask'}:{}));
  f.core.startNewConversation();await new Promise(done=>setTimeout(done,0));assert.equal(f.core.state.newConversationApprovalMode,'ask');
  await f.core.saveApprovalMode('plan');assert.equal(f.core.state.newConversationApprovalMode,'plan');
  const operations:string[]=[];
  f.core.submitCommand=async(kind,fields,_session,id)=>{operations.push(kind);return {requestId:id,kind,sessionId:'new-session',state:'accepted_by_dsh',receiptId:kind==='session.message'?'new-rpc':undefined};};
  f.core.refreshSessions=async()=>{};f.core.refreshHistory=async()=>{};f.core.refreshApprovalMode=async()=>{};
  f.core.selectSession=async id=>{f.core.state.selectedSessionId=id;f.core.state.newConversation=false;};
  f.core.accessApi=async(_path,options)=>{operations.push('approval-mode:'+options.body.mode);return {mode:options.body.mode};};
  await f.core.sendDraft('先出计划');assert.deepEqual(operations,['session.create','approval-mode:plan','session.message']);
});

test('UI-P4 starting another new conversation does not display an earlier uncreated failed message',async()=>{
  const f=fixture();f.core.refreshNewConversationApprovalMode=async()=>{};
  f.core.startNewConversation();f.core.beginOptimistic({sessionId:null,draftId:f.core.state.newConversationId,requestId:'failed-first',text:'旧草稿',status:'failed'});
  assert.equal(f.core.optimisticMessages().length,1);f.core.startNewConversation();assert.equal(f.core.optimisticMessages().length,0);
});

test('FIX-8 new desktop drafts clear phone selection, pagination and late handoff callbacks', async () => {
  const waiting = deferred(), f = fixture(path => path.includes('/shared') ? waiting.promise : response({mode:'auto'}));
  const conversationId = 'conversation-00000000-0000-4000-8000-000000000099';
  Object.assign(f.core.state,{syncAvailable:true,activeChatSource:'phone',selectedPhoneConversationId:conversationId,
    hasOlder:true,nextBeforeSeq:12,olderLoading:true,historyHasMore:true,turnEndReasonKind:'aborted'});
  f.core.state.phoneEvents=[{seq:1,conversationId,sourceDeviceId:'device-phone',kind:'conversation.created',payload:{title:'Phone'}}];
  const binding=f.core.refreshPhoneBinding(conversationId);
  f.core.startNewConversation();
  const draftId=f.core.state.newConversationId;
  waiting.resolve(response({source:'host',hostId:'host-test',conversationId,status:'active',binding:{sessionId:'session-test'}}));
  await binding;
  assert.equal(f.core.state.activeChatSource,'desktop');assert.equal(f.core.state.selectedPhoneConversationId,null);
  assert.equal(f.core.state.selectedSessionId,null);assert.equal(f.core.state.newConversation,true);
  assert.equal(f.core.state.hasOlder,false);assert.equal(f.core.state.nextBeforeSeq,null);assert.equal(f.core.state.olderLoading,false);
  assert.equal(f.core.state.historyHasMore,false);assert.equal(f.core.state.turnEndReasonKind,null);
  assert.equal(f.core.composerState('').phoneChat,false);assert.ok(f.paints.some(p=>p.name==='paintDesktopComposer'));
  f.core.startNewConversation();assert.notEqual(f.core.state.newConversationId,draftId);
});

test('FIX-8 stop notices count only the current conversation queued messages and confirm fallback receipts', async () => {
  for(const count of [0,2]){
    const f=fixture();f.core.state.sessions[0].running=true;
    f.core.state.historyEvents.set(1,{seq:1,type:'task.started',data:{taskId:'current-root'}});
    for(let n=0;n<count;n++)f.core.state.historyEvents.set(n+2,{seq:n+2,type:'task.queued',data:{taskId:`queue-${n}`}});
    f.core.state.historyEvents.set(9,{seq:9,type:'task.queued',data:{taskId:'cancelled-root'}});
    f.core.state.historyEvents.set(10,{seq:10,type:'task.ended',data:{taskId:'cancelled-root',reason:'cancelled'}});
    await f.core.stopCurrentTurn();
    assert.equal(f.paints.filter(p=>p.name==='toast').at(-1)?.args[0],count?'已停止当前回复，还有 2 条排队消息会继续':'已停止');
  }
  for(const state of ['pending','accepted_by_dsh']){
    const f=fixture();f.core.state.sessions[0].running=true;f.core.submitCommand=async()=>({state});
    await f.core.stopCurrentTurn();
    assert.equal(f.paints.filter(p=>p.name==='toast').length,state==='accepted_by_dsh'?1:0);
  }
});

test('FIX-8 refreshed session titles repaint the selected header after a local account is bound', async () => {
  const f=fixture(path=>response(path.includes('/sessions')?{sessions:[{sessionId:'session-test',title:'你好',sendAvailable:true}]}:{devices:[]}));
  f.core.acceptSession({account:{ownerId:'owner-test',username:'Synthetic'},device:{id:'device-test'},csrfToken:'renewed-after-binding'});
  await f.core.refreshSessions();
  assert.equal(f.core.state.selectedSessionId,'session-test');assert.equal(f.core.state.activeChatSource,'desktop');
  assert.equal(f.core.state.sessions[0].title,'你好');
  assert.deepEqual(plain(f.paints.filter(p=>p.name==='paintSelectedSession').at(-1)?.args),['session-test']);
});

test('FIX-8 an accepted creation observed before the pending POST snapshot still sends the first draft once', async () => {
  const f=fixture();f.core.startNewConversation();f.core.state.newConversationApprovalMode=null;
  const sends:string[]=[];
  f.core.refreshSessions=async()=>{};f.core.refreshHistory=async()=>{};
  f.core.selectSession=async id=>{f.core.state.selectedSessionId=id;f.core.state.newConversation=false;};
  f.core.submitCommand=async(kind,_fields,_session,requestId)=>{
    sends.push(kind);
    if(kind==='session.create'){
      f.core.updateFromCommand({kind,requestId,sessionId:'created-session',state:'accepted_by_dsh'});
      return {kind,requestId,sessionId:'created-session',state:'pending'};
    }
    return {kind,requestId,state:'accepted_by_dsh',receiptId:'first-rpc'};
  };
  await f.core.sendDraft('首条目标');
  assert.deepEqual(sends,['session.create','session.message']);
  assert.equal(f.core.state.selectedSessionId,'created-session');
  assert.equal(f.core.optimisticMessages()[0].status,'accepted');
});
test('a delayed lifecycle response cannot replace another account session list',async()=>{
  const pending=deferred(),f=fixture(()=>pending.promise);
  const work=f.core.archiveSession('session-test');f.core.state.identityGeneration++;f.core.state.sessions=[{sessionId:'other-account'}];pending.resolve({ok:true,json:async()=>({archived:true})});
  assert.equal(await work,false);assert.equal(f.core.state.sessions[0].sessionId,'other-account');
});


test('reminder reads work in the mobile settings category and discard a late account response', async () => {
  const pending = deferred();
  const f = fixture(path => path === '/personal/v1/schedules' ? pending.promise : response({}));
  f.core.state.currentView = 'schedules';
  const read = f.core.loadSchedules(); pending.resolve(response({ items: [{ id: 'fixture-reminder' }] }));
  assert.deepEqual(plain(await read), { items: [{ id: 'fixture-reminder' }] });
  const late = deferred(), switched = fixture(() => late.promise);
  switched.core.state.currentView = 'schedules'; const oldRead = switched.core.loadSchedules();
  switched.core.state.identityGeneration++; switched.core.state.account = { ownerId: 'other-owner' };
  late.resolve(response({ items: [{ id: 'old-owner-reminder' }] }));
  assert.equal(await oldRead, null);
});
