/** Explicit real MemoWeft RPC v2, two private owner roots, with no model requests. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { createPersonalMemoryManager } from '../../src/personal-memory/index.mjs';
import { MemoWeftRpc } from '../../src/personal-memory/rpc.mjs';
import { boundaryForCompletedTurn } from '../../src/plugins/weftmate-personal-memory.mjs';

if (process.platform !== 'win32' || process.env.WEFTMATE_REAL_MEMORY_CORE_E2E !== '1') {
  throw new Error('Set WEFTMATE_REAL_MEMORY_CORE_E2E=1 for this isolated, model-free Core RPC test.');
}
const python = 'D:/AIProjects/MemoWeft/Core/py/.venv/Scripts/python.exe';
const pythonPath = 'D:/AIProjects/MemoWeft/Core/py/src';
if (!existsSync(python) || !existsSync(join(pythonPath, 'memoweft', 'integrations', 'dsh_bridge', '__main__.py'))) {
  throw new Error('MemoWeft Core Python runtime is unavailable');
}
const root = mkdtempSync(join(tmpdir(), 'weftmate-memory-core-'));
assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
const ownerA = 'owner-00000000-0000-4000-8000-000000000001';
const ownerB = 'owner-00000000-0000-4000-8000-000000000002';
const active = [];
const create = () => createPersonalMemoryManager({ root, enabled: true, python, pythonPath,
  baseUrl: 'http://127.0.0.1:8081/v1', model: '@current', credential: () => null,
  rpcFactory: (options) => { const rpc = new MemoWeftRpc(options); active.push(rpc); return rpc; } });
const events = [
  { seq: 1, type: 'turn/start', data: { turn: 1 } },
  { seq: 2, type: 'user/message', data: { id: 'synthetic-user-message', source: { kind: 'user' },
    content: [{ type: 'text', text: '合成A账户偏好独立记忆' }] } },
  { seq: 3, type: 'assistant/message', data: { message: { id: 'synthetic-assistant-message',
    content: [{ type: 'text', text: '收到合成偏好' }] } } },
  { seq: 4, type: 'turn/end', data: { turn: 1, reason: { kind: 'stop' } } },
];
const boundary = boundaryForCompletedTurn({ id: 'session-synthetic-shared-name',
  header: { agentPreset: 'personal-remote' }, events }, events.at(-1));
assert.ok(boundary);
let manager = create();
try {
  const [a, b] = await Promise.all([manager.status(ownerA), manager.status(ownerB)]);
  assert.equal(a.state, 'degraded');
  assert.equal(b.state, 'degraded');
  assert.equal(a.capabilities.list, true);
  assert.equal(a.capabilities.inject, false);
  assert.equal(active.length, 2, 'owners have distinct RPC instances');
  assert.notEqual(active[0].child?.pid, active[1].child?.pid, 'owners have distinct Python processes');
  const dbA = join(root, 'accounts', ownerA, 'memory-home', 'memoweft', 'memoweft.sqlite3');
  const dbB = join(root, 'accounts', ownerB, 'memory-home', 'memoweft', 'memoweft.sqlite3');
  assert.equal(existsSync(dbA), true);
  assert.equal(existsSync(dbB), true);
  const accepted = await manager.ingest(ownerA, boundary);
  assert.equal(accepted.state, 'accepted');
  const evidenceA = await manager.query(ownerA, 'query_evidence', { operation: 'list' });
  const evidenceB = await manager.query(ownerB, 'query_evidence', { operation: 'list' });
  assert.equal(evidenceA.evidence.some((item) => item.raw_content?.includes('合成A账户偏好独立记忆')), true);
  assert.equal(evidenceB.evidence.length, 0);
  const sourceId = evidenceA.evidence.find((item) => item.raw_content?.includes('合成A账户偏好独立记忆'))?.evidence_id;
  assert.equal(typeof sourceId, 'string');
  const seed = `import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.execute("INSERT INTO cognition(id, subject_id, content, content_type, formed_by, confidence, cred_status, scope, valid_at, invalid_at, asked_at, archived_at, muted_at, created_at, updated_at) VALUES (?, ?, ?, 'preference', 'stated', 80, 'credible', NULL, NULL, NULL, NULL, NULL, NULL, '2026-09-27T00:00:00Z', '2026-09-27T00:00:00Z')", ('cognition-synthetic-a', sys.argv[2], '合成A账户偏好独立记忆',))
db.execute("INSERT INTO cognition_evidence(cognition_id,evidence_id,relation) VALUES (?,?, 'support')", ('cognition-synthetic-a', sys.argv[3]))
db.commit()
db.close()`;
  execFileSync(python, ['-c', seed, dbA, ownerA, sourceId], { windowsHide: true,
    env: { ...process.env, PYTHONPATH: pythonPath }, timeout: 10_000 });
  const recallA = await manager.query(ownerA, 'preview_recall', { query: '合成A账户偏好独立记忆' });
  const recallB = await manager.query(ownerB, 'preview_recall', { query: '合成A账户偏好独立记忆' });
  assert.match(recallA.preview.rendered_recall, /合成A账户偏好独立记忆/);
  assert.equal(recallB.preview.rendered_recall, '');
  const oldA = active[0].child;
  const oldB = active[1].child;
  const crashed = once(oldA, 'close');
  oldA.kill();
  await crashed;
  assert.equal((await manager.status(ownerA)).state, 'degraded');
  assert.notEqual(active.at(-1).child?.pid, oldA.pid, 'A restarts only its own process');
  assert.equal(active[1].child?.pid, oldB.pid, 'B process is unaffected by A crash');
  const afterCrash = await manager.query(ownerA, 'preview_recall', { query: '合成A账户偏好独立记忆' });
  assert.match(afterCrash.preview.rendered_recall, /合成A账户偏好独立记忆/);
  await manager.close();
  assert.equal(active.every((rpc) => rpc.child === null), true);
  manager = create();
  const restoredA = await manager.query(ownerA, 'query_evidence', { operation: 'list' });
  const restoredB = await manager.query(ownerB, 'query_evidence', { operation: 'list' });
  assert.equal(restoredA.evidence.some((item) => item.raw_content?.includes('合成A账户偏好独立记忆')), true);
  assert.equal(restoredB.evidence.length, 0);
  const revision = (await manager.query(ownerA, 'query_world', { operation: 'revision' })).world_revision;
  const deletion = { requestId: 'synthetic-world-delete', expectedWorldRevision: revision,
    operation: 'delete_world_item', targetKind: 'cognition', targetId: 'cognition-synthetic-a', payload: {} };
  const deleted = await manager.submitCommand(ownerA, deletion);
  assert.equal(deleted.receipt.result_state, 'applied');
  assert.ok(['complete', 'pending'].includes(deleted.receipt.storage_cleanup?.state));
  assert.equal((await manager.receiptByRequest(ownerA, deletion.requestId)).receipt.command_id,
    deleted.receipt.command_id);
  assert.equal((await manager.submitCommand(ownerA, deletion)).receipt.command_id, deleted.receipt.command_id);
  assert.equal((await manager.query(ownerA, 'preview_recall',
    { query: '合成A账户偏好独立记忆' })).preview.rendered_recall, '');
  const oldSource = await manager.ingest(ownerA, boundary);
  assert.deepEqual(oldSource, { state: 'discarded', reasonCode: 'MEMORY_SOURCE_DELETED' });
  const outbox = await manager.status(ownerA);
  assert.equal(outbox.pendingBoundaryCount, 0);
  assert.equal(outbox.discardedBoundaryCount, 1);
  assert.equal(outbox.lastFailureCode, 'MEMORY_SOURCE_DELETED');
  console.log('[personal-memory-core] A/B isolation, crash/restart, true-delete and hard-deleted-source outbox cleanup; no model calls');
} finally {
  await manager.close().catch(() => {});
  assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
  rmSync(root, { recursive: true, force: true });
}
