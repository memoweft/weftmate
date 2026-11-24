import { stagePersonalPlugins } from './support/personal-plugins.ts'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { waitForCommand } from './helpers/wait-for-command.mjs'
// Expose the existing observer only in this isolated fixture, as the timeline
// fixture does. Rejected-tool snapshots must exclude unrelated background writes.
const serviceUrl = new URL('../src/personal-access/index.mjs', import.meta.url)
const serviceSource = readFileSync(serviceUrl, 'utf8').replaceAll('import.meta.url', JSON.stringify(serviceUrl.href))
  .replace(/from (['"])(\.\.?\/[^'"]+)\1/g, (_, _quote, name) => `from '${new URL(name, serviceUrl).href}'`)
  .replace('const service = {', 'const service = { __reviewContext: context,')
const { createPersonalAccessService } = await import('data:text/javascript;base64,' + Buffer.from(serviceSource).toString('base64'))
import { claimReceiptBackgroundJob, createTaskStopHandler, stopReceiptBackgroundJobs } from '../src/plugins/weftmate-personal-task-control.mjs'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const fixtureSourceText = '请观察当前环境并完成一个通用文件工作流'

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'personal-general-execution-'))
  const sessions = new Set<string>()
  const backend = { getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }), listModels: async () => [],
    preflight: async () => ({ ok: true }), createSession: async ({ sessionId }: { sessionId: string }) => {
      sessions.add(sessionId); return { sessionId }
    }, sendMessage: async () => ({ accepted: true, receiptId: 'receipt-general-source' }),
    stopTask: async ({ receiptIds }: { receiptIds: string[] }) => ({ status: 'cancel_requested',
      outcomes: receiptIds.map(receiptId => ({ receiptId, status: 'cancel_requested' })) }),
    cancelSession: async () => ({ accepted: true }),
    readEvents: async ({ afterSeq }: { afterSeq: number }) => ({ events: [], nextSeq: afterSeq, hasMore: false }),
    describeSession: async (sessionId: string) => sessions.has(sessionId)
      ? { sessionId, title: 'General execution', running: false, agentPreset: 'personal-remote' } : null }
  let service = await createPersonalAccessService({ root, port: 0, backend })
  t.after(async () => { await service.close(); rmSync(root, { recursive: true, force: true }) })
  let { origin, hostId } = await service.start()
  const grant = await service.issueSetupGrant()
  const setup = await fetch(`${origin}/personal/v1/auth/setup`, { method: 'POST',
    headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ grant: grant.grant,
      username: 'GeneralFixtureOwner', password: 'synthetic general fixture password', deviceName: 'Fixture phone' }) })
  const auth = await setup.json(), cookie = setup.headers.get('set-cookie')!.split(';')[0]
  const request = async (path: string, body?: object) => {
    const response = await fetch(`${origin}/personal/v1/${path}`, { method: body ? 'POST' : 'GET',
      headers: { origin, cookie, 'x-weftmate-csrf': auth.csrfToken, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined })
    return { status: response.status, body: await response.json() }
  }
  const command = async (payload: object) => {
    const accepted = await request('commands', payload)
    assert.equal(accepted.status, 202)
    return waitForCommand(async () => (await request(`commands/${accepted.body.command.commandId}`)).body.command,
      { label: 'fixture command' })
  }
  const created = await command({ requestId: 'general-session', kind: 'session.create', targetDeviceId: hostId, modelProfileId: 'local' })
  const source = await command({ requestId: 'general-source', kind: 'session.message', targetDeviceId: hostId,
    sessionId: created.sessionId, text: fixtureSourceText })
  // Join the initial digest refresh before comparing whole-store snapshots.
  // Its asynchronous session-title write is unrelated to rejected execution.
  assert.equal((await request('daily-summaries')).status, 200)
  await service.__reviewContext.activity.close()
  return { root, backend, source, auth, request,
    input: { sessionId: created.sessionId, turn: 1, callId: 'general-call', rootCallId: 'general-call',
      receiptId: source.receiptId, messageHash: hash(fixtureSourceText), toolName: 'pwsh', argumentsHash: hash('private command body') },
    get service() { return service },
    restart: async () => { await service.close(); service = await createPersonalAccessService({ root, port: 0, backend });
      ({ origin } = await service.start()); await service.__reviewContext.activity.close() },
    close: async () => { await service.close(); rmSync(root, { recursive: true, force: true }) } }
}

