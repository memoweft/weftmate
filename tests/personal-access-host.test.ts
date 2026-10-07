import assert from 'node:assert/strict'
import test from 'node:test'
import { createDshSessionAdapter, pageHistoryEvents } from '../src/runtime/dsh-adapter/sessions.mjs'
import { createPersonalAccessBackend } from '../src/personal-access-backend.mjs'

const ok = (value: unknown) => ({ result: { ok: true, value } })

test('durable history pagination keeps sparse DSH seq and excludes tools, injected context, paths and secrets', async () => {
  const entries = [
    { event: { seq: 2, type: 'user/message', data: { source: { kind: 'user' }, message: { content: [{ type: 'text', text: 'hello' }] } } } },
    { event: { seq: 3, type: 'user/message', data: { source: { kind: 'plugin' }, message: { content: [{ type: 'text', text: 'hidden context' }] } } } },
    { event: { seq: 7, type: 'tool/result', data: { text: 'private output' } } },
    { event: { seq: 9, type: 'assistant/chunk', data: { chunk: { type: 'reasoning-delta', text: 'private reasoning' } } } },
    { event: { seq: 12, type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: 'reply C:\\secret\\file /etc/passwd Bearer abc123 token=abc123' } } } },
    { event: { seq: 20, type: 'turn/end', data: { reason: { kind: 'aborted', error: 'private failure' } } } },
  ]
  const page1 = pageHistoryEvents(entries, -1, 2)
  assert.deepEqual(page1.events.map((event: { seq: number }) => event.seq), [2, 20])
  assert.equal(page1.nextSeq, 20)
  assert.equal(page1.hasMore, false)
  assert.doesNotMatch(JSON.stringify(page1), /hidden context|private output|private reasoning|C:\\secret|\/etc\/passwd|abc123/)
  const page2 = pageHistoryEvents(entries, page1.nextSeq, 2)
  assert.deepEqual(page2.events.map((event: { seq: number }) => event.seq), [])
  assert.equal(page2.nextSeq, 20)
  assert.equal(page2.hasMore, false)
  assert.deepEqual(pageHistoryEvents(entries, 20, 2), { events: [], nextSeq: 20, hasMore: false })
  const filtered = pageHistoryEvents(entries, 2, 1)
  assert.deepEqual(filtered.events.map((event: { seq: number }) => event.seq), [20])
  assert.equal(filtered.nextSeq, 20)
  assert.equal(filtered.hasMore, false)
  const onlyFiltered = pageHistoryEvents(entries.slice(1, 4), 2, 2)
  assert.deepEqual(onlyFiltered, { events: [], nextSeq: 9, hasMore: false })
  const large = Array.from({ length: 200 }, (_, index) => ({ event: { seq: index + 1, type: 'assistant/chunk',
    data: { chunk: { type: 'text-delta', text: '🙂'.repeat(2_000) } } } }))
  const bounded = pageHistoryEvents(large, -1, 200)
  assert.equal(bounded.hasMore, false)
  assert.equal(bounded.events.length, 0)
  assert.equal(bounded.nextSeq, 200)
  assert.ok(Buffer.byteLength(JSON.stringify(bounded), 'utf8') < 1024 * 1024)
  const native = pageHistoryEvents([
    { event: { seq: 30, type: 'user/message', data: { source: { kind: 'user' },
      content: [{ type: 'text', text: 'native user text' }] } } },
    { event: { seq: 31, type: 'assistant/message', data: { content: [{ type: 'text', text: 'native final reply' }] } } },
  ], -1, 10)
  assert.deepEqual(native.events.map((event: { type: string, data: { text?: string } }) =>
    [event.type, event.data.text]), [['user.message', 'native user text'], ['assistant.message', 'native final reply']])
  assert.match(native.events[0].data.messageHash, /^[a-f0-9]{64}$/)
  assert.equal(Object.hasOwn(native.events[1].data, 'messageHash'), false,
    'assistant history never carries the internal user-input proof hash')
})

test('many hidden deltas advance the scanned watermark without delaying an aborted turn', () => {
  const entries = [
    { event: { seq: 1, type: 'turn/start', data: { turn: 3 } } },
    ...Array.from({ length: 803 }, (_, index) => ({ event: { seq: index + 2, type: 'assistant/chunk',
      data: { turn: 3, chunk: { type: 'text-delta', text: 'hidden interim text' } } } })),
    { event: { seq: 805, type: 'turn/end', data: { turn: 3,
      reason: { kind: 'aborted', reason: { kind: 'user' } } } } },
  ]
  const page = pageHistoryEvents(entries, -1, 100)
  assert.deepEqual(page.events.map((entry: { type: string, data: { reason?: string } }) =>
    [entry.type, entry.data.reason]), [['turn.started', undefined], ['turn.ended', 'aborted']])
  assert.equal(page.nextSeq, 805)
  assert.equal(page.hasMore, false)
})

