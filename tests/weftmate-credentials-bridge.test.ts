/** WeftMate safeStorage credential provider：真实 Node IPC 往返而非 HTTP 或环境变量。 */
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { after, before, test } from 'node:test'

let root: string

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'weftmate-credentials-bridge-'))
})

after(async () => {
  await rm(root, { recursive: true, force: true })
})

const fakeCredentialsPackage = `
export class CredentialProvider {
  constructor(ctx) { this.ctx = ctx }
  notifyUpdated(ref) { this.ctx.updated.push(ref) }
  notifyRecordUpdated(key) { this.ctx.recordUpdates.push(key) }
}
`

const runnerSource = `
const plugin = await import(process.env.WEFTMATE_TEST_PLUGIN_URL)
let holdNextCredentialReply = false
const ctx = {
  updated: [],
  recordUpdates: [],
  effects: [],
  plugin(Provider) { this.provider = new Provider(this); return this.provider },
  // Cordis effect contract: setup returns a disposer that Fiber disposal runs.
  // This deliberately exercises a real cleanup path instead of a no-op stub.
  effect(setup) { const dispose = setup(); if (typeof dispose === 'function') this.effects.push(dispose) },
}
plugin.apply(ctx)
process.on('message', async (message) => {
  if (message?.kind === 'hold-next') {
    holdNextCredentialReply = true
    process.send?.({ kind: 'held' })
    return
  }
  if (message?.kind === 'run') {
    try {
      const result = await ctx.provider[message.operation](message.ref, message.value)
      process.send?.({ kind: 'result', id: message.id, ok: true, result, updated: ctx.updated })
    } catch (error) {
      process.send?.({ kind: 'result', id: message.id, ok: false, error: String(error?.message ?? error), updated: ctx.updated })
    }
  }
  if (message?.kind === 'record-create') {
    try {
      const result = await ctx.provider.modifyRecord(message.key, async () => message.record)
      process.send?.({ kind: 'record-result', id: message.id, ok: true, result, records: await ctx.provider.listRecords(), updates: ctx.recordUpdates })
    } catch (error) {
      process.send?.({ kind: 'record-result', id: message.id, ok: false, error: String(error?.message ?? error) })
    }
  }
  if (message?.kind === 'dispose') {
    await Promise.all(ctx.effects.splice(0).map((dispose) => dispose()))
    process.send?.({ kind: 'disposed', messageListeners: process.listenerCount('message') })
  }
  if (message?.kind === 'exit') process.exit(0)
})
process.send?.({ kind: 'ready' })
`

interface Runner {
  child: ChildProcess
  run: (operation: 'resolve' | 'describe' | 'set' | 'unset', ref: string, value?: string) => Promise<Record<string, unknown>>
  dispose: () => Promise<Record<string, unknown>>
  holdNext: () => Promise<void>
  close: () => Promise<void>
  createRecord: (key: string, record: Record<string, unknown>) => Promise<Record<string, unknown>>
  seen: Array<Record<string, unknown>>
}

