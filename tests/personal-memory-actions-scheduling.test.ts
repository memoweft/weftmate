import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { channel } from 'node:diagnostics_channel'
import { createMemoryActions } from '../src/personal-memory/actions.mjs'

const owner = 'synthetic-scheduling-owner'
const action = (requestId: string) => ({ requestId, name: 'memory_forget', arguments: { query: 'synthetic preference' }, source: { text: 'Forget the synthetic preference.' } })
const plan = (id = 'synthetic-target') => ({ version: 2, worldRevision: 1, authorization: { authorized: true },
  evidenceIds: [], worldTargets: [{ kind: 'cognition', id }] })
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
async function fixture(t: any, manager: any) {
  manager = { revalidateForget: async (_owner: string, action: any) => action.scope ?? action.plan?.authorization ?? { authorized: true }, ...manager }
  const root = await mkdtemp(join(tmpdir(), 'weftmate-action-scheduling-'))
  const rows: any[] = [], diagnostics = channel('weftmate.memory.actions')
  const persistedWaiters = new Map<string, () => void>()
  const listener = (row: any) => {
    rows.push(row)
    if (row.event === 'submit-persisted') persistedWaiters.get(row.requestId)?.()
  }
  diagnostics.subscribe(listener)
  let scheduled = 0
  const actions = createMemoryActions({ root, schedule() { scheduled++ }, manager: () => manager })
  t.after(async () => {
    try { await actions.close() }
    finally { diagnostics.unsubscribe(listener); await rm(root, { recursive: true, force: true }) }
  })
  return { root, actions, rows, get scheduled() { return scheduled },
    async persisted(requestId: string) {
      const id = createHash('sha256').update(requestId).digest('hex')
      if (rows.some(row => row.event === 'submit-persisted' && row.requestId === id)) return
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { persistedWaiters.delete(id); reject(Error('synthetic action did not persist')) }, 2000)
        persistedWaiters.set(id, () => { clearTimeout(timer); persistedWaiters.delete(id); resolve() })
      })
    } }
}

test('FIX-50 #438: a new submission gets an attempt when it joins an empty recovery snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-action-scheduling-'))
  let plans = 0, commands = 0
  const actions = createMemoryActions({ root, schedule() {}, manager: () => ({
    async revalidateForget(_owner: string, action: any) { return action.scope ?? action.plan?.authorization ?? { authorized: true } },
    async planForget() { plans++; return plan() },
    async submitCommand() { commands++; return { result_state: 'applied', after_revision: 2 } },
  }) })
  try {
    const background = actions.resume(owner)
    const result = await actions.submit(owner, action('empty-snapshot'))
    await background
    assert.equal(result.state, 'applied', JSON.stringify({ result, plans, commands }))
    assert.equal(plans, 1)
    assert.equal(commands, 1)
  } finally { await actions.close(); await rm(root, { recursive: true, force: true }) }
})

test('FIX-50 #438: draining a new request does not retry a failed request in the same flight', async t => {
  const entered = deferred(), release = deferred(), plans = new Map<string, number>()
  let commands = 0
  const f = await fixture(t, {
    async planForget(_owner: string, value: any) {
      plans.set(value.requestId, (plans.get(value.requestId) ?? 0) + 1)
      if (value.requestId === 'failed-old') { entered.resolve(); await release.promise; throw Object.assign(Error('synthetic unavailable'), { code: 'MEMORY_BUSY' }) }
      return plan(value.requestId)
    },
    async submitCommand() { commands++; return { result_state: 'applied', after_revision: 2 } },
  })
  try {
    const old = f.actions.submit(owner, action('failed-old'))
    await entered.promise
    const added = f.actions.submit(owner, action('new-request'))
    await f.persisted('new-request')
    release.resolve()
    assert.equal((await old).state, 'queued')
    assert.equal((await added).state, 'applied')
    assert.equal(plans.get('failed-old'), 1)
    assert.equal(plans.get('new-request'), 1)
    assert.equal(commands, 1)
    assert.equal(f.scheduled, 3, 'two submissions and the original failed attempt each request existing recovery once')
    assert.equal(await f.actions.pending(owner), true)
    await f.actions.resume(owner)
    assert.equal(plans.get('failed-old'), 2, 'only the next explicit recovery retries the old failure')
    assert.equal(plans.get('new-request'), 1)
    assert.equal(commands, 1)
  } finally { release.resolve() }
})

test('FIX-50 #438: overlapping submissions and duplicate request IDs keep one executor and one command per action', async t => {
  const entered = deferred(), release = deferred(), commands = new Map<string, number>()
  let active = 0, maximum = 0, plans = 0
  const f = await fixture(t, {
    async planForget(_owner: string, value: any) { plans++; return plan(value.requestId) },
    async submitCommand(_owner: string, command: any) {
      commands.set(command.targetId, (commands.get(command.targetId) ?? 0) + 1)
      maximum = Math.max(maximum, ++active)
      try {
        if (command.targetId === 'already-dispatched') { entered.resolve(); await release.promise }
        return { result_state: 'applied', after_revision: 2 }
      } finally { active-- }
    },
  })
  try {
    const first = f.actions.submit(owner, action('already-dispatched'))
    await entered.promise
    const second = f.actions.submit(owner, action('later-request'))
    const duplicateSecond = f.actions.submit(owner, action('later-request'))
    const duplicateFirst = f.actions.submit(owner, action('already-dispatched'))
    await f.persisted('later-request')
    release.resolve()
    for (const result of await Promise.all([first, second, duplicateSecond, duplicateFirst])) assert.equal(result.state, 'applied')
    await f.actions.resume(owner)
    assert.equal(maximum, 1)
    assert.equal(plans, 2)
    assert.deepEqual([...commands.entries()], [['already-dispatched', 1], ['later-request', 1]])
  } finally { release.resolve() }
})