test('parallel native roots finish independently through their original account receipt', async t => {
  const f = await fixture(t)
  try {
    const calls = ['parallel-first', 'parallel-second'].map(callId => ({ ...f.input, callId, rootCallId: callId }))
    const grants = await Promise.all(calls.map(input => f.service.trackToolExecution({ ...input, action: 'authorize_execution' })))
    assert.ok(grants.every(grant => grant.state === 'running' && grant.taskId === f.source.commandId))
    assert.notEqual(grants[0].executionId, grants[1].executionId)
    assert.equal((await f.request(`tasks/${f.source.commandId}`)).body.executionSteps.filter((row: any) => row.state === 'running').length, 2)
    for (const index of [1, 0]) {
      await f.service.trackToolExecution({ ...calls[index], action: 'finish_execution', executionId: grants[index].executionId,
        state: 'completed', resultHash: hash(`result-${index}`) })
    }
    assert.ok((await f.request(`tasks/${f.source.commandId}`)).body.executionSteps.every((row: any) => row.state === 'completed'))
  } finally { await f.close() }
})

test('generic execution uses the original account receipt, returns metadata only and never claims the goal verified', async t => {
  const f = await fixture(t)
  try {
    await assert.rejects(f.service.trackToolExecution({ ...f.input, action: 'authorize_execution', ownerId: 'other-owner' }),
      (error: any) => error.code === 'INVALID_REQUEST')
    await assert.rejects(f.service.trackToolExecution({ ...f.input, action: 'authorize_execution', receiptId: 'foreign-receipt' }),
      (error: any) => error.code === 'TOOL_SOURCE_UNAVAILABLE')
    for (const messageHash of [undefined, hash('wrong source')]) {
      const before = readFileSync(join(f.root, 'store.json'), 'utf8')
      await assert.rejects(f.service.trackToolExecution({ ...f.input, action: 'authorize_execution', messageHash }))
      assert.equal(readFileSync(join(f.root, 'store.json'), 'utf8'), before)
    }
    const started = await f.service.trackToolExecution({ ...f.input, action: 'authorize_execution' })
    assert.equal(started.taskId, f.source.commandId)
    await assert.rejects(f.service.trackToolExecution({ ...f.input, action: 'authorize_execution' }),
      (error: any) => error.code === 'REQUEST_CONFLICT')
    const finish = { ...f.input, action: 'finish_execution', executionId: started.executionId, state: 'completed', resultHash: hash('private result') }
    for (const messageHash of [undefined, hash('wrong source')]) {
      const before = readFileSync(join(f.root, 'store.json'), 'utf8')
      await assert.rejects(f.service.trackToolExecution({ ...finish, messageHash }))
      assert.equal(readFileSync(join(f.root, 'store.json'), 'utf8'), before)
    }
    assert.equal((await f.service.trackToolExecution(finish)).state, 'completed')
    assert.equal((await f.service.trackToolExecution(finish)).state, 'completed')
    await assert.rejects(f.service.trackToolExecution({ ...finish, argumentsHash: hash('changed') }),
      (error: any) => error.code === 'REQUEST_CONFLICT')
    await f.restart()
    const detail = (await f.request(`tasks/${f.source.commandId}`)).body
    assert.equal(detail.executionSteps.length, 1)
    assert.equal(detail.executionSteps[0].sourceReceiptId, f.source.receiptId)
    assert.equal(detail.executionSteps[0].state, 'completed')
    assert.equal(detail.source.state, 'accepted_by_dsh')
    assert.equal('verification' in detail.executionSteps[0], false)
    const raw = readFileSync(join(f.root, 'store.json'), 'utf8')
    assert.equal(raw.includes('private command body'), false)
    assert.equal(raw.includes('private result'), false)
    await f.service.revokeDevice(f.auth.device.id)
    await assert.rejects(f.service.trackToolExecution({ ...f.input, action: 'authorize_execution', callId: 'new-call', rootCallId: 'new-call' }),
      (error: any) => error.code === 'TOOL_SOURCE_UNAVAILABLE')
  } finally { await f.close() }
})

test('a stopped generic task rejects future execution but retains the cancelled tool receipt', async t => {
  const f = await fixture(t)
  try {
    const started = await f.service.trackToolExecution({ ...f.input, action: 'authorize_execution' })
    const stopped = await f.request(`tasks/${f.source.commandId}/stop`, { requestId: 'general-stop' })
    assert.equal(stopped.status, 202)
    assert.equal(stopped.body.task.control.state, 'stop_requested')
    await assert.rejects(f.service.trackToolExecution({ ...f.input, action: 'authorize_execution', callId: 'late-call' }),
      (error: any) => error.code === 'TASK_NOT_READY')
    await f.service.trackToolExecution({ ...f.input, action: 'finish_execution', executionId: started.executionId,
      state: 'cancelled', resultHash: hash('cancelled result') })
    const detail = (await f.request(`tasks/${f.source.commandId}`)).body
    assert.equal(detail.executionSteps[0].state, 'cancelled')
    assert.equal(detail.control.state, 'stop_requested')
  } finally { await f.close() }
})

