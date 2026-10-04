import assert from 'node:assert/strict'
import test from 'node:test'
import { DshWebRuntime } from '../src/dsh-web-runtime.ts'

const unknown = { status: 'unconfirmed', turn: null, assistantChunks: 0,
  textChunks: 0, reasoningChunks: 0, assistantMessages: 0, toolSaveObserved: false }

test('reply evidence IPC accepts only current child metadata and fails closed on late or leaked frames', async () => {
  const runtime = new DshWebRuntime({ homeDir: 'C:\\synthetic\\home',
    workspaceDir: 'C:\\synthetic\\workspace', personalHostApiProxy: true }) as any
  const sent: any[] = []
  const child = { connected: true, send: (frame: any, done: any) => { sent.push(frame); done?.(null) } }
  const stale = { connected: true, send: () => {} }
  runtime.child = child
  runtime.originValue = 'http://127.0.0.1:12345'
  const input = { sessionId: 'session-a', receiptId: 'rpc-a' }
  const first = runtime.readPersonalReplyEvidence(input)
  runtime.handleReplyEvidenceMessage(stale, { protocol: sent[0].protocol, id: sent[0].id,
    result: { ...unknown, status: 'completed', turn: 1,
      terminalAt: '2026-10-04T00:00:00.000Z' } })
  assert.equal(runtime.replyEvidencePending.size, 1)
  runtime.handleReplyEvidenceMessage(child, { protocol: sent[0].protocol, id: sent[0].id,
    result: { ...unknown, secret: 'private content' } })
  assert.deepEqual(await first, unknown)
  const second = runtime.readPersonalReplyEvidence(input)
  runtime.handleReplyEvidenceMessage(child, { protocol: sent[1].protocol, id: sent[1].id,
    result: { ...unknown, status: 'completed', turn: 1,
      terminalAt: '2026-10-04T00:00:00.000Z' } })
  assert.equal((await second).status, 'completed')
  const third = runtime.readPersonalReplyEvidence(input)
  runtime.child = stale
  runtime.failReplyEvidenceRequests(child)
  assert.deepEqual(await third, unknown)
})
