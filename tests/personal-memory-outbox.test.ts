import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createPersonalMemoryManager } from '../src/personal-memory/index.mjs'

const owner = 'owner-00000000-0000-4000-8000-000000000001'
const methods = ['initialize', 'capabilities', 'health', 'shutdown', 'ingest_boundary',
  'preview_recall', 'query_interactions', 'query_world', 'query_evidence', 'query_provenance',
  'submit_command', 'query_command_receipt', 'retry_delete_storage_cleanup']

test('failed owner boundary remains visible and a Core conflict is not silently replayed after restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-memory-outbox-'))
  const attempts: string[] = []
  const rpcFactory = () => {
    const rpc: any = { child: {}, ownerId: '',
      async request(method: string, params: any = {}) {
        if (method === 'capabilities') return { protocol: 'memoweft.dsh_rpc', protocol_version: 2,
          schema_version: 1, methods }
        if (method === 'initialize') {
          rpc.ownerId = params.subject_id
          return { runtime: { subject_id: rpc.ownerId,
            db_path: join(params.dsh_home, 'memoweft', 'memoweft.sqlite3') },
          capabilities: { subject_id: rpc.ownerId, services: { command: { operations: [] } } } }
        }
        if (method === 'health') return { runtime: { subject_id: rpc.ownerId, route_ready: true } }
        if (method === 'query_world') return { world_revision: 0 }
        if (method === 'ingest_boundary') {
          attempts.push(params.boundary.event_id)
          // Core RPC currently maps both a hard-deleted origin and an ordinary evidence
          // conflict to internal_error, so the host must preserve and block this item.
          throw Object.assign(new Error('private source conflict'), { code: 'internal_error' })
        }
        throw new Error(`unexpected RPC ${method}`)
      },
      async close() { rpc.child = null },
    }
    return rpc
  }
  const create = () => createPersonalMemoryManager({ root, enabled: true,
    python: join(root, 'python.exe'), pythonPath: root,
    baseUrl: 'http://127.0.0.1:8081/v1', model: '@current',
    credential: () => 'synthetic', rpcFactory })
  let manager = create()
  const boundary = { event_id: 'weftmate-turn-boundary-v1:test', synthetic: true }
  try {
    assert.deepEqual(await manager.ingest(owner, boundary),
      { state: 'blocked', reasonCode: 'MEMORY_BOUNDARY_BLOCKED' })
    const first = await manager.status(owner)
    assert.equal(first.state, 'degraded')
    assert.equal(first.pendingBoundaryCount, 1)
    assert.equal(first.blockedBoundaryCount, 1)
    assert.equal(first.lastFailureCode, 'MEMORY_BOUNDARY_BLOCKED')
    assert.equal(first.capabilities.inject, false)
    assert.equal(manager.peek(owner), 'unknown')
    assert.equal((await manager.recall(owner, { query: 'test', sessionId: 'session-synthetic' })).state, 'withheld')
    assert.equal(attempts.length, 1)
    await manager.close()
    manager = create()
    const afterRestart = await manager.status(owner)
    assert.equal(afterRestart.state, 'degraded')
    assert.equal(afterRestart.pendingBoundaryCount, 1)
    assert.equal(afterRestart.blockedBoundaryCount, 1)
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.equal(attempts.length, 1, 'startup flush must not replay a blocked source')
    assert.deepEqual(await manager.ingest(owner, boundary),
      { state: 'blocked', reasonCode: 'MEMORY_BOUNDARY_BLOCKED' })
    assert.equal(attempts.length, 1)
    const disk = readFileSync(join(root, 'accounts', owner, 'memory-home', 'boundary-outbox.json'), 'utf8')
    assert.equal(JSON.parse(disk).items[0].blocked, true)
  } finally { await manager.close(); rmSync(root, { recursive: true, force: true }) }
})

test('only the explicit Core hard-deleted-source code drops the original boundary', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-memory-deleted-source-'))
  let attempts = 0
  const rpcFactory = () => {
    const rpc: any = { child: {}, ownerId: '',
      async request(method: string, params: any = {}) {
        if (method === 'capabilities') return { protocol: 'memoweft.dsh_rpc', protocol_version: 2,
          schema_version: 1, methods }
        if (method === 'initialize') {
          rpc.ownerId = params.subject_id
          return { runtime: { subject_id: rpc.ownerId,
            db_path: join(params.dsh_home, 'memoweft', 'memoweft.sqlite3') },
            capabilities: { subject_id: rpc.ownerId, services: { command: { operations: [] } } } }
        }
        if (method === 'health') return { runtime: { subject_id: rpc.ownerId, route_ready: true } }
        if (method === 'query_world') return { world_revision: 1 }
        if (method === 'ingest_boundary') {
          attempts++
          throw Object.assign(new Error('private original'), { code: 'hard_deleted_source' })
        }
        throw new Error(`unexpected RPC ${method}`)
      },
      async close() { rpc.child = null },
    }
    return rpc
  }
  const create = () => createPersonalMemoryManager({ root, enabled: true,
    python: join(root, 'python.exe'), pythonPath: root,
    baseUrl: 'http://127.0.0.1:8081/v1', model: '@current',
    credential: () => 'synthetic', rpcFactory })
  let manager = create()
  const boundary = { event_id: 'weftmate-turn-boundary-v1:deleted',
    source_messages: [{ role: 'user', content: '合成已删除的原文' }] }
  try {
    assert.deepEqual(await manager.ingest(owner, boundary),
      { state: 'discarded', reasonCode: 'MEMORY_SOURCE_DELETED' })
    const status = await manager.status(owner)
    assert.equal(status.state, 'ready')
    assert.equal(status.pendingBoundaryCount, 0)
    assert.equal(status.discardedBoundaryCount, 1)
    assert.equal(status.lastFailureCode, 'MEMORY_SOURCE_DELETED')
    const file = join(root, 'accounts', owner, 'memory-home', 'boundary-outbox.json')
    assert.equal(readFileSync(file, 'utf8').includes('合成已删除的原文'), false)
    await manager.close()
    manager = create()
    assert.equal((await manager.status(owner)).discardedBoundaryCount, 1)
    assert.equal(attempts, 1, 'deleted origin is not retried after restart')
  } finally { await manager.close(); rmSync(root, { recursive: true, force: true }) }
})
