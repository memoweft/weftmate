import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '../vendor/dsh-runtime/node_modules/@deepseek-ai/cordis/lib/index.js'
import { WorkerThreadCodeRuntime } from '../vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-code-runtime-worker-thread/lib/index.js'
import { WeftModService } from '../src/runtime/weftmod/service.mjs'

async function fixture(t: any) {
  const root = await mkdtemp(join(tmpdir(), 'weftmod-script-'))
  const runtime = new WorkerThreadCodeRuntime(new Context(), { computeMs: 60000, maxWallMs: 600000, maxOutputBytes: 67108864, maxOldGenerationSizeMb: 512 })
  t.after(async () => { await runtime.teardown(); await rm(root, { recursive: true, force: true }) })
  const calls: any[] = [], deferred: any[] = [], controls: any[] = []
  const controller = new AbortController()
  const exec = { agent: { session: { id: 'test-session' } }, callId: 'call-1', rootCallId: 'call-1', token: Symbol(), signal: controller.signal, deferContext: (value: any) => deferred.push(value) }
  const ctx = { codeRuntime: runtime, tools: {
    schemas: () => [{ name: 'echo' }, { name: 'fail' }, { name: 'slow' }, { name: 'weftmod' }, { name: 'run_code' }, { name: 'weftmod_script' }],
    execute: async (call: any) => {
      calls.push(call)
      if (call.name === 'fail') return { isError: true, content: [{ type: 'text', text: 'screen changed' }] }
      if (call.name === 'slow') {
        await new Promise<void>(resolve => call.signal.addEventListener('abort', () => resolve(), { once: true }))
        return { isError: true, content: [{ type: 'text', text: 'stopped' }] }
      }
      if (call.name === 'weftmod') {
        if (call.arguments.action === 'observe') return { isError: false, value: { run_id: call.arguments.run_id, observation_id: `observation-${calls.length}` } }
        if (call.arguments.action === 'act') return { isError: false, value: { run_id: call.arguments.run_id, accepted: true, outcome: 'accepted' } }
        if (call.arguments.action === 'control') return { isError: false, value: { run_id: call.arguments.run_id, status: call.arguments.control === 'complete' ? 'completed' : call.arguments.control } }
        return { isError: false, value: { run_id: 'device-1', device_profile_id: 'test-profile' } }
      }
      return { isError: false, value: call.arguments, additionalContexts: [{ content: 'test image context' }] }
    },
  } }
  const transport = { controlDeviceRun: async (...args: any[]) => { controls.push(args); return { status: args[1] } } }
  const service = new WeftModService({ root, ctx, transport, identity: () => ({}), approve: async () => 'full-access', image: async (v: any) => v, desktop: async () => ({ ok: true }) })
  await service.ready
  return { service, exec, calls, controls, deferred, controller, root }
}

test('a successful script without terminal observation remains unverified and is not reused', async t => {
  const f = await fixture(t)
  await f.service.script({ action: 'save', script_id: 'collect-report', code: 'const values=[]; for(let i=0;i<params.count;i++) values.push(await tools.echo({item:i})); return values;', description: 'collect a report' }, f.exec)
  const first = await f.service.script({ action: 'run', script_id: 'collect-report', params: { count: 3 } }, f.exec)
  assert.equal(first.status, 'succeeded')
  assert.equal(first.reused, false)
  assert.equal(first.tool_calls, 3)
  assert.deepEqual(first.result, [{ item: 0 }, { item: 1 }, { item: 2 }])
  const second = await f.service.script({ action: 'run', script_id: 'collect-report', params: { count: 1 } }, f.exec)
  assert.equal(second.reused, false)
  assert.equal(second.script_revision, first.script_revision)
  assert.equal(second.sha256, first.sha256)
  assert.equal(second.tool_calls, 1)
  assert.equal((await f.service.store.run(second.run_id)).reused, false, 'the persisted receipt matches the tool result')
  assert.equal(f.calls[0].parent, f.exec.token)
  assert.equal(f.calls[0].agent, f.exec.agent)
  assert.equal(f.deferred.length, 4)
  await f.service.script({ action: 'save', script_id: 'collect-report', code: 'return params;' }, f.exec)
  const edited = await f.service.store.script('collect-report')
  assert.equal(edited.revision, 2)
  assert.equal(edited.successful_runs, 0)
})