test('restart marks an unfinished generic tool uncertain and never permits replay', async t => {
  const f = await fixture(t)
  try {
    await f.service.trackToolExecution({ ...f.input, action: 'authorize_execution' })
    await f.restart()
    const detail = (await f.request(`tasks/${f.source.commandId}`)).body
    assert.equal(detail.executionSteps[0].state, 'uncertain')
    assert.equal(detail.control.state, 'uncertain')
    await assert.rejects(f.service.trackToolExecution({ ...f.input, action: 'authorize_execution', callId: 'new-retry' }),
      (error: any) => error.code === 'TASK_NOT_READY')
  } finally { await f.close() }
})

test('tool completion and background job activity persist separately; terminal job observations cannot be downgraded', async t => {
  const f = await fixture(t)
  try {
    const started = await f.service.trackToolExecution({ ...f.input, action: 'authorize_execution' })
    await f.service.trackToolExecution({ ...f.input, action: 'finish_execution', executionId: started.executionId,
      state: 'completed', resultHash: hash('native background handle'), jobId: 'pwsh:1', jobState: 'running' })
    for (const messageHash of [undefined, hash('wrong source')]) {
      const before = readFileSync(join(f.root, 'store.json'), 'utf8')
      await assert.rejects(f.service.trackToolExecution({ ...f.input, action: 'observe_execution_job', executionId: started.executionId,
        jobId: 'pwsh:1', jobState: 'killed', messageHash }))
      assert.equal(readFileSync(join(f.root, 'store.json'), 'utf8'), before)
    }
    let detail = (await f.request(`tasks/${f.source.commandId}`)).body
    assert.equal(detail.executionSteps[0].state, 'completed')
    assert.equal(detail.control.backgroundJobs.active, 1)
    await f.service.trackToolExecution({ ...f.input, action: 'observe_execution_job', executionId: started.executionId,
      jobId: 'pwsh:1', jobState: 'killed' })
    await f.service.trackToolExecution({ ...f.input, action: 'observe_execution_job', executionId: started.executionId,
      jobId: 'pwsh:1', jobState: 'running' })
    await f.restart()
    detail = (await f.request(`tasks/${f.source.commandId}`)).body
    assert.equal(detail.executionSteps[0].jobState, 'killed')
    assert.equal(detail.control.backgroundJobs.active, 0)
    assert.equal('verification' in detail.executionSteps[0], false)
  } finally { await f.close() }
})

test('native job stop kills and waits only jobs claimed by the requested receipt and owning session', async () => {
  const owner = { session: { id: 'session-owned' } }, other = { session: { id: 'session-other' } }
  const states = new Map([['pwsh:1', 'running'], ['pwsh:2', 'running'], ['pwsh:3', 'running']]), killed: string[] = []
  const jobs = { get: (id: string, caller: object) => {
    assert.equal(caller, id === 'pwsh:3' ? other : owner)
    return { id, kind: 'pwsh', ownerSession: id === 'pwsh:3' ? other.session.id : owner.session.id, status: states.get(id) }
  }, kill: (id: string, caller: object) => { assert.equal(caller, owner); killed.push(id); states.set(id, 'stopping') },
    wait: async (id: string, ms: number, caller: object) => { assert.equal(ms, 2000); assert.equal(caller, owner); states.set(id, 'killed') } }
  const claims = new Map([['session-owned\u0000receipt-a', new Map([['pwsh:1', owner]])],
    ['session-owned\u0000receipt-b', new Map([['pwsh:2', owner]])], ['session-other\u0000receipt-a', new Map([['pwsh:3', other]])]])
  const result = await stopReceiptBackgroundJobs(jobs, claims, { sessionId: 'session-owned', receiptIds: ['receipt-a'] })
  assert.deepEqual(killed, ['pwsh:1'])
  assert.equal(result[0].backgroundJobs[0].state, 'killed')
  assert.equal(states.get('pwsh:2'), 'running')
  assert.equal(states.get('pwsh:3'), 'running')
})

async function withDesktopPlugin(run: (plugin: any) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), 'general-native-job-plugin-'))
  try {
    const staged = stagePersonalPlugins(root).plugin
    await run(await import(staged))
  } finally { rmSync(root, { recursive: true, force: true }) }
}

