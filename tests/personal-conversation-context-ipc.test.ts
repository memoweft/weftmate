import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { DshWebRuntime } from '../src/dsh-web-runtime.ts'
import { contextIdentity, apply } from '../src/plugins/weftmate-personal-conversation-context.mjs'

const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
const frame = { protocol: 'weftmate.personal-conversation-context.v1',
  id: 'context-12345678-1234-1234-1234-123456789abc', sessionId: 'session-owned',
  turn: 1, step: 1, receiptId: 'rpc-exact', messageHash: hash('new goal') }

test('first-step context identity uses the exact claimed RPC and full user text', () => {
  const user = { id: 'message-exact', content: [{ type: 'text', text: 'new goal' }],
    source: { kind: 'user', rpcId: 'rpc-exact' } }
  const payload = { agent: { session: { id: 'session-owned', header: { agentPreset: 'personal-shared-chat' } } },
    messages: [user], turn: 1, step: 1 }
  assert.deepEqual(contextIdentity(payload), { sessionId: 'session-owned', turn: 1, step: 1,
    receiptId: 'rpc-exact', messageHash: hash('new goal') })
  assert.equal(contextIdentity({ ...payload, messages: [user, { ...user, id: 'another' }] }), null)
  assert.equal(contextIdentity({ ...payload, step: 2 }), null)
  assert.equal(contextIdentity({ ...payload, turn: 2, step: 1 })?.turn, 2,
    'a new explicit turn retries if the prior one never persisted context')
  assert.equal(contextIdentity({ ...payload, messages: [{ ...user, source: { kind: 'user' } }] }), null)
  assert.equal(contextIdentity({ ...payload, messages: [{ ...user,
    content: [{ type: 'text', text: 'new goal' }, { type: 'image', mediaType: 'image/png', data: 'synthetic' }] }] })?.messageHash,
  hash('new goal'))
  assert.equal(contextIdentity({ ...payload, messages: [{ ...user,
    content: [{ type: 'image', mediaType: 'image/png', data: 'synthetic' }] }] })?.messageHash,
  hash(''))
})

test('unverifiable first user source fails closed before any model request', async () => {
  let hook: any
  apply({ on: (name: string, callback: any) => { if (name === 'agent/pre-step') hook = callback },
    effect() {} })
  const user = { id: 'message-1', content: [{ type: 'text', text: 'goal' }], source: { kind: 'user' } }
  await assert.rejects(hook({ agent: { session: { id: 'session-owned',
    header: { agentPreset: 'personal-shared-chat' }, events: [] } },
  messages: [user], turn: 1, step: 1 }, async () => ({ kind: 'enter', messages: [user] })),
  /CONVERSATION_CONTEXT_UNAVAILABLE/)
})

test('context IPC admits only current child, projects exact safe fields, and fails closed', async () => {
  const sent: any[] = [], calls: any[] = []
  const runtime = new DshWebRuntime({ homeDir: 'C:\\synthetic\\dsh-home',
    workspaceDir: 'C:\\synthetic\\work',
    personalConversationContextHandler: async (request) => {
      calls.push(request)
      return { state: 'ready', contextText: 'bounded phone history',
        contextHash: hash('bounded phone history'), throughSeq: 5, secret: 'never exposed' }
    } }) as any
  const current = { connected: true, send: (value: unknown) => sent.push(value) }
  const stale = { connected: true, send: (value: unknown) => sent.push(value) }
  runtime.child = current
  runtime.handlePersonalConversationContextMessage(stale, frame)
  assert.equal(sent[0].ok, false)
  assert.equal(calls.length, 0)
  for (const invalid of [{ ...frame, ownerId: 'owner-other' }, { ...frame, receiptId: '' },
    { ...frame, messageHash: 'wrong' }, { ...frame, step: 2 }]) {
    runtime.handlePersonalConversationContextMessage(current, invalid)
  }
  assert.equal(calls.length, 0)
  runtime.handlePersonalConversationContextMessage(current, frame)
  for (let i = 0; i < 40 && sent.length < 2; i++) await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(calls.length, 1)
  assert.deepEqual(sent[1].result, { state: 'ready', contextText: 'bounded phone history',
    contextHash: hash('bounded phone history'), throughSeq: 5 })
  assert.equal(JSON.stringify(sent[1]).includes('never exposed'), false)
})