async function startRunner(): Promise<Runner> {
  const fixture = join(root, `fixture-${Math.random().toString(16).slice(2)}`)
  const pluginDir = join(fixture, 'plugins')
  const moduleDir = join(pluginDir, 'node_modules', '@deepseek-ai', 'dsh-credentials')
  await mkdir(moduleDir, { recursive: true })
  await copyFile(join(process.cwd(), 'src', 'plugins', 'weftmate-credentials.mjs'), join(pluginDir, 'weftmate-credentials.mjs'))
  await writeFile(join(moduleDir, 'package.json'), JSON.stringify({ type: 'module', exports: './index.mjs' }), 'utf8')
  await writeFile(join(moduleDir, 'index.mjs'), fakeCredentialsPackage, 'utf8')
  const runner = join(fixture, 'runner.mjs')
  await writeFile(runner, runnerSource, 'utf8')
  const child = spawn(process.execPath, [runner], {
    env: { ...process.env, WEFTMATE_TEST_PLUGIN_URL: pathToFileURL(join(pluginDir, 'weftmate-credentials.mjs')).href },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true,
  })
  const seen: Array<Record<string, unknown>> = []
  let next = 1
  let holdNextReply = false
  const waiters = new Map<string, { resolve: (value: Record<string, unknown>) => void, reject: (error: Error) => void }>()
  let disposeResolve: ((value: Record<string, unknown>) => void) | undefined
  let heldResolve: (() => void) | undefined
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('credentials runner did not become ready')), 3_000)
    child.on('message', (message: unknown) => {
      if (message !== null && typeof message === 'object' && !Array.isArray(message)) {
        const raw = message as Record<string, unknown>
        if (raw.kind === 'ready') { clearTimeout(timer); resolve(); return }
        if (raw.protocol === 'weftmate.credentials.v1') {
          seen.push(raw)
          if (holdNextReply) { holdNextReply = false; return }
          const operation = raw.operation
          const response = operation === 'resolve'
            ? { value: 'test-only-main-secret', source: 'safe-storage' }
            : operation === 'describe'
              ? { configured: true, source: 'safe-storage', writable: true, value: 'must-not-reach-describe' }
              : { changed: true }
          child.send?.({ protocol: 'weftmate.credentials.v1', id: raw.id, ok: true, result: response })
          return
        }
        if (raw.kind === 'result' && typeof raw.id === 'string') {
          const waiter = waiters.get(raw.id)
          if (waiter !== undefined) { waiters.delete(raw.id); waiter.resolve(raw) }
          return
        }
        if (raw.kind === 'record-result' && typeof raw.id === 'string') {
          const waiter = waiters.get(raw.id)
          if (waiter !== undefined) { waiters.delete(raw.id); waiter.resolve(raw) }
          return
        }
        if (raw.kind === 'disposed') disposeResolve?.(raw)
        if (raw.kind === 'held') { holdNextReply = true; heldResolve?.() }
      }
    })
    child.once('error', reject)
  })
  await ready
  return {
    child,
    seen,
    run(operation, ref, value) {
      const id = `op-${next++}`
      return new Promise((resolve, reject) => {
        waiters.set(id, { resolve, reject })
        child.send?.({ kind: 'run', id, operation, ref, ...(value === undefined ? {} : { value }) })
      })
    },
    dispose() {
      return new Promise((resolve) => { disposeResolve = resolve; child.send?.({ kind: 'dispose' }) })
    },
    holdNext() {
      return new Promise((resolve) => { heldResolve = resolve; child.send?.({ kind: 'hold-next' }) })
    },
    close() {
      return new Promise((resolve) => {
        child.once('close', () => resolve())
        child.send?.({ kind: 'exit' })
      })
    },
    createRecord(key, record) {
      const id = `record-${next++}`
      return new Promise((resolve, reject) => {
        waiters.set(id, { resolve, reject })
        child.send?.({ kind: 'record-create', id, key, record })
      })
    },
  }
}

test('official CredentialProvider 通过 IPC resolve/describe/set/unset，describe 永不回传 secret', async () => {
  const runner = await startRunner()
  try {
    const resolved = await runner.run('resolve', 'WEFTMATE_TEST_KEY')
    assert.equal(resolved.ok, true)
    assert.deepEqual(resolved.result, { value: 'test-only-main-secret', source: 'safe-storage' })

    const described = await runner.run('describe', 'WEFTMATE_TEST_KEY')
    assert.equal(described.ok, true)
    assert.deepEqual(described.result, { configured: true, source: 'safe-storage', writable: true })

    const stored = await runner.run('set', 'WEFTMATE_TEST_KEY', 'test-only-write-secret')
    assert.equal(stored.ok, true)
    assert.deepEqual(stored.updated, ['WEFTMATE_TEST_KEY'])
    const removed = await runner.run('unset', 'WEFTMATE_TEST_KEY')
    assert.equal(removed.ok, true)
    assert.deepEqual(removed.updated, ['WEFTMATE_TEST_KEY', 'WEFTMATE_TEST_KEY'])
    assert.deepEqual(runner.seen.map(({ operation, ref, value }) => ({ operation, ref, value })), [
      { operation: 'resolve', ref: 'WEFTMATE_TEST_KEY', value: undefined },
      { operation: 'describe', ref: 'WEFTMATE_TEST_KEY', value: undefined },
      { operation: 'set', ref: 'WEFTMATE_TEST_KEY', value: 'test-only-write-secret' },
      { operation: 'unset', ref: 'WEFTMATE_TEST_KEY', value: undefined },
    ])
    await runner.holdNext()
    const pending = runner.run('resolve', 'WEFTMATE_TEST_PENDING')
    const disposed = await runner.dispose()
    assert.equal(disposed.messageListeners, 1, 'effect disposer removes the credential bridge IPC listener while the runner listener remains')
    const pendingResult = await pending
    assert.equal(pendingResult.ok, false)
    assert.match(String(pendingResult.error), /weftmate-credentials: closed/, 'effect dispose rejects an outstanding IPC request')
    const afterDispose = await runner.run('resolve', 'WEFTMATE_TEST_KEY')
    assert.equal(afterDispose.ok, false)
    assert.match(String(afterDispose.error), /weftmate-credentials: closed/)
  } finally {
    await runner.close()
  }
})

test('V4 browser records are process-local and do not use the ref IPC protocol', async () => {
  const runner = await startRunner()
  try {
    const created = await runner.createRecord('connection/browser-auth', { kind: 'grant', token: 'browser-only' })
    assert.equal(created.ok, true)
    assert.deepEqual(created.records, [{ key: 'connection/browser-auth', kind: 'grant' }])
    assert.deepEqual(created.updates, ['connection/browser-auth'])
    assert.equal(runner.seen.length, 0, 'record creation stays inside the candidate provider and never sends a value over the reference IPC')
  } finally {
    await runner.close()
  }
})