const rawMessage = (seq: number) => ({ seq, type: 'assistant/message', time: seq * 1000,
  data: { turn: 1, content: [{ type: 'text', text: `reply ${seq}` }] } })
function timelineAdapter(entries: any[]) {
  return createDshSessionAdapter({ sessions: { list: async () => ok({ items: [
    { sessionId: 'ordinary', origin: 'user' }, { sessionId: 'child', origin: 'subagent' } ] }) }, events: {} },
    { readLog: async () => entries })
}

test('2400+ event session opens the recent tail without inspecting its beginning and pages older/incremental', async () => {
  const entries = Array.from({ length: 2600 }, (_, seq) => rawMessage(seq)), reads: number[] = []
  const observed = new Proxy(entries, { get(target, key, receiver) {
    if (typeof key === 'string' && /^\d+$/.test(key)) reads.push(Number(key))
    return Reflect.get(target, key, receiver)
  } })
  const adapter = timelineAdapter(observed)
  const tail = await adapter.historyPage('ordinary', { limit: 50 })
  assert.deepEqual(tail.events.map((e: any) => e.seq), Array.from({ length: 50 }, (_, i) => 2550 + i))
  assert.equal(tail.nextSeq, 2599); assert.equal(tail.hasOlder, true); assert.equal(tail.hasMore, false)
  assert.equal(tail.nextBeforeSeq, 2550); assert.ok(Math.min(...reads.filter(seq => seq !== 0)) >= 2549); assert.ok(reads.filter(seq => seq === 0).length <= 2)
  const older = await adapter.historyPage('ordinary', { beforeSeq: tail.nextBeforeSeq, limit: 50 })
  assert.equal(older.events[0].seq, 2500); assert.equal(older.events.at(-1).seq, 2549)
  assert.equal(older.nextSeq, 2599)
  entries.push(rawMessage(2600), rawMessage(2601))
  const increment = await adapter.historyPage('ordinary', { afterSeq: tail.nextSeq, limit: 50 })
  assert.deepEqual(increment.events.map((e: any) => e.seq), [2600, 2601]); assert.equal(increment.hasMore, false)
  await assert.rejects(adapter.historyPage('child'), /resume failed/)
})

test('old explicit afterSeq=-1 reads every page forwards, keeping sparse hidden seq watermarks', async () => {
  const entries = Array.from({ length: 2500 }, (_, seq) => seq % 3 === 0 ? rawMessage(seq)
    : ({ seq, type: 'assistant/chunk', data: { chunk: { type: 'reasoning-delta', text: 'private' } } }))
  const adapter = timelineAdapter(entries); let cursor = -1; const seen: number[] = []
  while (true) { const page = await adapter.historyPage('ordinary', { afterSeq: cursor, limit: 51 })
    seen.push(...page.events.map((e: any) => e.seq)); assert.ok(page.nextSeq > cursor)
    cursor = page.nextSeq; if (!page.hasMore) break }
  assert.deepEqual(seen, entries.filter(e => e.type === 'assistant/message').map(e => e.seq))
  assert.equal(cursor, 2499)
  assert.deepEqual((await adapter.historyPage('ordinary', { afterSeq: cursor })).events, [])
})

test('byte paging truncates a huge event and returns all 200 large messages without a failed page', async () => {
  const entries = Array.from({ length: 200 }, (_, seq) => ({ ...rawMessage(seq),
    data: { content: [{ type: 'text', text: '中'.repeat(seq === 0 ? 2_000_000 : 4000) }] } }))
  const adapter = timelineAdapter(entries); const seen: number[] = []; let afterSeq = -1
  while (true) { const page = await adapter.historyPage('ordinary', { afterSeq, limit: 200 })
    assert.ok(Buffer.byteLength(JSON.stringify(page)) < 1024 * 1024)
    seen.push(...page.events.map((e: any) => e.seq)); if (!page.hasMore) break; afterSeq = page.nextSeq }
  assert.equal(seen.length, 200)
  const first = await adapter.historyPage('ordinary', { afterSeq: -1, limit: 1 })
  assert.equal(first.events[0].data.truncated, true); assert.equal(first.events[0].data.text.length, 4000)
})

