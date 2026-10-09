import assert from 'node:assert/strict'
import test from 'node:test'
import { createTaskOperations } from '../src/personal-access/tasks.mjs'

function fixture(status = 'unconfirmed') {
  let nativeStatus = status, stopCalls = 0, reads = 0
  const at = new Date().toISOString()
  const source: any = { commandId: 'task', kind: 'session.message', sessionId: 'session',
    receiptId: 'receipt', dshTurn: 1, state: 'accepted_by_dsh', payload: { text: 'Synthetic orphan' },
    taskControl: { state: 'stop_requested', updatedAt: at, stopRequests: [{ requestId: 'stop', at,
      targets: [{ commandId: 'task', receiptId: 'receipt', ack: 'unconfirmed' }] }] } }
  const account: any = { ownerId: 'owner', commands: { task: source }, sessions: { session: { origin: 'personal-remote' } } }
  const context: any = { closing: false, storageFault: false, stopping: new Map(), timestamp: () => Date.now(),
    requireOpen() {}, accountState: () => account, serial: (work: any) => work(),
    mutate: (_owner: any, change: any) => change(account), backend: {
      describeSession: async () => ({ sessionId: 'session', agentPreset: 'personal-remote', running: false }),
      readSourceEvents: async () => ({ events: [] }),
      getTaskStopState: async () => { reads++; return { status: nativeStatus, observedAt: at } },
      stopTask: async () => { stopCalls++; return { outcomes: [{ receiptId: 'receipt', status: 'unconfirmed' }] } },
    } }
  return { tasks: createTaskOperations(context), account, source, context,
    status: (value: string) => { nativeStatus = value }, calls: () => ({ stopCalls, reads }) }
}

for (const scenario of ['runtime restart / missing turn', 'missing turn record', 'model switch failure', 'upstream disconnect']) {
  test(`orphan stop: ${scenario}`, async () => {
    const f = fixture(scenario.includes('missing') || scenario.includes('restart') ? 'not_running' : 'ended')
    try {
      await f.tasks.driveTaskStop('owner', 'task')
      const detail = await f.tasks.taskDetail(f.account, 'task')
      assert.equal(detail.control.stopStatus, 'completed')
      assert.equal(detail.control.canResume, true)
      assert.equal(f.calls().stopCalls, 0)
      assert.ok(f.calls().reads > 0)
      assert.equal(f.source.taskControl.stopRequests[0].targets[0].receiptId, 'receipt')
    } finally { f.tasks.cancelTaskStopRetries() }
  })
}

test('possibly running or unreadable turn remains stopping', async () => {
  for (const status of ['running', 'unconfirmed']) {
    const f = fixture(status)
    try {
      await f.tasks.driveTaskStop('owner', 'task')
      const detail = await f.tasks.taskDetail(f.account, 'task')
      assert.equal(detail.control.stopStatus, 'unconfirmed')
      assert.equal(detail.control.canResume, false)
      assert.equal(f.calls().stopCalls, 1)
    } finally { f.tasks.cancelTaskStopRetries() }
  }
})

test('cancel acknowledgement without turn/end still gets timed native rechecks and then clears timers', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 })
  const f = fixture()
  f.source.taskControl.stopRequests[0].targets[0].ack = 'cancel_requested'
  try {
    await f.tasks.driveTaskStop('owner', 'task')
    const reads = f.calls().reads
    t.mock.timers.tick(999)
    await Promise.all(f.context.stopping.values())
    assert.equal(f.calls().reads, reads)
    f.status('not_running')
    t.mock.timers.tick(1)
    await Promise.all(f.context.stopping.values())
    assert.equal((await f.tasks.taskDetail(f.account, 'task')).control.stopStatus, 'completed')
    assert.equal(f.calls().stopCalls, 0)
    const finalReads = f.calls().reads
    t.mock.timers.tick(120_000)
    await Promise.all(f.context.stopping.values())
    await f.tasks.driveTaskStop('owner', 'task')
    assert.equal(f.calls().reads, finalReads, 'durable terminal observation survives subsequent reads')
    const reloaded = createTaskOperations(f.context)
    await reloaded.driveTaskStop('owner', 'task')
    assert.equal(f.calls().reads, finalReads, 'startup can use the saved native observation')
    reloaded.cancelTaskStopRetries()
  } finally { f.tasks.cancelTaskStopRetries() }
})

test('a terminal turn does not erase unknown side effects or running background jobs', async () => {
  for (const execution of [{ state: 'uncertain' }, { state: 'completed', jobId: 'job', jobState: 'running' }]) {
    const f = fixture('not_running')
    f.source.toolExecutions = [execution]
    try {
      await f.tasks.driveTaskStop('owner', 'task')
      assert.equal((await f.tasks.taskDetail(f.account, 'task')).control.canResume, false)
      assert.equal(f.source.taskControl.stopRequests[0].resolution, undefined)
    } finally { f.tasks.cancelTaskStopRetries() }
  }
})
