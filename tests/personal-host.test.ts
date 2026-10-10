import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { assertLoopbackOrigin, hostRuntimeState, observeHostChild, personalHostRequested, personalWorkspaceDirectory, startPersonalHost,
  validatePersonalHostProfile, PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../src/host-mode.mjs'

const repository = fileURLToPath(new URL('../', import.meta.url))
const launcher = join(repository, 'scripts', 'run-personal-host.mjs')
const require = createRequire(import.meta.url)

test('personal host starts the shared runtime, migrates it, and reports readiness only after binding scan', async () => {
  const events: string[] = []
  const origin = await startPersonalHost({
    startRuntime: async () => { events.push('runtime'); return 'http://127.0.0.1:51931' },
    migrateRoutes: async (current: string) => { assert.equal(current, 'http://127.0.0.1:51931'); events.push('migration'); return 'http://127.0.0.1:51932' },
    hydrateBindings: async () => { events.push('bindings') },
    log: (message: string) => { assert.match(message, /origin=http:\/\/127\.0\.0\.1:51932/); events.push('ready') },
  })
  assert.equal(origin, 'http://127.0.0.1:51932')
  assert.deepEqual(events, ['runtime', 'migration', 'bindings', 'ready'])
})

test('personal host never reports ready after runtime or binding failure', async () => {
  for (const failedStep of ['runtime', 'bindings']) {
    let ready = false
    await assert.rejects(startPersonalHost({
      startRuntime: async () => { if (failedStep === 'runtime') throw new Error('startup failed'); return 'http://127.0.0.1:51931' },
      migrateRoutes: async (origin: string) => origin,
      hydrateBindings: async () => { if (failedStep === 'bindings') throw new Error('scan failed') },
      log: () => { ready = true },
    }))
    assert.equal(ready, false)
  }
})

test('personal host waits for the ready diagnostic snapshot to commit', async () => {
  let release!: () => void
  const committed = new Promise<void>(resolve => { release = resolve })
  let completed = false
  const startup = startPersonalHost({
    startRuntime: async () => 'http://127.0.0.1:51931',
    migrateRoutes: async (origin: string) => origin,
    hydrateBindings: async () => {},
    log: async () => { await committed },
  }).then(() => { completed = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(completed, false, 'a pending snapshot must not publish completed startup')
  release()
  await startup
  assert.equal(completed, true)
})

test('personal host accepts only an exact dynamic loopback origin', () => {
  assert.equal(assertLoopbackOrigin('http://127.0.0.1:51931'), 'http://127.0.0.1:51931')
  for (const value of ['http://localhost:51931', 'http://0.0.0.0:51931', 'https://127.0.0.1:51931',
    'http://127.0.0.1:51931/path', 'http://key@127.0.0.1:51931', 'http://127.0.0.1']) {
    assert.throws(() => assertLoopbackOrigin(value))
  }
  assert.equal(personalHostRequested(['electron', '.', '--personal-host']), true)
  assert.equal(personalHostRequested(['electron', '.']), false)
})

test('launcher refuses any existing unmarked profile and main validation uses the same marker', () => {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-host-test-'))
  try {
    const unmarked = spawnSync(process.execPath, [launcher, '--user-data-dir', root, '--dry-run'], { encoding: 'utf8' })
    assert.equal(unmarked.status, 2)
    assert.match(unmarked.stderr, /refusing profile/)
    assert.throws(() => validatePersonalHostProfile(root))
    const fresh = join(root, 'fresh')
    const dry = spawnSync(process.execPath, [launcher, '--user-data-dir', fresh, '--dry-run'], { encoding: 'utf8' })
    assert.equal(dry.status, 0, dry.stderr)
    assert.throws(() => validatePersonalHostProfile(fresh))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('personal host accepts an existing explicit workspace while keeping the profile default', () => {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-host-workspace-test-'))
  try {
    const profile = join(root, 'profile')
    const workspace = join(root, 'selected-workspace')
    mkdirSync(workspace)
    assert.equal(personalWorkspaceDirectory([], true, profile), join(profile, 'workspace'))
    assert.equal(personalWorkspaceDirectory([`--workspace-dir=${workspace}`], true, profile), workspace)
    assert.throws(() => personalWorkspaceDirectory([`--workspace-dir=${workspace}`], false, profile))
    assert.throws(() => personalWorkspaceDirectory([`--workspace-dir=${join(root, 'missing')}`], true, profile))
    const explicit = spawnSync(process.execPath, [launcher, '--user-data-dir', profile,
      '--workspace-dir', workspace, '--dry-run'], { encoding: 'utf8' })
    assert.equal(explicit.status, 0, explicit.stderr)
    assert.ok(explicit.stdout.includes(`workspace=${workspace}`))
    const defaulted = spawnSync(process.execPath, [launcher, '--user-data-dir', profile, '--dry-run'], { encoding: 'utf8' })
    assert.equal(defaulted.status, 0, defaulted.stderr)
    assert.ok(defaulted.stdout.includes(`workspace=${join(profile, 'workspace')}`))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('direct Electron personal-host entry refuses an unmarked synthetic profile before bootstrap', () => {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-host-direct-'))
  try {
    writeFileSync(join(root, 'private-data'), 'untouched')
    const env = { ...process.env, WEFTMATE_USER_DATA: root }
    delete env.ELECTRON_RUN_AS_NODE
    const result = spawnSync(require('electron'), ['.', `--user-data-dir=${root}`, '--personal-host'], {
      cwd: repository, env, encoding: 'utf8', timeout: 15_000,
    })
    assert.equal(result.status, 2, result.stderr)
    assert.match(result.stderr, /personal-host refused/)
    assert.equal(readFileSync(join(root, 'private-data'), 'utf8'), 'untouched')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('personal-host refuses unscoped MemoWeft config without exposing its auth ref', () => {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-host-memory-'))
  try {
    const pythonPath = join(root, 'py')
    mkdirSync(join(pythonPath, 'memoweft', 'integrations', 'dsh_bridge'), { recursive: true })
    writeFileSync(join(root, 'python.exe'), '')
    writeFileSync(join(pythonPath, 'memoweft', 'integrations', 'dsh_bridge', '__main__.py'), '')
    const config = join(root, 'memory.json')
    writeFileSync(config, JSON.stringify({ python: 'python.exe', pythonPath: 'py', baseUrl: 'http://127.0.0.1:19999/v1',
      model: 'synthetic-model', authRef: 'SYNTHETIC_AUTH_REF' }))
    const result = spawnSync(process.execPath, [launcher, '--user-data-dir', join(root, 'fresh'), '--memoweft-config', config, '--dry-run'], { encoding: 'utf8' })
    assert.equal(result.status, 2)
    assert.match(result.stderr, /account-scoped memory is not connected/)
    assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC_AUTH_REF|synthetic-model/)
    const disabled = spawnSync(process.execPath, [launcher, '--user-data-dir', join(root, 'fresh'), '--dry-run'], { encoding: 'utf8' })
    assert.match(disabled.stdout, /memoweft=disabled/)
    const main = readFileSync(join(repository, 'src', 'main.mjs'), 'utf8')
    assert.match(main, /personalHostMode && process\.env\.WEFTMATE_MEMOWEFT_ENABLED === '1'/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('direct personal-host entry refuses the global memory switch before starting DSH', () => {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-host-memory-guard-'))
  try {
    writeFileSync(join(root, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT))
    const env = { ...process.env, WEFTMATE_USER_DATA: root, WEFTMATE_MEMOWEFT_ENABLED: '1' }
    delete env.ELECTRON_RUN_AS_NODE
    const result = spawnSync(require('electron'), ['.', `--user-data-dir=${root}`, '--personal-host'], {
      cwd: repository, env, encoding: 'utf8', timeout: 15_000,
    })
    assert.equal(result.status, 2, result.stderr)
    assert.match(result.stderr, /account-scoped memory is not connected/)
    assert.doesNotMatch(result.stdout + result.stderr, /dsh web:|personal-access listening/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('host mode disables browser auto-open and writes stopped state without a stale origin', () => {
  const main = readFileSync(join(repository, 'src', 'main.mjs'), 'utf8')
  assert.match(main, /noOpen: personalHostMode/)
  assert.match(main, /hostLifecycleState = 'stopping'/)
  assert.match(main, /hostLifecycleState = 'stopped'/)
  assert.deepEqual(hostRuntimeState('starting', 'http://127.0.0.1:51234'), { state: 'listening', origin: 'http://127.0.0.1:51234' })
  assert.deepEqual(hostRuntimeState('stopping', 'http://127.0.0.1:51234'), { state: 'stopping', origin: null })
  assert.deepEqual(hostRuntimeState('stopped', 'http://127.0.0.1:51234'), { state: 'stopped', origin: null })
})

test('spawn error pauses terminal input and finalizes only once even if close follows', () => {
  const child = new EventEmitter()
  let pauses = 0
  const results: unknown[] = []
  observeHostChild(child, { pause: () => { pauses += 1 } }, (value: unknown) => results.push(value))
  child.emit('error', new Error('synthetic spawn failure'))
  child.emit('close', null, null)
  assert.equal(pauses, 1)
  assert.equal(results.length, 1)
  assert.match(String((results[0] as { error: Error }).error.message), /synthetic spawn failure/)
})