test('native lifecycle, interactions, artifact results and reserved queue projection share distinct seq', async () => {
  const entries: any[] = [
    { seq: 0, type: 'step/start', data: { turn: 1, step: 1 } },
    { seq: 1, type: 'tool/call', time: 1000, data: { turn: 1, callId: 'c1', name: 'shell', arguments: '{"command":"npm test"}' } },
    { seq: 2, type: 'approval/asked', data: { id: 'a1', callId: 'c1', toolName: 'shell', reason: '删除临时文件' } },
    { seq: 3, type: 'approval/decided', data: { id: 'a1', outcome: 'allowed-once' } },
    { seq: 4, type: 'tool/result', time: 2500, data: { turn: 1, message: { source: { kind: 'tool', callId: 'c1' },
      content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'reasoning', text: 'private tool reasoning' }, { type: 'text', text: '42 tests passed' }] }] } } },
    { seq: 5, type: 'tool/call', data: { turn: 1, callId: 'q1', name: 'ask_user_question', arguments: '{"questions":[{"id":"q","question":"保存到哪里？"}]}' } },
    { seq: 6, type: 'tool/result', data: { turn: 1, message: { source: { callId: 'q1' }, content: [{ type: 'tool-result', toolCallId: 'q1' }] } } },
    { seq: 7, type: 'tool/call', data: { turn: 1, callId: 'save1', name: 'personal_save_document', arguments: '{"fileName":"报告.md"}' } },
    { seq: 8, type: 'tool/result', data: { turn: 1, message: { source: { callId: 'save1' }, content: [{ type: 'tool-result', toolCallId: 'save1', content: [{ type: 'text', text: '{"artifactId":"file-1","fileName":"报告.md","size":20}' }] }] } } },
    { seq: 9, type: 'task.queued', data: { taskId: 'reserved-task' } },
    { seq: 10, type: 'step/end', data: { turn: 1, step: 1 } },
    { seq: 11, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  const adapter = timelineAdapter(entries), page = await adapter.historyPage('ordinary', { afterSeq: -1 })
  assert.deepEqual(page.events.map((e: any) => e.type), ['task.started', 'step.started', 'approval.requested', 'approval.resolved',
    'step.completed', 'question.asked', 'question.answered', 'step.started', 'artifact.created', 'task.queued', 'task.ended', 'turn.ended'])
  assert.equal(page.events[1].data.summary, '运行命令 npm test')
  assert.equal(page.events[4].data.stepId, page.events[1].data.stepId)
  assert.equal(page.events[4].data.summary, page.events[1].data.summary)
  assert.equal(page.events[8].data.completedStep.stepId, 'save1')
  assert.doesNotMatch(JSON.stringify(page), /42 tests passed/)
  const detail = await adapter.historyDetail('ordinary', 4)
  assert.match(detail.text, /npm test.*42 tests passed/s)
  assert.doesNotMatch(detail.text, /private tool reasoning/)
  await assert.rejects(adapter.historyDetail('ordinary', 11))
  await assert.rejects(adapter.historyPage('ordinary', { afterSeq: -1, beforeSeq: 2 }))
})

test('empty/hidden histories advance correctly and zero beforeSeq is an empty older page', async () => {
  const adapter = timelineAdapter([{ seq: 0, type: 'assistant/chunk', data: {} }, { seq: 1, type: 'request/header', data: {} }])
  const tail = await adapter.historyPage('ordinary')
  assert.equal(tail.events.length, 0); assert.equal(tail.hasOlder, false); assert.equal(tail.nextSeq, 1)
  assert.equal((await adapter.historyPage('ordinary', { beforeSeq: 0 })).events.length, 0)
  assert.equal((await adapter.historyPage('ordinary', { afterSeq: -1 })).nextSeq, 1)
})