test('pre-contract phone scripts retain legacy execution behavior without being rewritten', async t => {
  const f = await fixture(t)
  await f.service.store.saveDeviceOwner('device-1', 'test-session')
  const code = "const phone=await tools.weftmod({action:'begin'}); const state=await tools.weftmod({action:'observe',run_id:phone.run_id}); await tools.weftmod({action:'control',run_id:phone.run_id,control:'complete'}); return state;"
  await writeFile(join(f.root, 'scripts', 'android-screen-report-v5.json'), `${JSON.stringify({ script_id: 'android-screen-report-v5', code, description: 'Existing XML report asset', parameters: {}, applicability: '', sha256: 'legacy-sha', revision: 5, successful_runs: 2, updated_at: new Date().toISOString(), last_run: 'legacy-run' })}\n`, 'utf8')
  const first = await f.service.script({ action: 'run', script_id: 'android-screen-report-v5' }, f.exec)
  assert.equal(first.status, 'succeeded')
  assert.equal(first.verification.terminal_verified, false)
  assert.equal(first.reused, true)
  const persisted = await f.service.store.run(first.run_id)
  assert.equal(persisted.reused, true)
  assert.equal(persisted.reuse_attempted, true)
  const legacy = await f.service.store.script('android-screen-report-v5')
  assert.equal(legacy.revision, 5)
  assert.equal(legacy.verification_contract_version, undefined)
  assert.equal(legacy.successful_runs, 3)
})

test('real tool error returns to agent and releases device instead of claiming script success', async t => {
  const f = await fixture(t)
  await f.service.script({ action: 'save', script_id: 'failing', code: 'await tools.weftmod({action:"begin"}); await tools.fail({}); await tools.echo({unexpected:true});' }, f.exec)
  const run = await f.service.script({ action: 'run', script_id: 'failing' }, f.exec)
  assert.equal(run.status, 'failed')
  assert.match(run.error.message, /screen changed/)
  assert.deepEqual(f.calls.map(c => c.name), ['weftmod', 'fail'])
  assert.deepEqual(f.controls, [['device-1', 'pause']])
  assert.equal((await f.service.store.script('failing')).successful_runs, 0)
})

test('direct cancellation aborts an in-flight binding and cannot cross conversations', async t => {
  const f = await fixture(t)
  await f.service.script({ action: 'save', script_id: 'waiting', code: 'await tools.weftmod({action:"begin"}); await tools.slow({}); return "must not finish";' }, f.exec)
  const pending = f.service.script({ action: 'run', script_id: 'waiting' }, f.exec)
  while (!f.calls.some(c => c.name === 'slow')) await new Promise(r => setTimeout(r, 5))
  const run = (await f.service.store.runs('test-session'))[0]
  await assert.rejects(() => f.service.control(run.run_id, 'cancel', 'other-session'), /not found/)
  const control = await f.service.control(run.run_id, 'cancel', 'test-session')
  assert.equal(control.status, 'stopping')
  assert.equal((await pending).status, 'cancelled')
  assert.ok(f.controls.some(c => c[0] === 'device-1' && c[1] === 'cancel'))
  assert.equal(f.service.active.size, 0)
})

test('hard cancellation stops CPU loop; restart preserves receipts without rerunning', async t => {
  const f = await fixture(t)
  await f.service.script({ action: 'save', script_id: 'loop', code: 'while(true) {}' }, f.exec)
  const pending = f.service.script({ action: 'run', script_id: 'loop' }, f.exec)
  while (!f.service.active.size) await new Promise(r => setTimeout(r, 5))
  const id = [...f.service.active.keys()][0]
  await f.service.control(id, 'pause', 'test-session')
  assert.equal((await pending).status, 'paused')
  const unfinished = await f.service.store.newRun({ session_id: 'test-session', script_id: 'loop' })
  await f.service.store.initialize()
  assert.equal((await f.service.store.run(unfinished.run_id)).status, 'interrupted')
  assert.equal(f.calls.length, 0)
  await assert.rejects(() => f.service.store.save({ script_id: '../escape', code: 'return 1' }), /Invalid/)
})

test('cancelling a begin waits for its accepted reply then releases the device', async t => {
  const f = await fixture(t)
  let release: any, started: any
  const begun = new Promise<void>(resolve => { started = resolve })
  f.service.transport.createDeviceRun = async (request: any) => {
    started()
    await new Promise(resolve => { release = resolve })
    return { run_id: request.run_id, status: 'active' }
  }
  const pending = f.service.device({ action: 'begin', run_id: 'delayed-device', device_profile_id: 'test-profile' }, f.exec)
  await begun
  f.controller.abort()
  release()
  await assert.rejects(() => pending, /abort/i)
  assert.deepEqual(f.controls, [['delayed-device', 'pause']])
  assert.equal((await f.service.store.deviceOwner('delayed-device')).session_id, 'test-session')
})