function nativeJobFixture(plugin: any, allowClaim = true, failFinish = false, stuckJobId?: string, stopThrows = false) {
  const controller = new AbortController(), frames: any[] = [], killed: string[] = [], waited: string[] = []
  const owner = { id: 'session-native', session: { id: 'session-native', header: { agentPreset: 'personal-remote' }, events: [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'user/message', data: { source: { kind: 'user', rpcId: 'receipt-native' }, content: [{ type: 'text', text: 'native goal' }] } },
    { type: 'tool/call', data: { callId: 'native-call-a', name: 'pwsh', turn: 1 } },
    { type: 'tool/call', data: { callId: 'native-call-b', name: 'pwsh', turn: 1 } },
  ] } }
  const snapshots = new Map<string, any>([['pwsh-existing', { id: 'pwsh-existing', kind: 'pwsh', ownerSession: owner.id, status: 'running' }]])
  const changed: any[] = [], done: any[] = []
  const notify = () => changed.forEach(listener => listener(owner))
  const jobs = {
    list: (caller: object) => { assert.equal(caller, owner); return [...snapshots.values()].map(value => ({ ...value })) },
    get: (id: string, caller: object) => { assert.equal(caller, owner); assert.ok(snapshots.has(id)); return { ...snapshots.get(id) } },
    kill: (id: string, caller: object) => { assert.equal(caller, owner); killed.push(id); snapshots.get(id).status = 'stopping'; notify() },
    wait: async (id: string, ms: number, caller: object) => {
      assert.equal(ms, 2000); assert.equal(caller, owner); waited.push(id)
      if (stopThrows) throw new Error('synthetic native cleanup unavailable')
      snapshots.get(id).status = id === stuckJobId ? 'stopping' : 'killed'; notify()
      await Promise.all(done.map(listener => listener({ ...snapshots.get(id) }, owner)))
    },
    onJobsChanged: (listener: any) => { changed.push(listener); return () => changed.splice(changed.indexOf(listener), 1) },
    onJobDone: (listener: any) => { done.push(listener); return () => done.splice(done.indexOf(listener), 1) },
  }
  const bridge = { request: async (frame: any) => {
    frames.push(frame)
    if (failFinish && frame.action === 'finish_execution') throw Object.assign(new Error('receipt unavailable'), { code: 'PERSONAL_TOOL_TIMEOUT' })
    return { executionId: 'exec-' + 'a'.repeat(48), state: frame.state ?? 'running' }
  } }
  const ctx = { get: () => jobs, inject: (_dependencies: string[], callback: any) => callback({ jobs }),
    waterfall: async () => allowClaim }
  const background = plugin.createPersonalBackgroundTracker(ctx, bridge)
  const exec = (callId = 'native-call-a') => ({ name: 'pwsh', arguments: { command: 'private synthetic body', run_in_background: true },
    callId, signal: controller.signal, agent: owner })
  const start = (id: string) => { snapshots.set(id, { id, kind: 'pwsh', ownerSession: owner.id, status: 'running' }); notify() }
  return { controller, frames, owner, snapshots, background, exec, start, bridge, killed, waited, changed, done }
}

test('native background dispatch reads the pinned ToolResult value and separates concurrent call ownership', async () => {
  await withDesktopPlugin(async plugin => {
    const f = nativeJobFixture(plugin)
    try {
      await Promise.all(['a', 'b'].map(async suffix => plugin.trackPersonalExecution(f.bridge, f.exec(`native-call-${suffix}`), async () => {
        await Promise.resolve()
        f.start(`pwsh-${suffix}`)
        return { isError: false, value: { kind: 'background', jobId: `pwsh-${suffix}` }, content: [{ type: 'text', text: `started background job pwsh-${suffix}` }] }
      }, f.background)))
      const finished = f.frames.filter(frame => frame.action === 'finish_execution')
      assert.deepEqual(finished.map(frame => [frame.callId, frame.jobId, frame.jobState]).sort(), [
        ['native-call-a', 'pwsh-a', 'running'], ['native-call-b', 'pwsh-b', 'running'],
      ])
      assert.equal(f.frames.filter(frame => frame.action === 'observe_execution_job').length, 2)
      assert.deepEqual(f.killed, [])
      assert.equal(JSON.stringify(f.frames).includes('private synthetic body'), false)
    } finally { f.background.close(); assert.equal(f.changed.length, 0); assert.equal(f.done.length, 0) }
  })
})