test('host callbacks preflight selected model and ownership before dispatch; create binds then selects', async () => {
  const calls: string[] = []
  const profile = { id: 'model-a', name: 'A', model: 'synthetic' }
  let credential = true
  let known = true
  let createdSession = false
  let catalogRoute = true
  const backend = createPersonalAccessBackend({
    currentOrigin: () => 'http://127.0.0.1:50123', referenceScan: () => ({ state: 'ready' }),
    profiles: () => [profile], hasCredential: () => credential,
    routeForProfile: () => ({ provider: 'weftmate-a' }),
    listSessions: async () => ({ items: [{ sessionId: 'session-a', title: 'Synthetic', running: false, agentPreset: 'personal-remote' },
      { sessionId: 'old-session', title: 'Old', running: true, agentPreset: 'standard' },
      ...(createdSession ? [{ sessionId: 'session-new', title: 'New', running: false, agentPreset: 'personal-remote' }] : [])] }),
    resolveSession: async () => { if (!known) throw Object.assign(new Error('unknown'), { code: 'session-model-ownership-unknown' }); return { profile } },
    ensureKnownSession: async () => { calls.push('ownership') },
    gateway: async (path: string, init?: { method?: string }) => {
      if (path === '/models') return { groups: catalogRoute ? [{ id: 'weftmate-a', models: [{ id: 'synthetic' }] }] : [] }
      calls.push(`${init?.method ?? 'GET'} ${path}`)
      if (path === '/sessions') { createdSession = true; return { sessionId: 'session-new' } }
      if (path.endsWith('/messages')) return { accepted: true }
      return {}
    },
    queue: async (task: () => Promise<unknown>) => task(), bindSession: () => { calls.push('bind') },
  })
  await backend.preflight({ kind: 'session.create', modelProfileId: 'model-a' })
  catalogRoute = false
  await assert.rejects(backend.preflight({ kind: 'session.create', modelProfileId: 'model-a' }),
    (error: Error & { code?: string }) => error.code === 'MODEL_UNAVAILABLE')
  await assert.rejects(backend.createSession({ sessionId: 'session-missing-route', modelProfileId: 'model-a' }),
    (error: Error & { code?: string }) => error.code === 'MODEL_UNAVAILABLE')
  assert.deepEqual(calls, [], 'missing official provider is rejected before DSH session creation')
  catalogRoute = true
  credential = false
  await assert.rejects(backend.preflight({ kind: 'session.create', modelProfileId: 'model-a' }), (error: Error & { code?: string }) => error.code === 'MODEL_UNAVAILABLE')
  credential = true
  assert.deepEqual(await backend.createSession({ sessionId: 'session-new', modelProfileId: 'model-a' }), { sessionId: 'session-new' })
  assert.deepEqual(calls.slice(0, 3), ['POST /sessions', 'bind', 'PUT /sessions/session-new/models'])
  calls.length = 0
  known = false
  await assert.rejects(backend.preflight({ kind: 'session.message', sessionId: 'session-a', text: 'hello' }), (error: Error & { code?: string }) => error.code === 'SESSION_UNAVAILABLE')
  assert.deepEqual(calls, [])
  known = true
  const sent = await backend.sendMessage({ sessionId: 'session-a', text: 'hello', mode: 'queue' })
  assert.deepEqual(sent, { accepted: true })
  assert.deepEqual(calls, ['ownership', 'POST /sessions/session-a/resume', 'POST /sessions/session-a/messages'])
  calls.length = 0
  await assert.rejects(backend.preflight({ kind: 'session.message', sessionId: 'old-session', text: 'unsafe' }),
    (error: Error & { code?: string }) => error.code === 'SESSION_READ_ONLY')
  await backend.cancelSession({ sessionId: 'old-session' })
  assert.deepEqual(calls, ['POST /sessions/old-session/cancel'], 'cancel never resumes the old broad preset')
})

test('configured chat and restricted desktop capability stay separate from real tool verification', async () => {
  const backend = createPersonalAccessBackend({
    currentOrigin: () => 'http://127.0.0.1:12345', referenceScan: () => ({ state: 'ready' }),
    profiles: () => [{ id: 'local', name: 'Local', model: 'occamy-miniplus-v21' }],
    hasCredential: () => true, routeForProfile: () => ({ provider: 'local' }),
    listSessions: async () => ({ items: [] }), resolveSession: async () => null,
    ensureKnownSession: async () => {}, gateway: async (path: string) => path === '/models'
      ? { groups: [{ id: 'local', models: [{ id: 'occamy-miniplus-v21' }] }] } : {},
    queue: async (work: () => Promise<unknown>) => work(),
    bindSession: () => {}, desktopTask: { preflight: async () => {}, open: async () => ({ accepted: true }) },
    naturalLanguageDesktopReady: () => true, naturalLanguageDesktopVerified: () => false,
  })
  const status = await backend.getStatus()
  assert.equal(status.capabilities.chat.available, true)
  assert.equal(status.capabilities.chat.inferenceVerified, false)
  assert.equal(status.capabilities.desktopOpenApp.available, true)
  assert.equal(status.capabilities.naturalLanguageDesktop.available, true)
  assert.equal(status.capabilities.naturalLanguageDesktop.inferenceVerified, false)
})