test('transport uncertainty pauses a standalone batch and retains its original command identifier', async t => {
  const f = await fixture(t)
  await f.service.store.saveDeviceOwner('device-1', 'test-session')
  f.service.transport.actDeviceRun = async () => { throw Object.assign(new Error('transport timed out'), { code: 'AI_GAME_TIMEOUT' }) }
  await assert.rejects(() => f.service.device({ action: 'act', run_id: 'device-1', command_id: 'same-command', actions: [{ action: 'tap', x: 1, y: 1 }] }, f.exec), error => {
    const result = JSON.parse(error.message)
    assert.equal(result.command_id, 'same-command')
    assert.equal(result.outcome, 'uncertain')
    assert.equal(result.pause_confirmed, true)
    return true
  })
  assert.deepEqual(f.controls, [['device-1', 'pause']])
})

test('direct device actions canonicalize common keyevent aliases and preserve Android settings components', async t => {
  const f = await fixture(t)
  await f.service.store.saveDeviceOwner('device-1', 'test-session')
  let received: any
  f.service.transport.actDeviceRun = async (_runId: string, input: any) => {
    received = input
    return { run_id: 'device-1', command_id: input.command_id, accepted: true, outcome: 'accepted', results: [] }
  }
  await f.service.device({
    action: 'act', run_id: 'device-1', command_id: 'open-settings', actions: [
      { action: 'open_app', package: 'com.android.settings', component: '.homepage.Settings' },
      { action: 'keyevent', keycode: 'BACK' },
      { action: 'keyevent', keycode: 'HOME' },
    ],
  }, f.exec)
  assert.deepEqual(received, {
    command_id: 'open-settings', actions: [
      { action: 'open_app', package: 'com.android.settings', component: '.homepage.Settings' },
      { action: 'keyevent', keycode: 'KEYCODE_BACK' },
      { action: 'keyevent', keycode: 'KEYCODE_HOME' },
    ],
  })
})

test('rejected direct actions give the agent a corrective observe-first receipt without replaying', async t => {
  const f = await fixture(t)
  await f.service.store.saveDeviceOwner('device-1', 'test-session')
  f.service.transport.actDeviceRun = async () => ({
    run_id: 'device-1', command_id: 'bad-key', accepted: false, outcome: 'rejected', requires_observation: true,
    results: [{ index: 0, action: 'keyevent', accepted: false, outcome: 'rejected', detail: 'The device action parameters were rejected.' }],
  })
  await assert.rejects(() => f.service.device({
    action: 'act', run_id: 'device-1', command_id: 'bad-key', actions: [{ action: 'keyevent', keycode: 'UNKNOWN' }],
  }, f.exec), error => {
    const receipt = JSON.parse(error.message)
    assert.equal(error.code, 'WEFTMOD_DEVICE_ACTION_REJECTED')
    assert.deepEqual(receipt.requested_action, { action: 'keyevent', keycode: 'UNKNOWN' })
    assert.deepEqual(receipt.sent_action, { action: 'keyevent', keycode: 'UNKNOWN' })
    assert.match(receipt.correction, /KEYCODE_BACK/)
    assert.match(receipt.next_step, /action:'observe'/)
    assert.match(receipt.next_step, /Do not blindly resend/)
    return true
  })
})

test('an uncertain open_app receipt stays uncertain and requires observation before any replacement action', async t => {
  const f = await fixture(t)
  await f.service.store.saveDeviceOwner('device-1', 'test-session')
  let calls = 0
  f.service.transport.actDeviceRun = async () => {
    calls++
    return {
      run_id: 'device-1', command_id: 'open-settings', accepted: false, outcome: 'uncertain', requires_observation: true,
      results: [{ index: 0, action: 'open_app', accepted: false, outcome: 'uncertain', detail: 'The device did not return a conclusive receipt. Observe before deciding the next action.' }],
    }
  }
  await assert.rejects(() => f.service.device({
    action: 'act', run_id: 'device-1', command_id: 'open-settings', actions: [{ action: 'open_app', package: 'com.android.settings', component: '.homepage.Settings' }],
  }, f.exec), error => {
    const receipt = JSON.parse(error.message)
    assert.equal(error.code, 'WEFTMOD_DEVICE_ACTION_UNCERTAIN')
    assert.equal(receipt.outcome, 'uncertain')
    assert.equal(receipt.correction, null)
    assert.match(receipt.next_step, /may already have taken effect/)
    assert.match(receipt.next_step, /Do not resend/)
    assert.match(receipt.next_step, /until the observation shows/)
    return true
  })
  assert.equal(calls, 1, 'the host must not retry an uncertain action')
})