test('unexpected multiple native registrations close every captured owned job and retain an unfinished receipt when cleanup is unknown', async () => {
  await withDesktopPlugin(async plugin => {
    const f = nativeJobFixture(plugin)
    try {
      await assert.rejects(plugin.trackPersonalExecution(f.bridge, f.exec(), async () => {
        f.start('pwsh-new-a'); f.start('pwsh-new-b')
        return { isError: true, content: [{ type: 'text', text: 'Error: tool call aborted' }] }
      }, f.background), { code: 'TOOL_SOURCE_UNAVAILABLE' })
      assert.deepEqual(f.killed.sort(), ['pwsh-new-a', 'pwsh-new-b']); assert.deepEqual(f.waited.sort(), ['pwsh-new-a', 'pwsh-new-b'])
      assert.equal(f.snapshots.get('pwsh-existing').status, 'running')
      assert.equal(f.frames.find(frame => frame.action === 'finish_execution').state, 'failed')
    } finally { f.background.close() }
    const uncertain = nativeJobFixture(plugin, true, false, 'pwsh-stuck')
    try {
      await assert.rejects(plugin.trackPersonalExecution(uncertain.bridge, uncertain.exec(), async () => {
        uncertain.start('pwsh-stuck'); uncertain.start('pwsh-new')
        return { isError: true, content: [] }
      }, uncertain.background), { code: 'TOOL_SOURCE_UNAVAILABLE', personalExecutionUncertain: true })
      assert.equal(uncertain.frames.find(frame => frame.action === 'finish_execution').state, 'uncertain')
      assert.equal(uncertain.snapshots.get('pwsh-existing').status, 'running')
      assert.equal(uncertain.snapshots.get('pwsh-stuck').status, 'stopping')
    } finally { uncertain.background.close() }
  })
})

test('native registration survives the pinned abort envelope losing value and kills only the newly created job', async () => {
  await withDesktopPlugin(async plugin => {
    const f = nativeJobFixture(plugin)
    try {
      await plugin.trackPersonalExecution(f.bridge, f.exec(), async () => {
        await Promise.resolve()
        f.start('pwsh-new')
        f.controller.abort()
        return { isError: true, error: { info: { code: 'TOOL_ABORTED' } }, content: [{ type: 'text', text: 'Error: tool call aborted' }] }
      }, f.background)
      const finish = f.frames.find(frame => frame.action === 'finish_execution')
      assert.equal(finish.state, 'cancelled'); assert.equal(finish.jobId, 'pwsh-new'); assert.equal(finish.jobState, 'killed')
      assert.deepEqual(f.killed, ['pwsh-new']); assert.deepEqual(f.waited, ['pwsh-new'])
      assert.equal(f.snapshots.get('pwsh-existing').status, 'running')
    } finally { f.background.close() }
  })
})

test('a post-body approval receipt failure stops only its captured job and keeps the execution receipt unfinished', async () => {
  await withDesktopPlugin(async plugin => {
    const f = nativeJobFixture(plugin)
    try {
      const approvals = { beforeExecution: async () => {}, afterExecution: async () => { throw new Error('synthetic approval receipt failure') } }
      await assert.rejects(plugin.trackPersonalExecution(f.bridge, f.exec(), async () => {
        f.start('pwsh-effect')
        return { isError: false, value: { kind: 'background', jobId: 'pwsh-effect' }, content: [] }
      }, f.background, approvals), { code: 'TOOL_SOURCE_UNAVAILABLE', personalExecutionUncertain: true })
      assert.deepEqual(f.killed, ['pwsh-effect']); assert.deepEqual(f.waited, ['pwsh-effect'])
      assert.equal(f.snapshots.get('pwsh-existing').status, 'running')
      const observation = f.frames.find(frame => frame.action === 'finish_execution')
      assert.equal(observation.state, 'uncertain'); assert.equal('resultHash' in observation, false)
    } finally { f.background.close() }
  })
})

test('native claim and durable receipt failures release just-created work without inventing a successful receipt', async () => {
  await withDesktopPlugin(async plugin => {
    for (const [allowClaim, failFinish, code] of [[false, false, 'TOOL_SOURCE_UNAVAILABLE'], [true, true, 'PERSONAL_TOOL_TIMEOUT']]) {
      const f = nativeJobFixture(plugin, allowClaim as boolean, failFinish as boolean)
      try {
        await assert.rejects(plugin.trackPersonalExecution(f.bridge, f.exec(), async () => {
          f.start('pwsh-new')
          return { isError: false, value: { kind: 'background', jobId: 'pwsh-new' }, content: [{ type: 'text', text: 'started background job pwsh-new' }] }
        }, f.background), { code })
        assert.deepEqual(f.killed, ['pwsh-new']); assert.deepEqual(f.waited, ['pwsh-new'])
        assert.equal(f.snapshots.get('pwsh-existing').status, 'running')
        const finish = f.frames.find(frame => frame.action === 'finish_execution')
        if (!allowClaim) { assert.equal(finish.state, 'failed'); assert.equal('jobId' in finish, false) }
      } finally { f.background.close() }
    }
  })
})

