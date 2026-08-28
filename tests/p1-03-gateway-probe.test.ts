/**
 * P1-03 L2-style deterministic headless probe.  The probe client below uses
 * HTTP/SSE exclusively under /weftmate/api/v1; the fake DSH client is only
 * injected into the Gateway composition, never accessed by the probe.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { describe, test } from 'node:test'
import { createGatewayV1 } from '../src/runtime/gateway/routes/v1.mjs'

const ok = (value: unknown) => ({ result: { ok: true, value } })
const fail = (code: string, detail: unknown) => ({ result: { ok: false, error: { code, detail } } })

function fakeDsh() {
  const pending: Array<(value: IteratorResult<unknown>) => void> = []
  const frames: unknown[] = [{ payload: { type: 'session/subscribed', sessionId: 's-1' } }]
  let seq = 0
  function push(event: unknown) {
    const frame = { payload: { type: 'session/event', sessionId: 's-1', event } }
    const resolve = pending.shift(); if (resolve) resolve({ value: frame, done: false }); else frames.push(frame)
  }
  const client = {
    sessions: {
      create: async () => ok({ sessionId: 's-1' }),
      list: async () => ok({ items: [{ sessionId: 's-1', origin: undefined }] }),
      history: async () => ok({ events: [] }),
      prompt: async ({ content }: any) => {
        if (content === 'cause-error') return fail('internal', { secret: 'sk-hidden-probe-secret', stack: 'private stack' })
        if (content === 'cancel-turn') return ok({ accepted: true })
        push({ type: 'assistant/chunk', seq: ++seq, data: { turn: 1, chunk: { type: 'text-delta', text: 'one ' } } })
        push({ type: 'assistant/chunk', seq: ++seq, data: { turn: 1, chunk: { type: 'text-delta', text: 'two' } } })
        push({ type: 'tool/call', seq: ++seq, data: { turn: 1, callId: 'c-ok', name: 'read', arguments: 'SECRET=never' } })
        push({ type: 'tool/result', seq: ++seq, data: { turn: 1, message: { source: { callId: 'c-ok' }, content: [{ type: 'tool-result', toolCallId: 'c-ok', isError: false, text: 'private result' }] } } })
        push({ type: 'tool/call', seq: ++seq, data: { turn: 1, callId: 'c-fail', name: 'shell' } })
        push({ type: 'tool/result', seq: ++seq, data: { turn: 1, error: { stack: 'hidden' }, message: { source: { callId: 'c-fail' }, content: [{ type: 'tool-result', toolCallId: 'c-fail', isError: true }] } } })
        push({ type: 'assistant/message', seq: ++seq, data: { turn: 1, message: { content: [{ type: 'text', text: 'completed safely' }] } } })
        return ok({ accepted: true })
      },
      cancel: async () => {
        push({ type: 'turn/end', seq: ++seq, data: { turn: 2, reason: { kind: 'aborted' } } })
        push({ type: 'assistant/message', seq: ++seq, data: { turn: 2, message: { content: [{ type: 'text', text: 'must not leak as complete' }] } } })
        return ok({ accepted: true })
      },
    },
    events: {
      mux: () => ({
        [Symbol.asyncIterator]: () => ({ next: () => frames.length ? Promise.resolve({ value: frames.shift(), done: false }) : new Promise((resolve) => pending.push(resolve)) }),
      }),
      host: () => ({ [Symbol.asyncIterator]: async function* () {} }),
    },
    // P1-04 面的最小桩：Gateway 组合要求完整客户端；本探针只打会话面。
    workspace: {
      list: async () => ok({ items: [], archivedSessionIds: [] }),
      create: async ({ path }: any) => ok({ workspace: { workspaceId: 'ws-probe', path, title: 'probe' }, created: true }),
      rename: async ({ workspaceId, title }: any) => ok({ workspace: { workspaceId, title } }),
      delete: async () => ok({ deleted: true }),
    },
    llm: {
      providers: async () => ok({ providers: [] }),
      models: async () => ok({ groups: [], failures: [] }),
      discoverModels: async () => ok({ models: [] }),
    },
    settings: {
      describe: async () => ok({ writable: true, hasDocument: false, namespaces: [{ ns: 'permission', schema: {}, value: {}, applies: 'live', secrets: [], revision: 1 }] }),
      update: async (value: any) => ok({ ns: value?.ns ?? 'permission', schema: {}, value: {}, applies: 'live', secrets: [], revision: 2 }),
      replace: async (value: any) => ok({ ns: value?.ns ?? 'permission', schema: {}, value: {}, applies: 'live', secrets: [], revision: 3 }),
    },
  }
  return client
}

async function responseJson(response: Response) { return response.json() as Promise<any> }

describe('P1-03 Gateway fake-model headless probe', () => {
  test('only v1 HTTP/SSE: create/send/deltas/tool outcomes/resume/cancel/redacted error', { timeout: 15_000 }, async () => {
    const gateway = createGatewayV1({ client: fakeDsh() })
    const server = createServer((req, res) => void gateway.handle(req, res))
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const port = (server.address() as any).port; const base = `http://127.0.0.1:${port}/weftmate/api/v1`
    const received: any[] = []
    const streamAbort = new AbortController()
    try {
      const created = await responseJson(await fetch(`${base}/sessions`, { method: 'POST', body: '{}' }))
      assert.equal(created.sessionId, 's-1')
      const stream = await fetch(`${base}/sessions/s-1/events`, { signal: streamAbort.signal })
      let sawTerminal = false
      const reading = (async () => {
        const reader = stream.body!.getReader(); const decoder = new TextDecoder(); let buffer = ''
        // 读到回合终态（cancel -> turn.stopped）为止；固定条数会与事件组合漂移。
        while (!sawTerminal) {
          const next = await reader.read(); if (next.done) break
          buffer += decoder.decode(next.value, { stream: true })
          const blocks = buffer.split('\n\n'); buffer = blocks.pop() ?? ''
          for (const block of blocks) {
            const line = block.split('\n').find((row) => row.startsWith('data: '))
            if (!line) continue
            const parsed = JSON.parse(line.slice(6)); received.push(parsed)
            if (parsed.type === 'turn.stopped') sawTerminal = true
          }
        }
      })()
      const sent = await responseJson(await fetch(`${base}/sessions/s-1/messages`, { method: 'POST', body: JSON.stringify({ content: 'normal' }) }))
      assert.equal(sent.accepted, true)
      for (let i = 0; received.length < 8 && i < 100; i += 1) await new Promise((resolve) => setTimeout(resolve, 10))
      assert.ok(received.length >= 8, 'normal fake-model turn did not reach all normalized events')
      assert.deepEqual(received.filter((event) => event.type !== 'dsh.unknown').map((event) => event.type), ['session.created', 'assistant.delta', 'assistant.delta', 'tool.started', 'tool.completed', 'tool.started', 'tool.failed', 'assistant.completed'])
      assert.equal(received.filter((event) => event.type === 'assistant.delta').length, 2)
      assert.equal(JSON.stringify(received).includes('SECRET=never'), false)
      assert.equal(JSON.stringify(received).includes('private result'), false)

      const resumed = await responseJson(await fetch(`${base}/sessions/s-1/resume`, { method: 'POST', body: '{}' }))
      assert.equal(resumed.sessionId, 's-1')
      const bad = await fetch(`${base}/sessions/s-1/messages`, { method: 'POST', body: JSON.stringify({ content: 'cause-error' }) })
      const error = await responseJson(bad)
      assert.equal(bad.status, 400); assert.match(error.error.details.digest, /^[a-f0-9]{64}$/)
      assert.equal(JSON.stringify(error).includes('sk-hidden-probe-secret'), false)

      const cancelled = await responseJson(await fetch(`${base}/sessions/s-1/cancel`, { method: 'POST', body: '{}' }))
      assert.equal(cancelled.accepted, true)
      await reading
      const types = received.map((event) => event.type)
      assert.ok(types.includes('turn.stopped'))
      assert.equal(received.some((event) => event.turn === 2 && event.type === 'assistant.completed'), false)
    } finally {
      streamAbort.abort(); await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