test('an agent can save without inventing an identifier, but bare execution is not reusable', async t => {
  const f = await fixture(t)
  const saved = await f.service.script({ action: 'save', description: 'No manual identifier', code: 'return await tools.echo(params);' }, f.exec)
  assert.match(saved.script_id, /^script-/)
  assert.equal(saved.code, undefined, 'save receipt does not echo the whole source into model context')
  const first = await f.service.script({ action: 'run', code: 'return await tools.echo(params);', params: { value: 4 } }, f.exec)
  assert.equal(first.status, 'succeeded')
  const second = await f.service.script({ action: 'run', script_id: first.script_id, params: { value: 5 } }, f.exec)
  assert.equal(second.reused, false)
  assert.deepEqual(second.result, { value: 5 })
  await assert.rejects(() => f.service.script({ action: 'run' }, f.exec), /requires script_id.*or code/)
})

test('linked terminal observation upgrades a repaired revision and only that revision is reusable', async t => {
  const f = await fixture(t)
  await f.service.store.saveDeviceOwner('device-1', 'test-session')
  await f.service.script({ action: 'save', script_id: 'settings-developer-options', description: 'Open Settings and enter Developer options', applicability: 'Android Settings navigation', code: "throw new Error('Screen changed; observe and repair before retrying');" }, f.exec)
  const failed = await f.service.script({ action: 'run', script_id: 'settings-developer-options' }, f.exec)
  assert.equal(failed.status, 'failed')
  assert.equal((await f.service.store.script('settings-developer-options')).verified_runs, 0)

  const repaired = `
const phone = await tools.weftmod({action:'begin'});
const before = await tools.weftmod({action:'observe',run_id:phone.run_id});
await tools.weftmod({action:'act',run_id:phone.run_id,actions:[{action:'tap',x:1,y:1}]});
const final = await tools.weftmod({action:'observe',run_id:phone.run_id});
if (!final.observation_id) throw new Error('Screen changed; no final observation');
await tools.weftmod({action:'control',run_id:phone.run_id,control:'complete'});
return {verification:{matched:true,observation_id:final.observation_id,target:'Developer options'}};
`
  const saved = await f.service.script({ action: 'save', script_id: 'settings-developer-options', description: 'Open Settings and enter Developer options', applicability: 'Android Settings navigation', code: repaired }, f.exec)
  assert.equal(saved.revision, 2)
  const first = await f.service.script({ action: 'run', script_id: 'settings-developer-options' }, f.exec)
  assert.equal(first.status, 'succeeded')
  assert.equal(first.reused, false)
  assert.equal(first.verification.terminal_verified, true)
  const second = await f.service.script({ action: 'run', script_id: 'settings-developer-options' }, f.exec)
  assert.equal(second.reused, true)
  const asset = await f.service.store.script('settings-developer-options')
  assert.equal(asset.revision, 2)
  assert.equal(asset.successful_runs, 2)
  assert.equal(asset.verified_runs, 2)
  const candidates = await f.service.reuseCandidates('进入开发者选项')
  assert.equal(candidates[0].script_id, 'settings-developer-options')
  assert.equal(candidates[0].revision, 2)
  assert.equal(candidates[0].reusable, true)
})

test('failed or unknown tool outcomes never promote a saved script', async t => {
  const f = await fixture(t)
  await f.service.script({ action: 'save', script_id: 'unknown-device-state', code: "await tools.weftmod({action:'begin'}); await tools.fail({outcome:'uncertain'}); return {verification:{matched:true,observation_id:'invented'}};" }, f.exec)
  const run = await f.service.script({ action: 'run', script_id: 'unknown-device-state' }, f.exec)
  assert.equal(run.status, 'failed')
  assert.equal(run.verification.terminal_verified, false)
  const asset = await f.service.store.script('unknown-device-state')
  assert.equal(asset.successful_runs, 0)
  assert.equal(asset.verified_runs, 0)
})

