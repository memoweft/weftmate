import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createPersonalMemoryManager } from '../src/personal-memory/index.mjs'

const methods = ['initialize', 'capabilities', 'health', 'shutdown', 'ingest_boundary',
  'preview_recall', 'query_interactions', 'query_world', 'query_evidence', 'query_provenance',
  'submit_command', 'query_command_receipt', 'retry_delete_storage_cleanup']
const ownerA = 'owner-00000000-0000-4000-8000-000000000001'
const ownerB = 'owner-00000000-0000-4000-8000-000000000002'

test('private owner command journal preserves exact Core command across concurrent retries and restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-memory-journal-'))
  const receipts = new Map<string, Map<string, any>>()
  const submissions: Array<{ ownerId: string, command: any }> = []
  let retryCalls = 0
  const rpcFactory = () => {
    const rpc: any = { child: {}, ownerId: '', closed: false,
      async request(method: string, params: any = {}) {
        if (method === 'capabilities') return { protocol: 'memoweft.dsh_rpc', protocol_version: 2,
          schema_version: 1, methods }
        if (method === 'initialize') {
          rpc.ownerId = params.subject_id
          return { runtime: { subject_id: params.subject_id,
            db_path: join(params.dsh_home, 'memoweft', 'memoweft.sqlite3') },
          capabilities: { subject_id: params.subject_id, services: { command: {
            operations: ['correct_world_item', 'delete_evidence'],
          } } } }
        }
        if (method === 'health') return { runtime: { subject_id: rpc.ownerId, route_ready: true } }
        if (method === 'query_world') return { world_revision: 3 }
        if (method === 'query_command_receipt') {
          const value = receipts.get(rpc.ownerId)?.get(params.command_id)
          if (!value) throw Object.assign(new Error('missing'), { code: 'command_receipt_not_found' })
          return { receipt: value }
        }
        if (method === 'retry_delete_storage_cleanup') {
          retryCalls++
          const receipt = receipts.get(rpc.ownerId)?.get(params.command_id)
          if (!receipt) throw Object.assign(new Error('missing'), { code: 'command_receipt_not_found' })
          receipt.storage_cleanup = { state: 'complete', detail_code: 'current_wal_truncated' }
          return { receipt }
        }
        if (method === 'submit_command') {
          const command = structuredClone(params.command)
          submissions.push({ ownerId: rpc.ownerId, command })
          const receipt = { command_id: command.command_id, result_state: 'applied', after_revision: 4,
            ...(command.operation === 'delete_world_item' ? {
              affected_ids: ['c-synthetic'],
              storage_cleanup: { state: 'pending', detail_code: 'checkpoint_pending' },
            } : {}) }
          if (!receipts.has(rpc.ownerId)) receipts.set(rpc.ownerId, new Map())
          receipts.get(rpc.ownerId)!.set(command.command_id, receipt)
          return { receipt }
        }
        return {}
      },
      async close() { rpc.closed = true; rpc.child = null },
    }
    return rpc
  }
  const create = () => createPersonalMemoryManager({ root, enabled: true,
    python: join(root, 'python.exe'), pythonPath: root,
    baseUrl: 'http://127.0.0.1:8081/v1', model: '@current',
    credential: () => 'synthetic key', rpcFactory })
  let manager = create()
  try {
    const proposal = { requestId: 'same-id', expectedWorldRevision: 3,
      operation: 'correct_world_item', targetKind: 'cognition', targetId: 'c-synthetic',
      payload: { correction_text: '合成修正' } }
    const [first, duplicate] = await Promise.all([
      manager.submitCommand(ownerA, proposal), manager.submitCommand(ownerA, proposal),
    ])
    assert.equal(first.receipt.command_id, duplicate.receipt.command_id)
    assert.equal(submissions.filter((item) => item.ownerId === ownerA).length, 1)
    await assert.rejects(manager.submitCommand(ownerA, { ...proposal,
      payload: { correction_text: '不同内容' } }),
    (error: { code: string }) => error.code === 'MEMORY_REQUEST_CONFLICT')
    const other = await manager.submitCommand(ownerB, { ...proposal, payload: { correction_text: 'B自己内容' } })
    assert.equal(other.receipt.result_state, 'applied')
    assert.equal(submissions.filter((item) => item.ownerId === ownerB).length, 1)
    const originalCommand = submissions.find((item) => item.ownerId === ownerA)!.command
    await manager.close()
    receipts.get(ownerA)!.delete(originalCommand.command_id) // Simulate a journaled pre-commit RPC loss.
    manager = create()
    const replay = await manager.submitCommand(ownerA, proposal)
    assert.equal(replay.receipt.command_id, originalCommand.command_id)
    const resubmitted = submissions.filter((item) => item.ownerId === ownerA)
    assert.equal(resubmitted.length, 2)
    assert.deepEqual(resubmitted[1].command, originalCommand,
      'timestamp and all Core-canonical fields must be byte-stable after restart')
    assert.equal((await manager.receiptByRequest(ownerA, proposal.requestId)).receipt.command_id,
      originalCommand.command_id)
    const deleted = await manager.submitCommand(ownerA, { requestId: 'delete-cognition',
      expectedWorldRevision: 4, operation: 'delete_world_item', targetKind: 'cognition',
      targetId: 'c-synthetic', payload: {} })
    assert.equal(deleted.receipt.storage_cleanup.state, 'pending')
    const completedCleanup = await manager.retryCleanupByRequest(ownerA, 'delete-cognition')
    assert.equal(completedCleanup.receipt.storage_cleanup.state, 'complete')
    assert.equal(retryCalls, 1)
    assert.equal((await manager.receiptByRequest(ownerA, 'delete-cognition')).receipt.storage_cleanup.state,
      'complete')
    await assert.rejects(manager.retryCleanupByRequest(ownerB, 'delete-cognition'),
      (error: { code: string }) => error.code === 'command_receipt_not_found')
    await assert.rejects(manager.retryCleanupByRequest(ownerA, 'same-id'),
      (error: { code: string }) => error.code === 'MEMORY_ACTION_UNSUPPORTED')
    const aJournal = readFileSync(join(root, 'accounts', ownerA, 'memory-home', 'command-journal.json'), 'utf8')
    const bJournal = readFileSync(join(root, 'accounts', ownerB, 'memory-home', 'command-journal.json'), 'utf8')
    assert.equal(aJournal.includes('合成修正'), false, 'deleted memory text must leave the host journal')
    assert.equal(bJournal.includes('B自己内容'), true, 'another account journal is untouched')
    assert.equal((await manager.receiptByRequest(ownerA, proposal.requestId)).receipt.command_id,
      originalCommand.command_id)
    receipts.get(ownerA)!.delete(originalCommand.command_id)
    await assert.rejects(manager.submitCommand(ownerA, proposal),
      (error: { code: string }) => error.code === 'MEMORY_REPLAY_REDACTED')
    assert.equal(submissions.filter((item) => item.ownerId === ownerA &&
      item.command.operation === 'correct_world_item').length, 2, 'redacted command is never re-executed')
  } finally { await manager.close(); rmSync(root, { recursive: true, force: true }) }
})