test('refused ownership with a still-stopping or throwing cleanup records unknown effects rather than hiding a live job', async () => {
  await withDesktopPlugin(async plugin => {
    for (const cleanup of ['stopping', 'throw']) {
      const f = nativeJobFixture(plugin, false, false, cleanup === 'stopping' ? 'pwsh-unconfirmed' : undefined, cleanup === 'throw')
      try {
        await assert.rejects(plugin.trackPersonalExecution(f.bridge, f.exec(), async () => {
          f.start('pwsh-unconfirmed')
          return { isError: false, value: { kind: 'background', jobId: 'pwsh-unconfirmed' }, content: [] }
        }, f.background), { code: 'TOOL_SOURCE_UNAVAILABLE', personalExecutionUncertain: true })
        assert.deepEqual(f.killed, ['pwsh-unconfirmed']); assert.deepEqual(f.waited, ['pwsh-unconfirmed'])
        assert.equal(f.snapshots.get('pwsh-unconfirmed').status, 'stopping')
        assert.equal(f.snapshots.get('pwsh-existing').status, 'running')
        const observation = f.frames.find(frame => frame.action === 'finish_execution')
        assert.equal(observation.state, 'uncertain'); assert.equal('resultHash' in observation, false)
        assert.equal('jobId' in observation, false)
        assert.equal(f.frames.some(frame => frame.action === 'finish_execution' && frame.state === 'failed'), false)
      } finally { f.background.close() }
    }
  })
})

test('a receipt stopped before native registration kills its late job and refuses unowned or replaced-agent records', async () => {
  const owner = { id: 'session-late', session: { id: 'session-late', header: { agentPreset: 'personal-remote' } } }
  const states = new Map([['pwsh-late', 'running'], ['pwsh-other', 'running'], ['pwsh-unowned', 'running']]), killed: string[] = []
  const jobs = { get: (id: string) => ({ id, kind: 'pwsh', ownerSession: id === 'pwsh-unowned' ? undefined : owner.id, status: states.get(id) }),
    kill: (id: string) => { killed.push(id); states.set(id, 'stopping') },
    wait: async (id: string) => { states.set(id, 'killed') } }
  const claims = new Map(), stopped = new Map([[`${owner.id}\u0000receipt-late`, true]])
  const agents = { get: () => owner }
  const claim = (receiptId: string, jobId: string) => ({ sessionId: owner.id, receiptId, jobId, owner })
  assert.equal(await claimReceiptBackgroundJob(agents, jobs, claims, stopped, claim('receipt-late', 'pwsh-late')), true)
  assert.equal(claimReceiptBackgroundJob(agents, jobs, claims, stopped, claim('receipt-other', 'pwsh-other')), true)
  assert.equal(claimReceiptBackgroundJob(agents, jobs, claims, stopped, claim('receipt-late', 'pwsh-unowned')), false)
  assert.equal(claimReceiptBackgroundJob(agents, jobs, claims, stopped, { ...claim('receipt-late', 'pwsh-late'), owner: { ...owner } }), false)
  assert.deepEqual(killed, ['pwsh-late']); assert.equal(states.get('pwsh-other'), 'running')
})

test('a repeated stop cannot hide an unconfirmed native job behind its earlier turn cancellation acknowledgement', async () => {
  const replies: any[] = []
  let jobState = 'killed'
  const handler = createTaskStopHandler({ get: () => null }, new Map(), (reply: any) => replies.push(reply),
    async () => [{ receiptId: 'receipt-stop', backgroundJobs: [{ jobId: 'pwsh-stop', state: jobState }] }])
  const frame = { protocol: 'weftmate.personal-task-control.v1', id: 'stop-12345678-1234-1234-1234-123456789abc',
    sessionId: 'session-stop', requestId: 'request-stop', receiptIds: ['receipt-stop'] }
  handler(frame); await new Promise(resolve => setImmediate(resolve))
  assert.equal(replies.at(-1).status, 'cancel_requested')
  jobState = 'unconfirmed'; handler(frame); await new Promise(resolve => setImmediate(resolve))
  assert.equal(replies.at(-1).status, 'unconfirmed')
  assert.equal(replies.at(-1).outcomes[0].backgroundJobs[0].state, 'unconfirmed')
})