test('direct completion captures no XML or images, binds one pending script, and requires a fresh compact check', async t => {
  const f = await fixture(t)
  f.service.transport.deviceProfiles = async () => ({ items: [{ device_profile_id: 'test-profile', is_default: true }] })
  f.service.transport.createDeviceRun = async (request: any) => ({ run_id: request.run_id, device_profile_id: request.device_profile_id, status: 'active' })
  f.service.transport.observeDeviceRun = async (run_id: string) => ({ run_id, observation_id: `direct-${Date.now()}`, ui_tree: { format: 'xml', xml: '<hierarchy><secret/></hierarchy>', status: 'ok' }, screenshot: { base64: 'not-persisted' } })
  f.service.transport.actDeviceRun = async (run_id: string, input: any) => ({ run_id, command_id: input.command_id, accepted: true, outcome: 'accepted' })
  f.service.transport.controlDeviceRun = async (run_id: string, control: string) => ({ run_id, status: control === 'complete' ? 'completed' : control })
  f.service.captureTarget('test-session', 'Open Settings and enter Developer options', 'D:/workspace', { turn: 1, message_id: 'goal-1', turn_started_at: Date.now() - 20 })
  const device = await f.service.device({ action: 'begin', run_id: 'device-1' }, f.exec)
  await f.service.device({ action: 'observe', run_id: device.run_id }, f.exec)
  await f.service.device({ action: 'act', run_id: device.run_id, actions: [{ action: 'tap', x: 1, y: 1 }] }, f.exec)
  await f.service.device({ action: 'observe', run_id: device.run_id }, f.exec)
  const complete = await f.service.device({ action: 'control', run_id: device.run_id, control: 'complete' }, f.exec)
  assert.equal(complete.pending_script.status, 'captured')
  const captured = await f.service.store.deviceOwner('device-1')
  assert.equal(captured.pending_script.target, 'Open Settings and enter Developer options')
  assert.equal(JSON.stringify(captured.pending_script).includes('<hierarchy>'), false)
  assert.equal(JSON.stringify(captured.pending_script).includes('not-persisted'), false)

  await f.service.script({ action: 'save', script_id: 'developer-options', code: 'return true;' }, f.exec)
  assert.equal((await f.service.store.deviceOwner('device-1')).pending_script.status, 'bound')
  const stale = `const d=await tools.weftmod({action:'begin'}); const before=await tools.weftmod({action:'observe',run_id:d.run_id,ui_tree_format:'compact'}); await tools.weftmod({action:'act',run_id:d.run_id,actions:[{action:'tap',x:1,y:1}]}); await tools.weftmod({action:'control',run_id:d.run_id,control:'complete'}); return {verification:{matched:true,observation_id:before.observation_id,target:'Developer options'}};`
  await f.service.script({ action: 'save', script_id: 'developer-options', code: stale }, f.exec)
  const rejected = await f.service.script({ action: 'run', script_id: 'developer-options' }, f.exec)
  assert.equal(rejected.status, 'unverified')
  assert.equal(rejected.reused, false)
  assert.equal(rejected.verification.terminal_verified, false)
  assert.match(rejected.verification.reason, /not fresh/)
  assert.equal((await f.service.store.deviceOwner('device-1')).pending_script.status, 'verification_required')
  assert.equal((await f.service.continuation('test-session', { turn: 1, message_id: 'goal-1' }, new AbortController().signal)).status, 'verification_required')

  const repaired = `const d=await tools.weftmod({action:'begin'}); const before=await tools.weftmod({action:'observe',run_id:d.run_id,ui_tree_format:'compact'}); await tools.weftmod({action:'act',run_id:d.run_id,actions:[{action:'tap',x:1,y:1}]}); const final=await tools.weftmod({action:'observe',run_id:d.run_id,ui_tree_format:'compact'}); if(!final.observation_id) throw new Error('screen changed'); await tools.weftmod({action:'control',run_id:d.run_id,control:'complete'}); return {verification:{matched:true,observation_id:final.observation_id,target:'Developer options'}};`
  await f.service.script({ action: 'save', script_id: 'developer-options', code: repaired }, f.exec)
  const verified = await f.service.script({ action: 'run', script_id: 'developer-options' }, f.exec)
  assert.equal(verified.status, 'succeeded')
  assert.equal(verified.verification.terminal_verified, true)
  assert.equal((await f.service.store.deviceOwner('device-1')).pending_script.status, 'verified')
})

