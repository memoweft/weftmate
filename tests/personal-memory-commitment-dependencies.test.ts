import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPersonalMemoryManager } from '../src/personal-memory/index.mjs';

for (const scenario of ['resolved', 'missing', 'not injected']) test(`E2 historical commitments retain their source interactions: ${scenario}`, { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-commitment-deps-'));
  const owner = 'owner-00000000-0000-4000-8000-000000000001';
  const methods = ['initialize', 'capabilities', 'health', 'shutdown', 'ingest_boundary', 'preview_recall',
    'query_interactions', 'query_world', 'query_evidence', 'query_provenance', 'submit_command', 'query_command_receipt', 'retry_delete_storage_cleanup'];
  const commitments = ['A', 'A', 'B'].map((id, i) => ({ id: `commitment-${i}`, content: 'Synthetic historical advice.', raw_quote: 'Synthetic historical advice.',
    conversation_id: `old-${id}`, episode_id: `episode-${id}`, assistant_message_id: `reply-${id}` }));
  const sources = ['A', 'B'].map(id => ({ id: `interaction-${id}`, conversation_id: `old-${id}`, episode_id: `episode-${id}`,
    turns: [{ role: 'assistant', message_id: `reply-${id}`, content: 'This full history must not be injected.' }] }));
  let sourceReads = 0;
  const manager = createPersonalMemoryManager({ root, enabled: true, python: join(root, 'python.exe'), pythonPath: root,
    baseUrl: 'http://127.0.0.1:1/v1', model: '@current', credential: () => 'synthetic',
    rpcFactory: () => ({ child: {}, async close() {}, async request(method, params: any = {}) {
      if (method === 'capabilities') return { protocol: 'memoweft.dsh_rpc', protocol_version: 2, schema_version: 1, methods };
      if (method === 'initialize') return { runtime: { subject_id: owner, db_path: join(params.dsh_home, 'memoweft', 'memoweft.sqlite3') },
        capabilities: { subject_id: owner, methods, services: { command: { operations: [] } } } };
      if (method === 'health') return { runtime: { subject_id: owner, route_ready: true } };
      if (method === 'query_world') return { world_revision: 1 };
      if (method === 'preview_recall') return { world_revision: 1, preview: {
        selected_item_ids: [['cognition', 'profile']], rendered_recall: '本人档案（当前；保留原话归属）：\nSynthetic profile.' } };
      if (method === 'query_interactions' && params.projection === 'model') return { items: [], commitments,
        rendered_context: scenario === 'not injected' ? 'x'.repeat(2000) : 'Synthetic historical advice.' };
      if (method === 'query_interactions' && params.projection === 'history') {
        sourceReads++; assert.equal(params.search_mode, 'history_search');
        return { items: scenario === 'missing' ? [sources[0]] : sources };
      }
      throw Error(`Unexpected method ${method}`);
    } }) });
  try {
    const result = await manager.recall(owner, { query: 'Any suggestions?', sessionId: 'new-session', modelTier: 'local' });
    const dependencies = result.model_context_dependencies;
    assert.equal(dependencies.capture_status, scenario === 'missing' ? 'unavailable' : 'complete');
    assert.deepEqual(dependencies.interaction_ids, scenario === 'resolved' ? ['interaction-A', 'interaction-B'] : []);
    assert.deepEqual(dependencies.world_items, scenario === 'missing' ? [] : [{ object_kind: 'cognition', item_id: 'profile' }]);
    assert.doesNotMatch(result.contextText, /This full history/);
    if (scenario === 'not injected') { assert.equal(sourceReads, 0); assert.doesNotMatch(result.contextText, /historical advice/); }
    else { assert.ok(sourceReads > 0); assert.match(result.contextText, /historical advice/); }
  } finally { await manager.close(); await rm(root, { recursive: true, force: true }); }
});
