/** DIAG-1: process metadata and recovery, using in-memory children only. */
import assert from 'node:assert/strict'
import childProcess, { type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { syncBuiltinESMExports } from 'node:module'
import { PassThrough } from 'node:stream'
import { test, type TestContext } from 'node:test'
import { DshWebRuntime, type DshProcessEvent } from '../src/dsh-web-runtime.ts'

class SyntheticChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  connected = false
  pid = undefined
  kill(): boolean { this.emit('close', null, 'SIGTERM'); return true }
  ready(): void { this.stdout.write('dsh web: http://127.0.0.1:43123\n') }
}

function fixture(t: TestContext, callback?: (event: Readonly<DshProcessEvent>) => void) {
  const child = new SyntheticChild()
  const events: DshProcessEvent[] = []
  const web = new DshWebRuntime({ homeDir: 'synthetic-home', workspaceDir: 'synthetic-workspace',
    onProcessEvent: event => { events.push({ ...event }); return callback?.(event) } })
  t.mock.method(childProcess, 'spawn', () => child as unknown as ChildProcess)
  syncBuiltinESMExports()
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports() })
  t.mock.method(web as any, 'launchSpec', () => ({ command: 'synthetic-node', nodeArgs: [], bin: 'synthetic-bin', cwd: 'synthetic-workspace' }))
  t.mock.method(web as any, 'childEnv', () => ({}))
  t.mock.timers.enable({ apis: ['setTimeout'] })
  return { web, child, events, spawn: () => (web as any).spawnOnce() as Promise<string> }
}

async function flush(): Promise<void> { await Promise.resolve(); await Promise.resolve() }

test('ready child unexpected zero exit is recorded and recovery keeps its exit metadata', async t => {
  const { web, child, events, spawn } = fixture(t)
  const started = spawn(); child.ready(); await started
  t.mock.method(web as any, 'preflightThenSpawn', async () => 'http://127.0.0.1:43124')
  const origins: Array<string | null> = []
  web.onOrigin = origin => origins.push(origin)
  child.emit('close', 0, null)
  assert.deepEqual(events, [{ reason: 'unexpected-exit', exitCode: 0, signal: null, action: 'respawn-scheduled' }])
  assert.deepEqual(origins, [null])
  t.mock.timers.tick(1000); await flush()
  assert.deepEqual(events[1], { reason: 'unexpected-exit', exitCode: 0, signal: null, action: 'respawn-succeeded' })
  assert.deepEqual(origins, [null, 'http://127.0.0.1:43124'])
  await web.close()
  assert.equal(events.some(event => event.action === 'respawn-abandoned'), false)
})

test('spawn stage observation preserves startup result and ignores sync/async observer failures', async t => {
  const { web, child, spawn } = fixture(t)
  const phases: string[] = []
  ;(web as any).opts.onStartupPhase = (phase: string) => {
    phases.push(phase)
    if (phase === 'runtime-spawn-requested') throw Error('private-observer')
    return Promise.reject(Error('private-async-observer'))
  }
  const started = spawn()
  child.emit('spawn')
  child.ready()
  assert.equal(await started, 'http://127.0.0.1:43123')
  assert.deepEqual(phases, ['runtime-spawn-requested', 'runtime-spawned'])
  await web.close()
})

test('abnormal exit preserves the Windows code, failed respawn and shutdown abandonment', async t => {
  const { web, child, events, spawn } = fixture(t)
  const started = spawn(); child.ready(); await started
  t.mock.method(web as any, 'preflightThenSpawn', async () => { throw new Error('synthetic-preflight-failure') })
  child.emit('close', -1073740791, null)
  t.mock.timers.tick(1000); await flush()
  assert.deepEqual(events.map(event => event.action), ['respawn-scheduled', 'respawn-failed', 'respawn-scheduled'])
  await web.close()
  assert.deepEqual(events.map(event => event.action), ['respawn-scheduled', 'respawn-failed', 'respawn-scheduled', 'respawn-abandoned'])
  assert.equal(events.every(event => event.exitCode === -1073740791 && event.signal === null), true)
  t.mock.timers.tick(20_000); await flush()
  assert.equal(events.length, 4, 'shutdown must retain the existing no-respawn fence')
})

test('exit by signal before ready records startup failure without scheduling background respawn', async t => {
  const { web, child, events, spawn } = fixture(t)
  const started = spawn()
  const rejected = assert.rejects(started, /启动即退出/)
  child.emit('close', null, 'SIGABRT')
  await rejected
  assert.deepEqual(events, [{ reason: 'startup-failed', exitCode: null, signal: 'SIGABRT', action: 'startup-failed' }])
  await web.close()
})

test('ready child signal exit retains the signal in the scheduled recovery event', async t => {
  const { web, child, events, spawn } = fixture(t)
  const started = spawn(); child.ready(); await started
  child.emit('close', null, 'SIGABRT')
  assert.deepEqual(events[0], { reason: 'unexpected-exit', exitCode: null, signal: 'SIGABRT', action: 'respawn-scheduled' })
  await web.close()
})

test('root exit is recorded before inherited pipes close, without changing recovery timing', async t => {
  const { web, child, events, spawn } = fixture(t)
  const started = spawn(); child.ready(); await started
  child.emit('exit', -1073740791, null)
  assert.deepEqual(events, [{ reason: 'unexpected-exit', exitCode: -1073740791, signal: null, action: 'awaiting-close' }])
  assert.equal(web.origin(), 'http://127.0.0.1:43123')
  child.emit('close', -1073740791, null)
  assert.deepEqual(events[1], { reason: 'unexpected-exit', exitCode: -1073740791, signal: null, action: 'respawn-scheduled' })
  await web.close()
})

test('spawn errors retain their terminal close code and reject startup', async t => {
  const { web, child, events, spawn } = fixture(t)
  const started = spawn()
  const rejected = assert.rejects(started, /spawn 官方 CLI 失败/)
  child.emit('error', new Error('synthetic spawn error'))
  child.emit('close', -2, null)
  await rejected
  assert.deepEqual(events, [{ reason: 'startup-failed', exitCode: -2, signal: null, action: 'startup-failed' }])
  await web.close()
})

test('diagnostic callback throws cannot interrupt readiness or confirmed shutdown', async t => {
  const { web, child, events, spawn } = fixture(t, () => { throw new Error('synthetic diagnostic failure') })
  const started = spawn(); child.ready(); assert.equal(await started, 'http://127.0.0.1:43123')
  await web.close()
  assert.deepEqual(events, [{ reason: 'clean-exit', exitCode: null, signal: 'SIGTERM', action: 'shutdown-confirmed' }])
})

test('diagnostic callback throws cannot interrupt unexpected-exit recovery scheduling', async t => {
  const { web, child, events, spawn } = fixture(t, () => { throw new Error('synthetic diagnostic failure') })
  const started = spawn(); child.ready(); await started
  child.emit('close', 7, null)
  assert.equal(events[0].action, 'respawn-scheduled')
  await web.close()
  assert.equal(events[1].action, 'respawn-abandoned')
})

test('rejected async diagnostic callbacks do not become unhandled rejections', async t => {
  const { web, child, events, spawn } = fixture(t, async () => { throw new Error('synthetic async diagnostic failure') })
  const started = spawn(); child.ready(); await started
  child.emit('close', 7, null)
  await flush()
  await web.close()
  await flush()
  assert.deepEqual(events.map(event => event.action), ['respawn-scheduled', 'respawn-abandoned'])
})
