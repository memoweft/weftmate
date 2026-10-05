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

test('history reads the official persisted API and refuses subagent sessions', async () => {
  let historyReads = 0
  const client = { sessions: {
    list: async () => ok({ items: [{ sessionId: 'ordinary', origin: 'user' }, { sessionId: 'child', origin: 'subagent' }] }),
    history: async () => { historyReads += 1; return ok({ events: [{ event: { seq: 11, type: 'turn/end', data: { reason: { kind: 'completed' } } } }], hasMore: false }) },
  }, events: {} }
  const adapter = createDshSessionAdapter(client)
  const page = await adapter.historyPage('ordinary', { afterSeq: 5, limit: 10 })
  assert.deepEqual(page.events.map((event: { seq: number }) => event.seq), [11])
  assert.equal(historyReads, 1)
  await assert.rejects(adapter.historyPage('child'), /resume failed/)
  assert.equal(historyReads, 1)
})

test('history walks older native pages and stops at the requested cursor without skipping the first page', async () => {
  const requested: Array<number | undefined> = []
  const entry = (seq: number) => ({ event: { seq, type: 'turn/end', data: { reason: { kind: 'completed' } } } })
  const client = { sessions: {
    list: async () => ok({ items: [{ sessionId: 'ordinary', origin: 'user' }] }),
    history: async ({ beforeSeq }: { beforeSeq?: number }) => {
      requested.push(beforeSeq)
      return ok(beforeSeq === undefined
        ? { events: [entry(20), entry(30)], hasMore: true }
        : { events: [entry(2), entry(5), entry(10)], hasMore: false })
    },
  }, events: {} }
  const adapter = createDshSessionAdapter(client)
  const first = await adapter.historyPage('ordinary', { afterSeq: -1, limit: 2 })
  assert.deepEqual(first.events.map((event: { seq: number }) => event.seq), [2, 5])
  assert.equal(first.nextSeq, 5)
  assert.equal(first.hasMore, true)
  assert.deepEqual(requested, [undefined, 20])
  requested.length = 0
  const middle = await adapter.historyPage('ordinary', { afterSeq: 10, limit: 2 })
  assert.deepEqual(middle.events.map((event: { seq: number }) => event.seq), [20, 30])
  assert.equal(middle.hasMore, false)
  assert.deepEqual(requested, [undefined, 20])
  requested.length = 0
  const tail = await adapter.historyPage('ordinary', { afterSeq: 20, limit: 2 })
  assert.deepEqual(tail.events.map((event: { seq: number }) => event.seq), [30])
  assert.deepEqual(requested, [undefined])
})

test('bounded native history refuses a truncated range and text truncation is explicit', async () => {
  const client = { sessions: {
    list: async () => ok({ items: [{ sessionId: 'ordinary', origin: 'user' }] }),
    history: async ({ beforeSeq }: { beforeSeq?: number }) => ok({ events: [{ event: {
      seq: beforeSeq === undefined ? 1000 : beforeSeq - 1,
      type: 'user/message', data: { source: { kind: 'user' }, message: { content: [{ type: 'text', text: 'x'.repeat(5000) }] } },
    } }], hasMore: true }),
  }, events: {} }
  await assert.rejects(createDshSessionAdapter(client).historyPage('ordinary', { afterSeq: -1, limit: 2 }),
    (error: Error & { code?: string }) => error.code === 'history-window-limited')
  const row = pageHistoryEvents([{ event: { seq: 1, type: 'user/message', data: { source: { kind: 'user' },
    message: { content: [{ type: 'text', text: 'x'.repeat(5000) }] } } } }], -1, 10).events[0]
  assert.equal(row.data.truncated, true)
  assert.equal(row.data.text.length, 4000)
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
