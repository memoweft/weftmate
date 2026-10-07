import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createDshSessionAdapter, DshAdapterError } from '../src/runtime/dsh-adapter/sessions.mjs'
import { createEventState, normalizeDshEvent, reconcileDshEvents } from '../src/runtime/dsh-adapter/agents.mjs'

const ok = <T>(value: T) => ({ result: { ok: true as const, value } })

function fakeClient() {
  const calls: Array<{ method: string; value: unknown }> = []
  const client = {
    sessions: {
      create: async (value: unknown) => { calls.push({ method: 'create', value }); return ok({ sessionId: 's-1' }) },
      list: async (value: unknown) => { calls.push({ method: 'list', value }); return ok({ items: [{ sessionId: 's-1', origin: undefined }] }) },
      history: async (value: unknown) => { calls.push({ method: 'history', value }); return ok({ events: [{ event: { type: 'user/message', seq: 4 } }] }) },
      prompt: async (value: unknown) => { calls.push({ method: 'prompt', value }); return ok({ accepted: true }) },
      cancel: async (value: unknown) => { calls.push({ method: 'cancel', value }); return ok({ accepted: true }) },
    },
    events: {
      mux: (value: unknown) => { calls.push({ method: 'mux', value }); return { [Symbol.asyncIterator]: async function* () {} } },
      host: (value: unknown) => { calls.push({ method: 'host', value }); return { [Symbol.asyncIterator]: async function* () {} } },
    },
  }
  return { client, calls }
}

