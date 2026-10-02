import assert from 'node:assert/strict'
import test from 'node:test'
import { createPersonalAccessBackend } from '../src/personal-access-backend.mjs'

test('task stop checks owner and personal-remote preset before exact callback', async () => {
  const calls: string[][] = []
  const backend = createPersonalAccessBackend({
    currentOrigin: () => 'http://127.0.0.1:1', referenceScan: () => ({ state: 'ready' }),
    profiles: () => [], hasCredential: () => false, routeForProfile: () => ({}),
    listSessions: async () => ({ items: [
      { sessionId: 'owned', agentPreset: 'personal-remote' },
      { sessionId: 'other', agentPreset: 'standard' },
    ] }),
    resolveSession: async () => ({ profile: { id: 'local' } }),
    ensureKnownSession: async () => {}, gateway: async () => ({}),
    queue: async (work: () => Promise<unknown>) => work(), bindSession: () => {},
    hostOwnerId: () => 'owner-a',
    taskStop: async ({ receiptIds }: { receiptIds: string[] }) => {
      calls.push(receiptIds)
      return { status: 'queue_removed', outcomes: receiptIds.map((receiptId) =>
        ({ receiptId, status: 'queue_removed' })) }
    },
  })
  const input = { sessionId: 'owned', ownerId: 'owner-a', requestId: 'stop-1', receiptIds: ['receipt-1'] }
  assert.equal((await backend.stopTask(input)).outcomes[0].status, 'queue_removed')
  await assert.rejects(backend.stopTask({ ...input, ownerId: 'owner-b' }),
    (error: Error & { code?: string }) => error.code === 'SESSION_READ_ONLY')
  await assert.rejects(backend.stopTask({ ...input, sessionId: 'other' }),
    (error: Error & { code?: string }) => error.code === 'SESSION_READ_ONLY')
  await assert.rejects(backend.stopTask({ ...input, receiptIds: ['receipt-1', 'receipt-1'] }),
    (error: Error & { code?: string }) => error.code === 'INVALID_COMMAND')
  assert.deepEqual(calls, [['receipt-1']])
})