test('a caught uncertain action invalidates the old observation until a fresh observation is checked', async t => {
  const f = await fixture(t)
  await f.service.store.saveDeviceOwner('device-1', 'test-session')
  const execute = f.service.ctx.tools.execute
  f.service.ctx.tools.execute = async (call: any) => call.name === 'weftmod' && call.arguments.action === 'act'
    ? { isError: true, content: [{ type: 'text', text: 'uncertain device receipt' }] }
    : execute(call)
  const stale = `const d=await tools.weftmod({action:'begin'}); const before=await tools.weftmod({action:'observe',run_id:d.run_id,ui_tree_format:'compact'}); try { await tools.weftmod({action:'act',run_id:d.run_id,actions:[{action:'tap',x:1,y:1}]}); } catch {} await tools.weftmod({action:'control',run_id:d.run_id,control:'complete'}); return {verification:{matched:true,observation_id:before.observation_id,target:'Developer options'}};`
  await f.service.script({ action: 'save', script_id: 'uncertain-repair', code: stale }, f.exec)
  const rejected = await f.service.script({ action: 'run', script_id: 'uncertain-repair' }, f.exec)
  assert.equal(rejected.status, 'unverified')
  assert.equal(rejected.verification.terminal_verified, false)
  assert.match(rejected.verification.reason, /not fresh/)
  const repaired = `const d=await tools.weftmod({action:'begin'}); const before=await tools.weftmod({action:'observe',run_id:d.run_id,ui_tree_format:'compact'}); try { await tools.weftmod({action:'act',run_id:d.run_id,actions:[{action:'tap',x:1,y:1}]}); } catch {} const final=await tools.weftmod({action:'observe',run_id:d.run_id,ui_tree_format:'compact'}); if(!final.observation_id) throw new Error('screen changed'); await tools.weftmod({action:'control',run_id:d.run_id,control:'complete'}); return {verification:{matched:true,observation_id:final.observation_id,target:'Developer options'}};`
  await f.service.script({ action: 'save', script_id: 'uncertain-repair', code: repaired }, f.exec)
  const verified = await f.service.script({ action: 'run', script_id: 'uncertain-repair' }, f.exec)
  assert.equal(verified.verification.terminal_verified, true)
})

test('begin defaults and repeated exploration reuse this conversation connection until it is completed', async t => {
  const f = await fixture(t)
  let created = 0
  const devices = new Map<string, any>()
  f.service.transport.deviceProfiles = async () => ({ items: [{ device_profile_id: 'profile-current', is_default: true }] })
  f.service.transport.createDeviceRun = async (request: any) => {
    created++
    const result = { run_id: request.run_id, status: 'active', device_profile_id: request.device_profile_id }
    devices.set(result.run_id, result)
    return result
  }
  f.service.transport.deviceRun = async (id: string) => devices.get(id)
  f.service.transport.controlDeviceRun = async (id: string) => ({ ...devices.get(id), status: 'completed' })
  const first = await f.service.device({ action: 'begin', device_profile_id: 'default' }, f.exec)
  const reused = await f.service.device({ action: 'begin' }, f.exec)
  assert.equal(reused.run_id, first.run_id)
  assert.equal(reused.reused_connection, true)
  assert.equal(created, 1)
  await f.service.device({ action: 'control', run_id: first.run_id, control: 'complete' }, f.exec)
  const next = await f.service.device({ action: 'begin' }, f.exec)
  assert.notEqual(next.run_id, first.run_id)
  assert.equal(created, 2)
})

test('script discovery ranks multiple keywords and preserves a catalog fallback across languages', async t => {
  const f = await fixture(t)
  await f.service.script({ action: 'save', script_id: 'android-screen-report', code: 'return params.filename;', description: 'Read the current screen and write a report in Notepad' }, f.exec)
  await f.service.script({ action: 'save', script_id: 'other', code: 'return 2;', description: 'Organize files' }, f.exec)
  const ranked = await f.service.script({ action: 'list', query: 'screen report notepad observe' }, f.exec)
  assert.equal(ranked.scripts[0].script_id, 'android-screen-report')
  assert.deepEqual(ranked.scripts[0].parameter_names, ['filename'])
  assert.equal(ranked.matching, 'keyword_ranked')
  const fallback = await f.service.script({ action: 'list', query: '读取手机页面后在电脑打开报告' }, f.exec)
  assert.equal(fallback.matching, 'catalog_fallback')
  assert.equal(fallback.scripts.length, 2)
  assert.equal(fallback.scripts[0].code, undefined)
})