describe('P1-03 · DSH session / agent adapter', () => {
  it('create/resume/send/cancel only use supported client methods; cancel is a receipt', async () => {
    const { client, calls } = fakeClient()
    const adapter = createDshSessionAdapter(client)
    assert.deepEqual(await adapter.create({ cwd: 'relative-project' }), { sessionId: 's-1' })
    assert.deepEqual(await adapter.resume('s-1'), {
      sessionId: 's-1', events: [{ event: { type: 'user/message', seq: 4 }, sessionId: 's-1' }], lastSeq: 4,
    })
    assert.deepEqual(await adapter.send('s-1', 'hello'), { accepted: true, command: undefined })
    assert.deepEqual(await adapter.cancel('s-1'), { accepted: true, observedStopped: false })
    adapter.openMux(new AbortController().signal)
    adapter.openHost(new AbortController().signal)
    assert.deepEqual(calls.map((call) => call.method), ['create', 'list', 'history', 'prompt', 'cancel', 'mux', 'host'])
    assert.deepEqual(calls[3]?.value, { sessionId: 's-1', mode: 'queue', content: [{ type: 'text', text: 'hello' }] })
    assert.deepEqual(calls[5]?.value, {}, 'mux must not pretend DSH since is implemented')
  })

  it('fails closed when the live approval receipt is no longer pending', async () => {
    const { client } = fakeClient()
    ;(client as Record<string, unknown>).respond = async () => ({ accepted: false, reason: 'not-pending' })
    const adapter = createDshSessionAdapter(client)
    await assert.rejects(
      adapter.respondApproval({ rpcId: 'old-rpc', sessionId: 's-1', approvalId: 'approval-1', outcome: 'allowed-once' }),
      (error: unknown) => error instanceof DshAdapterError && error.code === 'approval-not-pending',
    )
  })

  it('accepts the pinned direct client-response receipt without RPC envelope unwrapping', async () => {
    const { client } = fakeClient()
    const responses: unknown[] = []
    ;(client as Record<string, unknown>).respond = async (value: unknown) => { responses.push(value); return { accepted: true } }
    const adapter = createDshSessionAdapter(client)
    assert.deepEqual(
      await adapter.respondApproval({ rpcId: 'current-rpc', sessionId: 's-1', approvalId: 'approval-1', outcome: 'allowed-once' }),
      { accepted: true },
    )
    assert.deepEqual(responses, [{ type: 'client-response', rpcId: 'current-rpc', result: { ok: true, value: { sessionId: 's-1', approvalId: 'approval-1', outcome: 'allowed-once' } } }])
  })

  it('resume preserves the DSH subagent cancel fence but permits ordinary fork lineage', async () => {
    const { client } = fakeClient()
    client.sessions.list = async () => ok({ items: [{ sessionId: 'child', origin: 'subagent', parentSessionId: 's-1' }] })
    const adapter = createDshSessionAdapter(client)
    await assert.rejects(adapter.resume('child'), (error: unknown) => error instanceof DshAdapterError && error.code === 'agent-busy')

    client.sessions.list = async () => ok({ items: [{ sessionId: 'fork', parentSessionId: 's-1' }] })
    assert.equal((await adapter.resume('fork')).sessionId, 'fork')
  })

  it('resume history entries reconcile through the HistoryEntry event wrapper', async () => {
    const { client } = fakeClient()
    client.sessions.history = async () => ok({ events: [{ event: {
      type: 'assistant/chunk', seq: 5, data: { turn: 1, chunk: { type: 'text-delta', text: 'from history' } },
    }, view: { ignored: true } }] })
    const adapter = createDshSessionAdapter(client)
    const resumed = await adapter.resume('s-1')
    const reconciled = await reconcileDshEvents(resumed.events, { sessionId: 's-1', lastSeq: -1 })
    assert.deepEqual(reconciled.events.map((event) => event.type), ['assistant.delta'])
    assert.equal(reconciled.events[0]?.data.text, 'from history')
  })

  it('normalizes required raw DSH session/agent/tool events and drops reasoning', async () => {
    const state = createEventState()
    const input = [
      { type: 'user/message', seq: 1, time: 1, data: { source: { kind: 'user' }, message: { content: [{ type: 'text', text: 'ask' }] } } },
      { type: 'user/message', seq: 2, time: 2, data: { source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' }, message: { content: [{ type: 'text', text: 'Current runtime context. D:\\private\\workspace' }] } } },
      { type: 'assistant/chunk', seq: 3, time: 3, data: { turn: 1, chunk: { type: 'reasoning-delta', text: 'private chain' } } },
      { type: 'assistant/chunk', seq: 4, time: 4, data: { turn: 1, chunk: { type: 'text-delta', text: 'answer' } } },
      { type: 'tool/call', seq: 5, data: { turn: 1, callId: 'c-1', name: 'shell', arguments: 'SECRET=abc' } },
      { type: 'tool/result', seq: 6, data: { turn: 1, message: { source: { kind: 'tool', callId: 'c-1' }, content: [{ type: 'tool-result', toolCallId: 'c-1', isError: false, text: '/absolute/private/output' }] } } },
      { type: 'tool/result', seq: 7, data: { turn: 1, error: { message: 'stack trace' }, message: { source: { kind: 'tool', callId: 'c-1' }, content: [{ type: 'tool-result', toolCallId: 'c-1', isError: true }] } } },
      { type: 'assistant/message', seq: 8, data: { turn: 1, message: { content: [{ type: 'text', text: 'done' }] } } },
      { type: 'host/session-status', seq: 9, sessionId: 's-1', running: false },
    ]
    const output = []
    for (const raw of input) {
      const event = await normalizeDshEvent(raw, state)
      if (event !== null) output.push(event)
    }
    assert.deepEqual(output.map((event) => event.type), ['user.message', 'assistant.delta', 'tool.started', 'tool.completed', 'tool.failed', 'assistant.completed', 'agent.status'])
    assert.equal(JSON.stringify(output).includes('SECRET=abc'), false)
    assert.equal(JSON.stringify(output).includes('/absolute/private/output'), false)
    assert.equal(JSON.stringify(output).includes('private chain'), false)
    assert.equal(JSON.stringify(output).includes('Current runtime context'), false)
    assert.equal(JSON.stringify(output).includes('D:\\private\\workspace'), false)
  })

  it('reconciles deterministic seq order, dedupes replay, and makes cancelled turns terminal-safe', async () => {
    const state = createEventState()
    const raw = [
      { type: 'assistant/message', seq: 4, data: { turn: 2, message: { content: [{ type: 'text', text: 'late' }] } } },
      { type: 'turn/end', seq: 3, data: { turn: 2, reason: { kind: 'aborted', reason: { kind: 'user' } } } },
      { type: 'turn/end', seq: 3, data: { turn: 2, reason: { kind: 'aborted', reason: { kind: 'user' } } } },
      { type: 'assistant/chunk', seq: 2, data: { turn: 2, chunk: { type: 'text-delta', text: 'before cancel' } } },
    ]
    const result = await reconcileDshEvents(raw, { state })
    assert.deepEqual(result.events.map((event) => event.type), ['assistant.delta', 'turn.stopped'])
    assert.equal(result.lastSeq, 4)
    const replay = await reconcileDshEvents(raw, { lastSeq: result.lastSeq, state: result.state })
    assert.deepEqual(replay.events, [])
  })

  it('unknown and error frames expose only redacted metadata/digests', async () => {
    const unknown = await normalizeDshEvent({ type: 'vendor/secret', seq: 9, data: { apiKey: 'sk-live-123', path: 'C:\\private\\x', stack: 'trace' } })
    assert.equal(unknown?.type, 'dsh.unknown')
    const unknownText = JSON.stringify(unknown)
    assert.equal(unknownText.includes('sk-live-123'), false)
    assert.equal(unknownText.includes('C:\\private'), false)
    assert.match(unknown?.data.digest ?? '', /^[a-f0-9]{64}$/)

    const error = await normalizeDshEvent({ type: 'stream/error', data: { message: 'token sk-live-456', stack: 'full stack' } })
    assert.equal(error?.type, 'error')
    assert.equal(JSON.stringify(error).includes('sk-live-456'), false)
    assert.match(error?.data.details.digest ?? '', /^[a-f0-9]{64}$/)

    const turnError = await normalizeDshEvent({ type: 'turn/end', seq: 10, data: { turn: 3, reason: { kind: 'error', error: 'sk-live-789' } } })
    assert.equal(turnError?.type, 'error')
    assert.equal(turnError?.data.code, 'dsh-turn-error')
    assert.equal(JSON.stringify(turnError).includes('sk-live-789'), false)
  })

  it('output limit is a non-success terminal and seals late chunks without guessing unknown kinds', async () => {
    const state = createEventState()
    const limited = await normalizeDshEvent({ sessionId: 's-limit',
      event: { type: 'turn/end', seq: 7009, data: { turn: 2, reason: { kind: 'max-tokens' } } } }, state)
    assert.equal(limited?.type, 'error')
    assert.equal(limited?.data.code, 'dsh-turn-max-tokens')
    assert.equal(limited?.data.details.endReasonKind, 'max-tokens')
    assert.equal(await normalizeDshEvent({ sessionId: 's-limit',
      event: { type: 'assistant/chunk', seq: 7010,
        data: { turn: 2, chunk: { type: 'text-delta', text: 'late' } } } }, state), null)
    const unknown = await normalizeDshEvent({ sessionId: 's-other',
      event: { type: 'turn/end', seq: 1, data: { turn: 1, reason: { kind: 'max-tokens-unknown' } } } })
    assert.equal(unknown?.type, 'dsh.unknown')
  })

  it('dedupes raw seq per session, not across two ordinary sessions', async () => {
    const result = await reconcileDshEvents([
      { sessionId: 's-a', event: { type: 'assistant/chunk', seq: 1, data: { turn: 1, chunk: { type: 'text-delta', text: 'A' } } } },
      { sessionId: 's-b', event: { type: 'assistant/chunk', seq: 1, data: { turn: 1, chunk: { type: 'text-delta', text: 'B' } } } },
    ])
    assert.deepEqual(result.events.map((event) => [event.sessionId, event.data.text]), [['s-a', 'A'], ['s-b', 'B']])
  })
})
