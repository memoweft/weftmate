import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createPersonalMemoryManager } from '../src/personal-memory/index.mjs'

const owner = 'owner-00000000-0000-4000-8000-000000000001'
const methods = ['initialize', 'capabilities', 'health', 'shutdown', 'ingest_boundary',
  'preview_recall', 'query_interactions', 'query_world', 'query_evidence', 'query_provenance',
  'submit_command', 'query_command_receipt', 'retry_delete_storage_cleanup', 'query_jobs']
const signal = () => {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

for (const outcome of ['deliver', 'forget', 'close', 'failure']) {
  test(`a wake-up during an active memory drain handles ${outcome} without duplicate delivery`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const retry = signal(), setTimer = globalThis.setTimeout
    t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
      const timer = setTimer(callback, delay, ...args)
      if (delay === 1000) retry.resolve()
      return timer
    })
    const root = await mkdtemp(join(tmpdir(), 'personal-memory-wakeup-'))
    const started = signal(), release = signal(), attempts: string[] = []
    let paused = false, failed = false
    const manager = createPersonalMemoryManager({ root, enabled: true,
      python: join(root, 'python.exe'), pythonPath: root,
      baseUrl: 'http://127.0.0.1:54321/v1', model: '@current', credential: () => 'synthetic',
      rpcFactory: () => ({ child: {}, async close() {}, async request(method, params = {}) {
        if (method === 'capabilities') return { protocol: 'memoweft.dsh_rpc', protocol_version: 2, schema_version: 1, methods }
        if (method === 'initialize') return {
          runtime: { subject_id: owner, db_path: join(params.dsh_home, 'memoweft', 'memoweft.sqlite3') },
          capabilities: { subject_id: owner, methods, services: { command: { operations: [] } } },
        }
        if (method === 'health') return { runtime: { subject_id: owner, route_ready: true } }
        if (method === 'query_world') return { world_revision: 1 }
        if (method === 'query_jobs') {
          if (!paused) { paused = true; started.resolve(); await release.promise }
          return { jobs: [] }
        }
        if (method === 'ingest_boundary') {
          const id = params.boundary.event_id
          attempts.push(id)
          if (outcome === 'failure' && id === 'new-turn' && !failed) {
            failed = true; throw Object.assign(Error('synthetic busy'), { code: 'MEMORY_BUSY' })
          }
          return { job_state: 'pending' }
        }
        throw Error(`Unexpected RPC ${method}`)
      } }),
    })
    const until = async (check: () => Promise<boolean>) => {
      const deadline = Date.now() + 2000
      while (Date.now() < deadline) if (await check()) return
      assert.fail('scheduled boundary delivery did not settle')
    }
    try {
      const initial = manager.ingest(owner, { event_id: 'first-turn' })
      await started.promise
      assert.equal((await manager.ingest(owner, { event_id: 'new-turn',
        source_messages: [{ role: 'user', content: 'synthetic new source' }] }, { defer: true })).state, 'queued')
      t.mock.timers.tick(0) // Consume the wake-up while the first drain is held.
      const finishing = outcome === 'close' ? manager.close()
        : outcome === 'forget' ? manager.discardPendingSources(owner, { sourceTexts: ['synthetic new source'] }) : null
      release.resolve(); await initial; await finishing
      t.mock.timers.tick(0)
      if (outcome === 'close') {
        t.mock.timers.tick(60_000)
        assert.equal((await manager.pendingStatus(owner)).pendingBoundaryCount, 1, 'shutdown leaves the new source durable for restart')
        assert.deepEqual(attempts, ['first-turn'])
      } else if (outcome === 'forget') {
        t.mock.timers.tick(60_000)
        await manager.close()
        assert.equal((await manager.pendingStatus(owner)).pendingBoundaryCount, 0)
        assert.deepEqual(attempts, ['first-turn'], 'forgetting wins before the retained wake-up can deliver its source')
      } else {
        if (outcome === 'failure') {
          await retry.promise
          await manager.flushPending(owner) // Join the failed attempt before advancing its backoff clock.
          t.mock.timers.tick(999)
          assert.deepEqual(attempts, ['first-turn', 'new-turn'], 'a transient error retains the existing retry delay')
          t.mock.timers.tick(1)
        }
        await until(async () => {
          t.mock.timers.tick(0) // A retry that fired during the failed drain must run after it settles.
          return (await manager.pendingStatus(owner)).pendingBoundaryCount === 0
        })
        t.mock.timers.tick(60_000)
        await manager.close()
        assert.deepEqual(attempts, outcome === 'failure' ? ['first-turn', 'new-turn', 'new-turn'] : ['first-turn', 'new-turn'])
      }
    } finally {
      release.resolve()
      await manager.close()
      await rm(root, { recursive: true, force: true })
    }
  })
}
