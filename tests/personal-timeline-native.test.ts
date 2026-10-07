import assert from 'node:assert/strict'
import test from 'node:test'
import { nativeTimelineLog, describeTool } from '../src/runtime/dsh-adapter/timeline.mjs'

test('native timeline reads the live immutable log or DSH inspected snapshot without activating a session', async () => {
  const events = Object.freeze([{ seq: 0, type: 'turn/start', data: { turn: 1 } }])
  let live = true, inspections = 0
  const read = nativeTimelineLog({ get(name: string) {
    return name === 'sessions' ? { get: () => live ? { events } : undefined }
      : { inspect: async () => { inspections++; return { events } } }
  } })
  assert.equal(await read('session'), events); assert.equal(inspections, 0)
  live = false
  assert.equal(await read('session'), events); assert.equal(inspections, 1)
})

test('timeline reads official live session events without adding unsupported durable types or reentering publication', async () => {
  const [{ Context }, { default: Sessions, KNOWN_SESSION_EVENT_TYPES }, { createDshSessionAdapter }] = await Promise.all([
    import('../vendor/dsh-runtime/node_modules/@deepseek-ai/cordis/lib/index.js'),
    import('../vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-session/lib/index.js'),
    import('../src/runtime/dsh-adapter/sessions.mjs'),
  ])
  const ctx = new Context()
  try {
    await ctx.plugin(Sessions)
    const seen: number[] = []
    ctx.on('session/event', (_session: any, event: any) => { seen.push(event.seq) })
    const session = ctx.sessions.create('timeline-publication')
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('tool/call', { turn: 1, step: 1, callId: 'save', name: 'personal_save_document', arguments: '{"fileName":"报告.md"}' })
    session.append('tool/result', { turn: 1, step: 1, message: { role: 'user', id: 'result-message', source: { kind: 'tool', callId: 'save' },
      content: [{ type: 'tool-result', toolCallId: 'save', content: [{ type: 'text', text: '{"artifactId":"file-native","fileName":"报告.md","size":20}' }] }] } }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const original = session.events
    const adapter = createDshSessionAdapter({ sessions: { list: async () => ({ result: { ok: true, value: { items: [{ sessionId: session.id }] } } }) }, events: {} }, { readLog: nativeTimelineLog(ctx) })
    const page = await adapter.historyPage(session.id)
    assert.deepEqual(page.events.map((event: any) => event.type), ['turn.started','task.started','step.started','artifact.created','task.ended','turn.ended'])
    assert.equal(page.events[3].data.completedStep.stepId, 'save')
    assert.ok(session.events.every((event: any) => KNOWN_SESSION_EVENT_TYPES.has(event.type)))
    assert.equal(session.events, original); assert.deepEqual(seen, [0,1,2,3,4,5])
  } finally { await ctx.fiber.dispose() }
})

test('human tool descriptions use tool names/parameters and retain a bounded generic fallback', () => {
  assert.equal(describeTool('read', { paths: ['a', 'b', 'c'] }), '读取 3 个文件')
  assert.equal(describeTool('pwsh', '{"command":"npm test"}'), '运行命令 npm test')
  assert.equal(describeTool('web_fetch', { url: 'https://example.com/report' }), '打开网页 example.com')
  assert.equal(describeTool('write'), '写入文件')
  assert.ok(describeTool('custom-tool', 'not-json').startsWith('执行工具'))
})