test('document artifact preflight permits only the original owner and restricted session', async () => {
  const backend = createPersonalAccessBackend({
    currentOrigin: () => 'http://127.0.0.1:12345', referenceScan: () => ({ state: 'ready' }),
    profiles: () => [], hasCredential: () => false, routeForProfile: () => ({ provider: 'unused' }),
    hostOwnerId: () => 'owner-a',
    listSessions: async () => ({ items: [
      { sessionId: 'remote-session', agentPreset: 'personal-remote' },
      { sessionId: 'legacy-session', agentPreset: 'standard' },
    ] }),
    resolveSession: async () => ({ profile: { id: 'unused' } }),
    ensureKnownSession: async () => {}, gateway: async () => ({}),
    queue: async (work: () => Promise<unknown>) => work(), bindSession: () => {},
  })
  assert.deepEqual(await backend.preflight({ kind: 'desktop.write_artifact',
    ownerId: 'owner-a', sessionId: 'remote-session' }), { ok: true })
  await assert.rejects(backend.preflight({ kind: 'desktop.write_artifact',
    ownerId: 'owner-b', sessionId: 'remote-session' }),
  (error: Error & { code?: string }) => error.code === 'CAPABILITY_UNAVAILABLE')
  await assert.rejects(backend.preflight({ kind: 'desktop.write_artifact',
    ownerId: 'owner-a', sessionId: 'legacy-session' }),
  (error: Error & { code?: string }) => error.code === 'SESSION_READ_ONLY')
})


test('parallel tool completion metadata visits source ranges once across 3000-event pagination', async () => {
  const entries = [
    ...Array.from({ length: 1500 }, (_, seq) => ({ seq, type: 'tool/call', data: { turn: 1, callId: `c${seq}`, name: 'pwsh', arguments: '{"command":"npm test"}' } })),
    ...Array.from({ length: 1500 }, (_, i) => ({ seq: 1500+i, type: 'tool/result', data: { turn: 1, message: { source: { callId: `c${i}` }, content: [{ type: 'tool-result', toolCallId: `c${i}` }] } } })),
  ]
  let reads = 0
  const observed = new Proxy(entries, { get(target, key, receiver) { if (typeof key === 'string' && /^\d+$/.test(key)) reads++; return Reflect.get(target,key,receiver) } })
  const adapter = timelineAdapter(observed); let afterSeq = 1499, count = 0
  while (true) { const page = await adapter.historyPage('ordinary', { afterSeq, limit: 100 })
    assert.ok(page.events.every((e: any) => e.data.summary === '运行命令 npm test'))
    count += page.events.length; if (!page.hasMore) break; afterSeq = page.nextSeq }
  assert.equal(count, 1500); assert.ok(reads < 20_000, `source reads ${reads} must stay linear`)
})


test('incremental cursor waits for a pending native step end, then publishes the correct terminal without skipping seq', async () => {
  const entries: any[] = [{ seq: 0, type: 'turn/start', data: { turn: 1 } },
    { seq: 1, type: 'step/start', data: { turn: 1, step: 1 } }, rawMessage(2),
    { seq: 3, type: 'step/end', data: { turn: 1, step: 1 } }]
  const adapter = timelineAdapter(entries)
  const first = await adapter.historyPage('ordinary')
  assert.equal(first.nextSeq, 2); assert.equal(first.latestSeq, 3)
  assert.equal((await adapter.historyPage('ordinary', { afterSeq: 2 })).nextSeq, 2)
  entries.push({ seq: 4, type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted' } } })
  const closed = await adapter.historyPage('ordinary', { afterSeq: 2 })
  assert.deepEqual(closed.events.map((e: any) => [e.seq,e.type]), [[3,'task.ended'],[4,'turn.ended']])
  assert.equal(closed.events[0].data.reason, 'aborted'); assert.equal(closed.nextSeq, 4)
})

test('an intermediate model step end does not end its task and only new raw events update the lifecycle cut', async () => {
  const entries: any[] = [{ seq: 0, type: 'step/start', data: { turn: 1, step: 1 } },
    { seq: 1, type: 'step/end', data: { turn: 1, step: 1 } }]
  const adapter = timelineAdapter(entries)
  assert.equal((await adapter.historyPage('ordinary')).nextSeq, 0)
  entries.push({ seq: 2, type: 'step/start', data: { turn: 1, step: 2 } })
  const next = await adapter.historyPage('ordinary', { afterSeq: 0 })
  assert.equal(next.events.length, 0); assert.equal(next.nextSeq, 2)
})