test('FIX-50 #438: draining new submissions does not add cleanup retries to the same flight', async t => {
  const entered = deferred(), release = deferred()
  let cleanups = 0, commands = 0
  const f = await fixture(t, {
    async planForget(_owner: string, value: any) { return plan(value.requestId) },
    async submitCommand(_owner: string, command: any) {
      commands++
      return { result_state: 'applied', after_revision: 2,
        ...(command.targetId === 'needs-cleanup' ? { storage_cleanup: { state: 'pending' } } : {}) }
    },
    async retryCleanupByRequest() {
      cleanups++
      if (cleanups === 1) { entered.resolve(); await release.promise; throw Object.assign(Error('synthetic cleanup unavailable'), { code: 'MEMORY_BUSY' }) }
      return { result_state: 'applied', storage_cleanup: { state: 'complete' } }
    },
  })
  try {
    const first = f.actions.submit(owner, action('needs-cleanup'))
    await entered.promise
    const second = f.actions.submit(owner, action('during-cleanup'))
    await f.persisted('during-cleanup')
    release.resolve()
    assert.equal((await first).state, 'queued')
    assert.equal((await second).state, 'applied')
    assert.equal(cleanups, 1)
    assert.equal(commands, 2)
    assert.equal(await f.actions.pending(owner), true)
    await f.actions.resume(owner)
    assert.equal(cleanups, 2)
    assert.equal(commands, 2)
    assert.equal(await f.actions.pending(owner), false)
  } finally { release.resolve() }
})

test('FIX-50 #438: a new request cancelled behind another action never reaches planning or dispatch', async t => {
  const entered = deferred(), release = deferred(), controller = new AbortController()
  let plans = 0, commands = 0
  const f = await fixture(t, {
    async planForget() { plans++; entered.resolve(); await release.promise; return plan() },
    async submitCommand() { commands++; return { result_state: 'applied', after_revision: 2 } },
  })
  try {
    const first = f.actions.submit(owner, action('running-request'))
    await entered.promise
    const stopped = f.actions.submit(owner, { ...action('stopped-new-request'), signal: controller.signal })
    await f.persisted('stopped-new-request')
    controller.abort(); release.resolve()
    assert.equal((await first).state, 'applied')
    assert.equal((await stopped).state, 'cancelled')
    await f.actions.resume(owner)
    assert.equal(plans, 1)
    assert.equal(commands, 1)
    assert.equal(await f.actions.pending(owner), false)
  } finally { release.resolve() }
})

test('FIX-50 #438: joining and draining retain the original eight-second caller budget', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const entered = deferred(), release = deferred()
  let plans = 0, commands = 0, settled = false
  const f = await fixture(t, {
    async planForget() { plans++; entered.resolve(); await release.promise; return plan() },
    async submitCommand() { commands++; return { result_state: 'applied', after_revision: 2 } },
  })
  try {
    const background = f.actions.resume(owner)
    const pending = f.actions.submit(owner, action('original-budget')).then(value => { settled = true; return value })
    await entered.promise
    t.mock.timers.tick(7999); await Promise.resolve()
    assert.equal(settled, false)
    t.mock.timers.tick(1)
    assert.equal((await pending).state, 'queued')
    assert.ok(f.rows.some(row => row.event === 'submit-return' && row.reason === '8s-budget' && row.attempted))
    release.resolve(); await background; await f.actions.close()
    assert.equal(plans, 1)
    assert.equal(commands, 1)
  } finally { release.resolve() }
})

test('FIX-50 #438: diagnostics identify the flight, request, attempt error and return reason without private payloads', async t => {
  const secret = 'synthetic-private-payload', requestId = 'synthetic-private-request-identity'
  const f = await fixture(t, {
    async planForget() { throw Object.assign(Error(secret), { code: secret }) },
  })
  const background = f.actions.resume(owner)
  const result = await f.actions.submit(owner, { ...action(requestId), arguments: { query: secret }, source: { text: secret } })
  await background
  assert.equal(result.state, 'queued')
  const id = createHash('sha256').update(requestId).digest('hex')
  assert.ok(f.rows.some(row => row.event === 'submit-persisted' && row.requestId === id && row.activeFlightId !== null))
  assert.ok(f.rows.some(row => row.event === 'flight-snapshot' && row.requestIds.includes(id)))
  assert.ok(f.rows.some(row => row.event === 'perform-error' && row.requestId === id && row.errorCode === 'UNKNOWN'))
  assert.ok(f.rows.some(row => row.event === 'submit-return' && row.requestId === id && row.attempted && row.reason === 'flight-settled-still-pending'))
  assert.equal(JSON.stringify(f.rows).includes(secret), false)
  assert.equal(JSON.stringify(f.rows).includes(requestId), false)
})
