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

test('native stop observation reaches missing historical sessions with owner and runtime fences', async () => {
  let runtime = 'runtime-a', queried = 0, changeRuntime = false
  const backend = createPersonalAccessBackend({
    currentOrigin: () => 'http://127.0.0.1:1', getRuntimeId: () => runtime,
    referenceScan: () => ({ state: 'ready' }), profiles: () => [], hasCredential: () => false,
    routeForProfile: () => ({}), listSessions: async () => { throw new Error('must not require an existing session') },
    resolveSession: async () => ({}), ensureKnownSession: async () => {},
    gateway: async (path: string) => {
      queried++; assert.match(path, /^\/sessions\/missing\/stop-state\?/)
      assert.match(path, /receiptId=receipt/)
      if (changeRuntime) runtime = 'runtime-b'
      return { status: 'not_running', observedAt: new Date().toISOString() }
    }, queue: async (work: any) => work(), bindSession: () => {},
    hostOwnerId: () => 'owner', ownerForSession: () => 'owner',
  })
  const input = { ownerId: 'owner', sessionId: 'missing', receiptId: 'receipt', turn: 1,
    stopRequestedAt: '2026-10-09T00:00:00.000Z' }
  assert.equal((await backend.getTaskStopState(input)).status, 'not_running')
  await assert.rejects(backend.getTaskStopState({ ...input, ownerId: 'other' }), (error: any) => error.code === 'SESSION_READ_ONLY')
  assert.equal(queried, 1)
  changeRuntime = true
  await assert.rejects(backend.getTaskStopState(input), (error: any) => error.code === 'RUNTIME_UNAVAILABLE')
})
