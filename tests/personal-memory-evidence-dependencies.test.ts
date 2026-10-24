import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPersonalMemoryManager } from '../src/personal-memory/index.mjs';
import { handlePersonalMemoryTool } from '../src/personal-access/memory-runtime.mjs';
import { offlineBoundary } from '../src/personal-offline/snapshot.mjs';
import { importBoundary } from '../src/personal-access/history-import.mjs';

test('host retains E2 recall evidence, saves its dependency and returns the exact source to Core for forgetting', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-e2-dependencies-'));
  const owner = 'owner-00000000-0000-4000-8000-000000000001';
  const pairs = [['cognition', 'tea'], ['evidence', 'tea-source']];
  const rendered = '本人档案（当前；保留原话归属）：\n用户喜欢茶。\n记忆：用户喜欢茉莉花茶。\n用户原话 [2026-10-24]: 我喜欢茉莉花茶。';
  const calls: any[] = [];
  const methods = ['initialize', 'capabilities', 'health', 'shutdown', 'ingest_boundary', 'preview_recall',
    'query_interactions', 'query_world', 'query_evidence', 'query_provenance', 'submit_command',
    'query_command_receipt', 'retry_delete_storage_cleanup'];
  let accept = false;
  const rpcFactory = () => ({ child: {}, async close() {}, async request(method: string, params: any = {}) {
    calls.push({ method, params });
    if (method === 'capabilities') return { protocol: 'memoweft.dsh_rpc', protocol_version: 2, schema_version: 1, methods };
    if (method === 'initialize') return { runtime: { subject_id: owner, db_path: join(params.dsh_home, 'memoweft', 'memoweft.sqlite3') },
      capabilities: { subject_id: owner, methods, services: { command: { operations: ['delete_evidence'] } } } };
    if (method === 'health') return { runtime: { subject_id: owner, route_ready: true } };
    if (method === 'query_world') return { world_revision: 7 };
    if (method === 'preview_recall') return { world_revision: 7, preview: { count: 2, selected_item_ids: pairs, rendered_recall: rendered } };
    if (method === 'query_interactions') return { rendered_context: '' };
    if (method === 'ingest_boundary') {
      if (!accept) throw Object.assign(Error('synthetic transport unavailable'), { code: 'MEMORY_TIMEOUT' });
      return { state: 'accepted' };
    }
    throw Error(`Unexpected method ${method}`);
  } });
  const create = () => createPersonalMemoryManager({ root, enabled: true, python: join(root, 'python.exe'),
    pythonPath: root, baseUrl: 'http://127.0.0.1:1/v1', model: '@current', credential: () => 'synthetic', rpcFactory });
  let manager = create();
  try {
    const recalled = await manager.recall(owner, { query: '我喜欢什么茶？', sessionId: 'synthetic', modelTier: 'local' });
    assert.equal(recalled.contextText, rendered, 'profile, formal recall and original quote remain intact');
    assert.deepEqual(recalled.memories.map(({ kind, id }) => [kind, id]), pairs);
    assert.equal(recalled.sourceCount, pairs.length);
    const turn = { id: 'turn-one', conversationId: 'synthetic', timestamp: Date.now(), dependencyComplete: true,
      memoryRefs: recalled.memories.map(({ kind, id }) => ({ kind, id })), messages: [
        { role: 'user', text: '我喜欢什么茶？' }, { role: 'assistant', text: '你喜欢茉莉花茶。' }] };
    const boundary = offlineBoundary('synthetic-device', turn);
    const dependencies = boundary.source_messages[1].model_context_dependencies;
    assert.deepEqual(dependencies.world_items, pairs.map(([object_kind, item_id]) => ({ object_kind, item_id })));
    const imported = importBoundary({ app: 'phone', id: 'synthetic', turnId: turn.id, at: new Date(turn.timestamp).toISOString(),
      dependencyComplete: true, memoryRefs: turn.memoryRefs, messages: turn.messages.map(m => ({ role: m.role, content: m.text })) },
      { id: 'synthetic-job', routeId: 'import-synthetic' }, '', 0);
    assert.deepEqual(imported.source_messages[1].model_context_dependencies, dependencies);
    await manager.ingest(owner, boundary, { offline: true });
    await manager.close();
    const stored = await readFile(join(root, 'accounts', owner, 'memory-home', 'boundary-outbox.json'), 'utf8');
    assert.ok(stored.includes('tea-source'), 'source reference is durable before Core accepts the boundary');
    accept = true; manager = create();
    await manager.flushPending(owner);
    assert.deepEqual(calls.filter(c => c.method === 'ingest_boundary').at(-1).params.boundary.source_messages[1].model_context_dependencies, dependencies);
    let proposal: any;
    await handlePersonalMemoryTool({
      status: async () => ({ state: 'ready', capabilities: { deleteEvidence: true } }),
      query: async () => ({ evidence: { evidence_id: 'tea-source' } }),
      checkForgetCompletion: async () => ({ state: 'complete', worldRevision: 7 }),
      submitCommand: async (_owner, value) => { proposal = value;
        return { receipt: { result_state: 'applied', after_revision: 8, command_id: 'synthetic-command' } }; },
    }, owner,
      { name: 'memory_forget', arguments: { kind: 'evidence', id: 'tea-source', expectedWorldRevision: 7 }, requestId: 'synthetic-forget' },
      { sessionId: 'synthetic', modelTier: 'local', memoryPolicy: { recall: true } });
    assert.equal(proposal.operation, 'delete_evidence');
    assert.equal(proposal.targetKind, 'evidence');
    assert.equal(proposal.targetId, 'tea-source');
  } finally { await manager.close(); await rm(root, { recursive: true, force: true }); }
});