test('tool lifecycle derives a nested call from the real root event and records cancellation after the body settles', async () => {
  const root = mkdtempSync(join(tmpdir(), 'general-plugin-'))
  try {
    const staged = stagePersonalPlugins(root).plugin
    const { personalExecutionIdentity, trackPersonalExecution } = await import(staged)
    const controller = new AbortController(), frames: any[] = []
    const exec = { name: 'pwsh', arguments: { command: 'private command' }, callId: 'nested-call', rootCallId: 'root-call',
      signal: controller.signal, agent: { session: { id: 'session-test', header: { agentPreset: 'personal-remote' }, events: [
        { type: 'turn/start', data: { turn: 1 } },
        { type: 'user/message', data: { source: { kind: 'user', rpcId: 'receipt-test' }, content: [{ type: 'text', text: 'goal' }] } },
        { type: 'tool/call', data: { callId: 'root-call', name: 'weftmod_script', turn: 1 } },
      ] } } }
    assert.equal(personalExecutionIdentity(exec).receiptId, 'receipt-test')
    const bridge = { request: async (frame: any, signal?: AbortSignal) => {
      frames.push({ frame, signal }); return { executionId: 'exec-' + 'a'.repeat(48), state: frame.state ?? 'running' }
    } }
    for (const [value, expected] of [
    [{ timedOut: true }, 'cancelled'], [{ timed_out: true }, 'cancelled'],
    [{ killed: true }, 'cancelled'], [{ signal: 'SIGKILL' }, 'cancelled'],
    [{ exitCode: 130 }, 'cancelled'], [{ exit_code: 143 }, 'cancelled'],
    [{ exitCode: 1 }, 'failed'], [{ exit_code: '2' }, 'failed'],
    [{ stderr: 'Command timed out after 10 seconds' }, 'cancelled'],
    [{ output: 'Process terminated by signal SIGTERM' }, 'cancelled'],
    [{ output: 'Process exited with exit code 7' }, 'failed'],
    [{ exitCode: 0, timedOut: false, killed: false, signal: null }, 'completed']
  ]) {
      for (const result of [value, { isError: false, value }, { isError: false, payload: { result: value } }]) {
        frames.length = 0
        assert.equal(await trackPersonalExecution(bridge, exec, async () => result), result)
        assert.equal(frames[1].frame.state, expected)
      }
    }
    frames.length = 0
    await trackPersonalExecution(bridge, exec, async () => { controller.abort(); return { isError: true } })
    assert.equal(frames[1].frame.state, 'cancelled')
    assert.equal(frames[1].signal, undefined, 'cancellation still records its final receipt')
    assert.equal(JSON.stringify(frames).includes('private command'), false)
    assert.throws(() => personalExecutionIdentity({ ...exec, rootCallId: 'invented' }), { code: 'TOOL_SOURCE_UNAVAILABLE' })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('DSH 0.2.2 jobs API (events.subscribe, string caller, snapshot.owner) tracks background, promoted, and stopped pwsh jobs without JOB_FOREIGN_SESSION', async () => {
  await withDesktopPlugin(async plugin => {
    const frames: any[] = [], killed: string[] = [], listeners: any[] = []
    const owner = {
      id: 'session-dsh022',
      session: {
        id: 'session-dsh022',
        header: { agentPreset: 'personal-remote' },
        events: [
          { type: 'turn/start', data: { turn: 1 } },
          { type: 'user/message', data: { source: { kind: 'user', rpcId: 'receipt-dsh022' }, content: [{ type: 'text', text: 'run bg build' }] } },
          { type: 'tool/call', data: { callId: 'call-bg', name: 'pwsh', turn: 1 } },
          { type: 'tool/call', data: { callId: 'call-promoted', name: 'pwsh', turn: 1 } },
          { type: 'tool/call', data: { callId: 'call-fg', name: 'pwsh', turn: 1 } },
        ],
      },
    }
    const snapshots = new Map<string, any>()
    const expectCaller = (caller: unknown) => {
      if (caller !== owner.id) throw Object.assign(new Error('belongs to another session'), { code: 'JOB_FOREIGN_SESSION' })
    }
    const emit = (event: any) => listeners.forEach(fn => fn(event))
    const jobs = {
      events: {
        subscribe: (filter: any, listener: any) => {
          assert.deepEqual(filter, { owners: 'all' })
          listeners.push(listener)
          return () => { const i = listeners.indexOf(listener); if (i >= 0) listeners.splice(i, 1) }
        },
      },
      list: (caller: unknown) => { expectCaller(caller); return [...snapshots.values()].map(v => ({ ...v })) },
      get: (id: string, caller: unknown) => { expectCaller(caller); assert.ok(snapshots.has(id)); return { ...snapshots.get(id) } },
      kill: (id: string, caller: unknown) => {
        expectCaller(caller); killed.push(id)
        const s = snapshots.get(id); s.status = 'stopping'; emit({ type: 'stopping', job: { ...s } })
      },
      wait: async (id: string, ms: number, caller: unknown) => {
        expectCaller(caller); assert.equal(ms, 2000)
        const s = snapshots.get(id); s.status = 'killed'; emit({ type: 'settled', job: { ...s }, cause: 'kill', awaited: true })
      },
    }
    const claims = new Map(), stopped = new Map()
    const agents = { get: (id: string) => id === owner.id ? owner : undefined }
    const bridge = {
      request: async (frame: any) => {
        frames.push(frame)
        return { executionId: `exec-${frame.callId.padEnd(48, '0')}`, state: frame.state ?? 'running' }
      },
    }
    const ctx = {
      get: (name: string) => name === 'jobs' ? jobs : undefined,
      inject: (_deps: string[], cb: any) => cb({ jobs }),
      waterfall: async (_event: string, claim: any) => claimReceiptBackgroundJob(agents, jobs, claims, stopped, claim),
    }
    const background = plugin.createPersonalBackgroundTracker(ctx, bridge)
    const startJob = (id: string) => {
      const snap = { id, kind: 'pwsh', owner: owner.id, status: 'running' }
      snapshots.set(id, snap)
      emit({ type: 'registered', job: { ...snap } })
    }
    try {
      // 1. Explicit run_in_background: true
      await plugin.trackPersonalExecution(bridge, {
        name: 'pwsh', arguments: { command: 'apktool b', run_in_background: true },
        callId: 'call-bg', agent: owner,
      }, async () => {
        startJob('pwsh-bg001')
        return { isError: false, value: { kind: 'background', jobId: 'pwsh-bg001' }, content: [{ type: 'text', text: 'started background job pwsh-bg001' }] }
      }, background)
      // 2. Foreground command promoted on timeout
      await plugin.trackPersonalExecution(bridge, {
        name: 'pwsh', arguments: { command: 'slow-cmd' },
        callId: 'call-promoted', agent: owner,
      }, async () => {
        startJob('pwsh-prom002')
        return { isError: false, value: { kind: 'promoted', jobId: 'pwsh-prom002', timeoutMs: 30000, output: '' }, content: [{ type: 'text', text: 'moved to background' }] }
      }, background)
      // 2b. Foreground command completes normally (DSH 0.2.2 registers then removes temporary job before returning)
      await plugin.trackPersonalExecution(bridge, {
        name: 'pwsh', arguments: { command: 'Get-Content built.txt' },
        callId: 'call-fg', agent: owner,
      }, async () => {
        startJob('pwsh-fg003')
        const fg = snapshots.get('pwsh-fg003'); fg.status = 'completed'
        snapshots.delete('pwsh-fg003')
        emit({ type: 'removed', job: { ...fg } })
        return { isError: false, value: { kind: 'foreground', exitCode: 0, stdout: { text: 'APK_BUILT_OK' } }, content: [{ type: 'text', text: 'APK_BUILT_OK' }] }
      }, background)

      const finishes = frames.filter(f => f.action === 'finish_execution')
      assert.deepEqual(finishes.map(f => [f.callId, f.state, f.jobId, f.jobState]), [
        ['call-bg', 'completed', 'pwsh-bg001', 'running'],
        ['call-promoted', 'completed', 'pwsh-prom002', 'running'],
        ['call-fg', 'completed', undefined, undefined],
      ])

      // 3. Natural settlement delivers observe_execution_job
      const bg = snapshots.get('pwsh-bg001'); bg.status = 'completed'
      emit({ type: 'settled', job: { ...bg }, cause: 'producer', awaited: false })
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(frames.some(f => f.action === 'observe_execution_job' && f.jobId === 'pwsh-bg001' && f.jobState === 'completed'), true)

      // 4. Task stop kills remaining promoted job using string caller
      const stoppedRes = await stopReceiptBackgroundJobs(jobs, claims, { sessionId: owner.id, receiptIds: ['receipt-dsh022'] })
      assert.deepEqual(killed, ['pwsh-prom002'])
      assert.deepEqual(stoppedRes[0].backgroundJobs, [
        { jobId: 'pwsh-bg001', state: 'completed' },
        { jobId: 'pwsh-prom002', state: 'killed' },
      ])
    } finally {
      background.close()
      assert.equal(listeners.length, 0)
    }
  })
})
