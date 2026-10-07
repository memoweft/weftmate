import assert from 'node:assert/strict'
import { mkdtemp, realpath, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createPersonalHealthStore } from '../src/personal-health/index.mjs'
const owner = 'owner-00000000-0000-4000-8000-000000000001'
const input = (version = '2026-10-01T00:00:00Z', allowed = false) => ({ schemaVersion: 1, date: '2026-09-30',
  timeZone: 'UTC', sourceDeviceId: 'test-device', sourceDevices: ['Test Watch'], summarizedAt: version,
  cloudModelAllowed: allowed, readStates: { hrv: 'dataAvailable' }, metrics: { hrv: { value: 20, unit: 'ms', baselineDays: 0 } } })

test('observed acknowledgements replay failures, keep content-free withdrawals across restart and fence races', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'health-outbox-')))
  let store = createPersonalHealthStore({ root, clock: () => Date.parse('2026-10-06T00:00:00Z') })
  const calls: any[] = []
  const dispatch = async (method: string, params: any) => {
    calls.push({ method, params })
    return { result_state: 'applied', evidence_id: 'test-observed-id', world_revision: 1, storage_cleanup: { state: 'complete' } }
  }
  try {
    await store.upsert(owner, input())
    await assert.rejects(store.flushObserved(owner, async () => { throw new Error('transport unavailable') }))
    assert.equal((await store.pendingObserved(owner)).length, 1)
    await store.flushObserved(owner, dispatch)
    assert.equal((await store.pendingObserved(owner)).length, 0)
    // Permission-only changes on another day must reach this already delivered source too.
    await store.upsert(owner, { ...input('2026-10-02T00:00:00Z', true), date: '2026-10-01' })
    await store.flushObserved(owner, dispatch)
    assert.equal(calls.filter(c => c.method === 'upsert_observed').length, 2)
    assert.equal(calls.filter(c => c.method === 'update_observed_permissions').length, 3)
    await store.delete(owner)
    const file = path.join(root, 'accounts', owner, 'health', 'daily-summaries.json')
    assert.doesNotMatch(await readFile(file, 'utf8'), /HRV|Test Watch|test-device|hrv/)
    store = createPersonalHealthStore({ root })
    await assert.rejects(store.flushObserved(owner, async () => ({ result_state: 'applied', storage_cleanup: { state: 'pending' } })))
    assert.equal((await store.memoryStatus(owner)).pendingObservedCount, 2)
    await store.flushObserved(owner, dispatch)
    assert.equal((await store.memoryStatus(owner)).state, 'empty')
    assert.equal(calls.filter(c => c.method === 'retract_observed').length, 2)
    await assert.rejects(store.upsert(owner, input()), { code: 'STALE_HEALTH_SUMMARY' })
    await store.upsert(owner, input('2026-10-07T00:00:00Z'))
    let release: () => void = () => {}
    const blocked = new Promise<void>(resolve => { release = resolve })
    let entered: () => void = () => {}
    const started = new Promise<void>(resolve => { entered = resolve })
    const flush = store.flushObserved(owner, async (...args: any[]) => { entered(); await blocked; return dispatch(args[0], args[1]) })
    await started
    const deleting = store.delete(owner)
    release(); await flush; await deleting
    await store.flushObserved(owner, dispatch)
    assert.equal((await store.pendingObserved(owner)).length, 0)
    assert.equal((await store.memoryStatus(owner)).state, 'empty')
  } finally { await rm(root, { recursive: true, force: true }) }
})
